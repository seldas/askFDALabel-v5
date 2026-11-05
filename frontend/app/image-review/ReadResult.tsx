'use client';

import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type ImageReading = { result: string; cached: boolean; model?: string };

function splitReading(text: string) {
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string } = { title: 'Image summary', body: '' };
  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^\s*(?:#{1,4}\s*)?(Extracted Text|Original Text|Normalized Product Information|Warnings and Instructions|Uncertainties)\s*:?[ \t]*$/i);
    if (heading) {
      if (current.body.trim()) sections.push(current);
      current = { title: heading[1], body: '' };
    } else current.body += `${current.body ? '\n' : ''}${line}`;
  }
  if (current.body.trim()) sections.push(current);
  return {
    extracted: sections.filter(section => /^(extracted|original) text$/i.test(section.title)).map(section => section.body).join('\n\n'),
    summary: sections.filter(section => !/^(extracted|original) text$/i.test(section.title)),
  };
}

export default function ReadResult({ reading }: { reading: ImageReading }) {
  const { extracted, summary } = useMemo(() => splitReading(reading.result), [reading.result]);
  return <div className="va-reading">
    <header><span className="ivr-eyebrow">READ IMAGE</span><h2>What’s in this image</h2>
      <p>{reading.cached ? 'Saved reading' : 'Image reading'}{reading.model ? ` · ${reading.model}` : ''}</p></header>
    {summary.map((section, index) => <section key={index}><h3>{section.title}</h3>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown></section>)}
    {extracted && <details className="va-reading-text"><summary>View extracted text</summary>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{extracted}</ReactMarkdown></details>}
    <details className="ivr-limitations"><summary>Save this reading</summary>
      <button className="ivr-button" onClick={() => {
        const url = URL.createObjectURL(new Blob([reading.result], { type: 'text/markdown;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'image-reading.md'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Download reading</button>
    </details>
  </div>;
}
