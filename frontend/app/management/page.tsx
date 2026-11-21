'use client';

import { Fragment, useState, useEffect, useRef } from 'react';
import { useUser } from '../context/UserContext';
import AccessRestricted from '../components/AccessRestricted';
import Header from '../components/Header';
import './management.css';
import AiPreferences from './AiPreferences';
import { TokenUsagePanel } from './TokenUsagePanel';
import { useRouter } from 'next/navigation';

interface User {
  id: number;
  username: string;
  display_name?: string;
  email?: string | null;
  office?: string | null;
  is_sso?: boolean;
  is_admin: boolean;
  role?: 'user' | 'developer' | 'admin';
  can_comment?: boolean;
  ai_provider: string;
  is_active?: boolean;
  api_key?: string;
  created_at?: string | null;
  last_login?: string | null;
}

interface AdminApiKey {
  user_id: number;
  username: string;
  display_name?: string;
  role: string;
  is_active: boolean;
  has_api_key: boolean;
  api_key: string | null;
  api_key_masked: string | null;
  created_at: string | null;
  last_used_at: string | null;
}

export default function ManagementPage() {
  const { session, loading: sessionLoading, updateAiProvider, refreshSession } = useUser();
  const router = useRouter();

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<'all' | 'user' | 'developer' | 'admin'>('all');
  const [hideDeactivated, setHideDeactivated] = useState<boolean>(true);
  const [userSortBy, setUserSortBy] = useState<'last_login_desc' | 'last_login_asc' | 'created_at_desc' | 'created_at_asc' | 'username_asc'>('last_login_desc');
  const [managingUser, setManagingUser] = useState<User | null>(null);

  // Admin API Keys state
  const [adminApiKeys, setAdminApiKeys] = useState<AdminApiKey[]>([]);
  const [loadingAdminApiKeys, setLoadingAdminApiKeys] = useState(false);
  const [adminKeySearch, setAdminKeySearch] = useState('');
  const [adminKeyFilter, setAdminKeyFilter] = useState<'all' | 'active' | 'never_used' | 'no_key'>('all');
  const [adminKeySortBy, setAdminKeySortBy] = useState<'last_used_desc' | 'last_used_asc' | 'created_at_desc' | 'created_at_asc' | 'username_asc'>('last_used_desc');
  const [revealedKeys, setRevealedKeys] = useState<Record<number, boolean>>({});
  const [copiedKeyUserId, setCopiedKeyUserId] = useState<number | null>(null);
  const [actionInProgressUserId, setActionInProgressUserId] = useState<number | null>(null);

  const formatUserDate = (isoStr?: string | null) => {
    if (!isoStr) return null;
    try {
      const normalized = isoStr.endsWith('Z') || isoStr.includes('+') ? isoStr : `${isoStr}Z`;
      const d = new Date(normalized);
      if (isNaN(d.getTime())) {
        const d2 = new Date(isoStr);
        if (isNaN(d2.getTime())) return isoStr;
        return d2.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      }
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return isoStr;
    }
  };

  const [activeTasks, setActiveTasks] = useState<Record<number, any>>({});

  const [editingUserModelId, setEditingUserModelId] = useState<number | null>(null);
  const [selectedUserModelProvider, setSelectedUserModelProvider] = useState<string>('');
  const [savingUserModel, setSavingUserModel] = useState<boolean>(false);
  const [userModelError, setUserModelError] = useState<string | null>(null);

  // Modals state
  const [activeTab, setActiveTab] = useState<string>('users');
  const [initialTabSet, setInitialTabSet] = useState(false);

  useEffect(() => {
    if (session && !initialTabSet) {
      const requestedTab = typeof window === 'undefined'
        ? null
        : new URLSearchParams(window.location.search).get('tab');
      if (requestedTab === 'ai' && !session.is_guest) {
        setActiveTab('ai');
      } else if (session.username?.toLowerCase() === 'guest') {
        setActiveTab('tokens');
      } else if (session.is_admin) {
        setActiveTab(requestedTab || 'ai');
      } else {
        setActiveTab(requestedTab === 'tokens' ? 'tokens' : requestedTab === 'users' ? 'users' : 'ai');
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
      if (activeTab === 'apikey') setShowKey(false);
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
        setShowKey(false);
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

  const fetchAdminApiKeys = async () => {
    setLoadingAdminApiKeys(true);
    try {
      const res = await fetch('/api/dashboard/admin/api_keys');
      const data = await res.json();
      if (data.success) {
        setAdminApiKeys(data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch admin API keys', err);
    } finally {
      setLoadingAdminApiKeys(false);
    }
  };

  const handleAdminGenerateKey = async (userId: number, username: string) => {
    if (!window.confirm(`Generate or rotate API key for user "${username}"? Any existing key will be invalidated immediately.`)) return;
    setActionInProgressUserId(userId);
    try {
      const res = await fetch(`/api/dashboard/admin/api_keys/${userId}/generate`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        fetchAdminApiKeys();
      } else {
        alert(data.error || 'Failed to generate API key');
      }
    } catch (err) {
      console.error('Error generating API key', err);
      alert('Error generating API key');
    } finally {
      setActionInProgressUserId(null);
    }
  };

  const handleAdminRevokeKey = async (userId: number, username: string) => {
    if (!window.confirm(`Are you sure you want to revoke the API key for user "${username}"? Their REST API calls will fail immediately.`)) return;
    setActionInProgressUserId(userId);
    try {
      const res = await fetch(`/api/dashboard/admin/api_keys/${userId}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (data.success) {
        fetchAdminApiKeys();
      } else {
        alert(data.error || 'Failed to revoke API key');
      }
    } catch (err) {
      console.error('Error revoking API key', err);
      alert('Error revoking API key');
    } finally {
      setActionInProgressUserId(null);
    }
  };

  const handleCopyKey = (key: string, userId: number) => {
    navigator.clipboard.writeText(key);
    setCopiedKeyUserId(userId);
    setTimeout(() => setCopiedKeyUserId(null), 2000);
  };

  const toggleRevealKey = (userId: number) => {
    setRevealedKeys(prev => ({ ...prev, [userId]: !prev[userId] }));
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
  const [dataFiles, setDataFiles] = useState<any[]>([]);
  const [uploadingFileType, setUploadingFileType] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [dbOverview, setDbOverview] = useState<{
    datasets: Record<string, { count: number; last_updated: string | null; last_message: string | null; source_file?: { original_filename?: string | null; uploaded_by?: string | null; updated_at?: string | null } | null }>;
    recent_logs: Array<{ id: number; db_type: string; status: string; message: string | null; completed_at: string | null }>;
  }>({ datasets: {}, recent_logs: [] });
  const [showDbHistory, setShowDbHistory] = useState(false);
  const [showOracleSettings, setShowOracleSettings] = useState(false);
  const [showApiExamples, setShowApiExamples] = useState(false);
  const [userKeyFilter, setUserKeyFilter] = useState<'all' | 'has_key' | 'no_key'>('all');

  const refreshDataFiles = async () => {
    try {
      const [filesRes, overviewRes] = await Promise.all([
        fetch('/api/dashboard/admin/data_files'),
        fetch('/api/dashboard/admin/db_overview'),
      ]);
      const filesData = await filesRes.json();
      if (filesData.success) setDataFiles(filesData.files || []);
      const overviewData = await overviewRes.json();
      if (overviewData.success) {
        setDbOverview({
          datasets: overviewData.datasets || {},
          recent_logs: overviewData.recent_logs || [],
        });
      }
    } catch (err) {
      console.error('Unable to read managed data files', err);
    }
  };

  useEffect(() => {
    if (activeTab === 'database' && session?.is_admin) refreshDataFiles();
  }, [activeTab, session?.is_admin]);

  const uploadDataFile = async (fileType: string, file: File) => {
    setUploadingFileType(fileType);
    setUploadProgress({ ...uploadProgress, [fileType]: 0 });
    try {
      const init = await fetch('/api/dashboard/admin/data_files/upload/init', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: fileType, name: file.name, size: file.size }),
      });
      const initData = await init.json();
      if (!initData.success) throw new Error(initData.error || 'Could not start upload');
      const chunkSize = 10 * 1024 * 1024;
      let offset = initData.received || 0;
      while (offset < file.size) {
        const chunk = file.slice(offset, Math.min(offset + chunkSize, file.size));
        const part = await fetch(`/api/dashboard/admin/data_files/upload/${initData.upload_id}/chunk`, {
          method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Upload-Offset': String(offset) }, body: chunk,
        });
        const partData = await part.json();
        if (!partData.success) throw new Error(partData.error || 'Upload interrupted');
        offset = partData.received;
        setUploadProgress(prev => ({ ...prev, [fileType]: Math.round((offset / file.size) * 100) }));
      }
      const complete = await fetch(`/api/dashboard/admin/data_files/upload/${initData.upload_id}/complete`, { method: 'POST' });
      const completeData = await complete.json();
      if (!completeData.success) throw new Error(completeData.error || 'Could not finish upload');
      await refreshDataFiles();
    } catch (err: any) {
      alert(err.message || 'Upload failed. You can choose the file again to resume with a new upload session.');
    } finally {
      setUploadingFileType(null);
    }
  };

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
        fetchAdminApiKeys();
      } else {
        setUsers([{
          id: session.id || 0,
          username: session.username || 'Unknown',
          display_name: session.display_name,
          is_admin: false,
          role: 'user',
          ai_provider: session.ai_provider || 'elsa',
          is_active: true,
          created_at: new Date().toISOString()
        }]);
        setActiveTab((prev) => (prev === 'users' ? 'tokens' : prev));
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

  const handleToggleCommentPermission = async (userId: number, canComment: boolean) => {
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ can_comment: canComment })
      });
      if (res.ok) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, can_comment: canComment } : u));
        setManagingUser(prev => prev?.id === userId ? { ...prev, can_comment: canComment } : prev);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Failed to update comment permission.');
      }
    } catch (err) {
      console.error('Toggle comment permission error', err);
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

  const handleSaveUserModel = async (userId: number, provider: string): Promise<boolean> => {
    setSavingUserModel(true);
    setUserModelError(null);
    try {
      const res = await fetch(`/api/dashboard/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ai_provider: provider })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setUserModelError(data.error || 'Failed to update user LLM model');
        return false;
      }
      setEditingUserModelId(null);
      setUsers(prev => prev.map(user => user.id === userId ? { ...user, ai_provider: provider } : user));
      setManagingUser(prev => prev?.id === userId ? { ...prev, ai_provider: provider } : prev);
      if (userId === session?.id) await refreshSession();
      return true;
    } catch (err) {
      console.error('Update user AI model error', err);
      setUserModelError('Error updating user LLM model. Please try again.');
      return false;
    } finally {
      setSavingUserModel(false);
    }
  };

  const handleManageUserDone = async () => {
    if (!managingUser || savingUserModel) return;
    if (session?.is_admin && managingUser.is_active !== false &&
        selectedUserModelProvider !== (managingUser.ai_provider || '')) {
      const saved = await handleSaveUserModel(managingUser.id, selectedUserModelProvider);
      if (!saved) return;
    }
    setManagingUser(null);
  };


  const handleUpdateClick = async (type: string) => {
    setLoadingStats(true);
    setPendingUpdateType(type);
    try {
      const preflight = await fetch(`/api/dashboard/admin/update_preflight/${type}`);
      const preflightData = await preflight.json();
      if (preflightData.warning) {
        if (!preflightData.file?.exists) {
          alert(`${preflightData.warning}\n\nUpload the required file in Managed data files before starting this update.`);
          setPendingUpdateType(null);
          return;
        }
        if (!window.confirm(`${preflightData.warning}\n\nContinue with this local file?`)) {
          setPendingUpdateType(null);
          return;
        }
      }
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
      const bodyPayload: any = { type, confirm_file_warning: true };
      if (type === 'monthly_labeling') {
        bodyPayload.workers = workers;
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
          <span style={{ fontWeight: 700, color: isError ? 'var(--fdl-red)' : (isComplete ? 'var(--fdl-green)' : 'var(--fdl-blue-600)'), display: 'flex', alignItems: 'center', gap: '8px' }}>
            {status.toUpperCase()}: {message || ''}
            {taskId && (
              <button
                onClick={(e) => { e.stopPropagation(); fetchLogs(); }}
                style={{
                  background: 'var(--fdl-line-soft)',
                  border: '1px solid var(--fdl-line)',
                  borderRadius: '2px',
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
                  background: 'var(--fdl-red-050)',
                  color: 'var(--fdl-red)',
                  border: '1px solid var(--fdl-red-050)',
                  borderRadius: '2px',
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
        <div style={{ width: '100%', height: '6px', background: 'var(--fdl-line)', borderRadius: '2px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              background: isError ? 'var(--fdl-red)' : (isComplete ? 'var(--fdl-green)' : 'var(--fdl-blue-600)'),
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
            background: 'rgba(7, 31, 61, 0.58)',
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
              background: 'var(--fdl-ink)',
              borderRadius: '2px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: 'var(--fdl-elevation-3, 0 12px 32px rgba(7, 31, 61, 0.18))', borderTop: '3px solid var(--fdl-blue-600)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '1.25rem', borderBottom: '1px solid var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: 'var(--fdl-canvas)', fontWeight: 800 }}>
                Task Execution Logs {selectedTaskId ? `(ID: ${selectedTaskId})` : ''}
              </h3>
              <button
                onClick={() => {
                  setIsLogModalOpen(false);
                  setSelectedTaskId(null);
                }}
                style={{ background: 'var(--fdl-ink-soft)', border: 'none', borderRadius: '2px', color: 'var(--fdl-muted)', padding: '4px 12px', cursor: 'pointer', fontWeight: 700 }}
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
                color: 'var(--fdl-line)',
                whiteSpace: 'pre-wrap',
                background: 'var(--fdl-ink)'
              }}
            >
              {selectedLogs || 'No logs available for this task.'}
            </div>
          </div>
        </div>
      )}

      <main className="management-main">
        <h1 className="management-title">
          {session?.is_admin ? 'System Management' : 'Settings & Preferences'}
        </h1>

        <div className="management-workstation">

          {/* SIDEBAR NAVIGATION */}
          <nav className="management-nav" aria-label="System management sections">
            {!session?.is_guest && (
              <button
                className={`sidebar-tab ${activeTab === 'ai' ? 'active' : ''}`}
                aria-current={activeTab === 'ai' ? 'page' : undefined}
                onClick={() => setActiveTab('ai')}
                disabled={session?.username?.toLowerCase() === 'guest'}
                style={{ opacity: session?.username?.toLowerCase() === 'guest' ? 0.5 : 1, cursor: session?.username?.toLowerCase() === 'guest' ? 'not-allowed' : 'pointer' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                  <line x1="12" y1="22.08" x2="12" y2="12"></line>
                </svg>
                LLM Settings
              </button>
            )}
            <button
              className={`sidebar-tab ${activeTab === 'users' ? 'active' : ''}`}
                aria-current={activeTab === 'users' ? 'page' : undefined}
              onClick={() => setActiveTab('users')}
              disabled={session?.username?.toLowerCase() === 'guest'}
              style={{ opacity: session?.username?.toLowerCase() === 'guest' ? 0.5 : 1, cursor: session?.username?.toLowerCase() === 'guest' ? 'not-allowed' : 'pointer' }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
              {session?.is_admin ? 'User Management' : 'My Account'}
            </button>
            <button
              className={`sidebar-tab ${activeTab === 'apikey' ? 'active' : ''}`}
                aria-current={activeTab === 'apikey' ? 'page' : undefined}
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
                aria-current={activeTab === 'tokens' ? 'page' : undefined}
              onClick={() => setActiveTab('tokens')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              {session?.is_admin ? 'Token Usage' : 'My Token Usage'}
            </button>
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'tools' ? 'active' : ''}`}
                aria-current={activeTab === 'tools' ? 'page' : undefined}
                onClick={() => setActiveTab('tools')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>
                Product Toolbox
              </button>
            )}
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'functions' ? 'active' : ''}`}
                aria-current={activeTab === 'functions' ? 'page' : undefined}
                onClick={() => setActiveTab('functions')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                Function Control
              </button>
            )}
            {session?.is_admin && (
              <button
                className={`sidebar-tab ${activeTab === 'database' ? 'active' : ''}`}
                aria-current={activeTab === 'database' ? 'page' : undefined}
                onClick={() => setActiveTab('database')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                Database Maintenance
              </button>
            )}
          </nav>

          {/* MAIN CONTENT AREA */}
          <div className="management-content">


            {activeTab === 'ai' && !session?.is_guest && <AiPreferences />}

            {activeTab === 'users' && session?.username?.toLowerCase() !== 'guest' && (
              <section className="mgmt-card">
                <h2 className="section-title">{session?.is_admin ? 'User Management' : 'My Account'}</h2>

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

                <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '1rem', marginTop: '1rem' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <input
                      type="text"
                      placeholder="Search by name, username or email..."
                      value={userSearch}
                      onChange={e => setUserSearch(e.target.value)}
                      className="mgmt-input"
                      style={{ width: '100%' }}
                    />
                  </div>
                  <select
                    value={userRoleFilter}
                    onChange={e => setUserRoleFilter(e.target.value as any)}
                    className="mgmt-select"
                    style={{ minWidth: '120px' }}
                  >
                    <option value="all">All Roles</option>
                    <option value="user">User</option>
                    <option value="developer">Developer</option>
                    <option value="admin">Admin</option>
                  </select>
                  <select
                    value={userSortBy}
                    onChange={e => setUserSortBy(e.target.value as any)}
                    className="mgmt-select"
                    style={{ minWidth: '170px' }}
                  >
                    <option value="last_login_desc">Last Login (Newest)</option>
                    <option value="last_login_asc">Last Login (Oldest)</option>
                    <option value="created_at_desc">Created (Newest)</option>
                    <option value="created_at_asc">Created (Oldest)</option>
                    <option value="username_asc">Name (A-Z)</option>
                  </select>
                  {session?.is_admin && (
                    <select
                      value={userKeyFilter}
                      onChange={e => setUserKeyFilter(e.target.value as 'all' | 'has_key' | 'no_key')}
                      className="mgmt-select"
                      style={{ minWidth: '125px' }}
                    >
                      <option value="all">All API Keys</option>
                      <option value="has_key">Has API Key</option>
                      <option value="no_key">No API Key</option>
                    </select>
                  )}
                  {session?.is_admin && (
                    <label
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        minHeight: '34px',
                        padding: '6px 10px',
                        border: '1px solid var(--fdl-line)',
                        borderRadius: '2px',
                        background: 'var(--fdl-paper)',
                        color: 'var(--fdl-ink)',
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                      title="When checked, deactivated user accounts are hidden from the list"
                    >
                      <input
                        type="checkbox"
                        checked={hideDeactivated}
                        onChange={e => setHideDeactivated(e.target.checked)}
                        style={{ width: '15px', height: '15px', cursor: 'pointer', accentColor: 'var(--fdl-blue-600)' }}
                      />
                      Hide deactivated users
                    </label>
                  )}
                </div>

                <div className="user-table-wrapper">
                  <table className="user-table">
                    <thead>
                      <tr>
                        <th style={{ width: '24%', maxWidth: '220px' }}>User</th>
                        <th style={{ width: '14%', minWidth: '110px' }}>Role</th>
                        {session?.is_admin && <th style={{ width: '16%', minWidth: '120px' }}>API Key</th>}
                        <th style={{ width: '16%', minWidth: '120px' }}>Comments</th>
                        <th style={{ width: '18%', minWidth: '130px' }}>Last Login</th>
                        <th style={{ width: '12%', minWidth: '80px', textAlign: 'right' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const filtered = users
                          .filter(u => session?.is_admin || u.id === session?.id)
                          .filter(u => {
                            if (userSearch.trim()) {
                              const q = userSearch.toLowerCase();
                              if (![u.display_name, u.username, u.email, u.office].some(value => value?.toLowerCase().includes(q))) return false;
                            }
                            if (userRoleFilter !== 'all') {
                              const r = u.role ?? (u.is_admin ? 'admin' : 'user');
                              if (r !== userRoleFilter) return false;
                            }
                            if (hideDeactivated && u.is_active === false) return false;
                            if (session?.is_admin && userKeyFilter !== 'all') {
                              const kInfo = adminApiKeys.find(k => k.user_id === u.id);
                              const hasKey = Boolean(kInfo?.has_api_key);
                              if (userKeyFilter === 'has_key' && !hasKey) return false;
                              if (userKeyFilter === 'no_key' && hasKey) return false;
                            }
                            return true;
                          })
                          .sort((a, b) => {
                            if (userSortBy === 'username_asc') {
                              return (a.display_name || a.username).localeCompare(b.display_name || b.username);
                            }
                            if (userSortBy === 'created_at_desc') {
                              return (b.created_at || '').localeCompare(a.created_at || '');
                            }
                            if (userSortBy === 'created_at_asc') {
                              return (a.created_at || '').localeCompare(b.created_at || '');
                            }
                            if (userSortBy === 'last_login_asc') {
                              if (!a.last_login && !b.last_login) return 0;
                              if (!a.last_login) return 1;
                              if (!b.last_login) return -1;
                              return a.last_login.localeCompare(b.last_login);
                            }
                            // default: last_login_desc
                            if (!a.last_login && !b.last_login) return (b.created_at || '').localeCompare(a.created_at || '');
                            if (!a.last_login) return 1;
                            if (!b.last_login) return -1;
                            return b.last_login.localeCompare(a.last_login);
                          });

                        if (filtered.length === 0) {
                          return (
                            <tr>
                              <td colSpan={session?.is_admin ? 6 : 5} style={{ textAlign: 'center', padding: '24px', color: 'var(--fdl-muted)' }}>
                                No users found matching filters.
                              </td>
                            </tr>
                          );
                        }

                        return filtered.map(user => (
                          <tr key={user.id} style={{ opacity: user.is_active === false ? 0.6 : 1 }}>
                            <td style={{ maxWidth: '240px' }}>
                              <div
                                style={{
                                  fontWeight: 700,
                                  color: 'var(--fdl-ink)',
                                  fontSize: '0.9rem',
                                  maxWidth: '240px',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                                title={user.display_name || user.username}
                              >
                                {user.display_name || user.username}
                              </div>
                              {user.is_active === false && (
                                <span style={{ fontSize: '0.65rem', background: 'var(--fdl-red-050)', color: 'var(--fdl-red)', padding: '2px 6px', borderRadius: '2px', fontWeight: 800, marginTop: '2px', display: 'inline-block' }}>DEACTIVATED</span>
                              )}
                              <div style={{ fontSize: '0.75rem', color: 'var(--fdl-canvas0)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                Joined {formatUserDate(user.created_at) || '—'}
                              </div>
                            </td>
                            <td style={{ minWidth: '130px' }}>
                              <select
                                value={user.role ?? (user.is_admin ? 'admin' : 'user')}
                                onChange={e => handleUpdateRole(user.id, e.target.value)}
                                className="mgmt-select"
                                disabled={user.is_active === false || !session?.is_admin}
                                title="Developer is User plus the labeling-database switch"
                                style={{ width: '100%', minWidth: '110px', maxWidth: '140px' }}
                              >
                                <option value="user">User</option>
                                <option value="developer">Developer</option>
                                <option value="admin">Admin</option>
                              </select>
                            </td>
                            {session?.is_admin && (
                              <td>
                                {(() => {
                                  const kInfo = adminApiKeys.find(k => k.user_id === user.id);
                                  if (!kInfo?.has_api_key) {
                                    return <span style={{ fontSize: '0.75rem', color: 'var(--fdl-muted)' }}>None</span>;
                                  }
                                  if (kInfo.last_used_at) {
                                    return (
                                      <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#15803d', background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '2px 7px', borderRadius: '2px', whiteSpace: 'nowrap' }} title={`Last used: ${new Date(kInfo.last_used_at).toLocaleString()}`}>
                                        Active · {new Date(kInfo.last_used_at).toLocaleDateString()}
                                      </span>
                                    );
                                  }
                                  return (
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', padding: '2px 7px', borderRadius: '2px', whiteSpace: 'nowrap' }}>
                                      Unused
                                    </span>
                                  );
                                })()}
                              </td>
                            )}
                            <td style={{ minWidth: '140px' }}>
                              <button
                                type="button"
                                disabled={user.is_active === false || !session?.is_admin}
                                onClick={() => handleToggleCommentPermission(user.id, !(user.can_comment !== false))}
                                className="btn-ghost"
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '0.78rem',
                                  fontWeight: 700,
                                  borderRadius: '2px',
                                  color: user.can_comment !== false ? '#15803d' : '#b91c1c',
                                  backgroundColor: user.can_comment !== false ? '#dcfce7' : '#fee2e2',
                                  borderColor: user.can_comment !== false ? '#86efac' : '#fca5a5',
                                  cursor: session?.is_admin ? 'pointer' : 'default',
                                }}
                                title={session?.is_admin ? "Click to toggle commenting, annotations & LLM notes permission" : undefined}
                              >
                                {user.can_comment !== false ? '✓ Enabled' : '✕ Disabled'}
                              </button>
                            </td>
                            <td style={{ minWidth: '140px' }}>
                              {user.last_login ? (
                                <span style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', whiteSpace: 'nowrap' }}>
                                  {formatUserDate(user.last_login)}
                                </span>
                              ) : (
                                <span style={{ fontSize: '0.85rem', color: 'var(--fdl-muted)', fontStyle: 'italic' }}>
                                  Never
                                </span>
                              )}
                            </td>
                            <td style={{ minWidth: '90px', textAlign: 'right' }}>
                              <button
                                onClick={() => {
                                  setUserModelError(null);
                                  setManagingUser(user);
                                  setEditPassword('');
                                  const legacyMap: Record<string, string> = { vllm: 'local-1', llama: 'local-1', 'llama-4': 'local-1', muse: 'local-2' };
                                  setSelectedUserModelProvider(legacyMap[user.ai_provider] || user.ai_provider || '');
                                }}
                                className="btn-ghost"
                                style={{ padding: '6px 14px', fontWeight: 600, fontSize: '0.8rem' }}
                              >
                                Manage
                              </button>
                            </td>
                          </tr>
                        ));
                      })()}
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
                      <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.9rem', margin: '4px 0 0 0' }}>
                        Generate your personal API key for authenticating RESTful search queries to askFDALabel.
                      </p>
                    </div>
                  </div>

                  {apiKey ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                      <div style={{
                        background: 'var(--fdl-canvas)',
                        border: '1px solid var(--fdl-line)',
                        borderRadius: '2px',
                        padding: '1.25rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.75rem'
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            Personal REST API Key
                          </span>
                          <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            padding: '2px 8px',
                            borderRadius: '2px',
                            background: 'var(--fdl-green-050)',
                            color: 'var(--fdl-green)'
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
                                borderRadius: '2px',
                                border: '1px solid var(--fdl-line)',
                                background: 'white',
                                fontFamily: 'monospace',
                                fontSize: '0.9rem',
                                color: 'var(--fdl-ink)'
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
                                color: 'var(--fdl-canvas0)',
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
                              borderRadius: '2px',
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

                        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fdl-canvas0)' }}>
                          Keep your API key secure. Authenticate requests by sending the header <code style={{ background: 'var(--fdl-line)', padding: '1px 5px', borderRadius: '2px' }}>X-API-Key: {showKey ? apiKey : 'your_key'}</code> or <code style={{ background: 'var(--fdl-line)', padding: '1px 5px', borderRadius: '2px' }}>Authorization: Bearer {showKey ? apiKey : 'your_key'}</code>.
                        </p>
                      </div>

                      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                        <button
                          type="button"
                          onClick={handleRevokeApiKey}
                          disabled={revokingKey}
                          className="btn-ghost"
                          style={{ color: 'var(--fdl-red)', borderColor: 'var(--fdl-red)' }}
                        >
                          {revokingKey ? 'Revoking...' : 'Revoke Key'}
                        </button>
                        <button
                          type="button"
                          onClick={handleGenerateApiKey}
                          disabled={generatingKey}
                          className="btn-ghost"
                          style={{ color: 'var(--fdl-blue-700)', borderColor: 'var(--fdl-line)' }}
                        >
                          {generatingKey ? 'Regenerating...' : 'Regenerate New Key'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{
                      padding: '2.5rem 1.5rem',
                      textAlign: 'center',
                      background: 'var(--fdl-canvas)',
                      borderRadius: '2px',
                      border: '1px dashed var(--fdl-line)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: '1rem'
                    }}>
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '50%',
                        background: 'var(--fdl-blue-050)',
                        color: 'var(--fdl-blue-700)',
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
                        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--fdl-ink)' }}>
                          No API Key Generated
                        </h3>
                        <p style={{ margin: '6px 0 0 0', color: 'var(--fdl-canvas0)', fontSize: '0.85rem', maxWidth: '460px' }}>
                          Generate your exclusive API key to query drug labels programmatically using standard RESTful HTTP requests.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleGenerateApiKey}
                        disabled={generatingKey}
                        className="btn-primary"
                        style={{ padding: '0.65rem 1.5rem', borderRadius: '2px', fontWeight: 700 }}
                      >
                        {generatingKey ? 'Generating Key...' : 'Generate API Key'}
                      </button>
                    </div>
                  )}
                </section>

                {/* API USAGE & QUICK START DOCUMENTATION */}
                <section className="mgmt-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <div>
                      <h2 className="section-title" style={{ margin: 0 }}>REST API Quick Start &amp; Code Examples</h2>
                      <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.84rem', margin: '4px 0 0' }}>
                        Endpoint URLs, curl commands, and Python examples using your key.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShowApiExamples(v => !v)}
                      style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
                    >
                      {showApiExamples ? 'Hide Examples ▴' : 'Show Examples ▾'}
                    </button>
                  </div>
                  {showApiExamples && (
                    <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--fdl-line)', paddingTop: '1.25rem' }}>

                  <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                    The askFDALabel REST API provides direct querying over the official CDER-CBER Oracle labeling database.
                  </p>

                  {/* Dev Server Host Notice */}
                  {(() => {
                    const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost';
                    const devApiUrl = `https://${apiHost}/fdalabel-v3_api/api/v1`;
                    return (
                      <div style={{
                        background: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderLeft: '4px solid #2563eb',
                        padding: '1rem 1.25rem',
                        borderRadius: '2px',
                        marginBottom: '1.5rem'
                      }}>
                        <div style={{ fontWeight: 800, color: '#1e40af', marginBottom: '4px', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🚀</span>
                          <span>Development Server API Endpoint</span>
                        </div>
                        <p style={{ margin: '0 0 6px 0', fontSize: '0.88rem', color: '#1e3a8a', lineHeight: 1.55 }}>
                          Current Server Address:{' '}
                          <code style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '2px', fontWeight: 700, fontFamily: 'monospace' }}>
                            {apiHost}/fdalabel-v3_api/api/v1/...
                          </code>
                        </p>
                        <div style={{
                          background: '#fef3c7',
                          border: '1px solid #fde68a',
                          padding: '6px 10px',
                          borderRadius: '2px',
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
                      const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost';
                      return (
                        <div style={{ background: 'var(--fdl-canvas)', padding: '1rem 1.25rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
                          <div style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--fdl-ink)', marginBottom: '0.5rem' }}>
                            Primary Endpoints ({apiHost})
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem', fontFamily: 'monospace' }}>
                            <div><span style={{ color: 'var(--fdl-green)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/search?q=diabetes&limit=20</div>
                            <div><span style={{ color: 'var(--fdl-blue-700)', fontWeight: 800 }}>POST</span> /fdalabel-v3_api/api/v1/search (JSON payload)</div>
                            <div><span style={{ color: 'var(--fdl-green)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/labels/:set_id_or_spl_id <span style={{ color: 'var(--fdl-canvas0)', fontSize: '0.78rem' }}>(Metadata + Full XML)</span></div>
                            <div><span style={{ color: 'var(--fdl-green)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/sections/:set_id_or_spl_id?loinc_code=34066-1,34067-9 <span style={{ color: 'var(--fdl-canvas0)', fontSize: '0.78rem' }}>(Section XMLs)</span></div>
                            <div><span style={{ color: 'var(--fdl-green)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/pvlabeling/:set_id_or_spl_id <span style={{ color: 'var(--fdl-canvas0)', fontSize: '0.78rem' }}>(PV-Profile Adverse Events Table JSON)</span></div>
                            <div><span style={{ color: 'var(--fdl-green)', fontWeight: 800 }}>GET</span> /fdalabel-v3_api/api/v1/status</div>
                          </div>
                        </div>
                      );
                    })()}

                    {/* Example 1: Full-Text Search */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        1. Full-Text Search
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1/search?q=myocardial+infarction&limit=10" \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 2: Product Name & ID Search */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        2. Product Identifier / Application Number Search
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1/search?appl_num=NDA021436&limit=5" \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 3: Multi-Section XML Extraction */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        3. Extract Targeted Section XMLs by LOINC Code (Boxed Warning, Indications, etc.)
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`# Multi-section query (34066-1 Boxed Warning & 34067-9 Indications)
curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1/sections/7e606a5b-010e-4050-bf6c-6712b32bbbc4?loinc_code=34066-1,34067-9" \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 4: PV-Profile Adverse Events Export JSON */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        4. PV-Profile / PV Labeling Adverse Event Table (JSON corresponding to CSV export)
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`# Returns adverse events, severity tiers, frequencies, MedDRA PTs, and leftover matches
curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1/pvlabeling/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 5: Label Metadata & Full XML */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        5. Retrieve Label Metadata and Full SPL XML
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`curl -X GET "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1/labels/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: ${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"`}
                      </pre>
                    </div>

                    {/* Example 6: Python Script */}
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', marginBottom: '4px' }}>
                        6. Python Integration Example (Fetch PV-Profile Adverse Events Table)
                      </div>
                      <pre style={{
                        background: 'var(--fdl-ink)',
                        color: 'var(--fdl-canvas)',
                        padding: '0.85rem 1rem',
                        borderRadius: '2px',
                        fontSize: '0.8rem',
                        overflowX: 'auto',
                        fontFamily: 'monospace'
                      }}>
{`import requests

base_url = "https://${session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'localhost'}/fdalabel-v3_api/api/v1"
headers = {"X-API-Key": "${showKey && apiKey ? apiKey : 'YOUR_API_KEY'}"}

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
                
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'tokens' && (
              <TokenUsagePanel isAdmin={Boolean(session?.is_admin)} />
            )}

            {activeTab === 'tools' && session?.is_admin && (
              <div className="mgmt-section">
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                  <h2 className="section-title" style={{ margin: 0 }}>Product Toolbox Access Control</h2>
                  <button className="btn-ghost" onClick={fetchFeatureGates} disabled={loadingFeatures}>
                    {loadingFeatures ? 'Refreshing...' : 'Refresh'}
                  </button>
                </div>
                <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '4px' }}>
                  Control which analytical and clinical tools in the label <strong>Product Toolbox</strong> are open to standard users.
                  Changes take effect immediately across all active user sessions.
                </p>

                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '2px', padding: '12px 16px', margin: '14px 0', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.25rem' }}>🧰</span>
                  <div style={{ fontSize: '0.82rem', color: '#166534', lineHeight: 1.5 }}>
                    <strong>Default User Open Tools:</strong> DILI Agent, DICT Agent, Compare, Rule of Two.
                    <br />
                    All other clinical tools (DIRI, PGx, FAERS, Examine, Deep Dive, Archived Versions, Application Profile) are restricted to <em>Developer & Admin</em> by default.
                  </div>
                </div>

                {featureError && (
                  <div style={{ background: 'var(--fdl-red-050)', color: '#991b1b', padding: '10px 12px', borderRadius: '2px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>
                    ⚠️ {featureError}
                  </div>
                )}

                {loadingFeatures && features.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fdl-muted)' }}>Loading toolbox tools...</div>
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
                                  <div style={{ fontWeight: 700, color: 'var(--fdl-ink)', display: 'flex', alignItems: 'center', gap: '8px' }}>
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
                                        borderRadius: '2px',
                                        border: isOpenToUser ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                                      }}
                                    >
                                      {isOpenToUser ? '✓ Open to User' : 'Restricted (Dev/Admin)'}
                                    </span>
                                    {changed && (
                                      <span title="Differs from built-in default" style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--fdl-blue-100)', color: 'var(--fdl-blue-700)', padding: '2px 6px', borderRadius: '2px' }}>
                                        Customized
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--fdl-canvas0)', marginTop: '2px' }}>{f.blurb}</div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--fdl-muted)', marginTop: '2px' }}>
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
                                    <span title="The role requirement already excludes the shared guest account" style={{ fontSize: '0.75rem', color: 'var(--fdl-muted)' }}>
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
                <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.85rem', lineHeight: 1.6, marginTop: '4px' }}>
                  Each function below is gated by account role. Changes apply immediately —
                  no restart — and reach open sessions within a minute. Both the API and the
                  interface read the same rule, so a function you close here cannot be reached
                  by calling the endpoint directly.
                </p>

                {featureError && (
                  <div style={{ background: 'var(--fdl-red-050)', color: '#991b1b', padding: '10px 12px', borderRadius: '2px', fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px' }}>
                    ⚠️ {featureError}
                  </div>
                )}

                {loadingFeatures && features.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--fdl-muted)' }}>Loading functions...</div>
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
                                <div style={{ fontWeight: 700, color: 'var(--fdl-ink)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {f.name}
                                  <span style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--fdl-line-soft)', color: 'var(--fdl-canvas0)', padding: '2px 6px', borderRadius: '2px' }}>
                                    {f.category}
                                  </span>
                                  {changed && (
                                    <span title="Differs from the built-in default" style={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', background: 'var(--fdl-blue-100)', color: 'var(--fdl-blue-700)', padding: '2px 6px', borderRadius: '2px' }}>
                                      Customized
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--fdl-canvas0)', marginTop: '2px' }}>{f.blurb}</div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--fdl-muted)', marginTop: '2px' }}>
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
                                  <span title="The role requirement already excludes the shared guest account" style={{ fontSize: '0.75rem', color: 'var(--fdl-muted)' }}>
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
              <section className="mgmt-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
                  <div>
                    <h2 className="section-title" style={{ margin: 0 }}>Database Maintenance</h2>
                    <p style={{ color: 'var(--fdl-canvas0)', fontSize: '0.85rem', margin: '4px 0 0' }}>
                      Manage source packages and synchronize local PostgreSQL datasets. Previous files are archived automatically.
                    </p>
                  </div>
                  <button type="button" onClick={refreshDataFiles} className="btn-ghost" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                    Refresh
                  </button>
                </div>

                {[
                  {
                    groupKey: 'labeling',
                    title: 'Labeling & Reference Databases',
                    hasOracleBar: true,
                    items: [
                      { id: 'monthly_labeling', name: 'Monthly Label Update', sub: 'DailyMed SPL incremental import', fileType: 'dailymed', accept: '.zip', canonicalName: 'dailymed_monthly_update.zip' },
                      { id: 'orangebook', name: 'Orange Book', sub: 'RLD / RS & therapeutic equivalence', fileType: 'orangebook', accept: '.zip', canonicalName: 'EOBZIP.zip' },
                      { id: 'epc', name: 'Pharmacologic Class Indexing', sub: 'EPC, MoA, and physiologic effect', fileType: 'pharmacologic_class', accept: '.zip', canonicalName: 'pharmacologic_class_indexing_spl_files.zip' },
                    ],
                  },
                  {
                    groupKey: 'safety',
                    title: 'Safety & Terminology',
                    hasOracleBar: false,
                    items: [
                      { id: 'drugtox', name: 'AskDrugTox (Excel)', sub: 'Import harmonized toxicity workbook', fileType: 'askdrugtox', accept: '.xlsx', canonicalName: 'askdrugtox_update.xlsx' },
                      { id: 'generate_drugtox', name: 'Generate DrugTox (LLM)', sub: 'Dynamic DILI / DICT / DIRI generation', fileType: null, accept: '', canonicalName: '' },
                      { id: 'meddra', name: 'MedDRA Dictionary', sub: 'SOC, HLGT, HLT, and PT hierarchy', fileType: 'meddra', accept: '.zip', canonicalName: 'meddra.zip' },
                    ],
                  },
                ].map(group => (
                  <div key={group.groupKey} style={{ marginBottom: '1.75rem', border: '1px solid var(--fdl-line)', borderRadius: '4px', background: 'white', overflow: 'hidden' }}>
                    {/* Group Header */}
                    <div style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                      padding: '12px 16px', background: 'var(--fdl-canvas)', borderBottom: '1px solid var(--fdl-line)'
                    }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--fdl-ink)', letterSpacing: '0.01em' }}>
                        {group.title}
                      </span>

                      {group.hasOracleBar && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.74rem', color: 'var(--fdl-canvas0)', fontWeight: 600 }}>
                            Oracle ({(oracleForm.oracle_db_env || 'tst').toUpperCase()})
                          </span>
                          {oracleTestResult && (
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: '5px',
                              fontSize: '0.73rem', fontWeight: 600, padding: '2px 8px', borderRadius: '999px',
                              background: oracleTestResult.success ? '#f0fdf4' : '#fef2f2',
                              color: oracleTestResult.success ? '#15803d' : '#b91c1c',
                              border: `1px solid ${oracleTestResult.success ? '#bbf7d0' : '#fecaca'}`,
                            }}>
                              <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: oracleTestResult.success ? '#16a34a' : '#dc2626' }} />
                              {oracleTestResult.success ? `Connected${oracleTestResult.elapsed_ms != null ? ` (${oracleTestResult.elapsed_ms} ms)` : ''}` : oracleTestResult.message}
                            </span>
                          )}
                          <button type="button" onClick={handleTestOracle} className="btn-ghost" disabled={testingOracle} style={{ padding: '4px 10px', fontSize: '0.74rem', background: 'white' }}>
                            {testingOracle ? 'Testing…' : 'Test Oracle'}
                          </button>
                          <button type="button" onClick={() => setShowOracleSettings(v => !v)} className="btn-ghost" style={{ padding: '4px 10px', fontSize: '0.74rem', background: 'white' }}>
                            {showOracleSettings ? 'Close Settings' : 'Configure'}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Collapsible Oracle Settings Drawer */}
                    {group.hasOracleBar && showOracleSettings && (
                      <div style={{ padding: '14px 16px', background: '#f8fafc', borderBottom: '1px solid var(--fdl-line)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>Environment Preset:</span>
                          <button type="button" onClick={() => applyOraclePreset('dev')} disabled={!oraclePresets} className={oracleForm.oracle_db_env === 'dev' ? 'btn-primary' : 'btn-ghost'} style={{ padding: '4px 12px', fontSize: '0.74rem' }}>DEV</button>
                          <button type="button" onClick={() => applyOraclePreset('tst')} disabled={!oraclePresets} className={oracleForm.oracle_db_env === 'tst' ? 'btn-primary' : 'btn-ghost'} style={{ padding: '4px 12px', fontSize: '0.74rem' }}>TST</button>
                        </div>
                        <div className="mgmt-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px', marginBottom: '10px' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            Host / URL
                            <input className="mgmt-input" value={oracleForm.host} onChange={e => setOracleForm({ ...oracleForm, host: e.target.value })} placeholder="ncsvmlbldbtst2.fda.gov" />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            Port
                            <input className="mgmt-input" value={oracleForm.port} onChange={e => setOracleForm({ ...oracleForm, port: e.target.value })} placeholder="1521" />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            SID / Service
                            <input className="mgmt-input" value={oracleForm.service} onChange={e => setOracleForm({ ...oracleForm, service: e.target.value })} placeholder="lbltst2" />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            User
                            <input className="mgmt-input" value={oracleForm.user} onChange={e => setOracleForm({ ...oracleForm, user: e.target.value })} autoComplete="off" />
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '0.72rem', fontWeight: 700, color: 'var(--fdl-ink-soft)' }}>
                            Password
                            <span style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                              <input className="mgmt-input" type={showOraclePassword ? 'text' : 'password'} value={oracleForm.password} onChange={e => setOracleForm({ ...oracleForm, password: e.target.value })} autoComplete="new-password" />
                              <button type="button" onClick={() => setShowOraclePassword(v => !v)} className="btn-ghost" style={{ padding: '5px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{showOraclePassword ? 'Hide' : 'Show'}</button>
                            </span>
                          </label>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                          <button type="button" onClick={handleSaveOracle} className="btn-primary" disabled={savingOracle} style={{ padding: '6px 14px', fontSize: '0.78rem' }}>
                            {savingOracle ? 'Saving…' : 'Save Oracle Settings'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Unified Aligned Table */}
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: '720px' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--fdl-line)', background: '#fcfcfd' }}>
                            <th style={{ width: '28%', padding: '9px 16px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fdl-canvas0)' }}>Dataset</th>
                            <th style={{ width: '22%', padding: '9px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fdl-canvas0)' }}>Last Synced &amp; Size</th>
                            <th style={{ width: '30%', padding: '9px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fdl-canvas0)' }}>Source Package / Options</th>
                            <th style={{ width: '20%', padding: '9px 16px', textAlign: 'right', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fdl-canvas0)' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {group.items.map((item, idx) => {
                            const fileStat = item.fileType ? dataFiles.find(f => f.type === item.fileType) : null;
                            const busyUpload = item.fileType ? uploadingFileType === item.fileType : false;
                            const info = dbOverview.datasets[item.id];
                            const task = dbStatus[item.id];
                            const lastStr = info?.last_updated
                              ? new Date(info.last_updated).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
                              : 'Never synced';
                            const dotColor = fileStat?.exists ? (fileStat.stale ? '#d97706' : '#16a34a') : '#dc2626';

                            return (
                              <Fragment key={item.id}>
                                <tr style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--fdl-line)' }}>
                                  <td style={{ padding: '12px 16px', verticalAlign: 'middle' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.88rem', color: 'var(--fdl-ink)' }}>{item.name}</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--fdl-canvas0)', marginTop: '2px' }}>{item.sub}</div>
                                  </td>

                                  <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: info?.last_updated ? 'var(--fdl-ink-soft)' : 'var(--fdl-muted)' }}>
                                      {lastStr}
                                    </div>
                                    <div style={{ fontSize: '0.74rem', color: 'var(--fdl-canvas0)', marginTop: '2px' }}>
                                      {info ? `${info.count.toLocaleString()} records` : '—'}
                                    </div>
                                  </td>

                                  <td style={{ padding: '12px', verticalAlign: 'middle' }}>
                                    {item.fileType ? (
                                      <div style={{ fontSize: '0.76rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--fdl-ink)' }}>
                                          <span style={{ width: '7px', height: '7px', borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
                                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={fileStat?.original_filename || item.canonicalName}>
                                            {busyUpload
                                              ? `Uploading ${uploadProgress[item.fileType] || 0}%…`
                                              : fileStat?.exists
                                                ? (fileStat.original_filename || item.canonicalName)
                                                : 'No file uploaded'}
                                          </span>
                                        </div>
                                        {fileStat?.exists && !busyUpload && (
                                          <div style={{ fontSize: '0.71rem', color: 'var(--fdl-canvas0)', marginTop: '3px', paddingLeft: '13px' }}>
                                            {(fileStat.size / 1024 / 1024).toFixed(1)} MB · {new Date(fileStat.updated_at).toLocaleDateString()}
                                            {fileStat.uploaded_by ? ` · ${fileStat.uploaded_by}` : ''}
                                          </div>
                                        )}
                                        {item.id === 'monthly_labeling' && (
                                          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.72rem', color: 'var(--fdl-ink-soft)', marginTop: '5px', paddingLeft: '13px' }}>
                                            <span>Workers:</span>
                                            <select value={workers} onChange={(e) => setWorkers(Number(e.target.value))} style={{ padding: '2px 6px', borderRadius: '2px', border: '1px solid var(--fdl-line)', fontSize: '0.72rem', background: 'white' }}>
                                              <option value={1}>1</option>
                                              <option value={4}>4</option>
                                              <option value={10}>10</option>
                                            </select>
                                          </label>
                                        )}
                                      </div>
                                    ) : (
                                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--fdl-ink-soft)', cursor: 'pointer', userSelect: 'none' }}>
                                        <input type="checkbox" checked={useLocalDB} onChange={(e) => setUseLocalDB(e.target.checked)} style={{ width: '14px', height: '14px', cursor: 'pointer', accentColor: 'var(--fdl-blue-600)' }} />
                                        Use Local DB (Postgres)
                                      </label>
                                    )}
                                  </td>

                                  <td style={{ padding: '12px 16px', verticalAlign: 'middle', textAlign: 'right' }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                      {item.fileType && (
                                        <label className="btn-ghost" style={{ padding: '5px 10px', fontSize: '0.75rem', cursor: busyUpload ? 'wait' : 'pointer', opacity: busyUpload ? 0.6 : 1 }}>
                                          {busyUpload ? 'Uploading…' : 'Upload'}
                                          <input type="file" accept={item.accept} disabled={busyUpload} style={{ display: 'none' }} onChange={e => { const file = e.target.files?.[0]; if (file && item.fileType) uploadDataFile(item.fileType, file); e.currentTarget.value = ''; }} />
                                        </label>
                                      )}
                                      <button
                                        onClick={() => handleUpdateClick(item.id)}
                                        className="btn-update"
                                        style={{ padding: '5px 12px', fontSize: '0.75rem' }}
                                        disabled={task?.status === 'processing'}
                                      >
                                        {task?.status === 'processing' ? 'Running…' : 'Update'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {task && (
                                  <tr>
                                    <td colSpan={4} style={{ padding: '0 16px 12px', background: 'white' }}>
                                      <ProgressBar progress={task.progress} status={task.status} message={task.message} taskId={task.id} />
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* Recent Update History */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                  <button type="button" className="btn-ghost" style={{ fontSize: '0.8rem' }} onClick={() => setShowDbHistory(v => !v)}>
                    {showDbHistory ? 'Hide Update History' : `Recent Update History (${dbOverview.recent_logs.length})`}
                  </button>
                  <span style={{ fontSize: '0.74rem', color: 'var(--fdl-canvas0)' }}>
                    Background updates replace existing records using <code>--force</code>.
                  </span>
                </div>

                {showDbHistory && (
                  <div style={{ marginTop: '0.75rem', border: '1px solid var(--fdl-line)', borderRadius: '4px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--fdl-canvas)', borderBottom: '1px solid var(--fdl-line)' }}>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--fdl-canvas0)' }}>Database</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--fdl-canvas0)' }}>Completed At</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--fdl-canvas0)' }}>Status</th>
                          <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--fdl-canvas0)' }}>Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dbOverview.recent_logs.length === 0 ? (
                          <tr><td colSpan={4} style={{ textAlign: 'center', padding: '16px', fontSize: '0.82rem', color: 'var(--fdl-muted)' }}>No update logs recorded yet.</td></tr>
                        ) : (
                          dbOverview.recent_logs.map((log, i) => (
                            <tr key={log.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--fdl-line)' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: '0.8rem', color: 'var(--fdl-ink-soft)' }}>{log.db_type}</td>
                              <td style={{ padding: '8px 12px', fontSize: '0.8rem', color: 'var(--fdl-canvas0)' }}>
                                {log.completed_at ? new Date(log.completed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                              </td>
                              <td style={{ padding: '8px 12px', fontSize: '0.78rem', fontWeight: 600, color: log.status === 'completed' ? '#15803d' : '#b91c1c' }}>{log.status}</td>
                              <td style={{ padding: '8px 12px', fontSize: '0.78rem', color: 'var(--fdl-ink-soft)' }}>{log.message || '—'}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>
      </main>

      {/* Modals and Overlays */}
      {/* Confirmation Modal */}
      {pendingUpdateType && (
        <div className="modal-overlay" onClick={() => !loadingStats && setPendingUpdateType(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%', padding: '2rem', borderRadius: '2px', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--fdl-ink)' }}>Confirm Database Update</h3>
            </div>

            {loadingStats ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--fdl-canvas0)' }}>
                Fetching current database statistics...
              </div>
            ) : pendingUpdateStats ? (
              <div>
                <p style={{ color: 'var(--fdl-ink-soft)', marginBottom: '1.5rem' }}>
                  You are about to run the update script for <strong>{pendingUpdateType}</strong>.
                  Existing data will be overwritten or updated.
                </p>
                <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)', marginBottom: '1.5rem' }}>
                  <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--fdl-ink)', fontSize: '0.9rem' }}>Current Database Stats</h4>
                  {pendingUpdateStats.total_count ? (
                    <>
                      <div style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total MedDRA Records:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.total_count.toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>SOC Terms:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.soc_count.toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                        <span>Last Updated Date:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.last_date || 'N/A'}</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>Total Records:</span>
                        <span style={{ fontWeight: 600 }}>{pendingUpdateStats.count?.toLocaleString() || 0}</span>
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--fdl-ink-soft)', display: 'flex', justifyContent: 'space-between', marginTop: '0.25rem' }}>
                        <span>Last Updated Date:</span>
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
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px', width: '90%', padding: '2rem', borderRadius: '2px', background: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ color: 'var(--fdl-green)' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              </div>
              <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--fdl-ink)' }}>Update Completed</h3>
            </div>

            <p style={{ color: 'var(--fdl-ink-soft)', marginBottom: '1.5rem', lineHeight: 1.5 }}>
              The database update task for <strong>{completedUpdateTask.type}</strong> has finished successfully.
            </p>

            {completedUpdateTask.message && (
              <div style={{ background: 'var(--fdl-green-050)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-green)', marginBottom: '1.5rem' }}>
                <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--fdl-green)', fontSize: '0.9rem' }}>Summary</h4>
                <div style={{ fontSize: '0.85rem', color: 'var(--fdl-green)' }}>
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


      {/* Manage User Modal */}
      {managingUser && (
        <div className="modal-overlay" onClick={() => { if (!savingUserModel) setManagingUser(null); }}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '520px', width: '90%', padding: '2rem', borderRadius: '2px', background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem', borderBottom: '1px solid var(--fdl-line)', paddingBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--fdl-ink)', fontWeight: 800 }}>
                  Manage Account: {managingUser.display_name || managingUser.username}
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--fdl-canvas0)', marginTop: '4px' }}>
                  Role: <strong style={{ textTransform: 'capitalize' }}>{managingUser.role || (managingUser.is_admin ? 'Admin' : 'User')}</strong>
                  {' • '}
                  Joined: {formatUserDate(managingUser.created_at) || '—'}
                </div>
              </div>
              <button 
                onClick={() => setManagingUser(null)}
                disabled={savingUserModel}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: 'var(--fdl-muted)', padding: '4px 8px' }}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
              <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', border: '1px solid var(--fdl-line)', overflowWrap: 'anywhere' }}>
                <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: '90px 1fr', gap: '8px' }}>
                  <dt>Name</dt><dd style={{ margin: 0 }}>{managingUser.display_name || managingUser.username}</dd>
                  <dt>Username</dt><dd style={{ margin: 0 }}>{managingUser.username}</dd>
                  <dt>Email</dt><dd style={{ margin: 0 }}>{managingUser.email || '—'}</dd>
                  <dt>Office</dt><dd style={{ margin: 0 }}>{managingUser.office || '—'}</dd>
                </dl>
              </div>
              {managingUser.is_sso && <p style={{ margin: 0 }}>SSO account details and password are managed by the identity provider.</p>}
              {/* Password Section */}
              <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink)', marginBottom: '0.5rem' }}>
                  Reset Password
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="password"
                    placeholder="Enter new password"
                    value={editPassword}
                    onChange={e => setEditPassword(e.target.value)}
                    className="mgmt-input"
                    disabled={managingUser.is_active === false || managingUser.is_sso === true}
                  />
                  <button
                    onClick={async () => {
                      await handleChangePassword(managingUser.id);
                    }}
                    className="btn-primary"
                    disabled={!editPassword || managingUser.is_active === false || managingUser.is_sso === true}
                  >
                    Save
                  </button>
                </div>
              </div>

              {/* AI Model Section (Admin Only) */}
              {session?.is_admin && (
                <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink)', marginBottom: '0.5rem' }}>
                    Assigned Model Provider
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <select
                      value={selectedUserModelProvider}
                      onChange={e => { setSelectedUserModelProvider(e.target.value); setUserModelError(null); }}
                      className="mgmt-select"
                      style={{ flex: 1 }}
                      disabled={savingUserModel || managingUser.is_active === false}
                    >
                      <option value="">Follow system default</option>
                      {session?.ai_models?.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
                    </select>
                    <button
                      onClick={async () => {
                        await handleSaveUserModel(managingUser.id, selectedUserModelProvider);
                      }}
                      className="btn-primary"
                      disabled={savingUserModel || managingUser.is_active === false}
                    >
                      {savingUserModel ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                  {userModelError && <p role="alert" style={{ color: 'var(--fdl-red)', margin: '0.75rem 0 0' }}>{userModelError}</p>}
                </div>
              )}

              {/* Comments, Annotations & AI Notes Permission (Admin Only) */}
              {session?.is_admin && (
                <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink)', marginBottom: '0.35rem' }}>
                    Comments, Annotations & LLM Notes Permission
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--fdl-canvas0)', margin: '0 0 0.75rem 0', lineHeight: 1.4 }}>
                    Controls whether this user can post comments & justifications in visual compare, create label highlights/notes, and save LLM notes.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleToggleCommentPermission(managingUser.id, !(managingUser.can_comment !== false))}
                    className="btn-ghost"
                    style={{
                      padding: '6px 14px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      borderRadius: '2px',
                      color: managingUser.can_comment !== false ? '#15803d' : '#b91c1c',
                      backgroundColor: managingUser.can_comment !== false ? '#dcfce7' : '#fee2e2',
                      borderColor: managingUser.can_comment !== false ? '#86efac' : '#fca5a5',
                    }}
                  >
                    {managingUser.can_comment !== false ? '✓ Comments & Notes: Enabled' : '✕ Comments & Notes: Disabled'}
                  </button>
                </div>
              )}

              {/* REST API Key Management (Admin Only) */}
              {session?.is_admin && (() => {
                const kInfo = adminApiKeys.find(k => k.user_id === managingUser.id);
                const isRevealed = Boolean(revealedKeys[managingUser.id]);
                const busyKey = actionInProgressUserId === managingUser.id;
                return (
                  <div style={{ background: 'var(--fdl-canvas)', padding: '1rem', borderRadius: '2px', border: '1px solid var(--fdl-line)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink)' }}>REST API Key</div>
                      {kInfo?.last_used_at && (
                        <span style={{ fontSize: '0.74rem', color: 'var(--fdl-canvas0)' }}>
                          Last used: {new Date(kInfo.last_used_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </span>
                      )}
                    </div>
                    {kInfo?.has_api_key && kInfo.api_key ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                          <code style={{ flex: 1, background: 'white', border: '1px solid var(--fdl-line)', padding: '6px 8px', borderRadius: '2px', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {isRevealed ? kInfo.api_key : kInfo.api_key_masked}
                          </code>
                          <button type="button" className="btn-ghost" style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => setRevealedKeys(prev => ({ ...prev, [managingUser.id]: !prev[managingUser.id] }))}>
                            {isRevealed ? 'Hide' : 'Show'}
                          </button>
                          <button type="button" className="btn-ghost" style={{ padding: '5px 8px', fontSize: '0.75rem' }} onClick={() => handleCopyKey(kInfo.api_key!, managingUser.id)}>
                            {copiedKeyUserId === managingUser.id ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button type="button" className="btn-ghost" disabled={busyKey} style={{ padding: '5px 10px', fontSize: '0.78rem' }} onClick={() => handleAdminGenerateKey(managingUser.id, managingUser.username)}>
                            {busyKey ? 'Working…' : 'Rotate Key'}
                          </button>
                          <button type="button" className="btn-ghost" disabled={busyKey} style={{ padding: '5px 10px', fontSize: '0.78rem', color: 'var(--fdl-red)', borderColor: 'var(--fdl-red)' }} onClick={() => handleAdminRevokeKey(managingUser.id, managingUser.username)}>
                            Revoke Key
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--fdl-muted)' }}>No API key issued for this user.</span>
                        <button type="button" className="btn-primary" disabled={busyKey} style={{ padding: '5px 12px', fontSize: '0.78rem' }} onClick={() => handleAdminGenerateKey(managingUser.id, managingUser.username)}>
                          {busyKey ? 'Generating…' : 'Generate Key'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Account Status / Danger Zone (Admin Only) */}
              {session?.is_admin && (
                <div style={{ borderTop: '1px solid var(--fdl-line)', paddingTop: '1rem' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--fdl-ink)', marginBottom: '0.75rem' }}>
                    Account Status
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                    {managingUser.is_active !== false ? (
                      <button
                        onClick={async () => {
                          await handleToggleActive(managingUser.id, false);
                          setManagingUser(null);
                        }}
                        className="btn-ghost"
                        style={{ color: 'var(--fdl-amber)', borderColor: 'var(--fdl-amber)', backgroundColor: 'var(--fdl-amber-050)' }}
                      >
                        Deactivate Account
                      </button>
                    ) : (
                      <button
                        onClick={async () => {
                          await handleToggleActive(managingUser.id, true);
                          setManagingUser(null);
                        }}
                        className="btn-ghost"
                        style={{ color: 'var(--fdl-green)', borderColor: 'var(--fdl-green)', backgroundColor: 'var(--fdl-green-050)' }}
                      >
                        Reactivate Account
                      </button>
                    )}

                    <button
                      onClick={async () => {
                        await handleDeleteUser(managingUser.id);
                        setManagingUser(null);
                      }}
                      className="btn-danger-ghost"
                    >
                      Delete User
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem', borderTop: '1px solid var(--fdl-line-soft)', paddingTop: '1rem' }}>
              <button onClick={handleManageUserDone} disabled={savingUserModel} className="btn-primary" style={{ minWidth: '100px' }}>
                {savingUserModel ? 'Saving...' : 'Done'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
