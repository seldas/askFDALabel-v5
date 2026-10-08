import React from 'react';
import type { SectionNode } from './sectionAlignment';

type Span = { id: string; start: number; end: number; term: string; display_classification?: string };

export default function FormattedSection({ nodes, spans, onSelect }: { nodes: SectionNode[]; spans: Span[]; onSelect: (ids: string[]) => void }) {
  const render = (node: SectionNode, key: string): React.ReactNode => {
    if (node.text !== undefined) {
      const start = node.start!;
      const end = node.end!;
      const characters = Array.from(node.text);
      const intersections = spans.filter(span => span.start < end && span.end > start);
      const points = Array.from(new Set([start, end, ...intersections.flatMap(span => [Math.max(start, span.start), Math.min(end, span.end)])])).sort((a, b) => a - b);
      return <React.Fragment key={key}>{points.slice(0, -1).map((from, i) => {
        const to = points[i + 1];
        const fragment = characters.slice(from - start, to - start).join('');
        const matches = intersections.filter(span => span.start < to && span.end > from);
        if (!matches.length) return <React.Fragment key={from}>{fragment}</React.Fragment>;
        const rx = matches.some(span => span.display_classification?.includes('RxBERT'));
        const meddra = matches.some(span => span.display_classification?.includes('MedDRA'));
        return <button key={from} type="button" className={`afl-ae-inline-mark ${rx && meddra ? 'overlap' : rx ? 'rxbert' : 'meddra'}`} aria-label={`Show annotations for ${matches.map(span => span.term).join(', ')}`} title={matches.map(span => `${span.term}: ${span.display_classification}`).join('\n')} onClick={() => onSelect(matches.map(span => span.id))}>{fragment}</button>;
      })}</React.Fragment>;
    }
    return React.createElement(node.tag!, { ...node.attributes, key }, node.tag === 'br' || node.tag === 'col' ? undefined : node.children?.map((child, i) => render(child, `${key}.${i}`)));
  };
  return <div className="afl-ae-section-html">{nodes.map((node, i) => render(node, String(i)))}</div>;
}
