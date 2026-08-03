'use client';

/*
 * askFDALabel v5 — primitives.
 *
 * Thin, unopinionated wrappers over the classes in primitives.css. They exist
 * so pages stop hand-rolling spacing and color with inline styles. Each one
 * forwards className and the rest of its native props, so a page can migrate
 * incrementally without losing an escape hatch.
 */

import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
} from 'react';
import './primitives.css';

/**
 * The one className-joining helper for the app. Previously redefined per
 * file (Header.tsx had its own copy) — exported here so there is a single
 * implementation to import instead of another copy-paste.
 */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

/* ---- Page --------------------------------------------------------------- */

export function Page({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('afl-page', className)} {...rest} />;
}

export function PageBody({
  width = 'default',
  flush = false,
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { width?: 'default' | 'wide'; flush?: boolean }) {
  return (
    <main
      className={cx(
        'afl-page-body',
        width === 'wide' && 'afl-page-body--wide',
        flush && 'afl-page-body--flush',
        className,
      )}
      {...rest}
    />
  );
}

/* ---- Section header ------------------------------------------------------ */

export function SectionHeader({
  title,
  description,
  actions,
  as: Heading = 'h2',
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  as?: 'h1' | 'h2' | 'h3';
}) {
  return (
    <div className={cx('afl-section-header', className)} {...rest}>
      <div className="afl-section-header__text">
        <Heading className="afl-section-header__title">{title}</Heading>
        {description ? <p className="afl-section-header__desc">{description}</p> : null}
      </div>
      {actions ? <div className="afl-toolbar__group">{actions}</div> : null}
    </div>
  );
}

/* ---- Card ---------------------------------------------------------------- */

export function Card({
  flush = false,
  quiet = false,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { flush?: boolean; quiet?: boolean }) {
  return (
    <div
      className={cx(
        'afl-card',
        flush && 'afl-card--flush',
        quiet && 'afl-card--quiet',
        className,
      )}
      {...rest}
    />
  );
}

/*
 * Interactive cards render as a real <button> or <a> rather than a clickable
 * <div>, so they are keyboard-reachable and announce correctly. Several
 * existing pages use onClick-on-div; prefer this when migrating them.
 */
export function CardButton({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx('afl-card', 'afl-card--interactive', className)}
      {...rest}
    />
  );
}

export function CardLink({
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={cx('afl-card', 'afl-card--interactive', className)} {...rest} />;
}

/* ---- Grid ---------------------------------------------------------------- */

export function Grid({
  min = '240px',
  className,
  style,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { min?: string }) {
  return (
    <div
      className={cx('afl-grid', className)}
      style={{ ['--afl-grid-min' as string]: min, ...style }}
      {...rest}
    />
  );
}

/* ---- Toolbar ------------------------------------------------------------- */

export function Toolbar({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('afl-toolbar', className)} {...rest} />;
}

export function ToolbarGroup({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('afl-toolbar__group', className)} {...rest} />;
}

/* ---- Button -------------------------------------------------------------- */

type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  | 'success'
  | 'tint-success'
  | 'tint-danger';
type ButtonSize = 'sm' | 'md' | 'lg';

function buttonClass(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cx(
    'afl-btn',
    `afl-btn--${variant}`,
    size !== 'md' && `afl-btn--${size}`,
    className,
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <button type="button" className={buttonClass(variant, size, className)} {...rest} />;
}

export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}

/* ---- Tabs ---------------------------------------------------------------- */

/*
 * Presentational only — the caller owns selection state and decides whether a
 * tab is a button or a link. Phase 2 uses link tabs so label tools are
 * addressable URLs rather than local state.
 */
export function Tabs({
  label,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  return <div role="tablist" aria-label={label} className={cx('afl-tabs', className)} {...rest} />;
}

export function Tab({
  selected = false,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={cx('afl-tab', className)}
      {...rest}
    />
  );
}

export function TabLink({
  selected = false,
  className,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { selected?: boolean }) {
  return (
    <a
      role="tab"
      aria-selected={selected}
      className={cx('afl-tab', className)}
      {...rest}
    />
  );
}

/* ---- Field --------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className={cx('afl-field', className)} {...rest}>
      <label className="afl-field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <span className="afl-field__error">{error}</span>
      ) : hint ? (
        <span className="afl-field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('afl-input', className)} {...rest} />;
}

export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx('afl-select', className)} {...rest} />;
}

/* ---- Badge --------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'accent' | 'info' | 'success' | 'warn' | 'danger' | 'ai';

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cx('afl-badge', `afl-badge--${tone}`, className)} {...rest} />;
}

/* ---- Empty state --------------------------------------------------------- */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={cx('afl-empty', className)} {...rest}>
      {icon ? (
        <span className="afl-empty__icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <h3 className="afl-empty__title">{title}</h3>
      {description ? <p className="afl-empty__desc">{description}</p> : null}
      {action}
    </div>
  );
}
