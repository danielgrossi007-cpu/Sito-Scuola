const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const path = require('path');
const { getMoodleToken, getSiteInfo, getCourses, getCourseContents, getMessages, getAssignments } = require('./moodle');

const app = express();
const PORT = 3001;

app.use(helmet({
    contentSecurityPolicy: false // Disabled for ease of local development
}));

app.use(cors());
app.use(express.static('public'));

// Do NOT log body in generic middlewares (Stateless policy)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// RAM Session Store: sessionId -> Moodle Token
const sessions = new Map();

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
            return res.status(400).json({ error: "Credenziali mancanti" });
        }

        // Get actual Moodle Token
        const token = await getMoodleToken(username, password);
        
        // Generate secure temporary session ID
        const sessionId = crypto.randomUUID();
        sessions.set(sessionId, token);

        // Optional expiration (e.g. 1 hour)
        setTimeout(() => sessions.delete(sessionId), 3600000);

        res.json({ success: true, sessionId });
    } catch (e) {
        res.status(401).json({ error: e.message });
    }
});

// Middleware to check session
const requireAuth = (req, res, next) => {
    const sessionId = req.headers.authorization || req.query.session;
    if (!sessionId || !sessions.has(sessionId)) {
        return res.status(401).json({ error: "Sessione scaduta o non valida." });
    }
    req.moodleToken = sessions.get(sessionId);
    next();
};

app.get('/api/dashboard', requireAuth, async (req, res) => {
    try {
        const token = req.moodleToken;
        
        // 1. Get User Profile
        const siteInfo = await getSiteInfo(token);
        const userid = siteInfo.userid;

        // 2. Parallel Requests: Courses, Messages, Assignments
        const [courses, messagesData, assignmentsData] = await Promise.all([
            getCourses(token, userid),
            getMessages(token, userid).catch(() => ({ messages: [] })), // Fallback if messages not supported
            getAssignments(token).catch(() => ({ courses: [] }))
        ]);

        if (!messagesData.messages) messagesData.messages = [];
        if (messagesData.notifications) messagesData.messages.push(...messagesData.notifications);

        // Build Assignment Mapping for true Due Dates
        const assignmentsMap = {};
        if (assignmentsData && assignmentsData.courses) {
            assignmentsData.courses.forEach(c => {
                if(c.assignments) {
                    c.assignments.forEach(a => {
                        assignmentsMap[a.id] = a; // Instance id
                        assignmentsMap[a.cmid] = a; // Course module id
                    });
                }
            });
        }

        // 3. Get Contents for each Course
        const courseData = [];
        for (const course of courses) {
            try {
                const contents = await getCourseContents(token, course.id);
                // Extract only actual downloadable files (type: url or file) 
                // from the modules in each section.
                const files = [];
                contents.forEach(section => {
                    const sectionName = section.name || 'Generale';
                    if (section.modules) {
                        section.modules.forEach(mod => {
                             // --- ASSIGNMENTS (Compiti) ---
                             if (mod.modname === 'assign') {
                                 let targetDate = mod.added || Math.floor(Date.now()/1000);
                                 
                                 // Pull Authentic Moodle Due Date
                                 if (assignmentsMap[mod.instance]) {
                                     targetDate = assignmentsMap[mod.instance].duedate;
                                 } else if (assignmentsMap[mod.id]) {
                                     targetDate = assignmentsMap[mod.id].duedate;
                                 }
                                 
                                 // Ignore assignments with NO due date (0) or it maps to 1970
                                 if (targetDate > 0) {
                                     messagesData.messages.push({
                                         subject: `COMPITO: ${mod.name}`,
                                         text: mod.description || "Controlla Moodle per i dettagli e la scadenza della consegna.",
                                         timecreated: targetDate,
                                         userfromfullname: course.fullname || course.shortname,
                                         isAssignment: true
                                     });
                                 }
                             }

                             // --- FILES ---
                             if (mod.modname === 'resource' || mod.modname === 'folder') {
                                 const description = mod.description || '';
                                 if (mod.contents) {
                                     mod.contents.forEach(f => {
                                         if (f.fileurl) {
                                             files.push({
                                                 name: f.filename,
                                                 url: f.fileurl,
                                                 time: f.timemodified || mod.added,
                                                 section: sectionName,
                                                 description: description
                                             });
                                         }
                                     });
                                 }
                             }
                        });
                    }
                });
                courseData.push({
                    id: course.id,
                    name: course.fullname || course.shortname,
                    files: files
                });
            } catch (ce) {
                // Ignore course error
            }
        }

        res.json({
            user: siteInfo.fullname,
            messages: messagesData.messages,
            courses: courseData
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/download', requireAuth, (req, res) => {
    const fileurl = req.query.fileurl;
    if (!fileurl) return res.status(400).send("File url missing");

    // The official mobile app way to bypass Moodle session cookies for a file stream
    // is simply appending ?token= or &token= to the fileurl!
    const connector = fileurl.includes('?') ? '&' : '?';
    const finalUrl = `${fileurl}${connector}token=${req.moodleToken}`;

    // Redirect the browser straight to Moodle's CDN/Server bypass
    res.redirect(finalUrl);
});

app.listen(PORT, () => {
    console.log(`Moodle Bridge Server running on http://localhost:${PORT}`);
});
