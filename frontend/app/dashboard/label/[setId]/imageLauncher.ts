/** Add an image inspect action (+) to SPL HTML, which is rendered outside React. */
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
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'btn-analyze-image btn-image-inspect';
    action.textContent = '+';
    action.title = `Inspect image: ${filename} (Extract, Compare, Analyze)`;
    action.setAttribute('aria-label', `Inspect image ${filename}`);

    action.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(
        new CustomEvent('open-image-preview', {
          detail: {
            src: image.src || source,
            filename,
            setId,
            splId: splId || undefined,
          },
        })
      );
    });

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
