import { CARTON_FIELDS, type CartonField, type Decision, type Review, type Side } from './types';

export function downloadReviewJson(review: Review, decisions: Record<number, Decision>, taskId: number | null) {
  download(new Blob([JSON.stringify({ ...review, decisions, task_id: taskId, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' }), 'labeling-visual-review.json');
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function imageData(url: string): Promise<string> {
  const image = new Image(); image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable.');
  context.drawImage(image, 0, 0);
  return canvas.toDataURL('image/png');
}

/** A standalone report with embedded artwork and editable-review evidence. No model HTML is evaluated. */
export async function downloadReviewHtml(review: Review, decisions: Record<number, Decision>, urls: Record<Side, string>) {
  const doc = document.implementation.createHTMLDocument('Labeling Visual Review');
  const style = doc.createElement('style');
  style.textContent = 'body{font:15px/1.5 Arial,sans-serif;color:#172d45;max-width:1400px;margin:24px auto;padding:20px}section{margin:20px 0}article{border:1px solid #cbd5e1;padding:16px;margin:12px 0}h1,h2,h3{margin:0 0 12px}.images{display:flex;gap:20px}.images>div{width:50%}svg{width:100%;height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}p{white-space:pre-wrap}@media print{article{break-inside:avoid}}';
  doc.head.appendChild(style);
  const append = (parent: HTMLElement, tag: string, text: string) => { const element = doc.createElement(tag); element.textContent = text; parent.appendChild(element); return element; };
  append(doc.body, 'h1', 'Labeling Visual Review');
  append(doc.body, 'p', `${review.mode} · ${new Date().toISOString()} · ${review.model}`);
  append(doc.body, 'p', review.summary);
  if (review.mode === 'confusion') {
    if (review.assessment) append(doc.body, 'p', `Assessment: ${review.assessment.replaceAll('_', ' ')}`);
    append(doc.body, 'h2', 'Distinguishing factors');
    review.distinguishing_factors?.forEach(text => append(doc.body, 'p', text));
    if (review.carton_inputs) {
      append(doc.body, 'h2', 'Confirmed carton information');
      for (const side of ['left', 'right'] as Side[]) {
        const input = review.carton_inputs[side];
        append(doc.body, 'h3', `Product ${side === 'left' ? 'A' : 'B'} · ${input.extraction.view}`);
        for (const key of Object.keys(CARTON_FIELDS) as CartonField[]) {
          const field = input.confirmed_fields[key];
          append(doc.body, 'p', `${CARTON_FIELDS[key]}: ${field.value || 'Unknown'} (${field.source === 'user_provided' ? 'User provided; visibility not established' : input.extraction.fields[key].status})`);
        }
        append(doc.body, 'pre', JSON.stringify(input, null, 2));
      }
    }
  }
  const grid = doc.createElement('section'); grid.className = 'images'; doc.body.appendChild(grid);
  const ns = 'http://www.w3.org/2000/svg';
  const exportSides: Side[] = review.mode === 'consistency' ? ['left'] : ['left', 'right'];
  for (const side of exportSides) {
    if (!urls[side]) continue;
    const panel = doc.createElement('div'); grid.appendChild(panel);
    append(panel, 'h2', review.mode === 'consistency' ? 'Product Artwork' : (side === 'left' ? 'Product A' : 'Product B'));
    const svg = doc.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 1000 1000');
    const image = doc.createElementNS(ns, 'image'); image.setAttribute('href', await imageData(urls[side]));
    const raster = new Image(); raster.src = image.getAttribute('href')!; await raster.decode();
    const height = 1000 * raster.naturalHeight / raster.naturalWidth;
    svg.setAttribute('viewBox', `0 0 1000 ${height}`); image.setAttribute('width', '1000'); image.setAttribute('height', String(height)); svg.appendChild(image);
    for (const finding of review.findings) {
      const region = finding.regions[side]; if (!region || decisions[finding.id]?.status === 'dismissed') continue;
      const rect = doc.createElementNS(ns, 'rect');
      for (const [key, value] of Object.entries({ x: region.x * 1000, y: region.y * height, width: region.w * 1000, height: region.h * height })) rect.setAttribute(key, String(value));
      rect.setAttribute('stroke', finding.category === 'color' ? '#0071bc' : '#8a5700'); rect.setAttribute('stroke-width', '3'); rect.setAttribute('fill', 'none'); svg.appendChild(rect);
      const marker = doc.createElementNS(ns, 'text'); marker.setAttribute('x', String(region.x * 1000 + 4)); marker.setAttribute('y', String(region.y * height + 22)); marker.setAttribute('fill', '#172d45'); marker.setAttribute('font-size', '24'); marker.setAttribute('stroke', 'white'); marker.setAttribute('paint-order', 'stroke'); marker.textContent = String(finding.id); svg.appendChild(marker);
    }
    panel.appendChild(svg); append(panel, 'pre', JSON.stringify(review.sources[side], null, 2));
  }
  append(doc.body, 'h2', 'Review Findings');
  for (const finding of review.findings) {
    const article = doc.createElement('article'); doc.body.appendChild(article);
    append(article, 'h3', `${finding.id}. ${finding.title}`);
    append(article, 'p', `${finding.kind} · ${finding.priority} · Evidence confidence: ${finding.confidence} · Decision: ${decisions[finding.id]?.status || 'unreviewed'}`);
    for (const text of [finding.observation, finding.risk, `A: ${finding.left_text || 'No transcribed evidence'}`, `B: ${finding.right_text || 'No transcribed evidence'}`, ...finding.label_evidence.map(e => `${e.side} labeling: ${e.quote}`), decisions[finding.id]?.note]) if (text) append(article, 'p', text);
  }
  append(doc.body, 'h2', 'Limitations'); review.limitations.forEach(text => append(doc.body, 'p', text));
  download(new Blob(['<!doctype html>', doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }), 'labeling-visual-review.html');
}
