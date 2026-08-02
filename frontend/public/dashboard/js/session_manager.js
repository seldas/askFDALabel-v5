/**
 * Session Manager for AskFDALabel
 * Handles persistence of chat sessions across Home and Label pages.
 */

const SessionManager = {
    STORAGE_KEY: 'askfdalabel_chat_sessions',
    
    init: function() {
        if (!localStorage.getItem(this.STORAGE_KEY)) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                active_session_id: null,
                sessions: []
            }));
        }
    },

    loadSessions: function() {
        try {
            const data = localStorage.getItem(this.STORAGE_KEY);
            return data ? JSON.parse(data) : { sessions: [] };
        } catch (e) {
            console.error("Failed to load sessions", e);
            return { sessions: [] };
        }
    },

    saveSessions: function(data) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error("Failed to save sessions", e);
        }
    },

    /**
     * Updates or creates a session.
     * @param {string} id - 'home' or set_id
     * @param {string} title - Display title (e.g., "Home Search" or Drug Name)
     * @param {Array} messages - Array of message objects
     */
    updateSession: function(id, title, messages) {
        const data = this.loadSessions();
        const now = Date.now();
        
        // Ensure sessions array exists
        if (!data.sessions) data.sessions = [];

        let sessionIndex = data.sessions.findIndex(s => s.id === id);
        
        if (sessionIndex > -1) {
            // Update existing
            data.sessions[sessionIndex].messages = messages;
            data.sessions[sessionIndex].timestamp = now;
            data.sessions[sessionIndex].title = title; // Update title in case it changed
        } else {
            // Create new
            data.sessions.push({
                id: id,
                title: title,
                messages: messages,
                timestamp: now
            });
        }
        
        data.active_session_id = id;
        this.saveSessions(data);
    },

    /**
     * Returns all sessions EXCEPT the current one, sorted by timestamp.
     */
    getHistory: function(excludeId) {
        const data = this.loadSessions();
        if (!data.sessions) return [];
        
        return data.sessions
            .filter(s => s.id !== excludeId && s.messages && s.messages.length > 0)
            .sort((a, b) => a.timestamp - b.timestamp);
    },
    
    getSession: function(id) {
        const data = this.loadSessions();
        if (!data.sessions) return null;
        return data.sessions.find(s => s.id === id);
    },

    clearAll: function() {
        localStorage.removeItem(this.STORAGE_KEY);
        this.init();
    }
};

// Initialize on load
SessionManager.init();
window.SessionManager = SessionManager;
