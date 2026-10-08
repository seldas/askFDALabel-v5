'use client';

import React, { useEffect, useMemo, useState } from 'react';

type Section = { id: string; start: number; end: number; observed_section_name?: string; name?: string; path?: string };
type Annotation = { id: string; start: number; end: number; term: string; section?: { id?: string }; display_classification?: string; coding?: { name?: string; code?: string; soc_name?: string } };

export default function SectionView({ payload, setId, splId, labelXml, demo }: { payload: any; setId: string; splId?: string | null; labelXml?: string; demo: boolean }) {
  const [uploadedText, setUploadedText] = useState<string | null>(null);
  const [verification, setVerification] = useState('');
  const [verifiedSource, setVerifiedSource] = useState<{ text: string; payload: any } | null>(null);
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [classification, setClassification] = useState('all');
  const [soc, setSoc] = useState('all');
  const sections: Section[] = Array.isArray(payload.sections) ? payload.sections : [];
  const annotations: Annotation[] = Array.isArray(payload.annotations) ? payload.annotations : [];
  const text = uploadedText ?? payload.canonical_text ?? payload.document?.canonical_text;
  const doc = payload.document;
  const offsets = payload.offsets;
  const verified = verifiedSource?.text === text && verifiedSource?.payload === payload;

  useEffect(() => { setUploadedText(null); setSelectedSection(''); setSelectedIds([]); }, [payload]);

  useEffect(() => {
    let cancelled = false;
    setVerifiedSource(null);
    const verify = async () => {
      const xmlDocument = labelXml ? new DOMParser().parseFromString(labelXml, 'application/xml') : null;
      const servedSplId = xmlDocument && !xmlDocument.querySelector('parsererror') ? Array.from(xmlDocument.documentElement.children).find(el => el.localName === 'id')?.getAttribute('root') : null;
      if (!demo && (!servedSplId || doc?.set_id !== setId || doc?.spl_id !== servedSplId || (splId && doc?.spl_id !== splId))) {
        return 'These annotations do not identify the label version you opened. Highlights are unavailable.';
      }
      if (!doc?.spl_id || !doc?.canonical_text_sha256) return 'The annotation response lacks document identity or a canonical text hash.';
      if (offsets?.basis !== 'canonical_text' || offsets?.indexing !== '0-based' || offsets?.interval !== 'half-open' || offsets?.normalization !== 'NFC' || !doc?.canonicalization_version || offsets?.canonicalization_version !== doc.canonicalization_version) {
        return 'The annotation response uses an unsupported or inconsistent offset contract.';
      }
      if (offsets?.unit !== 'unicode_code_points') return 'The annotation service must declare offsets.unit as unicode_code_points before locations can be verified.';
      if (typeof text !== 'string') return 'Canonical section text is not included in this response. Load the exact canonical text exported by the annotation service to enable verified highlights.';
      if (text.normalize('NFC') !== text) return 'The supplied text is not NFC normalized. Load the original canonical text export.';
      setVerification('Verifying canonical text…');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== String(doc.canonical_text_sha256).toLowerCase()) return 'The text hash does not match the annotated document. Highlights are unavailable.';
      if (!cancelled) setVerifiedSource({ text, payload });
      return 'Canonical text verified against the annotation document.';
    };
    verify().then(message => { if (!cancelled) setVerification(message); }).catch(() => {
      if (!cancelled) setVerification('Text verification failed. Use a secure browser connection and retry.');
    });
    return () => { cancelled = true; };
  }, [text, doc, offsets, setId, splId, labelXml, demo, payload]);

  // Offset units must be Unicode code points, as used by the service's Python parser.
  const characters = useMemo(() => typeof text === 'string' ? Array.from(text) : [], [text]);
  const validRange = (start: number, end: number) => Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= characters.length;
  const section = sections.find(s => s.id === selectedSection) ?? sections[0];
  const scoped = annotations.filter(a => a.section?.id === section?.id);
  const filtered = scoped.filter(a => (classification === 'all' || a.display_classification === classification) && (soc === 'all' || a.coding?.soc_name === soc) && (!query || `${a.term} ${a.coding?.name ?? ''} ${a.coding?.soc_name ?? ''}`.toLowerCase().includes(query.toLowerCase())));
  const located = verified && section && validRange(section.start, section.end) ? filtered.filter(a => validRange(a.start, a.end) && a.start >= section.start && a.end <= section.end && characters.slice(a.start, a.end).join('').toLowerCase() === a.term?.normalize('NFC').toLowerCase()) : [];
  const selected = filtered.filter(a => selectedIds.includes(a.id));
  const points = section ? Array.from(new Set([section.start, section.end, ...located.flatMap(a => [a.start, a.end])])).sort((a, b) => a - b) : [];

  return <div className="afl-ae-card">
    <div className="afl-ae-card__header"><h3 className="afl-ae-card__title">Section View</h3><span>{demo ? 'Example document' : `Annotated SPL: ${doc?.spl_id ?? 'Unknown'}`}</span></div>
    <div className="afl-ae-section-status" role="status">
      <strong>{verified ? '✓ Verified text' : 'Highlights unavailable'}</strong><p>{verification}</p>
      <label className="afl-ae-text-upload">Load canonical text <input type="file" accept=".txt,text/plain" onChange={async e => {
        const file = e.target.files?.[0];
        if (file) { try { setVerifiedSource(null); setUploadedText(await file.text()); } catch { setVerification('Could not read this text file.'); } }
        e.target.value = '';
      }} /></label>
    </div>
    <div className="afl-ae-section-filters">
      <input className="afl-ae-search-input" aria-label="Search section annotations" placeholder="Search annotations…" value={query} onChange={e => setQuery(e.target.value)} />
      <select aria-label="Classification" value={classification} onChange={e => setClassification(e.target.value)}><option value="all">All classifications</option>{Array.from(new Set(annotations.map(a => a.display_classification).filter(Boolean))).map(c => <option key={c}>{c}</option>)}</select>
      <select aria-label="System organ class" value={soc} onChange={e => setSoc(e.target.value)}><option value="all">All SOC categories</option>{Array.from(new Set(annotations.map(a => a.coding?.soc_name).filter(Boolean))).map(c => <option key={c}>{c}</option>)}</select>
      <span className="afl-ae-section-legend">Blue: MedDRA · Purple: RxBERT · Split: overlap</span>
    </div>
    <div className="afl-ae-section-layout">
      <nav className="afl-ae-section-nav" aria-label="Label sections">{sections.map(s => <button key={s.id} aria-pressed={s.id === section?.id} onClick={() => { setSelectedSection(s.id); setSelectedIds([]); }}><span>{s.observed_section_name || s.name || s.id}</span><small>{annotations.filter(a => a.section?.id === s.id).length}</small></button>)}</nav>
      <article className="afl-ae-section-reader">
        <h3>{section?.observed_section_name || section?.name || 'No sections available'}</h3>
        {section && <p>{filtered.length} annotations · {located.length} verified locations</p>}
        {verified && section && validRange(section.start, section.end) ? <div className="afl-ae-section-text">{points.slice(0, -1).map((start, i) => {
          const end = points[i + 1];
          const matches = located.filter(a => a.start < end && a.end > start);
          const fragment = characters.slice(start, end).join('');
          if (!matches.length) return <React.Fragment key={start}>{fragment}</React.Fragment>;
          const rx = matches.some(a => a.display_classification?.includes('RxBERT'));
          const meddra = matches.some(a => a.display_classification?.includes('MedDRA'));
          return <button key={start} className={`afl-ae-inline-mark ${rx && meddra ? 'overlap' : rx ? 'rxbert' : 'meddra'}`} aria-label={`Show annotations for ${fragment}`} title={matches.map(a => `${a.term}: ${a.coding?.name || a.display_classification}`).join('\n')} onClick={() => setSelectedIds(matches.map(a => a.id))}>{fragment}</button>;
        })}</div> : <p>Section text will appear once its source is verified. You can still inspect the section’s extracted annotations below.</p>}
        {filtered.length > located.length && verified && <p>{filtered.length - located.length} annotations could not be located safely and are shown below without highlights.</p>}
        <div className="afl-ae-section-annotations">{filtered.map(a => <button key={a.id} onClick={() => setSelectedIds([a.id])}>{a.term}<small>{a.display_classification}{verified && !located.includes(a) ? ' · Unresolved location' : ''}</small></button>)}</div>
      </article>
      <aside className="afl-ae-section-details"><h3>Annotation details</h3>{selected.length ? selected.map(a => <div key={a.id}><h4>{a.term}</h4><p>{a.display_classification}</p><p>{a.coding?.name || 'No MedDRA PT supplied'}</p>{a.coding?.code && <p>PT: {a.coding.code}</p>}<p>{a.coding?.soc_name}</p><small>Offsets: [{a.start}, {a.end})</small></div>) : <p>Select a highlight or annotation to inspect it.</p>}</aside>
    </div>
  </div>;
}
