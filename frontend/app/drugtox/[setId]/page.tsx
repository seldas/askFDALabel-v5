'use client';

import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import {
  Typography,
  CircularProgress,
  Box,
  Chip,
  IconButton,
  Button,
  useTheme,
  Stack,
  Avatar,
  Grid as GridLegacy,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import Grid from '@mui/material/GridLegacy';
import BusinessIcon from '@mui/icons-material/Business';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ScienceIcon from '@mui/icons-material/Science';
import HistoryIcon from '@mui/icons-material/History';
import InfoIcon from '@mui/icons-material/Info';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DashboardIcon from '@mui/icons-material/Dashboard';
import Header from "../../components/Header";
import { useUser } from '../../context/UserContext';
import { API_BASE, withDashboardBase, withAppBase } from '../../utils/appPaths';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import '../../dashboard/label/[setId]/label.css';

// Tox-specific color branding
const toxColors: Record<string, string> = {
  dili: '#0891b2',
  dict: '#e11d48',
  diri: '#d97706',
  pgx: '#7c3aed'
};

// Formats/highlights DILI/DICT/DIRI concern classes, scores, and levels in HTML/Markdown
const highlightToxTerms = (text: string) => {
  if (!text) return '';
  
  let result = text;
  
  // 1. Most DILI/DICT/DIRI/Concern (rose badge)
  result = result.replace(
    /\b(Most\s+(?:DILI|DICT|DIRI)?\s*Concern)\b/gi,
    `<span style="background: #fef2f2; color: #991b1b; border: 1px solid #fca5a5; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(153, 27, 27, 0.05);">$1</span>`
  );

  // 2. Less DILI/DICT/DIRI/Concern (amber badge)
  result = result.replace(
    /\b(Less\s+(?:DILI|DICT|DIRI)?\s*Concern)\b/gi,
    `<span style="background: #fffbeb; color: #92400e; border: 1px solid #fde047; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(146, 64, 14, 0.05);">$1</span>`
  );

  // 3. No DILI/DICT/DIRI/Concern (emerald badge)
  result = result.replace(
    /\b(No\s+(?:DILI|DICT|DIRI)?\s*Concern)\b/gi,
    `<span style="background: #f0fdf4; color: #166534; border: 1px solid #86efac; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(22, 101, 52, 0.05);">$1</span>`
  );

  // 4. Scores: X or Score: X or Scores X or Score X (indigo badge)
  result = result.replace(
    /\b(Scores?:?\s*(?:of\s*)?\d+)\b/gi,
    `<span style="background: #e0e7ff; color: #3730a3; border: 1px solid #a5b4fc; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(55, 48, 163, 0.05);">$1</span>`
  );

  // 5. [Level: X] or Level: X (purple badge)
  result = result.replace(
    /(\[Level:\s*[^\]]+\])/gi,
    `<span style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(107, 33, 168, 0.05);">$1</span>`
  );
  
  result = result.replace(
    /\b(Level:\s*(?:Severe|Moderate|Mild|Certain|Possible|0))\b/gi,
    `<span style="background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; padding: 2px 6px; border-radius: 4px; font-weight: 700; display: inline-block; font-size: 0.85em; margin: 0 2px; box-shadow: 0 1px 2px rgba(107, 33, 168, 0.05);">$1</span>`
  );

  return result;
};

// Interfaces
interface DrugSummary {
  SETID: string;
  Trade_Name: string;
  Generic_Proper_Names: string;
  Toxicity_Class: string;
  Author_Organization: string;
  Tox_Type: string;
  SPL_Effective_Time: string;
  is_historical: number;
  endpoint?: string;
}

interface DrugDetail extends DrugSummary {
  PLR: number;
  Evidence: string;
  Supported_Section: string;
  Update_Notes: string;
  AI_Summary: string;
}

interface HistoryItem {
  SETID: string;
  Toxicity_Class: string;
  SPL_Effective_Time: string;
  is_historical: number;
  Update_Notes: string;
  Trade_Name: string;
  Author_Organization: string;
  Tox_Type: string;
  Evidence?: string;
  Supported_Section?: string;
  AI_Summary?: string;
  AI_Model?: string;
  Assessment_Date?: string;
}

const BACKEND_API_PREFIX = `${API_BASE}/api`;
const DRUGTOX_API_PREFIX = `${BACKEND_API_PREFIX}/drugtox`;
const tabs = [
  { id: 'label-view', label: 'Label' },
  { id: 'faers-view', label: 'FAERS' },
  { id: 'tox-view', label: 'DrugTox Agents', isAI: true },
  { id: 'examine-view', label: 'Examine', isAI: true },
];

export default function DrugToxDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const setId = params.setId as string;
  const agentParam = searchParams.get('agent') || searchParams.get('tox') || searchParams.get('type');
  const theme = useTheme();
  
  const [detail, setDetail] = useState<DrugDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metaExpanded, setMetaExpanded] = useState(true);
  const [instructionsExpanded, setInstructionsExpanded] = useState(true);

  // Generative AI States
  const [activeTox, setActiveTox] = useState<string | null>(agentParam ? agentParam.toLowerCase() : null);
  const [reportData, setReportData] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [reportToxClass, setReportToxClass] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [rawReportData, setRawReportData] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({ dili: false, dict: false, diri: false, pgx: false });
  const [reportLoading, setReportLoading] = useState<Record<string, boolean>>({ dili: false, dict: false, diri: false, pgx: false });

  const generateReport = async (toxType: string) => {
    setActiveTox(toxType);
    if (reportData[toxType] || reportLoading[toxType]) return;

    setReportLoading(prev => ({ ...prev, [toxType]: true }));
    try {
      const endpoint = toxType === 'pgx' ? 'pgx/assess' : `${toxType}/assess`;
      const res = await axios.get(`${BACKEND_API_PREFIX}/dashboard/${endpoint}/${setId}`);
      
      let markdownContent = '';
      if (toxType === 'pgx') {
        markdownContent = res.data.biomarkers?.length > 0 
          ? res.data.biomarkers.map((b: any) => `**${b.biomarker}**: ${b.summary}`).join('\n\n')
          : "No PGx biomarkers found.";
      } else {
        markdownContent = res.data.assessment_report || "No significant toxicity signals found in the label.";
      }
      
      setReportData(prev => ({ ...prev, [toxType]: markdownContent }));
      setReportToxClass(prev => ({ ...prev, [toxType]: res.data.toxicity_class || null }));
      setRawReportData(prev => ({ ...prev, [toxType]: res.data.raw_response || null }));
    } catch (err) {
      console.error(`Error generating ${toxType} report:`, err);
      setReportData(prev => ({ ...prev, [toxType]: "Failed to generate report." }));
    } finally {
      setReportLoading(prev => ({ ...prev, [toxType]: false }));
    }
  };

  useEffect(() => {
    if (!setId) return;
    setLoading(true);
    setError(null);
    
    Promise.all([
      axios.get(`${DRUGTOX_API_PREFIX}/drugs/${setId}`).catch(async (err) => {
        if (err.response && err.response.status === 404) {
          try {
            const metaRes = await axios.get(`${BACKEND_API_PREFIX}/dashboard/label/${setId}?json=1`);
            const meta = metaRes.data;
            return {
              data: {
                SETID: setId,
                Trade_Name: meta.faers_drug_name || meta.brand_name || "Unknown Drug",
                Generic_Proper_Names: meta.generic_name || "Unknown Generic",
                Toxicity_Class: "Unknown",
                Tox_Type: "",
                Author_Organization: meta.manufacturer_name || "Unknown",
                SPL_Effective_Time: meta.effective_time || "",
                is_historical: 0
              }
            };
          } catch (metaErr) {
            throw new Error("Label not found.");
          }
        }
        throw err;
      }),
      axios.get(`${DRUGTOX_API_PREFIX}/drugs/${setId}/history`).catch(err => {
        if (err.response && err.response.status === 404) return { data: [] };
        throw err;
      })
    ])
      .then(([detailRes, historyRes]) => {
        setDetail(detailRes.data);
        setHistory(historyRes.data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error fetching drug details:', err);
        setError('Failed to load drug details.');
        setLoading(false);
      });
  }, [setId]);

  useEffect(() => {
    if (agentParam && setId) {
      const normalized = agentParam.toLowerCase();
      if (['dili', 'dict', 'diri', 'pgx'].includes(normalized)) {
        setActiveTox(normalized);
        generateReport(normalized);
      }
    }
  }, [agentParam, setId]);

  const getToxColor = (toxClass: string) => {
    if (!toxClass) return 'default';
    const lower = toxClass.toLowerCase();
    switch (lower) {
      case 'most': return 'error';
      case 'less': return 'warning';
      case 'no': return 'success';
      case 'precaution': return 'info';
      default: return 'default';
    }
  };

  const formatDate = (dateValue: any) => {
    if (!dateValue) return 'N/A';

    const dateStr = String(dateValue).trim();

    // YYYYMMDD
    if (/^\d{8}$/.test(dateStr)) {
      return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
    }

    // YYYY-MM-DD or ISO timestamp
    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }

    // Unknown format: do not slice it into fake date pieces
    return dateStr;
  };

  const MetaItem = ({ icon, label, value, isLink = false, onClick }: any) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Box sx={{ mr: 1.5, mt: 0.3, color: 'primary.main', display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        {isLink && value !== 'N/A' ? (
          <Typography variant="body2" component="a" href={value} onClick={onClick} target={onClick ? undefined : "_blank"} rel={onClick ? undefined : "noopener noreferrer"} sx={{ fontWeight: 600, color: '#1a237e', textDecoration: 'underline', display: 'block', cursor: onClick ? 'pointer' : 'auto' }}>
            {value}
          </Typography>
        ) : (
          <Typography variant="body2" sx={{ fontWeight: 600, color: '#1a237e' }}>
            {value || 'N/A'}
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <Box sx={{ p: 4, pt: 12, flexGrow: 1, maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        
        <Box sx={{ mb: 3 }}>
           <Button component={Link} href="/drugtox" startIcon={<ArrowBackIcon />} sx={{ color: '#64748b', fontWeight: 600 }}>
             Back to DrugTox Search
           </Button>
        </Box>

        {loading ? (
          <Box display="flex" justifyContent="center" p={10}><CircularProgress /></Box>
        ) : error ? (
          <Typography color="error">{error}</Typography>
        ) : detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* DRUG METADATA - Same header as label page */}
            <div className="label-header" style={{ background: 'white', padding: '24px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '40px' }}>
                    <div style={{ flex: '0 1 100%', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: '4px' }}>
                            <h1 className="DocumentTitle" style={{ 
                              margin: 0, 
                              fontSize: '2.25rem', 
                              fontWeight: 800, 
                              letterSpacing: '-0.04em', 
                              color: '#0f172a',
                              lineHeight: 1.1,
                              wordBreak: 'break-word',
                              fontFamily: 'var(--font-inter), sans-serif',
                              textShadow: '0 1px 2px rgba(0,0,0,0.02)',
                              textTransform: 'capitalize'
                            }}>
                              {([detail.Trade_Name, formatDate(detail.SPL_Effective_Time)]
                                      .filter(Boolean)
                                      .join(' - ')
                                      .toLowerCase())}
                            </h1>
                        </div>
                        <div className="doc-meta-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '12px', fontSize: '0.85rem', color: '#64748b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#475569' }}>Generic Name:</span>
                                <span style={{ color: '#0f172a', fontWeight: 700 }}>{detail.Generic_Proper_Names || 'N/A'}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#475569' }}>Manufacturer:</span>
                                <span style={{ color: '#0f172a', fontWeight: 700 }}>{detail.Author_Organization || 'N/A'}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#475569' }}>SETID:</span>
                                <span style={{ color: '#0f172a', fontWeight: 700 }} className="select-all">{detail.SETID || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* INSTRUCTIONS PANEL */}
            <div style={{ 
              background: '#f8fafc', 
              border: '1px solid #e2e8f0', 
              borderRadius: '16px', 
              padding: '16px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem', color: '#7c3aed' }}>💡</span>
                  <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#1e293b' }}>About AskDrugTox Safety Assessment</span>
                </div>
                <button 
                  onClick={() => setInstructionsExpanded(!instructionsExpanded)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#7c3aed',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                >
                  {instructionsExpanded ? 'Hide Instructions' : 'Show Instructions'}
                </button>
              </div>
              {instructionsExpanded && (
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#475569', lineHeight: '1.5' }}>
                  AskDrugTox leverages advanced language models to analyze official FDA prescribing labels. It extracts, structures, and assesses safety signals regarding major organ toxicities: <strong>Drug-Induced Liver Injury (DILI)</strong>, <strong>Drug-Induced Cardiotoxicity (DICT)</strong>, <strong>Drug-Induced Renal Injury (DIRI)</strong>, and <strong>Pharmacogenomics (PGx)</strong> biomarkers. You can click on any toxicity area below to review compiled historical assessments or run a new real-time AI evaluation of the current label.
                </p>
              )}
            </div>

            {/* Same tags as the label view page */}
            <div className="function-tabs-bar" style={{ width: '100%', padding: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: '8px', backgroundColor: '#f1f5f9', padding: '6px', borderRadius: '14px' }}>
                  {tabs.map((tab) => {
                    const isActive = tab.id === 'tox-view';
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          if (tab.id === 'tox-view') {
                            // already on drugtox page
                          } else {
                            window.location.href = withDashboardBase(`/dashboard/label/${setId}?tab=${tab.id}`);
                          }
                        }}
                        className={`tab-btn ${tab.isAI ? 'tab-btn-ai' : ''} ${isActive ? 'active' : ''}`}
                      >
                        {tab.label}
                        {tab.isAI && (
                          <span className="ai-badge-pulse" style={{ 
                            background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)', 
                            color: '#ffffff', 
                            fontSize: '0.62rem', 
                            fontWeight: 800, 
                            padding: '1.5px 6px', 
                            borderRadius: '4px', 
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            lineHeight: '1.2',
                            display: 'inline-block',
                            marginLeft: '4px',
                            verticalAlign: 'middle',
                            boxShadow: '0 2px 4px rgba(168, 85, 247, 0.2)'
                          }}>
                            AI
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
            </div>

            {/* Content Section */}
            <Box sx={{ p: 4, pl: 5, backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #f1f5f9' }}>
              
              {/* Toxicity History global timeline removed, now integrated into Agent Panels */}

              {/* Generative AI Real-Time Assessment */}
              <Box>
                 <Typography variant="h6" sx={{ fontWeight: 900, color: '#1a237e', mb: 3, display: 'flex', alignItems: 'center' }}>
                    <AutoAwesomeIcon sx={{ mr: 1, color: '#0ea5e9' }} /> SAFETY SIGNALS & AI ASSESSMENT
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569', mb: 4 }}>
                    Run real-time AI assessments on the prescribing information for specific toxicity profiles.
                  </Typography>

                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', mb: 4 }}>
                      
                      <Box 
                        onClick={() => setActiveTox('dili')}
                        sx={{ 
                          p: 3, 
                          borderRadius: '12px', 
                          border: '1px solid', 
                          borderColor: activeTox === 'dili' ? '#0891b2' : '#e2e8f0', 
                          borderTop: '4px solid #0891b2', 
                          cursor: 'pointer',
                          backgroundColor: activeTox === 'dili' ? '#f0f9ff' : '#fff',
                          transition: 'all 0.2s ease',
                          '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transform: 'translateY(-2px)' }
                        }}
                      >
                         <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>DILI</Typography>
                         <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 2 }}>Drug-Induced Liver Injury</Typography>
                      </Box>

                      <Box 
                        onClick={() => setActiveTox('dict')}
                        sx={{ 
                          p: 3, 
                          borderRadius: '12px', 
                          border: '1px solid', 
                          borderColor: activeTox === 'dict' ? '#e11d48' : '#e2e8f0', 
                          borderTop: '4px solid #e11d48', 
                          cursor: 'pointer',
                          backgroundColor: activeTox === 'dict' ? '#fff1f2' : '#fff',
                          transition: 'all 0.2s ease',
                          '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transform: 'translateY(-2px)' }
                        }}
                      >
                         <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>DICT</Typography>
                         <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 2 }}>Drug-Induced Cardiotoxicity</Typography>
                      </Box>

                      <Box 
                        onClick={() => setActiveTox('diri')}
                        sx={{ 
                          p: 3, 
                          borderRadius: '12px', 
                          border: '1px solid', 
                          borderColor: activeTox === 'diri' ? '#d97706' : '#e2e8f0', 
                          borderTop: '4px solid #d97706', 
                          cursor: 'pointer',
                          backgroundColor: activeTox === 'diri' ? '#fffbeb' : '#fff',
                          transition: 'all 0.2s ease',
                          '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transform: 'translateY(-2px)' }
                        }}
                      >
                         <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>DIRI</Typography>
                         <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 2 }}>Drug-Induced Renal Injury</Typography>
                      </Box>

                      <Box 
                        onClick={() => setActiveTox('pgx')}
                        sx={{ 
                          p: 3, 
                          borderRadius: '12px', 
                          border: '1px solid', 
                          borderColor: activeTox === 'pgx' ? '#7c3aed' : '#e2e8f0', 
                          borderTop: '4px solid #7c3aed', 
                          cursor: 'pointer',
                          backgroundColor: activeTox === 'pgx' ? '#f5f3ff' : '#fff',
                          transition: 'all 0.2s ease',
                          '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.05)', transform: 'translateY(-2px)' }
                        }}
                      >
                         <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>PGx</Typography>
                         <Typography variant="caption" sx={{ color: '#64748b', display: 'block', mb: 2 }}>Pharmacogenomics</Typography>
                      </Box>
                  </Box>

                  {/* AI Report Content Area & History Panels */}
                  {activeTox && (
                    <Box sx={{ p: 4, backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                          <Typography variant="h6" sx={{ fontWeight: 800, color: '#1e293b', textTransform: 'uppercase' }}>
                              {activeTox} Assessment Records
                          </Typography>
                          <Button 
                            variant="contained" 
                            onClick={() => generateReport(activeTox)}
                            disabled={reportLoading[activeTox]}
                            sx={{ fontWeight: 700, backgroundColor: '#0ea5e9', '&:hover': { backgroundColor: '#0284c7' } }}
                          >
                            {reportLoading[activeTox] ? 'Generating...' : 'Run New Assessment'}
                          </Button>
                        </Box>

                        {/* Real-time Generated Report */}
                        {reportData[activeTox] === "Failed to generate report." ? (
                          <Box sx={{ mb: 4, p: 3, borderRadius: '8px', border: '1px solid #fca5a5', backgroundColor: '#fef2f2', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography sx={{ color: '#991b1b', fontWeight: 600 }}>
                              Generation Failed. The AI model could not produce a valid assessment.
                            </Typography>
                            <Button 
                              variant="outlined" 
                              color="error" 
                              onClick={() => {
                                setReportData(prev => ({ ...prev, [activeTox!]: null }));
                                generateReport(activeTox!);
                              }}
                              disabled={reportLoading[activeTox!]}
                            >
                              Retry
                            </Button>
                          </Box>
                        ) : reportData[activeTox] && (
                          <Box sx={{ 
                            mb: 4, 
                            p: 3.5, 
                            borderRadius: '12px', 
                            border: '1px solid #e2e8f0', 
                            borderLeft: `5px solid ${toxColors[activeTox] || '#0ea5e9'}`,
                            backgroundColor: '#ffffff', 
                            position: 'relative',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                          }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#64748b' }}>
                                  {new Date().toISOString().split('T')[0]} (Current)
                                </Typography>
                              </Box>
                              <Chip 
                                label={reportToxClass[activeTox] || "Generated Analysis"} 
                                size="small" 
                                color={getToxColor(reportToxClass[activeTox] || "") as any}
                                sx={{ fontWeight: 800 }} 
                              />
                            </Box>
                            <Box sx={{ 
                              '& p': { mb: 2, lineHeight: 1.7, color: '#0f172a' }, 
                              '& h3': { mt: 3, mb: 1.5, fontSize: '1.15rem', fontWeight: 800, color: '#1e3a8a', borderBottom: '1px solid #e2e8f0', pb: 1 },
                              '& ul': { pl: 3, mb: 2 },
                              '& li': { mb: 1, lineHeight: 1.6, color: '#334155' },
                              '& mark': {
                                background: 'linear-gradient(120deg, #fef08a 0%, #fde047 100%)',
                                color: '#1e293b',
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontWeight: 600,
                                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                border: '1px solid rgba(250, 204, 21, 0.5)',
                                display: 'inline',
                                mx: '1px',
                                transition: 'all 0.2s ease',
                                '&:hover': {
                                  background: 'linear-gradient(120deg, #fef08a 0%, #facc15 100%)',
                                  boxShadow: '0 2px 4px rgba(0,0,0,0.08)'
                                }
                              }
                            }}>
                                <ReactMarkdown rehypePlugins={[rehypeRaw]}>{highlightToxTerms(reportData[activeTox]!)}</ReactMarkdown>
                            </Box>
                            {rawReportData[activeTox] && (
                              <Box sx={{ mt: 2 }}>
                                <Button size="small" onClick={() => setShowRaw(prev => ({ ...prev, [activeTox!]: !prev[activeTox!] }))}>
                                  {showRaw[activeTox] ? 'Hide Raw AI Output' : 'View Raw AI Output (Debug)'}
                                </Button>
                                {showRaw[activeTox] && (
                                  <Box sx={{ mt: 2, p: 2, backgroundColor: '#1e293b', color: '#e2e8f0', borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto' }}>
                                    {rawReportData[activeTox]}
                                  </Box>
                                )}
                              </Box>
                            )}
                          </Box>
                        )}

                        {/* Historical Records Timeline */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                           {history.filter(h => h.Tox_Type?.toLowerCase() === activeTox.toLowerCase()).map((item, idx) => (
                               <Accordion key={`${item.SETID}-${idx}`} defaultExpanded={idx === 0} sx={{ 
                                 border: '1px solid #e2e8f0', 
                                 borderLeft: `4px solid ${toxColors[activeTox] || '#64748b'}`,
                                 boxShadow: 'none', 
                                 '&:before': { display: 'none' }, 
                                 mb: 2, 
                                 borderRadius: '8px !important',
                                 overflow: 'hidden'
                               }}>
                                 <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ backgroundColor: '#fff', borderBottom: '1px solid #e2e8f0' }}>
                                   <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', pr: 2 }}>
                                     <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                       <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#334155' }}>
                                         {item.Assessment_Date ? formatDate(item.Assessment_Date) : (item.SPL_Effective_Time ? formatDate(item.SPL_Effective_Time) : 'Date unavailable')}
                                       </Typography>
                                       {(item.AI_Model) ? (
                                         <Chip label={item.AI_Model} size="small" sx={{ backgroundColor: '#f1f5f9', color: '#64748b', fontSize: '0.7rem', fontWeight: 700 }} />
                                       ) : (item.Update_Notes && item.Update_Notes.startsWith("Generated by ")) ? (
                                         <Chip label={item.Update_Notes.replace("Generated by ", "")} size="small" sx={{ backgroundColor: '#f1f5f9', color: '#64748b', fontSize: '0.7rem', fontWeight: 700 }} />
                                       ) : (
                                         <Chip label="vLLM (Llama-4)" size="small" sx={{ backgroundColor: '#f1f5f9', color: '#64748b', fontSize: '0.7rem', fontWeight: 700 }} />
                                       )}
                                     </Box>
                                     <Chip label={item.Toxicity_Class} size="small" color={getToxColor(item.Toxicity_Class) as any} sx={{ fontWeight: 800 }} />
                                   </Box>
                                 </AccordionSummary>
                                 
                                 <AccordionDetails sx={{ backgroundColor: '#fafafa', p: 3 }}>
                                   <Box sx={{ mb: 2 }}>
                                     <Typography variant="caption" sx={{ fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>Summary</Typography>
                                     <Box sx={{ 
                                       color: '#334155', 
                                       mt: 0.5, 
                                       '& p': { mb: 1, lineHeight: 1.6 }, 
                                       '& h3': { mt: 2, mb: 0.75, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }, 
                                       '& ul': { mt: 0.5, pl: 3, mb: 1.5 },
                                       '& li': { mb: 0.5 },
                                       '& mark': {
                                         background: 'linear-gradient(120deg, #fef08a 0%, #fde047 100%)',
                                         color: '#1e293b',
                                         padding: '2px 6px',
                                         borderRadius: '4px',
                                         fontWeight: 600,
                                         boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                                         border: '1px solid rgba(250, 204, 21, 0.5)',
                                         display: 'inline',
                                         mx: '1px',
                                         transition: 'all 0.2s ease',
                                         '&:hover': {
                                           background: 'linear-gradient(120deg, #fef08a 0%, #facc15 100%)',
                                           boxShadow: '0 2px 4px rgba(0,0,0,0.08)'
                                         }
                                       }
                                     }}>
                                       {item.AI_Summary ? (
                                         <ReactMarkdown rehypePlugins={[rehypeRaw]}>{highlightToxTerms(item.AI_Summary)}</ReactMarkdown>
                                       ) : (
                                         <Typography variant="body2">{item.Update_Notes || "No summary available."}</Typography>
                                       )}
                                     </Box>
                                   </Box>
                                  <Box>
                                    <Typography variant="caption" sx={{ fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase' }}>In-Reference Evidence</Typography>
                                    <Typography variant="body2" sx={{ color: '#475569', mt: 0.5, fontStyle: item.Evidence ? 'normal' : 'italic' }}>
                                      {item.Evidence || "unavailable"}
                                    </Typography>
                                  </Box>
                                </AccordionDetails>
                              </Accordion>
                           ))}
                           {history.filter(h => h.Tox_Type?.toLowerCase() === activeTox.toLowerCase()).length === 0 && !reportData[activeTox] && (
                              <Typography variant="body2" sx={{ color: '#94a3b8', fontStyle: 'italic', textAlign: 'center', py: 4 }}>
                                No historical records found for {activeTox.toUpperCase()}.
                              </Typography>
                           )}
                        </Box>

                    </Box>
                  )}

              </Box>

            </Box>
          </div>
        ) : null}

      </Box>
    </Box>
  );
}
