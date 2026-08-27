'use client';

import { useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import AccessRestricted from '../components/AccessRestricted';
import Header from '../components/Header';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  username: string;
  is_admin: boolean;
  role?: 'user' | 'developer' | 'admin';
  ai_provider: string;
  is_active?: boolean;
  api_key?: string;
  created_at?: string;
}

export default function ManagementPage() {
  const { session, loading: sessionLoading, updateAiProvider, refreshSession } = useUser();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [activeTasks, setActiveTasks] = useState<Record<number, any>>({});

  const [selectedProvider, setSelectedProvider] = useState<string>('elsa');
  const [customSettings, setCustomSettings] = useState({
    gemini: { api_key: '' },
    vllm: { url: '', api_key: '', model_name: '' },
    elsa: { url: '', user: '', key: '', model_id: '', model_name: '' },
    ollama: { url: '', model_name: '' }
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [editingUserModelId, setEditingUserModelId] = useState<number | null>(null);
  const [selectedUserModelProvider, setSelectedUserModelProvider] = useState<string>('elsa');
  const [savingUserModel, setSavingUserModel] = useState<boolean>(false);

  useEffect(() => {
    if (session) {
      if (session.ai_provider) {
        if (session.is_internal && session.ai_provider === 'gemini') {
          setSelectedProvider('elsa');
        } else {
          setSelectedProvider(session.ai_provider);
        }
      }
      try {
        const parsed = session.ai_settings ? JSON.parse(session.ai_settings) : {};
        setCustomSettings({
          gemini: {
            api_key: parsed.gemini?.api_key || session.custom_gemini_key || ''
          },
          vllm: {
            url: parsed.vllm?.url || session.openai_base_url || '',
            api_key: parsed.vllm?.api_key || session.openai_api_key || '',
            model_name: parsed.vllm?.model_name || session.openai_model_name || ''
          },
          elsa: {
            url: parsed.elsa?.url || '',
            user: parsed.elsa?.user || '',
            key: parsed.elsa?.key || '',
            model_id: parsed.elsa?.model_id || '',
            model_name: parsed.elsa?.model_name || ''
          },
          ollama: {
            url: parsed.ollama?.url || '',
            model_name: parsed.ollama?.model_name || ''
          }
        });
      } catch (e) {
        console.error("Failed to parse session ai_settings", e);
      }
    }
  }, [session]);

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch('/api/dashboard/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ai_provider: selectedProvider,
          ai_settings: customSettings,
          custom_gemini_key: customSettings.gemini.api_key,
          openai_api_key: customSettings.vllm.api_key,
          openai_base_url: customSettings.vllm.url,
          openai_model_name: customSettings.vllm.model_name
        })
      });
      const data = await res.json();
      if (data.success) {
        if (typeof refreshSession === 'function') {
          await refreshSession();
        }
        alert('AI settings saved successfully!');
      } else {
        alert(data.error || 'Failed to save settings');
      }
    } catch (e) {
      console.error(e);
      alert('Error saving settings');
    }
    setSavingSettings(false);
  };

  // Modals state
  const [activeTab, setActiveTab] = useState<string>('users');
  const [initialTabSet, setInitialTabSet] = useState(false);

  useEffect(() => {
    if (session && !initialTabSet) {
      const requestedTab = typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('tab');
      if (requestedTab === 'ai' && session.is_admin) {
        setActiveTab('ai');
      } else if (session.username?.toLowerCase() === 'guest') {
        setActiveTab('tokens');
      } else if (session.is_admin) {
        setActiveTab(requestedTab || 'ai');
      } else {
        setActiveTab(requestedTab === 'tokens' ? 'tokens' : 'users');
      }
      setInitialTabSet(true);
    }
  }, [session, initialTabSet]);

  // API Key state
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loadingApiKey, setLoadingApiKey] = useState(false);
  const [generatingKey, setGeneratingKey] = useState(false);
  const [revokingKey, setRevokingKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const fetchApiKey = async () => {
    setLoadingApiKey(true);
    try {
      const res = await fetch('/api/dashboard/auth/api-key');
      const data = await res.json();
      if (data.success) {
        setApiKey(data.api_key || null);
      }
    } catch (e) {
      console.error('Failed to fetch API key', e);
    }
    setLoadingApiKey(false);
  };

  useEffect(() => {
    if (session && session.username?.toLowerCase() !== 'guest') {
      if (session.api_key !== undefined) {
        setApiKey(session.api_key);
      } else if (activeTab === 'apikey') {
        fetchApiKey();
      }
    }
  }, [session, activeTab]);

  const handleGenerateApiKey = async () => {
    if (apiKey && !window.confirm('Generating a new API key will replace and invalidate your current key immediately. Are you sure you want to continue?')) {
      return;
    }
    setGeneratingKey(true);
    try {
      const res = await fetch('/api/dashboard/auth/api-key/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const data = await res.json();
      if (data.success) {
        setApiKey(data.api_key);
        setShowKey(true);
        if (typeof refreshSession === 'function') {
          refreshSession();
        }
      } else {
        alert(data.error || 'Failed to generate API key');
      }
    } catch (e) {
      console.error(e);
      alert('Error generating API key');
    }
    setGeneratingKey(false);
  };

  const handleRevokeApiKey = async () => {
    if (!window.confirm('Are you sure you want to revoke your API key? Any applications or scripts using this key will no longer be authenticated.')) {
      return;
    }
    setRevokingKey(true);
    try {
      const res = await fetch('/api/dashboard/auth/api-key', {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        setApiKey(null);
        if (typeof refreshSession === 'function') {
          refreshSession();
        }
      } else {
        alert(data.error || 'Failed to revoke API key');
      }
    } catch (e) {
      console.error(e);
      alert('Error revoking API key');
    }
    setRevokingKey(false);
  };

  const handleCopyApiKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const [pendingUpdateType, setPendingUpdateType] = useState<string | null>(null);
  const [pendingUpdateStats, setPendingUpdateStats] = useState<any>(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [completedUpdateTask, setCompletedUpdateTask] = useState<any>(null);
  const [dbStatus, setDbStatus] = useState<Record<string, any>>({});
  const [selectedLogs, setSelectedLogs] = useState<string | null>(null);
  const [isLogModalOpen, setIsLogModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const logScrollRef = useRef<HTMLDivElement | null>(null);

  // Oracle (FDALabel) connection panel
  const [oracleForm, setOracleForm] = useState({
    oracle_db_env: 'tst',
    host: '',
    port: '',
    service: '',
    user: '',
    password: ''
  });
  const [oraclePresets, setOraclePresets] = useState<Record<string, any> | null>(null);
  const [oracleLoaded, setOracleLoaded] = useState(false);
  const [showOraclePassword, setShowOraclePassword] = useState(false);
  const [savingOracle, setSavingOracle] = useState(false);
  const [testingOracle, setTestingOracle] = useState(false);
  const [oracleTestResult, setOracleTestResult] = useState<{ success: boolean; message: string; elapsed_ms?: number | null } | null>(null);

  useEffect(() => {
    if ((activeTab === 'functions' || activeTab === 'tools') && session?.is_admin && features.length === 0 && !loadingFeatures) {
      fetchFeatureGates();
    }
    if (activeTab !== 'database' || !session?.is_admin || oracleLoaded) return;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/admin/oracle-settings');
        const data = await res.json();
        if (data.success) {
          setOracleForm({
            oracle_db_env: data.settings.oracle_db_env || 'tst',
            host: data.settings.host || '',
            port: data.settings.port || '',
            service: data.settings.service || '',
            user: data.settings.user || '',
            password: data.settings.password || ''
          });
          setOraclePresets(data.presets || null);
        }
      } catch (e) {
        console.error('Failed to load Oracle settings', e);
      }
      setOracleLoaded(true);
    })();
  }, [activeTab, session, oracleLoaded]);

  const applyOraclePreset = (env: 'dev' | 'tst') => {
    const preset = oraclePresets?.[env];
    if (!preset) return;
    setOracleForm(prev => ({
      ...prev,
      oracle_db_env: env,
      host: preset.host || '',
      port: preset.port || '',
      service: preset.service || '',
      user: preset.user || prev.user,
      password: preset.password || prev.password
    }));
    setOracleTestResult(null);
  };

  const handleTestOracle = async () => {
    setTestingOracle(true);
    setOracleTestResult(null);
    try {
      const res = await fetch('/api/dashboard/admin/oracle-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oracleForm)
      });
      const data = await res.json();
      setOracleTestResult({ success: !!data.success, message: data.message || data.error || 'No response', elapsed_ms: data.elapsed_ms });
    } catch (e: any) {
      setOracleTestResult({ success: false, message: e?.message || 'Request failed' });
    }
    setTestingOracle(false);
  };

  const handleSaveOracle = async () => {
    setSavingOracle(true);
    try {
      const res = await fetch('/api/dashboard/admin/oracle-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oracleForm)
      });
      const data = await res.json();
      if (data.success) {
        alert('Oracle connection settings saved.');
      } else {
        alert(data.error || 'Failed to save Oracle settings');
      }
    } catch (e) {
      console.error(e);
      alert('Error saving Oracle settings');
    }
    setSavingOracle(false);
  };

  // New user form
  // --- Function Control (feature gates) ---
  const [features, setFeatures] = useState<any[]>([]);
  const [featureRoles, setFeatureRoles] = useState<string[]>(['user', 'developer', 'admin']);
  const [loadingFeatures, setLoadingFeatures] = useState(false);
  const [savingFeature, setSavingFeature] = useState<string | null>(null);
  const [featureError, setFeatureError] = useState<string | null>(null);

  const fetchFeatureGates = async () => {
    setLoadingFeatures(true);
    setFeatureError(null);
    try {
      const res = await fetch('/api/dashboard/admin/feature_gates');
      const data = await res.json();
      if (res.ok && data.success) {
        setFeatures(data.features || []);
        if (Array.isArray(data.roles) && data.roles.length) setFeatureRoles(data.roles);
      } else {
        setFeatureError(data.error || 'Could not load function controls.');
      }
    } catch (e) {
      setFeatureError('Could not load function controls.');
    } finally {
      setLoadingFeatures(false);
    }
  };

  const updateFeatureGate = async (key: string, patch: Record<string, any>) => {
    setSavingFeature(key);
    setFeatureError(null);
    try {
      const res = await fetch(`/api/dashboard/admin/feature_gates/${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        // The response carries the full list, so the panel re-renders from the
        // server's view rather than a locally patched guess.
        setFeatures(data.features || []);
        // The change may affect this admin's own session; pick it up now
        // instead of waiting for the poll.
        refreshSession();
      } else {
        setFeatureError(data.error || 'Could not update this function.');
      }
    } catch (e) {
      setFeatureError('Could not update this function.');
    } finally {
      setSavingFeature(null);
    }
  };

  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'developer' | 'admin'>('user');

  // Edit user state
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editPassword, setEditPassword] = useState('');

  // Database Update Options
  const [skipUnpack, setSkipUnpack] = useState(false);
  const [workers, setWorkers] = useState(4);
  const [archived, setArchived] = useState(false);
  const [forceUpdate, setForceUpdate] = useState(false);
  const [useLocalDB, setUseLocalDB] = useState(false);

  // Token Usage state
  const [tokenUsage, setTokenUsage] = useState<any[]>([]);
  const [loadingTokenUsage, setLoadingTokenUsage] = useState(false);
  const [selectedUserTokens, setSelectedUserTokens] = useState<any[] | null>(null);
  const [selectedUserTokensName, setSelectedUserTokensName] = useState('');
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [loadingUserTokens, setLoadingUserTokens] = useState(false);

  // AI Action History filter & pagination state
  const [historyDateFilter, setHistoryDateFilter] = useState<'7d'|'1m'|'all'|'custom'>('7d');
  const [historyCustomStart, setHistoryCustomStart] = useState('');
  const [historyCustomEnd, setHistoryCustomEnd] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyModelFilter, setHistoryModelFilter] = useState<string>('all');

  // Poll for active tasks
  useEffect(() => {
    const taskIds = Object.keys(activeTasks).map(Number);
    if (taskIds.length === 0) return;

    const interval = setInterval(async () => {
      for (const id of taskIds) {
        try {
          const res = await fetch(`/api/dashboard/admin/tasks/${id}`);
          const data = await res.json();
          if (data.success) {
            const task = data.task;

            if (task.status === 'completed' && activeTasks[id]?.status !== 'completed') {
              setCompletedUpdateTask(task);
            }

            setActiveTasks(prev => ({ ...prev, [id]: task }));
            setDbStatus(prev => ({ ...prev, [task.type]: task }));

            if (task.status === 'completed' || task.status === 'failed') {
              setActiveTasks(prev => {
                const next = { ...prev };
                delete next[id];
                return next;
              });
            }
          }
        } catch (err) {
          console.error(`Poll error for task ${id}`, err);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeTasks]);

  // Poll for logs if the selected task is active
  useEffect(() => {
    if (!isLogModalOpen || !selectedTaskId) return;

    const task = activeTasks[selectedTaskId];
    const isTaskActive = task && (task.status === 'processing' || task.status === 'pending');
    if (!isTaskActive) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/dashboard/admin/tasks/${selectedTaskId}/logs`);
        const data = await res.json();
        if (data.success) {
          setSelectedLogs(data.logs);
        }
      } catch (err) {
        console.error('Error polling logs', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [isLogModalOpen, selectedTaskId, activeTasks]);

  // Scroll to bottom when logs update or modal opens (if auto-scroll is enabled)
  useEffect(() => {
    if (isLogModalOpen && logScrollRef.current) {
      if (shouldAutoScroll) {
        logScrollRef.current.scrollTop = logScrollRef.current.scrollHeight;
      }
    }
  }, [selectedLogs, isLogModalOpen, shouldAutoScroll]);

  const handleLogScroll = () => {
    const container = logScrollRef.current;
    if (!container) return;

    const threshold = 50; // pixels from the bottom
    const isAtBottom = container.scrollHeight - container.clientHeight - container.scrollTop <= threshold;
    setShouldAutoScroll(isAtBottom);
  };

  useEffect(() => {
    if (!sessionLoading && !session?.is_authenticated) {
      router.push('/');
    }
  }, [session, sessionLoading, router]);

  useEffect(() => {
    if (session?.is_authenticated) {
      if (session.is_admin) {
        fetchUsers();
        fetchTokenUsage();
        fetchAllTokenDetails();
      } else {
        setUsers([{
          id: session.id || 0,
          username: session.username || 'Unknown',
          is_admin: false,
          role: 'user',
          ai_provider: session.ai_provider || 'elsa',
          is_active: true,
          created_at: new Date().toISOString()
        }]);
        setActiveTab((prev) => (prev === 'users' ? 'tokens' : prev));
        fetchUserTokenDetails(session.id || 0, session.username || '');
      }
    }
  }, [session]);

  const fetchTokenUsage = async () => {
    setLoadingTokenUsage(true);
    try {
      const res = await fetch('/api/dashboard/admin/token_usage');
      const data = await res.json();
      if (data.success) {
        setTokenUsage(data.usage);
      }
    } catch (err) {
      console.error('Failed to fetch token usage', err);
    } finally {
      setLoadingTokenUsage(false);
    }
  };

  const fetchAllTokenDetails = async () => {
    setLoadingUserTokens(true);
    setHistoryDateFilter('7d');
    setHistoryPage(1);
    try {
      const res = await fetch(`/api/dashboard/admin/token_usage/all`);
      const data = await res.json();
      if (data.success) {
        setSelectedUserTokens(data.details);
      } else {
        alert(data.error || 'Failed to fetch all token details');
      }
    } catch (err) {
      console.error('Fetch all token details error', err);
    } finally {
      setLoadingUserTokens(false);
    }
  };

  const fetchUserTokenDetails = async (userId: number, username: string) => {
    setLoadingUserTokens(true);
    setSelectedUserTokensName(username);
    setIsTokenModalOpen(true);
    setHistoryDateFilter('7d');
    setHistoryPage(1);
    try {
      const res = await fetch(`/api/dashboard/admin/token_usage/${userId}`);
      const data = await res.json();
      if (data.success) {
        setSelectedUserTokens(data.details);
      } else {
        alert(data.error || 'Failed to fetch details');
      }
    } catch (err) {
      console.error('Fetch user token details error', err);
    } finally {
      setLoadingUserTokens(false);
    }
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await fetch('/api/dashboard/admin/users');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      }
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/dashboard/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          role: newRole
        })
      });
      const data = await res.json();
      if (data.success) {
        setNewUsername('');
        setNewPassword('');
        setNewRole('user');
        fetchUsers();
      } else {
        alert(data.error || 'Failed to create user');
      }
    } catch (err) {
      console.error('Create user error', err);
    }
  };

  const handleUpdateRole = async (userId: number, role: string) => {
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        fetchUsers();
      } else {
        alert(data.error || 'Could not update role.');
      }
    } catch (err) {
      console.error('Update role error', err);
    }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    if (!confirm(`Are you sure you want to ${isActive ? 'reactivate' : 'deactivate'} this user?`)) return;
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: isActive })
      });
      if (res.ok) fetchUsers();
    } catch (err) {
      console.error('Toggle active error', err);
    }
  };

  const handleChangePassword = async (userId: number) => {
    if (!editPassword) return;
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: editPassword })
      });
      if (res.ok) {
        setEditingUserId(null);
        setEditPassword('');
        alert('Password updated successfully');
      }
    } catch (err) {
      console.error('Change password error', err);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm('Are you sure you want to delete this user?')) return;
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'DELETE'
      });
      if (res.ok) fetchUsers();
      else {
        const data = await res.json();
        alert(data.error || 'Failed to delete user');
      }
    } catch (err) {
      console.error('Delete user error', err);
    }
  };

  const handleSaveUserModel = async (userId: number, provider: string) => {
    setSavingUserModel(true);
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: provider })
      });
      if (res.ok) {
        setEditingUserModelId(null);
        fetchUsers();
        alert('User default AI model updated successfully.');
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to update user AI model');
      }
    } catch (err) {
      console.error('Update user AI model error', err);
      alert('Error updating user AI model');
    } finally {
      setSavingUserModel(false);
    }
  };


  const handleUpdateClick = async (type: string) => {
    setLoadingStats(true);
    setPendingUpdateType(type);
    try {
      const res = await fetch(`/api/dashboard/admin/db_stats/${type}`);
      const data = await res.json();
      if (data.success) {
        setPendingUpdateStats(data.stats);
      } else {
        alert('Failed to load stats: ' + data.error);
        setPendingUpdateType(null);
      }
    } catch (err) {
      console.error('Fetch stats error', err);
      setPendingUpdateType(null);
    } finally {
      setLoadingStats(false);
    }
  };

  const triggerUpdate = async (type: string) => {
    setPendingUpdateType(null);
    setPendingUpdateStats(null);
    try {
      const bodyPayload: any = { type };
      if (type === 'labeling') {
        bodyPayload.skip_unpack = skipUnpack;
        bodyPayload.workers = workers;
        bodyPayload.archived = archived;
        bodyPayload.force = forceUpdate;
      } else if (type === 'generate_drugtox') {
        bodyPayload.local = useLocalDB;
      }
      const res = await fetch('/api/dashboard/admin/update_db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload)
      });
      const data = await res.json();
      if (data.success) {
        const taskId = data.task_id;
        setActiveTasks(prev => ({ ...prev, [taskId]: { id: taskId, type, status: 'processing', progress: 0 } }));
        setDbStatus(prev => ({ ...prev, [type]: { id: taskId, type, status: 'processing', progress: 0 } }));
      } else {
        alert(data.error || 'Failed to trigger update');
      }
    } catch (err) {
      console.error('Trigger update error', err);
    }
  };

  const ProgressBar = ({ progress, status, message, taskId }: { progress: number, status: string, message?: string, taskId?: number }) => {
    const isError = status === 'failed';
    const isComplete = status === 'completed';

    const fetchLogs = async () => {
      if (!taskId) return;
      try {
        const res = await fetch(`/api/dashboard/admin/tasks/${taskId}/logs`);
        const data = await res.json();
        if (data.success) {
          setSelectedLogs(data.logs);
          setSelectedTaskId(taskId);
          setShouldAutoScroll(true);
          setIsLogModalOpen(true);
        } else {
          alert(data.error || 'Failed to fetch logs');
        }
      } catch (err) {
        alert('Error fetching logs');
      }
    };

    const cancelTask = async () => {
      if (!taskId) return;
      if (!window.confirm("Are you sure you want to cancel this task?")) return;
      try {
        const res = await fetch(`/api/dashboard/admin/tasks/${taskId}/cancel`, { method: 'POST' });
        const data = await res.json();
        if (!data.success) alert(data.error || 'Failed to cancel task');
      } catch (err) {
        alert('Error cancelling task');
      }
    };

    return (
      <div style={{ marginTop: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', marginBottom: '4px' }}>
          <span style={{ fontWeight: 700, color: isError ? 'var(--afl-danger-500)' : (isComplete ? 'var(--afl-success-500)' : 'var(--afl-a-500)'), display: 'flex', alignItems: 'center', gap: '8px' }}>
            {status.toUpperCase()}: {message || ''}
            {taskId && (
              <button
                onClick={(e) => { e.stopPropagation(); fetchLogs(); }}
                style={{
                  background: 'var(--afl-n-100)',
                  border: '1px solid var(--afl-n-200)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '0.6rem',
                  cursor: 'pointer',
                  fontWeight: 800
                }}
              >
                VIEW LOGS
              </button>
            )}
            {taskId && (status === 'processing' || status === 'pending') && (
              <button
                onClick={(e) => { e.stopPropagation(); cancelTask(); }}
                style={{
                  background: 'var(--afl-danger-50)',
                  color: 'var(--afl-danger-500)',
                  border: '1px solid var(--afl-danger-100)',
                  borderRadius: '4px',
                  padding: '1px 6px',
                  fontSize: '0.6rem',
                  cursor: 'pointer',
                  fontWeight: 800
                }}
              >
                CANCEL
              </button>
            )}
          </span>
          <span style={{ fontWeight: 800 }}>{progress}%</span>
        </div>
        <div style={{ width: '100%', height: '6px', background: 'var(--afl-n-200)', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: isError ? 'var(--afl-danger-500)' : (isComplete ? 'var(--afl-success-500)' : 'var(--afl-a-500)'),
              transition: 'width 0.4s ease'
            }}
          />
        </div>
      </div>
    );
  };

  if (sessionLoading || !session?.is_authenticated) {
    return <div style={{ padding: '2rem', textAlign: 'center' }}>Verifying access...</div>;
  }

  // Reachable by URL even though the header hides the link; /preferences
  // returns 403 for a guest regardless.
  // Admins always reach this page — it is where Function Control lives, and
  // locking themselves out of it would be unrecoverable.
  if (!session?.is_admin && !(session?.permissions?.preferences ?? false)) {
    return (
      <AccessRestricted
        feature="Settings & Preferences"
        title="Settings & Preferences is not available for your account"
        body="An administrator controls which accounts can use saved preferences from the Function Control panel."
      />
    );
  }

  // AI Action History Filtering & Pagination logic
  const tokensToFilter = selectedUserTokens || [];
  const uniqueModels = Array.from(new Set(tokensToFilter.map((t: any) => t.model_name))).filter(Boolean) as string[];
  
  const historyFilteredTokens = tokensToFilter.filter((t: any) => {
    // Model Filter
    if (historyModelFilter !== 'all' && t.model_name !== historyModelFilter) {
      return false;
    }
    // Date Filter
    if (historyDateFilter === 'all') return true;
    const tDate = new Date(t.created_at);
    const now = new Date();
    if (historyDateFilter === '7d') {
      return (now.getTime() - tDate.getTime()) <= 7 * 24 * 60 * 60 * 1000;
    }
    if (historyDateFilter === '1m') {
      return (now.getTime() - tDate.getTime()) <= 30 * 24 * 60 * 60 * 1000;
    }
    if (historyDateFilter === 'custom') {
      const start = historyCustomStart ? new Date(historyCustomStart) : new Date(0);
      const end = historyCustomEnd ? new Date(historyCustomEnd) : new Date();
      // add 1 day to end to include the entire end day
      end.setHours(23, 59, 59, 999);
      return tDate >= start && tDate <= end;
    }
    return true;
  });

  const totalInputTokens = historyFilteredTokens.reduce((acc: number, t: any) => acc + (t.input_tokens || 0), 0);
  const totalOutputTokens = historyFilteredTokens.reduce((acc: number, t: any) => acc + (t.output_tokens || 0), 0);
  const totalOverallTokens = historyFilteredTokens.reduce((acc: number, t: any) => acc + (t.total_tokens || 0), 0);

  const historyTotalItems = historyFilteredTokens.length;
  const historyTotalPages = Math.ceil(historyTotalItems / 100) || 1;
  const historyPagedTokens = historyFilteredTokens.slice((historyPage - 1) * 100, historyPage * 100);

  return (
    <div className="management-container">
      <Header />

      {/* Log Modal */}
      {isLogModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            padding: '40px'
          }}
          onClick={() => {
            setIsLogModalOpen(false);
            setSelectedTaskId(null);
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '900px',
              maxHeight: '80vh',
              background: 'var(--afl-n-800)',
              borderRadius: '16px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--afl-n-700)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--afl-n-50)', fontWeight: 800 }}>
                Task Execution Logs {selectedTaskId ? `(ID: ${selectedTaskId})` : ''}
              </h3>
              <button
                onClick={() => {
                  setIsLogModalOpen(false);
                  setSelectedTaskId(null);
                }}
                style={{ background: 'var(--afl-n-700)', border: 'none', borderRadius: '4px', color: 'var(--afl-n-400)', padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}
              >
                CLOSE
              </button>
            </div>
            <div
              ref={logScrollRef}
              onScroll={handleLogScroll}
              style={{
                flex: 1,
                padding: '1.5rem',
                overflowY: 'auto',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                lineHeight: 1.6,
                color: 'var(--afl-n-300)',
                whiteSpace: 'pre-wrap',
                background: 'var(--afl-n-900)'
              }}
            >
              {selectedLogs || 'No logs available for this task.'}
            </div>
          </div>
        </div>
      )}

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        <h1 style={{ marginBottom: '2rem', fontSize: '2rem', fontWeight: 900, color: 'var(--afl-n-900)', borderBottom: '2px solid var(--afl-n-200)', paddingBottom: '1rem' }}>
          System Management
        </h1>

        <div style={{ display: 'flex', gap: '2rem', alignItems: 'flex-start' }}>

          {/* SIDEBAR NAVIGATION */}
          <div style={{ width: '250px', display: 'flex', flexDirection: 'column', gap: '0.5rem', flexShrink: 0 }}>
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'ai' ? 'active' : ''}`}
                onClick={() => setActiveTab('ai')}
                disabled={session?.username?.toLowerCase() === 'guest'}
                style={{ opacity: session?.username?.toLowerCase() === 'guest' ? 0.5 : 1, cursor: session?.username?.toLowerCase() === 'guest' ? 'not-allowed' : 'pointer' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                AI Settings
              </button>
            )}
            <button
              className={`sidebar-tab ${activeTab === 'users' ? 'active' : ''}`}
              onClick={() => setActiveTab('users')}
              disabled={session?.username?.toLowerCase() === 'guest'}
              style={{ opacity: session?.username?.toLowerCase() === 'guest' ? 0.5 : 1, cursor: session?.username?.toLowerCase() === 'guest' ? 'not-allowed' : 'pointer' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              {session?.is_admin ? 'User Management' : 'My Account'}
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'apikey' ? 'active' : ''}`}
              onClick={() => setActiveTab('apikey')}
              disabled={session?.username?.toLowerCase() === 'guest'}
              style={{ opacity: session?.username?.toLowerCase() === 'guest' ? 0.5 : 1, cursor: session?.username?.toLowerCase() === 'guest' ? 'not-allowed' : 'pointer' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-1.5 1.5L16 7l-1.5-1.5L13 7l-1.5-1.5L10 7l-1.5-1.5L7 7l-1.5-1.5L4 7l-2-2"></path>
                <circle cx="7.5" cy="15.5" r="5.5"></circle>
                <path d="m11.5 11.5 8.5-8.5"></path>
                <path d="m16 4 4 4"></path>
              </svg>
              API Key
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'tokens' ? 'active' : ''}`}
              onClick={() => setActiveTab('tokens')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              {session?.is_admin ? 'Token Usage' : 'My Token Usage'}
            </button>
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'tools' ? 'active' : ''}`}
                onClick={() => setActiveTab('tools')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                Product Toolbox
              </button>
            )}
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'functions' ? 'active' : ''}`}
                onClick={() => setActiveTab('functions')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Function Control
              </button>
            )}
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'database' ? 'active' : ''}`}
                onClick={() => setActiveTab('database')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                Database Maintenance
              </button>
            )}
          </div>

          {/* MAIN CONTENT AREA */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2rem' }}>


            {activeTab === 'ai' && session?.is_admin && (
              <section id="ai-settings" className="mgmt-card" style={{ maxWidth: '800px' }}>
                <h2 className="section-title">AI Model Preferences</h2>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.95rem', marginBottom: '2rem', lineHeight: 1.5 }}>
                  Select your active AI provider and customize the connection settings for toxicity analysis.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                  
                  {/* Gemini Card */}
                  {!session?.is_internal && (!session?.allowed_ai_providers || session.allowed_ai_providers.includes('gemini')) && (
                  <div 
                    onClick={() => setSelectedProvider('gemini')}
                    style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      border: selectedProvider === 'gemini' ? '2px solid var(--afl-a-500)' : '1px solid var(--afl-n-200)',
                      background: selectedProvider === 'gemini' ? 'var(--afl-a-50)' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: selectedProvider === 'gemini' ? '0 10px 15px -3px rgba(99, 102, 241, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: selectedProvider === 'gemini' ? 'var(--afl-a-500)' : 'var(--afl-n-200)',
                        color: selectedProvider === 'gemini' ? 'white' : 'var(--afl-n-500)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.3s',
                      }}>
                        G
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--afl-n-800)' }}>Google Gemini</span>
                          {selectedProvider === 'gemini' && (
                            <span style={{ background: 'var(--afl-a-500)', color: 'white', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>ACTIVE</span>
                          )}
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.4 }}>
                          High-performance multimodal model from Google. Recommended for standard toxicity analysis.
                        </p>
                      </div>
                    </div>

                    {selectedProvider === 'gemini' && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed var(--afl-n-200)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                          <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Gemini API Key</label>
                          <input
                            type="password"
                            placeholder={session?.has_gemini_key ? "Gemini API Key configured in backend .env (Leave blank to use default)" : "Enter your Gemini API Key"}
                            value={customSettings.gemini.api_key}
                            onChange={(e) => setCustomSettings({
                              ...customSettings,
                              gemini: { ...customSettings.gemini, api_key: e.target.value }
                            })}
                            style={{
                              padding: '0.6rem 0.8rem',
                              borderRadius: '8px',
                              border: '1px solid var(--afl-n-300)',
                              fontSize: '0.9rem',
                              width: '100%',
                              maxWidth: '500px',
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* ELSA Card */}
                  {(!session?.allowed_ai_providers || session.allowed_ai_providers.includes('elsa')) && (
                  <div 
                    onClick={() => setSelectedProvider('elsa')}
                    style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      border: selectedProvider === 'elsa' ? '2px solid var(--afl-a-500)' : '1px solid var(--afl-n-200)',
                      background: selectedProvider === 'elsa' ? 'var(--afl-a-50)' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: selectedProvider === 'elsa' ? '0 10px 15px -3px rgba(99, 102, 241, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: selectedProvider === 'elsa' ? 'var(--afl-a-500)' : 'var(--afl-n-200)',
                        color: selectedProvider === 'elsa' ? 'white' : 'var(--afl-n-500)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.3s',
                      }}>
                        E
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--afl-n-800)' }}>ELSA</span>
                          {selectedProvider === 'elsa' && (
                            <span style={{ background: 'var(--afl-a-500)', color: 'white', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>ACTIVE</span>
                          )}
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.4 }}>
                          FDA Enterprise AI model. Optimized for compliance and institutional toxicity classification.
                        </p>
                      </div>
                    </div>

                    {selectedProvider === 'elsa' && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed var(--afl-n-200)' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', maxWidth: '600px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Elsa URL</label>
                            <input
                              type="text"
                              placeholder={session?.env_elsa_url || "https://elsa.fda.gov/api"}
                              value={customSettings.elsa.url}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                elsa: { ...customSettings.elsa, url: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Elsa User</label>
                            <input
                              type="text"
                              placeholder={session?.env_elsa_user || "Username"}
                              value={customSettings.elsa.user}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                elsa: { ...customSettings.elsa, user: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Elsa Key</label>
                            <input
                              type="password"
                              placeholder={session?.has_elsa_key ? "Elsa Key configured in backend .env (Leave blank to use default)" : "API Key"}
                              value={customSettings.elsa.key}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                elsa: { ...customSettings.elsa, key: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Elsa Model ID</label>
                            <input
                              type="text"
                              placeholder={session?.env_elsa_model_id || "e.g. claude-3-5-sonnet"}
                              value={customSettings.elsa.model_id}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                elsa: { ...customSettings.elsa, model_id: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Elsa Model Name</label>
                            <input
                              type="text"
                              placeholder={session?.env_elsa_model_name || "e.g. CLAUDE_4_SONNET"}
                              value={customSettings.elsa.model_name}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                elsa: { ...customSettings.elsa, model_name: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* vLLM Card */}
                  {(!session?.allowed_ai_providers || session.allowed_ai_providers.includes('vllm') || session.allowed_ai_providers.includes('llama')) && (
                  <div 
                    onClick={() => setSelectedProvider('vllm')}
                    style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      border: selectedProvider === 'vllm' ? '2px solid var(--afl-a-500)' : '1px solid var(--afl-n-200)',
                      background: selectedProvider === 'vllm' ? 'var(--afl-a-50)' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: selectedProvider === 'vllm' ? '0 10px 15px -3px rgba(99, 102, 241, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: selectedProvider === 'vllm' ? 'var(--afl-a-500)' : 'var(--afl-n-200)',
                        color: selectedProvider === 'vllm' ? 'white' : 'var(--afl-n-500)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.3s',
                      }}>
                        V
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--afl-n-800)' }}>vLLM / Llama</span>
                          {selectedProvider === 'vllm' && (
                            <span style={{ background: 'var(--afl-a-500)', color: 'white', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>ACTIVE</span>
                          )}
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.4 }}>
                          Self-hosted LLMs running on vLLM or similar OpenAI-compatible servers.
                        </p>
                      </div>
                    </div>

                    {selectedProvider === 'vllm' && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed var(--afl-n-200)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxWidth: '500px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>vLLM Base URL</label>
                            <input
                              type="text"
                              placeholder={session?.env_vllm_url || "http://localhost:8000/v1"}
                              value={customSettings.vllm.url}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                vllm: { ...customSettings.vllm, url: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>API Key</label>
                            <input
                              type="password"
                              placeholder={session?.has_vllm_key ? "vLLM API Key configured in backend .env (Leave blank to use default)" : "API Key (if required)"}
                              value={customSettings.vllm.api_key}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                vllm: { ...customSettings.vllm, api_key: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Model Name</label>
                            <input
                              type="text"
                              placeholder={session?.env_vllm_model || "e.g. meta-llama/Llama-4-Maverick-17B-Instruct"}
                              value={customSettings.vllm.model_name}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                vllm: { ...customSettings.vllm, model_name: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}

                  {/* Ollama Card */}
                  {(!session?.allowed_ai_providers || session.allowed_ai_providers.includes('ollama')) && (
                  <div 
                    onClick={() => setSelectedProvider('ollama')}
                    style={{
                      padding: '1.5rem',
                      borderRadius: '16px',
                      border: selectedProvider === 'ollama' ? '2px solid var(--afl-a-500)' : '1px solid var(--afl-n-200)',
                      background: selectedProvider === 'ollama' ? 'var(--afl-a-50)' : 'white',
                      cursor: 'pointer',
                      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                      boxShadow: selectedProvider === 'ollama' ? '0 10px 15px -3px rgba(99, 102, 241, 0.1)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        background: selectedProvider === 'ollama' ? 'var(--afl-a-500)' : 'var(--afl-n-200)',
                        color: selectedProvider === 'ollama' ? 'white' : 'var(--afl-n-500)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 'bold',
                        transition: 'all 0.3s',
                      }}>
                        O
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--afl-n-800)' }}>Ollama</span>
                          {selectedProvider === 'ollama' && (
                            <span style={{ background: 'var(--afl-a-500)', color: 'white', fontSize: '0.65rem', padding: '2px 8px', borderRadius: '12px', fontWeight: 800 }}>ACTIVE</span>
                          )}
                        </div>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: 'var(--afl-n-500)', lineHeight: 1.4 }}>
                          Locally running LLMs using Ollama. Run private, offline model inferences on your local device.
                        </p>
                      </div>
                    </div>

                    {selectedProvider === 'ollama' && (
                      <div onClick={(e) => e.stopPropagation()} style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px dashed var(--afl-n-200)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', maxWidth: '500px' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Ollama URL</label>
                            <input
                              type="text"
                              placeholder={session?.env_ollama_url || "http://localhost:11434"}
                              value={customSettings.ollama.url}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                ollama: { ...customSettings.ollama, url: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Model Name</label>
                            <input
                              type="text"
                              placeholder="e.g. llama3, gemma2"
                              value={customSettings.ollama.model_name}
                              onChange={(e) => setCustomSettings({
                                ...customSettings,
                                ollama: { ...customSettings.ollama, model_name: e.target.value }
                              })}
                              style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  )}


                </div>

                <div style={{ marginTop: '2.5rem', borderTop: '1px solid var(--afl-n-200)', paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                    className="btn-primary"
                    style={{
                      padding: '0.75rem 2.0rem',
                      borderRadius: '8px',
                      fontSize: '1rem',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 4px 6px -1px rgba(99, 102, 241, 0.2)',
                      transition: 'all 0.2s',
                    }}
                  >
                    {savingSettings ? 'Saving Settings...' : 'Save AI Settings'}
                  </button>
                </div>
              </section>
            )}

            {activeTab === 'users' && session?.username?.toLowerCase() !== 'guest' && (
              <section className="mgmt-card">
                <h2 className="section-title">User Management</h2>

                {/* Create User Form */}
                {session?.is_admin && (
                  <form onSubmit={handleCreateUser} className="mgmt-form">
                  <div style={{ display: 'flex', gap: '10px', marginBottom: '1rem' }}>
                    <input
                      type="text"
                      placeholder="Username"
                      value={newUsername}
                      onChange={e => setNewUsername(e.target.value)}
                      className="mgmt-input"
                      required
                    />
                    <input
                      type="password"
                      placeholder="Password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      className="mgmt-input"
                      required
                    />
                    <select
                      value={newRole}
                      onChange={e => setNewRole(e.target.value as 'user' | 'developer' | 'admin')}
                      className="mgmt-select"
                      title="Developer is User plus the labeling-database switch"
                    >
                      <option value="user">User</option>
                      <option value="developer">Developer</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button type="submit" className="btn-primary">Add</button>
                  </div>
                </form>
                )}

                <div className="user-table-wrapper">
                  <table className="user-table">
                    <thead>
                      <tr>
                        <th>Username</th>
                        <th>Role</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.filter(u => session?.is_admin || u.id === session?.id).map(user => (
                        <tr key={user.id} style={{ opacity: user.is_active === false ? 0.6 : 1 }}>
                          <td>
                            <div style={{ fontWeight: 700, color: 'var(--afl-n-800)' }}>{user.username}</div>
                            {user.is_active === false && (
                              <span style={{ fontSize: '0.65rem', background: 'var(--afl-danger-100)', color: 'var(--afl-danger-500)', padding: '2px 6px', borderRadius: '4px', fontWeight: 800 }}>DEACTIVATED</span>
                            )}
                          </td>
                          <td>
                            <select
                              value={user.role ?? (user.is_admin ? 'admin' : 'user')}
                              onChange={e => handleUpdateRole(user.id, e.target.value)}
                              className="mgmt-select"
                              disabled={user.is_active === false || !session?.is_admin}
                              title="Developer is User plus the labeling-database switch"
                            >
                              <option value="user">User</option>
                              <option value="developer">Developer</option>
                              <option value="admin">Admin</option>
                            </select>
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button
                                onClick={() => { setEditingUserId(user.id); setEditPassword(''); }}
                                className="btn-ghost"
                                disabled={user.is_active === false}
                              >
                                Password
                              </button>
                              {session?.is_admin && (
                                <button
                                  onClick={() => {
                                    if (editingUserModelId === user.id) {
                                      setEditingUserModelId(null);
                                    } else {
                                      setEditingUserModelId(user.id);
                                      setSelectedUserModelProvider(user.ai_provider || 'elsa');
                                    }
                                  }}
                                  className="btn-ghost"
                                  disabled={user.is_active === false}
                                >
                                  AI Model ({user.ai_provider?.toUpperCase() || 'ELSA'})
                                </button>
                              )}
                              {session?.is_admin && (
                                <>
                                  {user.is_active !== false ? (
                                    <button
                                      onClick={() => handleToggleActive(user.id, false)}
                                      className="btn-ghost"
                                      style={{ color: 'var(--afl-warn-700)', borderColor: 'var(--afl-warn-500)', backgroundColor: 'var(--afl-warn-50)' }}
                                    >
                                      Deactivate
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        onClick={() => handleToggleActive(user.id, true)}
                                        className="btn-ghost"
                                        style={{ color: 'var(--afl-success-700)', borderColor: 'var(--afl-success-500)', backgroundColor: 'var(--afl-success-50)' }}
                                      >
                                        Reactivate
                                      </button>
                                      <button
                                        onClick={() => handleDeleteUser(user.id)}
                                        className="btn-danger-ghost"
                                      >
                                        Delete
                                      </button>
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                            {editingUserId === user.id && (
                              <div style={{ marginTop: '8px', display: 'flex', gap: '5px' }}>
                                <input
                                  type="password"
                                  placeholder="New password"
                                  value={editPassword}
                                  onChange={e => setEditPassword(e.target.value)}
                                  className="mgmt-input-sm"
                                />
                                <button onClick={() => handleChangePassword(user.id)} className="btn-primary-sm">Save</button>
                              </div>
                            )}
                            {editingUserModelId === user.id && (
                              <div style={{ 
                                  marginTop: '8px', 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: '8px',
                                  background: 'var(--afl-n-50)',
                                  padding: '8px 12px',
                                  borderRadius: '8px',
                                  border: '1px solid var(--afl-n-200)',
                                  maxWidth: 'fit-content'
                              }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                                  Set Model:
                                </span>
                                <select
                                  value={selectedUserModelProvider}
                                  onChange={e => setSelectedUserModelProvider(e.target.value)}
                                  className="mgmt-select-sm"
                                  style={{ 
                                      padding: '2px 6px', 
                                      borderRadius: '4px', 
                                      border: '1px solid var(--afl-n-300)',
                                      fontSize: '0.75rem',
                                      fontWeight: 600,
                                      background: 'white'
                                  }}
                                >
                                  <option value="elsa">ELSA</option>
                                  {!session?.is_internal && (!session?.allowed_ai_providers || session.allowed_ai_providers.includes('gemini')) && (
                                    <option value="gemini">Gemini</option>
                                  )}
                                  <option value="vllm">vLLM</option>
                                  <option value="ollama">Ollama</option>
                                </select>
                                <button 
                                  onClick={() => handleSaveUserModel(user.id, selectedUserModelProvider)} 
                                  className="btn-primary-sm"
                                  style={{ fontSize: '0.7rem', padding: '4px 10px', minHeight: 'auto' }}
                                  disabled={savingUserModel}
                                >
                                  {savingUserModel ? 'Saving...' : 'Save'}
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {activeTab === 'apikey' && session?.username?.toLowerCase() !== 'guest' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* API KEY MANAGEMENT CARD */}
                <section className="mgmt-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <div>
                      <h2 className="section-title" style={{ margin: 0 }}>API Access & Keys</h2>
                      <p style={{ color: 'var(--afl-n-500)', fontSize: '0.9rem', margin: '4px 0 0 0' }}>
                        Generate your personal API key for authenticating RESTful search queries to askFDALabel.
                      </p>
                    </div>
                  </div>

                  {apiKey ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div style={{
                        background: 'var(--afl-n-50)',
                        border: '1px solid var(--afl-n-200)',
                        borderRadius: '12px',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--afl-n-700)' }}>
                            Personal REST API Key
                          </span>
                          <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '12px',
                            background: 'var(--afl-success-100)',
                            color: 'var(--afl-success-700)'
                          }}>
                            ACTIVE
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                          <div style={{
                            flex: 1,
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center'
                          }}>
                            <input
                              type={showKey ? 'text' : 'password'}
                              readOnly
                              value={apiKey}
                              style={{
                                width: '100%',
                                padding: '0.65rem 0.85rem',
                                paddingRight: '4.5rem',
                                borderRadius: '8px',
                                border: '1px solid var(--afl-n-300)',
                                background: 'white',
                                fontFamily: 'monospace',
                                fontSize: '0.9rem',
                                color: 'var(--afl-n-900)'
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => setShowKey(!showKey)}
                              style={{
                                position: 'absolute',
                                right: '8px',
                                padding: '4px 8px',
                                fontSize: '0.75rem',
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--afl-n-500)',
                                cursor: 'pointer',
                                fontWeight: 600
                              }}
                            >
                              {showKey ? 'Hide' : 'Reveal'}
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={handleCopyApiKey}
                            className="btn-primary"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '0.65rem 1.25rem',
                              borderRadius: '8px',
                              fontWeight: 700,
                              fontSize: '0.85rem'
                            }}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            {copiedKey ? 'Copied!' : 'Copy Key'}
                          </button>
                        </div>

                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--afl-n-500)' }}>
                          Keep your API key secure. Authenticate requests by sending the header <code style={{ background: 'var(--afl-n-200)', padding: '1px 5px', borderRadius: '4px' }}>X-API-Key: {showKey ? apiKey : 'your_key'}</code> or <code style={{ background: 'var(--afl-n-200)', padding: '1px 5px', borderRadius: '4px' }}>Authorization: Bearer {showKey ? apiKey : 'your_key'}</code>.
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={handleRevokeApiKey}
                          disabled={revokingKey}
                          className="btn-ghost"
                          style={{ color: 'var(--afl-danger-500)', borderColor: 'var(--afl-danger-200)' }}
                        >
                          {revokingKey ? 'Revoking...' : 'Revoke Key'}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateApiKey}
                          disabled={generatingKey}
                          className="btn-ghost"
                          style={{ color: 'var(--afl-a-600)', borderColor: 'var(--afl-a-300)' }}
                        >
                          {generatingKey ? 'Regenerating...' : 'Regenerate New Key'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: '2.5rem 1.5rem',
                      textAlign: 'center',
                      background: 'var(--afl-n-50)',
                      borderRadius: '12px',
                      border: '1px dashed var(--afl-n-300)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '1rem'
                    }}>
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'var(--afl-a-50)',
                        color: 'var(--afl-a-600)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="7.5" cy="15.5" r="5.5"></circle>
                          <path d="m11.5 11.5 8.5-8.5"></path>
                          <path d="m16 4 4 4"></path>
                        </svg>
                      </div>
                      <div>
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--afl-n-800)' }}>
                          No API Key Generated
                        </h3>
                        <p style={{ margin: '6px 0 0 0', color: 'var(--afl-n-500)', fontSize: '0.85rem', maxWidth: '460px' }}>
                          Generate your exclusive API key to query drug labels programmatically using standard RESTful HTTP requests.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateApiKey}
                        disabled={generatingKey}
                        className="btn-primary"
                        style={{ padding: '0.65rem 1.5rem', borderRadius: '8px', fontWeight: 700 }}
                      >
                        {generatingKey ? 'Generating Key...' : 'Generate API Key'}
                      </button>
                    </div>
                  )}
                </section>

                {/* API USAGE & QUICK START DOCUMENTATION */}
                <section className="mgmt-card">
                  <h2 className="section-title">REST API Quick Start Guide</h2>
                  <p style={{ color: 'var(--afl-n-500)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                    The askFDALabel REST API provides direct querying over the official CDER-CBER Oracle labeling database.
                  </p>

                  {/* Dev Server Host Notice */}
                  {(() => {
                    const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov';
                    const devApiUrl = `https://${apiHost}/fdalabel-v3_api/api/v1`;
                    return (
                      <div style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderLeft: '4px solid #2563eb',
                        padding: '1rem 1.25rem',
                        borderRadius: '8px',
                        marginBottom: '1.5rem'
                      }}>
                        <div style={{ fontWeight: 800, color: '#1e40af', marginBottom: '4px', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🚀</span>
                          <span>Development Server API Endpoint</span>
                        </div>
                        <p style={{ margin: '0 0 6px 0', fontSize: '0.88rem', color: '#1e3a8a', lineHeight: 1.55 }}>
                          Current Server Address:{' '}
                          <code style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, fontFamily: 'monospace' }}>
                            {apiHost}/fdalabel-v3_api/api/v1/...
                          </code>
                        </p>
                        <div style={{
                          background: '#fef3c7',
                          border: '1px solid #fde68a',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '0.82rem',
                          color: '#92400e',
                          lineHeight: 1.45
                        }}>
                          ⚠️ <strong>Critical Path Notice:</strong> The server API route prefix is <strong><code>/fdalabel-v3_api/api/</code></strong> (using <code>fdalabel-v3_api/api</code>, <em>not</em> <code>fdalabel-v3/api</code>).
                        </div>
                      </div>
                    );
                  })()}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    {/* Endpoint Overview */}
                    {(() => {
                      const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov';
                      return (
                        <div style={{ background: 'var(--afl-n-50)', padding: '1rem 1.25rem', borderRadius: '8px', border: '1px solid var(--afl-n-200)' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--afl-n-800)', marginBottom: '0.5rem' }}>
                            Primary Endpoints ({apiHost})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            <div><span style={{ color: 'var(--afl-success-700)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/search?q=diabetes&limit=20</div>
                            <div><span style={{ color: 'var(--afl-a-600)', fontWeight: 800 }}>POST</span> /fdalabel-v3_api/api/v1/search (JSON payload)</div>
                            <div><span style={{ color: 'var(--afl-success-700)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/labels/:set_id_or_spl_id <span style={{ color: 'var(--afl-n-500)', fontSize: '0.78rem' }}>(Metadata + Full XML)</span></div>
                            <div><span style={{ color: 'var(--afl-success-700)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/sections/:set_id_or_spl_id?loinc_code=34066-1,34067-9 <span style={{ color: 'var(--afl-n-500)', fontSize: '0.78rem' }}>(Section XMLs)</span></div>
                            <div><span style={{ color: 'var(--afl-success-700)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/pvlabeling/:set_id_or_spl_id <span style={{ color: 'var(--afl-n-500)', fontSize: '0.78rem' }}>(PV-Profile Adverse Events Table JSON)</span></div>
                            <div><span style={{ color: 'var(--afl-success-700)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/status</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Example 1: Full-Text Search */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        1. Full-Text Search
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1/search?q=myocardial+infarction&limit=10" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 2: Product Name & ID Search */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        2. Product Identifier / Application Number Search
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1/search?appl_num=NDA021436&limit=5" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 3: Multi-Section XML Extraction */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        3. Extract Targeted Section XMLs by LOINC Code (Boxed Warning, Indications, etc.)
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`# Multi-section query (34066-1 Boxed Warning & 34067-9 Indications)
curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1/sections/7e606a5b-010e-4050-bf6c-6712b32bbbc4?loinc_code=34066-1,34067-9" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 4: PV-Profile Adverse Events Export JSON */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        4. PV-Profile / PV Labeling Adverse Event Table (JSON corresponding to CSV export)
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`# Returns adverse events, severity tiers, frequencies, MedDRA PTs, and leftover matches
curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1/pvlabeling/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 5: Label Metadata & Full XML */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        5. Retrieve Label Metadata and Full SPL XML
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1/labels/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: ${apiKey || 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 6: Python Script */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--afl-n-700)', marginBottom: '4px' }}>
                        6. Python Integration Example (Fetch PV-Profile Adverse Events Table)
                      </div>
                      <pre style={{
                        background: 'var(--afl-n-900)',
                        color: 'var(--afl-n-50)',
                        padding: '0.85rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`import requests

base_url = "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov'}/fdalabel-v3_api/api/v1"
headers = {"X-API-Key": "${apiKey || 'YOUR_API_KEY'}"}

set_id = "7e606a5b-010e-4050-bf6c-6712b32bbbc4"
pv_resp = requests.get(f"{base_url}/pvlabeling/{set_id}", headers=headers)

if pv_resp.status_code == 200:
    data = pv_resp.json()
    print(f"Total Adverse Events: {data['summary']['total_adverse_events']}")
    for ae in data.get("adverse_events", []):
        print(f"[{ae['severity_tier_label']}] {ae['side_effect_pt']} ({ae['drug_frequency']}) - {ae['meddra_soc']}")
else:
    err = pv_resp.json()
    print("Notice:", err.get("message"))
    print("Generate here:", err.get("pv_profile_tool_url"))`}
                      </pre>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeTab === 'tokens' && (
              <section className="mgmt-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>{session?.is_admin ? 'Global AI Action History' : 'My AI Action History'}</h2>
                  {session?.is_admin && (
                    <button 
                      className="btn-primary" 
                      onClick={() => setIsTokenModalOpen(true)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                      </svg>
                      Show Top 10 Users Summary
                    </button>
                  )}
                </div>

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', marginBottom: '1rem', padding: '0.5rem', background: 'var(--afl-n-50)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--afl-n-600)' }}>Filter Date:</div>
                      <select 
                        value={historyDateFilter} 
                        onChange={(e) => { setHistoryDateFilter(e.target.value as any); setHistoryPage(1); }}
                        style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                      >
                        <option value="7d">Last 7 Days</option>
                        <option value="1m">Last 1 Month</option>
                        <option value="all">All Time</option>
                        <option value="custom">Custom Range</option>
                      </select>
                    </div>
                    
                    {historyDateFilter === 'custom' && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <input type="date" value={historyCustomStart} onChange={e => { setHistoryCustomStart(e.target.value); setHistoryPage(1); }} style={{ padding: '4px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--afl-n-300)' }} />
                        <span style={{ fontSize: '0.8rem', color: 'var(--afl-n-500)' }}>to</span>
                        <input type="date" value={historyCustomEnd} onChange={e => { setHistoryCustomEnd(e.target.value); setHistoryPage(1); }} style={{ padding: '4px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid var(--afl-n-300)' }} />
                      </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--afl-n-600)' }}>Filter Model:</div>
                      <select 
                        value={historyModelFilter} 
                        onChange={(e) => { setHistoryModelFilter(e.target.value); setHistoryPage(1); }}
                        style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid var(--afl-n-300)', fontSize: '0.85rem' }}
                      >
                        <option value="all">All Models</option>
                        {uniqueModels.map(model => (
                          <option key={model} value={model}>{model}</option>
                        ))}
                      </select>
                    </div>
                    
                    <div style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--afl-n-500)' }}>
                      {historyTotalItems} record{historyTotalItems !== 1 ? 's' : ''} found
                    </div>
                  </div>

                  {/* Aggregated Token Counts Summary */}
                  <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(3, 1fr)', 
                    gap: '1rem', 
                    marginBottom: '1.5rem',
                    background: 'var(--afl-n-50)',
                    padding: '1.25rem',
                    borderRadius: '12px',
                    border: '1px solid var(--afl-n-200)'
                  }}>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--afl-n-200)', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Input Tokens</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--afl-n-900)', marginTop: '4px' }}>
                        {totalInputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--afl-n-200)', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Output Tokens</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--afl-n-900)', marginTop: '4px' }}>
                        {totalOutputTokens.toLocaleString()}
                      </div>
                    </div>
                    <div style={{ background: 'white', padding: '1rem', borderRadius: '8px', border: '1px solid var(--afl-n-200)', boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-500)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Overall Tokens</div>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--afl-a-500)', marginTop: '4px' }}>
                        {totalOverallTokens.toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="user-table-wrapper">
                    <table className="user-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                      <thead>
                        <tr>
                          <th style={{ padding: '0 12px 8px', borderBottom: 'none' }}>Timestamp</th>
                          {session?.is_admin && <th style={{ padding: '0 12px 8px', borderBottom: 'none' }}>Username</th>}
                          <th style={{ padding: '0 12px 8px', borderBottom: 'none' }}>Model</th>
                          <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Input</th>
                          <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Output</th>
                          <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingUserTokens ? (
                          <tr><td colSpan={session?.is_admin ? 6 : 5} style={{ textAlign: 'center', padding: '24px', color: 'var(--afl-n-400)' }}>Loading detailed usage...</td></tr>
                        ) : historyFilteredTokens.length === 0 ? (
                          <tr><td colSpan={session?.is_admin ? 6 : 5} style={{ textAlign: 'center', padding: '24px', color: 'var(--afl-n-400)' }}>No records found for the selected date range.</td></tr>
                        ) : (
                          historyPagedTokens.map((record: any) => (
                            <tr key={record.id} style={{ background: 'var(--afl-n-50)', borderRadius: '8px' }}>
                              <td style={{ padding: '12px', borderBottom: 'none', borderRadius: '8px 0 0 8px', fontSize: '0.85rem', color: 'var(--afl-n-600)' }}>
                                {new Date(record.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                              </td>
                              {session?.is_admin && (
                                <td style={{ padding: '12px', borderBottom: 'none', fontSize: '0.85rem', color: 'var(--afl-n-700)', fontWeight: 600 }}>
                                  {record.username}
                                </td>
                              )}
                              <td style={{ padding: '12px', borderBottom: 'none', fontSize: '0.85rem', fontWeight: 600, color: 'var(--afl-n-700)' }}>
                                <span style={{ background: 'var(--afl-n-200)', padding: '4px 8px', borderRadius: '6px' }}>{record.model_name}</span>
                              </td>
                              <td style={{ padding: '12px', borderBottom: 'none', textAlign: 'right', fontSize: '0.9rem', color: 'var(--afl-n-500)' }}>
                                {record.input_tokens.toLocaleString()}
                              </td>
                              <td style={{ padding: '12px', borderBottom: 'none', textAlign: 'right', fontSize: '0.9rem', color: 'var(--afl-n-500)' }}>
                                {record.output_tokens.toLocaleString()}
                              </td>
                              <td style={{ padding: '12px', borderBottom: 'none', borderRadius: '0 8px 8px 0', textAlign: 'right', fontWeight: 800, color: 'var(--afl-n-900)' }}>
                                {record.total_tokens.toLocaleString()}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                  
                  {!loadingUserTokens && historyTotalPages > 1 && (
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                      <button 
                        disabled={historyPage === 1}
                        onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                        style={{ padding: '6px 12px', background: historyPage === 1 ? 'var(--afl-n-100)' : 'var(--afl-n-200)', color: historyPage === 1 ? 'var(--afl-n-400)' : 'var(--afl-n-700)', border: 'none', borderRadius: '6px', cursor: historyPage === 1 ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                      >
                        Previous
                      </button>
                      <span style={{ fontSize: '0.85rem', color: 'var(--afl-n-600)' }}>
                        Page {historyPage} of {historyTotalPages}
                      </span>
                      <button 
                        disabled={historyPage === historyTotalPages}
                        onClick={() => setHistoryPage(p => Math.min(historyTotalPages, p + 1))}
                        style={{ padding: '6px 12px', background: historyPage === historyTotalPages ? 'var(--afl-n-100)' : 'var(--afl-n-200)', color: historyPage === historyTotalPages ? 'var(--afl-n-400)' : 'var(--afl-n-700)', border: 'none', borderRadius: '6px', cursor: historyPage === historyTotalPages ? 'not-allowed' : 'pointer', fontSize: '0.85rem' }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'tools' && session?.is_admin && (
              <div className="mgmt-section">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>Product Toolbox Access Control</h2>
                  <button className="btn-ghost" onClick={fetchFeatureGates} disabled={loadingFeatures}>
                    {loadingFeatures ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '4px' }}>
                  Control which analytical and clinical tools in the label <strong>Product Toolbox</strong> are open to standard users.
                  Changes take effect immediately across all active user sessions.
                </p>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '12px 16px', margin: '14px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.25rem' }}>🧰</span>
                  <div style={{ fontSize: '0.82rem', color: '#166534', lineHeight: 1.5 }}>
                    <strong>Default User Open Tools:</strong> DILI Agent, DICT Agent, Compare, Rule of Two.
                    <br />
                    All other clinical tools (DIRI, PGx, FAERS, Examine, Deep Dive, Archived Versions, Application Profile) are restricted to <em>Developer & Admin</em> by default.
                  </div>
                </div>

                {featureError && (
                  <div style={{ background: 'var(--afl-danger-100)', color: '#991b1b', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>
                    ⚠️ {featureError}
                  </div>
                )}

                {loadingFeatures && features.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--afl-n-400)' }}>Loading toolbox tools...</div>
                ) : (
                  <div className="user-table-wrapper">
                    <table className="user-table">
                      <thead>
                        <tr>
                          <th>Tool Name & Description</th>
                          <th style={{ width: '180px' }}>Minimum Role</th>
                          <th style={{ width: '120px' }}>Guest Access</th>
                        </tr>
                      </thead>
                      <tbody>
                        {features
                          .filter((f: any) => f.category === 'Product Toolbox')
                          .map((f: any) => {
                            const changed =
                              f.min_role !== f.default_min_role ||
                              Boolean(f.allow_guest) !== Boolean(f.default_allow_guest);
                            const isOpenToUser = f.min_role === 'user';
                            return (
                              <tr key={f.key} style={{ opacity: savingFeature === f.key ? 0.6 : 1 }}>
                                <td>
                                  <div style={{ fontWeight: 700, color: 'var(--afl-n-800)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span>{f.name}</span>
                                    <span
                                      style={{
                                        fontSize: '0.65rem',
                                        fontWeight: 800,
                                        letterSpacing: '0.04em',
                                        textTransform: 'uppercase',
                                        background: isOpenToUser ? '#dcfce7' : '#f1f5f9',
                                        color: isOpenToUser ? '#15803d' : '#64748b',
                                        padding: '2px 8px',
                                        borderRadius: '4px',
                                        border: isOpenToUser ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                                      }}
                                    >
                                      {isOpenToUser ? '✓ Open to User' : 'Restricted (Dev/Admin)'}
                                    </span>
                                    {changed && (
                                      <span title="Differs from built-in default" style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--afl-info-100, #dbeafe)', color: 'var(--afl-info-700, #1d4ed8)', padding: '2px 6px', borderRadius: '4px' }}>
                                        Customized
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--afl-n-500)', marginTop: '2px' }}>{f.blurb}</div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--afl-n-400)', marginTop: '2px' }}>
                                    Enforced at {f.enforced_at}
                                  </div>
                                </td>
                                <td>
                                  <select
                                    className="mgmt-select"
                                    value={f.min_role}
                                    disabled={savingFeature === f.key}
                                    onChange={e => updateFeatureGate(f.key, { min_role: e.target.value })}
                                  >
                                    {featureRoles.map(r => (
                                      <option key={r} value={r}>
                                        {r.charAt(0).toUpperCase() + r.slice(1)} and above
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td>
                                  {f.guest_relevant ? (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                                      <input
                                        type="checkbox"
                                        checked={Boolean(f.allow_guest)}
                                        disabled={savingFeature === f.key}
                                        onChange={e => updateFeatureGate(f.key, { allow_guest: e.target.checked })}
                                      />
                                      Allow
                                    </label>
                                  ) : (
                                    <span title="The role requirement already excludes the shared guest account" style={{ fontSize: '0.75rem', color: 'var(--afl-n-400)' }}>
                                      n/a
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'functions' && session?.is_admin && (
              <div className="mgmt-section">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>Function Control</h2>
                  <button className="btn-ghost" onClick={fetchFeatureGates} disabled={loadingFeatures}>
                    {loadingFeatures ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '4px' }}>
                  Each function below is gated by account role. Changes apply immediately —
                  no restart — and reach open sessions within a minute. Both the API and the
                  interface read the same rule, so a function you close here cannot be reached
                  by calling the endpoint directly.
                </p>

                {featureError && (
                  <div style={{ background: 'var(--afl-danger-100)', color: '#991b1b', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>
                    ⚠️ {featureError}
                  </div>
                )}

                {loadingFeatures && features.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--afl-n-400)' }}>Loading functions...</div>
                ) : (
                  <div className="user-table-wrapper">
                    <table className="user-table">
                      <thead>
                        <tr>
                          <th>Function</th>
                          <th style={{ width: '170px' }}>Minimum role</th>
                          <th style={{ width: '120px' }}>Guest</th>
                        </tr>
                      </thead>
                      <tbody>
                        {features
                          .filter((f: any) => f.category !== 'Product Toolbox')
                          .map((f: any) => {
                          const changed =
                            f.min_role !== f.default_min_role ||
                            Boolean(f.allow_guest) !== Boolean(f.default_allow_guest);
                          return (
                            <tr key={f.key} style={{ opacity: savingFeature === f.key ? 0.6 : 1 }}>
                              <td>
                                <div style={{ fontWeight: 700, color: 'var(--afl-n-800)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {f.name}
                                  <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--afl-n-100)', color: 'var(--afl-n-500)', padding: '2px 6px', borderRadius: '4px' }}>
                                    {f.category}
                                  </span>
                                  {changed && (
                                    <span title="Differs from the built-in default" style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--afl-info-100, #dbeafe)', color: 'var(--afl-info-700, #1d4ed8)', padding: '2px 6px', borderRadius: '4px' }}>
                                      Customized
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--afl-n-500)', marginTop: '2px' }}>{f.blurb}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--afl-n-400)', marginTop: '2px' }}>
                                  Enforced at {f.enforced_at}
                                </div>
                              </td>
                              <td>
                                <select
                                  className="mgmt-select"
                                  value={f.min_role}
                                  disabled={savingFeature === f.key}
                                  onChange={e => updateFeatureGate(f.key, { min_role: e.target.value })}
                                >
                                  {featureRoles.map(r => (
                                    <option key={r} value={r}>
                                      {r.charAt(0).toUpperCase() + r.slice(1)} and above
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td>
                                {f.guest_relevant ? (
                                  <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                                    <input
                                      type="checkbox"
                                      checked={Boolean(f.allow_guest)}
                                      disabled={savingFeature === f.key}
                                      onChange={e => updateFeatureGate(f.key, { allow_guest: e.target.checked })}
                                    />
                                    Allow
                                  </label>
                                ) : (
                                  <span title="The role requirement already excludes the shared guest account" style={{ fontSize: '0.75rem', color: 'var(--afl-n-400)' }}>
                                    n/a
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'database' && session?.is_admin && (
              <>
              <section className="mgmt-card">
                <h2 className="section-title">Database Maintenance</h2>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                  Manually trigger background synchronization with local source files (data/downloads).
                </p>

                <div className="update-grid">
                  {[
                    { id: 'labeling', name: 'Drug Labeling', desc: 'Full SPL import from local disk' },
                    { id: 'orangebook', name: 'Orange Book', desc: 'Approved Drug Products with Therapeutic Equivalence Evaluations' },
                    { id: 'generate_drugtox', name: 'Generate DrugTox (AI)', desc: 'Dynamically generate DILI/DICT/DIRI for recently updated single-ingredient human Rx labels' },
                    { id: 'meddra', name: 'MedDRA', desc: 'Dictionary (SOC, HLT, etc.)' }
                  ].map(item => (
                    <div key={item.id} className="update-item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: 800, color: 'var(--afl-n-800)' }}>{item.name}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)' }}>{item.desc}</div>
                        </div>
                        <button
                          onClick={() => handleUpdateClick(item.id)}
                          className="btn-update"
                          disabled={dbStatus[item.id]?.status === 'processing'}
                        >
                          {dbStatus[item.id]?.status === 'processing' ? 'Running...' : 'Update'}
                        </button>
                      </div>

                      {item.id === 'labeling' && (
                        <div style={{ marginTop: '12px', padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid var(--afl-n-200)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--afl-n-600)', marginBottom: '4px' }}>Configuration Options</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--afl-n-700)', cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={skipUnpack} onChange={(e) => setSkipUnpack(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--afl-info-500)' }} />
                              Skip Unpacking
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--afl-n-700)', cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--afl-info-500)' }} />
                              Process Archived (XMLs)
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--afl-n-700)', cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={forceUpdate} onChange={(e) => setForceUpdate(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--afl-danger-500)' }} />
                              <span style={{ color: forceUpdate ? 'var(--afl-danger-500)' : 'inherit', fontWeight: forceUpdate ? 700 : 400 }}>Force Overwrite</span>
                            </label>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--afl-n-700)' }}>
                              <span>Workers:</span>
                              <select value={workers} onChange={(e) => setWorkers(Number(e.target.value))} style={{ padding: '2px 8px', borderRadius: '4px', border: '1px solid var(--afl-n-300)', fontSize: '0.8rem', cursor: 'pointer' }}>
                                <option value={1}>1</option>
                                <option value={4}>4</option>
                                <option value={10}>10</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      )}

                      {item.id === 'generate_drugtox' && (
                        <div style={{ marginTop: '12px', padding: '12px', background: 'white', borderRadius: '8px', border: '1px solid var(--afl-n-200)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ fontWeight: 600, fontSize: '0.8rem', color: 'var(--afl-n-600)', marginBottom: '4px' }}>Configuration Options</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: 'var(--afl-n-700)', cursor: 'pointer', userSelect: 'none' }}>
                              <input type="checkbox" checked={useLocalDB} onChange={(e) => setUseLocalDB(e.target.checked)} style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--afl-info-500)' }} />
                              Use Local DB (Postgres)
                            </label>
                          </div>
                        </div>
                      )}

                      {dbStatus[item.id] && (
                        <ProgressBar
                          progress={dbStatus[item.id].progress}
                          status={dbStatus[item.id].status}
                          message={dbStatus[item.id].message}
                          taskId={dbStatus[item.id].id}
                        />
                      )}
                    </div>
                  ))}
                </div>

                <div style={{ marginTop: '2rem', padding: '1rem', background: 'var(--afl-n-50)', borderRadius: '12px', border: '1px solid var(--afl-n-200)' }}>
                  <div style={{ fontWeight: 800, fontSize: '0.8rem', color: 'var(--afl-n-600)', marginBottom: '8px' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="16" x2="12" y2="12"></line>
                      <line x1="12" y1="8" x2="12.01" y2="8"></line>
                    </svg>
                    Processing Note
                  </div>
                  <p style={{ fontSize: '0.75rem', color: 'var(--afl-n-500)', lineHeight: 1.4, margin: 0 }}>
                    Updates run as background processes. Larger datasets (Labeling, MedDRA) may take 5-10 minutes.
                    Existing data will be replaced using the <code>--force</code> flag.
                  </p>
                </div>
              </section>

              <section className="mgmt-card" style={{ marginTop: '1.5rem' }}>
                <h2 className="section-title">FDALabel Oracle Connection</h2>
                <p style={{ color: 'var(--afl-n-500)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                  Target used when label queries run against Oracle. Values default to the TST server
                  defined in <code>.env</code>; clearing a field falls back to that <code>.env</code> value.
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>Quick apply from .env:</span>
                  <button
                    type="button"
                    onClick={() => applyOraclePreset('dev')}
                    disabled={!oraclePresets}
                    className={oracleForm.oracle_db_env === 'dev' ? 'btn-primary' : 'btn-ghost'}
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                  >
                    DEV
                  </button>
                  <button
                    type="button"
                    onClick={() => applyOraclePreset('tst')}
                    disabled={!oraclePresets}
                    className={oracleForm.oracle_db_env === 'tst' ? 'btn-primary' : 'btn-ghost'}
                    style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                  >
                    TST
                  </button>
                </div>

                <div className="mgmt-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                    Host / URL
                    <input
                      className="mgmt-input"
                      value={oracleForm.host}
                      onChange={e => setOracleForm({ ...oracleForm, host: e.target.value })}
                      placeholder="ncsvmlbldbtst2.fda.gov"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                    Port
                    <input
                      className="mgmt-input"
                      value={oracleForm.port}
                      onChange={e => setOracleForm({ ...oracleForm, port: e.target.value })}
                      placeholder="1521"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                    SID / Service
                    <input
                      className="mgmt-input"
                      value={oracleForm.service}
                      onChange={e => setOracleForm({ ...oracleForm, service: e.target.value })}
                      placeholder="lbltst2"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                    User
                    <input
                      className="mgmt-input"
                      value={oracleForm.user}
                      onChange={e => setOracleForm({ ...oracleForm, user: e.target.value })}
                      autoComplete="off"
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--afl-n-600)' }}>
                    Password
                    <span style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      <input
                        className="mgmt-input"
                        type={showOraclePassword ? 'text' : 'password'}
                        value={oracleForm.password}
                        onChange={e => setOracleForm({ ...oracleForm, password: e.target.value })}
                        autoComplete="new-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOraclePassword(v => !v)}
                        className="btn-ghost"
                        style={{ padding: '6px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                      >
                        {showOraclePassword ? 'Hide' : 'Show'}
                      </button>
                    </span>
                  </label>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button onClick={handleTestOracle} className="btn-ghost" disabled={testingOracle}>
                    {testingOracle ? 'Testing...' : 'Test Connection'}
                  </button>
                  <button onClick={handleSaveOracle} className="btn-primary" disabled={savingOracle}>
                    {savingOracle ? 'Saving...' : 'Save Settings'}
                  </button>
                  {oracleTestResult && (
                    <span style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: oracleTestResult.success ? 'var(--afl-success-700)' : 'var(--afl-danger-500)'
                    }}>
                      {oracleTestResult.success ? '✓ ' : '✕ '}
                      {oracleTestResult.message}
                      {oracleTestResult.success && oracleTestResult.elapsed_ms != null ? ` (${oracleTestResult.elapsed_ms} ms)` : ''}
                    </span>
                  )}
                </div>
              </section>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Modals and Overlays */}
      {/* Confirmation Modal */}
      {pendingUpdateType && (
        <div className="modal-overlay" onClick={() => !loadingStats && setPendingUpdateType(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%', padding: '2rem', borderRadius: '24px', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--afl-n-900)' }}>Confirm Database Update</h3>
            </div>

            {loadingStats ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--afl-n-500)' }}>
                Fetching current database statistics...
              </div>
            ) : pendingUpdateStats ? (
              <div>
                <p style={{ color: 'var(--afl-n-600)', marginBottom: '1.5rem' }}>
                  You are about to run the update script for <strong>{pendingUpdateType}</strong>.
                  Existing data will be overwritten or updated.
                </p>
                <div style={{ background: 'var(--afl-n-50)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--afl-n-200)', marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--afl-n-800)', fontSize: '0.9rem' }}>Current Database Stats</h4>
                  {pendingUpdateStats.total_count ? (
                    <>
                      <div style={{ fontSize: '0.85rem', color: 'var(--afl-n-600)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total MedDRA Records:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.total_count.toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--afl-n-600)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>SOC Terms:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.soc_count.toLocaleString()}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.85rem', color: 'var(--afl-n-600)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total Records:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.count?.toLocaleString() || 0}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--afl-n-600)', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                        <span>Last Revised/Approved Date:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.last_date || 'N/A'}</span>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button onClick={() => setPendingUpdateType(null)} className="btn-ghost">Cancel</button>
                  <button onClick={() => triggerUpdate(pendingUpdateType)} className="btn-primary">Confirm Update</button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Completion Summary Modal */}
      {completedUpdateTask && (
        <div className="modal-overlay" onClick={() => setCompletedUpdateTask(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%', padding: '2rem', borderRadius: '24px', background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ color: 'var(--afl-success-500)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--afl-n-900)' }}>Update Completed</h3>
            </div>

            <p style={{ color: 'var(--afl-n-600)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              The database update task for <strong>{completedUpdateTask.type}</strong> has finished successfully.
            </p>

            {completedUpdateTask.message && (
              <div style={{ background: 'var(--afl-success-50)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--afl-success-500)', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--afl-success-700)', fontSize: '0.9rem' }}>Summary</h4>
                <div style={{ fontSize: '0.85rem', color: 'var(--afl-success-700)' }}>
                  {completedUpdateTask.message}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setCompletedUpdateTask(null)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .sidebar-tab {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: transparent;
          border: none;
          border-radius: 8px;
          font-size: 0.95rem;
          font-weight: 600;
          color: var(--afl-n-500);
          cursor: pointer;
          transition: all 0.2s ease;
          text-align: left;
          width: 100%;
        }
        
        .sidebar-tab:hover {
          background: var(--afl-n-100);
          color: var(--afl-n-700);
        }
        
        .sidebar-tab.active {
          background: var(--afl-a-100);
          color: var(--afl-a-600);
        }

        .sidebar-tab svg {
          opacity: 0.7;
        }
        
        .sidebar-tab.active svg {
          opacity: 1;
        }

        .mgmt-card {
          background: white;
          border-radius: 8px;
          padding: 1.5rem;
          box-shadow: var(--afl-shadow-xs);
          border: 1px solid var(--afl-n-300);
        }

        .section-title {
          font-weight: 600;
          font-size: 1.25rem;
          color: var(--afl-n-800);
          margin-bottom: 1.25rem;
          border-bottom: 1px solid var(--afl-n-200);
          padding-bottom: 0.75rem;
        }
        
        .mgmt-form {
          background: var(--afl-n-50);
          padding: 1rem;
          border-radius: 6px;
          border: 1px solid var(--afl-n-200);
          margin-bottom: 1.5rem;
        }

        .mgmt-input {
          padding: 8px 12px;
          border-radius: 4px;
          border: 1px solid var(--afl-n-300);
          font-size: 0.85rem;
          background: white;
          flex: 1;
        }
        
        .mgmt-input:focus {
          outline: none;
          border-color: var(--afl-info-500);
          box-shadow: 0 0 0 2px var(--afl-info-50);
        }

        .mgmt-input-sm {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid var(--afl-n-300);
          font-size: 0.8rem;
          flex: 1;
        }

        .mgmt-select {
          padding: 6px 12px;
          border-radius: 4px;
          border: 1px solid var(--afl-n-300);
          font-size: 0.85rem;
          color: var(--afl-n-700);
          background: white;
        }

        .btn-primary {
          background: var(--afl-info-700);
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 4px;
          font-weight: 500;
          font-size: 0.85rem;
          cursor: pointer;
          transition: background 0.2s;
        }
        
        .btn-primary:hover {
          background: var(--afl-info-700);
        }

        .btn-primary-sm {
          background: var(--afl-info-700);
          color: white;
          border: none;
          padding: 4px 10px;
          border-radius: 4px;
          font-weight: 500;
          font-size: 0.8rem;
          cursor: pointer;
        }

        .btn-ghost {
          background: white;
          color: var(--afl-n-600);
          border: 1px solid var(--afl-n-300);
          padding: 6px 12px;
          border-radius: 4px;
          font-weight: 500;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-ghost:hover {
          background: var(--afl-n-50);
          color: var(--afl-n-800);
        }

        .btn-danger-ghost {
          background: white;
          color: var(--afl-danger-500);
          border: 1px solid var(--afl-danger-100);
          padding: 6px 12px;
          border-radius: 4px;
          font-weight: 500;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .btn-danger-ghost:hover {
          background: var(--afl-danger-50);
        }

        .user-table-wrapper {
          overflow-x: auto;
          border: 1px solid var(--afl-n-200);
          border-radius: 6px;
        }

        .user-table {
          width: 100%;
          border-collapse: collapse;
          text-align: left;
          font-size: 0.85rem;
        }

        .user-table th {
          font-size: 0.75rem;
          text-transform: uppercase;
          color: var(--afl-n-500);
          font-weight: 600;
          padding: 10px 12px;
          background: var(--afl-n-50);
          border-bottom: 1px solid var(--afl-n-200);
        }

        .user-table td {
          padding: 12px;
          border-bottom: 1px solid var(--afl-n-100);
          color: var(--afl-n-700);
          vertical-align: middle;
        }
        
        .user-table tr:last-child td {
          border-bottom: none;
        }
        
        .user-table tr:hover {
          background-color: var(--afl-n-50);
        }

        .update-grid {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .update-item {
          display: flex;
          align-items: center;
          padding: 1rem;
          background: var(--afl-n-50);
          border-radius: 16px;
          border: 1px solid var(--afl-n-200);
        }

        .btn-update {
          background: white;
          color: var(--afl-n-900);
          border: 1px solid var(--afl-n-200);
          padding: 8px 16px;
          border-radius: 8px;
          font-weight: 800;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }

        .btn-update:hover {
          background: var(--afl-n-900);
          color: white;
          border-color: var(--afl-n-900);
        }
      `}</style>

      {/* Top 10 Users Summary Modal */}
      {isTokenModalOpen && session?.is_admin && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }}>
          <div style={{
            background: 'white', borderRadius: '16px', width: '90%', maxWidth: '800px',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
          }}>
            <div style={{ padding: '24px', borderBottom: '1px solid var(--afl-n-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--afl-n-900)' }}>Top 10 Users Summary</h3>
              <button onClick={() => setIsTokenModalOpen(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px', color: 'var(--afl-n-500)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div style={{ padding: '24px', overflowY: 'auto' }}>
              <table className="user-table" style={{ width: '100%', borderCollapse: 'separate', borderSpacing: '0 8px' }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0 12px 8px', borderBottom: 'none' }}>Username</th>
                    <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>All Time</th>
                    <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Past 30 Days</th>
                    <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Past 7 Days</th>
                    <th style={{ padding: '0 12px 8px', borderBottom: 'none', textAlign: 'right' }}>Past 24 Hrs</th>
                  </tr>
                </thead>
                <tbody>
                  {tokenUsage.length === 0 ? (
                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '24px', color: 'var(--afl-n-400)' }}>No token usage data</td></tr>
                  ) : (
                    [...tokenUsage]
                      .sort((a: any, b: any) => b.stats.total_all_time - a.stats.total_all_time)
                      .slice(0, 10)
                      .map((u: any) => (
                        <tr key={u.user_id} style={{ background: 'var(--afl-n-50)', borderRadius: '8px' }}>
                          <td style={{ padding: '12px', borderBottom: 'none', borderRadius: '8px 0 0 8px', fontWeight: 600, color: 'var(--afl-n-700)' }}>
                            {u.username}
                          </td>
                          <td style={{ padding: '12px', borderBottom: 'none', textAlign: 'right', fontWeight: 800, color: 'var(--afl-n-900)' }}>
                            {u.stats.total_all_time.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', borderBottom: 'none', textAlign: 'right', fontWeight: 600, color: 'var(--afl-n-700)' }}>
                            {u.stats.total_30_days.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', borderBottom: 'none', textAlign: 'right', fontWeight: 600, color: 'var(--afl-n-700)' }}>
                            {u.stats.total_7_days.toLocaleString()}
                          </td>
                          <td style={{ padding: '12px', borderBottom: 'none', borderRadius: '0 8px 8px 0', textAlign: 'right', fontWeight: 600, color: 'var(--afl-n-700)' }}>
                            {u.stats.total_1_day.toLocaleString()}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '16px 24px', borderTop: '1px solid var(--afl-n-200)', display: 'flex', justifyContent: 'flex-end', background: 'var(--afl-n-50)', borderRadius: '0 0 16px 16px' }}>
              <button onClick={() => setIsTokenModalOpen(false)} className="btn-primary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
