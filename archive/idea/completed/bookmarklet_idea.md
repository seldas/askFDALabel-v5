# Implementation Plan: Drug Snippet (MVP)

## 1. Project Overview

**Drug Snippet** is a browser-based research tool designed to enhance AI chat interfaces by automatically identifying drug names and providing quick-access links to FDA labeling data.

## 2. Technical Architecture

* **Host**: Local development server (`localhost:8845`).
* **Data Structure**: Trie (Prefix Tree) for efficient  multi-keyword matching.
* **Mechanism**: `MutationObserver` for real-time monitoring of AI responses.

---

## 3. Phase 1: Data Generation (`trie_gen.py`)

Run this Python script to convert your list of 1000+ drugs into the optimized JS data structure.

```python
import json
import os

def build_trie(word_list):
    trie = {}
    for word in word_list:
        if not word.strip(): continue
        node = trie
        # Store as lowercase for case-insensitive matching
        for char in word.strip().lower():
            node = node.setdefault(char, {})
        node['#'] = word.strip()  # Store original casing for display
    return trie

def generate():
    # 1. Load your raw list
    # Assuming drug_list.txt exists with one drug per line
    raw_drugs = [
        "Triumeq", "CALQUENCE", "KRAZATI", "ALECENSA", "Olumiant", 
        "BOSULIF", "SOTYKTU", "Zorvolex", "Tivicay", "Dovato" 
        # ... Add the rest of your 1000 drugs here
    ]
    
    # 2. Build and export
    trie = build_trie(list(set(raw_drugs)))
    
    js_content = f"const DRUG_SNIPPET_DATA = {json.dumps(trie, ensure_ascii=False)};"
    
    with open('dist/trie_data.js', 'w', encoding='utf-8') as f:
        f.write(js_content)
    print("Success: trie_data.js generated in /dist")

if __name__ == "__main__":
    if not os.path.exists('dist'): os.makedirs('dist')
    generate()

```

---

## 4. Phase 2: Core Engine (`main.js`)

This script handles the "snippet" logic: finding words and creating the UI.

```javascript
(function() {
    // Check if already loaded
    if (window.DRUG_SNIPPET_LOADED) return;
    window.DRUG_SNIPPET_LOADED = true;

    // Configuration for different platforms
    const ADAPTERS = {
        gemini: '.markdown-main-panel',
        openai: '.prose',
        elsa: '.chat-message-content' // Placeholder for Elsa
    };

    function highlightSection(container) {
        if (container.hasAttribute('data-ds-done')) return;
        
        // Trie-based matching logic here
        // (Implementation discussed in previous turns)
        
        container.setAttribute('data-ds-done', 'true');
    }

    // Observe AI output
    const observer = new MutationObserver(() => {
        Object.values(ADAPTERS).forEach(selector => {
            document.querySelectorAll(selector).forEach(highlightSection);
        });
    });

    observer.observe(document.body, { childList: true, subtree: true });
    console.log("Drug Snippet: Monitoring AI responses...");
})();

```

---

## 5. Phase 3: Selection Logic

This part handles the "Snippet" pop-up when you highlight text manually.

* **Trigger**: `mouseup` event on the document.
* **Action**: Calculate selection coordinates using `window.getSelection().getRangeAt(0).getBoundingClientRect()`.
* **Result**: Show a small button (e.g., a "Snippet" icon) that links to `https://labels.fda.gov/`.

---

## 6. Next Steps for You

1. **Prepare the environment**: Create the `/dist` folder.
2. **Generate Data**: Run the Python script with your full list of 1000 drugs to create `trie_data.js`.
3. **Start Server**: Use a simple server (like Python's `http.server` or `npx http-server`) on port **8845**.
4. **Test in Gemini**: Use the bookmarklet to load `main.js` and see if the console logs "Monitoring AI responses...".


---
## 7. Data format
Elsa response (last chat/message)

<div class="MuiBox-root css-hboir5"><div class="MuiStack-root css-1sttpgs"><div class="markdown-content" data-markdown-content="true"><div><h1 class="MuiTypography-root MuiTypography-h4 MuiTypography-gutterBottom css-1lrorvw" id="bosulif-bosutinib">BOSULIF (Bosutinib)</h1><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="overview">Overview</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">BOSULIF is a kinase inhibitor indicated for the treatment of chronic myelogenous leukemia (CML). Bosutinib is the active pharmaceutical ingredient in this prescription medication.</p><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="mechanism-of-action">Mechanism of Action</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">Bosutinib is a tyrosine kinase inhibitor that targets the BCR-ABL kinase, which is the abnormal protein produced by the Philadelphia chromosome that drives CML. It also inhibits Src family kinases.</p><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="indications">Indications</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">BOSULIF is approved for:</p><ul><li class="MuiBox-root css-18li8ee"><strong>Newly diagnosed chronic phase Philadelphia chromosome-positive (Ph+) CML</strong> in adult patients</li><li class="MuiBox-root css-18li8ee"><strong>Chronic, accelerated, or blast phase Ph+ CML</strong> in adult patients with resistance or intolerance to prior therapy</li></ul><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="dosage-forms">Dosage Forms</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">The medication is available as oral tablets in various strengths (typically 100 mg, 400 mg, and 500 mg).</p><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="key-safety-considerations">Key Safety Considerations</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">Important safety information includes:</p><ul><li class="MuiBox-root css-18li8ee"><strong>Gastrointestinal toxicity</strong> (diarrhea, nausea, vomiting)</li><li class="MuiBox-root css-18li8ee"><strong>Myelosuppression</strong> (thrombocytopenia, anemia, neutropenia)</li><li class="MuiBox-root css-18li8ee"><strong>Hepatotoxicity</strong><ul><li class="MuiBox-root css-18li8ee">requires monitoring of liver function tests</li></ul></li><li class="MuiBox-root css-18li8ee"><strong>Fluid retention</strong></li><li class="MuiBox-root css-18li8ee"><strong>Renal toxicity</strong></li><li class="MuiBox-root css-18li8ee"><strong>Cardiovascular effects</strong></li></ul><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="manufacturer">Manufacturer</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">BOSULIF is manufactured by Pfizer Inc.</p><h2 class="MuiTypography-root MuiTypography-h6 MuiTypography-gutterBottom css-1tncb3m" id="additional-resources">Additional Resources</h2><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">For complete prescribing information and FDA-approved labeling, you can access the <a class="MuiTypography-root MuiTypography-inherit MuiLink-root MuiLink-underlineAlways css-1t1xjlu" href="https://nctr-crs.fda.gov/fdalabel/ui/search?query=BOSULIF" rel="noreferrer" target="_blank">FDA label database</a>.</p><p class="MuiTypography-root MuiTypography-body2 MuiTypography-paragraph css-50pohw">Would you like more specific information about any aspect of BOSULIF, such as dosing recommendations, drug interactions, or clinical trial data?</p></div></div> </div></div>
<div class="MuiBox-root css-1abudc7"><div></div><div class="MuiStack-root css-csffzd"><span aria-label="Thumbs up" class=""><button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall css-1j7qk7u" tabindex="0" type="button"><svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeSmall css-1k33q06" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="ThumbUpAltOutlinedIcon"><path d="M21 8h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2m0 4-3 7H9V9l4.34-4.34L12.23 10H21zM1 9h4v12H1z"></path></svg><span class="MuiTouchRipple-root css-w0pj6f"></span></button></span><span aria-label="Thumbs down" class=""><button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall css-1j7qk7u" tabindex="0" type="button"><svg class="MuiSvgIcon-root MuiSvgIcon-fontSizeSmall css-1k33q06" focusable="false" aria-hidden="true" viewBox="0 0 24 24" data-testid="ThumbDownOffAltOutlinedIcon"><path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2m0 12-4.34 4.34L12 14H3v-2l3-7h9zm4-12h4v12h-4z"></path></svg><span class="MuiTouchRipple-root css-w0pj6f"></span></button></span><span aria-label="Copy to clipboard" class=""><button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall css-1j7qk7u" tabindex="0" type="button"><img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODYiIGhlaWdodD0iMTA2IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIiB4bWw6c3BhY2U9InByZXNlcnZlIiBvdmVyZmxvdz0iaGlkZGVuIj48ZGVmcz48Y2xpcFBhdGggaWQ9ImNsaXAwIj48cmVjdCB4PSIzNDkxIiB5PSIyNDUiIHdpZHRoPSI4NiIgaGVpZ2h0PSIxMDYiLz48L2NsaXBQYXRoPjwvZGVmcz48ZyBjbGlwLXBhdGg9InVybCgjY2xpcDApIiB0cmFuc2Zvcm09InRyYW5zbGF0ZSgtMzQ5MSAtMjQ1KSI+PHBhdGggZD0iTTM1NzYuMTMgMjY0Ljg1NyAzNTU3LjUzIDI0NS44NzZDMzU1Ni45NSAyNDUuMjkyIDM1NTYuMzcgMjQ1IDM1NTUuNSAyNDVMMzUyMC42NCAyNDVDMzUxOC44OSAyNDUgMzUxNy43MyAyNDYuMTY4IDM1MTcuNzMgMjQ3LjkyTDM1MTcuNzMgMjY4LjA2OSAzNDkzLjkxIDI2OC4wNjlDMzQ5Mi4xNiAyNjguMDY5IDM0OTEgMjY5LjIzNyAzNDkxIDI3MC45ODlMMzQ5MSAzNDguMDhDMzQ5MSAzNDkuODMyIDM0OTIuMTYgMzUxIDM0OTMuOTEgMzUxTDM1NDcuMzcgMzUxQzM1NDkuMTEgMzUxIDM1NTAuMjcgMzQ5LjgzMiAzNTUwLjI3IDM0OC4wOEwzNTUwLjI3IDMyNy45MzEgMzU3NC4xIDMyNy45MzFDMzU3NS44NCAzMjcuOTMxIDM1NzcgMzI2Ljc2MyAzNTc3IDMyNS4wMTFMMzU3NyAyNjcuNDg1QzM1NzcgMjY2LjkwMSAzNTc2LjcxIDI2Ni42MDkgMzU3Ni43MSAyNjYuMDI1IDM1NzYuNzEgMjY1LjQ0MSAzNTc2LjQyIDI2NS4xNDkgMzU3Ni4xMyAyNjQuODU3Wk0zNTU4LjEyIDI1NC45MjkgMzU2Ny40MSAyNjQuNTY1IDM1NTguMTIgMjY0LjU2NSAzNTU4LjEyIDI1NC45MjlaTTM1NDQuNDYgMzQ1LjE2IDM0OTYuODEgMzQ1LjE2IDM0OTYuODEgMjc0LjIwMSAzNTI1LjU3IDI3NC4yMDEgMzUyNS41NyAyOTAuNTU0QzM1MjUuNTcgMjkyLjMwNiAzNTI2Ljc0IDI5My40NzQgMzUyOC40OCAyOTMuNDc0TDM1NDQuNzUgMjkzLjQ3NCAzNTQ0Ljc1IDM0NS4xNlpNMzUzMS4zOSAyODcuMzQyIDM1MzEuMzkgMjc3LjcwNiAzNTQwLjY4IDI4Ny4zNDIgMzUzMS4zOSAyODcuMzQyWk0zNTcxLjQ4IDMyMi4wOTEgMzU1MC41NiAzMjIuMDkxIDM1NTAuNTYgMjkwLjU1NEMzNTUwLjU2IDI4OS45NyAzNTUwLjU2IDI4OS4zODYgMzU1MC4yNyAyODkuMDk0IDM1NDkuOTggMjg4LjgwMiAzNTQ5Ljk4IDI4OC41MSAzNTQ5LjY5IDI4OC4yMThMMzUzMS4wOSAyNjkuNTI5QzM1MzAuNTEgMjY4Ljk0NSAzNTI5LjkzIDI2OC42NTMgMzUyOS4wNiAyNjguNjUzTDM1MjMuODMgMjY4LjY1MyAzNTIzLjgzIDI1MS40MjQgMzU1Mi41OSAyNTEuNDI0IDM1NTIuNTkgMjY3Ljc3N0MzNTUyLjU5IDI2OS41MjkgMzU1My43NiAyNzAuNjk3IDM1NTUuNSAyNzAuNjk3TDM1NzEuNzcgMjcwLjY5NyAzNTcxLjQ4IDMyMi4wOTFaIiBmaWxsPSIjN0Y3RjdGIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L2c+PC9zdmc+" width="15" height="20" alt="Copy to Clipboard"><span class="MuiTouchRipple-root css-w0pj6f"></span></button></span><span aria-label="Download Response" class=""><button class="MuiButtonBase-root MuiIconButton-root MuiIconButton-sizeSmall css-1j7qk7u" tabindex="0" type="button"><img src="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNzIiIGhlaWdodD0iOTkiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiIHhtbDpzcGFjZT0icHJlc2VydmUiIG92ZXJmbG93PSJoaWRkZW4iPjxkZWZzPjxjbGlwUGF0aCBpZD0iY2xpcDAiPjxyZWN0IHg9IjI2NDkiIHk9IjE1MyIgd2lkdGg9IjcyIiBoZWlnaHQ9Ijk5Ii8+PC9jbGlwUGF0aD48L2RlZnM+PGcgY2xpcC1wYXRoPSJ1cmwoI2NsaXAwKSIgdHJhbnNmb3JtPSJ0cmFuc2xhdGUoLTI2NDkgLTE1MykiPjxwYXRoIGQ9Ik0yNjgyLjg2IDIzOC4wODlDMjY4My4xNiAyMzguMzkzIDI2ODMuNDcgMjM4LjY5NiAyNjgzLjc4IDIzOC42OTYgMjY4NC4wOCAyMzguNjk2IDI2ODQuMzkgMjM5IDI2ODUgMjM5IDI2ODUuMzEgMjM5IDI2ODUuOTIgMjM5IDI2ODYuMjIgMjM4LjY5NiAyNjg2LjUzIDIzOC4zOTMgMjY4Ni44NCAyMzguMzkzIDI2ODcuMTQgMjM4LjA4OUwyNzE0LjA4IDIxMS4zNDdDMjcxNS4zMSAyMTAuMTMxIDI3MTUuMzEgMjA4LjMwOCAyNzE0LjA4IDIwNy4wOTIgMjcxNC4wOCAyMDcuMDkyIDI3MTQuMDggMjA3LjA5MiAyNzE0LjA4IDIwNy4wOTIgMjcxMi44NiAyMDUuODc2IDI3MTEuMDIgMjA1Ljg3NiAyNzA5LjggMjA3LjA5MkwyNjg4LjA2IDIyOC42NjggMjY4OC4wNiAxNTYuMDM5QzI2ODguMDYgMTU0LjIxNiAyNjg2Ljg0IDE1MyAyNjg1IDE1MyAyNjgzLjE2IDE1MyAyNjgxLjk0IDE1NC4yMTYgMjY4MS45NCAxNTYuMDM5TDI2ODEuOTQgMjI4LjY2OCAyNjYwLjIgMjA3LjA5MkMyNjU4Ljk4IDIwNS44NzYgMjY1Ny4xNCAyMDUuODc2IDI2NTUuOTIgMjA3LjA5MiAyNjU0LjY5IDIwOC4zMDggMjY1NC42OSAyMTAuMTMxIDI2NTUuOTIgMjExLjM0N0wyNjU1LjkyIDIxMS4zNDcgMjY4Mi44NiAyMzguMDg5WiIgZmlsbD0iIzdGN0Y3RiIgZmlsbC1ydWxlPSJldmVub2RkIi8+PHBhdGggZD0iTTI3MTggMjMzQzI3MTYuMiAyMzMgMjcxNSAyMzQuMTg4IDI3MTUgMjM1Ljk2OUwyNzE1IDI0Ni4wNjIgMjY1NSAyNDYuMDYyIDI2NTUgMjM1Ljk2OUMyNjU1IDIzNC4xODggMjY1My44IDIzMyAyNjUyIDIzMyAyNjUwLjIgMjMzIDI2NDkgMjM0LjE4OCAyNjQ5IDIzNS45NjlMMjY0OSAyNDkuMDMxQzI2NDkgMjUwLjgxMyAyNjUwLjIgMjUyIDI2NTIgMjUyTDI3MTggMjUyQzI3MTkuOCAyNTIgMjcyMSAyNTAuODEzIDI3MjEgMjQ5LjAzMUwyNzIxIDIzNS45NjlDMjcyMSAyMzQuNDg0IDI3MTkuOCAyMzMgMjcxOCAyMzNaIiBmaWxsPSIjN0Y3RjdGIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiLz48L2c+PC9zdmc+" width="15" height="20" alt="Download Response"><span class="MuiTouchRipple-root css-w0pj6f"></span></button></span></div></div>