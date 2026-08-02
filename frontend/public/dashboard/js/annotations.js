window.initAnnotations = function() {
    if (window.LabelAnnotationManager) return; 

    /* --- Label Annotation Logic --- */
    window.LabelAnnotationManager = {
        currentSelection: null,
        toolbarEl: null,
        activeProjectId: localStorage.getItem('activeProjectId'),

        init: function() {
            if (!document.getElementById('label-view')) {
                return;
            }
            this.fetchAnnotations();
            document.addEventListener('mouseup', (e) => this.handleSelection(e));
            document.addEventListener('mousedown', (e) => {
                if (this.toolbarEl && 
                    !this.toolbarEl.contains(e.target) && 
                    !e.target.closest('.color-palette') && 
                    !e.target.closest('.comment-input-box')) {
                    this.closeToolbar();
                }
            });
        },


        fetchAnnotations: function() {
            if (typeof currentSetId === 'undefined' || !currentSetId) return;

            const qs = this.activeProjectId ? `?project_id=${this.activeProjectId}` : '';
            fetch(`/api/dashboard/annotations/get/${currentSetId}${qs}`)
                .then(res => res.json())
                .then(data => {
                    if (data.annotations) {
                        data.annotations.forEach(ann => this.renderAnnotation(ann));
                    }
                })
                .catch(err => console.error("Error fetching annotations", err));
        },

        handleSelection: function(e) {
            if (e.target.closest('.selection-toolbar') || 
                e.target.closest('.color-palette') || 
                e.target.closest('.comment-input-box')) return;

            const selection = window.getSelection();
            if (!selection || selection.toString().trim().length === 0){
                // Close if clicking text without selecting, unless clicking on an existing annotation
                if (!e.target.closest('.text-comment') && !e.target.closest('.text-highlight')) {
                     this.closeToolbar();
                }
                return;
            }

            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            
            // Find closest Section or Highlights container
            const root = document.getElementById('label-view');
            let node = container.nodeType === 1 ? container : container.parentElement;
 
            let sectionNode = null;
            while (node && node !== root) {
            if (node.classList?.contains('label-section-item')) {
                sectionNode = node;
                break;
            }
            node = node.parentElement;
            }
 
            if (!sectionNode) {
            return;
            }
 
            this.currentSelection = {
                range: range,
                sectionId: sectionNode.id || sectionNode.getAttribute('data-section-index') || 'unknown',
                sectionNode: sectionNode,
                text: selection.toString()
            };
 
            const rect = range.getBoundingClientRect();
            this.showToolbar(rect.left, rect.top - 40);
        },

        showToolbar: function(x, y) {
            this.closeToolbar();
            
            const toolbar = document.createElement('div');
            toolbar.className = 'selection-toolbar';
            toolbar.style.left = `${x}px`;
            toolbar.style.top = `${y}px`;
            toolbar.style.position = 'fixed';
            
            toolbar.innerHTML = `
            <button class="btn-ann-highlight" title="Highlight">
                <span style="background:yellow; width:14px; height:14px; border-radius:2px; border:1px solid #ccc;"></span>
            </button>
            <button class="btn-ann-comment" title="Comment">💬</button>
            `;

            const highlightBtn = toolbar.querySelector('.btn-ann-highlight');
            const commentBtn = toolbar.querySelector('.btn-ann-comment');

            highlightBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showColorPalette(toolbar);
            });

            commentBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.showCommentInput(toolbar);
            });

            document.body.appendChild(toolbar);
            this.toolbarEl = toolbar;
        },

        closeToolbar: function() {
            if (this.toolbarEl) {
                this.toolbarEl.remove();
                this.toolbarEl = null;
            }
            // Remove sub-menus
            document.querySelectorAll('.color-palette, .comment-input-box').forEach(el => el.remove());
        },

        showColorPalette: function(parent) {
            // Remove existing
            document.querySelectorAll('.color-palette').forEach(el => el.remove());

            const palette = document.createElement('div');
            palette.className = 'color-palette';
            const colors = ['#ffeb3b', '#ffc107', '#8bc34a', '#03a9f4', '#e91e63', 'none'];
            
            colors.forEach(c => {
                const btn = document.createElement('div');
                btn.className = `color-btn ${c === 'none' ? 'none' : ''}`;
                if (c !== 'none') btn.style.backgroundColor = c;
                btn.onclick = (e) => {
                    e.stopPropagation();
                    this.saveAnnotation('highlight', { color: c });
                    this.closeToolbar();
                };
                palette.appendChild(btn);
            });
            
            parent.appendChild(palette);
        },

        showCommentInput: function(parent) {
             document.querySelectorAll('.comment-input-box').forEach(el => el.remove());
             
             const box = document.createElement('div');
             box.className = 'comment-input-box';
             box.innerHTML = `
                <textarea placeholder="Write a note..."></textarea>
                <div class="comment-input-actions">
                    <button class="btn-cancel-comment">Cancel</button>
                    <button class="btn-save-comment">Save</button>
                </div>
             `;
             
             const textarea = box.querySelector('textarea');
             // Prevent closing when clicking inside
             box.addEventListener('mousedown', e => e.stopPropagation());
             
             box.querySelector('.btn-cancel-comment').addEventListener('click', (e) => {
                 e.stopPropagation();
                 this.closeToolbar();
             });
             
             box.querySelector('.btn-save-comment').addEventListener('click', (e) => {
                 e.stopPropagation();
                 const text = textarea.value.trim();
                 if (text) {
                     this.saveAnnotation('comment', { comment: text });
                     this.closeToolbar();
                 }
             });
             
             parent.appendChild(box);
             
             // Smart Positioning: Check if it goes off-screen
             const rect = box.getBoundingClientRect();
             if (rect.right > window.innerWidth - 20) {
                 box.style.left = 'auto';
                 box.style.right = '0';
             }
             
             textarea.focus();
        },

        saveAnnotation: function(type, data) {
            if (!this.currentSelection) return;
            
            const { sectionNode, sectionId, range, text } = this.currentSelection;
            
            // Calculate Offsets
            const offsets = this.getRangeOffsets(sectionNode, range);
            if (!offsets) {
                alert("Could not calculate position. Please try selecting within a single paragraph.");
                return;
            }

            // Optimistic UI Render
            const tempId = 'temp-' + Date.now();
            // this.renderAnnotation({ ...data, id: tempId, annotation_type: type, start_offset: offsets.start, end_offset: offsets.end, section_id: sectionId });

            fetch('/api/dashboard/annotations/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    project_id: this.activeProjectId || null,
                    set_id: currentSetId,
                    section_id: sectionId,
                    start_offset: offsets.start,
                    end_offset: offsets.end,
                    selected_text: text,
                    annotation_type: type,
                    color: data.color || null,
                    comment: data.comment || null
                })
            })
            .then(res => res.json())
            .then(resData => {
                if (resData.success) {
                    // Fetch all to refresh or just update ID. For simplicity, just fetch all.
                    // Or better, just render this one properly.
                    this.renderAnnotation({
                        id: resData.id,
                        project_id: this.activeProjectId,
                        set_id: currentSetId,
                        section_id: sectionId,
                        start_offset: offsets.start,
                        end_offset: offsets.end,
                        selected_text: text,
                        annotation_type: type,
                        color: data.color,
                        comment: data.comment,
                        username: resData.username,
                        created_at: resData.created_at
                    });
                    window.getSelection().removeAllRanges();
                } else {
                    alert("Failed to save: " + resData.error);
                }
            })
            .catch(err => console.error(err));
        },

        getRangeOffsets: function(container, range) {
            const preSelectionRange = range.cloneRange();
            preSelectionRange.selectNodeContents(container);
            preSelectionRange.setEnd(range.startContainer, range.startOffset);
            const start = preSelectionRange.toString().length;
            const end = start + range.toString().length;
            return { start, end };
        },

        renderAnnotation: function(ann) {
            // Find section
            let section = null;
            if (ann.section_id === 'unknown') return; // Skip
            
            // Try ID match first
            section = document.getElementById(ann.section_id);
            // Fallback to data attribute match
            if (!section) {
                section = document.querySelector(`.Section[data-section-number="${ann.section_id}"]`);
            }
            
            if (!section) return;

            // Traverse and Wrap
            this.wrapTextRange(section, ann.start_offset, ann.end_offset, () => {
                const span = document.createElement('span');
                span.setAttribute('data-ann-id', ann.id);
                
                if (ann.annotation_type === 'highlight') {
                    if (ann.color === 'none') {
                        // Logic to unwrap? Actually, usually 'none' means remove.
                        // But if it comes from DB as 'none', just don't render?
                        // Or user clicked 'None' to delete.
                        // If rendering, we should apply style.
                        return null; 
                    }
                    span.className = 'text-highlight';
                    span.style.backgroundColor = ann.color;
                    span.title = `Highlighted by ${ann.username}`;
                } else {
                    span.className = 'text-comment';
                    span.title = 'Click to view comment';
                }
                
                // Interaction
                span.onclick = (e) => {
                    e.stopPropagation();
                    this.showReadPopover(span, ann);
                };
                
                return span;
            });
        },

        wrapTextRange: function(container, start, end, createWrapper) {
            let charCount = 0;
            let startNode = null;
            let startOffset = 0;
            let endNode = null;
            let endOffset = 0;

            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const len = node.nodeValue.length;
                const nodeEnd = charCount + len;
                
                if (!startNode && start >= charCount && start < nodeEnd) {
                    startNode = node;
                    startOffset = start - charCount;
                }
                
                if (!endNode && end > charCount && end <= nodeEnd) {
                    endNode = node;
                    endOffset = end - charCount;
                    break;
                }
                
                charCount = nodeEnd;
            }

            if (startNode && endNode) {
                const range = document.createRange();
                range.setStart(startNode, startOffset);
                range.setEnd(endNode, endOffset);
                
                const wrapper = createWrapper();
                if (wrapper) {
                    try {
                        range.surroundContents(wrapper);
                    } catch(e) {
                        console.warn("Annotation wrap failed (complex range)", e);
                    }
                }
            }
        },

        showReadPopover: function(target, ann) {
            document.querySelectorAll('.annotation-read-popover').forEach(el => el.remove());
            
            const popover = document.createElement('div');
            popover.className = 'annotation-read-popover';
            
            const dateStr = new Date(ann.created_at).toLocaleDateString();
            const isCreator = currentUserId == ann.user_id;
            
            let contentHtml = '';
            if (ann.annotation_type === 'comment') {
                contentHtml = `<div class="ann-content">"${ann.comment}"</div>`;
            } else {
                 contentHtml = `<div class="ann-content">Highlighted Text</div>`;
            }
            
            const deleteBtnHtml = isCreator ? `
                <div class="ann-actions">
                    <button class="btn-delete-ann">Delete</button>
                </div>
            ` : '';
            
            popover.innerHTML = `
                <div class="ann-meta">
                    <span><strong>${ann.username}</strong></span>
                    <span>${dateStr}</span>
                </div>
                ${contentHtml}
                ${deleteBtnHtml}
            `;
            
            // Position
            const rect = target.getBoundingClientRect();
            popover.style.left = (rect.left + window.scrollX) + 'px';
            popover.style.top = (rect.bottom + window.scrollY + 5) + 'px';
            
            document.body.appendChild(popover);
            
            // Close on click out
            const closeFn = (e) => {
                if (!popover.contains(e.target) && e.target !== target) {
                    popover.remove();
                    document.removeEventListener('mousedown', closeFn);
                }
            };
            document.addEventListener('mousedown', closeFn);
            
            // Delete Action
            const deleteBtn = popover.querySelector('.btn-delete-ann');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', () => {
                     if(confirm("Delete this annotation?")) {
                         this.deleteAnnotation(ann.id, target);
                         popover.remove();
                     }
                });
            }
        },
        
        deleteAnnotation: function(id, domElement) {
            fetch('/api/dashboard/annotations/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: id })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    // Unwrap
                    const parent = domElement.parentNode;
                    while(domElement.firstChild) parent.insertBefore(domElement.firstChild, domElement);
                    parent.removeChild(domElement);
                    parent.normalize(); // Merge text nodes
                } else {
                    alert("Error: " + data.error);
                }
            })
            .catch(err => console.error(err));
        }
    };

    LabelAnnotationManager.init();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.initAnnotations());
} else {
    window.initAnnotations();
}

