'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page } from '../platform/primitives';
import { useUser } from '../context/UserContext';

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
  { id: 'api-service', label: 'REST API & Integration', icon: '🔌' },
  { id: 'ai-builder', label: 'AI Natural Language Search', icon: '🤖' },
  { id: 'search-builder', label: 'Search & Query Builder', icon: '🔍' },
  { id: 'product-operators', label: 'Product Name Matching', icon: '⚡' },
  { id: 'multi-setids', label: 'Multi SET-IDs & Batch Search', icon: '📋' },
  { id: 'meddra-safety', label: 'MedDRA & Safety Terms', icon: '🛡️' },
  { id: 'clinical-tools', label: 'Product Toolbox & Analysis', icon: '📊' },
  { id: 'faq', label: 'Frequently Asked Questions', icon: '❓' },
];

const getGuides = (apiHost: string): WikiItem[] => [
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
          <li>In the <strong>Labeling, Product and Ingredient Identifiers</strong> card, click the <strong>Multi SET-IDs</strong> button.</li>
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
  {
    id: 'guide-api-overview',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'REST API Overview & API Key Authentication',
    summary: 'How to obtain your personal API key, authenticate HTTP requests, and query the official CDER-CBER Oracle labeling database.',
    tags: ['api', 'rest', 'json', 'authentication', 'api-key', 'curl', 'python', 'oracle', 'endpoints'],
    content: (
      <div>
        <p>
          AskFDALabel provides a high-throughput, RESTful search API under the <code>/api/v1</code> namespace. The API allows external scripts, regulatory pipelines, and third-party tools to perform high-speed structured and full-text searches over official FDA drug labeling data.
        </p>

        {/* Development Server Callout Box */}
        <div style={{
          background: '#eff6ff',
          border: '1px solid #bfdbfe',
          borderLeft: '4px solid #2563eb',
          padding: '14px 16px',
          borderRadius: '8px',
          margin: '14px 0'
        }}>
          <div style={{ fontWeight: 800, color: '#1e40af', marginBottom: '4px', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🚀</span>
            <span>Current Development Server Endpoint</span>
          </div>
          <p style={{ margin: '0 0 8px 0', fontSize: '0.88rem', color: '#1e3a8a', lineHeight: 1.55 }}>
            The active development server API is hosted at:{' '}
            <code style={{ background: '#dbeafe', color: '#1e40af', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, fontFamily: 'monospace' }}>
              https://{apiHost}/fdalabel-v3_api/api/v1/...
            </code>
          </p>
          <div style={{
            background: '#fef3c7',
            border: '1px solid #fde68a',
            padding: '8px 12px',
            borderRadius: '6px',
            fontSize: '0.84rem',
            color: '#92400e',
            lineHeight: 1.45
          }}>
            ⚠️ <strong>Critical Path Notice:</strong> The server API route prefix is <strong><code>/fdalabel-v3_api/api/</code></strong> (using <code>fdalabel-v3_api/api</code>, <em>not</em> <code>fdalabel-v3/api</code>).
          </div>
        </div>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Database Target & Pinned Scope</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          The REST API is permanently pinned to the curated <strong>CDER-CBER Oracle Database</strong> (<code>druglabel.DGV_SUM_RX_SPL</code>), ensuring high performance and regulatory data consistency. Any client-supplied parameters attempting to change the database target (e.g. <code>db_source</code> or <code>target_db</code>) are accepted for compatibility but safely ignored.
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. API Base URL Structure</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          Depending on your network environment and deployment mode, use the appropriate base URL:
        </p>
        <ul>
          <li><strong>Development Server:</strong> <code>https://{apiHost}/fdalabel-v3_api/api/v1/search</code></li>
          <li><strong>Direct Host/Container Port (Local Dev):</strong> <code>http://localhost:8842/api/v1/search</code></li>
          <li><strong>Service Health & Status Check:</strong> <code>https://{apiHost}/fdalabel-v3_api/api/v1/status</code> (or <code>http://localhost:8842/api/v1/status</code>)</li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>3. Obtaining & Managing Your API Key</h4>
        <ol style={{ fontSize: '0.9rem', lineHeight: 1.6 }}>
          <li>Log in to your account and navigate to <strong>Management</strong> in the top navigation bar.</li>
          <li>Click the <strong>API Key</strong> tab in the left sidebar.</li>
          <li>Click <strong>Generate API Key</strong>. Your personal API token (e.g. <code>afl_live_...</code>) will be generated and displayed.</li>
          <li>Click <strong>Copy Key</strong>. You can regenerate or revoke your key at any time from this panel.</li>
        </ol>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>4. How to Authenticate Requests</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          You can authenticate your requests using any of the following three methods:
        </p>
        <ul>
          <li><strong>HTTP Header (Recommended):</strong> <code>X-API-Key: afl_live_YOUR_KEY</code></li>
          <li><strong>Bearer Token:</strong> <code>Authorization: Bearer afl_live_YOUR_KEY</code></li>
          <li><strong>Query Parameter:</strong> <code>https://{apiHost}/fdalabel-v3_api/api/v1/search?api_key=afl_live_YOUR_KEY&q=...</code></li>
        </ul>

        <div style={{ background: '#eff6ff', padding: '12px 16px', borderRadius: '8px', borderLeft: '4px solid #2563eb', margin: '12px 0' }}>
          💡 <strong>Note on Key Enforcement:</strong> API key authentication is currently soft/non-blocking. Unauthenticated requests succeed, but passing your API key attaches your user context for request auditing and ensures you will not be rate-limited under future throttling policies.
        </div>
      </div>
    ),
  },
  {
    id: 'guide-api-fulltext',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Full-Text Search Across Label Content (Simple & Advanced Modes)',
    summary: 'Searching across full SPL XML label bodies with phrase matching and Oracle Text boolean operators.',
    tags: ['full-text', 'contains', 'boolean', 'search', 'phrase', 'operators', 'api'],
    content: (
      <div>
        <p>
          The API allows deep full-text search across complete prescribing information XML bodies using Oracle Text indexes.
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Parameters</h4>
        <ul>
          <li><code>q</code> or <code>full_text</code>: The text string or search expression to find.</li>
          <li><code>full_text_mode</code>: <code>simple</code> (default span/phrase search) or <code>advanced</code> (boolean logic).</li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. Simple Phrase Search (Default)</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          Matches labels containing the exact multi-word phrase anywhere in the prescribing text:
        </p>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?q=myocardial+infarction&limit=10" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>3. Advanced Boolean & Operator Search</h4>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.55 }}>
          Set <code>full_text_mode=advanced</code> to combine keywords with <code>AND</code>, <code>OR</code>, <code>NOT</code>, and parentheses:
        </p>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Labels mentioning both lactic acidosis and metformin:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?q=lactic+acidosis+AND+metformin&full_text_mode=advanced&limit=10" \\
  -H "X-API-Key: afl_live_YOUR_KEY"

# Labels mentioning hypertension but NOT pediatric:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?q=hypertension+NOT+pediatric&full_text_mode=advanced&limit=10" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-product-identifiers',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Product Names, Active Ingredients, and Identifiers (NDA/ANDA, NDC, UNII, SET-ID)',
    summary: 'Querying drug labels by Brand Name, Generic Name, Application Number, NDC code, UNII, and SPL SET-ID.',
    tags: ['product-name', 'active-ingredient', 'appl-num', 'nda', 'anda', 'bla', 'ndc', 'set-id', 'unii'],
    content: (
      <div>
        <p>
          You can look up drug labels using standardized product attributes and regulatory identifier numbers:
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Product Name Parameters</h4>
        <ul>
          <li><code>product_name</code>: Brand trade name, generic name, or active ingredient.</li>
          <li><code>match_mode</code>: <code>contains</code> (default substring), <code>equals</code> (exact match), or <code>starts_with</code> (prefix match).</li>
          <li><code>product_name_field</code>: <code>any</code> (default), <code>trade</code>, or <code>generic</code>.</li>
        </ul>

        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Search for all products starting with "Tylenol":
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?product_name=Tylenol&match_mode=starts_with&limit=10" \\
  -H "X-API-Key: afl_live_YOUR_KEY"

# Search for exact generic name "atorvastatin calcium":
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?generic_name=atorvastatin+calcium&match_mode=equals" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. Product & Regulatory Identifiers</h4>
        <ul>
          <li><code>appl_num</code> / <code>application_number</code>: FDA NDA, ANDA, or BLA number (e.g. <code>NDA020702</code> or <code>020702</code>).</li>
          <li><code>ndc</code>: National Drug Code (e.g. <code>0071-0155-23</code> or <code>0071-0155</code>).</li>
          <li><code>set_id</code>: The unique SPL Set UUID identifying all historical revisions of a product labeling.</li>
          <li><code>spl_id</code>: The specific document GUID version.</li>
          <li><code>unii</code>: FDA Unique Ingredient Identifier (e.g. <code>48A5M73Z9Q</code> for Atorvastatin Calcium).</li>
          <li><code>identifier</code>: Unified ID search matching any of the above formats automatically.</li>
        </ul>

        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Search by NDA Number:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?appl_num=NDA021436" \\
  -H "X-API-Key: afl_live_YOUR_KEY"

# Direct single label lookup by SET-ID:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/labels/f7633480-25aa-4326-bec9-82835b486a20" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-section-search',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Section-Targeted Safety & Clinical Searching',
    summary: 'Restricting safety terms to specific labeling sections like Boxed Warning, Indications, and Adverse Reactions.',
    tags: ['section', 'boxed warning', 'loinc', 'indications', 'adverse reactions', 'warnings', 'safety'],
    content: (
      <div>
        <p>
          To prevent false positives from incidental text mentions, you can restrict text queries to specific prescribing information sections using standardized LOINC section codes:
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Common LOINC Section Codes:</h4>
        <div style={{ overflowX: 'auto', margin: '12px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: '#f1f5f9', textAlign: 'left' }}>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #cbd5e1' }}>LOINC Code</th>
                <th style={{ padding: '8px 12px', borderBottom: '1px solid #cbd5e1' }}>SPL Prescribing Section</th>
              </tr>
            </thead>
            <tbody>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34066-1</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>BOXED WARNING</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34067-9</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>1 INDICATIONS AND USAGE</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34068-7</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>2 DOSAGE AND ADMINISTRATION</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34070-3</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>4 CONTRAINDICATIONS</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>43685-7</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>5 WARNINGS AND PRECAUTIONS</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34084-4</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>6 ADVERSE REACTIONS</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>34073-7</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>7 DRUG INTERACTIONS</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>43684-0</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>8 USE IN SPECIFIC POPULATIONS</td></tr>
              <tr><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}><code>43679-0</code></td><td style={{ padding: '6px 12px', borderBottom: '1px solid #e2e8f0' }}>12.1 Mechanism of Action</td></tr>
            </tbody>
          </table>
        </div>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Example: Querying Boxed Warnings</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Find labels with hepatotoxicity warnings in the Boxed Warning section:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?section=34066-1&section_text=hepatotoxicity&limit=20" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-sections-xml',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Extracting Section XMLs & Full Label XML by LOINC Code',
    summary: 'Retrieve raw XML snippets for specific labeling sections (e.g., Boxed Warning, Indications) or the complete SPL document.',
    tags: ['xml', 'sections', 'loinc', 'multi-sections', 'boxed warning', 'snippets', 'spl xml'],
    content: (
      <div>
        <p>
          askFDALabel provides specialized endpoints for extracting structured XML content directly from SPL documents without having to download and parse large multi-megabyte XML files locally:
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Targeted Section XML Snippets (<code>/api/v1/sections/:id</code>)</h4>
        <p>
          Retrieve basic metadata along with the raw XML snippets for one or more specific Prescribing Information sections by passing <code>loinc_code</code> query parameter:
        </p>
        <ul>
          <li><strong>Single Section:</strong> <code>?loinc_code=34066-1</code> (Boxed Warning)</li>
          <li><strong>Multi-Section:</strong> <code>?loinc_code=34066-1,34067-9,43685-7</code> (Boxed Warning, Indications, and Warnings &amp; Precautions)</li>
          <li><strong>All Structured Sections:</strong> Omit <code>loinc_code</code> to return all parsed sections.</li>
        </ul>

        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Extract Boxed Warning (34066-1) and Indications (34067-9) sections:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/sections/7e606a5b-010e-4050-bf6c-6712b32bbbc4?loinc_code=34066-1,34067-9" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>

        <p style={{ marginTop: '10px' }}><strong>Response Structure:</strong></p>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`{
  "status": "success",
  "label": {
    "set_id": "7e606a5b-010e-4050-bf6c-6712b32bbbc4",
    "product_names": "LIPITOR",
    "generic_names": "ATORVASTATIN CALCIUM",
    "appr_num": "NDA020702"
  },
  "requested_loinc_codes": ["34066-1", "34067-9"],
  "matched_sections_count": 2,
  "sections": [
    {
      "loinc_code": "34066-1",
      "display_name": "BOXED WARNING SECTION",
      "title": "WARNING: RISK OF HEPATOTOXICITY",
      "section_number": "Boxed Warning",
      "xml_content": "<section ID=\\"...\\"><code code=\\"34066-1\\" .../><title>...</title><text>...</text></section>",
      "text_content": "WARNING: RISK OF HEPATOTOXICITY..."
    }
  ]
}`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '16px', marginBottom: '6px' }}>2. Full SPL XML Document Retrieval (<code>/api/v1/labels/:id</code>)</h4>
        <p>
          To retrieve the complete, untouched HL7 CDA XML document along with full label metadata:
        </p>

        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/labels/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-pvlabeling',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'PV-Profile & PV Labeling Adverse Events Table Export (JSON)',
    summary: 'Export structured clinical adverse event tables (Severity Tiers, MedDRA PTs/SOCs, Frequencies, Leftover Terms) matching the PV-Profile tool CSV export.',
    tags: ['pv-profile', 'adverse events', 'meddra', 'pvlabeling', 'side effects', 'export', 'csv', 'safety'],
    content: (
      <div>
        <p>
          The <code>/api/v1/pvlabeling/:set_id</code> endpoint returns the structured pharmacovigilance adverse event table corresponding to the CSV exported by the PV-Profile tool.
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Endpoint Details:</h4>
        <ul>
          <li><strong>URL:</strong> <code>GET https://${apiHost}/fdalabel-v3_api/api/v1/pvlabeling/:set_id_or_spl_id</code></li>
          <li><strong>Headers:</strong> <code>X-API-Key: afl_live_YOUR_KEY</code></li>
          <li><strong>Behavior when not generated:</strong> If the PV-Profile has not yet been generated for this label, the API returns HTTP <code>404</code> with <code>"status": "not_generated"</code>, guidance instructions, and a direct URL to generate the analysis manually on the PV-Profile tool.</li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>cURL Example:</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/pvlabeling/7e606a5b-010e-4050-bf6c-6712b32bbbc4" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Sample Response (Generated Profile):</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`{
  "status": "success",
  "has_pv_profile": true,
  "label": {
    "set_id": "7e606a5b-010e-4050-bf6c-6712b32bbbc4",
    "brand_name": "LIPITOR",
    "generic_name": "ATORVASTATIN CALCIUM",
    "appr_num": "NDA020702"
  },
  "summary": {
    "total_adverse_events": 42,
    "total_leftover_terms": 15,
    "model_used": "gemini-2.5-flash",
    "tier_summary": { "1": 2, "2": 5, "3": 8, "4": 20, "5": 7 },
    "soc_summary": [
      { "soc_name": "Gastrointestinal disorders", "count": 12 },
      { "soc_name": "Musculoskeletal and connective tissue disorders", "count": 8 }
    ]
  },
  "adverse_events": [
    {
      "severity_tier": 1,
      "severity_tier_label": "Tier 1",
      "section": "BOXED WARNING",
      "side_effect_pt": "Hepatotoxicity",
      "raw_term": "Severe liver injury",
      "is_mapped": true,
      "match_type": "Mapped",
      "meddra_soc": "Hepatobiliary disorders",
      "drug_frequency": "2.5%",
      "placebo_frequency": "0.5%",
      "risk_difference_pct": 2.0,
      "frequency_category": "Common (1% - 10%)",
      "excerpt": "Severe liver injury has been reported..."
    }
  ],
  "leftover_terms": [
    {
      "matched_term": "Headache",
      "meddra_soc": "Nervous system disorders",
      "source_section": "6 ADVERSE REACTIONS"
    }
  ],
  "pv_profile_tool_url": "https://${apiHost}/fdalabel-v3/dashboard/label/7e606a5b-010e-4050-bf6c-6712b32bbbc4/pv-profile"
}`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-categorical-filtering',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Categorical Filters, Sorting, and Pagination',
    summary: 'Filtering by Labeling Type, Marketing Category, Route, Dosage Form, Pharmacologic Class (EPC), and RLD status.',
    tags: ['categories', 'route', 'dosage-form', 'epc', 'rld', 'pagination', 'sort', 'filters'],
    content: (
      <div>
        <p>
          You can refine searches with regulatory and pharmacological categories alongside pagination parameters:
        </p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>1. Categorical Parameters</h4>
        <ul>
          <li><code>labeling_type</code>: e.g. <code>HUMAN PRESCRIPTION DRUG LABEL</code>, <code>HUMAN OTC DRUG LABEL</code>, <code>VACCINE</code>.</li>
          <li><code>plr</code>: <code>all</code> (default), <code>plr</code> (Prescription Drug Labeling Format), or <code>non_plr</code>.</li>
          <li><code>application_type</code>: Marketing Category (e.g. <code>NDA</code>, <code>ANDA</code>, <code>BLA</code>, <code>OTC monograph</code>, <code>NDA authorized generic</code>).</li>
          <li><code>route</code>: Administration Route (e.g. <code>ORAL</code>, <code>INTRAVENOUS</code>, <code>TOPICAL</code>, <code>OPHTHALMIC</code>).</li>
          <li><code>dosage_form</code>: Formulation (e.g. <code>TABLET</code>, <code>CAPSULE</code>, <code>INJECTION, SOLUTION</code>).</li>
          <li><code>pharm_class</code> / <code>epc</code>: FDA Established Pharmacologic Class (e.g. <code>HMG-CoA Reductase Inhibitor</code>, <code>Kinase Inhibitor</code>).</li>
          <li><code>is_rld</code>: Boolean (<code>true</code> / <code>false</code>) filtering for Reference Listed Drugs.</li>
        </ul>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>2. Pagination and Sorting</h4>
        <ul>
          <li><code>limit</code>: Number of records per page (default: <code>50</code>, maximum: <code>1000</code>).</li>
          <li><code>page</code>: Page number (1-indexed, default: <code>1</code>).</li>
          <li><code>offset</code>: Record offset (alternative to <code>page</code>, default: <code>0</code>).</li>
          <li><code>sort</code>: Sort column — <code>revised_date</code> (default), <code>product</code>, <code>generic</code>, <code>manufacturer</code>, <code>appr_num</code>, <code>epc</code>, <code>set_id</code>.</li>
          <li><code>dir</code> or <code>order</code>: <code>desc</code> (default) or <code>asc</code>.</li>
        </ul>

        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`# Oral NDA Prescription Drugs in the statin pharmacologic class:
curl -X GET "https://${apiHost}/fdalabel-v3_api/api/v1/search?application_type=NDA&route=ORAL&pharm_class=HMG-CoA+Reductase+Inhibitor&is_rld=true&limit=25&page=1" \\
  -H "X-API-Key: afl_live_YOUR_KEY"`}
        </pre>
      </div>
    ),
  },
  {
    id: 'guide-api-code-recipes',
    category: 'api-service',
    categoryLabel: 'REST API & Integration',
    title: 'Multi-Language Integration Code Recipes (Python, R, Node.js, cURL)',
    summary: 'Ready-to-use script examples for querying the search API in Python, R, Node.js, and shell scripts.',
    tags: ['python', 'r', 'nodejs', 'curl', 'recipes', 'code', 'examples', 'integration'],
    content: (
      <div>
        <p>Copy-and-paste integration code snippets for your preferred data science and development environments:</p>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Python (using requests)</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`import requests

# Live server endpoint (Note: path is /fdalabel-v3_api/api/, NOT /fdalabel-v3/api/)
API_URL = "https://${apiHost}/fdalabel-v3_api/api/v1/search"
HEADERS = {"X-API-Key": "afl_live_YOUR_API_KEY"}

# Example: Search for Oral Diabetes medications with Boxed Warnings
params = {
    "q": "diabetes",
    "route": "ORAL",
    "section": "34066-1",
    "limit": 50,
    "page": 1
}

response = requests.get(API_URL, headers=HEADERS, params=params)
data = response.json()

print(f"Total Matches: {data['pagination']['total']}")
for label in data["results"]:
    print(f"[{label['appr_num']}] {label['product_names']} - {label['generic_names']}")
    print(f"  SET ID: {label['set_id']}")
    print(f"  DailyMed Link: {label['links']['dailymed']}")`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>R (using httr & jsonlite)</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`library(httr)
library(jsonlite)

# Live server endpoint (Note: path is /fdalabel-v3_api/api/)
res <- GET(
  "https://${apiHost}/fdalabel-v3_api/api/v1/search",
  add_headers("X-API-Key" = "afl_live_YOUR_API_KEY"),
  query = list(
    product_name = "Lipitor",
    match_mode = "contains",
    limit = 10
  )
)

data <- fromJSON(content(res, "text", encoding = "UTF-8"))
cat("Total matching labels:", data$pagination$total, "\n")
df <- data$results
print(df[, c("product_names", "generic_names", "appr_num", "revised_date")])`}
        </pre>

        <h4 style={{ color: '#1e40af', marginTop: '14px', marginBottom: '6px' }}>Node.js / TypeScript (Fetch API)</h4>
        <pre style={{ background: '#0f172a', color: '#f8fafc', padding: '12px', borderRadius: '8px', fontSize: '0.82rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`async function searchLabels() {
  // Live server endpoint (Note: path is /fdalabel-v3_api/api/)
  const url = new URL('https://${apiHost}/fdalabel-v3_api/api/v1/search');
  url.searchParams.set('product_name', 'aspirin');
  url.searchParams.set('limit', '20');

  const response = await fetch(url.toString(), {
    headers: { 'X-API-Key': 'afl_live_YOUR_API_KEY' }
  });
  const data = await response.json();
  console.log(\`Found \${data.pagination.total} results:\`);
  data.results.forEach((r: any) => console.log(\`- \${r.product_names} (\${r.set_id})\`));
}

searchLabels();`}
        </pre>
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
  {
    id: 'faq-api-1',
    category: 'api-service',
    question: 'How do I generate an API key and are there rate limits?',
    tags: ['api-key', 'generate', 'rate limit', 'token', 'quota', 'management'],
    answer: (
      <p>
        Log in to your account, open the <strong>Management</strong> page, and click the <strong>API Key</strong> tab. Click <strong>Generate API Key</strong> to obtain your personal token. Currently, there are no restrictive rate limits in place, but passing your API key ensures uninterrupted high-throughput access under future rate-limiting rules.
      </p>
    ),
  },
  {
    id: 'faq-api-2',
    category: 'api-service',
    question: 'Which database does the REST API search against?',
    tags: ['oracle', 'database', 'cder', 'cber', 'target_db', 'db_source', 'scope'],
    answer: (
      <p>
        The REST API queries the curated <strong>CDER-CBER Oracle Database</strong> (<code>druglabel.DGV_SUM_RX_SPL</code>). This ensures regulatory fidelity and high search performance. Any request parameter attempting to switch the target database is ignored.
      </p>
    ),
  },
  {
    id: 'faq-api-3',
    category: 'api-service',
    question: 'Does the REST API support MedDRA or AI prompt translation?',
    tags: ['meddra', 'ai', 'rest', 'translation', 'scope'],
    answer: (
      <p>
        AI prompt translation and hierarchical MedDRA tree browsing are designed for interactive exploratory web UI workflows. The REST API focuses on fast, deterministic programmatic queries (full-text, product names, NDA/ANDA/NDC IDs, LOINC sections, and pharmacologic classes).
      </p>
    ),
  },
  {
    id: 'faq-api-4',
    category: 'api-service',
    question: 'How do I fetch full label XML documents or DailyMed links from the API?',
    tags: ['links', 'dailymed', 'xml', 'fdalabel', 'set-id'],
    answer: (
      <p>
        Each label result in the API JSON response contains a <code>links</code> object containing direct URLs to <code>fdalabel</code>, <code>dailymed</code>, and <code>dailymed_pdf</code>. You can also fetch single label metadata via <code>GET /api/v1/labels/:set_id</code>.
      </p>
    ),
  },
];

export default function WikiPage() {
  const { session } = useUser();
  const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov';
  const guides = useMemo(() => getGuides(apiHost), [apiHost]);

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
    return guides.filter((item) => {
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
