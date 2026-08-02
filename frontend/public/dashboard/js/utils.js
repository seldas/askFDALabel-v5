// Common Helper Functions

window.stripHtmlTags = function(htmlString) {
    const div = document.createElement('div');
    div.innerHTML = htmlString;
    return div.textContent || div.innerText || '';
};

window.escapeRegExp = function(string) {
    return string.replace(/[.*+?^${}()|[\\]/g, '\\$&');
};

