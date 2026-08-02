window.initChat = function () {
  // Chatbox Functionality
  const chatBubble = document.getElementById("chat-bubble");
  const chatbox = document.getElementById("chatbox");
  const closeChat = document.getElementById("close-chat");
  const chatSend = document.getElementById("chat-send");
  const chatInput = document.getElementById("chat-input");
  const chatMessages = document.getElementById("chat-messages");
  const xmlContentDiv = document.getElementById("xml-content");
  const fontIncrease = document.getElementById("font-increase");
  const fontDecrease = document.getElementById("font-decrease");
  const chatReset = document.getElementById("chat-reset");

  // New Controls (kept for compatibility, but disabled/hidden)
  const toggleHistoryBtn = document.getElementById("toggle-history-btn");
  const resetChatBtn = document.getElementById("reset-current-chat-btn");
  const historyStatusText = document.getElementById("history-status-text");

  // State: CURRENT SESSION ONLY
  window.currentSessionHistory = []; // Messages from THIS session (restored or new)

  // Helper to safely parse markdown
  const parseMarkdown = (text) => {
    if (typeof marked !== "undefined" && marked.parse) return marked.parse(text);
    console.warn("Marked library not found. Falling back to plain text.");
    return String(text || "").replace(/\n/g, "<br>");
  };

  // Hide/disable global history UI (if it exists in the DOM)
  if (toggleHistoryBtn) toggleHistoryBtn.style.display = "none";
  if (historyStatusText) {
    historyStatusText.textContent = "Only current session history is used.";
    historyStatusText.style.color = "#6c757d";
  }

  if (
    chatBubble &&
    chatbox &&
    closeChat &&
    chatSend &&
    chatInput &&
    chatMessages &&
    xmlContentDiv
  ) {
    const xmlContent = xmlContentDiv.textContent || "";
    let currentFontSize = 14;

    const setFontSize = (size) => {
      if (size >= 8 && size <= 20) {
        currentFontSize = size;
        chatMessages.style.fontSize = `${currentFontSize}px`;
      }
    };

    document.addEventListener("click", (e) => {
      const bubble = e.target.closest("#chat-bubble");
      if (bubble) {
        chatbox.style.display = "flex";
        bubble.style.display = "none";
      }
    });

    closeChat.addEventListener("click", () => {
      chatbox.style.display = "none";
      const currentBubble = document.getElementById("chat-bubble");
      if (currentBubble) currentBubble.style.display = "flex";
    });

    if (fontIncrease) fontIncrease.addEventListener("click", () => setFontSize(currentFontSize + 1));
    if (fontDecrease) fontDecrease.addEventListener("click", () => setFontSize(currentFontSize - 1));

    // Initial load of saved annotations
    if (typeof savedAnnotations !== "undefined" && Array.isArray(savedAnnotations) && savedAnnotations.length > 0) {
      savedAnnotations.forEach((ann) => {
        createAnnotationBadge(
          ann.question,
          ann.answer,
          ann.section_number,
          ann.keywords,
          ann.id,
          true
        );
      });
    }

    // Top header reset (Legacy - mapped to new reset logic for consistency)
    if (chatReset) {
      chatReset.addEventListener("click", () => {
        if (confirm("Are you sure you want to reset the current chat?")) performReset();
      });
    }

    // New reset button (same behavior)
    if (resetChatBtn) {
      resetChatBtn.addEventListener("click", () => {
        if (confirm("Are you sure you want to clear this conversation?")) performReset();
      });
    }

    function performReset() {
      // Clear DOM except greeting (and any top containers you keep)
      const toRemove = [];
      for (const child of chatMessages.children) {
        if (child.classList.contains("message-greeting")) continue;
        toRemove.push(child);
      }
      toRemove.forEach((el) => el.remove());

      // Reset State
      window.currentSessionHistory = [];

      // Clear storage for this session
      if (window.SessionManager && typeof currentSetId !== "undefined") {
        SessionManager.updateSession(
          currentSetId,
          typeof currentDrugName !== "undefined" ? currentDrugName : "Drug Label",
          []
        );
      }
    }

    const sendMessage = async () => {
      const userInput = chatInput.value;
      if (!userInput || userInput.trim() === "") return;

      const userMessage = document.createElement("div");
      userMessage.classList.add("message", "message-user");
      userMessage.innerHTML = `<div class="message-content"><p>${userInput}</p></div>`;
      chatMessages.appendChild(userMessage);
      chatInput.value = "";
      chatMessages.scrollTop = chatMessages.scrollHeight;

      const typingIndicator = document.createElement("div");
      typingIndicator.classList.add("message", "message-ai");
      typingIndicator.innerHTML = `<div class="message-content"><p class="typing-indicator"><span>.</span><span>.</span><span>.</span></p></div>`;
      chatMessages.appendChild(typingIndicator);
      chatMessages.scrollTop = chatMessages.scrollHeight;

      try {
        // ✅ CURRENT SESSION ONLY
        const payloadHistory = [...window.currentSessionHistory];

        const response = await fetch("/api/dashboard/ai_chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userInput,
            history: payloadHistory,
            xml_content: xmlContent,
            chat_type: "general",
          }),
        });

        if (chatMessages.contains(typingIndicator)) chatMessages.removeChild(typingIndicator);

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          const errorMsg = data.error || "Network response was not ok.";
          const errorMessage = document.createElement("div");
          errorMessage.classList.add("message", "message-ai");
          errorMessage.innerHTML = `<div class="message-content"><p>Error: ${errorMsg}</p></div>`;
          chatMessages.appendChild(errorMessage);
          chatMessages.scrollTop = chatMessages.scrollHeight;
          return;
        }

        const aiResponseText = data.response || "Sorry, I encountered an error.";

        const keywordRegex = /\[KEYWORDS: (.*?)\]/;
        const keywordMatch = aiResponseText.match(keywordRegex);
        let keywords = [];
        if (keywordMatch) {
          try {
            keywords = JSON.parse(`[${keywordMatch[1]}]`);
          } catch (e) {
            console.error("Failed to parse keywords", e);
          }
        }

        const displayAnswer = aiResponseText.replace(keywordRegex, "").trim();

        const aiMessage = document.createElement("div");
        aiMessage.classList.add("message", "message-ai");
        aiMessage.innerHTML = `<div class="message-content">${parseMarkdown(displayAnswer)}</div>`;
        chatMessages.appendChild(aiMessage);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Update CURRENT session history
        window.currentSessionHistory.push({ role: "user", content: userInput });
        window.currentSessionHistory.push({ role: "model", content: aiResponseText });

        // Save to SessionManager
        if (window.SessionManager && typeof currentSetId !== "undefined") {
          SessionManager.updateSession(
            currentSetId,
            typeof currentDrugName !== "undefined" ? currentDrugName : "Drug Label",
            window.currentSessionHistory
          );
        }

        annotateDocument(userInput, aiResponseText, keywords);
      } catch (error) {
        console.error("Error during fetch:", error);
        if (chatMessages.contains(typingIndicator)) chatMessages.removeChild(typingIndicator);
        const errorMessage = document.createElement("div");
        errorMessage.classList.add("message", "message-ai");
        errorMessage.innerHTML = `<div class="message-content"><p>Error: Could not connect to the AI assistant.</p></div>`;
        chatMessages.appendChild(errorMessage);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    };

    function annotateDocument(question, rawAnswer, keywords) {
      const cleanAnswer = rawAnswer.replace(/\[KEYWORDS: .*?\]/g, "").trim();
      const citationRegex = /\((?:Section\s+)?\s*(\d+(?:\.\d+)*)\s*\)/gi;
      const matches = [...cleanAnswer.matchAll(citationRegex)];
      const uniqueSections = [...new Set(matches.map((m) => m[1]))];

      if (uniqueSections.length === 0) {
        createAnnotationBadge(question, cleanAnswer, "TOP", keywords);
      } else {
        uniqueSections.forEach((sectionNum) => {
          createAnnotationBadge(question, cleanAnswer, sectionNum, keywords);
        });
      }
    }

    window.createAnnotationBadge = createAnnotationBadge;

    function createAnnotationBadge(question, answer, sectionNum, keywords, id = null, isSaved = false) {
      let sectionEl = document.querySelector(`.Section[data-section-number="${sectionNum}"]`);
      let header = sectionEl ? sectionEl.querySelector("h2") : null;

      // Fallback to top of document if section not found or explicitly requested as TOP
      if (!header || sectionNum === "TOP") {
        header = document.getElementById("top-annotations-container");
        sectionEl = document.getElementById("label-view") || document.querySelector(".container");
        sectionNum = "TOP";
      }

      if (!header) {
        console.warn(`createAnnotationBadge: Could not find target element for section "${sectionNum}"`);
        return;
      }

      // Simple deduplication check: if badge exists with same Q, don't add
      const existingBadges = header.querySelectorAll(".chat-annotation-badge");
      for (const b of existingBadges) {
        const popoverQ = b.querySelector(".popover-q");
        if (popoverQ && popoverQ.textContent === `Q: ${question}`) return;
      }

      // Match Type Detection
      let matchType = null;
      if (keywords && Array.isArray(keywords)) {
        if (keywords.includes("match:yes")) matchType = "yes";
        else if (keywords.includes("match:probable")) matchType = "probable";
      }

      const badge = document.createElement("span");
      badge.className = "chat-annotation-badge" + (isSaved ? " saved" : "");
      if (id) badge.setAttribute("data-id", id);

      let iconSymbol = "&#128172;";
      let headerTitle = "<span>&#10024;</span> AI INSIGHT";

      if (matchType === "yes") {
        badge.classList.add("match-yes");
        iconSymbol = "&#10003;";
        headerTitle = "<span>&#9989;</span> AI CONFIRMED";
      } else if (matchType === "probable") {
        badge.classList.add("match-probable");
        iconSymbol = "?";
        headerTitle = "<span>&#9888;</span> AI PROBABLE";
      }

      badge.innerHTML = iconSymbol;
      badge.title = "Click to toggle sticky note & highlights";

      const popover = document.createElement("div");
      popover.className = "annotation-popover";
      if (matchType) popover.classList.add(`match-${matchType}`);

      popover.innerHTML = `
        <div class="annotation-popover-header">
          <div class="popover-header-title">${headerTitle}</div>
          <div class="popover-actions">
            ${!isSaved ? `<button class="save-note-btn" title="Save permanently">&#128190;</button>` : ""}
            <button class="delete-note-btn" title="Delete note">&#128465;</button>
            <button class="close-note-btn" title="Close note">&times;</button>
          </div>
        </div>
        <div class="popover-content-wrapper">
          <span class="popover-q">Q: ${question}</span>
          <div class="popover-a">${parseMarkdown(answer)}</div>
        </div>
      `;

      badge.appendChild(popover);
      header.appendChild(badge);

      // Drag functionality
      const popoverHeader = popover.querySelector(".annotation-popover-header");
      let isDragging = false;
      let currentX, currentY, initialX, initialY;
      let xOffset = 0, yOffset = 0;

      const dragStart = (e) => {
        if (e.target.closest(".popover-actions")) return;

        const style = window.getComputedStyle(popover);
        const matrix = new WebKitCSSMatrix(style.transform);
        xOffset = matrix.m41;
        yOffset = matrix.m42;

        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;

        if (badge.classList.contains("sticky")) {
          isDragging = true;
          popover.classList.add("is-dragging");
        }
      };

      const drag = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
        xOffset = currentX;
        yOffset = currentY;
        popover.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
      };

      const dragEnd = () => {
        initialX = currentX;
        initialY = currentY;
        isDragging = false;
        popover.classList.remove("is-dragging");
      };

      popoverHeader.addEventListener("mousedown", dragStart);
      document.addEventListener("mousemove", drag);
      document.addEventListener("mouseup", dragEnd);

      badge.addEventListener("click", (e) => {
        if (e.target.closest(".annotation-popover")) {
          e.stopPropagation();
          return;
        }

        e.stopPropagation();
        const isSticky = badge.classList.toggle("sticky");

        // Keep popover on screen
        if (isSticky) {
          const rect = popover.getBoundingClientRect();
          if (rect.right > window.innerWidth) {
            popover.style.left = "auto";
            popover.style.right = "0";
            popover.style.transform = "none";
          }
          if (rect.left < 0) {
            popover.style.left = "0";
            popover.style.transform = "none";
          }
        }

        // Clean highlights
        sectionEl.querySelectorAll(".ai-highlight, .ai-highlight-yes, .ai-highlight-probable").forEach((hl) => {
          const text = hl.textContent;
          hl.parentNode.replaceChild(document.createTextNode(text), hl);
        });
        sectionEl.normalize();

        if (isSticky) {
          // Highlight Quote (Citation)
          const quoteMatch = answer.match(/>\s*"?([^"\n]+)"?/);
          if (quoteMatch && quoteMatch[1]) {
            const quoteText = quoteMatch[1].trim();
            if (quoteText.length > 5) {
              let highlightClass = "ai-highlight";
              if (matchType === "yes") highlightClass = "ai-highlight-yes";
              else if (matchType === "probable") highlightClass = "ai-highlight-probable";
              highlightText(sectionEl, quoteText, highlightClass);
            }
          }

          // Highlight Keywords
          if (keywords && keywords.length > 0) {
            keywords.forEach((phrase) => {
              if (!phrase || phrase.length < 3) return;
              if (phrase.startsWith("match:")) return;
              highlightText(sectionEl, phrase, "ai-highlight");
            });
          }
        }
      });

      popover.querySelector(".close-note-btn").addEventListener("click", (e) => {
        e.stopPropagation();
        badge.classList.remove("sticky");

        sectionEl.querySelectorAll(".ai-highlight, .ai-highlight-yes, .ai-highlight-probable").forEach((hl) => {
          const text = hl.textContent;
          hl.parentNode.replaceChild(document.createTextNode(text), hl);
        });
        sectionEl.normalize();
      });

      const saveBtn = popover.querySelector(".save-note-btn");
      if (saveBtn) {
        saveBtn.addEventListener("click", async (e) => {
          e.stopPropagation();
          try {
            const res = await fetch("/api/dashboard/save_annotation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                set_id: currentSetId,
                section_number: sectionNum,
                question,
                answer,
                keywords,
              }),
            });
            const data = await res.json();
            if (data.success) {
              badge.classList.add("saved");
              badge.setAttribute("data-id", data.id);
              saveBtn.remove();
            }
          } catch (err) {
            console.error("Save failed", err);
          }
        });
      }

      popover.querySelector(".delete-note-btn").addEventListener("click", async (e) => {
        e.stopPropagation();
        const annotationId = badge.getAttribute("data-id");
        if (annotationId) {
          if (!confirm("Are you sure you want to delete this saved note?")) return;
          try {
            await fetch("/api/dashboard/delete_annotation", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ set_id: currentSetId, id: annotationId }),
            });
          } catch (err) {
            console.error("Delete failed", err);
          }
        }
        badge.remove();

        if (badge.classList.contains("sticky")) {
          sectionEl.querySelectorAll(".ai-highlight, .ai-highlight-yes, .ai-highlight-probable").forEach((hl) => {
            const text = hl.textContent;
            hl.parentNode.replaceChild(document.createTextNode(text), hl);
          });
          sectionEl.normalize();
        }
      });
    }

    function highlightText(element, phrase, className = "ai-highlight") {
      if (element.nodeType === 3) {
        const text = element.nodeValue || "";
        const lowerText = text.toLowerCase();
        const lowerPhrase = String(phrase || "").toLowerCase();
        const index = lowerText.indexOf(lowerPhrase);

        if (index >= 0) {
          const span = document.createElement("span");
          span.className = className;
          span.textContent = text.substr(index, phrase.length);

          const afterNode = document.createTextNode(text.substr(index + phrase.length));
          const parent = element.parentNode;

          parent.insertBefore(document.createTextNode(text.substr(0, index)), element);
          parent.insertBefore(span, element);
          parent.insertBefore(afterNode, element);
          parent.removeChild(element);
        }
      } else if (
        element.nodeType === 1 &&
        !element.classList.contains("ai-highlight") &&
        !element.classList.contains("ai-highlight-yes") &&
        !element.classList.contains("ai-highlight-probable") &&
        !["SCRIPT", "STYLE"].includes(element.tagName)
      ) {
        Array.from(element.childNodes).forEach((child) => highlightText(child, phrase, className));
      }
    }

    chatSend.addEventListener("click", sendMessage);
    chatInput.addEventListener("keypress", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        sendMessage();
      }
    });
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => window.initChat());
} else {
  window.initChat();
}
