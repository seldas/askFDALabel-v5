'use client';

import { useState, useEffect, useCallback } from 'react';

export interface ChatMessage {
  role: 'user' | 'model';
  content: string;
}

const STORAGE_KEY = 'askfdalabel_chat_sessions';

export function loadStoredSession(setId: string): ChatMessage[] {
  if (typeof window === 'undefined' || !setId) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    const session = data.sessions?.find((s: any) => s.id === setId);
    return Array.isArray(session?.messages) ? session.messages : [];
  } catch (err) {
    console.error('Failed to load chat session:', err);
    return [];
  }
}

export function saveStoredSession(setId: string, title: string, messages: ChatMessage[]): void {
  if (typeof window === 'undefined' || !setId) return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const data = raw ? JSON.parse(raw) : { sessions: [] };
    if (!Array.isArray(data.sessions)) data.sessions = [];

    const now = Date.now();
    const idx = data.sessions.findIndex((s: any) => s.id === setId);
    if (idx > -1) {
      data.sessions[idx].messages = messages;
      data.sessions[idx].timestamp = now;
      if (title) data.sessions[idx].title = title;
    } else {
      data.sessions.push({
        id: setId,
        title: title || 'Drug Label',
        messages,
        timestamp: now,
      });
    }
    data.active_session_id = setId;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));

    // Mirror to window for backwards compatibility
    (window as any).currentSessionHistory = [...messages];
  } catch (err) {
    console.error('Failed to save chat session:', err);
  }
}

export function clearStoredSession(setId: string, title?: string | null): void {
  saveStoredSession(setId, title || 'Drug Label', []);
}

export function useChatSession(setId: string, drugName?: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Load on mount or setId change
  useEffect(() => {
    if (!setId) return;
    const history = loadStoredSession(setId);
    setMessages(history);
    if (typeof window !== 'undefined') {
      (window as any).currentSessionHistory = [...history];
    }
  }, [setId]);

  const addMessages = useCallback(
    (newMessages: ChatMessage[]) => {
      setMessages((prev) => {
        const updated = [...prev, ...newMessages];
        saveStoredSession(setId, drugName || 'Drug Label', updated);
        return updated;
      });
    },
    [setId, drugName]
  );

  const resetSession = useCallback(() => {
    setMessages([]);
    clearStoredSession(setId, drugName);
    if (typeof window !== 'undefined') {
      (window as any).currentSessionHistory = [];
    }
  }, [setId, drugName]);

  return {
    messages,
    addMessages,
    resetSession,
  };
}
