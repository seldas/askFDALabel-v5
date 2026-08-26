'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  CartesianGrid
} from 'recharts';
import { labelRoute } from '../../../../platform/context';
import { useUser } from '../../../../context/UserContext';
import './pv-profile.css';

export interface PvOccurrence {
  tier: number;
  section_title: string;
  excerpt: string;
  drug_pct?: number | null;
}

export interface PvItem {
  term: string;
  meddra_pt: string;
  meddra_pt_code?: number | null;
  soc_name: string;
  soc_code?: number | null;
  severity_tier: number;
  section_name: string;
  is_quantitative: boolean;
  is_mapped?: boolean;
  is_manual_adjusted?: boolean;
  drug_frequency_text: string | null;
  drug_min_pct: number | null;
  drug_max_pct: number | null;
  placebo_frequency_text: string | null;
  placebo_pct: number | null;
  risk_difference_pct: number | null;
  frequency_category: string;
  excerpt: string;
  sections_present?: Array<{ tier: number; title: string }>;
  occurrences?: PvOccurrence[];
}

export interface PvLeftoverTerm {
  term: string;
  meddra_pt?: string;
  meddra_pt_code?: number | null;
  soc_name: string;
  soc_code?: number | null;
  section_name: string;
  status: string;
  reason: string;
}

export interface PvPeer {
  index: number;
  set_id: string;
  brand_name: string;
  generic_name: string;
  active_ingredient: string;
  manufacturer_name: string;
  effective_time: string | null;
  dosage_form: string | null;
  is_rld: boolean;
  has_cached_profile: boolean;
}

export interface PvProfileData {
  set_id: string;
  spl_id: string | null;
  brand_name: string;
  generic_name: string;
  active_ingredient: string;
  manufacturer_name: string;
  effective_time: string | null;
  label_format: string;
  generated_at?: string;
  cached: boolean;
  cached_at?: string;
  has_record?: boolean;
  status?: string;
  is_supported?: boolean;
  message?: string;
  total_adverse_events: number;
  severity_tier_defs: Record<number, { level: number; name: string; badge: string; color: string; description: string }>;
  tier_summary: Record<number, number>;
  soc_summary: Array<{ soc_name: string; soc_code?: number; count: number; max_severity_tier: number }>;
  chart_data?: Array<{ soc_name: string; count: number; max_severity_tier: number }>;
  items: PvItem[];
  leftover_terms?: PvLeftoverTerm[];
  total_leftover_terms?: number;
  feedbacks?: Record<string, Array<{ id: number; term: string; feedback_type: string; comment?: string; status?: string }>>;
  harvested_sections: Array<{ code: string; title: string; severity_tier: number }>;
  peers: PvPeer[];
}

export default function PvProfileView({ setId, splId }: { setId: string; splId?: string | null }) {
  const { session } = useUser();
  const isDevOrAdmin = Boolean(session?.is_admin || session?.role === 'admin' || session?.role === 'developer' || session?.has_developer_access);

  const [data, setData] = useState<PvProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // User feedback tags: map term.toLowerCase() -> 'is_ae' | 'not_ae'
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'is_ae' | 'not_ae'>>({});

  // Admin "Update with tags" modal state
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [selectedTermsToApply, setSelectedTermsToApply] = useState<Set<string>>(new Set());
  const [updatingWithTags, setUpdatingWithTags] = useState(false);

  // UI state
  const [showChart, setShowChart] = useState(true);
  const [selectedSoc, setSelectedSoc] = useState<string | null>(null);
  const [showLeftovers, setShowLeftovers] = useState(false);
  const [leftoverSearch, setLeftoverSearch] = useState('');

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<number | 'all' | 'quant' | 'mapped' | 'manual'>('all');
  const [groupBy, setGroupBy] = useState<'tier' | 'soc' | 'flat'>('tier');
  const [sortBy, setSortBy] = useState<'severity' | 'freq_desc' | 'risk_diff' | 'alpha'>('severity');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [activeDrawerItem, setActiveDrawerItem] = useState<PvItem | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Tagged terms eligible to be added to profile
  const taggedTermsToAdd = useMemo(() => {
    const terms: Array<{ term: string; soc_name?: string; section_name?: string }> = [];
    Object.entries(feedbackMap).forEach(([termKey, fbType]) => {
      if (fbType === 'is_ae') {
        const leftoverItem = data?.leftover_terms?.find(
          (lt) => lt.term.toLowerCase() === termKey || (lt.meddra_pt && lt.meddra_pt.toLowerCase() === termKey)
        );
        terms.push({
          term: leftoverItem?.term || termKey,
          soc_name: leftoverItem?.soc_name || 'General disorders',
          section_name: leftoverItem?.section_name || 'Safety Section'
        });
      }
    });
    return terms;
  }, [feedbackMap, data]);

  // Sync feedbacks from server
  useEffect(() => {
    if (data?.feedbacks) {
      const initialMap: Record<string, 'is_ae' | 'not_ae'> = {};
      Object.entries(data.feedbacks).forEach(([termKey, fbList]) => {
        if (fbList && fbList.length > 0) {
          initialMap[termKey] = fbList[fbList.length - 1].feedback_type as 'is_ae' | 'not_ae';
        }
      });
      setFeedbackMap(initialMap);
    }
  }, [data]);

  // Toggle user feedback tag
  const handleToggleFeedback = async (
    term: string,
    feedbackType: 'is_ae' | 'not_ae',
    itemMeta?: { meddra_pt?: string; soc_name?: string; section_name?: string }
  ) => {
    const termKey = term.trim().toLowerCase();
    const currentVal = feedbackMap[termKey];
    const nextVal = currentVal === feedbackType ? undefined : feedbackType;

    // Optimistic local update
    setFeedbackMap((prev) => {
      const next = { ...prev };
      if (nextVal) next[termKey] = nextVal;
      else delete next[termKey];
      return next;
    });

    try {
      await fetch(`/api/dashboard/pv_profile/${encodeURIComponent(setId)}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          term: term,
          feedback_type: feedbackType,
          spl_id: splId,
          meddra_pt: itemMeta?.meddra_pt,
          soc_name: itemMeta?.soc_name,
          section_name: itemMeta?.section_name
        })
      });
    } catch (err) {
      console.error('Failed to record user tag:', err);
    }
  };

  // Admin Action: Confirm and update PV Profile with selected tags
  const handleConfirmUpdateWithTags = async () => {
    setUpdatingWithTags(true);
    try {
      const res = await fetch(`/api/dashboard/pv_profile/${encodeURIComponent(setId)}/update_with_tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved_terms: Array.from(selectedTermsToApply),
          spl_id: splId
        })
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || 'Failed to update profile with tags');
      }
      const updatedData: PvProfileData = await res.json();
      setData(updatedData);
      setShowUpdateModal(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdatingWithTags(false);
    }
  };

  // Live Timer for AI generation
  useEffect(() => {
    if (generating) {
      setElapsedSeconds(0);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [generating]);

  const fetchProfile = useCallback(async (isGenerate = false, isRefresh = false) => {
    if (isGenerate || isRefresh) setGenerating(true);
    else setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (splId) params.set('spl_id', splId);
      if (isGenerate) params.set('generate', '1');
      if (isRefresh) params.set('refresh', '1');

      const url = `/api/dashboard/pv_profile/${encodeURIComponent(setId)}?${params.toString()}`;
      const res = await fetch(url, {
        method: isGenerate || isRefresh ? 'POST' : 'GET',
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || `Failed to fetch PV profile (HTTP ${res.status})`);
      }
      const json: PvProfileData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  }, [setId, splId]);

  useEffect(() => {
    // Initial fetch: check cache without auto-generating
    fetchProfile(false, false);
  }, [fetchProfile]);

  const toggleGroup = (groupKey: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  // Filter and Sort Items
  const filteredAndSortedItems = useMemo(() => {
    if (!data || !data.items) return [];

    let result = data.items.filter((item) => {
      // SOC filter from chart click
      if (selectedSoc && item.soc_name !== selectedSoc) {
        return false;
      }

      // Tier / Mapped / Manual / Quant filter
      if (selectedTierFilter === 'quant') {
        if (!item.is_quantitative || (item.drug_max_pct == null && item.drug_min_pct == null)) return false;
      } else if (selectedTierFilter === 'mapped') {
        if (!item.is_mapped) return false;
      } else if (selectedTierFilter === 'manual') {
        if (!item.is_manual_adjusted) return false;
      } else if (typeof selectedTierFilter === 'number') {
        if (item.severity_tier !== selectedTierFilter) return false;
      }

      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const termMatch = item.term.toLowerCase().includes(q);
        const ptMatch = item.meddra_pt.toLowerCase().includes(q);
        const socMatch = item.soc_name.toLowerCase().includes(q);
        const secMatch = item.section_name.toLowerCase().includes(q);
        if (!termMatch && !ptMatch && !socMatch && !secMatch) return false;
      }

      return true;
    });

    // Sorting
    result = [...result].sort((a, b) => {
      if (sortBy === 'severity') {
        if (a.severity_tier !== b.severity_tier) return a.severity_tier - b.severity_tier;
        const aVal = a.drug_max_pct ?? a.drug_min_pct ?? -1;
        const bVal = b.drug_max_pct ?? b.drug_min_pct ?? -1;
        if (bVal !== aVal) return bVal - aVal;
        return a.meddra_pt.localeCompare(b.meddra_pt);
      }
      if (sortBy === 'freq_desc') {
        const aVal = a.drug_max_pct ?? a.drug_min_pct ?? -1;
        const bVal = b.drug_max_pct ?? b.drug_min_pct ?? -1;
        if (bVal !== aVal) return bVal - aVal;
        return a.severity_tier - b.severity_tier;
      }
      if (sortBy === 'risk_diff') {
        const aDiff = a.risk_difference_pct ?? -999;
        const bDiff = b.risk_difference_pct ?? -999;
        if (bDiff !== aDiff) return bDiff - aDiff;
        return a.severity_tier - b.severity_tier;
      }
      if (sortBy === 'alpha') {
        return a.meddra_pt.localeCompare(b.meddra_pt);
      }
      return 0;
    });

    return result;
  }, [data, selectedSoc, selectedTierFilter, searchQuery, sortBy]);

  // Grouping
  const groupedData = useMemo(() => {
    if (groupBy === 'flat') {
      return [{ key: 'all', title: 'All Safety Signals & Adverse Events', items: filteredAndSortedItems }];
    }

    if (groupBy === 'tier') {
      const groupsMap: Record<number, PvItem[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
      filteredAndSortedItems.forEach((item) => {
        const t = item.severity_tier || 4;
        if (!groupsMap[t]) groupsMap[t] = [];
        groupsMap[t].push(item);
      });

      return [1, 2, 3, 4, 5]
        .filter((t) => groupsMap[t] && groupsMap[t].length > 0)
        .map((t) => {
          const tierDef = data?.severity_tier_defs?.[t] || { name: `Tier ${t}`, badge: `TIER ${t}` };
          return {
            key: `tier-${t}`,
            title: `${tierDef.badge} — ${tierDef.name}`,
            tier: t,
            items: groupsMap[t],
          };
        });
    }

    if (groupBy === 'soc') {
      const socMap: Record<string, PvItem[]> = {};
      filteredAndSortedItems.forEach((item) => {
        const soc = item.soc_name || 'General / Unclassified';
        if (!socMap[soc]) socMap[soc] = [];
        socMap[soc].push(item);
      });

      return Object.keys(socMap)
        .sort((a, b) => socMap[b].length - socMap[a].length)
        .map((soc) => ({
          key: `soc-${soc}`,
          title: soc,
          items: socMap[soc],
        }));
    }

    return [];
  }, [groupBy, filteredAndSortedItems, data]);

  // Chart data: ALL SOCs without omission
  const allSocChartData = useMemo(() => {
    if (!data?.soc_summary) return [];
    return data.soc_summary.map((soc) => ({
      soc_name: soc.soc_name.replace(' disorders', '').replace(' and administration site conditions', ''),
      full_soc_name: soc.soc_name,
      count: soc.count,
      max_severity_tier: soc.max_severity_tier,
    }));
  }, [data]);

  // Leftover terms filtered by search
  const filteredLeftovers = useMemo(() => {
    if (!data?.leftover_terms) return [];
    if (!leftoverSearch.trim()) return data.leftover_terms;
    const q = leftoverSearch.toLowerCase();
    return data.leftover_terms.filter(
      (l) => l.term.toLowerCase().includes(q) || l.soc_name.toLowerCase().includes(q) || l.section_name.toLowerCase().includes(q)
    );
  }, [data, leftoverSearch]);

  // CSV Export (includes main AE table and leftover dictionary matches)
  const exportCsv = () => {
    if (!filteredAndSortedItems.length && (!data?.leftover_terms || !data.leftover_terms.length)) return;

    // 1. Primary AE Table
    const headers = ['Severity Tier', 'Section', 'Side Effect (PT)', 'Raw Term', 'Is Mapped', 'MedDRA SOC', 'Drug Frequency', 'Placebo Frequency', 'Risk Difference (%)', 'Category', 'Excerpt'];
    const rows = filteredAndSortedItems.map((i) => [
      `Tier ${i.severity_tier}`,
      `"${(i.section_name || '').replace(/"/g, '""')}"`,
      `"${(i.meddra_pt || '').replace(/"/g, '""')}"`,
      `"${(i.term || '').replace(/"/g, '""')}"`,
      i.is_mapped ? 'Mapped' : 'Exact Match',
      `"${(i.soc_name || '').replace(/"/g, '""')}"`,
      `"${(i.drug_frequency_text || '').replace(/"/g, '""')}"`,
      `"${(i.placebo_frequency_text || '').replace(/"/g, '""')}"`,
      i.risk_difference_pct != null ? `${i.risk_difference_pct}%` : '',
      i.frequency_category,
      `"${(i.excerpt || '').replace(/"/g, '""')}"`,
    ]);

    let csvParts = [headers.join(','), ...rows.map((e) => e.join(','))];

    // 2. Leftover MedDRA Terms (if present)
    if (data?.leftover_terms && data.leftover_terms.length > 0) {
      csvParts.push('\n');
      csvParts.push('"--- LEFTOVER MEDDRA DICTIONARY MATCHES (Mentioned in text but not included in final profile) ---"');
      csvParts.push('Matched Term,MedDRA Organ Class (SOC),Source Section');
      const leftoverRows = data.leftover_terms.map((lt) => [
        `"${(lt.term || '').replace(/"/g, '""')}"`,
        `"${(lt.soc_name || '').replace(/"/g, '""')}"`,
        `"${(lt.section_name || '').replace(/"/g, '""')}"`
      ]);
      csvParts = csvParts.concat(leftoverRows.map((e) => e.join(',')));
    }

    const csvContent = 'data:text/csv;charset=utf-8,' + csvParts.join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `PV_Profile_${data?.brand_name || setId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Render Helper for SIDER Clinical Evidence & Incidence Data
  const renderDataForDrug = (item: PvItem) => {
    const val = item.drug_max_pct ?? item.drug_min_pct;
    if (val != null) {
      const barWidth = Math.min(100, Math.max(4, (val / 40) * 100));
      return (
        <div className="pv-freq-cell">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', flexWrap: 'wrap' }}>
            <span className="pv-freq-val">
              {item.drug_frequency_text || `${val}%`}
            </span>
            {(item.placebo_pct != null || item.placebo_frequency_text) && (
              <span className="pv-placebo-text">
                vs Placebo {item.placebo_frequency_text || `${item.placebo_pct}%`}
              </span>
            )}
            {item.risk_difference_pct != null && (
              <span className={`pv-risk-diff ${item.risk_difference_pct > 0 ? 'positive' : 'neutral'}`}>
                (Δ {item.risk_difference_pct > 0 ? `+${item.risk_difference_pct}%` : `${item.risk_difference_pct}%`})
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginTop: '0.15rem' }}>
            <div className="pv-sparkbar-track">
              <div className="pv-sparkbar-fill" style={{ width: `${barWidth}%` }} />
            </div>
            {item.frequency_category && item.frequency_category !== 'not_quantified' && (
              <span style={{ fontSize: '0.68rem', color: '#64748b', textTransform: 'capitalize' }}>
                · {item.frequency_category.replace(/_/g, ' ')}
              </span>
            )}
          </div>
        </div>
      );
    }

    // For Boxed Warning & Warnings & Precautions: render clean inline quote snippet
    return (
      <div className="pv-quote-snippet" title={item.excerpt || item.section_name}>
        {item.excerpt ? `\u201C${item.excerpt}\u201D` : `Reported in ${item.section_name}`}
      </div>
    );
  };

  // Format Elapsed Time
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // Dynamic progress stage during AI analysis
  const getProgressStage = (sec: number) => {
    if (sec < 4) return 'Scanning safety sections & matching MedDRA dictionary keywords...';
    if (sec < 14) return 'Calling clinical AI engine to evaluate incidence rates & safety warnings...';
    if (sec < 24) return 'Structuring drug vs. placebo frequencies and identifying non-standard terms...';
    return 'Grounding standard MedDRA Preferred Terms (PT) & primary Organ Classes (SOC)...';
  };

  // 1. Loading Initial Cache Check
  if (loading) {
    return (
      <div className="pv-container">
        <div className="pv-state-card">
          <div className="pv-spinner" />
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#0f172a', fontSize: '1.1rem' }}>Checking PV-Profile status...</h3>
          <p style={{ margin: 0, color: '#64748b', fontSize: '0.85rem' }}>Reading local database cache...</p>
        </div>
      </div>
    );
  }

  // 2. Active AI Generation with Timer & Live Progress
  if (generating) {
    return (
      <div className="pv-container">
        <div className="pv-timer-card">
          <div className="pv-spinner" />
          <h3 style={{ margin: '0 0 0.25rem 0', color: '#0f172a', fontSize: '1.25rem' }}>
            Generating PV-Profile for {data?.brand_name || data?.generic_name || 'Drug Product'}
          </h3>
          <div className="pv-timer-clock">{formatTimer(elapsedSeconds)}</div>
          <p style={{ margin: '0 0 0.5rem 0', color: '#64748b', fontSize: '0.85rem' }}>
            Harvesting safety sections, evaluating dictionary candidate terms, and mapping to MedDRA hierarchy.
          </p>

          <div className="pv-progress-steps">
            <div className="pv-progress-step">
              <span style={{ color: '#ea580c' }}>⏳</span>
              <span><strong>Status:</strong> {getProgressStage(elapsedSeconds)}</span>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9a3412', marginTop: '0.5rem', opacity: 0.85 }}>
              * Full safety analysis typically takes 10 to 25 seconds. The result will be cached for instant retrieval next time.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. Error State
  if (error) {
    return (
      <div className="pv-container">
        <div className="pv-state-card" style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#991b1b' }}>Failed to Load PV-Profile</h3>
          <p style={{ margin: '0 0 1rem 0', color: '#b91c1c', fontSize: '0.85rem' }}>{error}</p>
          <button className="pv-btn pv-btn-primary" onClick={() => fetchProfile(true, true)}>
            Retry Analysis
          </button>
        </div>
      </div>
    );
  }

  // 4. Initial "No Record Yet" Start Screen
  if (data && data.has_record === false) {
    return (
      <div className="pv-container">
        <div className="pv-start-card">
          <div className="pv-start-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#0f172a', fontSize: '1.3rem' }}>
            PV-Profile Not Generated Yet
          </h3>
          <p style={{ margin: '0 auto 1.25rem auto', color: '#64748b', fontSize: '0.875rem', maxWidth: '560px' }}>
            Generate a SIDER 4.1-style Adverse Event & Safety Profile for <strong>{data.brand_name || data.generic_name}</strong>.
            The AI engine will harvest Boxed Warnings, Warnings & Precautions, and Clinical Trial tables to structure drug vs. placebo incidence rates.
          </p>

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
            {data.active_ingredient && <span className="pv-meta-tag"><strong>Ingredient:</strong> {data.active_ingredient}</span>}
            {data.manufacturer_name && <span className="pv-meta-tag"><strong>Applicant:</strong> {data.manufacturer_name}</span>}
            {data.effective_time && <span className="pv-meta-tag"><strong>Date:</strong> {data.effective_time}</span>}
          </div>

          <button
            className="pv-btn pv-btn-primary"
            style={{ padding: '0.65rem 1.5rem', fontSize: '0.95rem', borderRadius: '8px' }}
            onClick={() => fetchProfile(true, false)}
          >
            ⚡ Start PV-Profile Analysis
          </button>

          {data.peers && data.peers.length > 0 && (
            <div style={{ textAlign: 'left', marginTop: '2rem', borderTop: '1px solid #e2e8f0', paddingTop: '1.25rem' }}>
              <h4 style={{ margin: '0 0 0.5rem 0', fontSize: '0.85rem', color: '#475569' }}>
                Other Available Labelings for {data.active_ingredient}:
              </h4>
              <div className="pv-peers-grid">
                {data.peers.slice(0, 4).map((p) => (
                  <div key={p.set_id} className="pv-peer-card">
                    <Link href={labelRoute(p.set_id, 'pv-profile')} className="pv-peer-name">
                      {p.brand_name}
                    </Link>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {p.manufacturer_name} {p.has_cached_profile ? '• (Profile Ready)' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 5. Unsupported / Non-standard SPL Empty State
  if (!data || data.is_supported === false || data.total_adverse_events === 0) {
    return (
      <div className="pv-container">
        <div className="pv-state-card">
          <h3 style={{ margin: '0 0 0.5rem 0', color: '#334155' }}>No Standard Safety Profile Available</h3>
          <p style={{ margin: '0 0 1.25rem 0', color: '#64748b', fontSize: '0.875rem', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
            {data?.message || 'This product labeling does not contain structured safety or adverse reaction sections (e.g. bulk raw materials, medical gas, or unformatted listing).'}
          </p>
          {data?.peers && data.peers.length > 0 && (
            <div style={{ textAlign: 'left', marginTop: '1.5rem' }}>
              <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.85rem', color: '#0f172a' }}>
                Other Available Labelings with Same Active Ingredient ({data.active_ingredient}):
              </h4>
              <div className="pv-peers-grid">
                {data.peers.slice(0, 4).map((p) => (
                  <div key={p.set_id} className="pv-peer-card">
                    <Link href={labelRoute(p.set_id, 'pv-profile')} className="pv-peer-name">
                      {p.brand_name}
                    </Link>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{p.manufacturer_name} • {p.dosage_form || 'N/A'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 6. Main PV-Profile Heatmap & Bar Chart Interface
  return (
    <div className="pv-container">
      {/* Header */}
      <div className="pv-header">
        <div className="pv-title-group">
          <h2>
            PV-Profile: {data.brand_name || data.generic_name || 'Drug Product'}
            <span className="pv-badge pv-badge-tier-4" style={{ fontSize: '0.68rem', marginLeft: '0.4rem' }}>
              {data.label_format}
            </span>
          </h2>
          <div className="pv-meta-sub">
            {data.active_ingredient && <span><strong>Active Substance:</strong>&nbsp;{data.active_ingredient}</span>}
            {data.active_ingredient && <span className="pv-stat-sep">·</span>}
            {data.manufacturer_name && <span><strong>Applicant:</strong>&nbsp;{data.manufacturer_name}</span>}
            {data.manufacturer_name && <span className="pv-stat-sep">·</span>}
            {data.effective_time && <span><strong>Label Date:</strong>&nbsp;{data.effective_time}</span>}
            {data.cached && (
              <>
                <span className="pv-stat-sep">·</span>
                <span className="pv-meta-tag">Cached {data.cached_at ? new Date(data.cached_at).toLocaleDateString() : ''}</span>
              </>
            )}
          </div>
        </div>
        <div className="pv-actions">
          <button className="pv-btn" onClick={exportCsv} title="Export current table to CSV">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </button>
          <button className="pv-btn pv-btn-primary" onClick={() => fetchProfile(true, true)} disabled={generating}>
            {generating ? 'Re-analyzing...' : 'Re-analyze'}
          </button>
          {isDevOrAdmin && (
            <button
              type="button"
              className="pv-btn pv-btn-accent"
              title={
                taggedTermsToAdd.length === 0
                  ? 'No terms currently tagged as Real AE. Tag terms in the leftover list below first.'
                  : `Incorporate ${taggedTermsToAdd.length} reviewer-tagged terms into the safety profile`
              }
              disabled={generating || updatingWithTags || taggedTermsToAdd.length === 0}
              onClick={() => {
                setSelectedTermsToApply(new Set(taggedTermsToAdd.map((t) => t.term.toLowerCase())));
                setShowUpdateModal(true);
              }}
            >
              <span>{updatingWithTags ? 'Updating...' : 'Update with tags'}</span>
              {taggedTermsToAdd.length > 0 && (
                <span className="pv-badge-pill">
                  {taggedTermsToAdd.length}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Publication Metrics Strip */}
      <div className="pv-stats-ribbon">
        <div className="pv-stat-item">
          <span className="pv-stat-label">Total Signals:</span>
          <span className="pv-stat-value">{data.total_adverse_events}</span>
        </div>
        <span className="pv-stat-sep">|</span>
        <div className="pv-stat-item">
          <span className="pv-stat-label">Boxed Warnings (Tier 1):</span>
          <span className="pv-stat-value" style={{ color: '#991b1b' }}>{data.tier_summary[1] || 0}</span>
        </div>
        <span className="pv-stat-sep">|</span>
        <div className="pv-stat-item">
          <span className="pv-stat-label">Contraindications (Tier 2):</span>
          <span className="pv-stat-value" style={{ color: '#9a3412' }}>{data.tier_summary[2] || 0}</span>
        </div>
        <span className="pv-stat-sep">|</span>
        <div className="pv-stat-item">
          <span className="pv-stat-label">Warnings (Tier 3):</span>
          <span className="pv-stat-value" style={{ color: '#854d0e' }}>{data.tier_summary[3] || 0}</span>
        </div>
        <span className="pv-stat-sep">|</span>
        <div className="pv-stat-item">
          <span className="pv-stat-label">Trial Table AEs (Tier 4):</span>
          <span className="pv-stat-value" style={{ color: '#1e40af' }}>{data.tier_summary[4] || 0}</span>
        </div>
        <span className="pv-stat-sep">|</span>
        <div className="pv-stat-item">
          <span className="pv-stat-label">Candidate Leftovers:</span>
          <span className="pv-stat-value" style={{ color: '#64748b' }}>
            {data.total_leftover_terms || (data.leftover_terms ? data.leftover_terms.length : 0)}
          </span>
        </div>
      </div>

      {/* MedDRA SOC Adverse Event Bar Chart (Collapsible above table) */}
      {allSocChartData.length > 0 && (
        <div className="pv-chart-card">
          <div className="pv-chart-header" onClick={() => setShowChart(!showChart)}>
            <div>
              <div className="pv-chart-header-title">
                <h4>Adverse Event Distribution by MedDRA System Organ Class (SOC)</h4>
                <span className="pv-chart-header-subtitle">
                  ({allSocChartData.length} Organ Systems across {data.total_adverse_events} safety signals)
                </span>
              </div>
              <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', marginTop: '0.35rem', fontSize: '0.71rem', color: '#64748b', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: '#475569' }}>Highest Tier:</span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#dc2626' }} /> Tier 1 (Boxed)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#ea580c' }} /> Tier 2 (Contra)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#d97706' }} /> Tier 3 (Warnings)
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '2px', background: '#2563eb' }} /> Tier 4 (AE Table)
                </span>
              </div>
            </div>
            <button
              type="button"
              className="pv-chart-toggle-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowChart(!showChart);
              }}
            >
              <span>{showChart ? 'Hide Chart' : 'Show Chart'}</span>
              <span>{showChart ? '▲' : '▼'}</span>
            </button>
          </div>

          {showChart && (
            <div className="pv-chart-body">
              <div style={{ height: Math.max(220, allSocChartData.length * 26 + 25), width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={allSocChartData}
                    layout="vertical"
                    margin={{ top: 6, right: 25, left: 5, bottom: 6 }}
                  >
                    <CartesianGrid strokeDasharray="2 2" horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#cbd5e1' }} tickLine={false} />
                    <YAxis
                      dataKey="soc_name"
                      type="category"
                      interval={0}
                      width={270}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10.5, fill: '#334155', fontWeight: 500 }}
                    />
                    <Tooltip
                      cursor={false}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const p = payload[0].payload;
                          return (
                            <div className="pv-chart-tooltip">
                              <div className="pv-chart-tooltip-title">{p.full_soc_name}</div>
                              <div style={{ marginTop: '0.15rem' }}>
                                <strong>Adverse Events:</strong> {p.count} signals
                              </div>
                              <div style={{ marginTop: '0.1rem', color: '#64748b' }}>
                                <strong>Highest Tier:</strong> Tier {p.max_severity_tier}
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar
                      dataKey="count"
                      radius={[0, 2, 2, 0]}
                      onClick={(barData: any) => {
                        const socName = barData?.full_soc_name || barData?.payload?.full_soc_name;
                        if (socName) {
                          setSelectedSoc((prev) => (prev === socName ? null : socName));
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      {allSocChartData.map((entry, index) => {
                        const isSelected = selectedSoc === entry.full_soc_name;
                        const isDimmed = selectedSoc !== null && !isSelected;

                        const tierAcademicColor =
                          entry.max_severity_tier === 1
                            ? '#dc2626'
                            : entry.max_severity_tier === 2
                            ? '#ea580c'
                            : entry.max_severity_tier === 3
                            ? '#d97706'
                            : entry.max_severity_tier === 4
                            ? '#2563eb'
                            : '#64748b';

                        return (
                          <Cell
                            key={`cell-${index}`}
                            fill={isDimmed ? '#e2e8f0' : tierAcademicColor}
                            opacity={isDimmed ? 0.45 : isSelected ? 1 : 0.85}
                            stroke={isSelected ? '#0f172a' : 'none'}
                            strokeWidth={isSelected ? 1.5 : 0}
                            style={{
                              transition: 'all 0.15s ease',
                              outline: 'none',
                            }}
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {selectedSoc && (
                <div className="pv-active-soc-banner">
                  <div>
                    <strong>Active Organ System Filter:</strong> {selectedSoc}
                  </div>
                  <button className="pv-active-soc-clear" onClick={() => setSelectedSoc(null)}>
                    ✕ Show All Organ Systems
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Toolbar & Filters */}
      <div className="pv-toolbar">
        <div className="pv-search-box">
          <input
            type="text"
            className="pv-search-input"
            placeholder="Search adverse event, MedDRA PT, SOC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="pv-search-clear" onClick={() => setSearchQuery('')}>×</button>
          )}
        </div>

        <div className="pv-filters-group">
          <button
            className={`pv-filter-chip ${selectedTierFilter === 'all' ? 'active' : ''}`}
            onClick={() => setSelectedTierFilter('all')}
          >
            All ({data.total_adverse_events})
          </button>
          <button
            className={`pv-filter-chip ${selectedTierFilter === 1 ? 'active' : ''}`}
            onClick={() => setSelectedTierFilter(1)}
          >
            Tier 1 Boxed ({data.tier_summary[1] || 0})
          </button>
          <button
            className={`pv-filter-chip ${selectedTierFilter === 4 ? 'active' : ''}`}
            onClick={() => setSelectedTierFilter(4)}
          >
            Tier 4 AEs ({data.tier_summary[4] || 0})
          </button>
          <button
            className={`pv-filter-chip ${selectedTierFilter === 'quant' ? 'active' : ''}`}
            onClick={() => setSelectedTierFilter('quant')}
          >
            Quantitative (%)
          </button>
          <button
            className={`pv-filter-chip ${selectedTierFilter === 'mapped' ? 'active' : ''}`}
            onClick={() => setSelectedTierFilter('mapped')}
          >
            Mapped Terms
          </button>
          {data.items.some((i) => i.is_manual_adjusted) && (
            <button
              className={`pv-filter-chip ${selectedTierFilter === 'manual' ? 'active' : ''}`}
              onClick={() => setSelectedTierFilter('manual')}
            >
              Manual Adjusted ({data.items.filter((i) => i.is_manual_adjusted).length})
            </button>
          )}

          <span style={{ fontSize: '0.8rem', color: '#cbd5e1', margin: '0 0.2rem' }}>|</span>

          <label style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Group:</label>
          <select
            className="pv-select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as 'tier' | 'soc' | 'flat')}
          >
            <option value="tier">By Severity Tier</option>
            <option value="soc">By MedDRA SOC</option>
            <option value="flat">Flat Table</option>
          </select>

          <label style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Sort:</label>
          <select
            className="pv-select"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'severity' | 'freq_desc' | 'risk_diff' | 'alpha')}
          >
            <option value="severity">Severity Tier (1 → 5)</option>
            <option value="freq_desc">Drug % (High → Low)</option>
            <option value="risk_diff">Placebo Risk Diff (Δ)</option>
            <option value="alpha">Alphabetical (A → Z)</option>
          </select>
        </div>
      </div>

      {/* SIDER 4.1 Compact Heatmap Table */}
      <div className="pv-table-wrapper">
        <table className="pv-table">
          <thead>
            <tr>
              <th style={{ width: '85px' }}>Severity</th>
              <th style={{ minWidth: '220px' }}>Adverse Event (MedDRA PT)</th>
              <th style={{ minWidth: '380px' }}>Clinical Evidence & Incidence Data</th>
              <th style={{ width: '200px' }}>Organ System (SOC)</th>
              <th style={{ width: '120px', textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {groupedData.map((group) => {
              const isCollapsed = collapsedGroups.has(group.key);
              return (
                <React.Fragment key={group.key}>
                  {groupBy !== 'flat' && (
                    <tr>
                      <td colSpan={5} style={{ padding: 0 }}>
                        <div className="pv-group-header" onClick={() => toggleGroup(group.key)}>
                          <div className="pv-group-left">
                            <span style={{ fontSize: '0.7rem', transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
                              ▼
                            </span>
                            <span>{group.title}</span>
                            <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 500 }}>
                              ({group.items.length} signals)
                            </span>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            {isCollapsed ? 'Expand' : 'Collapse'}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!isCollapsed && group.items.map((item, idx) => {
                    return (
                      <tr key={`${group.key}-${item.meddra_pt}-${idx}`} className="pv-row" onClick={() => setActiveDrawerItem(item)}>
                        <td>
                          <span className={`pv-badge pv-badge-tier-${item.severity_tier}`}>
                            {item.severity_tier === 1 ? 'BOXED' : item.severity_tier === 2 ? 'CONTRA' : item.severity_tier === 3 ? 'WARNING' : item.severity_tier === 4 ? 'AE TABLE' : 'POSTMKT'}
                          </span>
                        </td>
                        <td>
                          <div className="pv-term-cell">
                            <div className="pv-term-name">
                              <span>{item.meddra_pt}</span>
                              {item.is_mapped && (
                                <span className="pv-badge-mapped" title={`AI normalized non-standard term "${item.term}" to MedDRA PT "${item.meddra_pt}"`}>
                                  Mapped
                                </span>
                              )}
                              {item.is_manual_adjusted && (
                                <span className="pv-badge-manual" title="Manually incorporated by reviewer tag">
                                  Manual Adjusted
                                </span>
                              )}
                              {item.occurrences && item.occurrences.length > 1 && (
                                <span className="pv-badge-occ" title={`Cited across ${item.occurrences.length} safety sections in chronological order`}>
                                  {item.occurrences.length} Sections
                                </span>
                              )}
                            </div>
                            {item.term !== item.meddra_pt && (
                              <span className="pv-term-raw">Raw: {item.term}</span>
                            )}
                          </div>
                        </td>
                        <td>{renderDataForDrug(item)}</td>
                        <td>
                          <span style={{ fontSize: '0.74rem', color: '#475569' }}>
                            {item.soc_name}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                            <button
                              type="button"
                              className={`pv-tag-btn ${feedbackMap[item.term.toLowerCase()] === 'not_ae' || feedbackMap[item.meddra_pt.toLowerCase()] === 'not_ae' ? 'active-not-ae' : ''}`}
                              title={feedbackMap[item.term.toLowerCase()] === 'not_ae' ? 'Tagged as Not an AE by user. Click to undo.' : 'Tag this item as Not an Adverse Event'}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleFeedback(item.term, 'not_ae', item);
                              }}
                            >
                              {feedbackMap[item.term.toLowerCase()] === 'not_ae' || feedbackMap[item.meddra_pt.toLowerCase()] === 'not_ae' ? '⊘ Not AE' : 'Not AE'}
                            </button>
                            <button
                              className="pv-btn"
                              style={{ padding: '0.12rem 0.4rem', fontSize: '0.68rem' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveDrawerItem(item);
                              }}
                            >
                              Quote
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Candidate Leftover MedDRA Mentions */}
      {data.leftover_terms && data.leftover_terms.length > 0 && (
        <div className="pv-leftover-card">
          <div className="pv-leftover-header" onClick={() => setShowLeftovers(!showLeftovers)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
              <strong style={{ fontSize: '0.82rem', color: '#0f172a' }}>
                Candidate MedDRA Mentions Excluded from Adverse Reactions
              </strong>
              <span className="pv-meta-tag" style={{ fontSize: '0.7rem' }}>
                {data.leftover_terms.length} candidate terms
              </span>
            </div>
            <button
              type="button"
              className="pv-chart-toggle-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowLeftovers(!showLeftovers);
              }}
            >
              <span>{showLeftovers ? 'Hide Candidates' : 'Show Candidates'}</span>
              <span>{showLeftovers ? '▲' : '▼'}</span>
            </button>
          </div>

          {showLeftovers && (
            <div style={{ marginTop: '0.65rem' }}>
              <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.76rem', color: '#64748b' }}>
                The following terms matched the MedDRA dictionary in the safety sections but were evaluated as background indications, baseline context, or non-AE descriptions by clinical AI. Reviewers can verify or tag missing items:
              </p>

              <div style={{ marginBottom: '0.5rem', maxWidth: '260px' }}>
                <input
                  type="text"
                  className="pv-search-input"
                  placeholder="Filter candidate terms..."
                  value={leftoverSearch}
                  onChange={(e) => setLeftoverSearch(e.target.value)}
                />
              </div>

              <div style={{ maxHeight: '240px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                <table className="pv-leftover-table">
                  <thead>
                    <tr>
                      <th style={{ width: '30%' }}>Matched Term</th>
                      <th style={{ width: '35%' }}>MedDRA Organ Class (SOC)</th>
                      <th style={{ width: '20%' }}>Source Section</th>
                      <th style={{ width: '15%', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeftovers.map((lt, idx) => (
                      <tr key={`leftover-${idx}`}>
                        <td style={{ fontWeight: 600, color: '#0f172a' }}>{lt.term}</td>
                        <td style={{ color: '#475569' }}>{lt.soc_name}</td>
                        <td style={{ color: '#64748b' }}>{lt.section_name}</td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            type="button"
                            className={`pv-tag-btn ${feedbackMap[lt.term.toLowerCase()] === 'is_ae' ? 'active-is-ae' : ''}`}
                            title={feedbackMap[lt.term.toLowerCase()] === 'is_ae' ? 'Reported as Real AE by user. Click to undo.' : 'Report this candidate term as a Real AE'}
                            onClick={() => handleToggleFeedback(lt.term, 'is_ae', lt)}
                          >
                            {feedbackMap[lt.term.toLowerCase()] === 'is_ae' ? '✓ Real AE' : '+ Tag as AE'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evidence Drawer Modal */}
      {activeDrawerItem && (
        <div className="pv-drawer-overlay" onClick={() => setActiveDrawerItem(null)}>
          <div className="pv-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="pv-drawer-header">
              <h3>{activeDrawerItem.meddra_pt}</h3>
              <button className="pv-drawer-close" onClick={() => setActiveDrawerItem(null)}>×</button>
            </div>
            <div className="pv-drawer-body">
              <div>
                <span className="pv-drawer-section-title">MedDRA Classification</span>
                <p style={{ margin: '0.2rem 0', fontSize: '0.825rem' }}>
                  <strong>Primary SOC:</strong> {activeDrawerItem.soc_name}
                </p>
                {activeDrawerItem.meddra_pt_code && (
                  <p style={{ margin: '0.2rem 0', fontSize: '0.825rem', color: '#64748b' }}>
                    <strong>MedDRA PT Code:</strong> {activeDrawerItem.meddra_pt_code}
                  </p>
                )}
                {activeDrawerItem.is_mapped && (
                  <p style={{ margin: '0.2rem 0', fontSize: '0.825rem', color: '#7e22ce' }}>
                    <strong>Original Text Mention:</strong> "{activeDrawerItem.term}" (AI standardized to {activeDrawerItem.meddra_pt})
                  </p>
                )}
              </div>

              <div>
                <span className="pv-drawer-section-title">Frequency & Incidence</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.2rem' }}>
                  <div style={{ padding: '0.45rem', background: '#f8fafc', borderRadius: '5px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Drug Incidence</span>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                      {activeDrawerItem.drug_frequency_text || 'Reported in warning'}
                    </div>
                  </div>
                  <div style={{ padding: '0.45rem', background: '#f8fafc', borderRadius: '5px', border: '1px solid #e2e8f0' }}>
                    <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Placebo Rate</span>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a' }}>
                      {activeDrawerItem.placebo_frequency_text || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                  <span className="pv-drawer-section-title" style={{ margin: 0 }}>
                    Original Label Excerpts (Chronological Evidence)
                  </span>
                  {activeDrawerItem.occurrences && activeDrawerItem.occurrences.length > 1 && (
                    <span className="pv-meta-tag" style={{ fontSize: '0.7rem' }}>
                      {activeDrawerItem.occurrences.length} mentions across sections
                    </span>
                  )}
                </div>

                {/* Dedicated Scrollable Excerpt Overflow Bar Container */}
                <div className="pv-drawer-excerpt-scroll">
                  {(activeDrawerItem.occurrences && activeDrawerItem.occurrences.length > 0
                    ? activeDrawerItem.occurrences
                    : [{
                        tier: activeDrawerItem.severity_tier,
                        section_title: activeDrawerItem.section_name,
                        excerpt: activeDrawerItem.excerpt,
                        drug_pct: activeDrawerItem.drug_max_pct || activeDrawerItem.drug_min_pct
                      }]
                  ).map((occ, oIdx) => (
                    <div key={`occ-${oIdx}`} className="pv-occ-card">
                      <div className="pv-occ-header">
                        <span className={`pv-badge pv-badge-tier-${occ.tier}`}>
                          {occ.tier === 1 ? 'BOXED' : occ.tier === 2 ? 'CONTRA' : occ.tier === 3 ? 'WARNING' : occ.tier === 4 ? 'AE TABLE' : 'POSTMKT'}
                        </span>
                        <span className="pv-occ-section-title">{occ.section_title}</span>
                        {occ.drug_pct != null && (
                          <span className="pv-occ-rate-badge">{occ.drug_pct}% incidence</span>
                        )}
                      </div>
                      <div className="pv-occ-quote">
                        &ldquo;{occ.excerpt}&rdquo;
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Same-Drug Peer Labels Strip */}
      {data.peers && data.peers.length > 0 && (
        <div className="pv-peers-section">
          <h4>Same Active Ingredient Labelings ({data.active_ingredient || data.generic_name})</h4>
          <p style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 0.6rem 0' }}>
            Compare adverse event profiles across other products and NDA/ANDAs sharing this active substance:
          </p>
          <div className="pv-peers-grid">
            {data.peers.map((peer) => (
              <div key={peer.set_id} className="pv-peer-card">
                <Link href={labelRoute(peer.set_id, 'pv-profile')} className="pv-peer-name">
                  {peer.brand_name}
                </Link>
                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  {peer.manufacturer_name} {peer.dosage_form ? `• ${peer.dosage_form}` : ''}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.2rem' }}>
                  {peer.is_rld && <span className="pv-badge" style={{ background: '#ecfdf5', color: '#047857' }}>RLD</span>}
                  {peer.has_cached_profile && <span style={{ fontSize: '0.7rem', color: '#059669', fontWeight: 600 }}>● Profile Ready</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin/Developer Update with Tags Confirmation Modal */}
      {showUpdateModal && (
        <div className="pv-modal-overlay" onClick={() => setShowUpdateModal(false)}>
          <div className="pv-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pv-modal-header">
              <h3>
                <span>✨</span>
                <span>Confirm Incorporating Reviewer-Tagged Terms</span>
              </h3>
              <button
                className="pv-drawer-close"
                onClick={() => setShowUpdateModal(false)}
              >
                ×
              </button>
            </div>

            <div className="pv-modal-body">
              <p style={{ margin: '0 0 0.75rem 0', color: '#475569', fontSize: '0.825rem' }}>
                The following terms were tagged as real adverse events. Their source quotes will be harvested from the label text and incorporated into the safety table with a <span className="pv-badge-manual">Manual Adjusted</span> badge. Uncheck any terms you do not wish to incorporate:
              </p>

              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                <button
                  type="button"
                  className="pv-btn"
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }}
                  onClick={() => setSelectedTermsToApply(new Set(taggedTermsToAdd.map((t) => t.term.toLowerCase())))}
                >
                  Select All ({taggedTermsToAdd.length})
                </button>
                <button
                  type="button"
                  className="pv-btn"
                  style={{ padding: '0.15rem 0.5rem', fontSize: '0.72rem' }}
                  onClick={() => setSelectedTermsToApply(new Set())}
                >
                  Deselect All
                </button>
              </div>

              <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                <table className="pv-modal-table">
                  <thead>
                    <tr>
                      <th style={{ width: '50px', textAlign: 'center' }}>Include</th>
                      <th>Tagged Term</th>
                      <th>MedDRA SOC</th>
                      <th>Source Section</th>
                    </tr>
                  </thead>
                  <tbody>
                    {taggedTermsToAdd.map((t) => {
                      const isChecked = selectedTermsToApply.has(t.term.toLowerCase());
                      return (
                        <tr
                          key={`modal-tag-${t.term}`}
                          style={{ background: isChecked ? '#f0fdf4' : '#ffffff', cursor: 'pointer' }}
                          onClick={() => {
                            setSelectedTermsToApply((prev) => {
                              const next = new Set(prev);
                              if (next.has(t.term.toLowerCase())) next.delete(t.term.toLowerCase());
                              else next.add(t.term.toLowerCase());
                              return next;
                            });
                          }}
                        >
                          <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setSelectedTermsToApply((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(t.term.toLowerCase());
                                  else next.delete(t.term.toLowerCase());
                                  return next;
                                });
                              }}
                            />
                          </td>
                          <td style={{ fontWeight: 600, color: '#0f172a' }}>{t.term}</td>
                          <td style={{ color: '#475569' }}>{t.soc_name}</td>
                          <td style={{ color: '#64748b' }}>{t.section_name}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="pv-modal-footer">
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                <strong>{selectedTermsToApply.size}</strong> of {taggedTermsToAdd.length} terms selected
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="pv-btn"
                  onClick={() => setShowUpdateModal(false)}
                  disabled={updatingWithTags}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="pv-btn pv-btn-accent"
                  disabled={updatingWithTags || selectedTermsToApply.size === 0}
                  onClick={handleConfirmUpdateWithTags}
                >
                  {updatingWithTags ? 'Incorporating...' : `Confirm & Update (${selectedTermsToApply.size})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
