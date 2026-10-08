export interface SourceSection {
  id: string;
  xml_path?: string;
  loinc_code?: string;
  observed_section_name?: string;
}

export interface SectionNode {
  tag?: string;
  attributes?: Record<string, string | number>;
  children?: SectionNode[];
  text?: string;
  start?: number;
  end?: number;
}

export interface SectionContent { text: string; nodes: SectionNode[] }

const children = (element: Element, name: string) => Array.from(element.children).filter(child => child.localName === name);
const normalized = (text: string) => text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

// Follow the producer's structural path without depending on the SPL namespace prefix.
function resolvePath(document: Document, path: string): Element | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.shift() !== 'document' || document.documentElement.localName !== 'document') return null;
  let current: Element = document.documentElement;
  for (const part of parts) {
    const match = /^(component|structuredBody|section)(?:\[(\d+)\])?$/.exec(part);
    if (!match) return null;
    const candidates = children(current, match[1]);
    if (!match[2] && candidates.length !== 1) return null;
    const next = candidates[Number(match[2] || 1) - 1];
    if (!next) return null;
    current = next;
  }
  return current.localName === 'section' ? current : null;
}

function sectionMatches(element: Element, section: SourceSection) {
  const code = children(element, 'code')[0]?.getAttribute('code');
  const title = children(element, 'title')[0]?.textContent || '';
  return (!section.loinc_code || section.loinc_code === code) &&
    (!section.observed_section_name || normalized(section.observed_section_name) === normalized(title));
}

function sectionContent(element: Element): SectionContent {
  let text = '';
  let position = 0;
  const append = (value: string) => { text += value; position += Array.from(value).length; };
  const tags: Record<string, string> = { paragraph: 'p', list: 'ul', item: 'li', table: 'table', thead: 'thead', tbody: 'tbody', tfoot: 'tfoot', tr: 'tr', td: 'td', th: 'th', caption: 'caption', colgroup: 'colgroup', col: 'col', content: 'span', linkHtml: 'span', sub: 'sub', sup: 'sup', br: 'br', title: 'h4' };
  const convert = (node: Node): SectionNode[] => {
    if (node.nodeType === 3) {
      const value = (node.textContent || '').normalize('NFC');
      if (/^(table|thead|tbody|tfoot|tr|colgroup)$/.test(node.parentElement?.localName || '') && /^\s*$/.test(value)) return [];
      const start = position;
      append(value);
      return [{ text: value, start, end: position }];
    }
    if (node.nodeType !== 1) return [];
    const item = node as Element;
    if (['script', 'style', 'renderMultiMedia', 'observationMedia'].includes(item.localName)) return [];
    let tag = tags[item.localName];
    if (!tag) return Array.from(item.childNodes).flatMap(convert);
    if (tag === 'ul' && item.getAttribute('listType') === 'ordered') tag = 'ol';
    const attributes: Record<string, string | number> = {};
    for (const [xmlAttribute, htmlAttribute] of [['colspan', 'colSpan'], ['rowspan', 'rowSpan'], ['span', 'span']]) {
      const value = item.getAttribute(xmlAttribute);
      if (value && /^\d{1,3}$/.test(value) && Number(value) > 0) attributes[htmlAttribute] = Number(value);
    }
    const styles = (item.getAttribute('styleCode') || '').split(/\s+/);
    attributes.className = styles.filter(style => ['Bold', 'Italics', 'Underline', 'Lrule', 'Rrule', 'Toprule', 'Botrule'].includes(style)).map(style => `spl-${style.toLowerCase()}`).join(' ');
    let childNodes = Array.from(item.childNodes).flatMap(convert);
    if (tag === 'table') {
      const grouped: SectionNode[] = [];
      for (const child of childNodes) {
        if (child.tag === 'tr') {
          const previous = grouped[grouped.length - 1];
          if (previous?.tag === 'tbody' && previous.attributes?.['data-generated'] === 'true') previous.children!.push(child);
          else grouped.push({ tag: 'tbody', attributes: { 'data-generated': 'true' }, children: [child] });
        } else grouped.push(child);
      }
      childNodes = grouped;
    }
    if (['td', 'th'].includes(tag)) append('\u0000'); // A match must never cross table cells.
    else if (['p', 'li', 'tr', 'h4', 'caption', 'br'].includes(tag)) append('\n');
    return [{ tag, attributes, children: childNodes }];
  };
  const build = (section: Element): SectionNode[] => [
    ...children(section, 'title').flatMap(convert),
    ...children(section, 'text').flatMap(body => Array.from(body.childNodes).flatMap(convert)),
    ...children(section, 'component').flatMap(component => children(component, 'section').flatMap(build)),
  ];
  const nodes = build(element);
  return { text, nodes };
}

export function extractSourceSections(xml: string, sections: SourceSection[], setId: string, splId: string, requestedSplId?: string | null) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return { error: 'The label XML could not be parsed.', texts: {} as Record<string, string>, contents: {} as Record<string, SectionContent> };
  const root = document.documentElement;
  if (children(root, 'id')[0]?.getAttribute('root') !== splId || children(root, 'setId')[0]?.getAttribute('root') !== setId || (requestedSplId && requestedSplId !== splId)) {
    return { error: 'The annotation document and the open label are different SPL versions.', texts: {} as Record<string, string>, contents: {} as Record<string, SectionContent> };
  }
  const allSections = Array.from(document.getElementsByTagNameNS('*', 'section'));
  const texts: Record<string, string> = {};
  const contents: Record<string, SectionContent> = {};
  for (const section of sections) {
    let match = section.xml_path ? resolvePath(document, section.xml_path) : null;
    if (match && !sectionMatches(match, section)) match = null;
    if (!match && (section.loinc_code || section.observed_section_name)) {
      const candidates = allSections.filter(element => sectionMatches(element, section));
      if (candidates.length === 1) match = candidates[0];
    }
    if (match) { contents[section.id] = sectionContent(match); texts[section.id] = contents[section.id].text; }
  }
  return { error: '', texts, contents };
}

// Search a whitespace/case-normalized view, retaining positions in displayed text.
// Repeated phrases use a section-relative offset hint and remain explicitly heuristic.
export function alignUniqueTerm(text: string, term: string, expectedStart?: number): { start: number; end: number; reason: string; nearest?: boolean } {
  const characters = Array.from(text);
  const view: string[] = [];
  const positions: number[] = [];
  characters.forEach((character, index) => {
    if (/\s/.test(character)) {
      if (view[view.length - 1] !== ' ') { view.push(' '); positions.push(index); }
    } else {
      Array.from(character.toLowerCase()).forEach(part => { view.push(part); positions.push(index); });
    }
  });
  const needle = Array.from(normalized(term));
  if (!needle.length) return { start: -1, end: -1, reason: 'Missing extracted term' };
  const matches: Array<{ start: number; end: number }> = [];
  for (let index = 0; index <= view.length - needle.length; index++) {
    if (!needle.every((character, offset) => view[index + offset] === character)) continue;
    const word = (character?: string) => !!character && /[\p{L}\p{N}_]/u.test(character);
    if ((word(needle[0]) && word(view[index - 1])) || (word(needle[needle.length - 1]) && word(view[index + needle.length]))) continue;
    matches.push({ start: positions[index], end: positions[index + needle.length - 1] + 1 });
  }
  if (matches.length === 1) return { ...matches[0], reason: 'Unique term match in the same SPL section' };
  if (matches.length > 1 && Number.isInteger(expectedStart) && expectedStart! >= 0) {
    const closest = matches.reduce((best, candidate) => Math.abs(candidate.start - expectedStart!) < Math.abs(best.start - expectedStart!) ? candidate : best);
    return { ...closest, nearest: true, reason: `Nearest match · ${matches.length} occurrences · estimated position (ties use the earlier occurrence)` };
  }
  return { start: -1, end: -1, reason: matches.length ? `${matches.length} occurrences; location is ambiguous` : 'Extracted term not found in this section' };
}
