const axios = require('axios');

const BASE_URL = 'https://elearning.isgalileisani.it';

/**
 * Perform login using the official Moodle mobile app service to retrieve auth token.
 */
async function getMoodleToken(username, password) {
    const url = `${BASE_URL}/login/token.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&service=moodle_mobile_app`;
    
    const res = await axios.post(url);
    if (res.data.error) {
        throw new Error(res.data.error);
    }
    if (!res.data.token) {
        throw new Error("Token non ricevuto. Verifica le credenziali o se l'accesso via app è abilitato on-site.");
    }
    return res.data.token;
}

/**
 * Generic Web Service caller
 */
async function callWS(token, wsfunction, params = {}) {
    // Moodle WS expects POST data. Alternatively, we can use query strings for simple calls.
    const url = new URL(`${BASE_URL}/webservice/rest/server.php`);
    url.searchParams.append('wstoken', token);
    url.searchParams.append('wsfunction', wsfunction);
    url.searchParams.append('moodlewsrestformat', 'json');
    
    for (const [key, val] of Object.entries(params)) {
        url.searchParams.append(key, val);
    }

    const res = await axios.post(url.toString(), null, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    // Moodle API errors
    if (res.data && res.data.exception) {
         throw new Error(`Moodle API Error [${wsfunction}]: ${res.data.message}`);
    }
    return res.data;
}

/**
 * Get the current user's profile info (need UserID for other calls)
 */
async function getSiteInfo(token) {
    return await callWS(token, 'core_webservice_get_site_info');
}

/**
 * Get the courses the user is enrolled in
 */
async function getCourses(token, userid) {
    return await callWS(token, 'core_enrol_get_users_courses', { userid });
}

/**
 * Get contents (files/modules) of a specific course
 */
async function getCourseContents(token, courseid) {
    return await callWS(token, 'core_course_get_contents', { courseid });
}

/**
 * Get Messages/Notifications (core_message_get_messages)
 */
async function getMessages(token, useridto) {
    // Moodle sometimes complains if read is not specified. 
    // Trying standard configuration for unread/read both.
    try {
        return await callWS(token, 'core_message_get_messages', {
            useridto: useridto,
            type: 'notifications',
            read: 0,
            limitfrom: 0,
            limitnum: 20
        });
    } catch (e) {
        // Fallback for newer moodle versions, or try empty params
        throw e;
    }
}

/**
 * Get all user assignments to extract real DUE DATES
 */
async function getAssignments(token) {
    return await callWS(token, 'mod_assign_get_assignments');
}

module.exports = {
    getMoodleToken,
    getSiteInfo,
    getCourses,
    getCourseContents,
    getMessages,
    getAssignments
};
