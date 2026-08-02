document.addEventListener('DOMContentLoaded', function () {
    const compareForm = document.getElementById('compare-form');
    // Updated ID to match template
    const compareBtn = document.getElementById('compare-selected-btn') || document.getElementById('compare-btn');

    if (compareForm && compareBtn) {
        const checkboxes = compareForm.querySelectorAll('.compare-checkbox');
        const updateCompareButton = () => {
            const checkedCheckboxes = compareForm.querySelectorAll('.compare-checkbox:checked');
            const checkedCount = checkedCheckboxes.length;
            
            // Enable button if at least 1 label is selected
            compareBtn.disabled = checkedCount < 1;

            if (checkedCount >= 1) {
                const selectedFormat = checkedCheckboxes[0].getAttribute('data-format');
                checkboxes.forEach(cb => {
                    if (!cb.checked) {
                        // Disable if:
                        // 1. Format mismatch
                        // 2. Already reached 3 selections
                        // 3. Permanent disabled
                        const formatMismatch = cb.getAttribute('data-format') !== selectedFormat;
                        const limitReached = checkedCount >= 3;
                        const permanentDisabled = cb.hasAttribute('data-permanent-disabled');
                        
                        if (formatMismatch || limitReached || permanentDisabled) {
                            cb.disabled = true;
                        } else {
                            cb.disabled = false;
                        }
                    }
                });
            } else {
                // Reset all (except permanently disabled)
                checkboxes.forEach(cb => {
                    if (!cb.hasAttribute('data-permanent-disabled')) cb.disabled = false;
                });
            }
        };

        compareForm.addEventListener('change', (event) => {
            if (event.target.classList.contains('compare-checkbox')) updateCompareButton();
        });

        const showErrorBanner = (msg) => {
            let banner = document.getElementById('error-banner');
            if (!banner) {
                banner = document.createElement('div');
                banner.id = 'error-banner';
                banner.style.cssText = 'background-color: #f8d7da; color: #721c24; padding: 10px; margin-bottom: 15px; border: 1px solid #f5c6cb; border-radius: 4px; text-align: center;';
                // Insert before the table or panels
                const container = compareForm.querySelector('.selection-panels') || compareForm.querySelector('.table-container');
                if (container) {
                    container.parentNode.insertBefore(banner, container);
                } else {
                    compareForm.insertBefore(banner, compareForm.firstChild);
                }
            }
            banner.textContent = msg;
            banner.style.display = 'block';
            banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => { banner.style.display = 'none'; }, 8000);
        };

        compareBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            if (compareBtn.disabled) return;

            const originalText = compareBtn.innerHTML;
            compareBtn.innerHTML = '<span>⏳</span> Loading...';
            compareBtn.disabled = true;

            try {
                const formData = new FormData(compareForm);
                // Need to manually append submit button value if needed, but here we just need fields.
                
                const response = await fetch(compareForm.action, {
                    method: 'POST',
                    body: formData
                });

                if (response.ok) {
                    const html = await response.text();
                    document.open();
                    document.write(html);
                    document.close();
                } else {
                    const data = await response.json();
                    if (data.unsupported_set_id) {
                        // Show banner
                        showErrorBanner(data.error);
                        
                        // Disable the specific item
                        const badCheckbox = compareForm.querySelector(`.compare-checkbox[value="${data.unsupported_set_id}"]`);
                        if (badCheckbox) {
                            badCheckbox.checked = false;
                            badCheckbox.disabled = true;
                            badCheckbox.setAttribute('data-permanent-disabled', 'true'); // Prevent re-enabling
                            
                            // Visual feedback on the row/panel
                            const row = badCheckbox.closest('tr') || badCheckbox.closest('.panel');
                            if (row) {
                                row.style.opacity = '0.5';
                                row.style.pointerEvents = 'none';
                                row.title = "This label has an unsupported format.";
                                
                                // Add a visual indicator text if possible
                                const statusBadge = row.querySelector('.status-badge');
                                if (statusBadge) {
                                    statusBadge.textContent = 'Unsupported';
                                    statusBadge.className = 'status-badge'; // Reset classes
                                    statusBadge.style.backgroundColor = '#6c757d';
                                }
                            }
                        }
                        
                        // Re-evaluate button state
                        updateCompareButton();
                    } else {
                        showErrorBanner(data.error || 'An error occurred.');
                    }
                }
            } catch (err) {
                console.error(err);
                showErrorBanner('Network error occurred. Please try again.');
            } finally {
                // If we are still on the same page (error case)
                if (document.readyState === 'complete' || document.readyState === 'interactive') {
                    compareBtn.innerHTML = originalText;
                    updateCompareButton(); 
                }
            }
        });
        updateCompareButton();
    }

    const compareSectionTitles = document.querySelectorAll('.compare-section-title');
    const expandAllBtn = document.getElementById('expand-all-btn');
    const collapseAllBtn = document.getElementById('collapse-all-btn');

    compareSectionTitles.forEach(title => {
        title.addEventListener('click', () => {
            const section = title.closest('.compare-section');
            section.classList.toggle('expanded');
        });
    });

    if (expandAllBtn && collapseAllBtn) {
        expandAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.compare-section').forEach(section => section.classList.add('expanded'));
        });
        collapseAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.compare-section').forEach(section => section.classList.remove('expanded'));
        });
    }

    const aiSummaryBtn = document.getElementById('ai-summary-btn');
    const aiSummaryLoading = document.getElementById('ai-summary-loading');
    const aiSummaryOutput = document.getElementById('ai-summary-output');
    
    // --- AI Summary Toggle Logic ---
    const toggleAiBtn = document.getElementById('toggle-ai-summary-btn');
    const aiContentWrapper = document.getElementById('ai-summary-content-wrapper');
    const aiHeader = document.querySelector('.ai-summary-header');

    if (toggleAiBtn && aiContentWrapper) {
        const toggleAiSummary = (e) => {
            if (e) e.stopPropagation();
            const isHidden = aiContentWrapper.style.display === 'none';
            aiContentWrapper.style.display = isHidden ? 'block' : 'none';
            toggleAiBtn.innerHTML = isHidden ? '&#8722;' : '&#43;';
            
            // Adjust margin if showing/hiding
            aiHeader.style.marginBottom = isHidden ? '15px' : '0';
        };

        toggleAiBtn.addEventListener('click', toggleAiSummary);
        if (aiHeader) aiHeader.addEventListener('click', toggleAiSummary);
    }

    if (aiSummaryBtn && aiSummaryLoading && aiSummaryOutput && typeof comparisonData !== 'undefined' && typeof selectedLabelsMetadata !== 'undefined') {
        
        // --- Helper to fetch summary ---
        async function fetchSummary(forceRefresh = false, generateIfMissing = true) {
            aiSummaryOutput.innerHTML = '';
            aiSummaryLoading.style.display = 'block';
            aiSummaryBtn.disabled = true;

            const differingSections = [];
            comparisonData.forEach(section => {
                if (!section.is_same) {
                    const content1 = section.contents[0] ? stripHtmlTags(section.contents[0]) : '';
                    const content2 = section.contents[1] ? stripHtmlTags(section.contents[1]) : '';
                    differingSections.push({ title: section.title, content1: content1, content2: content2 });
                }
            });

            const label1Name = selectedLabelsMetadata[0] ? selectedLabelsMetadata[0].brand_name : 'Label 1';
            const label2Name = selectedLabelsMetadata[1] ? selectedLabelsMetadata[1].brand_name : 'Label 2';

            try {
                const response = await fetch('/api/dashboard/ai_compare_summary', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        set_ids: typeof currentSetIds !== 'undefined' ? currentSetIds : [],
                        differing_sections: differingSections,
                        label1_name: label1Name,
                        label2_name: label2Name,
                        force_refresh: forceRefresh,
                        generate_if_missing: generateIfMissing
                    }),
                });

                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    if (generateIfMissing) { // Only show error if we expected a result
                        aiSummaryOutput.innerHTML = `<p style="color: red;">Error: ${data.error || 'Network response was not ok.'}</p>`;
                    }
                } else if (data.summary) {
                    // Clean up markdown code blocks if AI wrapped the HTML
                    let cleanSummary = data.summary.replace(/```html/g, '').replace(/```/g, '');
                    
                    if (typeof marked !== 'undefined' && marked.parse) {
                        aiSummaryOutput.innerHTML = marked.parse(cleanSummary);
                    } else {
                        console.warn('Marked library not loaded. Falling back to plain text.');
                        aiSummaryOutput.innerHTML = cleanSummary.replace(/\n/g, '<br>');
                    }
                    
                    aiSummaryBtn.innerHTML = '<span>&#x21bb;</span> Re-generate Summary';
                } else if (!generateIfMissing) {
                    // No cache found, do nothing
                } else if (data.error) {
                    aiSummaryOutput.innerHTML = `<p style="color: red;">Error: ${data.error}</p>`;
                } else {
                    aiSummaryOutput.innerHTML = `<p>Could not generate summary.</p>`;
                }

            } catch (error) {
                console.error('Error during AI summary fetch:', error);
                if (generateIfMissing) {
                    aiSummaryOutput.innerHTML = `<p style="color: red;">An error occurred while generating the AI summary.</p>`;
                }
            } finally {
                aiSummaryLoading.style.display = 'none';
                aiSummaryBtn.disabled = false;
            }
        }

        // --- Init Check for Saved Summary ---
        fetchSummary(false, false); // Check only

        // --- Click Handler ---
        aiSummaryBtn.addEventListener('click', async () => {
            // If text is "Re-generate", we force refresh. 
            // Otherwise (first time), we just fetch (generateIfMissing=true).
            const isRegen = aiSummaryBtn.textContent.includes('Re-generate');
            fetchSummary(isRegen, true);
        });
    }
});

window.exportSectionToMarkdown = function(event, index) {
    if (event) event.stopPropagation(); 
    
    const rootSection = comparisonData[index];
    const rootKey = rootSection.key ? rootSection.key.toString() : '';
    const labels = selectedLabelsMetadata;
    
    let md = `# Comparison: ${rootSection.title}\n\n`;
    const dateStr = new Date().toISOString().split('T')[0];
    md += `**Date:** ${dateStr}\n\n`;
    
    labels.forEach((l, i) => {
        md += `**Label ${i+1}:** ${l.brand_name} (${l.manufacturer_name || 'N/A'})\n`;
        md += `- Set ID: ${l.set_id}\n`;
        md += `- Date: ${l.effective_time || 'N/A'}\n\n`;
    });
    
    md += '---\n\n';
    
    // Collect root section and any descendants
    // Descendants are subsequent sections whose key starts with "rootKey." (PLR) or "rootKey " (Non-PLR normalized)
    // Since comparisonData is flat sorted, descendants should immediately follow.
    
    let sectionsToExport = [rootSection];
    
    for (let i = index + 1; i < comparisonData.length; i++) {
        const nextSec = comparisonData[i];
        if (!nextSec.key) break;
        
        const nextKey = nextSec.key.toString();
        
        // PLR Logic: "5" -> "5.1", "5.2"
        const isPlrDescendant = nextKey.startsWith(rootKey + '.');
        
        // Non-PLR Logic: "WARNINGS" -> "WARNINGS GENERAL" (via normalized keys with space)
        // Ensure rootKey is not empty to avoid matching everything
        const isNonPlrDescendant = rootKey.length > 0 && nextKey.startsWith(rootKey + ' ');
        
        if (isPlrDescendant || isNonPlrDescendant) {
            sectionsToExport.push(nextSec);
        } else {
            // Stop if sequence breaks (assuming sorted list keeps families together)
            // But wait, "5" -> "5.1" -> "5.2". All good.
            // "5" -> "6". Stops.
            break;
        }
    }

    sectionsToExport.forEach(section => {
        md += `### ${section.title}\n\n`;
        
        section.contents.forEach((content, i) => {
            const labelName = labels[i] ? labels[i].brand_name : `Label ${i+1}`;
            md += `#### ${labelName}\n\n`;
            
            if (!content) {
                md += '*(Section not found or empty)*\n\n';
            } else {
                // Clean HTML for Markdown
                let text = content.replace(/<br\s*\/?>/gi, '\n');
                text = text.replace(/<\/p>/gi, '\n\n');
                text = text.replace(/<\/div>/gi, '\n\n');
                text = text.replace(/<\/li>/gi, '\n');
                text = text.replace(/<li>/gi, '- ');
                
                // Remove remaining tags using DOMParser
                var doc = new DOMParser().parseFromString(text, 'text/html');
                text = doc.body.textContent || '';
                
                // Fix multiple newlines
                text = text.replace(/\n\s*\n/g, '\n\n').trim();
                
                md += `${text}\n\n`;
            }
        });
        md += '---\n\n';
    });
    
    // Add AI Prompt
    md += '## AI Analysis Prompt\n\n';
    md += `> **Instruction:** Please analyze the content provided above for the section "${rootSection.title}" (and any included subsections) from the different drug labels.\n`;
    md += '> \n';
    md += '> **Goal:** Compare the information and generate a summary that emphasizes:\n';
    md += '> 1. **Commonalities:** What information is consistent across all labels?\n';
    md += '> 2. **Differences:** What are the key differences (e.g., dosing, warnings, populations)?\n';
    md += '> 3. **Implications:** Briefly highlight any clinical significance of these differences.\n';
    
    // Download
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Use root section title for filename
    const safeTitle = rootSection.title.replace(/[^a-z0-9]/gi, '_').substring(0, 50); 
    a.download = `Comparison_${safeTitle}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};

window.exportFullComparisonJson = function() {
    const labels = selectedLabelsMetadata;
    const comparisonStructure = [];

    // Helper to clean HTML
    const cleanHtml = (html) => {
        if (!html) return null;
        let text = html.replace(/<br\s*\/?>/gi, '\n');
        text = text.replace(/<\/p>/gi, '\n\n');
        text = text.replace(/<\/div>/gi, '\n\n');
        text = text.replace(/<\/li>/gi, '\n');
        text = text.replace(/<li>/gi, '- ');
        var doc = new DOMParser().parseFromString(text, 'text/html');
        return (doc.body.textContent || '').replace(/\n\s*\n/g, '\n\n').trim();
    };

    comparisonData.forEach(section => {
        const entry = {
            title: section.title,
            key: section.key,
            contents: []
        };

        section.contents.forEach((content, i) => {
            const labelId = labels[i] ? labels[i].set_id : `label_${i}`;
            entry.contents.push({
                set_id: labelId,
                text: cleanHtml(content),
                is_missing: content === null
            });
        });

        comparisonStructure.push(entry);
    });

    const exportObject = {
        metadata: {
            export_date: new Date().toISOString(),
            comparison_title: typeof comparisonTitle !== 'undefined' ? comparisonTitle : 'Drug Label Comparison',
            labels: labels
        },
        comparison_data: comparisonStructure,
        system_prompt: `You are an expert regulatory affairs specialist and clinical pharmacist.
Your task is to analyze the provided drug label comparison data.
The data contains a list of sections. For each section, text from multiple drug labels is provided.

Please perform the following for the entire comparison:
1. Identify the most significant clinical differences between the labels, focusing on Indications, Warnings, and Dosage.
2. Summarize the commonalities.
3. If there are discrepancies in contraindications or boxed warnings, highlight them immediately.
4. Provide a high-level executive summary of how these labels differ in terms of safety and efficacy profiles.`
    };

    const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Full_Comparison_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};
