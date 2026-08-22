'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page } from '../platform/primitives';

interface WikiItem {
  id: string;
  category: string;
  categoryLabel: string;
  title: string;
  summary: string;
  tags: string[];
  content: React.ReactNode;
}

interface FaqItem {
  id: string;
  question: string;
  category: string;
  answer: React.ReactNode;
  tags: string[];
}

const CATEGORIES = [
  { id: 'all', label: 'All Topics', icon: '📚' },
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'ai-builder', label: 'AI Natural Language Search', icon: '🤖' },
  { id: 'search-builder', label: 'Search & Query Builder', icon: '🔍' },
  { id: 'product-operators', label: 'Product Name Matching', icon: '⚡' },
  { id: 'multi-setids', label: 'Multi SET-IDs & Batch Search', icon: '📋' },
  { id: 'meddra-safety', label: 'MedDRA & Safety Terms', icon: '🛡️' },
  { id: 'clinical-tools', label: 'Product Toolbox & Analysis', icon: '📊' },
  { id: 'faq', label: 'Frequently Asked Questions', icon: '❓' },
];

const GUIDES: WikiItem[] = [
  {
    id: 'guide-getting-started',
    category: 'getting-started',
    categoryLabel: 'Getting Started',
    title: 'Introduction to AskFDALabel v3.0',
    summary: 'Overview of the FDA labeling search and analytics platform.',
    tags: ['overview', 'introduction', 'basics', 'v3', 'fda', 'spl', 'prescribing information'],
    content: (
      <div>
        <p>
          <strong>AskFDALabel v3.0</strong> is a high-performance web platform developed by the FDA National Center for Toxicological Research (NCTR). It enables regulatory reviewers, healthcare professionals, toxicologists, and researchers to rapidly search, filter, and cross-compare official FDA Structured Product Labeling (SPL) documents.
        </p>
        <h4>Core Capabilities:</h4>
        <ul>
          <li><strong>Intelligent AI Search:</strong> Type plain-English questions to automatically construct structured criteria and pre-filters.</li>
          <li><strong>Standardized Medical Vocabulary:</strong> Search adverse reactions and safety warnings using official MedDRA Preferred Terms (PT) and Low-Level Terms (LLT).</li>
          <li><strong>Precise Product Name Matching:</strong> Match brand or generic names using exact, prefix (starts-with), or substring (contains) operators.</li>
          <li><strong>Product Analysis Toolbox:</strong> Access specialized safety agents including DILI (Liver Injury), DICT (Cardiotoxicity), Side-by-Side Label Comparison, and the DILI Rule-of-Two quadrant analysis.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'guide-labeling-coverage',
    category: 'getting-started',
    categoryLabel: 'Getting Started',
    title: 'Labeling Dataset & Regulatory Coverage',
    summary: 'Types of FDA drug and biological product labeling included in AskFDALabel.',
    tags: ['coverage', 'dataset', 'rx', 'otc', 'bla', 'nda', 'anda', 'vaccines', 'dailymed'],
    content: (
      <div>
        <p>AskFDALabel provides comprehensive coverage of approved and marketed human drug products in the United States:</p>
        <ul>
          <li><strong>Human Prescription Drugs (Rx):</strong> Full prescribing information for NDAs, ANDAs, and BLAs across all therapeutic classes.</li>
          <li><strong>Over-The-Counter (OTC) Products:</strong> Standardized Drug Facts labeling for OTC monographs and approved OTC NDAs/ANDAs.</li>
          <li><strong>Biological Products & Vaccines:</strong> Package inserts and labeling for approved therapeutic biological products and vaccines.</li>
          <li><strong>Historical & Archived Records:</strong> Version-tracked labeling sets allowing longitudinal review of safety labeling updates over time.</li>
        </ul>
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
          📅 <strong>Update Cycle:</strong> The dataset is refreshed monthly with official FDA structured product labeling distributions, Orange Book revisions, and FDA Pharmacologic Class indexing data.
        </div>
      </div>
    ),
  },
  {
    id: 'guide-ai-mechanism',
    category: 'ai-builder',
    categoryLabel: 'AI Natural Language Search',
    title: 'How the AI Search Assistant Works',
    summary: 'How natural language clinical questions are translated into structured criteria and modular prefilter chips.',
    tags: ['ai', 'natural language', 'prompt', 'intent', 'prefilters', 'backbone', 'meddra', 'assistant'],
    content: (
      <div>
        <p>
          The <strong>AI Intent Search</strong> bar converts everyday clinical descriptions into transparent, editable search cards and toggleable pre-filters before running the query.
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Backbone Search vs. Modular Prefilter Chips</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          When you enter a request like <em>&ldquo;Oral Metformin tablets with Boxed Warning for lactic acidosis&rdquo;</em>, the AI separates your query into two synchronized tiers:
        </p>
        <ul>
          <li>
            <strong>Backbone Search:</strong> Identifies the core entities — Product Name (<em>Metformin</em>) and the Section Safety Term (<em>Lactic acidosis in Boxed Warning</em>).
          </li>
          <li>
            <strong>Prefilter Chips:</strong> Extracts descriptive constraints (e.g. <em>Route: ORAL</em>, <em>Dosage Form: TABLET</em>, <em>Prescription status</em>) as clickable chips at the top of your search.
          </li>
          <li>
            <strong>Why this helps you:</strong> You can quickly uncheck or toggle individual filter chips without retyping your prompt, and the results page clearly displays both your filtered subset and the total backbone matches (e.g. <code>120 / 1,500 Results</code>).
          </li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. Automatic Clinical Term Standardization</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          The AI engine incorporates clinical knowledge rules:
        </p>
        <ol>
          <li>
            <strong>MedDRA Term Standardization:</strong> Clinical adverse reactions (e.g. <em>&ldquo;liver damage&rdquo;</em>, <em>&ldquo;heart failure&rdquo;</em>) automatically map to canonical <strong>MedDRA Preferred Terms</strong> (e.g. <em>Hepatic failure</em>, <em>Cardiac failure</em>), ensuring your search matches all medical synonyms across labels.
          </li>
          <li>
            <strong>Section Boundary Scoping:</strong> Mentions like <em>&ldquo;in Boxed Warning&rdquo;</em> or <em>&ldquo;under Warnings and Precautions&rdquo;</em> automatically target the search to those specific prescribing sections.
          </li>
          <li>
            <strong>Batch ID Extraction:</strong> If you paste multiple SET-IDs or SPL GUIDs, the AI immediately extracts them into a clean multi-ID list for instant batch querying.
          </li>
        </ol>
      </div>
    ),
  },
  {
    id: 'guide-product-operators',
    category: 'product-operators',
    categoryLabel: 'Product Name Matching',
    title: 'Product Name Match Operators: Exact, Starts-With, and Contains',
    summary: 'How to use match operators and understand autocomplete suggestions and term verification.',
    tags: ['product', 'drug name', 'exact', 'starts with', 'contains', 'operator', 'brand', 'generic'],
    content: (
      <div>
        <p>Product Name searches offer four flexible match operators to fit your search goal:</p>
        <ol>
          <li>
            <strong><code>is exactly</code> (Standardized, Default):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Enforces exact matching against official Trade or Generic drug names. If you enter an unrecognized spelling or typo, a confirmation panel presents standard database suggestions to ensure an accurate search.
            </p>
          </li>
          <li>
            <strong><code>starts with</code> (Prefix Matching):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Searches for all products starting with your entered prefix (e.g. searching <em>&ldquo;Tylenol&rdquo;</em> retrieves <em>Tylenol PM</em>, <em>Tylenol Extra Strength</em>, and <em>Tylenol Cold</em>). Autocomplete suggestions are available, but confirmation is optional.
            </p>
          </li>
          <li>
            <strong><code>contains</code> & <code>does not contain</code> (Flexible Substring):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Matches any occurrence of the text anywhere in the product or generic name without requiring list selection or confirmation.
            </p>
          </li>
        </ol>
        <div style={{ background: '#eff6ff', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2563eb', margin: '12px 0' }}>
          💡 <strong>Tip:</strong> If you want to search an entire brand family rather than just a single root product, switch the operator from <em>&ldquo;is exactly&rdquo;</em> to <em>&ldquo;starts with&rdquo;</em>.
        </div>
      </div>
    ),
  },
  {
    id: 'guide-multi-setids',
    category: 'multi-setids',
    categoryLabel: 'Multi SET-IDs & Batch Search',
    title: 'Searching Multiple SET-IDs Simultaneously (Batch Query)',
    summary: 'Using the Multi SET-IDs popup to paste and query multiple drug labels in one operation.',
    tags: ['set-id', 'spl-guid', 'multi', 'batch', 'uuid', 'identifiers'],
    content: (
      <div>
        <p>
          To look up a specific cohort of drug labels in batch using their unique <strong>SET IDs</strong> (or SPL GUIDs):
        </p>
        <ol>
          <li>In the <strong>Labeling, Product and Ingredient Identifiers</strong> card, click the <strong>📋 Multi SET-IDs</strong> button.</li>
          <li>Paste your list of SET-IDs. The input accepts IDs separated by <strong>newlines</strong> (copied from Excel or text documents), <strong>commas (,)</strong>, or <strong>semicolons (;)</strong>.</li>
          <li>The modal automatically removes spaces, strips duplicates, and displays the total number of valid IDs recognized.</li>
          <li>Click <strong>Save SET-IDs</strong> and execute your search to retrieve all matching labels together.</li>
        </ol>
      </div>
    ),
  },
  {
    id: 'guide-meddra-safety',
    category: 'meddra-safety',
    categoryLabel: 'MedDRA & Safety Terms',
    title: 'MedDRA Adverse Event Searching & Section Scoping',
    summary: 'Searching Adverse Reactions, Warnings, and Boxed Warnings with standardized MedDRA medical terminology.',
    tags: ['meddra', 'pt', 'llt', 'adverse reactions', 'boxed warning', 'safety', 'preferred term'],
    content: (
      <div>
        <p>
          The MedDRA search feature allows clinical researchers to query adverse reactions and safety warnings using the standardized Medical Dictionary for Regulatory Activities:
        </p>
        <ul>
          <li><strong>Preferred Term (PT):</strong> The standard clinical concept (e.g. <em>Lactic acidosis</em>, <em>Hepatic failure</em>, <em>Anaphylactic reaction</em>). Searching by PT automatically captures all underlying synonymous expressions (Low-Level Terms).</li>
          <li><strong>Section Filtering:</strong> Focus safety terms on specific labeling sections such as <em>Boxed Warning</em>, <em>Warnings and Precautions</em>, or <em>Adverse Reactions</em>.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'guide-clinical-tools',
    category: 'clinical-tools',
    categoryLabel: 'Product Toolbox & Analysis',
    title: 'Product Toolbox: Clinical Intelligence & Analytical Agents',
    summary: 'Overview of specialized analytical tools available in the label workspace toolbox.',
    tags: ['toolbox', 'dili', 'dict', 'compare', 'ro2', 'rule of two', 'cardiotoxicity', 'hepatotoxicity'],
    content: (
      <div>
        <p>When viewing any drug label, the <strong>Toolbox</strong> tab gives you access to dedicated analytical tools:</p>
        <ul>
          <li><strong>DILI Agent:</strong> Drug-Induced Liver Injury risk assessment, clinical signal detection, and benchmark classifications.</li>
          <li><strong>DICT Agent:</strong> Drug-Induced Cardiotoxicity evaluation, adverse event summaries, and QT prolongation signal detection.</li>
          <li><strong>Label Comparison (Compare):</strong> Side-by-side diff comparison of up to 4 drug labels with section alignment and visual text highlighting.</li>
          <li><strong>Rule of Two (RO2):</strong> Evaluates hepatotoxicity risk by plotting recommended maximum daily dose against lipophilicity (\(\log P\)).</li>
        </ul>
        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
          ⭐ <strong>Personalized Toolbox:</strong> You can click the star icon on any tool card in your toolbox to pin your most frequently used tools at the top.
        </div>
      </div>
    ),
  },
];

const FAQS: FaqItem[] = [
  {
    id: 'faq-ai-1',
    category: 'ai-builder',
    question: 'How does the AI Search Assistant interpret clinical requests?',
    tags: ['ai', 'prompt', 'mechanism', 'intent', 'natural language', 'translation'],
    answer: (
      <p>
        The AI Search Assistant analyzes your natural language question, extracts the core drug names and safety concepts into structured criteria cards, and converts descriptive constraints (like oral route or NDA approval) into clickable prefilter chips. It also converts colloquial medical terms into official MedDRA Preferred Terms.
      </p>
    ),
  },
  {
    id: 'faq-ai-2',
    category: 'ai-builder',
    question: 'Why are filters like Dosage Form and Route displayed as pre-filter chips?',
    tags: ['prefilters', 'chips', 'facet', 'backbone', 'counts', 'results header'],
    answer: (
      <p>
        Separating categories into pre-filter chips lets you quickly toggle filters on and off in the search results sidebar without retyping your query. The results header dynamically displays both your filtered count and the total matching backbone labels (e.g. <code>120 / 1,500 Results</code>).
      </p>
    ),
  },
  {
    id: 'faq-1',
    category: 'search-builder',
    question: 'Why does the search button sometimes require confirmation?',
    tags: ['verification', 'confirmation', 'search disabled', 'product name', 'meddra'],
    answer: (
      <p>
        When using <strong>Exact Match (<code>is exactly</code>)</strong> for Product Names or MedDRA terms, the search verifies that your entered term matches canonical database vocabulary rather than a typo. Simply select one of the suggested candidate chips or switch the operator to <strong>&ldquo;starts with&rdquo;</strong> or <strong>&ldquo;contains&rdquo;</strong>.
      </p>
    ),
  },
  {
    id: 'faq-2',
    category: 'product-operators',
    question: 'How do I search for an entire drug brand family (e.g. all Tylenol products)?',
    tags: ['brand', 'family', 'starts with', 'tylenol', 'line extension'],
    answer: (
      <p>
        In the Product Name card, set the match operator dropdown to <strong>&ldquo;starts with&rdquo;</strong> and enter the brand name (e.g. <code>Tylenol</code>). This matches all formulation and strength variations such as <em>Tylenol PM</em>, <em>Tylenol Extra Strength</em>, and <em>Tylenol Infant</em>.
      </p>
    ),
  },
  {
    id: 'faq-3',
    category: 'multi-setids',
    question: 'What format should I use when pasting multiple SET-IDs?',
    tags: ['set-id', 'paste', 'format', 'newline', 'comma', 'semicolon', 'csv'],
    answer: (
      <p>
        The <strong>Multi SET-IDs</strong> window accepts lists copied from spreadsheets or documents separated by <strong>newlines</strong>, <strong>semicolons (;)</strong>, or <strong>commas (,)</strong>. Surrounding whitespace and duplicate entries are automatically removed.
      </p>
    ),
  },
  {
    id: 'faq-4',
    category: 'meddra-safety',
    question: 'What is the difference between MedDRA PT and LLT levels?',
    tags: ['pt', 'llt', 'meddra', 'hierarchy', 'preferred term', 'low level term'],
    answer: (
      <p>
        <strong>Preferred Terms (PT)</strong> represent distinct medical concepts and automatically include all synonymous Low-Level Terms (LLTs). <strong>Low-Level Terms (LLT)</strong> represent specific clinical or historical expressions grouped under a parent PT.
      </p>
    ),
  },
  {
    id: 'faq-5',
    category: 'getting-started',
    question: 'How frequently is the drug labeling dataset updated?',
    tags: ['updates', 'dailymed', 'orange book', 'frequency', 'refresh'],
    answer: (
      <p>
        AskFDALabel is updated monthly with official FDA structured product labeling distributions, Orange Book monthly revisions, and FDA Pharmacologic Class indexing data.
      </p>
    ),
  },
  {
    id: 'faq-6',
    category: 'clinical-tools',
    question: 'How do I export my search results or view SPL XML files?',
    tags: ['export', 'csv', 'excel', 'xml', 'download', 'results'],
    answer: (
      <p>
        On the Search Results page, use the <strong>Export Table</strong> button to download Excel (XLSX) or CSV spreadsheets of your matched labels, or click individual label rows to read, navigate, and download full SPL XML documents.
      </p>
    ),
  },
];

export default function WikiPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedFaqs, setExpandedFaqs] = useState<Record<string, boolean>>({});

  const toggleFaq = (id: string) => {
    setExpandedFaqs((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const expandAllFaqs = () => {
    const all: Record<string, boolean> = {};
    FAQS.forEach((f) => (all[f.id] = true));
    setExpandedFaqs(all);
  };

  const collapseAllFaqs = () => {
    setExpandedFaqs({});
  };

  // Keyboard shortcut for quick search focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('wiki-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered guides & FAQs
  const q = searchQuery.toLowerCase().trim();

  const filteredGuides = useMemo(() => {
    return GUIDES.filter((item) => {
      const matchCat = selectedCategory === 'all' || item.category === selectedCategory;
      if (!matchCat) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [selectedCategory, q]);

  const filteredFaqs = useMemo(() => {
    return FAQS.filter((item) => {
      const matchCat = selectedCategory === 'all' || selectedCategory === 'faq' || item.category === selectedCategory;
      if (!matchCat) return false;
      if (!q) return true;
      return (
        item.question.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [selectedCategory, q]);

  const totalResults = filteredGuides.length + filteredFaqs.length;

  return (
    <Page>
      <Header />

      <main className="fdl-shell" style={{ maxWidth: '1120px', margin: '2rem auto', padding: '0 1.25rem' }}>
        {/* Banner Header */}
        <div
          style={{
            background: 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 50%, #2563eb 100%)',
            borderRadius: '20px',
            padding: '2.5rem 2rem',
            color: '#ffffff',
            boxShadow: '0 20px 25px -5px rgba(30, 58, 138, 0.25)',
            marginBottom: '2rem',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ maxWidth: '750px', margin: '0 auto' }}>
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255, 255, 255, 0.15)',
                backdropFilter: 'blur(8px)',
                padding: '4px 14px',
                borderRadius: '20px',
                fontSize: '0.82rem',
                fontWeight: 700,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: '1rem',
              }}
            >
              <span>📖 Knowledge Base & User Guide</span>
            </div>

            <h1 style={{ fontSize: '2.2rem', fontWeight: 900, margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
              AskFDALabel v3.0 User Guide & Wiki
            </h1>
            <p style={{ fontSize: '1rem', opacity: 0.9, margin: '0 0 1.75rem 0', lineHeight: 1.5 }}>
              Search tutorials, AI query instructions, match operator guidance, and frequently asked questions.
            </p>

            {/* Search Input Box */}
            <div style={{ position: 'relative', maxWidth: '640px', margin: '0 auto' }}>
              <div
                style={{
                  position: 'absolute',
                  left: '16px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#64748b',
                  fontSize: '1.2rem',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                🔍
              </div>
              <input
                id="wiki-search-input"
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search guides, AI queries, SET-IDs, MedDRA, or FAQs... (Press Ctrl+K)"
                style={{
                  width: '100%',
                  padding: '14px 100px 14px 48px',
                  fontSize: '0.95rem',
                  borderRadius: '14px',
                  border: '2px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: '0 8px 20px rgba(0, 0, 0, 0.15)',
                  outline: 'none',
                  color: '#0f172a',
                  background: '#ffffff',
                  boxSizing: 'border-box',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: '#f1f5f9',
                    border: 'none',
                    borderRadius: '50%',
                    width: '24px',
                    height: '24px',
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Category Filter Chips */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            marginBottom: '2rem',
            justifyContent: 'center',
          }}
        >
          {CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '10px',
                  fontSize: '0.88rem',
                  fontWeight: active ? 800 : 600,
                  cursor: 'pointer',
                  border: active ? '1px solid #2563eb' : '1px solid #e2e8f0',
                  background: active ? '#eff6ff' : '#ffffff',
                  color: active ? '#1d4ed8' : '#475569',
                  boxShadow: active ? '0 2px 6px rgba(37, 99, 235, 0.12)' : '0 1px 2px rgba(0, 0, 0, 0.04)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  transition: 'all 0.15s ease',
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Search Results Summary */}
        {q && (
          <div
            style={{
              padding: '10px 16px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px',
              marginBottom: '1.5rem',
              fontSize: '0.88rem',
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              Found <strong>{totalResults}</strong> result{totalResults !== 1 ? 's' : ''} for &ldquo;<strong>{searchQuery}</strong>&rdquo;
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#2563eb',
                fontWeight: 700,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Section 1: User Guides & Tutorials */}
        {filteredGuides.length > 0 && (
          <section style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.25rem' }}>
              <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                📖 Guides & Usage Documentation
              </h2>
              <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                {filteredGuides.length}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {filteredGuides.map((guide) => (
                <div
                  key={guide.id}
                  id={guide.id}
                  style={{
                    background: '#ffffff',
                    borderRadius: '14px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                    padding: '1.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        textTransform: 'uppercase',
                        color: '#2563eb',
                        backgroundColor: '#eff6ff',
                        padding: '2px 8px',
                        borderRadius: '6px',
                        border: '1px solid #dbeafe',
                      }}
                    >
                      {guide.categoryLabel}
                    </span>
                  </div>

                  <h3 style={{ fontSize: '1.18rem', fontWeight: 800, color: '#1e293b', margin: '0 0 8px 0' }}>
                    {guide.title}
                  </h3>

                  <p style={{ fontSize: '0.9rem', color: '#64748b', margin: '0 0 14px 0', lineHeight: 1.5 }}>
                    {guide.summary}
                  </p>

                  <div style={{ fontSize: '0.92rem', color: '#334155', lineHeight: 1.65, borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
                    {guide.content}
                  </div>

                  {/* Tags */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '16px' }}>
                    {guide.tags.map((tag) => (
                      <span
                        key={tag}
                        onClick={() => setSearchQuery(tag)}
                        style={{
                          fontSize: '0.75rem',
                          color: '#64748b',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Section 2: Frequently Asked Questions (Accordion) */}
        {filteredFaqs.length > 0 && (
          <section style={{ marginBottom: '3rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
                  ❓ Frequently Asked Questions (FAQ)
                </h2>
                <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 700, background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px' }}>
                  {filteredFaqs.length}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={expandAllFaqs}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  Expand All
                </button>
                <button
                  type="button"
                  onClick={collapseAllFaqs}
                  style={{
                    background: '#ffffff',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer',
                  }}
                >
                  Collapse All
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredFaqs.map((faq) => {
                const isOpen = expandedFaqs[faq.id] || Boolean(q);
                return (
                  <div
                    key={faq.id}
                    style={{
                      background: '#ffffff',
                      borderRadius: '12px',
                      border: '1px solid #e2e8f0',
                      overflow: 'hidden',
                      transition: 'all 0.2s ease',
                      boxShadow: isOpen ? '0 4px 12px rgba(0, 0, 0, 0.05)' : 'none',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleFaq(faq.id)}
                      style={{
                        width: '100%',
                        padding: '16px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        background: isOpen ? '#f8fafc' : '#ffffff',
                        border: 'none',
                        textAlign: 'left',
                        cursor: 'pointer',
                        gap: '12px',
                      }}
                    >
                      <span style={{ fontSize: '0.98rem', fontWeight: 700, color: '#1e293b' }}>
                        {faq.question}
                      </span>
                      <span
                        style={{
                          fontSize: '1rem',
                          color: '#2563eb',
                          fontWeight: 700,
                          transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
                          transition: 'transform 0.2s ease',
                        }}
                      >
                        ▼
                      </span>
                    </button>

                    {isOpen && (
                      <div
                        style={{
                          padding: '16px 20px',
                          borderTop: '1px solid #f1f5f9',
                          fontSize: '0.9rem',
                          color: '#334155',
                          lineHeight: 1.6,
                          background: '#ffffff',
                        }}
                      >
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Empty state */}
        {totalResults === 0 && (
          <div
            style={{
              textAlign: 'center',
              padding: '4rem 2rem',
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #e2e8f0',
            }}
          >
            <span style={{ fontSize: '2.5rem' }}>🔍</span>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e293b', marginTop: '12px' }}>
              No matching topics found
            </h3>
            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
              No guides or FAQs matched your query &ldquo;{searchQuery}&rdquo;. Try another search keyword or clear filters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
              }}
              style={{
                marginTop: '12px',
                padding: '8px 18px',
                borderRadius: '8px',
                background: '#2563eb',
                color: '#ffffff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              Reset Search
            </button>
          </div>
        )}

        {/* Bottom Support & Feedback Footer Card */}
        <div
          style={{
            background: '#f8fafc',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            padding: '2rem',
            marginTop: '2rem',
            textAlign: 'center',
          }}
        >
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', margin: '0 0 8px 0' }}>
            Need Additional Support or Feature Requests?
          </h3>
          <p style={{ fontSize: '0.88rem', color: '#64748b', maxWidth: '600px', margin: '0 auto 1.25rem auto' }}>
            For technical inquiries, bug reports, or suggestions for AskFDALabel v3.0, please contact the NCTR Bioinformatics Support team.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Link
              href="/"
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                background: '#2563eb',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.88rem',
                textDecoration: 'none',
                boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
              }}
            >
              🏠 Return to Home Page to Search
            </Link>
            <a
              href="mailto:NCTRBioinformaticsSupport@fda.hhs.gov"
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                background: '#ffffff',
                color: '#1e293b',
                fontWeight: 700,
                fontSize: '0.88rem',
                textDecoration: 'none',
                border: '1px solid #cbd5e1',
              }}
            >
              ✉️ Contact Technical Support
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </Page>
  );
}
