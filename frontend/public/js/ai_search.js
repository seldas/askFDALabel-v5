document.addEventListener('DOMContentLoaded', function() {
    const aiSearchBtn = document.getElementById('ai-search-btn');
    const aiModal = document.getElementById('ai-search-modal');
    const closeAiBtn = document.getElementById('close-ai-search');
    const aiInput = document.getElementById('ai-search-input');
    const aiSendBtn = document.getElementById('ai-search-send');
    const messagesContainer = document.getElementById('ai-search-messages');
    const mainSearchInput = document.getElementById('drug-name-input');
    const mainSearchForm = document.getElementById('search-form');
    const resetHomeBtn = document.getElementById('reset-home-chat-btn');

    let history = [];

    // Restore Session
    if (window.SessionManager) {
        const savedSession = SessionManager.getSession('home');
        if (savedSession && savedSession.messages && savedSession.messages.length > 0) {
            history = savedSession.messages;
            messagesContainer.innerHTML = ''; // Clear default greeting
            history.forEach(msg => {
                const role = msg.role === 'assistant' ? 'ai' : msg.role;
                appendMessage(role, msg.content);
            });
        }
    }

    if (!aiSearchBtn || !aiModal) return;

    if (resetHomeBtn) {
        resetHomeBtn.addEventListener('click', () => {
            if (confirm('Clear this chat?')) {
                messagesContainer.innerHTML = `
                    <div class="message message-ai">
                        <div class="message-content">
                            Hello! I can help you find the right drug label. Tell me what you're looking for (e.g., "drugs for headache", "white round pill 50mg", or just a name).
                        </div>
                    </div>
                `;
                history = [];
                if (window.SessionManager) {
                    SessionManager.updateSession('home', 'Home Search', []);
                }
            }
        });
    }

    // Open Modal
    aiSearchBtn.addEventListener('click', () => {
        aiModal.style.display = 'block';
        aiInput.focus();
    });

    // Close Modal
    if (closeAiBtn) {
        closeAiBtn.addEventListener('click', () => {
            aiModal.style.display = 'none';
        });
    }

    window.addEventListener('click', (e) => {
        if (e.target === aiModal) {
            aiModal.style.display = 'none';
        }
    });

    // Send Message
    function sendMessage() {
        const text = aiInput.value.trim();
        if (!text) return;

        // Add User Message
        appendMessage('user', text);
        aiInput.value = '';

        // Show Loading
        const loadingId = appendLoading();

        // API Call
        fetch('/api/dashboard/ai_search_help', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: text,
                history: history
            })
        })
        .then(res => res.json())
        .then(data => {
            removeLoading(loadingId);
            
            if (data.error) {
                appendMessage('ai', "Sorry, I encountered an error: " + data.error);
                return;
            }

            // Update History
            history.push({ role: 'user', content: text });
            history.push({ role: 'assistant', content: data.reply });

            if (window.SessionManager) {
                SessionManager.updateSession('home', 'Home Search', history);
            }

            // Display Reply
            appendMessage('ai', data.reply);

            // Handle Suggested Term
            if (data.is_final && data.suggested_term) {
                appendAction(data.suggested_term);
            }
        })
        .catch(err => {
            removeLoading(loadingId);
            console.error(err);
            appendMessage('ai', "Network error. Please try again.");
        });
    }

    aiSendBtn.addEventListener('click', sendMessage);
    aiInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    // Tooltip Element
    let tooltip = document.createElement('div');
    tooltip.className = 'ai-search-tooltip';
    document.body.appendChild(tooltip);

    function appendMessage(role, text) {
        const div = document.createElement('div');
        div.className = `message message-${role}`;
        
        // Parse [[Term]] into clickable spans
        let formattedText = text.replace(/\[\[(.*?)\]\]/g, (match, term) => {
            return `<span class="ai-link-pill" onclick="triggerAiSearch('${term}')" onmouseenter="showSearchCount(this, '${term}')" onmouseleave="hideSearchCount()">${term}</span>`;
        });

        div.innerHTML = `<div class="message-content">${formattedText}</div>`;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Tooltip Logic
    let tooltipTimeout;
    
    window.showSearchCount = function(element, term) {
        tooltip.innerHTML = 'Loading count...';
        tooltip.style.display = 'block';
        
        // Position tooltip
        const rect = element.getBoundingClientRect();
        tooltip.style.left = rect.left + 'px';
        tooltip.style.top = (rect.bottom + 5) + 'px'; // Below the pill

        // Debounce to avoid spamming
        clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => {
            fetch(`/api/dashboard/search_count?q=${encodeURIComponent(term)}`)
                .then(res => res.json())
                .then(data => {
                    tooltip.innerHTML = `<strong>${data.count}</strong> results found<br><small>via ${data.source}</small>`;
                })
                .catch(() => {
                    tooltip.innerHTML = 'Error fetching count';
                });
        }, 200); // 200ms delay
    };

    window.hideSearchCount = function() {
        clearTimeout(tooltipTimeout);
        tooltip.style.display = 'none';
    };

    // Expose trigger function globally
    window.triggerAiSearch = function(term) {
        mainSearchInput.value = term;
        aiModal.style.display = 'none';
        mainSearchForm.submit();
    };

    function appendLoading() {
        const id = 'loading-' + Date.now();
        const div = document.createElement('div');
        div.id = id;
        div.className = 'message message-ai';
        div.innerHTML = `<div class="message-content">Typing...</div>`;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        return id;
    }

    function removeLoading(id) {
        const el = document.getElementById(id);
        if (el) el.remove();
    }

    function appendAction(term) {
        const div = document.createElement('div');
        div.className = 'message message-ai';
        div.style.textAlign = 'center';
        div.innerHTML = `
            <div style="margin-top: 10px;">
                <button class="ai-apply-btn" data-term="${term}">
                    🔍 Search for "<strong>${term}</strong>"
                </button>
            </div>
        `;
        messagesContainer.appendChild(div);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Bind click
        div.querySelector('.ai-apply-btn').addEventListener('click', function() {
            const term = this.getAttribute('data-term');
            mainSearchInput.value = term;
            aiModal.style.display = 'none';
            // Optional: Auto submit
             mainSearchForm.submit();
        });
    }
});

