'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Footer from '../components/Footer';
import { ARTICLES, LEGACY_TOPICS, PATHS, SEARCH_CHAPTER_IDS, searchableText, toolName, type ReadingPath, type WikiArticle } from './wikiData';
import './wiki.css';
import { SearchWorkflow, CriteriaLogicExample } from './WikiSearchExamples';

const INDEX = new Map(ARTICLES.map(article => [article.id, article]));
const FEATURED = ['query-guide', 'saved-work', 'read-labeling', 'notes-guide', 'label-export-guide'];

export default function WikiPage() {
  const [route, setRoute] = useState('home');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'all' | ReadingPath>('all');
  const [retired, setRetired] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const main = useRef<HTMLElement>(null);
  const ready = useRef(false);

  useEffect(() => {
    const sync = () => {
      let requested = '';
      try { requested = decodeURIComponent(window.location.hash.slice(1)); } catch { requested = 'invalid-link'; }
      if (!requested) requested = new URLSearchParams(window.location.search).get('topic') || 'home';
      setRetired(requested === '10-1-device-clearances-recalls');
      const canonical = LEGACY_TOPICS[requested] || requested;
      if (canonical !== requested) {
        const url = new URL(window.location.href);
        url.searchParams.delete('topic');
        url.hash = canonical;
        window.history.replaceState(null, '', url);
      }
      setRoute(canonical);
      setQuery('');
      if (ready.current) {
        window.scrollTo({ top: 0, behavior: 'instant' });
        main.current?.focus({ preventScroll: true });
      }
      ready.current = true;
    };
    sync();
    window.addEventListener('hashchange', sync);
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); search.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('keydown', shortcut);
    };
  }, []);

  const article = INDEX.get(route);
  const activePath: ReadingPath | undefined = article?.path || (route === 'guides' || route === 'methods' ? route : undefined);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = useMemo(() => ARTICLES.filter(item => (scope === 'all' || item.path === scope) &&
    words.every(word => searchableText(item).includes(word))), [query, scope]);
  const pathMatches = ARTICLES.filter(item => item.path === activePath);
  const groups = [...new Set(pathMatches.map(item => item.group))];
  const pathArticles = groups.flatMap(group => pathMatches.filter(item => item.group === group));
  const inSearchChapter = SEARCH_CHAPTER_IDS.includes(route);
  const readingSequence = article?.toolId ? ARTICLES.filter(item => item.toolId === article.toolId) : inSearchChapter ? SEARCH_CHAPTER_IDS.map(id => INDEX.get(id)!) : pathArticles;
  const position = readingSequence.findIndex(item => item.id === article?.id);
  const previous = readingSequence[position - 1];
  const next = position >= 0 ? readingSequence[position + 1] : undefined;
  const searching = words.length > 0;

  useEffect(() => {
    document.title = `${article?.title || (searching ? 'Search' : activePath ? PATHS[activePath].title : 'Reviewer handbook')} | AskFDALabel`;
  }, [article, activePath, searching]);

  const articleLink = (item: WikiArticle, className = '') => <a key={item.id} className={className} href={`#${item.id}`} onClick={() => setQuery('')}>
    <span className="wiki-kind">{PATHS[item.path].short} / {item.group}{item.toolId && ` / ${toolName(item)}`}</span>
    <strong>{item.title}</strong><p>{item.summary}</p><span className="wiki-read">Read article →</span>
  </a>;

  return <div className="wiki-shell">
    <header className="wiki-masthead">
      <a href="#home" className="wiki-brand" onClick={() => setQuery('')}><span>AskFDALabel</span><strong>Reviewer handbook</strong></a>
      <nav aria-label="Handbook navigation">
        <a href="#guides" aria-current={activePath === 'guides' ? 'page' : undefined} onClick={() => setQuery('')}>Guides</a>
        <a href="#methods" aria-current={activePath === 'methods' ? 'page' : undefined} onClick={() => setQuery('')}>Data & methods</a>
        <Link href="/">Back to workspace ↗</Link>
      </nav>
    </header>
    <div className="wiki-layout">
      <aside className="wiki-sidebar" aria-label="Handbook index">
        <form role="search" onSubmit={event => { event.preventDefault(); main.current?.focus(); }}>
          <label htmlFor="wiki-search">Search the handbook</label>
          <div className="wiki-search-field"><input ref={search} id="wiki-search" type="search" placeholder="Task, term, or question…" value={query} onChange={event => setQuery(event.target.value)} />
            <kbd aria-hidden="true">Ctrl K</kbd></div>
          <label className="wiki-sr-only" htmlFor="wiki-search-scope">Search scope</label>
          <select id="wiki-search-scope" value={scope} onChange={event => setScope(event.target.value as typeof scope)}>
            <option value="all">Search both paths</option><option value="guides">Guides only</option><option value="methods">Data & methods only</option>
          </select>
        </form>
        <nav aria-label="Reading paths" className="wiki-path-nav">
          <a href="#home" onClick={() => setQuery('')} aria-current={route === 'home' ? 'page' : undefined}>Handbook home</a>
          {(Object.keys(PATHS) as ReadingPath[]).map(path => <a key={path} href={`#${path}`} onClick={() => setQuery('')} aria-current={activePath === path ? 'page' : undefined}>{PATHS[path].title}</a>)}
        </nav>
        {inSearchChapter && !searching && <nav className="wiki-topic-nav wiki-chapter-nav" aria-label="Search labeling chapter">
          <h2>Search labeling / chapter</h2>{SEARCH_CHAPTER_IDS.map((id, index) => <a key={id} href={`#${id}`} aria-current={route === id ? 'page' : undefined}><span className="wiki-chapter-number">{index + 1}</span>{INDEX.get(id)?.title}</a>)}
        </nav>}
        {activePath && !searching && <nav aria-label={`${PATHS[activePath].short} articles`} className="wiki-topic-nav">
          {groups.filter(group => !(inSearchChapter && group === 'Search labeling')).map(group => <div key={group}>
            <h2>{group}</h2>
            {[...new Set(pathArticles.filter(item => item.group === group).map(item => item.toolId || ''))].map(owner => <div key={owner} className={owner ? 'wiki-tool-section' : undefined}>
              {owner && <h3>{toolName(pathArticles.find(item => item.toolId === owner)!)}</h3>}
              {(owner ? ARTICLES.filter(item => item.toolId === owner) : pathArticles.filter(item => item.group === group && !item.toolId)).map(item =>
                <a href={`#${item.id}`} key={item.id} aria-current={route === item.id ? 'page' : undefined}>{item.title}{owner && <small className="wiki-tool-path">{PATHS[item.path].short}</small>}</a>)}
            </div>)}
          </div>)}
        </nav>}
        {!activePath && !searching && <div className="wiki-sidebar-note"><strong>For safety scientists and reviewers</strong><p>Practical workflows and explanations of evidence. Start with a task, then follow its methods links when you need more depth.</p></div>}
        <p className="wiki-search-status" role="status">{searching ? `${matches.length} matching article${matches.length === 1 ? '' : 's'}` : `${ARTICLES.length} articles across two reading paths`}</p>
      </aside>
      <main id="wiki-main" ref={main} tabIndex={-1} className="wiki-main">
        {searching ? <>
          <span className="wiki-eyebrow">HANDBOOK SEARCH</span><h1>Find guidance and explanations</h1><p className="wiki-lead">Results for “{query.trim()}” · {matches.length} articles</p>
          {matches.length ? <div className="wiki-search-results">{matches.map(item => <div key={item.id}>{articleLink(item, 'wiki-result')}
            <p className="wiki-search-excerpt">{item.sections.flatMap(section => [...(section.paragraphs || []), ...(section.steps || [])]).find(text => words.some(word => text.toLowerCase().includes(word))) || item.summary}</p>
          </div>)}</div> : <div className="wiki-empty"><h2>No matching articles</h2><p>Try a tool name, a broader term, or search both paths.</p><button type="button" onClick={() => { setQuery(''); setScope('all'); search.current?.focus(); }}>Clear search</button></div>}
        </> : article ? <>
          <nav className="wiki-breadcrumbs" aria-label="Breadcrumb"><a href="#home">Handbook</a><span>/</span><a href={`#${article.path}`}>{PATHS[article.path].short}</a><span>/ {article.group}</span>{article.toolId && <span>/ {toolName(article)}</span>}</nav>
          {retired && <p className="wiki-notice">The previous Device Intelligence article has been retired from the reviewer handbook. That tool is currently disabled in the tool catalog. This page explains feature availability.</p>}
          <article>
            <span className="wiki-eyebrow">{PATHS[article.path].short} / {article.group}{article.toolId && ` / ${toolName(article)}`}</span><h1>{article.title}</h1><p className="wiki-lead">{article.summary}</p>
            {article.action && <div className="wiki-action"><Link href={article.action.href}>{article.action.label} ↗</Link><span>Access depends on your account and installation.</span></div>}
            <nav className="wiki-onpage" aria-label="On this page"><strong>On this page</strong>{article.sections.map((section, index) => <button key={section.heading} type="button" onClick={() => document.getElementById(`wiki-section-${index}`)?.scrollIntoView({ behavior: 'auto', block: 'start' })}>{section.heading}</button>)}</nav>
            {article.sections.map((section, index) => <section className="wiki-article-section" id={`wiki-section-${index}`} key={section.heading}>
              <h2>{section.heading}</h2>{section.paragraphs?.map(text => <p key={text}>{text}</p>)}
              {section.steps && <ol>{section.steps.map(text => <li key={text}>{text}</li>)}</ol>}
              {section.illustration === 'search-workflow' && <SearchWorkflow />}
              {section.illustration === 'criteria-logic' && <CriteriaLogicExample />}
              {section.table && <div className="wiki-article-table"><table>
                <caption className="wiki-sr-only">{section.heading}</caption>
                <thead><tr>{section.table.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead>
                <tbody>{section.table.rows.map(row => <tr key={row[0]}>{row.map((cell, index) => index === 0 ? <th scope="row" key={index}>{cell}</th> : <td key={index}>{cell}</td>)}</tr>)}</tbody>
              </table></div>}
            </section>)}
            {article.references?.length && <section className="wiki-references"><h2>Sources and further reading</h2><ul>{article.references.map(reference => <li key={reference.href}><a href={reference.href} target="_blank" rel="noopener noreferrer">{reference.title} ↗</a></li>)}</ul></section>}
          </article>
          <section className="wiki-related" aria-labelledby="wiki-related-heading"><h2 id="wiki-related-heading">Continue your review</h2>{inSearchChapter ? <ul className="wiki-related-links">{article.related.map(id => INDEX.get(id)).filter((item): item is WikiArticle => Boolean(item)).map(item => <li key={item.id}><a href={`#${item.id}`}>{item.title} <span aria-hidden="true">→</span></a></li>)}</ul> : <div className="wiki-related-grid">{article.related.map(id => INDEX.get(id)).filter((item): item is WikiArticle => Boolean(item)).map(item => articleLink(item, 'wiki-related-card'))}</div>}</section>
          <nav className="wiki-pager" aria-label="Continue reading">{previous ? <a href={`#${previous.id}`}><span>← Previous {inSearchChapter ? 'in search chapter' : PATHS[article.path].short.toLowerCase()}</span><strong>{previous.title}</strong></a> : <span />}{next && <a href={`#${next.id}`}><span>Next {inSearchChapter ? 'in search chapter' : PATHS[article.path].short.toLowerCase()} →</span><strong>{next.title}</strong></a>}</nav>
        </> : route === 'home' ? <>
          <span className="wiki-eyebrow">EVIDENCE / INTERPRETATION / REVIEW</span><h1>From a review question<br />to traceable evidence.</h1><p className="wiki-lead">A handbook for drug safety scientists and reviewers. Learn how to complete a task, understand its results, and verify what supports your conclusions.</p>
          <div className="wiki-path-cards">{(Object.keys(PATHS) as ReadingPath[]).map((path, index) => <a key={path} href={`#${path}`} data-path={path}><span className="wiki-eyebrow">0{index + 1} / {PATHS[path].short}</span><h2>{PATHS[path].title}</h2><p>{PATHS[path].description}</p><strong>Explore this path →</strong></a>)}</div>
          <section className="wiki-start"><span className="wiki-eyebrow">NEW TO THE WORKSPACE?</span><h2>Start with one complete review</h2><p>Confirm the product and version, read the original evidence, choose an analysis, and save a record another reviewer can follow.</p><a href="#first-review">Follow the first-review guide →</a></section>
          <section className="wiki-featured"><h2>What do you need to do?</h2><div className="wiki-related-grid">{FEATURED.map(id => articleLink(INDEX.get(id)!, 'wiki-related-card'))}</div></section>
          <section className="wiki-questions"><h2>Questions about your results?</h2>{['no-results', 'evidence-types', 'versions', 'availability', 'waiting-results'].map(id => <a key={id} href={`#${id}`}>{INDEX.get(id)!.title}<span aria-hidden="true">→</span></a>)}</section>
        </> : activePath ? <>
          <span className="wiki-eyebrow">{PATHS[activePath].short}</span><h1>{PATHS[activePath].title}</h1><p className="wiki-lead">{PATHS[activePath].description}</p>
          {groups.map(group => <section className="wiki-group" key={group}><h2>{group}</h2>
            {[...new Set(pathArticles.filter(item => item.group === group).map(item => item.toolId || ''))].map(owner => <div key={owner} className="wiki-tool-section">
              {owner && <h3>{toolName(pathArticles.find(item => item.toolId === owner)!)}</h3>}
              <div className="wiki-related-grid">{(owner ? ARTICLES.filter(item => item.toolId === owner) : pathArticles.filter(item => item.group === group && !item.toolId)).map(item => articleLink(item, 'wiki-related-card'))}</div>
            </div>)}
          </section>)}
        </> : <div className="wiki-empty"><h1>Article not found</h1><p>This address does not match a handbook topic. Search for the subject or return to the handbook home.</p><a href="#home">Handbook home →</a></div>}
      </main>
    </div>
    <Footer />
  </div>;
}
