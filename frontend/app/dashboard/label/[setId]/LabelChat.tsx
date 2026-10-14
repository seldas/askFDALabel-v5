'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useChatSession, ChatMessage } from './useChatSession';
import { annotateDocument, createAnnotationBadge } from './docAnnotations';

interface LabelChatProps {
  setId: string;
  drugName?: string | null;
  xmlContent?: string;
  isOpen: boolean;
  onClose: () => void;
  canComment?: boolean;
  savedAnnotations?: any[];
}

export default function LabelChat({
  setId,
  drugName,
  xmlContent = '',
  isOpen,
  onClose,
  canComment = true,
  savedAnnotations = [],
}: LabelChatProps) {
  const { messages, addMessages, resetSession } = useChatSession(setId, drugName);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Restore saved annotations onto label headers on mount
  useEffect(() => {
    if (savedAnnotations && Array.isArray(savedAnnotations) && savedAnnotations.length > 0) {
      savedAnnotations.forEach((ann) => {
        createAnnotationBadge(
          ann.question,
          ann.answer,
          ann.section_number,
          ann.keywords,
          ann.id,
          true,
          canComment,
          setId
        );
      });
    }
  }, [setId, savedAnnotations, canComment]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  // Scroll to bottom on messages change
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading, isOpen]);

  const handleReset = () => {
    if (confirm('Are you sure you want to clear this conversation?')) {
      resetSession();
    }
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const userInput = input.trim();
    if (!userInput || isLoading) return;

    setInput('');
    const userMsg: ChatMessage = { role: 'user', content: userInput };
    addMessages([userMsg]);
    setIsLoading(true);

    try {
      // Current session history including the user's latest message
      const payloadHistory = [...messages, userMsg];

      // Read fallback XML text if xmlContent was not passed
      let effectiveXml = xmlContent;
      if (!effectiveXml && typeof document !== 'undefined') {
        const xmlEl = document.getElementById('xml-content');
        effectiveXml = xmlEl?.textContent || '';
      }

      const res = await fetch('/api/dashboard/ai_chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          history: payloadHistory,
          xml_content: effectiveXml,
          chat_type: 'general',
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        const errorMsg = data.error || 'Network response was not ok.';
        addMessages([{ role: 'model', content: `Error: ${errorMsg}` }]);
        setIsLoading(false);
        return;
      }

      const aiResponseText = data.response || 'Sorry, I encountered an error.';

      // Parse keywords
      const keywordRegex = /\[KEYWORDS: (.*?)\]/;
      const keywordMatch = aiResponseText.match(keywordRegex);
      let keywords: string[] = [];
      if (keywordMatch) {
        try {
          keywords = JSON.parse(`[${keywordMatch[1]}]`);
        } catch (err) {
          console.error('Failed to parse keywords', err);
        }
      }

      const aiMsg: ChatMessage = { role: 'model', content: aiResponseText };
      addMessages([aiMsg]);

      // Annotate document headers with badges
      annotateDocument(userInput, aiResponseText, keywords, setId, canComment);
    } catch (err) {
      console.error('Error sending chat message:', err);
      addMessages([{ role: 'model', content: 'Error: Could not connect to the AI assistant.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      id="chatbox"
      className="chatbox"
      style={{
        display: isOpen ? 'flex' : 'none',
        zIndex: 2500,
      }}
    >
      {/* Header */}
      <div className="chat-header" id="chat-header">
        <h3>AI Assistant</h3>
        <div className="chat-header-buttons" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.max(10, s - 1))}
            title="Decrease font size"
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 700,
              padding: '2px 4px',
              opacity: fontSize <= 10 ? 0.4 : 0.9,
            }}
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => setFontSize((s) => Math.min(20, s + 1))}
            title="Increase font size"
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '0.8rem',
              fontWeight: 700,
              padding: '2px 4px',
              opacity: fontSize >= 20 ? 0.4 : 0.9,
            }}
          >
            A+
          </button>
          <button
            type="button"
            onClick={handleReset}
            id="chat-reset"
            className="chat-reset"
            title="Reset Chat"
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '1.2rem',
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &#8634;
          </button>
          <button
            type="button"
            onClick={onClose}
            id="close-chat"
            className="close-chat"
            title="Close Chat"
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '1.3rem',
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            &times;
          </button>
        </div>
      </div>

      {/* Messages */}
      <div
        id="chat-messages"
        className="chat-messages"
        ref={messagesContainerRef}
        style={{ fontSize: `${fontSize}px` }}
      >
        {messages.length === 0 && (
          <div className="message message-ai message-greeting">
            <div className="message-content">
              <p>
                Hello! I am your AI assistant for <strong>{drugName || 'this FDA label'}</strong>. Ask me
                about indications, dosage, contraindications, adverse reactions, or drug interactions.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, idx) => {
          const isAi = msg.role === 'model';
          const displayContent = isAi
            ? msg.content.replace(/\[KEYWORDS: .*?\]/g, '').trim()
            : msg.content;

          return (
            <div key={idx} className={`message ${isAi ? 'message-ai' : 'message-user'}`}>
              <div className="message-content">
                {isAi ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{displayContent}</ReactMarkdown>
                ) : (
                  <p>{displayContent}</p>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="message message-ai">
            <div className="message-content">
              <p className="typing-indicator">
                <span>.</span>
                <span>.</span>
                <span>.</span>
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form className="chat-input-form" onSubmit={handleSend}>
        <input
          ref={inputRef}
          type="text"
          id="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question about this label..."
          disabled={isLoading}
        />
        <button type="submit" id="chat-send" disabled={isLoading || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
