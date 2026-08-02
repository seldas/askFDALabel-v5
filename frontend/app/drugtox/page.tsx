'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import Header from "../components/Header";
import {
  Container,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  CircularProgress,
  Box,
  Chip,
  Drawer,
  IconButton,
  TextField,
  InputAdornment,
  Button,
  TablePagination,
  useTheme,
  Autocomplete,
  Stack,
  Avatar,
  FormControlLabel,
  Switch,
  Card,
  CardContent,
  GlobalStyles,
  Dialog,
  DialogTitle,
  DialogContent,
  Alert,
  Select,
  MenuItem,
  FormControl,
  ToggleButton,
  ToggleButtonGroup,
  Collapse,
  Fade,
} from '@mui/material';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from 'recharts';
import Grid from '@mui/material/GridLegacy'; 
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import BusinessIcon from '@mui/icons-material/Business';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import ScienceIcon from '@mui/icons-material/Science';
import HistoryIcon from '@mui/icons-material/History';
import InfoIcon from '@mui/icons-material/Info';
import DescriptionIcon from '@mui/icons-material/Description';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import NoteIcon from '@mui/icons-material/Note';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ListIcon from '@mui/icons-material/List';
import AssignmentIcon from '@mui/icons-material/Assignment';
import CompareArrowsIcon from '@mui/icons-material/CompareArrows';
import LaunchIcon from '@mui/icons-material/Launch';
import { useUser } from '../context/UserContext';
import { API_BASE, withDashboardBase, withAppBase } from '../utils/appPaths';
import Link from 'next/link';
import debounce from 'lodash/debounce';

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
  Explanations?: string;
}

interface DrugDetail extends DrugSummary {
  PLR: number;
  Evidence: string;
  Supported_Section: string;
  Update_Notes: string;
  AI_Summary: string;
  Routes?: string;
  Dosage_Form?: string;
  Application_Number?: string;
  Is_RLD?: number;
  Is_RS?: number;
  Doc_Type?: string;
}

interface HistoryItem {
  SETID: string;
  Toxicity_Class: string;
  SPL_Effective_Time: string;
  is_historical: number;
  Update_Notes: string;
  Trade_Name: string;
  Author_Organization: string;
}

interface MarketItem {
  SETID: string;
  Trade_Name: string;
  Author_Organization: string;
  Toxicity_Class: string;
  SPL_Effective_Time: string;
}

interface DiscrepancyItem {
  generic_name: string;
  tox_range: string;
  severity_gap: number;
  manufacturer_count: number;
  classes_found: string[];
  details: { Trade_Name: string; Author_Organization: string; Toxicity_Class: string; SETID: string; endpoint?: string }[];
  rld_info?: {
    status: string;
    setid: string | null;
    is_rld?: boolean;
    is_rs?: boolean;
  };
}

interface Stats {
  distribution: { Toxicity_Class: string; count: number }[];
  total_changes: number;
}

interface CompanyStats {
  distribution: { Toxicity_Class: string; count: number }[];
  total_drugs: number;
}

interface DayItem {
  dateStr: string;
  dayOfWeekAndNum: string;
  date: Date;
  initialized: number;
  updated: number;
  total: number;
  classes?: Record<string, number>;
}

interface MonthGroup {
  monthName: string;
  monthNum: number;
  days: DayItem[];
}

interface YearGroup {
  year: number;
  months: MonthGroup[];
}


const TOX_ORDER: Record<string, number> = {
  'Most': 1,
  'Less': 2,
  'No': 3,
  'Precaution': 4,
  'Unknown': 5,
};

const BACKEND_API_PREFIX = `${API_BASE}/api`;
const DRUGTOX_API_PREFIX = `${BACKEND_API_PREFIX}/drugtox`;

export default function DrugToxPage() {
  const theme = useTheme();
  const { session, updateAiProvider, loading: userLoading } = useUser();
  const [activeDropdown, setActiveDropdown] = useState<'user' | 'nav' | 'more' | null>(null);
  const [isInternal, setIsInternal] = useState(false);

  useEffect(() => {
    const handleClickOutside = () => setActiveDropdown(null);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  useEffect(() => {
    const checkInternalStatus = async () => {
      try {
        const response = await fetch(`${BACKEND_API_PREFIX}/check-fdalabel`, { method: 'POST' });
        const data = await response.json();
        setIsInternal(data.isInternal);
      } catch (error) {
        setIsInternal(false);
      }
    };
    checkInternalStatus();
  }, []);

  const [inputValue, setInputValue] = useState('');
  const [options, setOptions] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [toxType, setToxType] = useState<string | null>('DILI');

  const [isOral, setIsOral] = useState(false);
  const [isPLR, setIsPLR] = useState(false);

  const [drugs, setDrugs] = useState<DrugSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(20);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  const [selectedSetid, setSelectedSetid] = useState<string | null>(null);
  const [detail, setDetail] = useState<DrugDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
              
            const [rldOnly, setRldOnly] = useState(false);

  // Export Dialog State
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportOralOnly, setExportOralOnly] = useState(true);

  // Drawer Resizing State
  const [drawerWidth, setDrawerWidth] = useState(800);
  const isResizing = useRef(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    isResizing.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', stopResizing);
    e.preventDefault();
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', stopResizing);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 400 && newWidth < window.innerWidth * 0.9) {
      setDrawerWidth(newWidth);
    }
  }, []);


  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // Update Statistics Dialog State
  const [showNotesStatsDialog, setShowNotesStatsDialog] = useState(false);
  const [notesStatsHistory, setNotesStatsHistory] = useState<any>(null);
  const [notesStatsLoading, setNotesStatsLoading] = useState(false);
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({});

  const groupedTimeline = useMemo<YearGroup[]>(() => {
    if (!notesStatsHistory?.timeline) return [];

    const yearsMap = new Map<number, Map<number, DayItem[]>>();

    notesStatsHistory.timeline.forEach((item: any) => {
      if (!item.date || item.date === "Unknown Date") return;
      const parts = item.date.split('-');
      if (parts.length !== 3) return;
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      const day = parseInt(parts[2], 10);
      if (isNaN(year) || isNaN(month) || isNaN(day)) return;

      const dateObj = new Date(year, month - 1, day);
      const dayOfWeekAndNum = dateObj.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' });

      const dayItem: DayItem = {
        dateStr: item.date,
        dayOfWeekAndNum,
        date: dateObj,
        initialized: item.initialized || 0,
        updated: item.updated || 0,
        total: item.total || 0,
        classes: item.classes || {},
      };

      if (!yearsMap.has(year)) {
        yearsMap.set(year, new Map<number, DayItem[]>());
      }
      const monthsMap = yearsMap.get(year)!;
      if (!monthsMap.has(month)) {
        monthsMap.set(month, []);
      }
      monthsMap.get(month)!.push(dayItem);
    });

    const sortedYears: YearGroup[] = Array.from(yearsMap.keys())
      .sort((a, b) => b - a)
      .map(year => {
        const monthsMap = yearsMap.get(year)!;
        const sortedMonths: MonthGroup[] = Array.from(monthsMap.keys())
          .sort((a, b) => b - a)
          .map(monthNum => {
            const days = monthsMap.get(monthNum)!;
            days.sort((a, b) => b.dateStr.localeCompare(a.dateStr));
            const dummyDate = new Date(year, monthNum - 1, 1);
            const monthName = dummyDate.toLocaleDateString('en-US', { month: 'long' });

            return {
              monthName,
              monthNum,
              days,
            };
          });

        return {
          year,
          months: sortedMonths,
        };
      });

    return sortedYears;
  }, [notesStatsHistory]);



  const handleOpenNotesStatsDialog = () => {
    setShowNotesStatsDialog(true);
    setNotesStatsLoading(true);
    setExpandedDays({});
    axios.get(`${DRUGTOX_API_PREFIX}/drugs/update_notes_stats`, { params: { tox_type: toxType } })
      .then(res => {
        setNotesStatsHistory(res.data);
        setNotesStatsLoading(false);
      })
      .catch(err => {
        console.error(err);
        setNotesStatsLoading(false);
      });
  };


  
  const COLORS: Record<string, string> = {
    Most: '#c62828',
    Less: '#ef6c00',
    No: '#2e7d32',
    Precaution: '#1565c0',
    Unknown: '#757575',
  };

  const fetchStats = useCallback((currentTox: string | null) => {
    setStatsLoading(true);
    axios
      .get(`${DRUGTOX_API_PREFIX}/stats`, { params: { tox_type: currentTox } })
      .then((res) => {
        setStats({
          ...res.data,
          distribution: res.data.distribution.sort((a: any, b: any) => b.count - a.count),
        });
        setStatsLoading(false);
      })
      .catch((err) => console.error(err));
  }, []);


  useEffect(() => {
    fetchStats(toxType);
  }, [toxType, fetchStats]);

  const fetchSuggestions = useMemo(() =>
    debounce((input: string, oral: boolean, plr: boolean) => {
      if (input.length < 2) {
        setOptions([]);
        return;
      }
      axios
      .get(`${DRUGTOX_API_PREFIX}/autocomplete?q=${encodeURIComponent(input)}&oral=${oral}&plr=${plr}`)
        .then((response) => setOptions(response.data))
        .catch((err) => console.error(err));
    }, 300),
    []
  );

  useEffect(() => {
    fetchSuggestions(inputValue, isOral, isPLR);
  }, [inputValue, isOral, isPLR, fetchSuggestions]);

  const fetchDrugs = async (searchQuery: string, currentTox: string | null, oral: boolean, plr: boolean, pageNum: number, limit: number) => {
    setLoading(true);
    try {
      const res = await axios.get(`${DRUGTOX_API_PREFIX}/drugs`, {
        params: {
          q: searchQuery,
          tox_type: currentTox,
          oral,
          plr,
          page: pageNum + 1,
          limit,
        },
      });
      setDrugs(res.data.items);
      setTotal(res.data.total);
      setLoading(false);
    } catch (error) {
      console.error('Error fetching drugs:', error);
      setLoading(false);
    }
  };

  const handleSearchSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPage(0);
    setHasSearched(true);
    setQuery(inputValue);
    fetchDrugs(inputValue, toxType, isOral, isPLR, 0, rowsPerPage);
    fetchStats(toxType);
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
    fetchDrugs(query, toxType, isOral, isPLR, newPage, rowsPerPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newLimit = parseInt(event.target.value, 10);
    setRowsPerPage(newLimit);
    setPage(0);
    fetchDrugs(query, toxType, isOral, isPLR, 0, newLimit);
  };

  const handleFilterToggle = (filter: 'oral' | 'plr') => {
    let newOral = isOral, newPLR = isPLR;
    if (filter === 'oral') { newOral = !isOral; setIsOral(newOral); }
    if (filter === 'plr') { newPLR = !isPLR; setIsPLR(newPLR); }
    
    setPage(0);
    fetchDrugs(query, toxType, newOral, newPLR, 0, rowsPerPage);
  };



  useEffect(() => {
    if (selectedSetid) {
      setDetailLoading(true);
      axios.get(`${DRUGTOX_API_PREFIX}/drugs/${selectedSetid}`, { params: { tox_type: toxType } })
        .then((detailRes) => {
          setDetail(detailRes.data);
          setDetailLoading(false);
        })
        .catch((error) => {
          console.error('Error fetching drug info:', error);
          setDetailLoading(false);
        });
    } else {
      setDetail(null);
    }
  }, [selectedSetid, toxType]);

  
  
  const getToxColor = (toxClass: string) => {
    if (!toxClass) return 'default';
    const lower = toxClass.toLowerCase();
    switch (lower) {
      case 'most':
        return 'error';
      case 'less':
        return 'warning';
      case 'no':
        return 'success';
      case 'precaution':
        return 'info';
      case 'not assessed':
        return 'default';
      default:
        return 'default';
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

  const MetaItem = ({
    icon,
    label,
    value,
    isLink = false,
    onClick,
  }: {
    icon: any;
    label: string;
    value: any;
    isLink?: boolean;
    onClick?: () => void;
  }) => (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', mb: 2 }}>
      <Box sx={{ mr: 1.5, mt: 0.3, color: 'primary.main', display: 'flex' }}>{icon}</Box>
      <Box>
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}
        >
          {label}
        </Typography>
        {isLink && value !== 'N/A' ? (
          <Typography
            variant="body2"
            component="a"
            href={value}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              fontWeight: 600,
              color: '#1a237e',
              textDecoration: 'underline',
              cursor: 'pointer',
              display: 'block',
            }}
          >
            View Official Labeling
          </Typography>
        ) : (
          <Typography
            variant="body2"
            onClick={onClick}
            sx={{
              fontWeight: 500,
              color: onClick ? '#1a237e' : 'text.primary',
              cursor: onClick ? 'pointer' : 'default',
              textDecoration: onClick ? 'underline' : 'none',
            }}
          >
            {value || 'N/A'}
          </Typography>
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: '#f4f7f9',
        width: '100%',
        m: 0,
        p: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <GlobalStyles
        styles={{
          html: { margin: 0, padding: 0, width: '100%', overflowX: 'hidden' },
          body: { margin: 0, padding: 0, width: '100%', overflowX: 'hidden', display: 'block' },
          '#root': {
            margin: '0 !important',
            padding: '0 !important',
            width: '100%',
            maxWidth: 'none !important',
            textAlign: 'left !important',
          },
          '.MuiPaper-root': { boxShadow: '0 2px 12px rgba(0,0,0,0.05) !important' },
          // Scoped styles for LLM-generated HTML previewed via dangerouslySetInnerHTML
          '.drugtox-ai-preview': {
            fontSize: '0.85rem',
            lineHeight: 1.65,
            color: '#37474f',
            fontFamily: 'inherit',
          },
          '.drugtox-ai-preview h1, .drugtox-ai-preview h2, .drugtox-ai-preview h3': {
            color: '#1a237e',
            fontWeight: 800,
            marginTop: '1rem',
            marginBottom: '0.4rem',
          },
          '.drugtox-ai-preview p': { margin: '0.4rem 0' },
          '.drugtox-ai-preview ul, .drugtox-ai-preview ol': { paddingLeft: '1.4rem', margin: '0.4rem 0' },
          '.drugtox-ai-preview .label-section': {
            marginBottom: '1rem',
            paddingBottom: '0.75rem',
            borderBottom: '1px solid #e3f2fd',
          },
          '.drugtox-ai-preview .toxicity-summary': {
            background: '#e8eaf6',
            borderRadius: '8px',
            padding: '10px 14px',
            marginBottom: '0.75rem',
            fontWeight: 600,
          },
          '.drugtox-ai-preview [class*="badge-score"]': {
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: '4px',
            fontSize: '0.72rem',
            fontWeight: 800,
            background: '#1a237e',
            color: '#fff',
            margin: '2px 3px',
          },
        }}
      />

      <Header />

      <Container maxWidth="lg" sx={{ py: 8, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Box sx={{ textAlign: 'center', mb: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
          <Typography variant="h2" className="hero-title-animated" sx={{ fontWeight: 900, mb: 1, letterSpacing: '-1.5px' }}>
            askDrugTox
          </Typography>
          <Typography variant="h6" className="hero-subtitle-animated" color="text.secondary" sx={{ fontWeight: 400, opacity: 0.8, mb: 4 }}>
            Agentic AI System for Drug Toxicity Classification
          </Typography>

          <Paper sx={{ display: 'flex', alignItems: 'center', width: '100%', maxWidth: 900, p: 1, border: '1px solid #e2e8f0', borderRadius: '16px', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
            <Box sx={{ position: 'relative' }}>
              {/* Floating hint to switch endpoints */}
              {mounted && (
                <Box 
                  sx={{ 
                    position: 'absolute', 
                    top: '-42px', 
                    left: '12px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1,
                    backgroundColor: '#e8eaf6',
                    border: '1.5px solid #c5cae9',
                    borderRadius: '20px',
                    px: 1.5,
                    py: 0.5,
                    zIndex: 10,
                    pointerEvents: 'none',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(26, 35, 126, 0.08)',
                    '@keyframes bounce': {
                      '0%, 100%': { transform: 'translateY(0)' },
                      '50%': { transform: 'translateY(-4px)' },
                    },
                    animation: 'bounce 2s infinite ease-in-out',
                    '&::after': {
                      content: '""',
                      position: 'absolute',
                      bottom: '-6px',
                      left: '24px',
                      width: '0',
                      height: '0',
                      borderLeft: '5px solid transparent',
                      borderRight: '5px solid transparent',
                      borderTop: '6px solid #e8eaf6',
                    },
                    '&::before': {
                      content: '""',
                      position: 'absolute',
                      bottom: '-8px',
                      left: '23px',
                      width: '0',
                      height: '0',
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '7px solid #c5cae9',
                      zIndex: -1,
                    }
                  }}
                >
                  <Box 
                    sx={{ 
                      width: 7, 
                      height: 7, 
                      borderRadius: '50%', 
                      backgroundColor: '#1a237e',
                      '@keyframes pulse': {
                        '0%': { boxShadow: '0 0 0 0 rgba(26, 35, 126, 0.5)' },
                        '70%': { boxShadow: '0 0 0 6px rgba(26, 35, 126, 0)' },
                        '100%': { boxShadow: '0 0 0 0 rgba(26, 35, 126, 0)' },
                      },
                      animation: 'pulse 1.8s infinite ease-in-out',
                    }} 
                  />
                  <Typography sx={{ fontSize: '0.68rem', fontWeight: 850, color: '#1a237e', textTransform: 'uppercase', letterSpacing: '0.6px', lineHeight: 1 }}>
                    Switch Endpoint
                  </Typography>
                </Box>
              )}

              <FormControl size="small" sx={{ minWidth: 120, borderRight: '1px solid #e2e8f0', '& .MuiOutlinedInput-notchedOutline': { border: 'none' } }}>
                <Select
                  value={toxType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setToxType(val);
                    if (hasSearched) {
                      setPage(0);
                      fetchDrugs(query, val, isOral, isPLR, 0, rowsPerPage);
                    }
                  }}
                  sx={{ 
                    fontWeight: 800, 
                    color: 'primary.main',
                    '& .MuiSelect-select': { pl: 2 }
                  }}
                >
                  <MenuItem value="DILI" sx={{ fontWeight: 700 }}>LIVER</MenuItem>
                  <MenuItem value="DICT" sx={{ fontWeight: 700 }}>HEART</MenuItem>
                  <MenuItem value="DIRI" sx={{ fontWeight: 700 }}>KIDNEY</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Autocomplete
              fullWidth
              options={options}
              freeSolo
              inputValue={inputValue}
              onInputChange={(_e, v) => setInputValue(v)}
              onChange={(_e, v) => {
                const val = v || '';
                setQuery(val);
                if (val) {
                  setPage(0);
                  fetchDrugs(val, toxType, isOral, isPLR, 0, rowsPerPage);
                }
              }}
              clearIcon={<CloseIcon sx={{ fontSize: 20 }} />}
              sx={{ 
                flex: 1,
                '& .MuiAutocomplete-clearIndicator': {
                  color: '#64748b',
                  backgroundColor: 'transparent !important',
                }
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder="Analyze agent toxicity profile..."
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSearchSubmit();
                    }
                  }}
                  InputProps={{
                    ...params.InputProps,
                    disableUnderline: true,
                    startAdornment: (
                      <InputAdornment position="start" sx={{ ml: 2 }}>
                        <SearchIcon color="action" />
                      </InputAdornment>
                    ),
                  }}
                  sx={{ ml: 1, flex: 1, pr: 2 }}
                />
              )}
            />
            
            <Button 
              variant="contained" 
              onClick={() => handleSearchSubmit()} 
              startIcon={<ScienceIcon />}
              sx={{ 
                borderRadius: '12px', 
                px: 4, 
                py: 1.2, 
                fontWeight: 800, 
                boxShadow: 'none',
                textTransform: 'none',
                fontSize: '0.95rem'
              }}
            >
              Search
            </Button>
          </Paper>
        </Box>

        {/* Search Filters */}
        <Box sx={{ width: '100%', mb: 4, display: 'flex', justifyContent: 'center' }}>
          <Stack direction="row" spacing={3} alignItems="center">
            <FormControlLabel
              control={<Switch size="small" checked={isOral} onChange={() => handleFilterToggle('oral')} color="primary" />}
              label={<Typography variant="button" sx={{ fontWeight: 700, color: 'text.secondary', fontSize: '0.75rem' }}>Oral</Typography>}
            />
            <FormControlLabel
              control={<Switch size="small" checked={isPLR} onChange={() => handleFilterToggle('plr')} color="primary" />}
              label={<Typography variant="button" sx={{ fontWeight: 700, color: 'text.secondary', fontSize: '0.75rem' }}>PLR Format</Typography>}
            />
          </Stack>
        </Box>

        {/* Global Statistics Panel - Now on top */}
        <Box sx={{ width: '100%', mb: 6 }}>
          <Card sx={{ borderLeft: `6px solid ${theme.palette.primary.main}` }}>
            <CardContent sx={{ py: 3, px: 4 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 3 }}>
                <Box>
                  <Typography variant="overline" sx={{ fontWeight: 800, color: 'text.secondary' }}>
                    {toxType} Database Scope
                  </Typography>
                  <Typography variant="h3" sx={{ fontWeight: 900, color: 'primary.main', mb: 1 }}>
                    {stats ? stats.distribution.reduce((a, c) => a + c.count, 0).toLocaleString() : '0'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                    Total identified structured drug labels
                  </Typography>
                </Box>
                
                <Stack direction="row" spacing={3} alignItems="center" useFlexGap flexWrap="wrap">
                  {['Most', 'Less', 'No'].map(cat => {
                    const count = stats ? stats.distribution.find(d => d.Toxicity_Class === cat)?.count || 0 : 0;
                    return (
                      <Box key={cat} sx={{ textAlign: 'center' }}>
                        <Typography variant="h6" sx={{ fontWeight: 900, color: cat === 'Most' ? 'error.main' : cat === 'Less' ? 'warning.main' : 'success.main', lineHeight: 1 }}>
                          {count.toLocaleString()}
                        </Typography>
                        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', fontSize: '0.65rem' }}>
                          {cat.toUpperCase()} {toxType}
                        </Typography>
                      </Box>
                    );
                  })}
                  
                  <Button 
                    variant="outlined" 
                    size="small"
                    startIcon={<HistoryIcon />}
                    sx={{ 
                      height: '40px',
                      fontWeight: 800,
                      textTransform: 'none',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      ml: 2
                    }}
                    onClick={() => handleOpenNotesStatsDialog()}
                  >
                    Update Statistics
                  </Button>

                  <Button 
                    variant="contained" 
                    size="small"
                    startIcon={<AssignmentIcon />}
                    sx={{ 
                      height: '40px',
                      fontWeight: 800,
                      textTransform: 'none',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                    }}
                    onClick={() => setShowExportDialog(true)}
                  >
                    Export to Excel
                  </Button>
                </Stack>
              </Box>
            </CardContent>
          </Card>
        </Box>

        {/* Results Explorer */}
        <Box sx={{ width: '100%', mb: 4 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h5" sx={{ fontWeight: 900, color: '#1a237e', display: 'flex', alignItems: 'center' }}>
              <ListIcon sx={{ mr: 1 }} /> Agent Toxicity Explorer
            </Typography>
            
            <Stack direction="row" spacing={2} alignItems="center">
            </Stack>
          </Box>

          {hasSearched ? (
            <Paper sx={{ overflow: 'hidden', border: '1px solid #e0e0e0', borderRadius: '12px' }}>
              <TableContainer sx={{ maxHeight: '60vh' }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 900, backgroundColor: '#f8f9fa', color: '#1a237e' }}>SET-ID</TableCell>
                      <TableCell sx={{ fontWeight: 900, backgroundColor: '#f8f9fa', color: '#1a237e' }}>DRUG NAME</TableCell>
                      <TableCell sx={{ fontWeight: 900, backgroundColor: '#f8f9fa', color: '#1a237e' }}>COMPANY</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 900, backgroundColor: '#f8f9fa', color: '#1a237e' }}>
                        TOXICITY CLASS
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {drugs.length > 0 ? drugs.map((drug) => (
                      <React.Fragment key={drug.SETID}>
                      <TableRow
                        hover
                        onClick={() => setSelectedSetid(prev => prev === drug.SETID ? null : drug.SETID)}
                        sx={{
                          cursor: 'pointer',
                          backgroundColor:
                            selectedSetid === drug.SETID ? '#f8faff' : drug.is_historical === 1 ? '#fafafa' : 'inherit',
                          borderLeft:
                            selectedSetid === drug.SETID
                              ? '6px solid #1a237e'
                              : '6px solid transparent',
                          opacity: drug.is_historical === 1 ? 0.7 : 1,
                        }}
                      >
                        <TableCell sx={{ py: 2.5, color: '#546e7a', fontSize: '0.85rem' }}>
                          {drug.SETID}
                        </TableCell>
                        <TableCell sx={{ py: 2.5 }}>
                          <Stack direction="row" alignItems="center" spacing={1.5}>
                            <Typography variant="body2" sx={{ fontWeight: 800, color: '#1a237e' }}>
                              {drug.Trade_Name}
                            </Typography>
                            {drug.is_historical === 1 && (
                              <Chip label="ARCHIVED" size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18, fontWeight: 800 }} />
                            )}
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600, color: '#455a64' }}>
                            {drug.Author_Organization}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={drug.Toxicity_Class}
                            color={getToxColor(drug.Toxicity_Class) as any}
                            variant="filled"
                            sx={{ minWidth: 100, fontWeight: 900, borderRadius: '8px' }}
                          />
                          <br />
                          {(drug.endpoint === 'Fuzzy' || drug.endpoint === 'Disagree') && (
                            <Chip label={drug.endpoint} size="small" color="warning" variant="outlined" sx={{ fontWeight: 700, mt: 1, height: 20, fontSize: '0.65rem' }} />
                          )}
                        </TableCell>
                      </TableRow>
                      
                      {/* Expandable Panel */}
                      <TableRow>
                        <TableCell style={{ paddingBottom: 0, paddingTop: 0, border: 0 }} colSpan={4}>
                          <Collapse in={selectedSetid === drug.SETID} timeout="auto" unmountOnExit>
                            <Box sx={{ margin: 3, padding: 3, backgroundColor: '#ffffff', borderRadius: '12px', border: '1px solid #e0e6f0', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                              {detailLoading ? (
                                <Box display="flex" justifyContent="center" alignItems="center" p={2}>
                                  <CircularProgress size={20} />
                                </Box>
                              ) : detail && detail.SETID === drug.SETID ? (
                                <Box>
                                  {/* ── Header row: title + action buttons ── */}
                                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={2.5} flexWrap="wrap" gap={1}>
                                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#1a237e' }}>
                                      {detail.Toxicity_Class === 'Not Assessed' ? 'Label Information' : 'Evidence Preview'}
                                    </Typography>
                                     <Box display="flex" gap={1}>
                                      <Button
                                        variant="contained"
                                        color="primary"
                                        size="small"
                                        endIcon={<LaunchIcon />}
                                        onClick={() => window.location.href = withAppBase(`/drugtox/${drug.SETID}`)}
                                        sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 700 }}
                                      >
                                        View in Detail
                                      </Button>
                                    </Box>
                                  </Box>

                                  {/* ── Metadata grid ── */}
                                  <Box sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                                    gap: 1.5,
                                    mb: 2.5,
                                    p: 2,
                                    backgroundColor: '#f8faff',
                                    borderRadius: '10px',
                                    border: '1px solid #e3f2fd'
                                  }}>
                                    {([
                                      { label: 'Revised Date', value: detail.SPL_Effective_Time ? `${detail.SPL_Effective_Time.slice(0,4)}-${detail.SPL_Effective_Time.slice(4,6)}-${detail.SPL_Effective_Time.slice(6,8)}` : '—' },
                                      { label: 'Application No.', value: detail.Application_Number || '—' },
                                      { label: 'Routes', value: detail.Routes || '—' },
                                      { label: 'Dosage Form', value: detail.Dosage_Form || '—' },
                                      { label: 'AI Model', value: (detail as any).AI_Model || '—' },
                                      { label: 'Assessment Date', value: (detail as any).Assessment_Date || '—' },
                                    ] as {label: string; value: string}[]).map(({ label, value }) => (
                                      <Box key={label}>
                                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.06em' }}>
                                          {label}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 600, color: '#37474f', fontSize: '0.8rem', mt: 0.25, wordBreak: 'break-word' }}>
                                          {value}
                                        </Typography>
                                      </Box>
                                    ))}
                                    {/* RLD / RS badges */}
                                    {(detail.Is_RLD === 1 || detail.Is_RS === 1) && (
                                      <Box>
                                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#90a4ae', textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: '0.06em' }}>
                                          Status
                                        </Typography>
                                        <Box display="flex" gap={0.5} mt={0.5} flexWrap="wrap">
                                          {detail.Is_RLD === 1 && (
                                            <Chip label="RLD" size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 800, backgroundColor: '#e3f2fd', color: '#1565c0' }} />
                                          )}
                                          {detail.Is_RS === 1 && (
                                            <Chip label="RS" size="small" sx={{ height: 18, fontSize: '0.6rem', fontWeight: 800, backgroundColor: '#f3e5f5', color: '#6a1b9a' }} />
                                          )}
                                        </Box>
                                      </Box>
                                    )}
                                  </Box>

                                  {/* ── Preview / Not Assessed placeholder ── */}
                                  {detail.Toxicity_Class === 'Not Assessed' ? (
                                    <Box sx={{
                                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                      gap: 1.5, py: 4, backgroundColor: '#fffde7', borderRadius: '10px',
                                      border: '1px dashed #f9a825'
                                    }}>
                                      <Typography variant="body2" sx={{ color: '#795548', fontWeight: 700, textAlign: 'center' }}>
                                        This drug has not yet been assessed by the AI system.
                                      </Typography>
                                      <Typography variant="caption" sx={{ color: '#9e9e9e', textAlign: 'center' }}>
                                        Use &ldquo;View in Detail&rdquo; to open the label page, or check back after the next generation run.
                                      </Typography>
                                    </Box>
                                  ) : (
                                    // AI_Summary is LLM-generated HTML (not Markdown) — render it directly.
                                    // Previously passed to <ReactMarkdown> which escaped all HTML tags, causing them to show as raw text.
                                    <Box sx={{ backgroundColor: '#f8faff', p: 2, borderRadius: '8px', border: '1px solid #e3f2fd', overflowX: 'auto' }}>
                                      {(() => {
                                        const content = detail.AI_Summary || detail.Explanations || detail.Evidence || '';
                                        if (!content) {
                                          return (
                                            <Typography variant="body2" sx={{ color: '#90a4ae', fontStyle: 'italic' }}>
                                              No detailed evidence available.
                                            </Typography>
                                          );
                                        }
                                        // Detect HTML: new LLM reports contain block-level tags;
                                        // old historical records are plain Markdown text.
                                        const isHtml = /<(div|span|p|h[1-6]|ul|ol|li|table|strong|em|br)\b/i.test(content);
                                        return isHtml ? (
                                          <div
                                            className="drugtox-ai-preview"
                                            dangerouslySetInnerHTML={{ __html: content }}
                                          />
                                        ) : (
                                          <Typography component="div" variant="body2" sx={{ lineHeight: 1.6, color: '#37474f' }} className="drugtox-ai-preview">
                                            <ReactMarkdown>{content}</ReactMarkdown>
                                          </Typography>
                                        );
                                      })()}
                                    </Box>
                                  )}
                                </Box>
                              ) : null}
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                      </React.Fragment>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={4} align="center" sx={{ py: 8 }}>
                          <Typography variant="body1" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                            No results found for your query. Try adjusting filters.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                rowsPerPageOptions={[10, 20, 50]}
                component="div"
                count={total}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
              />
            </Paper>
          ) : (
            <Box 
              sx={{ 
                backgroundColor: '#ffffff', 
                borderRadius: '20px', 
                border: '1px solid #e8eaf6',
                boxShadow: '0 10px 30px rgba(26, 35, 126, 0.03)',
                p: { xs: 4, md: 6 }, 
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4
              }}
            >
              {/* Icon & Title */}
              <Box sx={{ maxWidth: 600 }}>
                <Box 
                  sx={{ 
                    width: 70, 
                    height: 70, 
                    borderRadius: '50%', 
                    backgroundColor: 'rgba(26, 35, 126, 0.05)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    mb: 3, 
                    mx: 'auto' 
                  }}
                >
                  <ScienceIcon sx={{ fontSize: 36, color: '#1a237e' }} />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 900, color: '#1a237e', mb: 1.5 }}>
                  Welcome to the Agent Toxicity Explorer
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 550, lineHeight: 1.6 }}>
                  Select one of the primary toxicity endpoints below to instantly load the full dataset, or type a drug name, set-id, or application number in the search bar above to begin exploring.
                </Typography>
              </Box>

              {/* Organ Shortcuts */}
              <Grid container spacing={3} sx={{ maxWidth: 800, width: '100%', mt: 1 }}>
                {[
                  {
                    id: 'DILI',
                    name: 'Liver Toxicity (DILI)',
                    desc: 'Drug-Induced Liver Injury classification and labels',
                    color: '#2e7d32',
                    bg: 'rgba(46, 125, 50, 0.04)',
                    hoverBg: 'rgba(46, 125, 50, 0.08)',
                    borderColor: 'rgba(46, 125, 50, 0.15)',
                    iconColor: '#2e7d32'
                  },
                  {
                    id: 'DICT',
                    name: 'Heart Toxicity (DICT)',
                    desc: 'Drug-Induced Cardiotoxicity database classification',
                    color: '#ed6c02',
                    bg: 'rgba(237, 108, 2, 0.04)',
                    hoverBg: 'rgba(237, 108, 2, 0.08)',
                    borderColor: 'rgba(237, 108, 2, 0.15)',
                    iconColor: '#ed6c02'
                  },
                  {
                    id: 'DIRI',
                    name: 'Kidney Toxicity (DIRI)',
                    desc: 'Drug-Induced Renal Injury classification and history',
                    color: '#1565c0',
                    bg: 'rgba(21, 101, 192, 0.04)',
                    hoverBg: 'rgba(21, 101, 192, 0.08)',
                    borderColor: 'rgba(21, 101, 192, 0.15)',
                    iconColor: '#1565c0'
                  }
                ].map((item) => (
                  <Grid item xs={12} sm={4} key={item.id}>
                    <Box
                      onClick={() => {
                        setToxType(item.id);
                        setHasSearched(true);
                        setPage(0);
                        fetchDrugs('', item.id, isOral, isPLR, 0, rowsPerPage);
                      }}
                      sx={{
                        p: 3,
                        height: '100%',
                        borderRadius: '16px',
                        border: `1.5px solid ${item.borderColor}`,
                        backgroundColor: item.bg,
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease-in-out',
                        '&:hover': {
                          backgroundColor: item.hoverBg,
                          transform: 'translateY(-3px)',
                          boxShadow: `0 8px 20px ${item.bg === 'rgba(46, 125, 50, 0.04)' ? 'rgba(46, 125, 50, 0.08)' : item.bg === 'rgba(237, 108, 2, 0.04)' ? 'rgba(237, 108, 2, 0.08)' : 'rgba(21, 101, 192, 0.08)'}`
                        }
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, color: item.color, fontSize: '0.9rem' }}>
                          {item.name}
                        </Typography>
                        <LaunchIcon sx={{ fontSize: 16, color: item.iconColor, opacity: 0.8 }} />
                      </Box>
                      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 550, display: 'block', lineHeight: 1.4 }}>
                        {item.desc}
                      </Typography>
                    </Box>
                  </Grid>
                ))}
              </Grid>

              {/* Tip box */}
              <Box 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: 1.5, 
                  backgroundColor: '#f8faff', 
                  border: '1px solid #e3f2fd', 
                  borderRadius: '12px', 
                  p: 2, 
                  maxWidth: 600,
                  width: '100%' 
                }}
              >
                <InfoIcon color="primary" sx={{ fontSize: 20 }} />
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textAlign: 'left' }}>
                  <strong>Pro Tip:</strong> You can search for generic names, application numbers (e.g. <code>NDA021172</code>), or exact set IDs (UUIDs) in the search bar to find matching annotations.
                </Typography>
              </Box>
            </Box>
          )}
        </Box>


      </Container>

      

      {/* Export Dialog */}
      <Dialog 
        open={showExportDialog} 
        onClose={() => setShowExportDialog(false)} 
        maxWidth="sm" 
        fullWidth 
        PaperProps={{ sx: { borderRadius: '16px !important', p: 2 } }}
      >
        <DialogTitle sx={{ pb: 1, fontWeight: 900, color: '#1a237e' }}>
          Export {toxType} Data to Excel
        </DialogTitle>

        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            Export {toxType} data grouped by application number, with fallback grouping and labeling metadata.
          </Typography>

          <Stack spacing={1.5} sx={{ mb: 3 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={exportOralOnly}
                  onChange={(e) => setExportOralOnly(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Oral Only
                </Typography>
              }
            />


          </Stack>

          <Button 
            variant="contained" 
            onClick={async () => {
              try {
                const response = await axios.get(`${DRUGTOX_API_PREFIX}/export`, {
                  params: {
                    tox_type: toxType,
                    oral_only: exportOralOnly,
                  },
                  responseType: 'blob',
                });

                const url = window.URL.createObjectURL(new Blob([response.data]));
                const link = document.createElement('a');
                link.href = url;

                const contentDisposition = response.headers['content-disposition'];
                const filename =
                  contentDisposition?.split('filename=')[1]?.replaceAll('"', '') ||
                  `${toxType}_toxicity_data.xlsx`;

                link.setAttribute('download', filename);
                document.body.appendChild(link);
                link.click();
                link.remove();
                window.URL.revokeObjectURL(url);
                setShowExportDialog(false);
              } catch (error) {
                console.error('Error exporting data:', error);
              }
            }}
            sx={{ fontWeight: 800, textTransform: 'none' }}
          >
            Export
          </Button>
        </DialogContent>
      </Dialog>

      {/* Update Statistics Dialog */}
      <Dialog
        open={showNotesStatsDialog}
        onClose={() => setShowNotesStatsDialog(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { borderRadius: '20px !important', p: 1 } }}
      >
        <DialogTitle
          sx={{
            pb: 1,
            fontWeight: 900,
            color: '#1a237e',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <HistoryIcon color="primary" sx={{ fontSize: 28 }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 900, color: '#1a237e' }}>
                {toxType} Update History & Timeline
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                Aggregated statistics from structural labeling update logs
              </Typography>
            </Box>
          </Box>
          <IconButton onClick={() => setShowNotesStatsDialog(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ py: 2 }}>
          {notesStatsLoading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 2 }}>
              <CircularProgress size={50} thickness={4.5} />
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                Parsing update notes and aggregating timeline...
              </Typography>
            </Box>
          ) : notesStatsHistory ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              
              {/* Summary Cards */}
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 1 }}>
                {[
                  {
                    label: 'Total Update Logs',
                    val: notesStatsHistory.total_records,
                    color: 'primary.main',
                    bg: 'rgba(26, 35, 126, 0.04)',
                    border: 'rgba(26, 35, 126, 0.1)'
                  },
                  {
                    label: 'Initializations',
                    val: notesStatsHistory.total_initialized,
                    color: 'success.main',
                    bg: 'rgba(46, 125, 50, 0.04)',
                    border: 'rgba(46, 125, 50, 0.1)'
                  },
                  {
                    label: 'Subsequent Updates',
                    val: notesStatsHistory.total_updated,
                    color: 'warning.main',
                    bg: 'rgba(237, 108, 2, 0.04)',
                    border: 'rgba(237, 108, 2, 0.1)'
                  }
                ].map((c, idx) => (
                  <Box
                    key={idx}
                    sx={{
                      flex: 1,
                      minWidth: 150,
                      p: 2.5,
                      borderRadius: '16px',
                      backgroundColor: c.bg,
                      border: `1px solid ${c.border}`,
                      textAlign: 'center'
                    }}
                  >
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {c.label}
                    </Typography>
                    <Typography variant="h4" sx={{ fontWeight: 900, color: c.color, mt: 0.5 }}>
                      {c.val?.toLocaleString() || 0}
                    </Typography>
                    {idx === 0 && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.65rem', mt: 0.5, lineHeight: 1.3 }}>
                        Includes all historical versions.<br />May exceed Database Scope.
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>

              {/* Timeline Section */}
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#1a237e', mb: 2.5 }}>
                  Chronological Update Timeline
                </Typography>
                
                <Box 
                  sx={{ 
                    position: 'relative',
                    maxHeight: '400px', 
                    overflowY: 'auto', 
                    pl: 1,
                    pr: 1.5,
                    // custom scrollbar
                    '&::-webkit-scrollbar': { width: '8px' },
                    '&::-webkit-scrollbar-track': { backgroundColor: '#f1f1f1', borderRadius: '4px' },
                    '&::-webkit-scrollbar-thumb': { backgroundColor: '#c5cae9', borderRadius: '4px', '&:hover': { backgroundColor: '#9fa8da' } }
                  }}
                >
                  {groupedTimeline && groupedTimeline.length > 0 ? (
                    groupedTimeline.map((yearGroup) => (
                      <Box key={yearGroup.year} sx={{ mb: 4 }}>
                        {/* Year Header */}
                        <Typography 
                          variant="subtitle1" 
                          sx={{ 
                            fontWeight: 900, 
                            color: '#1a237e', 
                            mb: 2, 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1,
                            backgroundColor: 'rgba(26, 35, 126, 0.04)',
                            p: '8px 16px',
                            borderRadius: '8px'
                          }}
                        >
                          <CalendarTodayIcon sx={{ fontSize: 18, color: '#3f51b5' }} /> {yearGroup.year}
                        </Typography>

                        {/* Months */}
                        {yearGroup.months.map((monthGroup) => (
                          <Box key={monthGroup.monthNum} sx={{ mb: 2.5, pl: 2, position: 'relative' }}>
                            {/* Month Name */}
                            <Typography 
                              variant="subtitle2" 
                              sx={{ 
                                fontWeight: 800, 
                                color: '#3949ab', 
                                mb: 1.5, 
                                pl: 1 
                              }}
                            >
                              {monthGroup.monthName}
                            </Typography>

                            {/* Vertical Line for Month */}
                            <Box 
                              sx={{ 
                                position: 'absolute', 
                                left: '25px', 
                                top: '32px', 
                                bottom: '16px', 
                                width: '2px', 
                                backgroundColor: '#c5cae9',
                                zIndex: 0 
                              }} 
                            />

                            {/* Days container */}
                            <Box sx={{ pl: 4 }}>
                              {monthGroup.days.map((dayItem) => (
                                <Box 
                                  key={dayItem.dateStr}
                                  onClick={() => setExpandedDays(prev => ({ ...prev, [dayItem.dateStr]: !prev[dayItem.dateStr] }))}
                                  sx={{ 
                                    position: 'relative',
                                    display: 'flex', 
                                    flexDirection: 'column',
                                    alignItems: 'stretch',
                                    cursor: 'pointer',
                                    py: 1.5, 
                                    pl: 3,
                                    pr: 2.5,
                                    mb: 1.5,
                                    borderRadius: '12px',
                                    border: '1px solid #e8eaf6',
                                    backgroundColor: '#ffffff',
                                    boxShadow: '0 2px 8px rgba(26, 35, 126, 0.03)',
                                    transition: 'all 0.2s ease-in-out',
                                    zIndex: 1,
                                    '&:hover': {
                                      backgroundColor: '#fafbff',
                                      borderColor: '#c5cae9',
                                      transform: 'translateX(3px)',
                                      boxShadow: '0 4px 12px rgba(26, 35, 126, 0.06)'
                                    }
                                  }}
                                >
                                  {/* Dot */}
                                  <Box 
                                    sx={{ 
                                      position: 'absolute',
                                      left: '-29px', 
                                      top: '20px', 
                                      width: 12, 
                                      height: 12, 
                                      borderRadius: '50%', 
                                      backgroundColor: dayItem.initialized > 0 ? 'success.main' : 'warning.main',
                                      border: '3px solid #ffffff',
                                      boxShadow: '0 0 0 1.5px #c5cae9',
                                      zIndex: 2
                                    }} 
                                  />

                                  {/* Day Card Header Row */}
                                  <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                                    {/* Day name & date */}
                                    <Box sx={{ minWidth: 100 }}>
                                      <Typography sx={{ fontWeight: 800, color: '#1a237e', fontSize: '0.85rem' }}>
                                        {dayItem.dayOfWeekAndNum}
                                      </Typography>
                                    </Box>

                                    {/* Action chip */}
                                    <Box sx={{ minWidth: 110 }}>
                                      {dayItem.initialized > 0 ? (
                                        <Chip 
                                          label="INITIALIZED" 
                                          size="small" 
                                          color="success" 
                                          variant="filled"
                                          sx={{ fontWeight: 800, fontSize: '0.6rem', height: 20 }} 
                                        />
                                      ) : (
                                        <Chip 
                                          label="UPDATED" 
                                          size="small" 
                                          color="warning" 
                                          variant="filled"
                                          sx={{ fontWeight: 800, fontSize: '0.6rem', height: 20, backgroundColor: '#ed6c02' }} 
                                        />
                                      )}
                                    </Box>

                                    {/* Total Labels */}
                                    <Box sx={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                                      <Typography sx={{ fontWeight: 800, color: '#2c3e50', fontSize: '0.85rem' }}>
                                        {dayItem.total.toLocaleString()} {dayItem.total === 1 ? 'label' : 'labels'}
                                      </Typography>
                                    </Box>
                                  </Box>

                                  {/* Expanded Breakdown */}
                                  {expandedDays[dayItem.dateStr] && dayItem.classes && Object.keys(dayItem.classes).length > 0 && (
                                    <Box sx={{ mt: 1.5, pt: 1.5, borderTop: '1px dashed #e8eaf6', width: '100%' }}>
                                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                                        <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', mr: 1 }}>
                                          Breakdown:
                                        </Typography>
                                        {Object.entries(dayItem.classes)
                                          .filter(([_, count]) => count > 0)
                                          .sort((a, b) => (TOX_ORDER[a[0]] || 99) - (TOX_ORDER[b[0]] || 99))
                                          .map(([className, count]) => {
                                            const color = COLORS[className] || '#757575';
                                            return (
                                              <Chip
                                                key={className}
                                                label={`${className}: ${count}`}
                                                size="small"
                                                variant="outlined"
                                                sx={{ 
                                                  borderColor: color, 
                                                  color: color, 
                                                  fontWeight: 850, 
                                                  fontSize: '0.65rem',
                                                  height: 18,
                                                  backgroundColor: `${color}06`
                                                }}
                                              />
                                            );
                                          })}
                                      </Box>
                                    </Box>
                                  )}
                                </Box>
                              ))}
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
                      No timeline records found.
                    </Typography>
                  )}
                </Box>
              </Box>
            </Box>
          ) : (
            <Typography variant="body2" color="error" sx={{ textAlign: 'center', py: 4 }}>
              Failed to load update notes statistics.
            </Typography>
          )}
        </DialogContent>
      </Dialog>

      
    </Box>
  );
}
