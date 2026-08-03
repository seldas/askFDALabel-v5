'use client';

/*
 * Context-first home.
 *
 * v5 reframes the app as a platform that routes people to the right labeling
 * analysis tool. The entry point is therefore context, not a tool: find a label
 * (or open a task), and the platform then offers what applies to it.
 *
 * The AI search box is still here, but as one way in rather than the whole
 * page — previously the hero *was* an AI chat box, so every session started by
 * asking a question even when the user already knew which label they wanted.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Header from './components/Header';
import Footer from './components/Footer';
import StartPage from './components/StartPage';
import { useUser } from './context/UserContext';
import { withAppBase } from './utils/appPaths';
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardButton,
  EmptyState,
  Grid,
  Page,
  PageBody,
  SectionHeader,
} from './platform/primitives';
import { ToolLauncher } from './platform/ToolLauncher';
import { labelRoute, type LaunchContext } from './platform/context';
import './home.css';

interface Project {
  id: number;
  title: string;
  role: string;
  count: number;
}

interface ChatHistoryItem {
  id: number;
  title: string;
  chat_data: any[];
  timestamp: string;
}

/** A row from /api/localquery/search. */
interface LabelHit {
  set_id: string;
  spl_id?: string;
  brand_name?: string | null;
  generic_name?: string | null;
  manufacturer?: string | null;
  market_category?: string | null;
  appr_num?: string | null;
  revised_date?: string | null;
  is_archived?: boolean;
}

const EXAMPLE_QUERIES = ['Tivicay', 'metformin', 'Ozempic', 'losartan'];

function formatTimestamp(ts: string) {
  try {
    const date = new Date(ts + (ts.endsWith('Z') ? '' : 'Z'));
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

export default function HomePage() {
  const router = useRouter();
  const { session, loading, refreshSession, openAuthModal } = useUser();

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LabelHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<LabelHit | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [histories, setHistories] = useState<ChatHistoryItem[]>([]);

  const isAuthed = Boolean(session?.is_authenticated);

  useEffect(() => {
    if (!isAuthed) return;
    let cancelled = false;

    (async () => {
      try {
        const [pRes, hRes] = await Promise.all([
          fetch('/api/dashboard/projects'),
          fetch('/api/search/history'),
        ]);
        const [p, h] = await Promise.all([pRes.json(), hRes.json()]);
        if (cancelled) return;
        setProjects((p.projects || []).slice(0, 4));
        setHistories((h.histories || []).slice(0, 4));
      } catch (err) {
        console.error('Failed to load recent work', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthed]);

  /*
   * Debounced label lookup. This is a structured search against the local
   * labeling tables, not the AI pipeline — establishing context should be fast
   * and deterministic.
   */
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (term: string) => {
    const trimmed = term.trim();
    if (trimmed.length < 2) {
      setHits(null);
      setSearching(false);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch(
        `/api/localquery/search?query=${encodeURIComponent(trimmed)}`,
      );
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const json = await res.json();
      setHits((json.results || []).slice(0, 8));
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : String(err));
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const askAi = useCallback(() => {
    const trimmed = query.trim();
    router.push(trimmed ? `/search?q=${encodeURIComponent(trimmed)}` : '/search');
  }, [query, router]);

  const openHistory = useCallback(
    (h: ChatHistoryItem) => {
      if (!h.chat_data?.length) return;
      sessionStorage.setItem('initial_history_chat', JSON.stringify(h.chat_data));
      sessionStorage.setItem('initial_history_id', String(h.id));
      router.push('/search');
    },
    [router],
  );

  const labelContext = useMemo<LaunchContext>(
    () => (selected ? { setIds: [selected.set_id] } : {}),
    [selected],
  );

  const handleGuestLogin = async () => {
    try {
      const res = await fetch('/api/dashboard/auth/guest-login', { method: 'POST' });
      if (res.ok) await refreshSession();
    } catch (err) {
      console.error('Guest login failed', err);
    }
  };

  if (!loading && !isAuthed) {
    return (
      <StartPage
        onLogin={() => openAuthModal('login')}
        onSignUp={() => openAuthModal('register')}
        onGuest={handleGuestLogin}
      />
    );
  }

  return (
    <Page>
      <Header />

      <PageBody>
        <section className="afl-home-hero">
          <img
            className="afl-home-hero__logo"
            src={withAppBase('/askFDALabel_hero.png')}
            alt="AskFDALabel"
          />
          <p className="afl-home-hero__lede">
            Start with a label or a task, then pick the analysis tool you need.
          </p>

          <div className="afl-finder">
            <div className="afl-finder__field">
              <input
                className="afl-finder__input"
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelected(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && hits?.length) setSelected(hits[0]);
                }}
                placeholder="Find a label — brand, generic, set ID, or application number"
                aria-label="Find a label"
              />
            </div>

            <div className="afl-finder__hint">
              <span className="afl-finder__status" role="status">
                {searching
                  ? 'Searching…'
                  : searchError
                    ? searchError
                    : hits
                      ? `${hits.length} label${hits.length === 1 ? '' : 's'} found`
                      : `Try ${EXAMPLE_QUERIES.join(', ')}`}
              </span>
              <Button variant="ghost" size="sm" onClick={askAi}>
                Ask AI about this instead →
              </Button>
            </div>

            {/* Context established: offer the tools that apply to it. */}
            {selected ? (
              <div className="afl-context">
                <div className="afl-context__head">
                  <div style={{ minWidth: 0 }}>
                    <span className="afl-context__eyebrow">Selected label</span>
                    <h2 className="afl-context__name">
                      {selected.brand_name || selected.generic_name || selected.set_id}
                    </h2>
                    <p className="afl-context__meta">
                      {[selected.generic_name, selected.manufacturer, selected.appr_num]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                    Clear
                  </Button>
                </div>
                <ToolLauncher
                  context={labelContext}
                  matchContexts={['label', 'labelSet']}
                  aria-label="Tools for this label"
                />
              </div>
            ) : hits && hits.length > 0 ? (
              <div className="afl-finder__results">
                {hits.map((hit) => (
                  <button
                    key={hit.set_id}
                    type="button"
                    className="afl-result"
                    onClick={() => setSelected(hit)}
                  >
                    <span className="afl-result__main">
                      <span className="afl-result__name">
                        {hit.brand_name || hit.generic_name || hit.set_id}
                      </span>
                      <span className="afl-result__meta">
                        {[hit.generic_name, hit.manufacturer, hit.revised_date]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                    <span className="afl-result__badges">
                      {hit.market_category ? (
                        <Badge tone="neutral">{hit.market_category}</Badge>
                      ) : null}
                      {hit.is_archived ? <Badge tone="warn">Archived</Badge> : null}
                    </span>
                  </button>
                ))}
              </div>
            ) : hits && hits.length === 0 && !searching ? (
              <div className="afl-finder__results">
                <EmptyState
                  title="No labels matched"
                  description="Try a brand or generic name, a set ID, or an application number. You can also ask the AI instead."
                  action={
                    <Button variant="primary" size="sm" onClick={askAi}>
                      Ask AI
                    </Button>
                  }
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="afl-home-section">
          <SectionHeader
            title="Your tasks"
            description="Groups of labels and saved comparisons."
            actions={
              <ButtonLink href={withAppBase('/dashboard')} variant="secondary" size="sm">
                View all
              </ButtonLink>
            }
          />
          {projects.length > 0 ? (
            <Grid min="230px">
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`/dashboard?projectId=${p.id}`}
                  style={{ textDecoration: 'none' }}
                >
                  <Card className="afl-card--interactive">
                    <h3 className="afl-home-card__title">{p.title}</h3>
                    <span className="afl-home-card__meta">
                      {p.count} labels · {p.role.toUpperCase()}
                    </span>
                  </Card>
                </Link>
              ))}
            </Grid>
          ) : (
            <EmptyState
              title="No tasks yet"
              description="Group labels into a task to compare them, track adverse events, and save notes."
              action={
                <ButtonLink href={withAppBase('/dashboard')} variant="primary" size="sm">
                  Go to dashboard
                </ButtonLink>
              }
            />
          )}
        </section>

        <section className="afl-home-section">
          <SectionHeader
            title="Recent conversations"
            actions={
              <ButtonLink href={withAppBase('/search')} variant="secondary" size="sm">
                Go to chat
              </ButtonLink>
            }
          />
          {histories.length > 0 ? (
            <Grid min="230px">
              {histories.map((h) => (
                <CardButton key={h.id} onClick={() => openHistory(h)}>
                  <h3 className="afl-home-card__title">{h.title}</h3>
                  <span className="afl-home-card__meta">
                    {h.chat_data?.length || 0} messages · {formatTimestamp(h.timestamp)}
                  </span>
                </CardButton>
              ))}
            </Grid>
          ) : (
            <EmptyState
              title="No conversations yet"
              description="Ask a question about any label to start one."
            />
          )}
        </section>

        <section className="afl-home-section">
          <SectionHeader
            title="All tools"
            description="Browse everything available in this deployment."
            actions={
              <ButtonLink href={withAppBase('/tools')} variant="secondary" size="sm">
                Open directory
              </ButtonLink>
            }
          />
          <ToolLauncher context={{}} groups={['discover', 'analyze']} aria-label="Platform tools" />
        </section>
      </PageBody>

      <Footer />
    </Page>
  );
}
