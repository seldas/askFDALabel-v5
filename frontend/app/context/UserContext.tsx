'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type UserRole = 'user' | 'developer' | 'admin';

export interface UserSession {
  is_authenticated: boolean;
  id?: number;
  is_admin?: boolean;
  /** 'user' | 'developer' | 'admin'. Developer is user plus DB selection. */
  role?: UserRole;
  /** Whether the labeling-database switch is offered. Enforced server-side too. */
  can_select_db?: boolean;
  /** The shared anonymous account: no query history, no saved preferences. */
  is_guest?: boolean;
  username?: string;
  ai_provider?: string;
  custom_gemini_key?: string;
  openai_api_key?: string;
  openai_base_url?: string;
  openai_model_name?: string;
  is_internal?: boolean;
  gemini_model?: string;
  gemini_fallback_model?: string;
  ai_settings?: string;
  env_elsa_url?: string;
  env_elsa_user?: string;
  has_elsa_key?: boolean;
  env_elsa_model_id?: string;
  env_elsa_model_name?: string;
  env_vllm_url?: string;
  env_vllm_model?: string;
  env_ollama_url?: string;
  has_gemini_key?: boolean;
  has_vllm_key?: boolean;
}

export interface ActiveTask {
  id: number;
  type: string;
  project_id?: number;
  project_title?: string;
  target_pt?: string; // Legacy field for AE reports
  message?: string;
  progress: number;
  status: string;
}

interface UserContextType {
  session: UserSession | null;
  loading: boolean;
  activeTasks: ActiveTask[];
  updateAiProvider: (provider: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  authModal: 'login' | 'register' | 'change_password' | null;
  openAuthModal: (type: 'login' | 'register' | 'change_password' | null) => void;
  refreshTasks: () => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [authModal, setAuthModal] = useState<'login' | 'register' | 'change_password' | null>(null);
  const pathname = usePathname();
  const router = useRouter();



  const openAuthModal = (type: 'login' | 'register' | 'change_password' | null) => {
    setAuthModal(type);
  };

  const fetchSession = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/auth/session');
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      const data = await res.json();
      setSession(data);
    } catch (e) {
      console.error("Failed to fetch session", e);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshTasks = useCallback(async () => {
    if (!session?.is_authenticated) return;
    try {
      const res = await fetch('/api/dashboard/tasks/active');
      if (res.ok) {
        const data = await res.json();
        setActiveTasks(data);
      }
    } catch (e) {
      console.error("Failed to fetch active tasks", e);
    }
  }, [session?.is_authenticated]);

  useEffect(() => {
    if (!loading && !session?.is_authenticated && pathname !== '/') {
      const autoGuestLogin = async () => {
        try {
          const res = await fetch('/api/dashboard/auth/guest-login', { method: 'POST' });
          if (res.ok) {
            await fetchSession();
          } else {
            router.push('/');
          }
        } catch (e) {
          router.push('/');
        }
      };
      autoGuestLogin();
    }
  }, [loading, session?.is_authenticated, pathname, router, fetchSession]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Task polling effect - Poll on all pages if authenticated
  useEffect(() => {
    if (session?.is_authenticated) {
      refreshTasks();
      const interval = setInterval(refreshTasks, 3600000); // Poll every 30 seconds
      return () => clearInterval(interval);
    } else {
      setActiveTasks([]);
    }
  }, [session?.is_authenticated, refreshTasks]);

  const updateAiProvider = async (provider: string) => {
    try {
      const res = await fetch('/api/dashboard/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'ai_provider': provider })
      });
      const data = await res.json();
      if (data.success) {
        setSession(prev => prev ? { ...prev, ai_provider: provider } : null);
      }
    } catch (e) {
      console.error("Failed to update AI provider", e);
    }
  };

  return (
    <UserContext.Provider value={{ session, loading, activeTasks, updateAiProvider, refreshSession: fetchSession, authModal, openAuthModal, refreshTasks }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};
