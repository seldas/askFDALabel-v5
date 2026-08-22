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
  { id: 'ai-builder', label: 'AI Query Intent Engine', icon: '🤖' },
  { id: 'search-builder', label: 'Search & Query Builder', icon: '🔍' },
  { id: 'product-operators', label: 'Product Name Matching', icon: '⚡' },
  { id: 'multi-setids', label: 'Multi SET-IDs & Identifiers', icon: '📋' },
  { id: 'meddra-safety', label: 'MedDRA & Safety Terms', icon: '🛡️' },
  { id: 'clinical-tools', label: 'Clinical Modules', icon: '📊' },
  { id: 'faq', label: 'Frequently Asked Questions', icon: '❓' },
];

const GUIDES: WikiItem[] = [
  {
    id: 'guide-ai-mechanism',
    category: 'ai-builder',
    categoryLabel: 'AI Query Builder',
    title: 'AI Natural Language Intent Engine: Mechanism & Prompt Architecture',
    summary: 'How plain-English queries are compiled into structured backbone search groups, toggleable prefilter chips, and standardized MedDRA terms.',
    tags: ['ai', 'prompt', 'intent', 'query builder', 'prefilters', 'backbone', 'meddra', 'translation', 'schema', 'groups'],
    content: (
      <div>
        <p>
          The <strong>AI Intent Builder</strong> in AskFDALabel v3.0 acts as a deterministic compiler rather than a black-box conversational agent. It converts plain-English clinical and regulatory questions into transparent, editable structured criteria and toggleable prefilter chips.
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Dual-Tier Architecture: Backbone Groups vs. Prefilters</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          The prompt enforces a strict separation between <em>Backbone Search Criteria</em> and <em>Categorical Facet Prefilters</em>:
        </p>
        <ul>
          <li>
            <strong>Backbone Search (<code>groups</code>):</strong> Contains the core entities that define what labeling to find — such as Trade/Generic Product Names, Identifiers (SET-IDs, SPL GUIDs, Application Numbers, UNIIs), and Section/MedDRA Clinical Safety terms.
          </li>
          <li>
            <strong>Categorical Prefilters (<code>prefilters</code>):</strong> Categorical attributes mentioned in the prompt (e.g. <em>&ldquo;oral NDA products&rdquo;</em>, <em>&ldquo;human prescription tablets&rdquo;</em>, <em>&ldquo;Schedule II&rdquo;</em>) are extracted into modular prefilter chips rather than hardcoded criteria.
          </li>
          <li>
            <em>Why this design?</em> It enables the database to execute fast backbone queries while giving the user instant facet control in the results sidebar. The header dynamically displays both the filtered and unfiltered backbone totals (e.g. <code>120 / 1,500</code>).
          </li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. Standardized Controlled Vocabulary & Priority Rules</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          The system prompt implements several clinical knowledge rules:
        </p>
        <ol>
          <li>
            <strong>MedDRA Preference for Safety Concepts:</strong> Whenever clinical adverse events or toxicities (e.g. <em>&ldquo;lactic acidosis&rdquo;</em>, <em>&ldquo;hepatic failure&rdquo;</em>, <em>&ldquo;QT prolongation&rdquo;</em>) are requested, the prompt maps them directly to canonical <strong>MedDRA Preferred Terms (PT)</strong> instead of unstructured free text. This guarantees recall across all Low-Level Term (LLT) synonyms.
          </li>
          <li>
            <strong>Target Section Scoping:</strong> When labeling sections are specified (e.g. <em>&ldquo;with Boxed Warning&rdquo;</em>, <em>&ldquo;in Adverse Reactions&rdquo;</em>), the prompt automatically links the safety terms to the corresponding LOINC-coded section boundaries.
          </li>
          <li>
            <strong>Product Name vs. Identifier Separation:</strong> Drug names are assigned to <code>productName</code>, while UUIDs, Application Numbers, NDCs, and UNIIs are mapped to <code>identifier</code>. Pasted UUID lists are parsed into batch <code>setSplGuids</code> arrays for ultra-fast <code>IN (...)</code> queries.
          </li>
          <li>
            <strong>Pharmacologic Class (EPC) Guidance:</strong> If a pharmacologic class is requested (e.g. <em>&ldquo;Kinase Inhibitor&rdquo;</em>, <em>&ldquo;SGLT2 Inhibitor&rdquo;</em>), the prompt emits an explanatory note directing the user to the interactive EPC filter in the results sidebar.
          </li>
        </ol>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>3. Dynamic Database Scope Adaptation (Oracle vs. Local)</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          The translation prompt dynamically detects the target database environment:
        </p>
        <ul>
          <li>
            <strong>Oracle (CDER-CBER / FDA Scope):</strong> Generates full relational MedDRA occurrence queries and full-text section scans against enterprise Oracle tables.
          </li>
          <li>
            <strong>Local Database (PostgreSQL):</strong> Adapts queries to supported metadata columns (Product Names, Identifiers, Routes, Dosage Forms) and transparently warns the user if section text or MedDRA terms were omitted due to Local DB constraints.
          </li>
        </ul>
      </div>
    ),
  },
  {
    id: 'guide-getting-started',
    category: 'getting-started',
    categoryLabel: 'Getting Started',
    title: 'Introduction to FDALabel v3.0 & AskFDALabel',
    summary: 'Overview of the next-generation FDA labeling query and analytics platform.',
    tags: ['overview', 'introduction', 'basics', 'v3', 'cder', 'cber', 'oracle', 'postgres'],
    content: (
      <div>
        <p>
          <strong>AskFDALabel v3.0</strong> is a high-performance analytics and search platform designed for regulatory reviewers, toxicologists, pharmacovigilance scientists, and clinicians to query, cross-compare, and analyze human and animal drug labeling metadata.
        </p>
        <h4>Key Platform Architecture:</h4>
        <ul>
          <li><strong>Relational & Index-Driven Search:</strong> Sub-second query execution powered by discrete database indexes across Oracle CDER-CBER rollups and PostgreSQL local stores.</li>
          <li><strong>AI Natural Language Intent Builder:</strong> Translates plain-English clinical queries into structured criteria cards while extracting prefilters.</li>
          <li><strong>Standardized Controlled Vocabularies:</strong> Direct integration with FDA Product Names, MedDRA (Preferred Terms and Low-Level Terms), and FDA Established Pharmacologic Classes (EPC).</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'guide-database-targets',
    category: 'getting-started',
    categoryLabel: 'Getting Started',
    title: 'Understanding Database Targets: Oracle vs. Local',
    summary: 'Differences between FDALabel (CDER-CBER Oracle) and the Local Postgres labeling database.',
    tags: ['database', 'oracle', 'local', 'cder', 'cber', 'scope', 'fda'],
    content: (
      <div>
        <p>FDALabel supports multiple database targets depending on the deployment environment:</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', margin: '14px 0' }}>
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h5 style={{ margin: '0 0 6px 0', color: '#1e40af', fontSize: '0.95rem' }}>🏛️ FDALabel (CDER-CBER Oracle)</h5>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
              The authoritative FDA enterprise database. Supports full MedDRA occurrence hierarchy indexing, SPL section text scans, and comprehensive CDER/CBER drug rollups.
            </p>
          </div>
          <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <h5 style={{ margin: '0 0 6px 0', color: '#047857', fontSize: '0.95rem' }}>💻 Local Database (PostgreSQL)</h5>
            <p style={{ fontSize: '0.85rem', color: '#475569', margin: 0, lineHeight: 1.5 }}>
              A lightweight local repository designed for rapid metadata filtering, active ingredient UNII mapping, application numbers, dosage forms, and routes.
            </p>
          </div>
        </div>
      </div>
    ),
  },
  {
    id: 'guide-product-operators',
    category: 'product-operators',
    categoryLabel: 'Product Name Matching',
    title: 'Product Name Matching: Exact, Starts-With, and Contains',
    summary: 'How to use match operators and understand auto-verification and confirmation.',
    tags: ['product', 'drug name', 'exact', 'starts with', 'contains', 'operator', 'brand', 'generic'],
    content: (
      <div>
        <p>Product Name searches support four distinct match behaviors:</p>
        <ol>
          <li>
            <strong><code>is exactly</code> (Standardized, Default):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Enforces indexed exact equality against canonical Trade or Generic names. If an unrecognized term or typo is entered, a confirmation panel displays standard database candidates to ensure high-performance index scans.
            </p>
          </li>
          <li>
            <strong><code>starts with</code> (Prefix Matching):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Searches products starting with the specified term (e.g. <em>&ldquo;Tylenol&rdquo;</em> finds <em>Tylenol PM</em>, <em>Tylenol Extra Strength</em>). Autocomplete suggestions are available, but confirmation is optional.
            </p>
          </li>
          <li>
            <strong><code>contains</code> & <code>does not contain</code> (Flexible Substring):</strong>
            <p style={{ margin: '4px 0 8px 0', fontSize: '0.88rem' }}>
              Freeform flexible matching for substrings anywhere in the name without autocomplete or confirmation requirements.
            </p>
          </li>
        </ol>
        <div style={{ background: '#eff6ff', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2563eb', margin: '12px 0' }}>
          💡 <strong>Tip:</strong> If you want to search brand families without being restricted to the single root term, switch the operator from <em>&ldquo;is exactly&rdquo;</em> to <em>&ldquo;starts with&rdquo;</em>.
        </div>
      </div>
    ),
  },
  {
    id: 'guide-multi-setids',
    category: 'multi-setids',
    categoryLabel: 'Multi SET-IDs & Identifiers',
    title: 'Pasting and Querying Multiple SET-IDs (Batch Querying)',
    summary: 'Using the Multi SET-IDs popup modal to query multiple SPL GUIDs simultaneously.',
    tags: ['set-id', 'spl-guid', 'multi', 'batch', 'uuid', 'in clause', 'identifiers'],
    content: (
      <div>
        <p>
          You can search multiple specific drug labels by pasting a list of <strong>SET IDs</strong> (or SPL GUIDs) in batch:
        </p>
        <ol>
          <li>In the <strong>Labeling, Product and Ingredient Identifiers</strong> card, click the <strong>📋 Multi SET-IDs</strong> button.</li>
          <li>In the popup modal, paste your list of SET-IDs separated by <strong>newlines</strong>, <strong>commas (,)</strong>, or <strong>semicolons (;)</strong>.</li>
          <li>The modal will automatically trim whitespace, filter duplicates, and report the count of detected IDs.</li>
          <li>Click <strong>Save SET-IDs</strong>. The query will execute an ultra-fast, exact indexed <code>IN (...)</code> clause with zero slow wildcard scans.</li>
        </ol>
      </div>
    ),
  },
  {
    id: 'guide-meddra-safety',
    category: 'meddra-safety',
    categoryLabel: 'MedDRA & Safety Terms',
    title: 'MedDRA Safety Search & Section Scoping',
    summary: 'Searching Adverse Reactions, Warnings, and Boxed Warnings using standardized MedDRA terms.',
    tags: ['meddra', 'pt', 'llt', 'adverse reactions', 'boxed warning', 'safety', 'preferred term'],
    content: (
      <div>
        <p>
          MedDRA searches allow toxicologists and analysts to query adverse reaction occurrences mapped at the Preferred Term (PT) or Low-Level Term (LLT) level:
        </p>
        <ul>
          <li><strong>Preferred Term (PT):</strong> The standard clinical concept (e.g., <em>&ldquo;Lactic acidosis&rdquo;</em>, <em>&ldquo;Hepatic failure&rdquo;</em>). Highly recommended for comprehensive recall across all synonyms.</li>
          <li><strong>Section Filtering:</strong> Restrict safety terms to specific labeling sections such as <em>Boxed Warning</em>, <em>Warnings and Precautions</em>, or <em>Adverse Reactions</em>.</li>
          <li><strong>Relational Semi-Joins:</strong> On Oracle CDER-CBER, MedDRA criteria compile to indexed composite lookups on <code>druglabel.SPL_SEC_MEDDRA_LLT_OCC</code> for instant retrieval.</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'guide-clinical-tools',
    category: 'clinical-tools',
    categoryLabel: 'Clinical Modules',
    title: 'Clinical Modules: DrugTox, Label Comparison, and DeepDive',
    summary: 'Specialized analysis tools for drug-induced liver injury, multi-label diffs, and deep dive reports.',
    tags: ['drugtox', 'labelcomp', 'deepdive', 'comparison', 'dili', 'ro2', 'faers'],
    content: (
      <div>
        <p>Beyond searching, FDALabel offers built-in deep clinical intelligence tools:</p>
        <ul>
          <li><strong>Label Comparison (LabelComp):</strong> Compare 2 or more labels side-by-side with section alignment and visual diff highlighting.</li>
          <li><strong>DrugTox & DILI Rule-of-Two:</strong> Evaluate hepatotoxicity risks and drug-induced liver injury benchmark scores.</li>
          <li><strong>Adverse Event Profile & FAERS:</strong> Correlate label indications and warnings with real-world post-marketing FAERS adverse event reports.</li>
          <li><strong>Chemical Structure Search:</strong> Search drug substances by SMILES or InChI string with exact, substructure, or similarity algorithms.</li>
        </ul>
      </div>
    ),
  },
];

const FAQS: FaqItem[] = [
  {
    id: 'faq-ai-1',
    category: 'ai-builder',
    question: 'How does the AI Intent Engine interpret and compile clinical queries?',
    tags: ['ai', 'prompt', 'mechanism', 'intent', 'natural language', 'translation'],
    answer: (
      <p>
        The AI Intent Engine uses a specialized regulatory prompt that extracts your core drug entities and clinical safety concepts into <strong>Backbone Groups</strong>, while mapping descriptive constraints (e.g. <em>oral route</em>, <em>NDA</em>, <em>human Rx</em>) into modular <strong>Prefilter Chips</strong>. It also automatically identifies adverse events and converts them into standardized <strong>MedDRA Preferred Terms</strong>.
      </p>
    ),
  },
  {
    id: 'faq-ai-2',
    category: 'ai-builder',
    question: 'Why are categories like Dosage Form, Route, and Application Type emitted as pre-filter chips?',
    tags: ['prefilters', 'chips', 'facet', 'backbone', 'counts', 'results header'],
    answer: (
      <p>
        Extracting categorical constraints as prefilters keeps your core database query fast and uncluttered. It allows you to toggle filters on and off in the results sidebar without re-running the entire search, while the results counter displays both your filtered subset and the total backbone matches (e.g. <code>120 / 1,500 Results</code>).
      </p>
    ),
  },
  {
    id: 'faq-1',
    category: 'search-builder',
    question: 'Why does the search button say "Verification Required"?',
    tags: ['verification', 'confirmation', 'search disabled', 'product name', 'meddra'],
    answer: (
      <p>
        When using <strong>Exact Match (<code>is exactly</code>)</strong> for Product Names or MedDRA terms, the platform requires standard database confirmation to ensure your query uses an indexed standard term rather than a typo. Simply select one of the suggested candidate chips or change the operator to <strong>&ldquo;starts with&rdquo;</strong> or <strong>&ldquo;contains&rdquo;</strong>.
      </p>
    ),
  },
  {
    id: 'faq-2',
    category: 'product-operators',
    question: 'How do I search for an entire drug brand line (e.g. all Tylenol products)?',
    tags: ['brand', 'family', 'starts with', 'tylenol', 'line extension'],
    answer: (
      <p>
        In the Product Name card, set the match operator dropdown to <strong>&ldquo;starts with&rdquo;</strong> and type the brand name (e.g. <code>Tylenol</code>). This will match all formulation and strength variants such as <em>Tylenol PM</em>, <em>Tylenol Extra Strength</em>, and <em>Tylenol Infant</em>.
      </p>
    ),
  },
  {
    id: 'faq-3',
    category: 'multi-setids',
    question: 'What formats can I use when pasting multiple SET-IDs?',
    tags: ['set-id', 'paste', 'format', 'newline', 'comma', 'semicolon', 'csv'],
    answer: (
      <p>
        The <strong>Multi SET-IDs</strong> modal accepts GUIDs separated by <strong>newlines</strong> (from Excel or text files), <strong>semicolons (;)</strong>, or <strong>commas (,)</strong>. All surrounding spaces and duplicate entries are automatically cleaned.
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
        <strong>Preferred Terms (PT)</strong> represent distinct medical concepts and automatically aggregate all associated Low-Level Term synonyms. <strong>Low-Level Terms (LLT)</strong> represent specific colloquial or historical expressions mapped under a parent PT.
      </p>
    ),
  },
  {
    id: 'faq-5',
    category: 'getting-started',
    question: 'How often is the labeling data updated in FDALabel?',
    tags: ['updates', 'dailymed', 'orange book', 'frequency', 'refresh'],
    answer: (
      <p>
        FDALabel synchronizes updates monthly with official FDA structured product labeling (SPL) distributions, Orange Book monthly revisions, and FDA Pharmacologic Class indexing data.
      </p>
    ),
  },
  {
    id: 'faq-6',
    category: 'clinical-tools',
    question: 'How do I export my search results or download SPL XML files?',
    tags: ['export', 'csv', 'excel', 'xml', 'download', 'results'],
    answer: (
      <p>
        On the Search Results page, use the <strong>Export Table</strong> button to download Excel (XLSX) or CSV spreadsheets of your matched labels, or click individual label rows to view and download full SPL XML documents.
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
              <span>📖 Knowledge Base & Documentation</span>
            </div>

            <h1 style={{ fontSize: '2.2rem', fontWeight: 900, margin: '0 0 10px 0', letterSpacing: '-0.02em' }}>
              FDALabel v3.0 Wiki & Guidance
            </h1>
            <p style={{ fontSize: '1rem', opacity: 0.9, margin: '0 0 1.75rem 0', lineHeight: 1.5 }}>
              Comprehensive documentation, search tutorials, operator rules, and frequently asked questions.
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
                placeholder="Search tutorials, operators, SET-IDs, MedDRA, or FAQs... (Press Ctrl+K)"
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
