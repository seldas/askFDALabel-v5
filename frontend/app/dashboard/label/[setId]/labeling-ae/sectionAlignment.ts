export interface SourceSection {
  id: string;
  xml_path?: string;
  loinc_code?: string;
  observed_section_name?: string;
}

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

function narrative(node: Node): string {
  if (node.nodeType === 3) return node.textContent || '';
  if (node.nodeType !== 1) return '';
  const element = node as Element;
  if (element.localName === 'br') return '\n';
  const value = Array.from(element.childNodes).map(narrative).join('');
  if (['paragraph', 'item', 'tr', 'caption'].includes(element.localName)) return `${value}\n`;
  if (['td', 'th'].includes(element.localName)) return `${value}\t`;
  return value;
}

function sectionText(element: Element): string {
  const title = children(element, 'title')[0]?.textContent || '';
  const body = children(element, 'text').map(narrative).join('\n');
  const nested = children(element, 'component').flatMap(component => children(component, 'section').map(sectionText));
  return [title, body, ...nested].filter(Boolean).join('\n').normalize('NFC');
}

export function extractSourceSections(xml: string, sections: SourceSection[], setId: string, splId: string, requestedSplId?: string | null) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) return { error: 'The label XML could not be parsed.', texts: {} as Record<string, string> };
  const root = document.documentElement;
  if (children(root, 'id')[0]?.getAttribute('root') !== splId || children(root, 'setId')[0]?.getAttribute('root') !== setId || (requestedSplId && requestedSplId !== splId)) {
    return { error: 'The annotation document and the open label are different SPL versions.', texts: {} as Record<string, string> };
  }
  const allSections = Array.from(document.getElementsByTagNameNS('*', 'section'));
  const texts: Record<string, string> = {};
  for (const section of sections) {
    let match = section.xml_path ? resolvePath(document, section.xml_path) : null;
    if (match && !sectionMatches(match, section)) match = null;
    if (!match && (section.loinc_code || section.observed_section_name)) {
      const candidates = allSections.filter(element => sectionMatches(element, section));
      if (candidates.length === 1) match = candidates[0];
    }
    if (match) texts[section.id] = sectionText(match);
  }
  return { error: '', texts };
}

// Search a whitespace/case-normalized view, retaining positions in displayed text.
// A nearby offset is never enough to resolve a repeated phrase.
export function alignUniqueTerm(text: string, term: string): { start: number; end: number; reason: string } {
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
  return { start: -1, end: -1, reason: matches.length ? `${matches.length} occurrences; location is ambiguous` : 'Extracted term not found in this section' };
}
