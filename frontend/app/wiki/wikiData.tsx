import React from 'react';

export interface HandbookTopic {
  id: string;
  number: string; // e.g. "1.1", "2.1"
  partId: 'part-1' | 'part-2';
  partTitle: string;
  sectionNumber: string;
  sectionTitle: string;
  title: string;
  summary: string;
  badge?: string;
  tags: string[];
  toolLink?: { href: string; label: string };
  content: React.ReactNode;
}

export interface HandbookSection {
  id: string;
  number: string;
  title: string;
  partId: 'part-1' | 'part-2';
  partTitle: string;
  topics: HandbookTopic[];
}

export interface HandbookPart {
  id: 'part-1' | 'part-2';
  title: string;
  description: string;
  sections: HandbookSection[];
}

export const getHandbookParts = (apiHost?: string): HandbookPart[] => [
  /* =========================================================================
     PART I: HOW TO USE ASKFDALABEL (REVIEWER WORKFLOWS & USER GUIDE)
     ========================================================================= */
  {
    id: 'part-1',
    title: 'Part I: Using AskFDALabel (Reviewer Workflows)',
    description: 'Account access, managing personal tasks, finding labels, using the query builder, and exporting data.',
    sections: [
      {
        id: 'sec-1',
        number: '1.0',
        title: 'Account Access & Personal Workspace',
        partId: 'part-1',
        partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
        topics: [
          {
            id: '1-1-account-login',
            number: '1.1',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '1.0',
            sectionTitle: 'Account Access & Personal Workspace',
            title: 'Signing In & Managing Your Account',
            summary: 'How to log in, access the platform as a guest, update your password, and protect your saved review work.',
            badge: 'Basics',
            tags: ['login', 'account', 'guest', 'password', 'access'],
            toolLink: { href: '/dashboard', label: 'Go to Dashboard' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  AskFDALabel provides both personalized accounts and guest browsing. Logging in with a personal user account ensures that your review tasks, saved searches, custom notes, and favorite tools are preserved across sessions.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Logging In to Your Account</div>
                    <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                      Click <strong>Login</strong> at the top right of the screen. Enter your assigned username and password. Usernames are case-insensitive.
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Guest Access Mode</div>
                    <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                      If you do not have an account, you can explore the system as a Guest. Guest mode allows full search, label viewing, and analytical tool execution, but personal task saving and custom notes are disabled.
                    </div>
                  </div>

                  <div style={{ padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Updating Your Password</div>
                    <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                      Once logged in, click your username in the top bar to open your profile settings. You can change your password at any time to maintain account security.
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: '1-2-personal-dashboard',
            number: '1.2',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '1.0',
            sectionTitle: 'Account Access & Personal Workspace',
            title: 'Managing Your Personal Dashboard & Tasks',
            summary: 'Organizing drug labels into review tasks, bookmarking important products, and taking clinical notes.',
            tags: ['dashboard', 'tasks', 'projects', 'favorites', 'notes'],
            toolLink: { href: '/dashboard', label: 'Open My Dashboard' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Task Dashboard</strong> is your personal command center. It allows you to organize multiple drug labels into distinct regulatory review projects (called &ldquo;Tasks&rdquo;).
                </p>

                <h4 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                  Key Dashboard Features:
                </h4>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Review Tasks:</strong> Create named folders (e.g. <em>&ldquo;SGLT2 Inhibitor Safety Review 2026&rdquo;</em>) to save and organize relevant drug labels in one place.</li>
                  <li><strong>Starring Favorites:</strong> Click the star icon next to any drug label to save it to your Favorites list for quick one-click access.</li>
                  <li><strong>Reviewer Notes & Annotations:</strong> Add private clinical notes or regulatory review tags directly to any saved label.</li>
                  <li><strong>Cohort Actions:</strong> Select multiple labels in a task to run batch comparisons, download consolidated summaries, or send products to specialized safety tools.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-2',
        number: '2.0',
        title: 'Finding Drug Labels',
        partId: 'part-1',
        partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
        topics: [
          {
            id: '2-1-quick-search',
            number: '2.1',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '2.0',
            sectionTitle: 'Finding Drug Labels',
            title: 'Searching by Brand, Generic Name, or NDC',
            summary: 'How to look up approved drug products using commercial brand names, active ingredients, application numbers, or packaging codes.',
            badge: 'Search',
            tags: ['search', 'brand', 'generic', 'ndc', 'nda', 'anda', 'bla'],
            toolLink: { href: '/search', label: 'Open Search Workspace' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The global search bar at the top of the application recognizes all standard pharmaceutical identifiers and automatically finds the matching labels.
                </p>

                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.82rem' }}>
                  <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse' }}>
                    <thead style={{ background: '#f1f5f9', color: '#1e293b', fontWeight: 600, borderBottom: '1px solid #e2e8f0' }}>
                      <tr>
                        <th style={{ padding: '8px 10px' }}>What You Have</th>
                        <th style={{ padding: '8px 10px' }}>Example Search Input</th>
                        <th style={{ padding: '8px 10px' }}>How System Matches It</th>
                      </tr>
                    </thead>
                    <tbody style={{ color: '#334155' }}>
                      <tr>
                        <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>Brand Name</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', borderBottom: '1px solid #f1f5f9' }}>Lipitor</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>Retrieves all approved branded products with this trade name.</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>Generic Substance</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', borderBottom: '1px solid #f1f5f9' }}>Atorvastatin calcium</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>Finds the innovator product plus all generic ANDA equivalents.</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>Application Number</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', borderBottom: '1px solid #f1f5f9' }}>NDA020702 / ANDA076477</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>Locates the exact regulatory submission and its associated package inserts.</td>
                      </tr>
                      <tr>
                        <td style={{ padding: '8px 10px', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>National Drug Code</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', borderBottom: '1px solid #f1f5f9' }}>0071-0155-23</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid #f1f5f9' }}>Directly identifies the specific package presentation and bottle size.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          },
          {
            id: '2-2-plain-language-search',
            number: '2.2',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '2.0',
            sectionTitle: 'Finding Drug Labels',
            title: 'Asking Clinical Questions in Plain English',
            summary: 'Using conversational clinical questions to discover relevant drug products, safety warnings, and boxed warnings.',
            tags: ['ai', 'plain-language', 'clinical-questions', 'warnings', 'intent'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  You do not need to construct complex database queries. You can type clinical regulatory questions in everyday language, such as:
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', fontStyle: 'italic' }}>
                    &ldquo;Oral diabetes tablets with Boxed Warning for lactic acidosis&rdquo;
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', fontStyle: 'italic' }}>
                    &ldquo;Which GLP-1 receptor agonists have thyroid C-cell tumor warnings?&rdquo;
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px', fontSize: '0.85rem', color: '#1e293b', fontStyle: 'italic' }}>
                    &ldquo;Topical antifungal creams approved under OTC monographs&rdquo;
                  </div>
                </div>

                <h4 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                  How the Assistant Helps You:
                </h4>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  The assistant automatically identifies your core drug or condition and displays helpful <strong>Filter Chips</strong> (e.g. <em>Dosage Form: Tablet</em>, <em>Route: Oral</em>). You can easily click any chip to turn it off or on to fine-tune your results list.
                </p>
              </div>
            ),
          },
          {
            id: '2-3-reading-label',
            number: '2.3',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '2.0',
            sectionTitle: 'Finding Drug Labels',
            title: 'Browsing & Reading Prescribing Information',
            summary: 'Navigating structured label sections, inspecting clinical trial tables, and locating boxed warnings.',
            tags: ['label-view', 'sections', 'boxed-warning', 'prescribing-information'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  Clicking on any search result opens the full <strong>Label Detail View</strong>. This view renders the official Prescribing Information formatted in accordance with FDA labeling standards (PLR format):
                </p>

                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Section Table of Contents:</strong> Use the left-hand navigation pane to jump directly to any section (e.g. Section 1 Indications, Section 4 Contraindications, Section 5 Warnings and Precautions, Section 6 Adverse Reactions).</li>
                  <li><strong>Boxed Warning Banner:</strong> Products with a Black Box Warning display an immediate, high-visibility alert at the top of the label.</li>
                  <li><strong>Search Inside Label:</strong> Press <code>Ctrl+F</code> or use the in-page search bar to locate specific terms within the active label.</li>
                  <li><strong>Version & Effective Date:</strong> View the official revision date, manufacturer/distributor details, and initial U.S. approval year.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-3',
        number: '3.0',
        title: 'Structured Label Filtering (Query Builder)',
        partId: 'part-1',
        partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
        topics: [
          {
            id: '3-1-qb-market-filters',
            number: '3.1',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '3.0',
            sectionTitle: 'Structured Label Filtering (Query Builder)',
            title: 'Filtering by Product & Market Category',
            summary: 'How to narrow your search to prescription drugs, generic approvals, OTC products, or therapeutic biologics.',
            badge: 'Filter',
            tags: ['filters', 'rx', 'otc', 'anda', 'nda', 'bla', 'generics'],
            toolLink: { href: '/querybuilder', label: 'Open Query Builder' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  When conducting regulatory reviews across a class of products, the <strong>Criteria Query Builder</strong> (<code>/querybuilder</code>) lets you apply step-by-step filters without typing code.
                </p>

                <h4 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                  Market Category Options:
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                    <strong>Prescription Drugs (Rx):</strong> Select NDA (innovator products) or ANDA (generic approvals) to focus on prescription pharmaceuticals.
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                    <strong>Therapeutic Biologics (BLA):</strong> Filter specifically for monoclonal antibodies, cytokines, and therapeutic recombinant proteins.
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px' }}>
                    <strong>Over-The-Counter (OTC):</strong> Select OTC Monograph or OTC NDA to inspect non-prescription consumer healthcare products.
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: '3-2-qb-dosage-routes',
            number: '3.2',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '3.0',
            sectionTitle: 'Structured Label Filtering (Query Builder)',
            title: 'Filtering by Dosage Form, Route, & Drug Class',
            summary: 'Targeting specific routes of administration, physical dosage forms, or Established Pharmacologic Classes (EPC).',
            tags: ['dosage', 'route', 'epc', 'pharmacologic-class'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  In Step 1 of the Query Builder, you can refine your search by physical and pharmacological characteristics:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Route of Administration:</strong> Filter by Oral, Intravenous, Subcutaneous, Topical, Inhalation, Ophthalmic, etc.</li>
                  <li><strong>Dosage Form:</strong> Select Tablet, Capsule, Solution, Suspension, Patch, Extended Release, etc.</li>
                  <li><strong>Pharmacologic Class (EPC):</strong> Select from official FDA Established Pharmacologic Classes (e.g. <em>&ldquo;Sodium-Glucose Cotransporter 2 Inhibitor&rdquo;</em>, <em>&ldquo;HMG-CoA Reductase Inhibitor&rdquo;</em>).</li>
                </ul>
              </div>
            ),
          },
          {
            id: '3-3-qb-safety-sections',
            number: '3.3',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '3.0',
            sectionTitle: 'Structured Label Filtering (Query Builder)',
            title: 'Searching Specific Safety & Warning Sections',
            summary: 'Focusing keywords and medical terms exclusively within Boxed Warnings, Adverse Reactions, or Drug Interactions.',
            tags: ['sections', 'boxed-warning', 'adverse-reactions', 'warnings'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  In Step 3 of the Query Builder, you can search for safety terms within specific sections rather than searching the entire document. This eliminates irrelevant matches from background pharmacology or clinical studies:
                </p>

                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Boxed Warning:</strong> Find only products where a severe risk is highlighted in the black box.</li>
                  <li><strong>Section 5 (Warnings and Precautions):</strong> Search clinical safety guidance, monitoring requirements, and serious hazards.</li>
                  <li><strong>Section 6 (Adverse Reactions):</strong> Find terms documented in clinical trial incidence tables or postmarketing surveillance.</li>
                  <li><strong>Section 7 (Drug Interactions):</strong> Search for CYP enzyme interactions, contraindicated co-medications, and food interactions.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-4',
        number: '4.0',
        title: 'Exporting Data & Review Management',
        partId: 'part-1',
        partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
        topics: [
          {
            id: '4-1-export-excel',
            number: '4.1',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '4.0',
            sectionTitle: 'Exporting Data & Review Management',
            title: 'Exporting Search Results to Excel',
            summary: 'How to download formatted spreadsheets of matching drug labels, identifiers, and section text for regulatory records.',
            badge: 'Export',
            tags: ['excel', 'export', 'spreadsheet', 'download', 'reports'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  Every search result table includes an <strong>Export to Excel</strong> button. Clicking this generates a formatted Microsoft Excel (<code>.xlsx</code>) spreadsheet containing:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li>Product Brand Name and Active Ingredient Generic Name</li>
                  <li>Application Number (NDA / ANDA / BLA) and Marketing Category</li>
                  <li>Dosage Form, Route of Administration, and Manufacturer/Distributor</li>
                  <li>Matching section excerpts with your query keywords highlighted</li>
                  <li>Direct links to official FDA and DailyMed web repositories</li>
                </ul>
              </div>
            ),
          },
          {
            id: '4-2-task-organization',
            number: '4.2',
            partId: 'part-1',
            partTitle: 'Part I: Using AskFDALabel (Reviewer Workflows)',
            sectionNumber: '4.0',
            sectionTitle: 'Exporting Data & Review Management',
            title: 'Organizing Review Cohorts & Sharing Work',
            summary: 'Grouping related drug labels into saved review tasks for class-wide safety assessments.',
            tags: ['cohorts', 'tasks', 'collaboration', 'review'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  To evaluate an entire therapeutic class or compare all generics for an innovator product, select the checkboxes next to the labels in your search results and click <strong>Add to Task</strong>.
                </p>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  Once saved into a task, you can revisit this group at any time, run cross-label safety comparisons, and export consolidated summary tables for regulatory filings or scientific manuscripts.
                </p>
              </div>
            ),
          },
        ],
      },
    ],
  },

  /* =========================================================================
     PART II: SPECIALIZED ANALYTICAL & SAFETY TOOLS (AGENTIC CAPABILITIES)
     ========================================================================= */
  {
    id: 'part-2',
    title: 'Part II: Specialized Analytical & Safety Tools',
    description: 'Detailed user guides for MedDRA highlighting, PV profiles, label comparisons, toxicology, devices, and chemical search.',
    sections: [
      {
        id: 'sec-5',
        number: '5.0',
        title: 'Adverse Reactions & MedDRA Highlighting',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '5-1-ae-viewer',
            number: '5.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '5.0',
            sectionTitle: 'Adverse Reactions & MedDRA Highlighting',
            title: 'Reading Adverse Reactions in Original Label Format',
            summary: 'Viewing clinical adverse reactions with original tables, percentages, and clinical trial incidence formatting intact.',
            badge: 'Tool',
            tags: ['adverse-reactions', 'clinical-trials', 'ae-viewer', 'incidence-tables'],
            toolLink: { href: '/labeling-ae', label: 'Open Labeling AE Viewer' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Labeling Adverse Events (AE) Viewer</strong> (<code>/labeling-ae</code>) is designed specifically for clinical reviewers. It displays adverse event sections using original FDA document layouts.
                </p>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  Unlike plain-text conversions that scramble comparative columns, this viewer preserves multi-arm clinical trial tables, placebo comparator percentages, and footnote qualifiers exactly as submitted in the approved labeling.
                </p>
              </div>
            ),
          },
          {
            id: '5-2-meddra-highlighting',
            number: '5.2',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '5.0',
            sectionTitle: 'Adverse Reactions & MedDRA Highlighting',
            title: 'MedDRA Hierarchy & Multi-Color Highlighting',
            summary: 'How the tool automatically scans and color-codes standardized medical terms (Preferred Terms, System Organ Classes) in label text.',
            tags: ['meddra', 'highlighting', 'preferred-terms', 'soc', 'safety-terms'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  As you read the prescribing information, the viewer automatically highlights terms that match the standardized <strong>Medical Dictionary for Regulatory Activities (MedDRA)</strong> vocabulary.
                </p>

                <h4 style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.9rem', marginTop: '0.5rem', marginBottom: '0.25rem' }}>
                  Color-Coded Hierarchy Tiers:
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #7c3aed', borderRadius: '4px' }}>
                    <strong>System Organ Class (SOC):</strong> Broad anatomical or physiological systems (e.g. <em>Hepatobiliary disorders</em>, <em>Cardiac disorders</em>).
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #059669', borderRadius: '4px' }}>
                    <strong>Preferred Term (PT):</strong> The distinct clinical symptom or diagnosis (e.g. <em>Hepatic failure</em>, <em>Ventricular arrhythmia</em>).
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #d97706', borderRadius: '4px' }}>
                    <strong>Lowest Level Term (LLT):</strong> Synonyms and colloquial terms mapped directly to the Preferred Term.
                  </div>
                </div>

                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  Clicking on any highlighted term displays its full hierarchy path and shows how often the term has been reported in FDA adverse event databases.
                </p>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-6',
        number: '6.0',
        title: 'Pharmacovigilance Safety Profile (PV Profile)',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '6-1-pv-evidence-grid',
            number: '6.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '6.0',
            sectionTitle: 'Pharmacovigilance Safety Profile (PV Profile)',
            title: 'Adverse Event Evidence Grid',
            summary: 'A standardized overview grid showing adverse reactions organized by reporting frequency and label section.',
            badge: 'Tool',
            tags: ['pv-profile', 'sider', 'safety-profile', 'frequency', 'adverse-events'],
            toolLink: { href: '/pv-profile', label: 'Open PV Profile' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>PV Profile</strong> (<code>/pv-profile</code>) synthesizes all adverse reactions from a drug label into a clean, standardized evidence grid (inspired by international SIDER 4.1 standards).
                </p>

                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Frequency Bands:</strong> Instantly see which reactions are Very Common (&gt;10%), Common (1-10%), Uncommon, or Rare.</li>
                  <li><strong>Section Location:</strong> Clear visual tags indicate whether a symptom appears in Boxed Warnings, Warnings & Precautions, or Adverse Reactions.</li>
                  <li><strong>Trial vs. Postmarket:</strong> Differentiates symptoms proven in clinical trials from voluntary postmarketing reports.</li>
                </ul>
              </div>
            ),
          },
          {
            id: '6-2-pv-qc-audit',
            number: '6.2',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '6.0',
            sectionTitle: 'Pharmacovigilance Safety Profile (PV Profile)',
            title: 'Reviewer Verification & Quality Checks',
            summary: 'How reviewers can verify safety terms, reconcile discrepancies, and ensure regulatory data accuracy.',
            tags: ['quality-control', 'qc', 'audit', 'validation', 'reconciliation'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The PV Profile includes an automated <strong>Quality Control (QC) Checker</strong> that flags potential issues for reviewer inspection:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li>Flags any adverse reaction mentioned in the text that lacks a standardized MedDRA mapping.</li>
                  <li>Alerts the reviewer if a reported percentage number conflicts with its assigned frequency band.</li>
                  <li>Confirms that every term in the Boxed Warning is also described in the Warnings & Precautions section.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-7',
        number: '7.0',
        title: 'Side-by-Side Label Comparison (LabelComp)',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '7-1-labelcomp-rld',
            number: '7.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '7.0',
            sectionTitle: 'Side-by-Side Label Comparison (LabelComp)',
            title: 'Comparing Generic vs. Brand-Name Labels (RLD)',
            summary: 'Evaluating generic ANDA labeling against the innovator Reference Listed Drug (RLD) side-by-side.',
            badge: 'Tool',
            tags: ['comparison', 'rld', 'generics', 'anda', 'labelcomp', 'diff'],
            toolLink: { href: '/labelcomp', label: 'Open Label Comparison' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Label Comparison</strong> tool (<code>/labelcomp</code>) allows you to select up to four drug labels and view their clinical sections side-by-side.
                </p>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  For generic drug reviews, compare the proposed ANDA label against the Reference Listed Drug (RLD). The tool automatically aligns sections (e.g. Contraindications, Dosing, Warnings) and visually highlights text additions in green and deletions in red.
                </p>
              </div>
            ),
          },
          {
            id: '7-2-labelcomp-history',
            number: '7.2',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '7.0',
            sectionTitle: 'Side-by-Side Label Comparison (LabelComp)',
            title: 'Tracking Safety Revisions Over Time',
            summary: 'Comparing older and newer versions of the same drug product to track labeling updates.',
            tags: ['version-tracking', 'longitudinal', 'safety-updates', 'revisions'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  When safety warnings are updated or new indications are approved, compare the current label against previous historical versions.
                </p>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  This longitudinal comparison immediately pinpoints newly added contraindications, expanded warning paragraphs, or revised dosage adjustments without reading through dozens of pages manually.
                </p>
              </div>
            ),
          },
          {
            id: '7-3-labelcomp-ai-summary',
            number: '7.3',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '7.0',
            sectionTitle: 'Side-by-Side Label Comparison (LabelComp)',
            title: 'Reading the AI Difference Summary',
            summary: 'Generating an executive briefing of clinical differences and new warnings between compared labels.',
            tags: ['ai-summary', 'executive-brief', 'difference-summary'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  Click <strong>Generate AI Comparison Summary</strong> to receive a concise, plain-language executive summary outlining the critical differences between the compared labels:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li>Highlights any newly added Black Box Warnings or updated safety precautions.</li>
                  <li>Summarizes differences in dosing schedules, administration guidelines, or renal dose adjustments.</li>
                  <li>Identifies changes in approved patient age groups, indications, or pregnancy risk descriptions.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-8',
        number: '8.0',
        title: 'Toxicology Intelligence (askDrugTox)',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '8-1-drugtox-overview',
            number: '8.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '8.0',
            sectionTitle: 'Toxicology Intelligence (askDrugTox)',
            title: 'Evaluating Liver, Heart, & Kidney Safety',
            summary: 'Assessing Drug-Induced Liver Injury (DILI), Cardiotoxicity (DICT), and Renal Injury (DIRI) with postmarketing signals.',
            badge: 'Tool',
            tags: ['drugtox', 'toxicology', 'dili', 'dict', 'diri', 'faers'],
            toolLink: { href: '/drugtox', label: 'Open askDrugTox' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>askDrugTox</strong> workspace (<code>/drugtox</code>) is a dedicated toxicology resource that synthesizes published scientific literature, clinical trial findings, and FDA adverse event reporting (FAERS) signals across three vital organ systems:
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px' }}>
                    <strong>DILI (Liver Injury):</strong> Clinical severity rankings, benchmark classifications (Most-DILI, Less-DILI, No-DILI), and hepatotoxicity warnings.
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px' }}>
                    <strong>DICT (Cardiotoxicity):</strong> QT interval prolongation risks, arrhythmia warnings, and cardiac failure reporting signals.
                  </div>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid #002e5d', borderRadius: '4px' }}>
                    <strong>DIRI (Kidney Injury):</strong> Nephrotoxicity alerts, renal clearance restrictions, and acute kidney injury reports.
                  </div>
                </div>
              </div>
            ),
          },
          {
            id: '8-2-dili-ro2',
            number: '8.2',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '8.0',
            sectionTitle: 'Toxicology Intelligence (askDrugTox)',
            title: 'DILI Rule-of-Two Risk Screening',
            summary: 'Screening severe liver injury risk using daily dosage and lipophilicity guidelines (Chen 2013).',
            tags: ['rule-of-two', 'ro2', 'dili', 'hepatotoxicity', 'dosage', 'logp'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Rule-of-Two (RO2)</strong> model (Chen et al., 2013) is a recognized screening benchmark for severe drug-induced liver injury:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Criterion 1:</strong> Maximum recommended daily dose &ge; 100 mg/day.</li>
                  <li><strong>Criterion 2:</strong> High lipophilicity (logP &ge; 3.0).</li>
                </ul>
                <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.6 }}>
                  Drugs that meet both criteria fall into the High-Risk quadrant, exhibiting significantly higher historical rates of severe liver failure and black-box safety warnings in postmarketing surveillance.
                </p>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-9',
        number: '9.0',
        title: 'Chemical Structure Search (ChemSearch)',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '9-1-chemsearch-similarity',
            number: '9.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '9.0',
            sectionTitle: 'Chemical Structure Search (ChemSearch)',
            title: 'Finding Structurally Related Drugs',
            summary: 'Searching active pharmaceutical ingredients by molecular structure, SMILES, or chemical similarity.',
            badge: 'Tool',
            tags: ['chemsearch', 'structure', 'smiles', 'similarity', 'analogues'],
            toolLink: { href: '/chemsearch', label: 'Open ChemSearch' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Chemical Structure Search</strong> tool (<code>/chemsearch</code>) allows reviewers to search approved drug labels using chemical representations:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>Draw or Paste:</strong> Draw a molecule using the 2D sketcher, or paste a standard SMILES string or InChI code.</li>
                  <li><strong>Structure Similarity:</strong> Find chemical analogues and derivatives that share core molecular scaffolds.</li>
                  <li><strong>Class Safety Comparison:</strong> Discover how related chemical structures compare in terms of approved indications and safety warnings.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-10',
        number: '10.0',
        title: 'Medical Device Intelligence',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '10-1-device-clearances-recalls',
            number: '10.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '10.0',
            sectionTitle: 'Medical Device Intelligence',
            title: 'Searching Device Clearances, Recalls, & MAUDE Events',
            summary: 'Looking up medical device 510(k) clearances, PMAs, postmarket incident reports, and recalls.',
            badge: 'Tool',
            tags: ['devices', '510k', 'pma', 'maude', 'recalls', 'ifu'],
            toolLink: { href: '/device', label: 'Open Device Intelligence' },
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <p style={{ fontSize: '0.9rem', color: '#334155', lineHeight: 1.6 }}>
                  The <strong>Device Intelligence</strong> module (<code>/device</code>) connects to official FDA medical device regulatory records:
                </p>
                <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.88rem', color: '#334155', paddingLeft: '1.25rem' }}>
                  <li><strong>510(k) & PMA Clearances:</strong> Look up applicant information, clearance dates, advisory committees, and predicate devices.</li>
                  <li><strong>MAUDE Incident Reports:</strong> Review reported device malfunctions, injuries, and serious adverse events.</li>
                  <li><strong>Recalls & Enforcement:</strong> Check active and historical Class I, II, and III device recalls and root-cause reasons.</li>
                  <li><strong>IFU Comparison:</strong> Compare Instructions for Use (IFU) documents across competing medical devices.</li>
                </ul>
              </div>
            ),
          },
        ],
      },
      {
        id: 'sec-11',
        number: '11.0',
        title: 'Frequently Asked Questions (FAQ)',
        partId: 'part-2',
        partTitle: 'Part II: Specialized Analytical & Safety Tools',
        topics: [
          {
            id: '11-1-reviewer-faq',
            number: '11.1',
            partId: 'part-2',
            partTitle: 'Part II: Specialized Analytical & Safety Tools',
            sectionNumber: '11.0',
            sectionTitle: 'Frequently Asked Questions (FAQ)',
            title: 'Reviewer FAQs & Tips',
            summary: 'Answers to common reviewer questions regarding dataset refresh dates, search tips, and support.',
            badge: 'Help',
            tags: ['faq', 'help', 'tips', 'support', 'contact'],
            content: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#ffffff' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>How often is drug labeling updated in the system?</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                    The core dataset is refreshed monthly with official FDA and DailyMed public distributions. If your installation connects to internal CDER-CBER repositories, newly approved submissions are synchronized automatically.
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#ffffff' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Can I share my saved review tasks with colleagues?</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                    Yes. Any task list created in your personal dashboard can be exported as an Excel spreadsheet or shared with other registered reviewers on the platform.
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#ffffff' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Why are some medical terms highlighted while others are not?</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                    The automatic highlighter matches terms against the official MedDRA dictionary. Non-standardized synonyms or descriptive colloquial phrases might not highlight until they are mapped to an official Preferred Term (PT).
                  </div>
                </div>

                <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '12px', background: '#ffffff' }}>
                  <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.88rem' }}>Who do I contact for regulatory science support or feature requests?</div>
                  <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', lineHeight: 1.55 }}>
                    For technical inquiries or feature suggestions, contact the FDA NCTR Bioinformatics & Regulatory Science team at <code>NCTRBioinformaticsSupport@fda.hhs.gov</code>.
                  </div>
                </div>
              </div>
            ),
          },
        ],
      },
    ],
  },
];
