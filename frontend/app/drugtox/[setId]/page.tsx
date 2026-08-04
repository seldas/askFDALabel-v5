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

const AGENT_CONFIGS: Record<string, { name: string; title: string; color: string; icon: string; instructions: string }> = {
  dili: {
    name: 'DILI Agent',
    title: 'Drug-Induced Liver Injury (DILI) Safety Assessment',
    color: '#0891b2',
    icon: '🧪',
    instructions: 'DILI Agent leverages advanced AI to analyze official FDA prescribing labels for hepatotoxicity signals. It evaluates risk concern levels (Most, Less, or No DILI Concern), ALT/AST liver enzyme elevation patterns, serum bilirubin monitoring thresholds, clinical liver toxicity warnings, and historical DILI database classifications.'
  },
  dict: {
    name: 'DICT Agent',
    title: 'Drug-Induced Cardiotoxicity (DICT) Safety Assessment',
    color: '#e11d48',
    icon: '❤️',
    instructions: 'DICT Agent analyzes prescribing information for cardiotoxicity risk signals. It evaluates QT interval prolongation, arrhythmias, heart failure risk, cardiomyopathy, LVEF monitoring requirements, and FDA boxed warnings for cardiovascular adverse events.'
  },
  diri: {
    name: 'DIRI Agent',
    title: 'Drug-Induced Renal Injury (DIRI) Safety Assessment',
    color: '#d97706',
    icon: '🩺',
    instructions: 'DIRI Agent scans prescribing labels for nephrotoxicity and renal impairment guidance. It detects acute kidney injury (AKI) risks, serum creatinine/eGFR monitoring thresholds, dosage adjustment recommendations for renal failure, and renal safety precautions.'
  },
  pgx: {
    name: 'PGx Agent',
    title: 'Pharmacogenomics (PGx) Safety Assessment',
    color: '#7c3aed',
    icon: '🧬',
    instructions: 'PGx Agent extracts pharmacogenomic biomarker guidance and genetic variant associations from prescribing labels. It identifies actionable genes (e.g., CYP2D6, HLA-B*5701, TPMT, G6PD), testing recommendations, dose modification guidelines, and variant-specific adverse reaction risks.'
  }
};

export default function DrugToxDetailPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const setId = params.setId as string;
  const rawAgentParam = searchParams.get('agent') || searchParams.get('tox') || searchParams.get('type') || 'dili';
  const agentKey = rawAgentParam.toLowerCase() in AGENT_CONFIGS ? rawAgentParam.toLowerCase() : 'dili';
  const theme = useTheme();
  
  const [detail, setDetail] = useState<DrugDetail | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [instructionsExpanded, setInstructionsExpanded] = useState(true);

  // Generative AI States
  const [activeTox, setActiveTox] = useState<string>(agentKey);
  const [reportData, setReportData] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [reportToxClass, setReportToxClass] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [rawReportData, setRawReportData] = useState<Record<string, string | null>>({ dili: null, dict: null, diri: null, pgx: null });
  const [showRaw, setShowRaw] = useState<Record<string, boolean>>({ dili: false, dict: false, diri: false, pgx: false });
  const [reportLoading, setReportLoading] = useState<Record<string, boolean>>({ dili: false, dict: false, diri: false, pgx: false });

  const currentAgent = AGENT_CONFIGS[activeTox] || AGENT_CONFIGS.dili;

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
        const fetchedHistory = historyRes.data || [];
        setHistory(fetchedHistory);
        setLoading(false);

        // Auto-generate ONLY if no current result exists for this agent
        const matching = fetchedHistory.filter(
          (h: any) => h.Tox_Type?.toLowerCase() === agentKey.toLowerCase()
        );
        if (matching.length === 0) {
          generateReport(agentKey);
        }
      })
      .catch((err) => {
        console.error('Error fetching drug details:', err);
        setError('Failed to load drug details.');
        setLoading(false);
      });
  }, [setId, agentKey]);

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
    if (/^\d{8}$/.test(dateStr)) {
      const yyyy = dateStr.substring(0, 4);
      const mm = dateStr.substring(4, 6);
      const dd = dateStr.substring(6, 8);
      return `${yyyy}-${mm}-${dd}`;
    }
    return dateStr;
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <CircularProgress size={48} sx={{ color: currentAgent.color }} />
        <Typography variant="body1" sx={{ mt: 2, color: 'text.secondary', fontWeight: 600 }}>
          Loading {currentAgent.name} safety assessment...
        </Typography>
      </Box>
    );
  }

  if (error || !detail) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography variant="h6" color="error">{error || 'Drug not found'}</Typography>
        <Button variant="outlined" sx={{ mt: 2 }} onClick={() => window.history.back()}>
          Go Back
        </Button>
      </Box>
    );
  }

  return (
    <div className="afl-app-root" style={{ background: '#f8fafc', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Header />
      <div className="afl-main-container" style={{ flex: 1, padding: '24px 32px', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        <div className="afl-content-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
            {/* NAV BREADCRUMB */}
            <div className="afl-label-crumbs" style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
              <Link href="/dashboard" style={{ color: '#64748b', textDecoration: 'none', fontWeight: 600 }}>Dashboard</Link>
              <span style={{ color: '#94a3b8' }}>›</span>
              <Link href={withDashboardBase(`/dashboard/label/${setId}`)} style={{ color: '#64748b', textDecoration: 'none', fontWeight: 600 }}>{detail.Trade_Name}</Link>
              <span style={{ color: '#94a3b8' }}>›</span>
              <span style={{ color: currentAgent.color, fontWeight: 800 }}>{currentAgent.name}</span>
            </div>

            {/* DRUG IDENTITY CARD */}
            <div className="document-header-container" style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 16px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
                    <div style={{ flex: 1, minWidth: '280px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                             <span style={{ 
                               background: `${currentAgent.color}15`, 
                               color: currentAgent.color, 
                               border: `1px solid ${currentAgent.color}40`, 
                               padding: '4px 12px', 
                               borderRadius: '20px', 
                               fontWeight: 800, 
                               fontSize: '0.8rem',
                               display: 'inline-flex',
                               alignItems: 'center',
                               gap: '6px'
                             }}>
                               <span>{currentAgent.icon}</span> {currentAgent.name}
                             </span>
                             <h1 className="DocumentTitle" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#0f172a', margin: 0, textTransform: 'capitalize' }}>
                              {([detail.Trade_Name, formatDate(detail.SPL_Effective_Time)]
                                      .filter(Boolean)
                                      .join(' - ')
                                      .toLowerCase())}
                             </h1>
                        </div>
                        <div className="doc-meta-row" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '14px', fontSize: '0.85rem', color: '#64748b' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#475569' }}>Generic Name:</span>
                                <span style={{ color: '#0f172a', fontWeight: 700 }}>{detail.Generic_Proper_Names || 'N/A'}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontWeight: 600, color: '#475569' }}>Manufacturer:</span>
                                <span style={{ color: '#0f172a', fontWeight: 700 }}>{detail.Author_Organization || 'N/A'}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* AGENT-SPECIFIC INSTRUCTIONS PANEL */}
            <div style={{ 
              background: '#ffffff', 
              border: `1px solid ${currentAgent.color}35`, 
              borderLeft: `5px solid ${currentAgent.color}`,
              borderRadius: '16px', 
              padding: '20px 24px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
              boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
              transition: 'all 0.3s ease'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.25rem' }}>{currentAgent.icon}</span>
                  <span style={{ fontWeight: 800, fontSize: '1rem', color: '#0f172a' }}>About {currentAgent.title}</span>
                </div>
                <button 
                  onClick={() => setInstructionsExpanded(!instructionsExpanded)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: currentAgent.color,
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
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#334155', lineHeight: '1.6' }}>
                  {currentAgent.instructions}
                </p>
              )}
            </div>

            {/* AI ASSESSMENT CONTENT AREA */}
            <Box sx={{ p: 4, backgroundColor: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
                  <Box sx={{ p: 3, backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                          <Typography variant="h6" sx={{ fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 1 }}>
                              <AutoAwesomeIcon sx={{ color: currentAgent.color }} /> {currentAgent.name} Assessment Records
                          </Typography>
                          <Button 
                            variant="contained" 
                            onClick={() => generateReport(activeTox)}
                            disabled={reportLoading[activeTox]}
                            sx={{ fontWeight: 700, backgroundColor: currentAgent.color, '&:hover': { backgroundColor: currentAgent.color, opacity: 0.9 } }}
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
            </Box>
          </div>
        </div>
      </div>
  );
}
