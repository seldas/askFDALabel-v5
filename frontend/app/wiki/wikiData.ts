/** Reviewer-facing knowledge: product workflows and evidence interpretation. */
export type ReadingPath = 'guides' | 'methods';
export interface WikiSection { heading: string; paragraphs?: string[]; steps?: string[]; }
export interface WikiArticle {
  id: string; path: ReadingPath; group: string; title: string; summary: string;
  tags: string[]; sections: WikiSection[]; related: string[];
  action?: { href: string; label: string };
  references?: { title: string; href: string }[];
}
export const PATHS = {
  guides: { title: 'Complete a review task', short: 'Guides', description: 'Find the right labeling, examine evidence, and preserve your review.' },
  methods: { title: 'Understand data & results', short: 'Data & methods', description: 'Understand sources, analytical outputs, uncertainty, and verification.' },
};
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
export const ARTICLES: WikiArticle[] = [
  guide('first-review', 'Start a review', 'Your first labeling review', 'A practical route from a safety question to a saved, traceable observation.', [
    'Write a focused review question: which product, population, safety topic, and version are relevant?',
    'Search for the product and inspect the identifiers, dosage form, route, application number, and available version before opening a result.',
    'In Label View, expand Label details when needed and use Contents to locate the relevant section. Read surrounding paragraphs, tables, and footnotes.',
    'Open Toolbox and choose an analysis suited to the question. Keep the original document available while examining extracted or generated output.',
    'Record the finding, the source passage and version, any uncertainty, and your next verification step. Save notes or export the relevant evidence where available.',
  ], ['Check that the quoted passage supports the observation in its original context.', 'Distinguish your interpretation from source text and AI-generated suggestions.'], ['versions', 'evidence-types', 'toolbox-guide', 'review-record'], home),
  guide('account-access', 'Start a review', 'Accounts and available features', 'Understand personal accounts, guest browsing, and why tools may differ between users.', [
    'Use the account menu to sign in. If your deployment offers institutional sign-in, follow that option; its credentials are managed by the institution.',
    'Use a personal account for features that save per-account review state. Guest access is shared and does not offer the same saved preferences or personal records.',
    'If a tool is missing, check the available tool directory and the selected labeling. Contact your administrator if the feature is required for your work.',
  ], ['Do not assume a colleague has the same tools, database scope, or saved records.', 'For institutional sign-in, use the identity provider’s password-management process.'], ['availability', 'ai-preferences', 'saved-work'], { href: '/dashboard', label: 'Open My Dashboard' }),
  guide('find-labeling', 'Find the right labeling', 'Find labeling by name or identifier', 'Use a brand, ingredient, NDC, or application number, then confirm the matched product.', [
    'Enter the identifying information you have in the home search or Query Builder. Choose the available database scope.',
    'Inspect matched names and identifiers. Narrow by product category, route, dosage form, or other available criteria when needed.',
    'Open the intended result and confirm its application, product presentation, and version. Similar names are not sufficient to establish equivalence.',
  ], ['A returned record is a match within the selected data scope, not proof that every relevant product was retrieved.', 'Record the scope and criteria if the search supports a review conclusion.'], ['search-scope', 'versions', 'query-guide'], home),
  guide('query-guide', 'Find the right labeling', 'Build and check a structured search', 'Combine product, market, route, dosage, class, and supported section criteria.', [
    'Choose the database scope before assembling criteria. Available criteria differ between Local and internal scopes.',
    'Add product identifiers and the appropriate market, dosage-form, route, or EPC conditions. Inspect candidate lists and selected values.',
    'Use AND/OR groups deliberately. For a combination-product question, check whether the conditions require both ingredients or either ingredient.',
    'For a safety-text question, select a supported section and review the resolved terms. Inspect Exact match and any related-name or MedDRA expansion.',
    'Run the search, check filtered versus underlying totals, and inspect representative matches in the original labeling.',
  ], ['A zero-result search needs a scope, terminology, and filter check before it can support a conclusion.', 'Retain a query code and the version identifiers of records used as evidence.'], ['search-scope', 'match-expansion', 'query-codes', 'no-results'], home),
  guide('ai-query', 'Find the right labeling', 'Use AI to draft search criteria', 'Turn a plain-language request into criteria you can inspect before searching.', [
    'Enter a focused request in AI Query Builder. Leave Quick search unchecked when you want to inspect the generated criteria first.',
    'Review the proposed names, terms, groups, categorical chips, and translation notes. Correct unsupported or unintended conditions.',
    'Run Search Labels after reviewing the criteria. Quick search instead runs a successful translation without this confirmation step.',
    'If you use an external AI tool, follow the application’s external query instructions and inspect imported criteria before execution.',
  ], ['An AI response is not itself a database search result.', 'Restore a query code to reuse known conditions rather than translating the same request again.'], ['evidence-types', 'match-expansion', 'query-codes'], home),
  guide('query-codes', 'Find the right labeling', 'Filter results and reuse a query code', 'Preserve search conditions while keeping result filters and scope visible.', [
    'Inspect the result header and active sidebar filters. Facet counts and filtered table totals serve different purposes.',
    'Choose Copy Query Code from the results export menu. Copy the complete FDALABEL-Q1 code from the confirmation dialog.',
    'Paste the code into AI Query Builder and restore it. Recheck the database scope, Exact match setting, candidate selections, and result filters.',
    'When a query is too large, narrow selected names or conditions rather than assuming the restore completed successfully.',
  ], ['Restoring conditions does not freeze the underlying data or grant additional database access.', 'Treat a shared code as readable search information; avoid placing confidential material in criteria you share.'], ['search-scope', 'review-record'], home),
  guide('read-labeling', 'Read and preserve evidence', 'Read labeling and navigate the workspace', 'Use the document, contents rail, compact controls, and label details together.', [
    'Confirm the product and version, then use Contents to jump to a section. Expand Label details for product metadata and collapse it to regain reading space.',
    'Scroll through the continuous document. Controls remain at the top and move less-used actions into More when space is limited.',
    'Use browser Find to locate text, then read the section, table headings, comparator columns, and footnotes around each occurrence.',
    'Open Toolbox for label-specific analysis. Return to Label View to verify generated findings against source text.',
  ], ['The thin progress indicator tracks section position; it does not indicate review completeness.', 'Missing text, unavailable versions, or changed source versions require attention before citing a passage.'], ['versions', 'source-availability', 'toolbox-guide'], home),
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
  guide('saved-work', 'Read and preserve evidence', 'Save notes, projects, and exports', 'Keep the review question, selected evidence, and your interpretation together.', [
    'Use your personal Dashboard and project actions to organize a review cohort where these actions are enabled.',
    'Record observations using the available Notes or annotation controls. Distinguish source quotations from your own interpretation.',
    'Export from the relevant result table or labeling action. Read the export dialog to determine the selected records, sections, format, and active filters.',
    'Inspect the exported file before using it in a review record. Different tools expose different fields and export scopes.',
  ], ['Record product/version identifiers and the date of your analysis alongside the exported material.', 'Do not assume notes are shared with colleagues or that exporting a table exports every matching record.'], ['review-record', 'query-codes'], { href: '/dashboard', label: 'Open My Dashboard' }),
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
  guide('compare-guide', 'Compare and track changes', 'Compare labeling across products or versions', 'Select comparable inputs, inspect text differences, and verify any AI summary.', [
    'Choose the intended labeling records for Compare. Confirm each product, version, route, formulation, and comparison purpose.',
    'Inspect aligned sections and the available text differences. Read the complete paragraphs and table contexts on both sides.',
    'If an AI comparison summary is generated, trace each material statement back to both source documents.',
    'For a historical question, use available version history to select specific versions rather than assuming the default documents represent the intended dates.',
  ], ['A text change needs scientific interpretation; it may reflect wording, formatting, product context, or a substantive difference.', 'Product-name matching alone does not establish an RLD/RS relationship or therapeutic equivalence.'], ['comparison-method', 'versions', 'history-guide'], { href: '/labelcomp', label: 'Open Compare' }),
  guide('history-guide', 'Compare and track changes', 'Trace available versions and application context', 'Use version history and application-linked records to establish the comparison set.', [
    'Open Archived Version Track for available versions of a labeling set.',
    'Use FDA Application Profile when the selected labeling has a suitable application number and the tool is available.',
    'Inspect the identifiers, displayed dates, and source availability of each candidate before launching a comparison.',
  ], ['A list of available records is not proof of a complete regulatory or labeling history.', 'Record which exact documents you reviewed and note missing historical material.'], ['versions', 'source-availability', 'comparison-method']),
  guide('visual-guide', 'Compare and track changes', 'Review packaging artwork, confusion, and consistency', 'Choose the right visual-review purpose and inspect the evidence behind findings.', [
    'Open Labeling Visual Review. Choose labeling and a specific image on each required side, or upload artwork and confirm its labeling association.',
    'Use Artwork Comparison for visible changes, Product Confusion for distinguishing features, or Labeling Consistency to compare an image with its own labeling reference.',
    'For product-confusion workflows, check and confirm the identified packaging information before comparison. Other visual-review modes may provide a quick overview before detailed findings.',
    'Inspect numbered findings and their evidence regions. Confirm or dismiss findings, add reviewer notes, and correct inaccurate localization where supported.',
  ], ['Confirm product, strength, route, selected image, and reference version; an upload does not prove its own provenance.', 'Missing carton text alone does not establish a contradiction with labeling. A partial overview does not replace a completed detailed review.'], ['visual-method', 'waiting-results', 'review-record'], { href: '/image-review', label: 'Open Labeling Visual Review' }),
  guide('agent-guide', 'Organize safety evidence', 'Use organ-safety and PGx analyses', 'Choose a focused agent and review its supporting evidence.', [
    'Choose DILI, DICT, DIRI, or PGx in the selected labeling’s Toolbox according to the question being reviewed.',
    'Inspect the returned evidence and references, separating labeling-derived statements from reference classifications or generated interpretation.',
    'Use Examine for a focused prompt when available. Use Deep Dive for the peer context offered by the tool, checking whether the comparison group suits the question.',
    'Use askDrugTox for its available reference resources; do not treat a reference classification and a newly generated assessment as interchangeable.',
  ], ['Resolve unsupported or contradictory statements against their cited sources.', 'A generated category is not, on its own, an individual-patient causal assessment.'], ['agent-method', 'evidence-types', 'ro2-guide']),
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
  guide('ai-preferences', 'Resolve common obstacles', 'Choose your AI model preference', 'Understand your account preference, system default, and model availability.', [
    'Open AI Preferences from your account menu. Inspect the currently used model and whether you follow the system default.',
    'Choose an available model or Follow system default, then save. The preference applies to subsequent AI requests.',
    'Internal deployments offer their permitted ELSA/local models; external deployments offer Gemini. Your available list is authoritative for that installation.',
  ], ['Connection settings are managed by administrators; their personal connection overrides do not change the entire site.', 'A model change may affect later generated results. Recheck source support and retain model information when available.'], ['evidence-types', 'availability', 'review-record'], { href: '/management?tab=ai', label: 'Open AI Preferences' }),
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
  method('search-scope', 'Sources and scope', 'Understand search scope and coverage', 'Interpret a search in the context of the selected database, available records, and supported criteria.', [
    { heading: 'Scope affects the question you can ask', paragraphs: ['Local searches support product metadata and limited section criteria such as Product Title and Initial U.S. Approval. Full labeling-text and MedDRA section searches require the appropriate available internal scope.', 'CDER-CBER and FDA ver. are different internal search scopes. Your account may not be permitted to choose every scope; inspect the scope shown in the application.'] },
    { heading: 'What a match establishes', paragraphs: ['A search returns records matching supported conditions in that scope. It does not establish complete coverage of all products, regulatory approval, or therapeutic equivalence. Active filters can further narrow the displayed subset.'] },
    { heading: 'Reviewer checks', steps: ['Record the scope, criteria, and filters.', 'Check representative positive matches and investigate unexpectedly missing products before interpreting totals.'] },
  ], ['query-guide', 'match-expansion', 'no-results']),
  method('match-expansion', 'Queries and terminology', 'Understand Exact match and term expansion', 'Inspect the selected entities rather than assuming a name or term means the same thing in every search.', [
    { heading: 'Names and terms', paragraphs: ['Name resolution can suggest related brand, generic, or ingredient candidates. Exact match limits related-entity expansion; it is different from the equals/contains/starts-with operator of an individual criterion.', 'MedDRA searches support PT/LLT selections and related-term expansion where offered. Check the selected hierarchy and expanded candidates rather than inferring coverage from a single typed phrase.'] },
    { heading: 'AI versus executed criteria', paragraphs: ['An AI draft can misread scope, names, negation, or AND/OR intent. The criteria you review and execute define the search, not the fluent explanation alone.'] },
    { heading: 'Reviewer checks', steps: ['Inspect candidates and groups before execution.', 'Compare Exact match and expanded searches when sensitivity to terminology matters, documenting the difference.'] },
  ], ['ai-query', 'query-guide', 'meddra-method']),
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
  method('comparison-method', 'Comparisons and screening', 'Interpret differences between labeling documents', 'Aligned sections and highlighted changes support reading; they do not decide the scientific importance of a difference.', [
    { heading: 'Two distinct questions', paragraphs: ['Historical comparison asks what changed between selected versions. Cross-product comparison asks how labeling differs between selected products. These require different checks on identity, date, formulation, route, population, and indication.'] },
    { heading: 'Reviewer checks', steps: ['Read the full passage on both sides of a highlighted change.', 'Check whether missing material reflects source availability or alignment rather than a substantive omission.', 'Verify AI statements against each source and establish regulatory relationships from appropriate records when relevant.'] },
  ], ['compare-guide', 'history-guide', 'versions']),
  method('visual-method', 'Comparisons and screening', 'Interpret image findings and partial visual reviews', 'Visible artwork, product-confusion concerns, and reference consistency are separate review questions.', [
    { heading: 'Inputs determine the scope', paragraphs: ['Only selected/uploaded images and the supplied labeling references are examined. A visible region cannot establish properties of unseen packaging, physical print size, or an upload’s provenance.'] },
    { heading: 'Stages and localization', paragraphs: ['A quick overview and a detailed finding are different outputs. Some modes can finish with an overview when point-to-point comparison is unsuitable. An overview is not a completed consistency assessment and does not supply validated evidence coordinates.', 'Numbered regions help locate a proposed finding; inspect the actual image and correct localization where supported before accepting it.'] },
    { heading: 'Reviewer checks', steps: ['Confirm product identities, image types, strengths, and reference versions.', 'Distinguish absent text from contradictory text.', 'Preserve confirmed, dismissed, and unresolved findings in the review record.'] },
  ], ['visual-guide', 'waiting-results', 'review-record']),
  method('agent-method', 'Comparisons and screening', 'Interpret focused safety-agent outputs', 'A focused analysis brings evidence together; its categories and references still require review.', [
    { heading: 'Different evidence roles', paragraphs: ['A reference classification, a labeling statement, a literature citation, and a generated organ-safety or PGx assessment are not interchangeable. Read the output’s stated sources and scope before using its category or conclusion.'] },
    { heading: 'Reviewer checks', steps: ['Inspect whether the evidence concerns the intended product, route, dose, population, and question.', 'Follow citations and retain conflicting or missing evidence.', 'Use peer comparisons as context, rather than assuming a shared class or structure proves the same safety effect.'] },
  ], ['agent-guide', 'evidence-types', 'structure-method']),
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

/** Every old topic has a destination, including the retired device entry. */
export const LEGACY_TOPICS: Record<string, string> = {
  '1-1-account-login': 'account-access', '1-2-personal-dashboard': 'saved-work',
  '2-1-quick-search': 'find-labeling', '2-2-plain-language-search': 'ai-query', '2-3-reading-label': 'read-labeling',
  '3-1-qb-market-filters': 'query-guide', '3-2-qb-dosage-routes': 'query-guide', '3-3-qb-safety-sections': 'query-guide',
  '3-4-ai-quick-search': 'ai-query', '3-5-portable-query-codes': 'query-codes', '3-6-external-ai-query': 'ai-query',
  '3-7-scope-and-expansion': 'search-scope', '3-8-result-filters': 'query-codes',
  '4-1-export-excel': 'saved-work', '4-2-task-organization': 'saved-work',
  '5-1-ae-viewer': 'ae-guide', '5-2-meddra-highlighting': 'meddra-method',
  '6-1-pv-evidence-grid': 'pv-guide', '6-2-pv-qc-audit': 'pv-method',
  '7-1-labelcomp-rld': 'compare-guide', '7-2-labelcomp-history': 'history-guide', '7-3-labelcomp-ai-summary': 'compare-guide',
  '7-4-labeling-visual-review': 'visual-guide', '8-1-drugtox-overview': 'agent-guide', '8-2-dili-ro2': 'ro2-guide',
  '9-1-chemsearch-similarity': 'chem-guide', '10-1-device-clearances-recalls': 'availability', '11-1-reviewer-faq': 'waiting-results',
};
export function searchableText(article: WikiArticle): string {
  return [article.title, article.summary, article.group, ...article.tags,
    ...article.sections.flatMap(section => [section.heading, ...(section.paragraphs || []), ...(section.steps || [])])].join(' ').toLowerCase();
}
