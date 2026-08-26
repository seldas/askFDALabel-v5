window.initFaers = function() {
    // --- FAERS Dashboard Logic ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    const faersLimitSelect = document.getElementById('faers-limit-select');
    // Track chart instances to destroy them on update
    let chartInstances = {}; 
    let currentFaersData = null; // Store fetched reactions for pagination
    
    // Globally shared flags/data to survive React re-inits
    window.faersDataLoaded = window.faersDataLoaded || false;
    window.meddraScanData = window.meddraScanData || null; 
    
    let currentCoveragePage = 1;
    const itemsPerPage = 10;

    // ... (rest of initFaers)

    window.reapplyMeddraHighlights = function() {
        const labelContainer = document.getElementById('label-view');
        if (!labelContainer) return;

        // ONLY Re-apply MedDRA Scan (Base terms found in local DB)
        // We no longer overlay FAERS signals on the label text per updated requirements
        if (window.meddraScanData) {
            highlightSafetyTerms(labelContainer, window.meddraScanData);
        }
    };

    window.faersCoverageFilter = 'all';

    window.faersSocFilter = 'ALL'; // SOC abbrev or 'ALL'

    window.setSocFilter = function(socAbbrev) {
        window.faersSocFilter = socAbbrev || 'ALL';
        currentCoveragePage = 1;
        renderCoverageTable();
    };

    // SOC abbrevs to EXCLUDE (non-AE-ish buckets).
    const NON_AE_SOC_ABBREV = new Set([
        // 'INV',   // Investigations (often labs, not events)
        'SOCCI',   // Social circumstances
        'PROD',   // Product issues
        'SURG',   // Surgical and medical procedures
    ]);

    function isAeSoc(item) {
        const abbr = (item.soc_abbrev || '').trim().toUpperCase();
        return !NON_AE_SOC_ABBREV.has(abbr);
    }

    function isNotPresentedStatusText(statusText) {
        const t = (statusText || '').toLowerCase();
        return (
            t.includes('not presented') ||
            t.includes('not in label') ||
            t.includes('not present') ||
            t.includes('absent')
        );
        }
        window.setCoverageFilter = function(filter) {
        window.faersCoverageFilter = (filter === 'not_presented') ? 'not_presented' : 'all';
        currentCoveragePage = 1; // reset
        renderCoverageTable();
    };
    
    // Global state for trend comparison
    window.selectedTerms = new Set();
    window.trendCache = {}; // Cache for fetched time-series data: { "Term": [{time:..., count:...}] }
    const MAX_SELECTED_TERMS = 10;

    if (tabBtns.length > 0) {
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                // Toggle Buttons
                tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // Toggle Content
                const targetId = btn.getAttribute('data-target');
                tabContents.forEach(content => {
                    content.style.display = (content.id === targetId) ? 'block' : 'none';
                    if (content.id === targetId) content.classList.add('active');
                    else content.classList.remove('active');
                });

                // Sidebar Logic (Auto-hide on non-label views)
                const tocPanel = document.getElementById('toc-panel');
                const mainContent = document.getElementById('main-content');
                const showTocBtn = document.getElementById('show-toc-btn');
                const tocToggle = document.getElementById('toc-toggle');

                if (targetId === 'label-view') {
                    // Force show sidebar
                    if (tocPanel) tocPanel.classList.remove('hidden');
                    if (mainContent) mainContent.classList.remove('expanded');
                    if (showTocBtn) showTocBtn.style.display = 'none';
                    
                    // Sync toggle icon
                    if (tocToggle) tocToggle.innerHTML = '&laquo;'; 
                } else {
                    // Force hide sidebar and button
                    if (tocPanel) tocPanel.classList.add('hidden');
                    if (mainContent) mainContent.classList.add('expanded');
                    if (showTocBtn) showTocBtn.style.display = 'none';
                    
                    // Sync toggle icon
                    if (tocToggle) tocToggle.innerHTML = '&raquo;'; 
                }

                // Load Data if FAERS tab is selected
                if (targetId === 'faers-view' && !window.faersDataLoaded) {
                    loadFaersData();
                }
            });
        });

        // Add listener for limit change (Now client-side only)
        if (faersLimitSelect) {
            faersLimitSelect.addEventListener('change', () => {
                const limit = parseInt(faersLimitSelect.value, 10);
                filterAndRenderCharts(limit);
            });
        }

        // Handle Hash-based Tab Switching on Load
        if (window.location.hash) {
            const hash = window.location.hash.substring(1); // remove #
            const targetBtn = document.querySelector(`.tab-btn[data-target="${hash}"]`);
            if (targetBtn) {
                // Small delay to ensure everything is ready
                setTimeout(() => targetBtn.click(), 100);
            }
        }
    }

    // Pagination Event Listeners
    const firstBtn = document.getElementById('firstPage');
    const lastBtn = document.getElementById('lastPage');
    const prevBtn = document.getElementById('prevPage');
    const nextBtn = document.getElementById('nextPage');
    const pageInput = document.getElementById('pageInput');

    function goToPage(page) {
        // Validation happens in renderCoverageTable, but we can set state here
        currentCoveragePage = parseInt(page, 10);
        renderCoverageTable();
    }

    if (firstBtn) firstBtn.addEventListener('click', () => goToPage(1));
    if (prevBtn) prevBtn.addEventListener('click', () => goToPage(currentCoveragePage - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToPage(currentCoveragePage + 1));
    
    if (lastBtn) {
        lastBtn.addEventListener('click', () => {
            const totalEl = document.getElementById('totalPages');
            if (totalEl) {
                goToPage(parseInt(totalEl.textContent, 10));
            }
        });
    }

    if (pageInput) {
        pageInput.addEventListener('change', () => {
            let val = parseInt(pageInput.value, 10);
            if (isNaN(val)) val = 1;
            goToPage(val);
        });
        pageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                let val = parseInt(pageInput.value, 10);
                if (isNaN(val)) val = 1;
                goToPage(val);
            }
        });
    }

    window.loadFaersData = loadFaersData;

    async function loadFaersData() {
        if (window.faersDataLoaded) return;
        if (typeof currentDrugName === 'undefined') return;

        // --- Improved Literal Generic Search Strategy ---
        // Prioritize Generic Name literally
        let drugSearchTerm = "";
        
        if (window.currentGenericName && window.currentGenericName !== "Unknown Generic") {
            drugSearchTerm = window.currentGenericName;
        } else {
            drugSearchTerm = window.currentDrugName;
        }
        
        // Final cleaning: remove everything after comma or semicolon
        drugSearchTerm = drugSearchTerm.split(/[,;]/)[0].trim();
        
        // Remove strengths and dosage forms (aggressive)
        drugSearchTerm = drugSearchTerm.replace(/\d+(\.\d+)?\s*(mg|mcg|g|ml|%|unit|iu)\b.*$/i, '').trim();
        drugSearchTerm = drugSearchTerm.replace(/\s+(tablet|capsule|injection|cream|ointment|gel|solution|suspension|spray|inhaler|powder).*$/i, '').trim();

        const fetchLimit = 1000; 
        const encodedName = encodeURIComponent(drugSearchTerm);
        
        // Show loading, hide content
        const loadingEl = document.getElementById('faers-loading');
        const contentEl = document.getElementById('dashboard-content');
        if (loadingEl) loadingEl.style.display = 'block';
        if (contentEl) contentEl.style.display = 'none';

        try {
            const response = await fetch(`/api/dashboard/faers/${encodedName}?limit=${fetchLimit}`);
            const data = await response.json();
            
            if (data.error) throw new Error(data.error);

            if (loadingEl) loadingEl.style.display = 'none';
            if (contentEl) contentEl.style.display = 'grid';
            
            currentFaersData = data;
            window.faersDataLoaded = true;
            
            filterAndRenderCharts();
            // tagSafetySignals(data); // Removed tagging signals on label view per requirements
        } catch (error) {
            console.error('Error fetching FAERS data:', error);
            const loadingEl = document.getElementById('faers-loading');
            if (loadingEl) {
                loadingEl.style.display = 'block';
                loadingEl.className = ''; // Remove loader class
                loadingEl.innerHTML = `
                <div style="padding: 20px; max-width: 800px; margin: 0 auto;">
                    <p style="color:#dc3545; padding: 20px; text-align:center; background:#fff5f5; border-radius:8px; border:1px solid #feb2b2; margin: 0;">
                        <strong>FAERS Data Unavailable:</strong> The openFDA API is currently not available under the current internet environment. This is a connectivity issue, not a system error.<br>
                        <small style="opacity:0.7">Attempted search for: "${drugSearchTerm}"</small>
                    </p>
                </div>`;
            }
        }
    }

    function filterAndRenderCharts() {
        if (!currentFaersData) return;

        currentCoveragePage = 1; // Reset pagination
        renderCoverageTable();
        updateTrendComparisonChart(); // Initialize chart
    }

    // Filter Event Listener
    const aeFilterInput = document.getElementById('ae-table-filter');
    if (aeFilterInput) {
        aeFilterInput.addEventListener('input', () => {
            currentCoveragePage = 1; // Reset to first page on filter
            renderCoverageTable();
        });
    }

    function renderSocSummaryBar(reactions) {
        const bar = document.getElementById('soc-summary-bar');
        if (!bar) return;

        // Exclusions requested
        const EXCLUDED = new Set(['SOC', 'PRD', 'SMP']);

        // Count UNIQUE TERMS per SOC abbrev
        const map = new Map(); // abbrev -> Set(terms)
        (reactions || []).forEach(r => {
            const abbr = (r.soc_abbrev || '').trim();
            const term = (r.term || '').trim();
            if (!abbr || !term) return;
            if (EXCLUDED.has(abbr)) return;

            if (!map.has(abbr)) map.set(abbr, new Set());
            map.get(abbr).add(term.toLowerCase());
        });

        const items = Array.from(map.entries())
            .map(([abbr, set]) => ({ abbr, n: set.size }))
            .sort((a, b) => b.n - a.n);

        // Total unique terms across all included SOC abbrevs
        const allSet = new Set();
        items.forEach(x => {
            const s = map.get(x.abbr);
            if (s) s.forEach(t => allSet.add(t));
        });

        const active = window.faersSocFilter || 'ALL';

        const btnHtml = (abbr, n, isAll=false) => {
            const isActive = active === abbr || (isAll && active === 'ALL');
            return `
            <button
                type="button"
                class="soc-chip ${isActive ? 'active' : ''}"
                data-soc="${abbr}"
            >
                <span class="soc-chip-label">${abbr}</span>
                <span class="soc-chip-count">${n}</span>
            </button>
            `;
        };

        bar.innerHTML = `
            <div class="soc-chip-row">
            ${btnHtml('ALL', allSet.size, true)}
            ${items.map(x => btnHtml(x.abbr, x.n)).join('')}
            </div>
        `;

        // Bind click handlers
        bar.querySelectorAll('button.soc-chip').forEach(btn => {
            btn.addEventListener('click', () => {
            const soc = btn.getAttribute('data-soc') || 'ALL';
            window.faersSocFilter = soc;
            currentCoveragePage = 1;
            renderCoverageTable();
            });
        });
        }



    function renderCoverageTable() {
        if (!currentFaersData || !currentFaersData.reactions) return;

        const filterText = aeFilterInput ? aeFilterInput.value.toLowerCase().trim() : '';
        const labelText = getCleanLabelText();
        
        // 1) Build derived fields we need for filtering
        const reactionsWithStatus = currentFaersData.reactions.map(item => {
        const termLower = (item.term || '').toLowerCase();
        const isFound = labelText.includes(termLower);

        // Match your existing status wording conventions
        // Base status used in the Status cell (before AI augmentation)
        let statusText = isFound ? 'found' : 'not in label';

        // Respect cached AI augmentation the same way your UI does
        if (!isFound) {
            const cacheKey = `ai_coverage_${currentSetId}_${termLower}`;
            const cached = localStorage.getItem(cacheKey);
            if (cached) {
            try {
                const aiData = JSON.parse(cached);
                const match = (aiData.match || '').toLowerCase();
                if (match === 'yes') statusText = 'yes (ai)';
                else if (match === 'probably') statusText = 'probable (ai)';
            } catch (e) {}
            }
        }

        return { ...item, __statusText: statusText, __isFound: isFound };
        });

        // 2) Text filter (term/soc/hlt)
        let filteredReactions = reactionsWithStatus.filter(item => {
            if (!filterText) return true;

            const term = (item.term || '').toLowerCase();
            const soc  = (item.soc || '').toLowerCase();
            const hlt  = (item.hlt || '').toLowerCase();

            return term.includes(filterText) || soc.includes(filterText) || hlt.includes(filterText);
        });

        // 2.5) AE-only SOC filter (ABBREV-based)
        filteredReactions = filteredReactions.filter(isAeSoc);

        // 3) Toggle filter (All vs Not Presented) 
        if (window.faersCoverageFilter === 'not_presented') {
            filteredReactions = filteredReactions.filter(item =>
                // "Not Presented" should mean NOT in label, and also not positively AI-matched
                isNotPresentedStatusText(item.__statusText)
            );
        }

        // 3.5) SOC filter (by abbrev) 
        const socFilter = (window.faersSocFilter || 'ALL');
            if (socFilter !== 'ALL') {
            filteredReactions = filteredReactions.filter(item => {
                const abbrev = (item.soc_abbrev || '').trim() || 'UNK';
                return abbrev === socFilter;
            });
        }

        // Update Count Display
        const countDisplay = document.getElementById('ae-filter-count');
        if (countDisplay) {
            countDisplay.textContent = `(${filteredReactions.length} items)`;
        }

        // 2. Pagination
        const totalItems = filteredReactions.length;
        const maxPage = Math.ceil(totalItems / itemsPerPage);
        
        // Adjust current page if out of bounds
        if (currentCoveragePage > maxPage && maxPage > 0) currentCoveragePage = maxPage;
        if (currentCoveragePage < 1) currentCoveragePage = 1;

        const startIndex = (currentCoveragePage - 1) * itemsPerPage;
        const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
        const pageData = filteredReactions.slice(startIndex, endIndex);

        const coverageBody = document.querySelector('#coverageTable tbody');

        if (!coverageBody) return;

        coverageBody.innerHTML = '';

        if (filteredReactions.length === 0) {
            coverageBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px;">No matching reactions found.</td></tr>';
        }

        pageData.forEach(item => {
            const term = (item.term || '').toLowerCase();
            const isFound = !!item.__isFound;
            
            const row = document.createElement('tr');
            let statusHtml = `
                <span class="status-badge ${isFound ? 'found' : 'not-found'}">
                    ${isFound ? '✓ Found' : '✗ Not'}
                </span>
            `;

            let actionHtml = '';
            if (!isFound) {
                // Check Cache for AI result
                const cacheKey = `ai_coverage_${currentSetId}_${term}`;
                const cachedResult = localStorage.getItem(cacheKey);
                
                if (cachedResult) {
                    try {
                        const aiData = JSON.parse(cachedResult);
                        const matchStatus = (aiData.match || "").toLowerCase();
                        
                        // Construct tooltip data
                        const tooltipData = encodeURIComponent(JSON.stringify(aiData));
                        
                        let iconSymbol = '✓';
                        let iconClass = 'ai-answer-icon';
                        
                        if (matchStatus === 'yes' || matchStatus === 'probably') {
                            iconClass += ' match';
                        } else {
                            iconClass += ' no-match';
                            iconSymbol = '✕';
                        }
                        
                        actionHtml = `<span class="${iconClass}" data-ai-content="${tooltipData}" style="cursor: pointer;">${iconSymbol}</span>`;

                        // Update status badge if positive match
                        if (matchStatus === 'yes') {
                            statusHtml = `
                                <span class="status-badge ai-found-yes">
                                    &#10024; Yes (AI)
                                </span>
                            `;
                        } else if (matchStatus === 'probably') {
                            statusHtml = `
                                <span class="status-badge ai-found-probable">
                                    &#10024; Probable (AI)
                                </span>
                            `;
                        }
                    } catch (e) {
                        console.error("Error reading cache for render", e);
                        // Fallback to ? if corrupt
                        actionHtml = `<span class="ask-ai-btn" title="Ask AI if this is mentioned in the labeling" onclick="window.askAiAboutReaction('${item.term.replace(/'/g, "\'")}', this)">?</span>`;
                    }
                } else {
                    // No cache, show "?" Ask AI button
                    actionHtml = `<span class="ask-ai-btn" title="Ask AI if this is mentioned in the labeling" onclick="window.askAiAboutReaction('${item.term.replace(/'/g, "\'")}', this)">?</span>`;
                }
            }

            const isChecked = window.selectedTerms.has(item.term);
            const isDisabled = !isChecked && window.selectedTerms.size >= MAX_SELECTED_TERMS;

            row.innerHTML = `
                <td style="text-align: center;">
                    <input type="checkbox" class="ae-checkbox" 
                           value="${item.term}" 
                           ${isChecked ? 'checked' : ''} 
                           ${isDisabled ? 'disabled' : ''}
                           onchange="window.toggleTermSelection('${item.term.replace(/'/g, "\'")}', this)">
                </td>
                <td>${item.term} ${actionHtml}</td>
                <td>${item.count.toLocaleString()}</td>
                <td>${item.soc || 'N/A'}${item.soc_abbrev ? ' (' + item.soc_abbrev + ')' : ''}</td>
                <td>${item.hlt || 'N/A'}</td>
                <td class="status-cell">${statusHtml}</td>
            `;
            coverageBody.appendChild(row);
        });

        renderSocSummaryBar(filteredReactions);

        // Bind custom tooltips (defined in results logic, check ui.js or similar? No, tooltips were in script.js)
        // Note: bindAiTooltips needs to be available. We will implement it here or in a shared module.
        // It was in script.js, let's include it here.
        bindAiTooltips();

        // Update pagination UI
        const totalPagesEl = document.getElementById('totalPages');
        const pageInputEl = document.getElementById('pageInput');
        
        if (totalPagesEl) totalPagesEl.textContent = maxPage || 1;
        if (pageInputEl) {
            pageInputEl.value = currentCoveragePage;
            pageInputEl.max = maxPage || 1;
        }

        if (firstBtn) firstBtn.disabled = currentCoveragePage <= 1;
        if (prevBtn) prevBtn.disabled = currentCoveragePage <= 1;
        if (nextBtn) nextBtn.disabled = currentCoveragePage >= maxPage;
        if (lastBtn) lastBtn.disabled = currentCoveragePage >= maxPage;
    }

    // Expose to global scope for onclick attributes
    window.askAiAboutReaction = async function(term, iconEl) {
        if (iconEl.classList.contains('loading')) return;

        // Check Local Storage Cache first
        const cacheKey = `ai_coverage_${currentSetId}_${term.toLowerCase()}`;
        const cachedResult = localStorage.getItem(cacheKey);

        if (cachedResult) {
            try {
                const aiData = JSON.parse(cachedResult);
                updateUiWithAiResult(aiData, iconEl, term);
                return; // Skip API call
            } catch (e) {
                console.error("Cache parse error", e);
                localStorage.removeItem(cacheKey);
            }
        }

        // Visual loading state
        const originalContent = iconEl.innerHTML;
        iconEl.innerHTML = '<i class="fa fa-spinner fa-spin" style="font-size: 10px;"></i>';
        iconEl.classList.add('loading');
        iconEl.style.cursor = 'wait';

        const question = `
        You are reviewing an FDA drug labeling document (structured XML) to determine whether the adverse event "${term}" is addressed.

        Goal:
        - The exact phrase "${term}" was NOT found via literal string match. Now you MUST search for semantically similar, clinically equivalent, or commonly related labeling language.

        Instructions (be strict):
        1) Search for direct mentions and close variants of "${term}" (spelling variants, plural/singular, hyphenation, abbreviations).
        2) Search for medical synonyms and near-synonyms (e.g., clinical/lay terms, MedDRA-style variants).
        3) Search for conceptually related label language that indicates the same event or a clearly overlapping clinical concept, including:
        - Signs/symptoms, diagnoses, syndromes
        - Lab abnormalities or clinical findings that imply the event
        - Organ-system injury terms (e.g., hepatic injury, transaminase elevations, jaundice)
        - Common complication terms or umbrella terms used in labeling (e.g., hypersensitivity, anaphylaxis, bleeding)
        4) If found, prefer the MOST specific and relevant match (not generic “adverse reactions occurred” boilerplate).
        5) Only use evidence from the labeling text provided in xml_content.

        Decision rules:
        - "Yes": The labeling explicitly mentions "${term}" OR an unambiguous clinical synonym (same diagnosis/event).
        - "Probably": The labeling does not name "${term}" directly, but contains strong semantically related language that reasonably indicates the same event or a closely overlapping concept (include the best supporting quote).
        - "No": No relevant or semantically related mention is found.

        Output requirements (VERY IMPORTANT):
        - Return ONLY one raw JSON object and nothing else.
        - JSON schema (exact keys):
        {
            "match": "Yes" | "Probably" | "No",
            "matched_terms": string[] ,
            "citation": string | null,
            "quote": string | null
        }

        Field rules:
        - matched_terms: include 1–6 exact phrases you found in the label that support your decision (empty array if "No").
        - citation: the section name/number (e.g., "5 WARNINGS AND PRECAUTIONS" or "6.1") if applicable, else null.
        - quote: the shortest exact quote from the label that best supports the match (must be verbatim), else null.
        - If match is "No": citation MUST be null, quote MUST be null, matched_terms MUST be [].
        `.trim();
        
        // Add to chat history visually (optional, but good for context)
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            const userMessage = document.createElement('div');
            userMessage.classList.add('message', 'message-user');
            userMessage.innerHTML = `<div class="message-content"><p>Checking labeling for coverage of: <strong>${term}</strong></p></div>`;
            chatMessages.appendChild(userMessage);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        try {
            const xmlContentDiv = document.getElementById('xml-content');
            const xmlContent = xmlContentDiv ? xmlContentDiv.textContent : '';

            // Access chatHistory if global
            const historyToSend = [];

            const response = await fetch('/api/dashboard/ai_chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: question,
                    history: historyToSend, 
                    xml_content: xmlContent,
                    chat_type: 'TERM_VERIFY'
                }),
            });
            const data = await response.json();
            let answerText = data.response || "{}";
            
            // console.log(answerText);
            // Robust JSON extraction helper
            const extractJson = (text) => {
                // Try markdown block first
                const match = text.match(/```json\s*([\s\S]*?)\s*```/);
                if (match) return match[1].trim();
                
                // Try finding first { and last }
                const start = text.indexOf('{');
                const end = text.lastIndexOf('}');
                if (start !== -1 && end !== -1 && end > start) {
                    return text.substring(start, end + 1).trim();
                }
                return text.trim();
            };

            const jsonToParse = extractJson(answerText);
            let aiData = {};
            try {
                aiData = JSON.parse(jsonToParse);
                // Cache the successful result
                if (aiData.match) {
                    localStorage.setItem(cacheKey, JSON.stringify(aiData));
                }
            } catch (e) {
                console.error("Failed to parse AI JSON. Raw text:", answerText, "Extracted:", jsonToParse);
                aiData = { match: "Error", quote: "Could not parse response." };
            }

            // --- Auto-Save "Yes" Matches as Notes ---
            if ((aiData.match === "Yes" || aiData.match === "Probably") && aiData.citation) {
                const sectionNum = findSectionFromCitation(aiData.citation);
                
                // Only save if user is logged in and section found
                if (sectionNum && typeof currentUserId !== 'undefined' && currentUserId) {
                    const noteQuestion = `Is "${term}" mentioned in the label?`;
                    const noteAnswer = `> "${aiData.quote}"`;
                    const matchTag = aiData.match === 'Yes' ? 'match:yes' : 'match:probable';
                    
                    // Auto-save to DB
                    fetch('/api/dashboard/save_annotation', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            set_id: currentSetId,
                            section_number: sectionNum,
                            question: noteQuestion,
                            answer: noteAnswer,
                            keywords: [term, matchTag],
                            is_public: true 
                        })
                    })
                    .then(r => {
                        if (!r.ok) throw new Error("Network response was not ok");
                        return r.json();
                    })
                    .then(saveData => {
                        if (saveData.success && window.createAnnotationBadge) {
                            window.createAnnotationBadge(
                                noteQuestion, 
                                noteAnswer, 
                                sectionNum, 
                                [term, matchTag], 
                                saveData.id, 
                                true // isSaved
                            );
                        }
                    })
                    .catch(err => console.error("Auto-save failed (likely auth or network)", err));
                }
            }

            // Construct readable output for chat
            let readableOutput = "";
            if (aiData.match === "Yes" || aiData.match === "Probably") {
                readableOutput = `**AI Found Match:** ${aiData.match}\n\n> "${aiData.quote}"\n\n*Section: ${aiData.citation}*`;
            } else {
                readableOutput = `**AI Analysis:** Not found in labeling.`;
            }

            // Add AI response to chat window
            if (chatMessages) {
                const aiMessage = document.createElement('div');
                aiMessage.classList.add('message', 'message-ai');
                
                let contentHtml = readableOutput;
                if (typeof marked !== 'undefined' && marked.parse) {
                    contentHtml = marked.parse(readableOutput);
                } else {
                    // Fallback: simple newline to break replacement
                    contentHtml = readableOutput.replace(/\n/g, '<br>');
                }

                aiMessage.innerHTML = `<div class="message-content">${contentHtml}</div>`;
                chatMessages.appendChild(aiMessage);
                chatMessages.scrollTop = chatMessages.scrollHeight;
                
                // Update history
                if (window.chatHistory) {
                    window.chatHistory.push({ role: 'user', content: question });
                    window.chatHistory.push({ role: 'model', content: answerText });
                }
            }

            updateUiWithAiResult(aiData, iconEl, term);

        } catch (err) {
            console.error(err);
            iconEl.innerHTML = originalContent; // Revert on error
            iconEl.classList.remove('loading');
            alert("Failed to ask AI.");
        }
    };

    function updateUiWithAiResult(aiData, iconEl, term) {
        // Determine Symbol and Style based on result
        const matchStatus = (aiData.match || "").toLowerCase();
        const isMatch = matchStatus === 'yes' || matchStatus === 'probably';
        
        // Update the Icon
        iconEl.className = 'ai-answer-icon' + (isMatch ? ' match' : ' no-match');
        iconEl.innerHTML = isMatch ? '✓' : '✕';
        iconEl.style.cursor = 'pointer';
        iconEl.classList.remove('loading'); 
        
        // Remove any manual inline overrides from previous versions
        iconEl.style.backgroundColor = '';
        iconEl.style.borderColor = '';
        
        // Store Data
        iconEl.setAttribute('data-ai-content', encodeURIComponent(JSON.stringify(aiData)));
        iconEl.removeAttribute('title'); // Remove native tooltip
        
        iconEl.onclick = null; // Remove click handler
        
        // Bind Custom Tooltip Events
        bindAiTooltipEvents(iconEl);

        // Check if Positive for Status Badge
        if (isMatch) {
            // Find the status badge in this row
            const row = iconEl.closest('tr');
            if (row) {
                const badge = row.querySelector('.status-badge');
                if (badge) {
                    if (matchStatus === 'yes') {
                        badge.className = 'status-badge ai-found-yes';
                        badge.innerHTML = `&#10024; Yes (AI)`;
                    } else {
                        badge.className = 'status-badge ai-found-probable';
                        badge.innerHTML = `&#10024; Probable (AI)`;
                    }
                }
            }
        }
    }

    function tagSafetySignals(data) {
        // Disabled per requirements: FAERS data should not affect label highlights
        return;
    }

    function highlightSafetyTerms(root, termsMap) {
        const terms = Object.keys(termsMap).sort((a, b) => b.length - a.length);
        if (terms.length === 0) return;

        // 1. Scan for highlights (only base MedDRA terms now)
        const pattern = new RegExp(`\\b(${terms.map(window.escapeRegExp).join('|')})\\b`, 'gi');
        
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
        const nodes = [];
        while(walker.nextNode()) nodes.push(walker.currentNode);

        nodes.forEach(node => {
            if (['SCRIPT', 'STYLE', 'TEXTAREA', 'BUTTON'].includes(node.parentNode.tagName)) return;
            if (node.parentNode.classList.contains('faers-signal') || 
                node.parentNode.classList.contains('meddra-term-base')) return;

            const text = node.nodeValue;
            if (!pattern.test(text)) return;

            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            pattern.lastIndex = 0;
            
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const matchedText = match[0];
                const lowerTerm = matchedText.toLowerCase();
                const details = termsMap[lowerTerm];
                
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
                }

                const span = document.createElement('span');
                span.textContent = matchedText;
                
                if (details) {
                    // Store Metadata for delegated click handler
                    span.setAttribute('data-term', details.term);
                    const soc = details.soc_abbrev || details.soc || 'Unknown';
                    span.setAttribute('data-soc', soc);
                    
                    // Always use base MedDRA style (Blue Dashed via CSS)
                    span.className = 'meddra-term-base';
                    // NO tooltip (title attribute) per user request
                }
                
                fragment.appendChild(span);
                lastIndex = pattern.lastIndex;
            }

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }

            node.parentNode.replaceChild(fragment, node);
        });
    }

    // Global Tooltip Manager for FAERS (AI Evidence)
    const TooltipManager = {
        create: function(icon) {
            if (icon._tooltipEl) return icon._tooltipEl;

            const dataStr = icon.getAttribute('data-ai-content');
            if (!dataStr) return null;

            let aiData;
            try {
                aiData = JSON.parse(decodeURIComponent(dataStr));
            } catch(e) { console.error("Tooltip parse error", e); return null; }

            const tooltip = document.createElement('div');
            tooltip.className = 'ai-evidence-tooltip';
            
            let content = `<strong>Match: ${aiData.match}</strong>`;
            if (aiData.quote) content += `<div>"${aiData.quote}"</div>`;
            if (aiData.citation) content += `<div class="citation">Source: ${aiData.citation}</div>`;
            
            tooltip.innerHTML = content;
            document.body.appendChild(tooltip);
            
            icon._tooltipEl = tooltip;
            return tooltip;
        },

        show: function(icon, isSticky = false) {
            let tooltip = icon._tooltipEl;
            if (!tooltip) {
                tooltip = this.create(icon);
                if (!tooltip) return;
            }

            if (isSticky) {
                tooltip.classList.add('sticky');
                icon.classList.add('sticky');
            }

            this.position(icon, tooltip);
            
            // Activate
            void tooltip.offsetWidth; // Force reflow
            tooltip.classList.add('show');
        },

        hide: function(icon) {
            if (icon._tooltipEl) {
                const el = icon._tooltipEl;
                el.classList.remove('show');
                el.classList.remove('sticky');
                icon.classList.remove('sticky');
                // Remove from DOM after transition
                setTimeout(() => {
                    if (el.parentNode && !el.classList.contains('show')) {
                        el.parentNode.removeChild(el);
                        icon._tooltipEl = null;
                    }
                }, 200);
            }
        },

        position: function(icon, tooltip) {
            const rect = icon.getBoundingClientRect();
            
            // Ensure tooltip is visible for measurement
            tooltip.style.display = 'block';
            const tWidth = tooltip.offsetWidth || 320;
            const tHeight = tooltip.offsetHeight || 100;
            const gap = 15; 

            // Default: Top-Right relative to icon
            let top = rect.top - tHeight - gap; 
            let left = rect.right + 5;

            if (left + tWidth > window.innerWidth - 10) {
                left = rect.left - tWidth - 5;
            }

            if (top < 10) {
                top = rect.bottom + gap;
            }

            if (left < 10) left = 10; 

            tooltip.style.top = `${top}px`;
            tooltip.style.left = `${left}px`;
        },

        toggleSticky: function(icon) {
            if (icon.classList.contains('sticky')) {
                // Close
                this.hide(icon);
            } else {
                // Open as sticky
                this.show(icon, true);
            }
        }
    };

    function bindAiTooltips() {
        const icons = document.querySelectorAll('.ai-answer-icon');
        icons.forEach(bindAiTooltipEvents);
    }

    function bindAiTooltipEvents(icon) {
        if (icon._bound) return;
        icon._bound = true;

        icon.addEventListener('mouseenter', () => {
            if (!icon.classList.contains('sticky')) {
                TooltipManager.show(icon, false);
            }
        });

        icon.addEventListener('mouseleave', () => {
            if (!icon.classList.contains('sticky')) {
                TooltipManager.hide(icon);
            }
        });

        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            TooltipManager.toggleSticky(icon);
        });
    }

    // --- Trend Comparison Logic ---
    window.toggleTermSelection = function(term, checkbox) {
        if (checkbox.checked) {
            if (window.selectedTerms.size >= MAX_SELECTED_TERMS) {
                checkbox.checked = false;
                alert(`You can only compare up to ${MAX_SELECTED_TERMS} adverse events at a time.`);
                return;
            }
            window.selectedTerms.add(term);
        } else {
            window.selectedTerms.delete(term);
        }
        
        updateCheckboxStates();
        updateTrendComparisonChart();
    };

    function updateCheckboxStates() {
        const checkboxes = document.querySelectorAll('.ae-checkbox');
        const isMaxReached = window.selectedTerms.size >= MAX_SELECTED_TERMS;
        
        checkboxes.forEach(cb => {
            if (!cb.checked) {
                cb.disabled = isMaxReached;
                cb.parentElement.classList.toggle('disabled', isMaxReached);
            } else {
                cb.disabled = false;
                cb.parentElement.classList.remove('disabled');
            }
        });
    }

    async function updateTrendComparisonChart() {
        const termsToDisplay = Array.from(window.selectedTerms);
        const canvas = document.getElementById('trendComparisonChart');
        if (!canvas) return;

        if (typeof Chart === 'undefined') {
            console.error("chart.js is not loaded.");
            const container = canvas.parentElement;
            if (container) {
                container.innerHTML = '<p style="color: #721c24; background: #f8d7da; padding: 10px; border-radius: 4px;">Error: Chart library could not be loaded. Please check your internet connection.</p>';
            }
            return;
        }

        // 1. Identify terms we need to fetch
        const missingTerms = termsToDisplay.filter(t => !window.trendCache[t]);
        
        if (missingTerms.length > 0) {
            try {
                const response = await fetch('/api/dashboard/faers/trends', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        drug_name: currentDrugName,
                        terms: missingTerms
                    })
                });
                const data = await response.json();
                if (data.trends) {
                    // Merge into cache
                    Object.assign(window.trendCache, data.trends);
                }
            } catch (e) {
                console.error("Error fetching trends", e);
            }
        }

        // 2. Prepare Datasets for chart.js
        const datasets = [];
        const allDates = new Set();
        
        const colors = [
            '#007bff', '#6610f2', '#6f42c1', '#e83e8c', '#dc3545',
            '#fd7e14', '#ffc107', '#28a745', '#20c997', '#17a2b8'
        ];

        termsToDisplay.forEach((term, index) => {
            const dataPoints = window.trendCache[term] || [];
            
            // Aggregate by YYYY-MM
            const monthlyCounts = {};
            dataPoints.forEach(pt => {
                const monthKey = pt.time.substring(0, 6); // YYYYMM
                monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + pt.count;
            });
            
            Object.keys(monthlyCounts).forEach(d => allDates.add(d));
            
            datasets.push({
                label: term,
                dataRaw: monthlyCounts, 
                borderColor: colors[index % colors.length],
                backgroundColor: 'transparent',
                borderWidth: 2,
                tension: 0.3,
                pointRadius: 3
            });
        });

        // 3. Sort Dates and Align Data
        const sortedDates = Array.from(allDates).sort();
        
        datasets.forEach(ds => {
            let cumulativeSum = 0;
            ds.data = sortedDates.map(date => {
                const count = ds.dataRaw[date] || 0;
                cumulativeSum += count;
                return cumulativeSum;
            });
            delete ds.dataRaw; 
        });

        // 4. Render Chart
        if (typeof Chart !== 'undefined' && canvas) {
            const existingChart = Chart.getChart(canvas);
            if (existingChart) {
                existingChart.destroy();
            }
        }

        // If no terms selected, show artistic placeholder
        if (termsToDisplay.length === 0) {
            const ctx = canvas.getContext('2d');
            
            const ghostPoints = 50;
            const ghostLabels = Array.from({length: ghostPoints}, (_, i) => i);
            
            const createWave = (phase, amplitude, frequency, color) => {
                return {
                    label: 'Placeholder',
                    data: ghostLabels.map(x => Math.sin(x * frequency + phase) * amplitude + 50),
                    borderColor: color,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    tension: 0.5,
                    pointRadius: 0,
                    fill: false
                };
            };

            const artisticDatasets = [
                createWave(0, 30, 0.1, 'rgba(200, 200, 200, 0.2)'),
                createWave(2, 25, 0.15, 'rgba(180, 180, 180, 0.15)'),
                createWave(4, 35, 0.08, 'rgba(220, 220, 220, 0.1)')
            ];

            chartInstances['trendComparison'] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: ghostLabels.map(() => ''), 
                    datasets: artisticDatasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { enabled: false },
                        title: {
                            display: true,
                            text: 'Select reactions above to visualize trends',
                            color: '#999',
                            font: { size: 16, style: 'italic', weight: 'normal' },
                            padding: 20
                        }
                    },
                    scales: {
                        x: { display: false },
                        y: { display: false, min: 0, max: 100 }
                    },
                    animation: {
                        duration: 3000,
                        easing: 'easeInOutQuart'
                    }
                }
            });
            return; 
        }

        const ctx = canvas.getContext('2d');
        chartInstances['trendComparison'] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: sortedDates.map(d => `${d.substring(0,4)}-${d.substring(4,6)}`),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { boxWidth: 12, usePointStyle: true }
                    },
                    title: {
                        display: true,
                        text: 'Cumulative Reports (Last 5 Years)'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return `${context.dataset.label}: ${context.raw}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: 'Date (Year-Month)' }
                    },
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Cumulative Reports' }
                    }
                }
            }
        });
    }

    function findSectionFromCitation(citation) {
        if (!citation) return null;
        const normCitation = citation.toLowerCase().replace(/section\s*/, '').trim();
        
        // 1. Try to extract specific number (e.g. "6.1")
        const numberMatch = normCitation.match(/^(\d+(\.\d+)*)/);
        const searchNumber = numberMatch ? numberMatch[0] : null;

        const sections = document.querySelectorAll('.Section');
        for (let sec of sections) {
            const h2 = sec.querySelector('h2');
            if (!h2) continue;
            const title = h2.textContent.toLowerCase();
            
            // Check Number Match
            if (searchNumber && title.includes(searchNumber)) {
                return sec.getAttribute('data-section-number');
            }
            
            // Check Text Match
            if (title.includes(normCitation)) {
                return sec.getAttribute('data-section-number');
            }
        }
        
        return null; 
    }

    function getCleanLabelText() {
        const root = document.getElementById('label-view');
        if (!root) return '';
        
        let text = '';
        
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.nodeValue;
                return;
            }
            
            if (node.nodeType === Node.ELEMENT_NODE) {
                // Skip annotation badges and other UI overlays
                if (node.classList.contains('chat-annotation-badge') || 
                    node.classList.contains('selection-toolbar') ||
                    node.classList.contains('annotation-popover')) {
                    return;
                }
                
                for (let child of node.childNodes) {
                    walk(child);
                }
            }
        }
        
        walk(root);
        return text.toLowerCase();
    }

    function syncCachedAiResultsToDb() {
        if (typeof currentUserId === 'undefined' || !currentUserId) return;
        if (typeof currentSetId === 'undefined' || !currentSetId) return;

        // 1. Build set of existing normalized questions to avoid duplicates
        const existingQuestions = new Set();
        if (typeof savedAnnotations !== 'undefined' && Array.isArray(savedAnnotations)) {
            savedAnnotations.forEach(ann => {
                if (ann.question) existingQuestions.add(ann.question.toLowerCase());
            });
        }

        const prefix = `ai_coverage_${currentSetId}_`;
        
        // 2. Iterate LocalStorage
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith(prefix)) {
                // Extract term from key (it was lowercased when saved)
                const term = key.substring(prefix.length); 
                
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    
                    // 3. Check criteria: Match Yes, Has Citation, Not already saved
                    if ((data.match === 'Yes' || data.match === 'Probably') && data.citation) {
                        const question = `Is "${term}" mentioned in the label?`;
                        
                        if (!existingQuestions.has(question.toLowerCase())) {
                            const sectionNum = findSectionFromCitation(data.citation);
                            
                            if (sectionNum) {
                                const answer = `> "${data.quote}"`;
                                const matchTag = data.match === 'Yes' ? 'match:yes' : 'match:probable';
                                
                                // Prevent duplicate attempts in this session
                                existingQuestions.add(question.toLowerCase());
                                
                                // 4. Save to DB
                                fetch('/api/dashboard/save_annotation', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        set_id: currentSetId,
                                        section_number: sectionNum,
                                        question: question,
                                        answer: answer,
                                        keywords: [term, matchTag],
                                        is_public: true
                                    })
                                })
                                .then(r => {
                                    if (!r.ok) throw new Error("Sync failed");
                                    return r.json();
                                })
                                .then(res => {
                                    if (res.success && window.createAnnotationBadge) {
                                        console.log(`Synced annotation for ${term}`);
                                        window.createAnnotationBadge(
                                            question, 
                                            answer, 
                                            sectionNum, 
                                            [term, matchTag], 
                                            res.id, 
                                            true
                                        );
                                    }
                                })
                                .catch(e => console.error(`Failed to sync ${term}`, e));
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error parsing cache for sync", e);
                }
            }
        }
    }

    // Run sync on load
    setTimeout(syncCachedAiResultsToDb, 1000); 

    // --- Load All MedDRA Terms (Initial Scan) ---
    // Only auto-trigger if we don't have cached data yet
    if (typeof currentSetId !== 'undefined' && !window.meddraScanData) {
        loadMeddraScan(currentSetId);
    }

    window.loadMeddraScan = loadMeddraScan;

    async function loadMeddraScan(setId) {
        // --- Caching Logic ---
        if (window.meddraScanData) {
            console.log("Using cached MedDRA scan data from PV-profile.");
            const labelContainer = document.getElementById('label-view');
            if (labelContainer) {
                highlightSafetyTerms(labelContainer, window.meddraScanData);
            }
            return window.meddraScanData;
        }

        try {
            const response = await fetch(`/api/dashboard/pv_profile/${encodeURIComponent(setId)}`);
            if (!response.ok) return;
            const data = await response.json();
            
            // Only underline terms that have been verified in PV-Profile (not leftover ones)
            if (data && data.has_record && Array.isArray(data.items) && data.items.length > 0) {
                window.pvProfileData = data;
                const termsMap = {};
                
                data.items.forEach(item => {
                    const pt = item.meddra_pt;
                    const raw = item.term;
                    const soc = item.soc_name || 'Unknown';
                    const socAbbrev = item.soc_abbrev || '';
                    
                    if (pt && pt.length > 2) {
                        termsMap[pt.toLowerCase()] = {
                            count: item.occurrences ? item.occurrences.length : 1,
                            term: pt,
                            soc: soc,
                            soc_abbrev: socAbbrev,
                            severity_tier: item.severity_tier
                        };
                    }
                    if (raw && raw.length > 2 && raw.toLowerCase() !== pt.toLowerCase()) {
                        termsMap[raw.toLowerCase()] = {
                            count: item.occurrences ? item.occurrences.length : 1,
                            term: pt,
                            raw_term: raw,
                            soc: soc,
                            soc_abbrev: socAbbrev,
                            severity_tier: item.severity_tier
                        };
                    }
                });
                
                window.meddraScanData = termsMap; 

                const labelContainer = document.getElementById('label-view');
                if (labelContainer) {
                    highlightSafetyTerms(labelContainer, termsMap);
                }
                return termsMap;
            } else {
                window.pvProfileData = data;
                window.meddraScanData = null;
            }
        } catch (e) {
            console.error("Error scanning MedDRA terms from PV-Profile:", e);
        }
    }

    // --- MedDRA SOC Highlighting Logic (Delegated) ---
    document.addEventListener('click', (e) => {
        const target = e.target;
        
        // 1. Check if we clicked a MedDRA term
        if (target && target.classList && target.classList.contains('meddra-term-base')) {
            e.stopPropagation();
            
            const targetSoc = target.getAttribute('data-soc');
            const allMeddra = document.querySelectorAll('.meddra-term-base');
            
            // Toggle behavior: if this one is already highlighted as part of a SOC group, clear all
            const wasHighlighted = target.classList.contains('meddra-soc-highlight');
            
            // Always clear first
            allMeddra.forEach(el => el.classList.remove('meddra-soc-highlight'));
            
            // If it wasn't highlighted, and we have a valid SOC, highlight the group
            if (!wasHighlighted && targetSoc && targetSoc !== 'Unknown') {
                console.log(`Highlighting MedDRA SOC group: ${targetSoc}`);
                allMeddra.forEach(el => {
                    if (el.getAttribute('data-soc') === targetSoc) {
                        el.classList.add('meddra-soc-highlight');
                    }
                });
            }
            return;
        }

        // 2. Clicked outside: Clear all MedDRA SOC highlights
        const activeHighlights = document.querySelectorAll('.meddra-soc-highlight');
        if (activeHighlights.length > 0) {
            activeHighlights.forEach(el => el.classList.remove('meddra-soc-highlight'));
        }
    });

    window.loadMeddraStatistics = function() {
        const modalBody = document.getElementById('meddra-stats-body');
        const exportBtn = document.getElementById('export-meddra-json');
        
        if (exportBtn) {
            // Remove old listener to avoid duplicates
            const newBtn = exportBtn.cloneNode(true);
            exportBtn.parentNode.replaceChild(newBtn, exportBtn);
            newBtn.addEventListener('click', exportMeddraStats);
        }

        if (!modalBody) return;

        const pvData = window.pvProfileData;
        if (!pvData || !pvData.has_record || !Array.isArray(pvData.items) || pvData.items.length === 0) {
            modalBody.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #64748b;">
                    <p style="font-size: 1.1em; font-weight: 600; color: #0f172a; margin-bottom: 8px;">PV-Profile Not Generated Yet</p>
                    <p style="font-size: 0.875rem; max-width: 420px; margin: 0 auto 16px auto; line-height: 1.5;">
                        Please open the <strong>PV-Profile</strong> tool in the Toolbox tab to generate and verify Adverse Event statistics for this drug product.
                    </p>
                </div>
            `;
            return;
        }

        // 1. Gather Data (Consistent with verified PV-profile)
        const socCounts = {};
        const uniqueTerms = new Set();
        const socTermsMap = {}; // Map SOC -> Map Term -> Set of Sections

        pvData.items.forEach(item => {
            const pt = item.meddra_pt;
            const soc = item.soc_name || 'General disorders and administration site conditions';
            
            if (!uniqueTerms.has(pt.toLowerCase())) {
                uniqueTerms.add(pt.toLowerCase());
                socCounts[soc] = (socCounts[soc] || 0) + 1;
            }
            
            if (!socTermsMap[soc]) socTermsMap[soc] = {};
            if (!socTermsMap[soc][pt]) socTermsMap[soc][pt] = new Set();
            
            if (Array.isArray(item.occurrences) && item.occurrences.length > 0) {
                item.occurrences.forEach(occ => {
                    if (occ.section_title) socTermsMap[soc][pt].add(occ.section_title);
                });
            } else if (item.section_name) {
                socTermsMap[soc][pt].add(item.section_name);
            }
        });

        // 2. Prepare Chart Data
        const labels = Object.keys(socCounts).sort((a, b) => socCounts[b] - socCounts[a]); // Sort desc
        const data = labels.map(l => socCounts[l]);

        // Generate Colors
        const colors = labels.map((_, i) => `hsl(${i * 360 / labels.length}, 70%, 60%)`);
        const borderColors = labels.map((_, i) => `hsl(${i * 360 / labels.length}, 70%, 40%)`);

        // 3. Render
        modalBody.innerHTML = `
            <div style="height: 320px; width: 100%;">
                <canvas id="meddraStatsChart"></canvas>
            </div>
            <div id="meddra-drilldown-container" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; display: none;">
                <h4 id="drilldown-title" style="margin-top: 0; color: #6f42c1;"></h4>
                <div id="meddra-drilldown-list" style="display: flex; flex-direction: column; gap: 8px;"></div>
            </div>
        `;
        
        if (typeof Chart === 'undefined') {
            modalBody.innerHTML = '<p style="color: red; padding: 20px;">Error: chart.js library not loaded.</p>';
            return;
        }

        const ctx = document.getElementById('meddraStatsChart').getContext('2d');

        if (typeof Chart !== 'undefined') {
            const existingChart = Chart.getChart(document.getElementById('meddraStatsChart'));
            if (existingChart) {
                existingChart.destroy();
            }
        }

        const chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Adverse Events',
                    data: data,
                    backgroundColor: colors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                indexAxis: 'x', 
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: `Verified Adverse Events: ${uniqueTerms.size} signals across ${labels.length} Organ Systems`
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return context[0].label; // Show SOC name in tooltip
                            }
                        }
                    }
                },
                scales: {
                    y: { beginAtZero: true },
                    x: { 
                        display: true,
                        ticks: {
                            maxRotation: 90,
                            minRotation: 90,
                            autoSkip: false,
                            font: {
                                size: 10
                            }
                        }
                    }
                },
                onClick: (e) => {
                    const points = chart.getElementsAtEventForMode(e, 'nearest', { intersect: true }, true);
                    if (points.length) {
                        const index = points[0].index;
                        const socName = labels[index];
                        showDrillDown(socName, socTermsMap[socName]);
                    }
                }
            }
        });
    };

    function showDrillDown(socName, termsObj) {
        const container = document.getElementById('meddra-drilldown-container');
        const title = document.getElementById('drilldown-title');
        const list = document.getElementById('meddra-drilldown-list');
        
        container.style.display = 'block';
        const sortedTerms = Object.keys(termsObj).sort();
        const termCount = sortedTerms.length;
        
        title.textContent = `${socName} (${termCount} terms)`;
        title.style.fontFamily = '"Segoe UI", Roboto, Helvetica, Arial, sans-serif';
        title.style.fontSize = '1.2em';
        title.style.borderBottom = '2px solid #6f42c1';
        title.style.paddingBottom = '8px';
        title.style.marginBottom = '15px';

        list.innerHTML = '';
        
        // Conditional Layout Threshold lowered to 5
        const isDense = termCount > 5;
        
        if (isDense) {
            list.style.flexDirection = 'row';
            list.style.flexWrap = 'wrap';
            list.style.gap = '10px';
        } else {
            list.style.flexDirection = 'column';
            list.style.flexWrap = 'nowrap';
            list.style.gap = '0';
        }
        
        sortedTerms.forEach(term => {
            const sections = Array.from(termsObj[term]).sort();
            const sectionText = sections.length > 0 ? ` (Found in Section: ${sections.join(', ')})` : '';
            
            // Capitalize
            const displayTerm = term.charAt(0).toUpperCase() + term.slice(1);
            
            const itemDiv = document.createElement('div');
            // Modern, clean font stack
            itemDiv.style.fontFamily = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';
            
            if (isDense) {
                // Badge Style
                itemDiv.style.background = '#ffffff';
                itemDiv.style.border = '1px solid #e0e6ed';
                itemDiv.style.borderRadius = '20px';
                itemDiv.style.padding = '6px 14px';
                itemDiv.style.fontSize = '1em'; // Larger base font
                itemDiv.style.boxShadow = '0 2px 4px rgba(0,0,0,0.04)';
                itemDiv.style.width = 'auto';
                itemDiv.innerHTML = `<strong style="color: #2c3e50;">${displayTerm}</strong><span style="color: #94a3b8; font-size: 0.8em; margin-left: 5px;">${sectionText}</span>`;
            } else {
                // List Style
                itemDiv.style.fontSize = '1.1em'; // Larger base font
                itemDiv.style.padding = '10px 0';
                itemDiv.style.borderBottom = '1px solid #f1f3f5';
                itemDiv.innerHTML = `<strong style="color: #2c3e50;">${displayTerm}</strong><span style="color: #94a3b8; font-size: 0.85em; margin-left: 8px;">${sectionText}</span>`;
            }
            
            // Add interactivity
            itemDiv.style.cursor = 'pointer';
            itemDiv.style.transition = 'all 0.2s';
            
            itemDiv.onmouseover = () => { itemDiv.style.borderColor = '#6f42c1'; itemDiv.style.backgroundColor = '#f3f0ff'; };
            itemDiv.onmouseout = () => { 
                itemDiv.style.borderColor = isDense ? '#e0e6ed' : 'transparent'; 
                itemDiv.style.borderBottom = isDense ? '1px solid #e0e6ed' : '1px solid #f1f3f5'; 
                itemDiv.style.backgroundColor = isDense ? '#ffffff' : 'transparent'; 
            };
            
            itemDiv.onclick = () => focusMeddraTerm(term);
            
            list.appendChild(itemDiv);
        });
        
        // Scroll to drilldown
        container.scrollIntoView({ behavior: 'smooth' });
    }

    // Global state for focused terms
    window.focusedMeddraTerms = new Set();

    function focusMeddraTerm(term) {
        const lowerTerm = term.toLowerCase();
        
        // Toggle selection (or just add, user said "added to a variable")
        // Let's clear others for single-select focus, or toggle for multi?
        // "Highlights this term" implies single focus usually, but "variable of array" suggests potential for multiple.
        // Let's do single focus for clarity, as requested "highlights THIS term".
        
        window.focusedMeddraTerms.clear();
        window.focusedMeddraTerms.add(lowerTerm);

        // Update DOM
        const allSignals = document.querySelectorAll('.meddra-term-base');
        let found = false;
        let firstMatch = null;

        allSignals.forEach(el => {
            const elTerm = (el.getAttribute('data-term') || el.textContent).trim().toLowerCase();
            
            if (window.focusedMeddraTerms.has(elTerm)) {
                el.classList.add('meddra-focus-highlight');
                found = true;
                if (!firstMatch) firstMatch = el;
            } else {
                el.classList.remove('meddra-focus-highlight');
            }
        });
        
        if (found && firstMatch) {
            // Close modal first
            const modal = document.getElementById('meddra-stats-modal');
            if (modal) modal.style.display = 'none';

            // 3. Scroll to first match with a tiny delay to ensure layout
            setTimeout(() => {
                firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 50);
        } else {
            console.warn(`Term "${term}" not found in DOM with data-term matching "${lowerTerm}"`);
            // Fallback: try content match
             allSignals.forEach(el => {
                if (el.textContent.toLowerCase() === lowerTerm) {
                    el.classList.add('meddra-focus-highlight');
                    if (!firstMatch) firstMatch = el;
                }
            });
            if (firstMatch) {
                 // Close modal first
                 const modal = document.getElementById('meddra-stats-modal');
                 if (modal) modal.style.display = 'none';

                 setTimeout(() => {
                    firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
                 }, 50);
            } else {
                alert(`Could not find "${term}" in the visible text.`);
            }
        }
    }

    function exportMeddraStats() {
        const signals = document.querySelectorAll('.meddra-term-base');
        const termsList = [];
        
        signals.forEach(el => {
            // Find Section
            let sectionName = "Unknown Section";
            const sectionDiv = el.closest('.Section');
            if (sectionDiv) {
                // Try to find header
                const header = sectionDiv.querySelector('h1, h2, h3, h4');
                if (header) sectionName = header.textContent.trim();
                else sectionName = sectionDiv.getAttribute('data-section-number') || "Unknown Section";
            }

            const term = el.getAttribute('data-term') || el.textContent;
            const soc = el.getAttribute('data-soc') || 'Unknown';
            
            // Check for duplicates in list? Or keep all occurrences?
            // "organized by section title" implies list of occurrences
            termsList.push({
                term: term,
                soc: soc,
                section: sectionName
            });
        });

        const exportData = {
            metadata: {
                brand_name: typeof currentDrugName !== 'undefined' ? currentDrugName : 'Unknown',
                set_id: typeof currentSetId !== 'undefined' ? currentSetId : 'Unknown',
                export_date: new Date().toISOString()
            },
            meddra_terms: termsList
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MedDRA_Stats_${exportData.metadata.brand_name}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initFaers());
} else {
    window.initFaers();
}

