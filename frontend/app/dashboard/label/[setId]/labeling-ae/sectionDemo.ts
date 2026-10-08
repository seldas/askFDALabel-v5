// Synthetic UI fixture; never presented as annotations for the open product.
const canonicalText = '6 ADVERSE REACTIONS\nNausea and headache were reported.\nNausea was also reported during follow-up.';
const section = { id: 'demo-section', name: 'ADVERSE REACTIONS', observed_section_name: '6 ADVERSE REACTIONS', start: 0, end: canonicalText.length };
const nausea = canonicalText.indexOf('Nausea');
const headache = canonicalText.indexOf('headache');

export const SECTION_DEMO = {
  canonical_text: canonicalText,
  document: {
    set_id: 'synthetic-example', spl_id: 'synthetic-example', canonicalization_version: 'demo-1',
    canonical_text_sha256: '07e7770442cc426afae7829311b76a98aff2b7ec675a81a15ea95c6c731e015c',
  },
  offsets: { basis: 'canonical_text', indexing: '0-based', interval: 'half-open', normalization: 'NFC', unit: 'unicode_code_points', canonicalization_version: 'demo-1' },
  sections: [section],
  annotations: [
    { id: 'demo-1', term: 'Nausea', start: nausea, end: nausea + 6, section, display_classification: 'MedDRA Adverse Reaction', coding: { name: 'Nausea', code: '10028813', soc_name: 'Gastrointestinal disorders' } },
    { id: 'demo-2', term: 'headache', start: headache, end: headache + 8, section, display_classification: 'RxBERT Adverse Reaction', coding: {} },
    { id: 'demo-3', term: 'Nausea', start: nausea, end: nausea + 6, section, display_classification: 'RxBERT Adverse Reaction', coding: {} },
  ],
  summary: { annotation_count: 3, section_count: 1 },
};
