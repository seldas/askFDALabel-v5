window.initFavorites = function() {
    // Favorites Dropdown Logic
    const favToggleBtn = document.getElementById('favorites-toggle-btn');
    const favMenu = document.getElementById('favorites-dropdown-menu');

    // Store/Get Active Project ID
    function getActiveProjectId() {
        return localStorage.getItem('activeProjectId');
    }

    function setActiveProjectId(id) {
        localStorage.setItem('activeProjectId', id);
        // Refresh page to update stars context
        location.reload(); 
    }
    
    function updateVisibleFavoritesStatus() {
        const activeProjectId = getActiveProjectId();
        const buttons = document.querySelectorAll('.favorite-btn, .favorite-btn-selection');
        const setIds = [];
        const btnMap = {}; // set_id -> [buttons]

        buttons.forEach(btn => {
            // Determine set_id from context or attribute
            // For selection page, it's in onclick "toggleFavoriteFromSelection(this, 'UUID', ...)"
            // For result page, it is 'currentSetId' global var or derived.
            let setId = null;
            
            // Try to extract from onclick attribute if present
            const onClick = btn.getAttribute('onclick');
            if (onClick && onClick.includes('toggleFavoriteFromSelection')) {
                const match = onClick.match(/'([0-9a-fA-F-]+)'/); // Match UUID
                if (match) setId = match[1];
            } 
            // Fallback for result page main button
            else if (btn.id === 'favorite-btn' && typeof currentSetId !== 'undefined') {
                setId = currentSetId;
            }

            if (setId) {
                setIds.push(setId);
                if (!btnMap[setId]) btnMap[setId] = [];
                btnMap[setId].push(btn);
            }
        });

        if (setIds.length === 0) return;

        // Unique IDs
        const uniqueIds = [...new Set(setIds)];

        fetch('/api/dashboard/check_favorites_batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                set_ids: uniqueIds,
                project_id: activeProjectId
            })
        })
        .then(res => res.json())
        .then(data => {
            uniqueIds.forEach(id => {
                const isFav = data[id] === true;
                const btns = btnMap[id] || [];
                btns.forEach(btn => {
                    // Update Icon based on status
                    if (isFav) {
                        btn.innerHTML = '&#9733;'; // Filled Star
                        btn.style.color = '#ffc107'; // Yellow/Gold
                    } else {
                        btn.innerHTML = '&#9734;'; // Empty Star
                        btn.style.color = '#ccc';
                    }
                });
            });
        })
        .catch(console.error);
    }

    if (favToggleBtn && favMenu) {
        const favContent = document.getElementById('favorites-dropdown-content');

        // Initialize Active Project if not set
        if (!getActiveProjectId()) {
            // Will set to default after first fetch if null
        }
        
        // Update icons on load
        updateVisibleFavoritesStatus();

        favToggleBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            favMenu.classList.toggle('show');

            if (favMenu.classList.contains('show') && favContent) {
                // Load Projects
                favContent.innerHTML = '<div class="dropdown-loading">Loading Projects...</div>';
                try {
                    const res = await fetch('/api/dashboard/projects');
                    const data = await res.json();
                    const projects = data.projects || [];
                    
                    favContent.innerHTML = '';
                    
                    if (projects.length > 0) {
                        const header = document.createElement('div');
                        header.className = 'dropdown-header';
                        header.innerText = 'SELECT ACTIVE PROJECT';
                        favContent.appendChild(header);

                        let activeId = getActiveProjectId();
                        // If activeId invalid/missing, default to first (Not Grouped)
                        if (!activeId || !projects.find(p => p.id == activeId)) {
                            activeId = projects[0].id;
                            localStorage.setItem('activeProjectId', activeId);
                        }

                        projects.forEach(p => {
                            const item = document.createElement('div');
                            item.className = 'favorites-dropdown-item project-selector';
                            if (p.id == activeId) {
                                item.classList.add('active');
                                item.style.backgroundColor = '#e7f5ff';
                                item.style.color = '#007bff';
                                item.innerHTML = `<strong>${p.title}</strong><span>&#10003; Active</span>`;
                            } else {
                                item.innerHTML = `<strong>${p.title}</strong><span>Click to switch</span>`;
                                item.onclick = (ev) => {
                                    ev.stopPropagation();
                                    setActiveProjectId(p.id);
                                };
                            }
                            favContent.appendChild(item);
                        });
                        
                        const divider = document.createElement('hr');
                        divider.style.margin = '8px 0';
                        divider.style.border = '0';
                        divider.style.borderTop = '1px solid #eee';
                        favContent.appendChild(divider);
                    }

                    // "Manage Projects" Link
                    const viewAll = document.createElement('a');
                    viewAll.className = 'favorites-dropdown-item';
                    viewAll.style.textAlign = 'center';
                    viewAll.style.fontWeight = 'bold';
                    viewAll.style.color = '#007bff';
                    viewAll.href = '/my_labelings';
                    viewAll.target = 'AskFDALabel_MyProjects';
                    viewAll.innerHTML = 'Manage All Projects &#8599;';
                    favContent.appendChild(viewAll);

                } catch (err) {
                    console.error('Error fetching projects:', err);
                    favContent.innerHTML = '<div class="dropdown-error">Failed to load projects.</div>';
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!favToggleBtn.contains(e.target) && !favMenu.contains(e.target)) {
                favMenu.classList.remove('show');
            }
        });
    }

    // Favorites Functionality (Single)
    const favoriteBtn = document.getElementById('favorite-btn');
    if (favoriteBtn && typeof currentSetId !== 'undefined') {
        const setFavState = (isFav) => {
            if (isFav) {
                favoriteBtn.innerHTML = '&#9733;'; // Filled Star
                favoriteBtn.style.color = '#ffc107'; // Yellow/Gold
            } else {
                favoriteBtn.innerHTML = '&#9734;'; // Empty Star
                favoriteBtn.style.color = '#ccc'; // Gray
            }
        };

        // Check initial state with Active Project
        const activeProjectId = getActiveProjectId();
        const queryParams = activeProjectId ? `?project_id=${activeProjectId}` : '';

        fetch(`/api/dashboard/check_favorite/${currentSetId}${queryParams}`)
            .then(res => res.json())
            .then(data => {
                setFavState(data.is_favorite);
            })
            .catch(err => console.error('Error checking favorite:', err));

        // Toggle on click
        favoriteBtn.addEventListener('click', async () => {
            try {
                let brandName = document.querySelector('.DocumentTitle').childNodes[0].textContent.trim();
                
                const res = await fetch('/api/dashboard/toggle_favorite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        set_id: currentSetId,
                        project_id: getActiveProjectId(),
                        brand_name: brandName,
                        manufacturer_name: typeof currentManufacturer !== 'undefined' ? currentManufacturer : '',
                        effective_time: typeof currentEffectiveTime !== 'undefined' ? currentEffectiveTime : ''
                    })
                });
                const data = await res.json();
                if (data.success) {
                    setFavState(data.is_favorite);
                }
            } catch (err) {
                console.error('Error toggling favorite:', err);
            }
        });
    }

    // Comparison Favorite Button Logic
    const favCompBtn = document.getElementById('favorite-comparison-btn');
    if (favCompBtn && typeof currentSetIds !== 'undefined') {
        const setCompFavState = (isFav) => {
            if (isFav) {
                favCompBtn.innerHTML = '&#9733;'; // Filled Star
                favCompBtn.style.color = '#ffc107'; // Yellow/Gold
            } else {
                favCompBtn.innerHTML = '&#9734;'; // Empty Star
                favCompBtn.style.color = '#ccc'; // Gray
            }
        };

        // Check initial state with Active Project
        const activeProjectId = getActiveProjectId();
        
        fetch('/api/dashboard/check_favorite_comparison', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                set_ids: currentSetIds,
                project_id: activeProjectId 
            })
        })
        .then(res => res.json())
        .then(data => {
            setCompFavState(data.is_favorite);
        })
        .catch(err => console.error('Error checking comp favorite:', err));

        // Toggle
        favCompBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/dashboard/toggle_favorite_comparison', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        set_ids: currentSetIds,
                        title: comparisonTitle,
                        project_id: getActiveProjectId()
                    })
                });
                const data = await res.json();
                if (data.success) {
                    setCompFavState(data.is_favorite);
                }
            } catch (err) {
                console.error('Error toggling comp favorite:', err);
            }
        });
    }
}

async function toggleFavoriteFromSelection(btn, setId, brandName, manufacturer, effectiveTime, importId = null) {
    try {
        const activeProjectId = localStorage.getItem('activeProjectId');
        
        const response = await fetch('/api/dashboard/toggle_favorite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                set_id: setId,
                project_id: activeProjectId,
                import_id: importId
            })
        });
        
        if (response.redirected) {
            window.location.href = response.url;
            return;
        }

        const data = await response.json();
        if(data.success) {
            btn.innerHTML = data.is_favorite ? '&#9733;' : '&#9734;';
            btn.style.color = data.is_favorite ? '#ffc107' : '#ccc';
        } else if(data.error) {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        console.error(err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initFavorites());
} else {
    window.initFavorites();
}

