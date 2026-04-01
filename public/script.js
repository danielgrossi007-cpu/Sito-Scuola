// --- Dark Mode: apply IMMEDIATELY to prevent flash ---
(function() {
    const saved = localStorage.getItem('gs-theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();

document.addEventListener('DOMContentLoaded', () => {

    // --- Theme Toggle ---
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');

    function applyTheme(dark) {
        if (dark) {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (themeIcon) { themeIcon.className = 'fas fa-sun'; }
            localStorage.setItem('gs-theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (themeIcon) { themeIcon.className = 'fas fa-moon'; }
            localStorage.setItem('gs-theme', 'light');
        }
    }

    // Sync icon on page load
    const isDark = localStorage.getItem('gs-theme') === 'dark';
    applyTheme(isDark);

    themeToggle?.addEventListener('click', () => {
        applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark');
    });



    // --- DOM Elements ---
    const loginSection = document.getElementById('loginSection');
    const dashboardSection = document.getElementById('dashboardSection');
    const loader = document.getElementById('loader');
    const loginForm = document.getElementById('loginForm');
    const errorMsg = document.getElementById('loginError');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    const filesList = document.getElementById('filesList');
    const messagesList = document.getElementById('messagesList');
    const userNameDisplay = document.getElementById('userNameDisplay');
    const userAvatar = document.getElementById('userAvatar');

    // --- State ---
    let sessionToken = sessionStorage.getItem('moodleSessionId');
    let globalData = { courses: [], messages: [], allFiles: [] };

    // --- Exclusion List ---
    const excludedKeywords = [
        'chimica biennio',
        'carpentieri',
        'cavone',
        'di bernardo',
        'riscolo',
        'non rispondere a questa email',
        'ciafrei'
    ];

    function isExcluded(name) {
        if (!name) return false;
        const lower = name.toLowerCase();
        return excludedKeywords.some(kw => lower.includes(kw));
    }

    // --- Name Cleaner ---
    function cleanName(str) {
        if (!str) return '';
        return str
            .replace(/\b[Cc]orso(?:\s+di)?\b/ig, '')
            .replace(/\b[Pp]rof\.?(?:ssa|ess(?:\w+)?|s)?\b/ig, '')
            .replace(/\b[Tt]riennio\b/ig, '')
            .replace(/\./g, '')
            .replace(/\s{2,}/g, ' ')
            .trim()
            .toUpperCase();
    }

    // --- Auto login ---
    if (sessionToken) {
        showLoader();
        fetchDashboardData();
    }

    // --- Login Form ---
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        errorMsg.textContent = '';
        showLoader();

        try {
            const response = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Errore di autenticazione');
            sessionToken = data.sessionId;
            sessionStorage.setItem('moodleSessionId', sessionToken);
            fetchDashboardData();
        } catch (error) {
            loginSection.classList.remove('hidden');
            loader.classList.add('hidden');
            errorMsg.textContent = error.message;
        }
    });

    function showLoader() {
        loginSection.classList.add('hidden');
        dashboardSection.classList.add('hidden');
        loader.classList.remove('hidden');
    }

    // --- Fetch Dashboard ---
    async function fetchDashboardData() {
        showLoader();
        setStatus(true, 'Connessione...');

        try {
            const response = await fetch(`/api/dashboard?session=${sessionToken}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Sessione scaduta');

            // Process courses
            globalData.courses = (data.courses || []).filter(c => !isExcluded(c.name));

            // Process messages
            globalData.messages = (data.messages || [])
                .filter(m => !isExcluded(m.userfromfullname) && !isExcluded(m.subject))
                .map(m => {
                    if (m.userfromfullname) {
                        const profMatch = m.userfromfullname.match(/Prof\.?[a-z]*\s+([A-Za-z\s]+)/i);
                        if (profMatch) {
                            let p = profMatch[1].replace(/-.*/g, '').replace(/triennio.*/ig, '').trim().toUpperCase();
                            m.profName = p.split(' ').slice(0, 2).join(' ');
                        } else {
                            m.profName = cleanName(m.userfromfullname).split(' ')[0];
                        }
                        m.userfromfullname = cleanName(m.userfromfullname);
                    }
                    return m;
                });

            // Process files
            let allFiles = [];
            globalData.courses.forEach(course => {
                const cName = cleanName(course.name);
                let profName = '';
                const profMatch = course.name.match(/Prof\.?[a-z]*\s+([A-Za-z\s]+)/i);
                if (profMatch) {
                    let p = profMatch[1].replace(/-.*/g, '').replace(/triennio.*/ig, '').trim().toUpperCase();
                    profName = p.split(' ').slice(0, 2).join(' ');
                }
                course.files.forEach(file => {
                    allFiles.push({ ...file, courseName: cName, profName });
                });
            });
            globalData.allFiles = allFiles.sort((a, b) => (b.time || 0) - (a.time || 0));

            // Set user info
            const firstName = data.user.split(' ')[0] || 'Studente';
            userNameDisplay.textContent = firstName;
            if (userAvatar) userAvatar.textContent = firstName.charAt(0).toUpperCase();

            setStatus(true, 'Connesso');
            renderFilters();
            applyFilter('all');
            renderCalendar();

            loader.classList.add('hidden');
            dashboardSection.classList.remove('hidden');

        } catch (error) {
            setStatus(false, 'Disconnesso');
            sessionStorage.removeItem('moodleSessionId');
            loader.classList.add('hidden');
            loginSection.classList.remove('hidden');
            errorMsg.textContent = error.message;
        }
    }

    // --- Render Filters (pill buttons) ---
    function renderFilters() {
        const filterList = document.getElementById('filterList');
        filterList.innerHTML = `<button class="filter-pill active" data-filter="all"><i class="fas fa-layer-group" style="margin-right:5px;"></i>Tutto</button>`;

        const latestTimes = new Map();
        globalData.messages.filter(m => m.userfromfullname).forEach(m => {
            const t = m.timecreated || 0;
            const name = m.userfromfullname;
            if (!latestTimes.has(name) || latestTimes.get(name) < t) latestTimes.set(name, t);
        });
        globalData.allFiles.forEach(f => {
            const t = f.time || 0;
            const name = f.courseName;
            if (!latestTimes.has(name) || latestTimes.get(name) < t) latestTimes.set(name, t);
        });

        const allTags = Array.from(latestTimes.keys())
            .filter(t => t && t.trim() !== '')
            .sort((a, b) => latestTimes.get(b) - latestTimes.get(a));

        allTags.forEach(tag => {
            const btn = document.createElement('button');
            btn.className = 'filter-pill';
            btn.dataset.filter = tag;
            btn.textContent = tag;
            filterList.appendChild(btn);
        });

        filterList.querySelectorAll('.filter-pill').forEach(el => {
            el.addEventListener('click', (e) => {
                filterList.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
                e.currentTarget.classList.add('active');
                applyFilter(e.currentTarget.dataset.filter);
            });
        });
    }

    function applyFilter(tag) {
        const isAll = (tag === 'all');
        const filteredFiles = isAll
            ? globalData.allFiles
            : globalData.allFiles.filter(f => f.courseName === tag || f.courseName.includes(tag));
        const filteredMsgs = isAll
            ? globalData.messages
            : globalData.messages.filter(m => m.userfromfullname === tag || (m.subject && m.subject.includes(tag)));

        renderMessages(filteredMsgs);
        renderFiles(filteredFiles, isAll);

        const msgCount = document.getElementById('msgCount');
        const fileCount = document.getElementById('fileCount');
        if (msgCount) msgCount.textContent = `${filteredMsgs.length} messaggi`;
        if (fileCount) fileCount.textContent = `${filteredFiles.length} file`;
    }

    // --- SPA Navigation (top nav links) ---
    const allViews = ['dashboardGrid', 'calculatorView', 'scheduleView', 'calendarView'];

    document.querySelectorAll('.nav-link').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');

            const targetId = e.currentTarget.dataset.view;
            allViews.forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.classList.add('hidden');
                    if (el.style.display === 'flex') el.style.display = 'none';
                }
            });

            const target = document.getElementById(targetId);
            if (target) {
                target.classList.remove('hidden');
                // Calendar needs flex
                if (targetId === 'calendarView') target.style.display = 'flex';
            }
        });
    });

    // --- Render Messages ---
    function renderMessages(messages) {
        messagesList.innerHTML = '';
        if (messages.length === 0) {
            messagesList.innerHTML = '<li class="empty-state"><i class="fas fa-inbox"></i><p>Nessun avviso</p></li>';
            return;
        }

        messages.forEach(msg => {
            const li = document.createElement('li');
            const isTask = (msg.subject || '').toLowerCase().startsWith('compito');
            li.className = 'msg-item' + (isTask ? ' msg-assignment' : '');

            const from = msg.userfromfullname || 'Moodle';
            const initials = from.split(' ').slice(0, 2).map(w => w[0] || '').join('');
            const date = new Date((msg.timecreated || 0) * 1000);
            const dateStr = date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });

            li.innerHTML = `
                <div class="msg-avatar">${initials || '?'}</div>
                <div class="msg-meta">
                    <div class="msg-from">${from}</div>
                    <div class="msg-subject">${msg.subject || 'Notifica'}</div>
                    <div class="msg-time">${dateStr}</div>
                </div>
                ${isTask ? '<span class="msg-badge compito">Compito</span>' : '<span class="msg-badge">Avviso</span>'}
            `;
            messagesList.appendChild(li);
        });
    }

    // --- Render Files ---
    function renderFiles(filesArray, isAll = false) {
        filesList.innerHTML = '';

        if (filesArray.length === 0) {
            filesList.innerHTML = '<div class="empty-state"><i class="fas fa-file-alt"></i><p>Nessun file disponibile</p></div>';
            return;
        }

        function getIcon(name) {
            const n = name.toLowerCase();
            if (n.endsWith('.pdf')) return 'fa-file-pdf';
            if (n.endsWith('.doc') || n.endsWith('.docx')) return 'fa-file-word';
            if (n.endsWith('.zip') || n.endsWith('.rar')) return 'fa-file-archive';
            if (n.endsWith('.ppt') || n.endsWith('.pptx')) return 'fa-file-powerpoint';
            if (n.endsWith('.xls') || n.endsWith('.xlsx')) return 'fa-file-excel';
            return 'fa-file-alt';
        }

        if (isAll) {
            // Flat chronological list grouped by course accordion
            const byCourse = {};
            filesArray.forEach(f => {
                if (!byCourse[f.courseName]) byCourse[f.courseName] = [];
                byCourse[f.courseName].push(f);
            });

            Object.keys(byCourse).sort().forEach(courseName => {
                const details = document.createElement('details');
                details.className = 'section-accordion';

                const summary = document.createElement('summary');
                summary.innerHTML = `<i class="fas fa-folder" style="color:var(--accent); margin-right:6px;"></i>${courseName} <span style="color:var(--text-muted); font-weight:400; font-size:0.8rem;">(${byCourse[courseName].length})</span>`;
                details.appendChild(summary);

                byCourse[courseName].forEach(f => appendFileItem(details, f, getIcon(f.name)));
                filesList.appendChild(details);
            });
            return;
        }

        // Per-course view: group by section
        const bySection = {};
        filesArray.forEach(f => {
            const s = f.section || 'Generale';
            if (!bySection[s]) bySection[s] = [];
            bySection[s].push(f);
        });

        Object.keys(bySection).sort().forEach(sectionName => {
            const details = document.createElement('details');
            details.className = 'section-accordion';

            const summary = document.createElement('summary');
            summary.innerHTML = `<i class="fas fa-folder-open" style="color:var(--accent); margin-right:6px;"></i>${sectionName} <span style="color:var(--text-muted); font-weight:400; font-size:0.8rem;">(${bySection[sectionName].length})</span>`;
            details.appendChild(summary);

            bySection[sectionName].forEach(f => appendFileItem(details, f, getIcon(f.name)));
            filesList.appendChild(details);
        });
    }

    function appendFileItem(parent, f, iconClass) {
        const proxyUrl = `/api/download?fileurl=${encodeURIComponent(f.url)}&session=${sessionToken}`;
        const item = document.createElement('div');
        item.className = 'file-item';
        const date = f.time ? new Date(f.time * 1000).toLocaleDateString('it-IT') : '';
        item.innerHTML = `
            <div class="file-icon"><i class="fas ${iconClass}"></i></div>
            <div class="file-name">${f.name}</div>
            <div class="file-time">${date}</div>
            <a href="${proxyUrl}" target="_blank" class="file-dl-btn" title="Scarica"><i class="fas fa-download"></i></a>
        `;
        parent.appendChild(item);
    }

    // --- Absence Calculator ---
    window.calcAbsences = function() {
        const days = parseInt(document.getElementById('calcDays').value) || 0;
        const late = parseInt(document.getElementById('calcLate').value) || 0;
        const early = parseInt(document.getElementById('calcEarly').value) || 0;

        const maxHours = 1056;
        const limitHours = 264; // 25%
        const warningHours = Math.floor(maxHours * 0.18); // 18%

        const totalAbsent = (days * 6) + late + early;
        const pct = (totalAbsent / maxHours) * 100;
        const remaining = limitHours - totalAbsent;

        document.getElementById('r-hours').textContent = `${totalAbsent} ore`;
        document.getElementById('r-percent').textContent = `${pct.toFixed(1)}%`;
        document.getElementById('r-remaining').textContent = remaining >= 0 ? `${remaining} ore` : `SFORATO di ${Math.abs(remaining)} ore`;
        document.getElementById('r-days-left').textContent = remaining >= 0 ? `${Math.floor(remaining / 6)} giorni` : '0';

        const bar = document.getElementById('resultBar');
        bar.style.width = Math.min(pct / 25 * 100, 100) + '%';
        bar.className = 'result-bar-fill';
        if (pct >= 25) bar.classList.add('danger');
        else if (pct >= 18) bar.classList.add('warning');

        let statusEl = document.getElementById('r-status');
        statusEl.innerHTML = '';
        const badge = document.createElement('div');
        badge.className = 'result-status-badge';
        if (totalAbsent > limitHours) {
            badge.classList.add('danger');
            badge.innerHTML = '<i class="fas fa-times-circle"></i> LIMITE SUPERATO! Rischio bocciatura.';
        } else if (pct >= 18) {
            badge.classList.add('warning');
            badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> ZONA RISCHIO: oltre il 18%.';
        } else {
            badge.classList.add('ok');
            badge.innerHTML = '<i class="fas fa-check-circle"></i> Situazione regolare.';
        }
        statusEl.appendChild(badge);

        const resultDiv = document.getElementById('calcResult');
        resultDiv.classList.add('visible');
        resultDiv.style.display = 'block';
    };

    // --- Status ---
    function setStatus(online, text) {
        statusText.textContent = text;
        statusIndicator.className = 'nav-status ' + (online ? 'online' : 'offline');
    }

    // --- Calendar ---
    let currentCalDate = new Date();
    const calGrid = document.getElementById('calGrid');
    const calMonthLabel = document.getElementById('calMonthLabel');
    const calDetailsPanel = document.getElementById('calDetailsPanel');
    const calDetailsContent = document.getElementById('calDetailsContent');
    const calDetailsTitle = document.getElementById('calDetailsTitle');

    document.getElementById('calPrev')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() - 1);
        renderCalendar();
    });

    document.getElementById('calNext')?.addEventListener('click', () => {
        currentCalDate.setMonth(currentCalDate.getMonth() + 1);
        renderCalendar();
    });

    document.getElementById('calCloseDetails')?.addEventListener('click', () => {
        calDetailsPanel.classList.add('hidden');
        document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
    });

    function renderCalendar() {
        if (!calGrid) return;
        calGrid.innerHTML = '';
        if(calDetailsPanel) calDetailsPanel.classList.add('hidden');

        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
        if (calMonthLabel) calMonthLabel.textContent = `${monthNames[month]} ${year}`;

        let firstDay = new Date(year, month, 1).getDay();
        firstDay = firstDay === 0 ? 6 : firstDay - 1;
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        // Build event map
        const eventMap = {};

        (globalData.allFiles || []).forEach(f => {
            if (!f.time) return;
            const d = new Date(f.time * 1000);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            if (!eventMap[key]) eventMap[key] = [];
            let title = f.name;
            if (f.profName) title += ` — ${f.profName}`;
            eventMap[key].push({ type: 'file', title, time: d });
        });

        (globalData.messages || []).forEach(m => {
            if (!m.timecreated) return;
            const d = new Date(m.timecreated * 1000);
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
            if (!eventMap[key]) eventMap[key] = [];
            let title = m.subject || 'Avviso';
            if (m.profName) title += ` — ${m.profName}`;
            eventMap[key].push({ type: 'task', title, time: d });
        });

        const today = new Date();

        for (let i = 0; i < firstDay; i++) {
            const el = document.createElement('div');
            el.className = 'cal-day empty';
            calGrid.appendChild(el);
        }

        for (let i = 1; i <= daysInMonth; i++) {
            const cell = document.createElement('div');
            cell.className = 'cal-day';
            if (year === today.getFullYear() && month === today.getMonth() && i === today.getDate()) {
                cell.classList.add('today');
            }

            const num = document.createElement('div');
            num.className = 'cal-date-num';
            num.textContent = i;
            cell.appendChild(num);

            const key = `${year}-${month}-${i}`;
            const events = eventMap[key] || [];

            events.slice(0, 3).forEach(ev => {
                const badge = document.createElement('div');
                badge.className = `cal-event-badge cal-event-${ev.type}`;
                badge.textContent = ev.title;
                cell.appendChild(badge);
            });

            if (events.length > 3) {
                const more = document.createElement('div');
                more.className = 'cal-event-badge';
                more.style.cssText = 'background:#f0f0f0; color:#666;';
                more.textContent = `+${events.length - 3}`;
                cell.appendChild(more);
            }

            cell.addEventListener('click', () => {
                document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
                cell.classList.add('selected');
                showCalDetails(i, monthNames[month], year, events);
            });

            calGrid.appendChild(cell);
        }
    }

    function showCalDetails(day, monthName, year, events) {
        if (!calDetailsTitle || !calDetailsContent) return;
        calDetailsTitle.textContent = `${day} ${monthName} ${year}`;
        calDetailsContent.innerHTML = '';

        if (events.length === 0) {
            calDetailsContent.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:24px 0; font-size:0.88rem;">Nessun evento questa data.</p>';
        } else {
            events.sort((a, b) => a.time - b.time).forEach(ev => {
                const el = document.createElement('div');
                el.className = 'cal-detail-item';
                const timeStr = ev.time.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
                const icon = ev.type === 'file'
                    ? '<i class="fas fa-file-alt" style="color:#065f46"></i>'
                    : '<i class="fas fa-tasks" style="color:#6d28d9"></i>';
                const label = ev.type === 'file' ? 'File' : 'Compito/Avviso';
                el.innerHTML = `
                    <div class="cal-detail-meta"><span>${icon} ${label}</span><span>${timeStr}</span></div>
                    <div class="cal-detail-title">${ev.title}</div>
                `;
                calDetailsContent.appendChild(el);
            });
        }

        calDetailsPanel.classList.remove('hidden');
    }

    // --- Logout ---
    window.logout = function() {
        sessionStorage.removeItem('moodleSessionId');
        sessionToken = null;
        globalData = { courses: [], messages: [], allFiles: [] };
        dashboardSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        setStatus(false, 'Disconnesso');
        errorMsg.textContent = '';
    };

});
