import { TOOLS } from '../platform/registry';

/** Reviewer-facing knowledge: product workflows and evidence interpretation. */
export type ReadingPath = 'guides' | 'methods';
export interface WikiSection {
  heading: string; paragraphs?: string[]; steps?: string[];
  table?: { columns: string[]; rows: string[][] };
  illustration?: 'search-workflow' | 'criteria-logic';
}
export interface WikiArticle {
  id: string; path: ReadingPath; group: string; toolId?: string; title: string; summary: string;
  tags: string[]; sections: WikiSection[]; related: string[];
  action?: { href: string; label: string };
  references?: { title: string; href: string }[];
}
export const PATHS = {
  guides: { title: 'Complete a review task', short: 'Guides', description: 'Find the right labeling, examine evidence, and preserve your review.' },
  methods: { title: 'Understand data & results', short: 'Data & methods', description: 'Understand sources, analytical outputs, uncertainty, and verification.' },
};
export const SEARCH_CHAPTER_IDS = ['query-guide', 'find-labeling', 'search-scope', 'manual-query', 'ai-query', 'match-expansion', 'search-results', 'query-codes'];
const home = { href: '/', label: 'Find labeling' };
const tools = { href: '/tools', label: 'Browse available tools' };
const dailyMed = { title: 'NLM: About DailyMed', href: 'https://www.dailymed.nlm.nih.gov/dailymed/about-dailymed.cfm' };
const faers = { title: 'FDA: Postmarket safety surveillance and public data', href: 'https://www.fda.gov/drugs/cder-conversations/understanding-cders-postmarket-safety-surveillance-programs-and-public-data' };
const meddra = { title: 'MedDRA: Multiaxiality', href: 'https://www.meddra.org/multiaxiality' };
const ro2 = { title: 'Chen et al. (2013): Daily dose, lipophilicity and DILI', href: 'https://pubmed.ncbi.nlm.nih.gov/23258593/' };
function guide(id: string, group: string, title: string, summary: string, steps: string[], checks: string[], related: string[], action = tools): WikiArticle {
  return { id, path: 'guides', group, title, summary, tags: [group, ...related], related, action, sections: [
    { heading: 'Before you start', paragraphs: ['Identify the product and labeling version you intend to review. Available tools depend on your account, deployment, and selected labeling.'] },
    { heading: 'Steps', steps },
    { heading: 'Verify and save', steps: checks },
  ] };
}
function method(id: string, group: string, title: string, summary: string, sections: WikiSection[], related: string[], references?: WikiArticle['references']): WikiArticle {
  return { id, path: 'methods', group, title, summary, tags: [group, ...related], sections, related, references };
}
const CONTENT: WikiArticle[] = [
  guide('first-review', 'Start a review', 'Your first labeling review', 'A practical route from a safety question to a saved, traceable observation.', [
    'Write a focused review question: which product, population, safety topic, and version are relevant?',
    'Search for the product and inspect the identifiers, dosage form, route, application number, and available version before opening a result.',
    'In Label View, expand Label details when needed and use Contents to locate the relevant section. Read surrounding paragraphs, tables, and footnotes.',
    'Open Toolbox and choose an analysis suited to the question. Keep the original document available while examining extracted or generated output.',
    'Record the finding, the source passage and version, any uncertainty, and your next verification step. Save notes or export the relevant evidence where available.',
  ], ['Check that the quoted passage supports the observation in its original context.', 'Distinguish your interpretation from source text and AI-generated suggestions.'], ['versions', 'evidence-types', 'toolbox-guide', 'review-record'], home),
  {
    id: 'account-access', path: 'guides', group: 'Account & preferences',
    title: 'Sign in and sign out', summary: 'Use your own account for personal review work.',
    tags: ['login', 'logout', 'SSO', 'guest', 'account'],
    related: ['change-password', 'login-help', 'saved-work'],
    sections: [
      { heading: 'Sign in', steps: ['Click Login in the header.', 'Choose institutional sign-in when offered, or enter your account username and password.', 'Open the account menu to check which account is signed in.'], paragraphs: ['Guest access uses a shared account. AI preferences and personal search history are unavailable to Guest.'] },
      { heading: 'Sign out', paragraphs: ['Open the account menu and choose Sign Out.'] },
    ],
  },
  {
    id: 'change-password', path: 'guides', group: 'Account & preferences',
    title: 'Change your password', summary: 'Update the password for an account that uses password sign-in.',
    tags: ['password', 'security', 'account', 'SSO'], related: ['account-access', 'login-help'],
    sections: [
      { heading: 'Update your password', steps: ['Open the account menu and choose Change Password.', 'Enter the new password in New Password and Confirm New Password.', 'Click Update Password and check the confirmation.'] },
      { heading: 'No Change Password option?', paragraphs: ['Institutional SSO passwords are managed by your institution. Guest accounts cannot change passwords.'] },
    ],
  },
  {
    id: 'login-help', path: 'guides', group: 'Account & preferences',
    title: 'Trouble signing in', summary: 'Find the right help for your sign-in method.',
    tags: ['forgot password', 'reset password', 'login', 'SSO', 'locked out'],
    related: ['account-access', 'change-password', 'availability'],
    sections: [
      { heading: 'Choose your sign-in method', table: { columns: ['You use', 'What to do'], rows: [
        ['Account username and password', 'Check the username and password. If you have forgotten the password, contact your askFDALabel administrator; there is no self-service email reset.'],
        ['Institutional sign-in (SSO)', 'Use your institution’s password recovery or IT support.'],
      ] } },
      { heading: 'Signed in, but a feature is missing?', paragraphs: ['Check the account name in the menu. Feature access can differ by account and deployment; ask your administrator about the feature you need.'] },
    ],
  },
  {
    id: 'ai-preferences', path: 'guides', group: 'Account & preferences',
    title: 'Choose your AI model', summary: 'Set the model for your next AI request.',
    tags: ['AI', 'model', 'ELSA', 'Llama-4', 'Muse', 'Gemini', 'system default'],
    related: ['ai-usage', 'availability', 'waiting-results'],
    action: { href: '/management?tab=ai', label: 'Open AI Preferences' },
    sections: [
      { heading: 'Change the model', steps: ['Open the account menu and choose AI preferences.', 'Select an available model.', 'Click Save preferences. Check the current model shown on the page.'], paragraphs: ['Your choice applies to your account’s next AI requests.'] },
      { heading: 'Follow the system default', paragraphs: ['Select Follow system default and click Save preferences to remove your personal model choice.'] },
      { heading: 'Which models are available?', paragraphs: ['Internal environments offer ELSA, Llama-4 (Local), and Muse (Local); external environments offer Gemini. Your installation may limit this list further.', 'Guest accounts cannot save an AI preference. If AI preferences is unavailable on your personal account, ask your administrator about access. Connection addresses and keys are managed by administrators.'] },
    ],
  },
  {
    id: 'ai-usage', path: 'guides', group: 'Account & preferences',
    title: 'View your AI usage', summary: 'Check recorded model use and token counts for your account.',
    tags: ['AI', 'token usage', 'history', 'model', 'date filter'],
    related: ['ai-preferences', 'history-guide'],
    action: { href: '/management?tab=tokens', label: 'Open My Token Usage' },
    sections: [
      { heading: 'Find a record', steps: ['Open Settings & Preferences from the account menu.', 'Choose My Token Usage.', 'Filter by date or model. The initial view shows the last 7 days.'] },
      { heading: 'Read the records', paragraphs: ['Each record shows a model name, time, and input, output, and total token counts. This view does not contain the question or answer text.', 'Settings & Preferences must be enabled for your personal account.'] },
    ],
  },
  {
    id: 'find-labeling', path: 'guides', group: 'Search labeling',
    title: 'Find labeling by name or identifier', summary: 'Start with the identifier you have, then confirm the product.',
    tags: ['brand', 'ingredient', 'NDC', 'application number'], action: home,
    related: ['query-guide', 'search-scope', 'versions'],
    sections: [
      { heading: 'Choose an input', table: { columns: ['You have', 'Enter'], rows: [
        ['Product name', 'Brand name or ingredient; inspect the suggested matches.'],
        ['Application number', 'NDA, ANDA, or BLA number.'],
        ['NDC', 'The code for the product or package you are investigating.'],
      ] } },
      { heading: 'Confirm the match', steps: ['Check the database scope and select the intended candidate.', 'Run the search. Open a result and check its identifiers, route, dosage form, and version.'], paragraphs: ['A similar name does not establish product equivalence.'] },
    ],
  },
  {
    id: 'query-guide', path: 'guides', group: 'Search labeling',
    title: 'Search labeling',
    summary: 'Find labeling, check the matches, and choose documents to review.',
    tags: ['search', 'core workspace', 'query builder', 'AI Query Builder', 'review set'], action: home,
    related: ['find-labeling', 'search-scope', 'manual-query', 'ai-query', 'match-expansion', 'search-results', 'query-codes'],
    sections: [
      { heading: 'The workflow', illustration: 'search-workflow' },
      { heading: 'Build your query', table: {
        columns: ['Start with', 'What to do'], rows: [
          ['Names or known conditions', 'Enter them directly in the Query Builder.'],
          ['A question in plain language', 'Use AI Query Builder, then review the generated conditions.'],
        ],
      }, paragraphs: ['Both routes use the same editable criteria. Leave Quick search unchecked to review an AI draft before searching.'] },
      { heading: 'Check the scope', paragraphs: ['Search uses the database scope shown in the workspace—not necessarily Local. Available records and conditions depend on that scope.'] },
    ],
  },
  {
    id: 'manual-query', path: 'guides', group: 'Search labeling',
    title: 'Build criteria manually',
    summary: 'Add conditions, check their grouping, then run Search Labels.',
    tags: ['manual search', 'criteria', 'AND', 'OR', 'ingredient', 'route', 'section', 'grouping'], action: home,
    related: ['query-guide', 'search-scope', 'match-expansion', 'ai-query', 'search-results', 'query-codes'],
    sections: [
      { heading: 'Set up the search', steps: [
        'Check Search database. It determines which records and conditions are available.',
        'Enter product names or identifiers. Confirm the suggested matches.',
        'Add the section and text or medical terms you need. Review any selected categorical chips.',
      ] },
      { heading: 'Combine conditions', paragraphs: ['Within one group, conditions apply together (AND). Add Alternative Criteria Group accepts either group (OR). Try the example below.'], illustration: 'criteria-logic' },
      { heading: 'Before clicking Search Labels', steps: [
        'Check the selected names, terms, section, and chips.',
        'For a product containing both ingredients, verify that the conditions require both. A list of names may mean alternatives.',
        'Check Exact match: it controls related-entity expansion, separately from equals or contains within a condition.',
      ] },
    ],
  },
  {
    id: 'ai-query', path: 'guides', group: 'Search labeling',
    title: 'Use AI to draft search criteria', summary: 'Describe the search, inspect the draft, then run it.',
    tags: ['AI Query Builder', 'Quick search', 'Build Criteria', 'external AI'], action: home,
    related: ['manual-query', 'match-expansion', 'query-codes'],
    sections: [
      { heading: 'Build and review', steps: ['Enter your request in AI Query Builder. Leave Quick search unchecked.', 'Click Build Criteria. Check names, terms, sections, AND/OR groups, and selected chips.', 'Correct the draft, then click Search Labels.'] },
      { heading: 'Other starting points', table: { columns: ['Option', 'What changes'], rows: [
        ['Quick search', 'Runs a successful translation immediately, without criteria confirmation.'],
        ['Restore Query', 'Loads saved conditions from a query code.'],
        ['External AI', 'Use the provided query instructions, then import and check the generated conditions.'],
      ] } },
    ],
  },
  {
    id: 'search-results', path: 'guides', group: 'Search labeling',
    title: 'Read and refine your search results', summary: 'Check what matched before narrowing or exporting the set.',
    tags: ['results', 'filters', 'facets', 'total', 'Back to search'], action: home,
    related: ['manual-query', 'no-results', 'query-codes', 'read-labeling'],
    sections: [
      { heading: 'Read the numbers', table: { columns: ['Display', 'Meaning'], rows: [
        ['Underlying total', 'Records matching the query before sidebar filters.'],
        ['Filtered total', 'Records remaining after the active filters.'],
        ['Facet counts', 'Category counts for the underlying query, without sidebar filters.'],
      ] }, paragraphs: ['These are labeling-record counts, not necessarily unique-drug counts.'] },
      { heading: 'Refine the set', steps: ['Open representative and unexpected matches. Check product identity, version, and the source passage.', 'Use sidebar filters to narrow the set; use Back to search to change the criteria.', 'If results are missing, check scope, terms, and filters. Before exporting, check which records will be included.'] },
    ],
  },
  {
    id: 'query-codes', path: 'guides', group: 'Search labeling',
    title: 'Save and restore a search', summary: 'A query code saves conditions and filters, not a frozen result set.',
    tags: ['query code', 'FDALABEL-Q1', 'Copy Query Code', 'Restore Query'], action: home,
    related: ['search-results', 'search-scope', 'review-record'],
    sections: [
      { heading: 'Save → restore → check', steps: ['From the results export menu, choose Copy Query Code. Copy the complete FDALABEL-Q1 code.', 'Paste it into AI Query Builder and choose Restore Query.', 'Check scope, conditions, Exact match, and filters before searching again.'] },
      { heading: 'Keep the evidence separately', paragraphs: ['Save the reviewed document versions and exports alongside the code. Data can change between searches; restoring a code does not grant additional access.', 'Shared codes contain readable search information. Do not include confidential content.'] },
    ],
  },
  {
    id: 'saved-work', path: 'guides', group: 'Dashboard',
    title: 'Dashboard overview', summary: 'Return to saved review collections and their labeling.',
    tags: ['Dashboard', 'Task', 'Project', 'saved labeling'], action: { href: '/dashboard', label: 'Open My Dashboard' },
    related: ['project-guide', 'saved-labels', 'read-labeling'],
    sections: [
      { heading: 'Find your work', steps: ['Open My Dashboard from the account menu.', 'Search or filter the task list, then open a task.', 'Choose its labeling list to reopen a document. Saved comparisons appear in a separate tab.'] },
      { heading: 'Names in the interface', paragraphs: ['Dashboard calls a saved review project a Task. The Projects action in a labeling workspace adds that labeling to a collection. Use a personal account for saved work.'] },
    ],
  },
  {
    id: 'project-guide', path: 'guides', group: 'Dashboard',
    title: 'Create and manage a task', summary: 'Create a collection for a review question.',
    tags: ['project', 'Create Task', 'New Task', 'delete', 'tags'], action: { href: '/dashboard', label: 'Open My Dashboard' },
    related: ['saved-work', 'saved-labels'],
    sections: [
      { heading: 'Create', steps: ['Open Create Task on Dashboard and choose New Task.', 'Enter a name that identifies the review question.', 'Create an empty task, or use the optional file-import controls to populate it.'] },
      { heading: 'Manage', paragraphs: ['Use task search, tags, and sorting to find a collection. Open it to manage its contents. Deleting a project requires confirmation; check that it is the intended collection.'] },
    ],
  },
  {
    id: 'saved-labels', path: 'guides', group: 'Dashboard',
    title: 'Add, remove, and reopen labeling', summary: 'Maintain the documents in a saved review collection.',
    tags: ['Projects', 'Add to Task', 'Remove from Task', 'saved labels'], action: { href: '/dashboard', label: 'Open My Dashboard' },
    related: ['saved-work', 'project-guide', 'versions', 'highlights-guide'],
    sections: [
      { heading: 'Add', steps: ['From a labeling workspace, open Projects and choose the target collection.', 'From search results, select labeling records and use the available add-to-task action.', 'Open the collection on Dashboard to confirm its contents.'] },
      { heading: 'Reopen or remove', paragraphs: ['Click a saved labeling name to reopen it. Check the displayed version again—saving a set is not the same as pinning a historical document.', 'Use Remove from Task to remove a saved entry. This removes it from the collection, not from the source labeling database.'] },
    ],
  },
  {
    id: 'read-labeling', path: 'guides', group: 'Labeling workspace',
    title: 'Navigate a labeling', summary: 'Find a section, inspect product details, and move through the document.',
    tags: ['navigation', 'Contents', 'Label details', 'Find', 'Focus reading'], action: home,
    related: ['versions', 'highlights-guide', 'notes-guide', 'label-chat-guide', 'label-export-guide'],
    sections: [
      { heading: 'Find your place', table: { columns: ['Control', 'Use it to'], rows: [
        ['Contents', 'Open the section list and jump to a heading. Toggle it off for more reading width.'],
        ['Label details', 'Inspect product metadata. Collapse details to regain space.'],
        ['Browser Find (Ctrl+F / Cmd+F)', 'Find text in the rendered document. Read surrounding text and table footnotes.'],
        ['Focus reading', 'Hide the global navigation while reading; Exit focus restores it.'],
        ['More', 'Find actions that do not fit in the toolbar at the current window width.'],
      ] } },
      { heading: 'Check the document', paragraphs: ['Confirm the product and version before taking notes. The thin progress line shows section position, not review completion.'] },
    ],
  },
  {
    id: 'highlights-guide', path: 'guides', group: 'Labeling workspace',
    title: 'Highlight source text', summary: 'Mark a passage you want to revisit.',
    tags: ['highlight', 'selection', 'color', 'annotation'], action: home,
    related: ['read-labeling', 'notes-guide', 'label-export-guide'],
    sections: [
      { heading: 'Create a highlight', steps: ['Select text within the labeling.', 'Choose Highlight in the selection toolbar, then choose a color.', 'Click the marked passage to inspect it or use Delete to remove the saved annotation.'] },
      { heading: 'Find it again', paragraphs: ['Open Notes in the document toolbar and choose the Highlight entry to return to the passage. Saving annotations requires permission for your account.'] },
    ],
  },
  {
    id: 'notes-guide', path: 'guides', group: 'Labeling workspace',
    title: 'Add comments and find notes', summary: 'Attach a comment to source text; use Notes to revisit it.',
    tags: ['Notes', 'Comment', 'Save', 'annotations', 'QA'], action: home,
    related: ['highlights-guide', 'read-labeling', 'label-chat-guide', 'label-export-guide'],
    sections: [
      { heading: 'Comment on a passage', steps: ['Select the source text and choose Comment in the selection toolbar.', 'Enter your observation and click Save.', 'Click the annotated passage to read the comment or delete it.'] },
      { heading: 'Use the Notes list', table: { columns: ['Entry', 'What it represents'], rows: [
        ['Comment', 'A remark attached to selected source text.'],
        ['Highlight', 'A marked passage.'],
        ['QA', 'A question-and-answer annotation displayed on the document, when present.'],
      ] }, paragraphs: ['Choose an entry to return to its location. Notes lists annotations currently displayed on the document; it is not a separate blank notebook.'] },
    ],
  },
  {
    id: 'label-chat-guide', path: 'guides', group: 'Labeling workspace',
    title: 'Ask AI about the current labeling', summary: 'Use AI Chat alongside the document you are reading.',
    tags: ['AI Chat', 'AI Assistant', 'Reset Chat', 'conversation'], action: home,
    related: ['read-labeling', 'notes-guide', 'evidence-types', 'ai-preferences'],
    sections: [
      { heading: 'Ask and check', steps: ['Open AI Chat from the labeling toolbar.', 'Ask a focused question. For example: “Summarize the monitoring instructions and identify the relevant section.”', 'Find the supporting passage in the document and check the answer against it.'] },
      { heading: 'Manage the conversation', paragraphs: ['Close Chat hides the panel. Reset Chat clears the conversation after confirmation. History is stored in this browser for the labeling set; check the version before continuing an older conversation.', 'Chat history is separate from saved comments and is not included in a section export.'] },
    ],
  },
  {
    id: 'label-export-guide', path: 'guides', group: 'Labeling workspace',
    title: 'Export labeling sections', summary: 'Choose sections and download their content.',
    tags: ['export', 'HTML', 'XML', 'TEXT', 'GENERATE EXPORT FILE'], action: home,
    related: ['read-labeling', 'notes-guide', 'search-results', 'review-record'],
    sections: [
      { heading: 'Export', steps: ['Open Export in the labeling toolbar or More menu.', 'Select the sections you need. Use ALL or CLEAR to adjust the selection.', 'Choose HTML, XML, or TEXT, then click GENERATE EXPORT FILE.'] },
      { heading: 'Check the file', paragraphs: ['Confirm the product, source version, and selected content before using the file. Section exports do not include personal highlights, comments, or chat history.', '“Highlights of Prescribing Information” is a source-document section, not your personal highlighting. Search-result exports are described separately.'] },
    ],
  },
  guide('toolbox-guide', 'Read and preserve evidence', 'Choose tools in Cards or Table view', 'Find an appropriate analysis without losing the labeling context.', [
    'Open Toolbox from the labeling workspace. Use the task-to-tool map below if you are unsure where to start.',
    'Search by tool name or purpose, filter a category, and switch between Cards and Table. Both views share the same filters.',
    'Pin frequently used tools. Table places pinned tools first and lets you sort by name or category; Cards groups tools by workflow.',
    'Open an analysis and confirm its product/version inputs. Use Back to label to return to the source document.',
  ], ['Pins and layout preferences are stored in this browser; do not rely on them as a shared review record.', 'A missing tool may reflect account permission, environment, or an unsuitable labeling context.'], ['tool-selection', 'availability', 'evidence-types']),
  guide('tool-selection', 'Start a review', 'Choose an analysis for your review question', 'Match the task to a tool, then identify the evidence you must verify.', [
    'Locate an exact passage: start with Label View. For structured AE annotations use LabelingAE; for a generated safety profile use PV-Profile and its QC review.',
    'Compare label text: use Compare. Trace available versions with Archived Version Track or FDA Application Profile. Deep Dive provides peer context rather than a substitute for version comparison.',
    'Inspect postmarket report patterns: use FAERS. For organ-focused or pharmacogenomic questions, choose the relevant DILI, DICT, DIRI, or PGx agent.',
    'Review a specific clinical question: use Examine where available. For selected packaging images use Image Analysis or Labeling Visual Review according to the intended task.',
    'Find structurally related products: use Chemical Structure Search; then inspect the resulting labeling and product context.',
  ], ['Check whether an output is original evidence, an annotation, an aggregate, or an AI interpretation.', 'Open label-specific tools from a selected labeling; this handbook does not create a substitute product context.'], ['pv-guide', 'faers-guide', 'compare-guide', 'visual-guide', 'agent-guide']),
  guide('pv-guide', 'Organize safety evidence', 'Generate a PV Profile and review QC findings', 'Use a structured safety profile as an index back to labeling evidence.', [
    'Open PV-Profile from the selected labeling’s Toolbox and confirm the document version before generation.',
    'Review extracted terms, source quotations, section locations, and any reported drug/comparator frequency information.',
    'Run QC Validation where available. Inspect ambiguous terms, excluded candidates, and citation/context findings rather than treating the summary alone as verification.',
    'Return to the original passage to resolve whether the text describes a reaction, an indication, a baseline condition, or another context.',
  ], ['A completed profile or QC run is not a guarantee that every reaction or issue was identified.', 'Save unresolved findings and their source passages for reviewer follow-up.'], ['pv-method', 'frequency-context', 'evidence-types']),
  guide('ae-guide', 'Organize safety evidence', 'Inspect LabelingAE annotations and highlighted terms', 'Connect an annotation or highlighted term to its supporting narrative.', [
    'Open LabelingAE from the labeling context. Use the available List, Section, or Raw JSON views as appropriate.',
    'Filter or select annotations by the controls shown in the viewer. In Section View inspect the selected span and neighboring text.',
    'Check the source document/version and whether a location is confidently aligned. Review overlapping annotations individually.',
    'In Label View, use the displayed SOC/term controls and legend for available highlights; do not assume the same highlighting mechanism in every tool.',
  ], ['Structured tables and narrative formatting can be preserved without reproducing every image or publisher stylesheet.', 'An unhighlighted phrase is not proof that no clinically relevant event is present.'], ['meddra-method', 'annotation-method', 'versions']),
  guide('faers-guide', 'Organize safety evidence', 'Explore FAERS report patterns', 'Inspect report counts and trends while retaining the query and time-window context.', [
    'Open FAERS from the selected labeling. Verify the drug-name query and the available date or report filters.',
    'Inspect the counts, trends, and candidate terms shown by the tool. Check whether a display refers to an overall or recent reporting window.',
    'When an AI interpretation is available, compare it with the underlying displayed terms and query settings.',
    'Return to labeling and other relevant evidence before deciding how a reporting pattern informs the review question.',
  ], ['Retain the query terms, time window, and filters when recording an observation.', 'Use the FAERS interpretation article before comparing counts across products.'], ['faers-method', 'evidence-types', 'review-record']),
  {
    id: 'compare-guide', path: 'guides', group: 'Compare and track changes',
    title: 'Compare labeling documents', summary: 'Read 2–4 labelings side by side and investigate their differences.',
    tags: ['Compare', 'Label Compare', 'diff', 'SPL Set ID', 'JSON', 'clinical summary'],
    related: ['comparison-method', 'history-guide', 'saved-work'],
    action: { href: '/labelcomp', label: 'Open Compare' },
    sections: [
      { heading: 'When to use it', paragraphs: ['Compare wording across products, or examine changes between selected labeling versions. For packaging and artwork, use Visual Review instead.'] },
      { heading: 'Start a comparison', steps: [
        'Open Compare from Toolbox or the tool directory. A selected labeling may already be included.',
        'Click Add Label. Choose labelings from a saved project or enter an SPL Set ID; select 2–4 documents.',
        'Check the products and dates, then launch the comparison. For a historical review, start from version history and confirm the versions loaded.',
      ] },
      { heading: 'Read the results', table: { columns: ['On screen', 'How to use it'], rows: [
        ['Discrepancy Panel', 'Expand a section and read the corresponding text in each column. Boxed warnings appear first.'],
        ['IDENTICAL / CHANGES DETECTED', 'Use these text-comparison flags to locate passages; check full wording and tables.'],
        ['FILTER BY SEVERITY GAP', 'Focus on large text differences. Switch it off to return to all sections; it does not rank clinical severity.'],
        ['Generate Clinical Summary', 'Request an AI summary of differing sections. Verify important statements against the source passages.'],
      ] } },
      { heading: 'Keep the comparison', paragraphs: ['Use Favorite to choose a project, enter a title, and Save to Project. Reopen it from the project’s saved comparisons.', 'Export downloads a JSON file containing comparison text and analysis instructions, not a formatted report or the displayed AI summary. The severity filter does not limit the export.'] },
      { heading: 'Before drawing a conclusion', paragraphs: ['Differences can reflect formulation, indication, document structure, or wording. A highlighted change alone does not establish a new safety finding or product equivalence.'], steps: ['Check document identity and version, and read the surrounding passage.', 'For alignment, filter, and AI-summary limitations, see Interpret labeling differences below.'] },
    ],
  },
  guide('history-guide', 'Comparisons', 'Find archived labeling versions', 'Select available documents for a historical review.', [
    'Open Archived Version Track from the selected labeling.',
    'Inspect the listed document identifiers and dates. Choose the versions needed for your question.',
    'Open the selected documents or launch Compare where offered; confirm the versions actually loaded.',
  ], ['Available records may not cover the complete labeling history. Record missing versions.'], ['versions', 'source-availability', 'compare-guide']),
  guide('application-guide', 'Comparisons', 'Explore an FDA application', 'Find application-linked labeling records for the selected product.', [
    'Open FDA Application Profile from a labeling with an application number.',
    'Check the application identity and inspect the available linked records.',
    'Confirm each document and date before using it in a review or comparison.',
  ], ['Application-linked records do not by themselves establish a complete regulatory history.'], ['versions', 'source-availability', 'compare-guide']),
  guide('visual-guide', 'Compare and track changes', 'Review packaging artwork, confusion, and consistency', 'Choose the right visual-review purpose and inspect the evidence behind findings.', [
    'Open Labeling Visual Review. Choose labeling and a specific image on each required side, or upload artwork and confirm its labeling association.',
    'Use Artwork Comparison for visible changes, Product Confusion for distinguishing features, or Labeling Consistency to compare an image with its own labeling reference.',
    'For product-confusion workflows, check and confirm the identified packaging information before comparison. Other visual-review modes may provide a quick overview before detailed findings.',
    'Inspect numbered findings and their evidence regions. Confirm or dismiss findings, add reviewer notes, and correct inaccurate localization where supported.',
  ], ['Confirm product, strength, route, selected image, and reference version; an upload does not prove its own provenance.', 'Missing carton text alone does not establish a contradiction with labeling. A partial overview does not replace a completed detailed review.'], ['visual-method', 'waiting-results', 'review-record'], { href: '/image-review', label: 'Open Labeling Visual Review' }),
  ...[
    ['agent-guide', 'DILI Agent', 'liver'],
    ['dict-guide', 'DICT Agent', 'cardiac'],
    ['diri-guide', 'DIRI Agent', 'renal'],
    ['pgx-guide', 'PGx Agent', 'pharmacogenomic'],
  ].map(([id, name, topic]) => guide(id, 'Toxicity & pharmacogenomics', `Use ${name}`, `Review ${topic} evidence for the selected labeling.`, [
    `Open ${name} from the selected labeling’s Toolbox.`,
    'Check the product context, returned evidence, and cited sources.',
    'Verify material statements against the labeling and references before recording a conclusion.',
  ], ['Keep source evidence separate from generated interpretation. Resolve unsupported or conflicting findings.'], [id === 'agent-guide' ? 'agent-method' : `${id}-method`, 'evidence-types', 'review-record'])),
  guide('ro2-guide', 'Organize safety evidence', 'Inspect a Rule-of-Two screening result', 'Check the dose and structure inputs before interpreting the displayed quadrant.', [
    'Open Rule of Two for the selected product and inspect the reference, structure, and dose information shown.',
    'Verify the daily-dose value, units, regimen, formulation, and route against the relevant labeling. Review the source sentence and edit the input when justified.',
    'Inspect the displayed lipophilicity method and thresholds. Re-evaluate the result if an input changes.',
  ], ['Record the selected inputs and their sources with the result.', 'Use the methods article to distinguish a screening association from a patient-specific conclusion.'], ['ro2-method', 'review-record']),
  guide('chem-guide', 'Find the right labeling', 'Find structurally related products', 'Search a chemical representation, then review the matched labeling context.', [
    'Open Chemical Structure Search and enter a supported SMILES, InChI, or InChIKey representation.',
    'Choose exact, substructure, or similarity matching. For similarity, inspect the threshold before searching.',
    'Review the matched structures/substances, scores where present, and linked labeling records.',
  ], ['Confirm the intended structure, salt/form, and product context.', 'Structure similarity is a retrieval aid, not a demonstrated shared safety profile.'], ['structure-method', 'search-scope'], { href: '/chemsearch', label: 'Open Chemical Structure Search' }),
  guide('waiting-results', 'Resolve common obstacles', 'Handle waiting, failures, and partial results', 'Keep useful evidence while determining what actually completed.', [
    'Read the task status and current stage. Some engines return their answer only when generation finishes; silence is not proof that the task failed.',
    'For background tasks, return to the available status/results view rather than starting repeated copies while a run remains active.',
    'If detailed visual review fails after an overview, retain the overview as a partial result and identify the missing stage before retrying.',
    'For repeated failures, record the tool, product/version, approximate time, visible message, and task identifier if shown, then contact your installation’s support team.',
  ], ['Do not present a pending, failed, or partial run as a completed analysis.', 'A longer wait limit does not guarantee that the model or all intermediate stages will succeed.'], ['evidence-types', 'visual-method', 'availability']),
  method('versions', 'Sources and scope', 'Identify the document, version, and date', 'A labeling set, a specific document version, and an application are different review objects.', [
    { heading: 'What to identify', paragraphs: ['Use Set ID to identify the labeling set and SPL/document ID when a specific version is required. An application number can relate multiple labeling records; it is not a document-version identifier.'] },
    { heading: 'Dates and coverage', paragraphs: ['Read each date according to its displayed field. Do not substitute a labeling effective date for an approval date, a database refresh date, or the date of your review.', 'DailyMed describes in-use labeling, which can differ from the latest FDA-approved labeling. A label appearing in a repository does not alone establish its approval status.'] },
    { heading: 'Reviewer checks', steps: ['Confirm identifiers on every comparison input and exported record.', 'Keep source/version substitutions or unavailable historical documents explicit in your review record.'] },
  ], ['find-labeling', 'history-guide', 'source-availability'], [dailyMed]),
  {
    id: 'search-scope', path: 'methods', group: 'Sources and scope',
    title: 'Understand search scope and coverage', summary: 'Search database tells you where the search runs and which conditions it supports.',
    tags: ['Local', 'CDER-CBER', 'FDA ver.', 'database scope'], related: ['query-guide', 'manual-query', 'no-results'],
    sections: [
      { heading: 'Compare the scopes', table: { columns: ['Scope', 'Coverage'], rows: [
        ['Local', 'Product metadata. Section criteria are limited to Product Title and Initial U.S. Approval.'],
        ['CDER-CBER', 'Internal human-labeling scope, with supported labeling-text and MedDRA searches.'],
        ['FDA ver.', 'Broader internal scope, including animal and other non-human labeling.'],
      ] } },
      { heading: 'Before interpreting results', paragraphs: ['Your account may have a fixed scope. Confirm the displayed scope and supported conditions; the core workspace is not limited to Local.', 'A match does not establish complete product coverage, approval status, or therapeutic equivalence.'] },
    ],
  },
  {
    id: 'match-expansion', path: 'methods', group: 'Queries and terminology',
    title: 'Understand Exact match and term expansion', summary: 'Check the selected names and terms—not just the phrase you typed.',
    tags: ['Exact match', 'expansion', 'PT', 'LLT', 'equals', 'contains'], related: ['manual-query', 'ai-query', 'meddra-method'],
    sections: [
      { heading: 'Two separate controls', table: { columns: ['Control', 'What it determines'], rows: [
        ['Exact match', 'Whether related entities are added through expansion.'],
        ['Equals / contains / starts-with', 'How an individual identifier condition matches its value.'],
      ] } },
      { heading: 'Inspect the selected list', steps: ['Review brand, ingredient, and generic-name candidates. Remove unintended names.', 'For MedDRA conditions, inspect the selected PT/LLT and any expanded terms.', 'Recheck selections after changing Exact match. Compare expanded and unexpanded searches when the distinction matters.'] },
    ],
  },
  method('no-results', 'Queries and terminology', 'What does no match mean?', 'An empty search or absent highlight is a starting point for checking coverage, not a universal negative finding.', [
    { heading: 'Possible explanations', paragraphs: ['The product or version may be absent, the selected scope may not support the criterion, the wording may differ, or filters may exclude the record. An annotation/highlight adds its own matching and source-availability limits.'] },
    { heading: 'Reviewer checks', steps: ['Check product identity and data scope.', 'Relax filters and inspect resolved names or terms.', 'Search an available source passage directly and record what was and was not examined.'] },
  ], ['search-scope', 'meddra-method', 'find-labeling']),
  method('source-availability', 'Sources and scope', 'Missing documents and source substitutions', 'Distinguish finding a metadata record from obtaining the intended source document.', [
    { heading: 'Availability is separate from identity', paragraphs: ['A result may exist even when this installation cannot supply its full source document or historical artwork. External source links can help investigation but do not prove that the same version is available there.'] },
    { heading: 'Substituted versions', paragraphs: ['Check any source or substituted-version notice. When the review requires a particular historical version, do not silently cite another version as if it were the requested document.'] },
    { heading: 'Reviewer checks', steps: ['Verify document identifiers on external material.', 'Record missing sources and substitutions as limitations of the review.'] },
  ], ['versions', 'read-labeling', 'visual-guide']),
  method('evidence-types', 'AI and verification', 'Separate source evidence from generated interpretation', 'Source text, annotations, calculations, and AI summaries have different evidentiary roles.', [
    { heading: 'Recognize the output', steps: ['Source: a passage, table, image, or record that you can inspect.', 'Extraction or annotation: selected content and assigned labels, which need context checks.', 'Calculation or aggregate: a value produced from inputs, definitions, and filters.', 'AI interpretation: a proposed explanation or synthesis, which needs source verification.'] },
    { heading: 'What fluency does not establish', paragraphs: ['A clear summary can still omit qualifications or include unsupported statements. A matching citation must also support the statement in context. An automated QC pass adds a check; it is not proof of completeness.'] },
    { heading: 'Reviewer checks', steps: ['Trace material claims to the original passage or reference.', 'Check population, dose, timing, negation, comparator, and uncertainty.', 'Document your interpretation separately from generated wording.'] },
  ], ['first-review', 'pv-method', 'comparison-method', 'review-record']),
  method('pv-method', 'AI and verification', 'What PV Profile and QC do—and do not establish', 'A profile organizes candidate safety evidence; QC helps inspect terms and citation support.', [
    { heading: 'Profile and QC roles', paragraphs: ['PV-Profile structures extracted safety terms and their labeling context. The QC workflow examines term appropriateness, excluded candidate terms, ambiguity, and whether quoted evidence supports the proposed interpretation.', 'A term can describe an indication, a pre-existing condition, a measurement, or an adverse reaction. Read the supporting narrative before accepting an extracted classification.'] },
    { heading: 'Boundaries', paragraphs: ['Do not interpret a completed run as proof that all reactions were captured, that every citation was correctly judged, or that the document passed a comprehensive regulatory consistency audit.'] },
    { heading: 'Reviewer checks', steps: ['Review ambiguity and excluded-candidate findings, not only accepted rows.', 'Compare quotations with the original section and record unresolved differences.'] },
  ], ['pv-guide', 'frequency-context', 'meddra-method']),
  method('meddra-method', 'Queries and terminology', 'Interpret MedDRA terms and highlights', 'Terminology structure helps organize concepts; a highlight still needs clinical context.', [
    { heading: 'Hierarchy and display', paragraphs: ['LLTs link to PTs, and SOCs group concepts at a broader level. MedDRA is multiaxial: a term can be linked to more than one SOC. Do not assume an interface’s displayed grouping exhausts every possible relationship.', 'Use the legend of the specific tool. Color is a navigation/annotation aid, not a clinical severity grade or evidence of causality.'] },
    { heading: 'Reviewer checks', steps: ['Inspect the mapped term and its source wording.', 'Check negation, indication, baseline conditions, and neighboring qualifiers.', 'Do not treat an unhighlighted phrase as confirmation that no relevant event exists.'] },
  ], ['ae-guide', 'match-expansion', 'pv-guide'], [meddra]),
  method('annotation-method', 'Queries and terminology', 'Understand annotation locations and original formatting', 'An aligned section view helps inspect source context without promising a facsimile of the published document.', [
    { heading: 'Alignment and rendering', paragraphs: ['The viewer relates annotations to sections and text spans. Section View can retain narrative/table structure without reproducing all original images, layout, or publisher styling. Overlapping annotations can express separate findings.', 'Where a location is uncertain or cannot be aligned, inspect the annotation details and source text instead of assuming the highlighted position is definitive.'] },
    { heading: 'Reviewer checks', steps: ['Confirm the annotation document and requested labeling version match.', 'Read table headers and footnotes as well as the selected span.', 'Use the appropriate source document when visual layout itself matters.'] },
  ], ['ae-guide', 'versions', 'visual-guide']),
  method('frequency-context', 'Interpret safety evidence', 'Read frequencies in their original evidence context', 'A percentage needs its population, denominator, regimen, comparator, and source.', [
    { heading: 'What to preserve', paragraphs: ['An extracted percentage or frequency category does not replace the original table. Retain the trial population, treatment/comparator group, observation period, dose, and qualifying footnotes when they are available. Missing frequency information should remain missing, rather than being interpreted as zero.'] },
    { heading: 'Different sources are not interchangeable', paragraphs: ['Do not mix a trial percentage, a qualitative postmarketing description, and a spontaneous-report count as though they measured the same quantity. A generated frequency category should be checked against its source wording and the tool’s displayed interpretation.'] },
    { heading: 'Reviewer checks', steps: ['Compare the extracted value with the original cell and its column header.', 'Avoid cross-product comparisons without examining the underlying study contexts.'] },
  ], ['pv-guide', 'faers-method', 'evidence-types']),
  method('faers-method', 'Interpret safety evidence', 'Interpret FAERS counts and trends', 'Report patterns can inform investigation; counts alone cannot establish comparative drug safety.', [
    { heading: 'What the source can support', paragraphs: ['FDA describes spontaneous reports as useful for safety surveillance but limited by reporting variability, incomplete information, and other biases. A report does not itself demonstrate that a product caused the event. Report counts are not incidence rates.'] },
    { heading: 'Reviewer checks', steps: ['Retain the drug query, event terms, reporting window, and filters.', 'Interpret any increase with attention to the query definition and reporting context.', 'Seek supporting evidence rather than ranking products by raw counts.'] },
  ], ['faers-guide', 'frequency-context', 'review-record'], [faers]),
  method('comparison-method', 'Comparisons and screening', 'Interpret labeling differences', 'Text alignment helps you find changes; scientific importance requires source review.', [
    { heading: 'How sections are matched', paragraphs: ['Compare reads the available SPL documents and aligns sections by section number for PLR labeling, or normalized title for other formats. Different structures can leave related passages in separate rows. A blank cell is not proof that the topic is absent from the full document.'] },
    { heading: 'What the markings mean', table: { columns: ['Output', 'Meaning and limit'], rows: [
      ['IDENTICAL', 'The normalized text matches. Case, punctuation, and formatting differences may be ignored; this is not a visual comparison.'],
      ['Word highlights', 'For two documents, additions and deletions mark wording differences. For 3–4 documents, read the parallel columns rather than expecting pairwise word highlights.'],
      ['Significant Section Overhaul', 'A large rewrite is shown without word highlights for readability. The label describes text change, not clinical importance.'],
      ['Severity Gap filter', 'Selects sections using text similarity, while retaining boxed warnings. It is most useful with two documents; with 3–4 it does not provide a meaningful severity ranking.'],
    ] } },
    { heading: 'AI summary and saved comparisons', paragraphs: ['AI summaries use the differing sections, independently of the visible severity filter. Large comparisons can exceed the summary limit; Export still lets you retain the comparison text.', 'An existing summary may be reused. Saved comparisons and summary reuse are associated with labeling Set IDs rather than a frozen copy of each version. When reviewing historical changes, confirm the loaded dates and source passages instead of treating a saved comparison or summary as a version-pinned record.'] },
    { heading: 'Reviewer checks', steps: ['For historical changes, confirm both versions and their dates. Across products, check formulation, route, indication, and population.', 'Verify material findings in the original documents, including tables and footnotes. Establish RLD/RS relationships from the appropriate records.'] },
  ], ['compare-guide', 'history-guide', 'versions', 'source-availability']),
  method('visual-method', 'Comparisons and screening', 'Interpret image findings and partial visual reviews', 'Visible artwork, product-confusion concerns, and reference consistency are separate review questions.', [
    { heading: 'Inputs determine the scope', paragraphs: ['Only selected/uploaded images and the supplied labeling references are examined. A visible region cannot establish properties of unseen packaging, physical print size, or an upload’s provenance.'] },
    { heading: 'Stages and localization', paragraphs: ['A quick overview and a detailed finding are different outputs. Some modes can finish with an overview when point-to-point comparison is unsuitable. An overview is not a completed consistency assessment and does not supply validated evidence coordinates.', 'Numbered regions help locate a proposed finding; inspect the actual image and correct localization where supported before accepting it.'] },
    { heading: 'Reviewer checks', steps: ['Confirm product identities, image types, strengths, and reference versions.', 'Distinguish absent text from contradictory text.', 'Preserve confirmed, dismissed, and unresolved findings in the review record.'] },
  ], ['visual-guide', 'waiting-results', 'review-record']),
  {
    id: 'agent-method', path: 'methods', group: 'Toxicity & pharmacogenomics',
    title: 'Interpret DILI Agent results',
    summary: 'Understand how labeling evidence, sentence scores, and section priority produce a DILI concern class.',
    tags: ['DILI Agent', 'liver injury', 'hepatotoxicity', 'severity score', 'Most', 'Less', 'No', 'ALT', 'bilirubin'],
    related: ['agent-guide', 'versions', 'source-availability', 'review-record'],
    sections: [
      { heading: 'What the assessment measures', paragraphs: [
        'DILI Agent asks an AI model to identify liver-related evidence in a labeling document, assign a score to each selected sentence, and produce Most, Less, or No DILI Concern. The conclusion combines the type of liver finding with where it appears in labeling.',
        'This is the application’s labeling-based rubric. A score is not an event rate, probability of injury, or patient-level causality score. A newly generated assessment is not a lookup of an independently established DILIrank classification.',
      ] },
      { heading: 'Which document and sections are read?', paragraphs: [
        'A new assessment looks for the latest labeling document for the Set ID. It reads available Boxed Warning, Contraindications, Warnings and Precautions, Adverse Reactions, Drug Interactions, and Use in Specific Populations sections. Available Highlights of Prescribing Information are also supplied to the model.',
        'This is a selected-section review, not a search of every section, the literature, patient reports, or FAERS. Opening the agent from an older labeling does not pin the assessment to that version. Confirm the source document and date when the version matters.',
      ] },
      { heading: 'Why only a few evidence sentences appear', paragraphs: [
        'The model is instructed to search in this priority order: Boxed Warning → Warnings and Precautions → Contraindications → Adverse Reactions → Drug Interactions → Use in Specific Populations.',
        'Once meaningful evidence is found in a higher-priority section, lower-priority evidence is normally omitted. The report is limited to three evidence items in total and two from any one section. Repeated sentences are omitted; a sentence with several relevant findings receives the highest applicable score.',
        'The displayed evidence is therefore a selected explanation of the conclusion, not a complete inventory of hepatic findings. For example, a boxed-warning finding can explain why the report does not also list liver-enzyme findings from Adverse Reactions.',
      ] },
      { heading: 'Read the sentence score: 0–8', paragraphs: [
        'The table below reproduces the application’s scoring instructions. The numbers are categories in this rubric, not a validated clinical severity scale; a higher number does not mean a proportionally higher risk.',
      ], table: { columns: ['Score', 'Finding used by the rubric', 'What to check in the sentence'], rows: [
        ['8', 'Fatal liver failure, death associated with liver failure, or liver transplantation', 'The fatal outcome or transplantation must relate to hepatic injury, not an unrelated event.'],
        ['7', 'Acute liver failure, liver/hepatic failure, or fulminant hepatic necrosis', 'Check whether the text describes a treatment-associated outcome or a pre-existing condition.'],
        ['6', 'Histologically confirmed liver necrosis', 'Check that necrosis is actually stated and supported by the quoted context.'],
        ['5', 'Clinically apparent jaundice', 'Distinguish a reported clinical finding from a hypothetical symptom patients are told to watch for.'],
        ['4', 'Elevated bilirubin without visible jaundice', 'Check the population, threshold, and any alternative context supplied by the labeling.'],
        ['3', 'Abnormal liver function tests or increased ALT, AST, or transaminases', 'Read the magnitude, frequency, comparator, and accompanying findings when provided.'],
        ['2', 'Cholestasis, hepatitis, steatohepatitis, or liver damage/toxicity', 'This rubric places these terms below enzyme increases; do not read that ordering as a general clinical judgment.'],
        ['1', 'Steatosis or fatty liver', 'Check whether this is a drug-related finding or the condition being treated.'],
        ['0', 'Pre-existing condition, patient history, or contraindication context', 'Mentioning hepatic disease does not by itself mean the drug caused it. Read what the restriction actually says.'],
      ] } },
      { heading: 'How Most, Less, and No are assigned', paragraphs: [
        'The class is not calculated by adding scores or taking their average. Section location changes the result. If every identified item is only a pre-existing-condition finding (score 0), the instructed outcome is No DILI Concern.',
      ], table: { columns: ['Conclusion', 'Instruction given to the model'], rows: [
        ['Most DILI Concern', 'Relevant evidence in Boxed Warning, or evidence scored 4–8 in Warnings and Precautions.'],
        ['Less DILI Concern', 'Evidence scored 1–3 in Warnings and Precautions, or relevant evidence in lower-priority sections.'],
        ['No DILI Concern', 'No DILI-related evidence identified in the supplied material, or all findings exclusively describe pre-existing conditions (score 0).'],
      ] }, steps: [
        'Locate the evidence section, then read the assigned sentence score.',
        'Check whether the quoted text describes a drug-related finding rather than history, an indication, a negation, or a precaution alone.',
        'Compare the conclusion with the rule above. The model generates both the score and conclusion; the report is not proof that the rule was followed correctly.',
      ] },
      { heading: 'Worked examples', paragraphs: ['These are illustrative sentences, not findings about a particular drug.'], table: { columns: ['Evidence and location', 'Expected reading under this rubric'], rows: [
        ['“Elevations in ALT were observed” in Warnings and Precautions', 'Score 3 → Less DILI Concern, if the surrounding text supports a relevant treatment-associated finding.'],
        ['The same ALT finding in Boxed Warning', 'Score 3 → Most DILI Concern because boxed-warning placement changes the class.'],
        ['A bilirubin increase without jaundice in Warnings and Precautions', 'Score 4 → Most DILI Concern. Confirm the actual passage supports that finding.'],
        ['Hepatic failure reported only in Adverse Reactions', 'The sentence can receive score 7 while the section-based conclusion remains Less DILI Concern. Less does not mean the reported outcome is mild.'],
        ['Only a history of liver disease is mentioned', 'Score 0 → No DILI Concern if all identified evidence is exclusively pre-existing disease. This does not establish that the drug is free of hepatic risk.'],
      ] } },
      { heading: 'Read the evidence, summary, and class together', paragraphs: [
        'Highlighted terms identify what the model used; the quoted sentence provides context; the score labels the finding; the summary explains the selected evidence; and the final class applies the section-based rule. Start with the sentence rather than accepting the colored class badge alone.',
        'If the badge, written conclusion, and evidence disagree, keep the disagreement explicit. The application extracts the stored class from generated text, and an unrecognized conclusion can currently be stored as No. An empty, malformed, failed, or unsupported assessment must not be interpreted as a negative safety finding.',
      ] },
      { heading: 'Existing records and new assessments', paragraphs: [
        'Assessment Records may show a stored result rather than a newly run analysis. Check the model and assessment date where displayed, and distinguish the assessment date from the labeling effective date. Run New Assessment requests another analysis of the available labeling; it does not collect new clinical evidence.',
        'A rerun may change because the labeling, model, or generated interpretation changed. Preserve the evidence sentences, their sections, and the document identifiers alongside the conclusion when recording a review finding.',
      ] },
    ],
  },
  {
    "id": "dict-guide-method",
    "path": "methods",
    "group": "Toxicity & pharmacogenomics",
    "title": "Interpret DICT Agent results",
    "summary": "Read cardiac evidence levels and understand how section location changes the concern class.",
    "tags": [
      "DICT Agent",
      "cardiac",
      "QT",
      "LVEF",
      "Severe",
      "Moderate",
      "Mild"
    ],
    "related": [
      "dict-guide",
      "versions",
      "review-record"
    ],
    "sections": [
      {
        "heading": "What the result measures",
        "paragraphs": [
          "DICT Agent identifies cardiac evidence in selected labeling sections, assigns Severe, Moderate, Mild, or 0 to each selected sentence, and generates Most, Less, or No DICT Concern. These are the application\u2019s labeling-based categories, not event rates, validated patient-level risk scores, or a causal assessment."
        ]
      },
      {
        "heading": "Source document and evidence selection",
        "paragraphs": [
          "A new assessment seeks the latest available labeling for the Set ID. It reads Boxed Warning, Contraindications, Warnings and Precautions, Adverse Reactions, Drug Interactions, and Use in Specific Populations, plus available Highlights. It does not pin itself to a historical version previously opened in Label View.",
          "Evidence priority is Boxed Warning > Warnings and Precautions > Contraindications > Adverse Reactions > Drug Interactions > Use in Specific Populations. The model is instructed to retain only the highest-priority section containing meaningful evidence, normally omitting lower-priority sections.",
          "The report contains at most three evidence items, with at most two from one section. A sentence with several findings receives its highest applicable level. The displayed list is selected support for the conclusion, not an exhaustive list of findings."
        ]
      },
      {
        "heading": "Read the evidence level",
        "paragraphs": [
          "The following terms come from the current scoring instructions. Their placement is specific to this rubric; it is not a general ranking of clinical seriousness."
        ],
        "table": {
          "columns": [
            "Level",
            "Heart damage / hemodynamic findings",
            "Arrhythmia findings"
          ],
          "rows": [
            [
              "Severe",
              "Death or transplantation related to cardiac injury; myocardial infarction, cardiac failure/CHF, cardiomyopathy, myocarditis, reduced LVEF/ejection fraction, LV dysfunction, cardiac tamponade, coronary artery disease, myocardial ischemia, cardiogenic shock, valvular heart disease.",
              "Cardiac arrest, Torsade de Pointes, third-degree AV block, ventricular fibrillation, Brugada syndrome."
            ],
            [
              "Moderate",
              "Angina, pericarditis, pericardial effusion, mitral valve regurgitation, valve thickening, cardio spasm.",
              "Ventricular or supraventricular tachycardia, long QT syndrome, QT prolongation, ventricular arrhythmias."
            ],
            [
              "Mild",
              "Hypotension, hypertension.",
              "First- or second-degree AV block, atrial fibrillation, tachycardia, bradycardia, palpitations, sinus node dysfunction."
            ],
            [
              "0",
              "Pre-existing disease, history, contraindication context, or baseline risk factors.",
              "Check whether the passage describes an existing condition rather than a treatment-associated finding."
            ]
          ]
        }
      },
      {
        "heading": "How the concern class is assigned",
        "paragraphs": [
          "The class combines the evidence level and section; it is not an average of sentence levels. Exclusively pre-existing-condition evidence (level 0) is instructed to produce No DICT Concern."
        ],
        "table": {
          "columns": [
            "Class",
            "Rule"
          ],
          "rows": [
            [
              "Most DICT Concern",
              "Relevant evidence in Boxed Warning, or Severe evidence in Warnings and Precautions."
            ],
            [
              "Less DICT Concern",
              "Moderate or Mild evidence in Warnings and Precautions, or relevant evidence in lower-priority sections."
            ],
            [
              "No DICT Concern",
              "No cardiac evidence identified in the supplied material, or all evidence exclusively describes pre-existing conditions."
            ]
          ]
        }
      },
      {
        "heading": "Worked examples",
        "paragraphs": [
          "These examples illustrate the application\u2019s rules, not findings about a particular drug."
        ],
        "table": {
          "columns": [
            "Passage and section",
            "Expected interpretation"
          ],
          "rows": [
            [
              "QT prolongation in Warnings and Precautions",
              "Moderate -> Less DICT Concern. The class does not say whether an individual patient will develop an arrhythmia."
            ],
            [
              "The same QT finding in Boxed Warning",
              "Moderate -> Most DICT Concern because section placement changes the class."
            ],
            [
              "Reduced LVEF attributed to treatment in Warnings and Precautions",
              "Severe -> Most DICT Concern. Check the actual LVEF change and study context."
            ],
            [
              "Cardiac failure reported only in Adverse Reactions",
              "Severe evidence can still yield Less DICT Concern under the section rule. Less does not mean a mild outcome."
            ],
            [
              "Only a history of heart failure is described",
              "Level 0 -> No DICT Concern if all identified evidence is baseline disease. It does not establish cardiac safety."
            ]
          ]
        }
      },
      {
        "heading": "What to verify in the source",
        "steps": [
          "For QT findings, check the measured change, exposure, population, co-medications, and whether clinical arrhythmias are actually reported. Do not equate a QT finding with a reported Torsade de Pointes event.",
          "For LVEF or failure findings, distinguish a measurement change, diagnosed dysfunction, and symptomatic failure; read monitoring and treatment instructions in context.",
          "Check negation and attribution. A screening instruction or baseline exclusion criterion is different from a treatment-associated event. Follow the original labeling for any stated action."
        ]
      },
      {
        "heading": "Stored results, reruns, and conflicting output",
        "paragraphs": [
          "Assessment Records can contain previously generated results. Check the assessment date and model where available; the assessment date is different from the labeling effective date. Run New Assessment requests another analysis of available labeling, rather than collecting new patient or literature evidence.",
          "The AI assigns the evidence level and writes the conclusion; the application then extracts the stored class from that text. An unrecognized conclusion can currently be stored as No. If the badge, conclusion, and quoted evidence disagree, record the inconsistency and verify the source. A failure, missing source, or unsupported conclusion is not a negative finding.",
          "Preserve the evidence passage, section, document identity, assessment date, and unresolved questions. Repeated assessments are not guaranteed to create separate records: a result from the same day and model can replace the existing result."
        ]
      }
    ]
  },
  {
    "id": "diri-guide-method",
    "path": "methods",
    "group": "Toxicity & pharmacogenomics",
    "title": "Interpret DIRI Agent results",
    "summary": "Separate renal findings, evidence levels, and the section-based concern class.",
    "tags": [
      "DIRI Agent",
      "renal",
      "Certain",
      "Possible",
      "AKI",
      "creatinine",
      "GFR"
    ],
    "related": [
      "diri-guide",
      "versions",
      "review-record"
    ],
    "sections": [
      {
        "heading": "What Certain and Possible mean here",
        "paragraphs": [
          "DIRI Agent assigns Certain, Possible, or 0 to selected renal evidence sentences, then generates Most, Less, or No DIRI Concern. Certain and Possible are names in the application\u2019s term-based rubric. They are not measured confidence, probabilities, or proof that a drug caused an individual patient\u2019s renal injury."
        ]
      },
      {
        "heading": "Source document and evidence selection",
        "paragraphs": [
          "A new assessment seeks the latest available labeling for the Set ID. It reads Boxed Warning, Contraindications, Warnings and Precautions, Adverse Reactions, Drug Interactions, and Use in Specific Populations, plus available Highlights. It does not pin itself to a historical version previously opened in Label View.",
          "Evidence priority is Boxed Warning > Warnings and Precautions > Contraindications > Adverse Reactions > Drug Interactions > Use in Specific Populations. The model is instructed to retain only the highest-priority section containing meaningful evidence, normally omitting lower-priority sections.",
          "The report contains at most three evidence items, with at most two from one section. A sentence with several findings receives its highest applicable level. The displayed list is selected support for the conclusion, not an exhaustive list of findings."
        ]
      },
      {
        "heading": "Read the evidence level",
        "table": {
          "columns": [
            "Level",
            "Terms used by the rubric",
            "Interpretation check"
          ],
          "rows": [
            [
              "Certain",
              "Renal failure, AKI, anuria, nephrotoxicity/renal toxicity, glomerulonephritis, acute tubular necrosis, drug-secondary CKD, interstitial nephritis, nephropathy, nephrotic syndrome, nephritis, Fanconi syndrome, rhabdomyolysis-induced renal failure.",
              "Read the diagnosis, attribution, timing, and context. A term match alone does not confirm drug causality."
            ],
            [
              "Possible",
              "Elevated creatinine, reduced creatinine clearance/GFR, proteinuria, albuminuria, hematuria, oliguria, hyperkalemia, pyuria, urinary casts, increased BUN, nephrolithiasis, renal impairment/insufficiency/dysfunction, azotemia, renal tubular acidosis, renal function deterioration.",
              "These can include substantial findings. Possible is the tool\u2019s category, not a statement that the finding is mild or unimportant."
            ],
            [
              "0",
              "History or baseline renal impairment.",
              "Distinguish pre-existing disease and altered drug clearance from a finding of treatment-associated injury."
            ]
          ]
        }
      },
      {
        "heading": "How the concern class is assigned",
        "paragraphs": [
          "Scores are not added. The section and evidence level jointly determine the instructed class; exclusively baseline-condition evidence is assigned No DIRI Concern."
        ],
        "table": {
          "columns": [
            "Class",
            "Rule"
          ],
          "rows": [
            [
              "Most DIRI Concern",
              "Relevant evidence in Boxed Warning, or Certain evidence in Warnings and Precautions."
            ],
            [
              "Less DIRI Concern",
              "Possible evidence in Warnings and Precautions, or relevant evidence in lower-priority sections."
            ],
            [
              "No DIRI Concern",
              "No renal-injury evidence identified in the supplied material, or all evidence exclusively describes pre-existing conditions."
            ]
          ]
        }
      },
      {
        "heading": "Worked examples",
        "paragraphs": [
          "These illustrate the rubric and are not findings about a named drug."
        ],
        "table": {
          "columns": [
            "Passage and section",
            "Expected interpretation"
          ],
          "rows": [
            [
              "Treatment-associated creatinine increase in Warnings and Precautions",
              "Possible -> Less DIRI Concern. Check magnitude, baseline, reversibility, and associated findings."
            ],
            [
              "The same creatinine finding in Boxed Warning",
              "Possible -> Most DIRI Concern because of section placement."
            ],
            [
              "Acute kidney injury associated with treatment in Warnings and Precautions",
              "Certain -> Most DIRI Concern, without establishing patient-level causality."
            ],
            [
              "Renal failure reported only in Adverse Reactions",
              "Certain evidence can yield Less DIRI Concern. The section-based class does not downgrade the seriousness of renal failure."
            ],
            [
              "A passage only describes pre-existing renal impairment",
              "Level 0 -> No DIRI Concern if no other relevant evidence is identified. A renal dose adjustment alone does not establish drug-induced injury."
            ]
          ]
        }
      },
      {
        "heading": "What to verify in the source",
        "steps": [
          "Read whether renal impairment is a baseline population, a reason for dose adjustment, or a newly reported outcome.",
          "Check creatinine/GFR units, baseline, change over time, population, and any concomitant drugs or other explanations supplied in the labeling.",
          "Separate biomarker changes from a stated diagnosis, and distinguish monitoring advice from evidence that injury occurred. Use the source wording when recording a finding."
        ]
      },
      {
        "heading": "Stored results, reruns, and conflicting output",
        "paragraphs": [
          "Assessment Records can contain previously generated results. Check the assessment date and model where available; the assessment date is different from the labeling effective date. Run New Assessment requests another analysis of available labeling, rather than collecting new patient or literature evidence.",
          "The AI assigns the evidence level and writes the conclusion; the application then extracts the stored class from that text. An unrecognized conclusion can currently be stored as No. If the badge, conclusion, and quoted evidence disagree, record the inconsistency and verify the source. A failure, missing source, or unsupported conclusion is not a negative finding.",
          "Preserve the evidence passage, section, document identity, assessment date, and unresolved questions. Repeated assessments are not guaranteed to create separate records: a result from the same day and model can replace the existing result."
        ]
      }
    ]
  },
  {
    "id": "pgx-guide-method",
    "path": "methods",
    "group": "Toxicity & pharmacogenomics",
    "title": "Interpret PGx Agent results",
    "summary": "Trace biomarker candidates to labeling evidence and understand the Actionable and Informational labels.",
    "tags": [
      "PGx Agent",
      "biomarker",
      "Actionable PGx",
      "Informational PGx",
      "FDA table",
      "cache"
    ],
    "related": [
      "pgx-guide",
      "versions",
      "review-record"
    ],
    "sections": [
      {
        "heading": "What the agent produces",
        "paragraphs": [
          "PGx Agent identifies candidate biomarkers, asks AI to interpret their relevance in labeling, and returns a summary for each retained biomarker. Its categories are Actionable PGx, Informational PGx, and No Biomarkers Found; it does not use the organ-toxicity agents\u2019 Most/Less/No rubric.",
          "Candidates cover metabolism enzymes, HLA associations, transporters, and target biomarkers. A biomarker mention can concern metabolism, safety, dosing, treatment selection, or efficacy; it is not necessarily a toxicity finding or an inherited variant."
        ]
      },
      {
        "heading": "Where candidates come from",
        "table": {
          "columns": [
            "Input",
            "Role in the assessment"
          ],
          "rows": [
            [
              "Labeling text",
              "A synonym dictionary scans selected sections for biomarker names. Alternate terms are normalized to canonical names, for example OATP1B1 to SLCO1B1. A text match is a candidate, not confirmation of clinical action."
            ],
            [
              "Local FDA PGx table reference",
              "The application looks for expected biomarkers by drug name in its imported reference data. Matching can fall back to the first word of a multiword name; verify combination-product and name matches. This is not a live FDA lookup."
            ],
            [
              "AI review",
              "The model receives candidates, expected table entries, and labeling text. It is asked to extract evidence, identify the section, and explain the clinical implication. The response still requires source verification."
            ]
          ]
        }
      },
      {
        "heading": "Which labeling is examined?",
        "paragraphs": [
          "Without a reusable cached result, the agent seeks the latest available document for the Set ID. It supplies Indications and Usage, Dosage and Administration, Contraindications, Boxed Warning, Warnings and Precautions, Clinical Pharmacology, Pharmacogenomics, Clinical Studies, Description, Drug Interactions, Use in Specific Populations, and available Highlights.",
          "It does not automatically analyze every section, external literature, genetic test results, or a patient genotype. Starting from an archived document does not pin the assessment to that version."
        ]
      },
      {
        "heading": "Read each biomarker entry",
        "table": {
          "columns": [
            "Field or text",
            "Meaning and check"
          ],
          "rows": [
            [
              "Biomarker name",
              "The normalized candidate. Confirm the exact allele, mutation, phenotype, tumor marker, or enzyme context in the source. Broad gene names can hide important distinctions."
            ],
            [
              "Clinical summary",
              "AI interpretation of relevance and potential implications. Separate an explicit labeling instruction from a background association or metabolism statement."
            ],
            [
              "Label section and evidence quotation",
              "The proposed source location and excerpt. Find the passage in the document; section defaults or incomplete quotations can be misleading."
            ],
            [
              "FDA PGx Table: Yes / reference note",
              "A claimed reference association, not a universal requirement to test or adjust treatment. AI-supplied membership flags are not independently rechecked for every retained entry."
            ],
            [
              "Listed in FDA Table, but no explicit dosing guidance found",
              "An expected reference biomarker was not retained as a confirmed text finding. It is appended as an unconfirmed note, without an evidence quotation; it must not be presented as confirmed guidance from this labeling."
            ]
          ]
        }
      },
      {
        "heading": "How Actionable and Informational are assigned",
        "paragraphs": [
          "For a newly processed result, the application checks retained valid entries for specific words in the section and summary. The class is therefore a text-based indicator, not a complete guideline assessment."
        ],
        "table": {
          "columns": [
            "Class",
            "Current rule and limitation"
          ],
          "rows": [
            [
              "Actionable PGx",
              "At least one valid entry contains contraindication, boxed warning, black box, dose reduction, adjust dose, or avoid in its section/summary. A section name alone can trigger this label; negation and the precise clinical instruction are not separately evaluated by this rule."
            ],
            [
              "Informational PGx",
              "At least one valid biomarker entry is retained, but none triggers those keywords. Explicit guidance expressed in other words can be missed, so Informational does not establish that no action is described."
            ],
            [
              "No Biomarkers Found",
              "No valid entries remain, or the scan ends early for lack of candidates or relevant text. Unconfirmed FDA-table notes can still be displayed; read them separately."
            ]
          ]
        }
      },
      {
        "heading": "Worked examples",
        "paragraphs": [
          "These examples describe processing behavior, not drug-specific recommendations."
        ],
        "table": {
          "columns": [
            "Result",
            "How to read it"
          ],
          "rows": [
            [
              "An enzyme is described only as metabolizing the drug",
              "A mention is not by itself genotype-based dosing or a testing requirement. Verify whether the passage addresses genetic variation or only enzyme inhibition/induction."
            ],
            [
              "A biomarker entry cites Contraindications",
              "The section name can trigger Actionable PGx. Read the exact population, allele/phenotype, and instruction rather than relying on the class."
            ],
            [
              "A tumor biomarker is mentioned for patient selection",
              "Check the exact mutation/expression criterion and indication. Do not treat all biomarkers as inherited drug-metabolism variants."
            ],
            [
              "Only an FDA Table Reference note appears",
              "The reference expected the biomarker, but current-text confirmation is missing. It can coexist with No Biomarkers Found."
            ],
            [
              "\u201cBiomarker mention detected in label text\u201d with no evidence quote",
              "This can be a fallback after the AI response could not be parsed. It confirms a dictionary match, not a completed clinical interpretation."
            ]
          ]
        }
      },
      {
        "heading": "Empty results and incomplete interpretation",
        "paragraphs": [
          "If no dictionary candidates and no expected reference entries are found, the agent can return No Biomarkers Found without calling AI. Unknown synonyms, drug-name mismatches, missing reference data, and section coverage can all limit detection.",
          "If AI returns an unusable structured response, the application can retain detected candidates as generic informational entries. Missing quotes and generic mention-only text require a return to the labeling; they do not provide an independently supported clinical conclusion."
        ]
      },
      {
        "heading": "Stored results and the Run New Assessment button",
        "paragraphs": [
          "PGx results are cached by Set ID and can be returned before the current labeling is read. The current Run New Assessment button does not request a forced cache refresh, so it may return the same stored result. A current on-screen date does not prove the biomarker analysis was regenerated.",
          "Review the source document and available stored assessment metadata. Preserve the biomarker, exact variant/phenotype, quoted passage, section, and source date; do not infer a testing requirement, dose change, or treatment choice from the class badge alone."
        ]
      }
    ]
  },
  method('ro2-method', 'Comparisons and screening', 'Understand Rule-of-Two screening', 'Review the association, inputs, and scope behind a displayed screening quadrant.', [
    { heading: 'Method context', paragraphs: ['Chen et al. studied daily dose and lipophilicity in oral medications. The reported rule used daily dose of at least 100 mg and logP of at least 3. This association is a screening context, not a patient-specific prediction or proof of a drug’s causal role in an injury.'] },
    { heading: 'Application inputs', paragraphs: ['Check the actual thresholds and lipophilicity method displayed by the application. A computed ALogP value, selected structure, or extracted maximum daily dose needs its own source and assumptions; do not silently substitute one input definition for another.'] },
    { heading: 'Reviewer checks', steps: ['Verify route, daily-dose units, regimen, formulation, and source sentence.', 'Record corrections and examine how the result changes with the inputs.'] },
  ], ['ro2-guide', 'agent-method', 'review-record'], [ro2]),
  method('structure-method', 'Comparisons and screening', 'Interpret chemical-structure matches', 'Exact, substructure, and similarity searches answer different retrieval questions.', [
    { heading: 'Meaning of a match', paragraphs: ['Exact matching, substructure matching, and thresholded similarity are distinct operations. A similarity score reflects the representation and method used by the search, not a probability of shared clinical effects.'] },
    { heading: 'Reviewer checks', steps: ['Verify the intended structure and substance/product association.', 'Retain match mode and threshold.', 'Review relevant labeling and other evidence before making a class-wide safety inference.'] },
  ], ['chem-guide', 'agent-method', 'search-scope']),
  method('review-record', 'Traceability and reproducibility', 'Keep a traceable review record', 'Preserve enough context for another reviewer to understand what you examined and why.', [
    { heading: 'Record the work', steps: ['Review question, product identity, relevant Set ID/document ID, and selected versions.', 'Database scope, search conditions, Exact match/expansion choices, active filters, and query code when available.', 'Original passages, table context, image references, or citations supporting each observation.', 'Tool and analysis date, displayed model/source information where available, task status, and unresolved limitations.', 'Reviewer interpretation, corrections, and follow-up decisions, kept separate from AI-generated text.'] },
    { heading: 'Re-running is not freezing', paragraphs: ['A saved query or browser preference does not freeze source data or model output. Keep versioned source identifiers and exported evidence. If the application does not expose a needed provenance field, record that gap and consult support rather than inventing a value.'] },
  ], ['saved-work', 'query-codes', 'versions']),
  method('availability', 'Sources and scope', 'Why a tool or data scope may be unavailable', 'Feature visibility reflects the installation, account permissions, and selected product context.', [
    { heading: 'Common reasons', paragraphs: ['A tool can require a particular deployment capability, account permission, or labeling identifier. For example, an application-linked tool needs a suitable application number. Missing tools are not evidence that the product has no relevant safety information.'] },
    { heading: 'Reviewer action', steps: ['Start from the selected labeling’s Toolbox or the available tool directory.', 'Check your account and the product context.', 'Contact your installation’s support team with the task you need to complete; no deployment knowledge is required.'] },
  ], ['account-access', 'toolbox-guide', 'waiting-results']),
];

/** One owner per tool article; names come from the product catalog. */
const ARTICLE_TO_TOOL: Record<string, string> = {
  'compare-guide': 'labelcomp', 'comparison-method': 'labelcomp',
  'visual-guide': 'label-image-review', 'visual-method': 'label-image-review',
  'history-guide': 'label-history-set-id', 'application-guide': 'label-history-application',
  'pv-guide': 'label-pv-profile', 'pv-method': 'label-pv-profile', 'frequency-context': 'label-pv-profile',
  'ae-guide': 'label-labeling-ae', 'annotation-method': 'label-labeling-ae',
  'faers-guide': 'label-faers', 'faers-method': 'label-faers',
  'agent-guide': 'label-tox-dili', 'agent-method': 'label-tox-dili',
  'dict-guide': 'label-tox-dict', 'dict-guide-method': 'label-tox-dict',
  'diri-guide': 'label-tox-diri', 'diri-guide-method': 'label-tox-diri',
  'pgx-guide': 'label-tox-pgx', 'pgx-guide-method': 'label-tox-pgx',
  'ro2-guide': 'label-ro2', 'ro2-method': 'label-ro2',
  'chem-guide': 'chemsearch', 'structure-method': 'chemsearch',
};
const TOOL_CATEGORIES: Record<string, string> = {
  comparison: 'Comparisons', safety: 'Safety evidence',
  toxicity: 'Toxicity & pharmacogenomics', review: 'Clinical review',
};
export function toolName(article: WikiArticle): string | undefined {
  return TOOLS.find(tool => tool.id === article.toolId)?.name;
}
export const ARTICLES: WikiArticle[] = CONTENT.map(article => {
  const toolId = ARTICLE_TO_TOOL[article.id];
  if (!toolId) return article;
  const tool = TOOLS.find(item => item.id === toolId)!;
  return { ...article, toolId, group: TOOL_CATEGORIES[tool.toolboxWorkflow || ''] || 'Discovery' };
});

/** Every old topic has a destination, including the retired device entry. */
export const LEGACY_TOPICS: Record<string, string> = {
  '1-1-account-login': 'account-access', '1-2-personal-dashboard': 'saved-work',
  '2-1-quick-search': 'find-labeling', '2-2-plain-language-search': 'ai-query', '2-3-reading-label': 'read-labeling',
  '3-1-qb-market-filters': 'manual-query', '3-2-qb-dosage-routes': 'manual-query', '3-3-qb-safety-sections': 'manual-query',
  '3-4-ai-quick-search': 'ai-query', '3-5-portable-query-codes': 'query-codes', '3-6-external-ai-query': 'ai-query',
  '3-7-scope-and-expansion': 'search-scope', '3-8-result-filters': 'search-results',
  '4-1-export-excel': 'search-results', '4-2-task-organization': 'project-guide',
  '5-1-ae-viewer': 'ae-guide', '5-2-meddra-highlighting': 'meddra-method',
  '6-1-pv-evidence-grid': 'pv-guide', '6-2-pv-qc-audit': 'pv-method',
  '7-1-labelcomp-rld': 'compare-guide', '7-2-labelcomp-history': 'history-guide', '7-3-labelcomp-ai-summary': 'compare-guide',
  '7-4-labeling-visual-review': 'visual-guide', '8-1-drugtox-overview': 'agent-guide', '8-2-dili-ro2': 'ro2-guide',
  '9-1-chemsearch-similarity': 'chem-guide', '10-1-device-clearances-recalls': 'availability', '11-1-reviewer-faq': 'waiting-results',
};
export function searchableText(article: WikiArticle): string {
  return [article.title, article.summary, article.group, toolName(article) || '', ...article.tags,
    ...article.sections.flatMap(section => [section.heading, ...(section.paragraphs || []), ...(section.steps || []), ...(section.table?.columns || []), ...(section.table?.rows.flat() || [])])].join(' ').toLowerCase();
}
