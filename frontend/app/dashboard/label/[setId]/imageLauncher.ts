import { imageAnalysisRoute } from '../../../platform/context';

/** Add an image action to SPL HTML, which is rendered outside React. */
export function initImageLauncher(root: HTMLElement, setId: string, splId?: string): () => void {
  const wrappers: HTMLSpanElement[] = [];
  root.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.closest('.spl-image-action')) return;
    const source = image.getAttribute('src');
    if (!source) return;
    let url: URL;
    try { url = new URL(source, window.location.href); } catch { return; }
    const name = url.searchParams.get('name');
    if (!name) return;
    const filename = name.replace(/\\/g, '/').split('/').pop();
    if (!filename) return;

    const wrapper = document.createElement('span');
    wrapper.className = 'spl-image-action';
    const action = document.createElement('a');
    action.className = 'btn-analyze-image';
    action.href = imageAnalysisRoute(setId, filename, splId);
    action.target = '_blank';
    action.rel = 'noopener noreferrer';
    action.textContent = 'Analyze image ↗';
    action.title = 'Open this image in Visual Analysis (new window)';
    action.setAttribute('aria-label', `Analyze ${filename} in a new window`);
    // An SPL image may itself be linked; keep the analysis action outside that link.
    const anchor = image.closest('a');
    const content = anchor && root.contains(anchor) ? anchor : image;
    content.parentNode?.insertBefore(wrapper, content);
    wrapper.append(content, action);
    wrappers.push(wrapper);
  });
  return () => {
    wrappers.forEach((wrapper) => {
      const content = wrapper.firstChild;
      if (content) wrapper.replaceWith(content);
      else wrapper.remove();
    });
  };
}
