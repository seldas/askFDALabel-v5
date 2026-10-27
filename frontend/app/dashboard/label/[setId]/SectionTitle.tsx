const UNCLASSIFIED_TOOLTIP = 'This section is not classified in the original SPL.';

export function isUnclassifiedTitle(title?: string) {
  // Includes the parser's shortened title and non-PLR numbering prefix.
  return /^(?:\d+(?:\.\d+)*\.?\s+)?(?:spl\s+)?unclassified(?:\s+section)?$/i.test((title || '').trim());
}

export default function SectionTitle({ title }: { title?: string }) {
  if (!title?.trim()) return null;
  if (!isUnclassifiedTitle(title)) return <>{title}</>;

  return (
    <span title={UNCLASSIFIED_TOOLTIP} aria-label={UNCLASSIFIED_TOOLTIP} tabIndex={0}
      style={{ display: 'inline-flex', color: 'var(--fdl-muted)', verticalAlign: 'middle', cursor: 'help' }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7v1" />
      </svg>
    </span>
  );
}
