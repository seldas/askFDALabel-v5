// Synthetic UI fixture; never presented as annotations for the open product.
const canonicalText = '6 ADVERSE REACTIONS\nNausea and headache were reported.\nNausea was also reported during follow-up.';
const section = { id: 'demo-section', name: 'ADVERSE REACTIONS', observed_section_name: '6 ADVERSE REACTIONS', loinc_code: '34084-4', xml_path: '/document/component/structuredBody/component[1]/section', start: 0, end: canonicalText.length };
const nausea = canonicalText.indexOf('Nausea');
const headache = canonicalText.indexOf('headache');

export const SECTION_DEMO = {
  example_xml: '<document xmlns="urn:hl7-org:v3"><id root="synthetic-example"/><setId root="synthetic-example"/><component><structuredBody><component><section><code code="34084-4"/><title>6 ADVERSE REACTIONS</title><text><paragraph>Nausea and    head<content styleCode="Bold">ache</content> were reported.</paragraph><paragraph>Nausea was also reported during follow-up.</paragraph><table><caption>Synthetic adverse reaction table</caption><thead><tr><th rowspan="2">Reaction</th><th colspan="2">Participants</th></tr><tr><th>Treatment</th><th>Comparator</th></tr></thead><tbody><tr><td>Contact <content styleCode="Italics">dermatitis</content></td><td>8%</td><td>2%</td></tr><tr><td>Dry mouth</td><td>4%</td><td>1%</td></tr><tr><td>Abdominal</td><td>pain</td><td>Separate cells; not a phrase</td></tr></tbody></table><list><item>Fatigue was reported.</item></list></text></section></component></structuredBody></component></document>',
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
    { id: 'demo-4', term: 'Contact dermatitis', start: 120, end: 138, section, display_classification: 'MedDRA Adverse Reaction', coding: { name: 'Dermatitis contact', soc_name: 'Skin and subcutaneous tissue disorders' } },
    { id: 'demo-5', term: 'Contact dermatitis', start: 120, end: 138, section, display_classification: 'RxBERT Adverse Reaction', coding: {} },
    { id: 'demo-6', term: 'Abdominal pain', start: 180, end: 194, section, display_classification: 'RxBERT Adverse Reaction', coding: {} },
    { id: 'demo-7', term: 'Fatigue', start: 200, end: 207, section, display_classification: 'RxBERT Adverse Reaction', coding: {} },
  ],
  summary: { annotation_count: 7, section_count: 1 },
};
