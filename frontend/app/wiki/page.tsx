'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import Link from 'next/link';
import Footer from '../components/Footer';
import { useUser } from '../context/UserContext';
import { getHandbookParts, HandbookTopic, HandbookPart } from './wikiData';

export default function WikiPage() {
  const { session } = useUser();
  const apiHost = session?.api_server_host || process.env.NEXT_PUBLIC_API_SERVER_HOST || 'ncshpcgpu01.fda.gov';
  const parts = useMemo(() => getHandbookParts(apiHost), [apiHost]);

  // Flattened ordered array of all topics
  const allTopics = useMemo(() => {
    return parts.flatMap((p) => p.sections.flatMap((s) => s.topics));
  }, [parts]);

  // States
  const [activeTopicId, setActiveTopicId] = useState<string>(allTopics[0]?.id || '1-1-account-login');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const contentRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcut: Ctrl+K / Cmd+K focus on search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('handbook-search-input')?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filtered parts and topics based on search
  const q = searchQuery.toLowerCase().trim();

  const filteredParts = useMemo(() => {
    if (!q) return parts;
    return parts
      .map((part) => ({
        ...part,
        sections: part.sections
          .map((sec) => ({
            ...sec,
            topics: sec.topics.filter(
              (t) =>
                t.number.toLowerCase().includes(q) ||
                t.title.toLowerCase().includes(q) ||
                t.summary.toLowerCase().includes(q) ||
                t.sectionTitle.toLowerCase().includes(q) ||
                t.tags.some((tag) => tag.toLowerCase().includes(q))
            ),
          }))
          .filter((sec) => sec.topics.length > 0),
      }))
      .filter((part) => part.sections.length > 0);
  }, [parts, q]);

  // Total matching topics
  const totalMatches = useMemo(() => {
    return filteredParts.reduce(
      (acc, p) => acc + p.sections.reduce((sAcc, s) => sAcc + s.topics.length, 0),
      0
    );
  }, [filteredParts]);

  // Active topic object
  const activeTopic = useMemo(() => {
    return allTopics.find((t) => t.id === activeTopicId) || allTopics[0];
  }, [allTopics, activeTopicId]);

  // Linear Pager (Previous / Next)
  const currentIndex = allTopics.findIndex((t) => t.id === activeTopic?.id);
  const prevTopic = currentIndex > 0 ? allTopics[currentIndex - 1] : null;
  const nextTopic = currentIndex < allTopics.length - 1 ? allTopics[currentIndex + 1] : null;

  // Topic Selection Handler
  const selectTopic = (id: string) => {
    setActiveTopicId(id);
    if (contentRef.current) {
      contentRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const toggleSection = (sectionId: string) => {
    setCollapsedSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }));
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* Minimalist Top Brand Bar */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          padding: '0.75rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1rem', fontWeight: 800, color: '#002e5d', letterSpacing: '-0.01em' }}>
            AskFDALabel Handbook
          </span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#475569',
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              padding: '1px 6px',
              borderRadius: '4px',
            }}
          >
            v5.0
          </span>
        </div>

        <Link
          href="/dashboard"
          style={{
            fontSize: '0.8rem',
            fontWeight: 600,
            color: '#002e5d',
            textDecoration: 'none',
            padding: '5px 12px',
            borderRadius: '6px',
            border: '1px solid #cbd5e1',
            background: '#ffffff',
          }}
        >
          &larr; Return to Application
        </Link>
      </header>

      {/* Two-Column Handbook Body */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          maxWidth: '1440px',
          width: '100%',
          margin: '0 auto',
          padding: '1.5rem',
          gap: '2rem',
          boxSizing: 'border-box',
          alignItems: 'flex-start',
          flex: 1,
        }}
      >
        {/* LEFT COLUMN: Sidebar Index (320px fixed) */}
        <aside
          style={{
            width: '320px',
            minWidth: '300px',
            maxWidth: '340px',
            flexShrink: 0,
            position: 'sticky',
            top: '72px',
            maxHeight: 'calc(100vh - 96px)',
            overflowY: 'auto',
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '1rem',
            boxSizing: 'border-box',
          }}
        >
          {/* Search Box on top of Left Index */}
          <div style={{ marginBottom: '1rem', position: 'relative' }}>
            <input
              id="handbook-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search index (Ctrl+K)..."
              style={{
                width: '100%',
                padding: '7px 28px 7px 10px',
                fontSize: '0.82rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                outline: 'none',
                background: '#f8fafc',
                color: '#0f172a',
                boxSizing: 'border-box',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute',
                  right: '8px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  fontSize: '0.75rem',
                }}
              >
                ✕
              </button>
            )}
            {q && (
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '4px', paddingLeft: '2px' }}>
                {totalMatches} matching topic{totalMatches !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Section Index Tree */}
          {filteredParts.length === 0 ? (
            <div style={{ padding: '1.5rem 0.5rem', textAlign: 'center', color: '#64748b', fontSize: '0.8rem' }}>
              No topics matched &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {filteredParts.map((part) => (
                <div key={part.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {/* Part Title Header */}
                  <div
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: '#002e5d',
                      borderBottom: '1px solid #e2e8f0',
                      paddingBottom: '4px',
                    }}
                  >
                    {part.title}
                  </div>

                  {/* Sections */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {part.sections.map((sec) => {
                      const isCollapsed = collapsedSections[sec.id] && !q;
                      return (
                        <div key={sec.id}>
                          {/* Section Header */}
                          <button
                            type="button"
                            onClick={() => toggleSection(sec.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              width: '100%',
                              padding: '4px 6px',
                              borderRadius: '4px',
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#1e293b' }}>
                              <span style={{ color: '#002e5d', marginRight: '6px' }}>{sec.number}</span>
                              {sec.title}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>
                              {isCollapsed ? '+' : '−'}
                            </span>
                          </button>

                          {/* Topic Links */}
                          {!isCollapsed && (
                            <div
                              style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '1px',
                                paddingLeft: '0.75rem',
                                borderLeft: '1.5px solid #e2e8f0',
                                marginLeft: '0.5rem',
                                marginTop: '2px',
                              }}
                            >
                              {sec.topics.map((t) => {
                                const isActive = t.id === activeTopic?.id;
                                return (
                                  <button
                                    key={t.id}
                                    type="button"
                                    onClick={() => selectTopic(t.id)}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      width: '100%',
                                      padding: '5px 8px',
                                      borderRadius: '4px',
                                      border: 'none',
                                      textAlign: 'left',
                                      cursor: 'pointer',
                                      fontSize: '0.78rem',
                                      lineHeight: 1.35,
                                      fontWeight: isActive ? 700 : 500,
                                      color: isActive ? '#002e5d' : '#475569',
                                      background: isActive ? '#eff6ff' : 'transparent',
                                      borderLeft: isActive ? '3px solid #002e5d' : '3px solid transparent',
                                    }}
                                  >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      <span style={{ color: isActive ? '#002e5d' : '#64748b', marginRight: '5px', fontWeight: 600 }}>
                                        {t.number}
                                      </span>
                                      {t.title}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>

        {/* RIGHT COLUMN: Main Content Area (flex: 1) */}
        <main
          ref={contentRef}
          style={{
            flex: 1,
            minWidth: 0,
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            padding: '2rem 2.5rem',
            boxSizing: 'border-box',
          }}
        >
          {activeTopic ? (
            <div>
              {/* Breadcrumb Path */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '8px',
                  marginBottom: '0.75rem',
                  fontSize: '0.75rem',
                  color: '#64748b',
                }}
              >
                <div>
                  <span>{activeTopic.partTitle}</span>
                  <span style={{ margin: '0 6px' }}>/</span>
                  <span>{activeTopic.sectionNumber} {activeTopic.sectionTitle}</span>
                  <span style={{ margin: '0 6px' }}>/</span>
                  <span style={{ color: '#002e5d', fontWeight: 600 }}>{activeTopic.number}</span>
                </div>

                {activeTopic.toolLink && (
                  <Link
                    href={activeTopic.toolLink.href}
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: '#002e5d',
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      padding: '3px 10px',
                      borderRadius: '5px',
                      textDecoration: 'none',
                    }}
                  >
                    Open {activeTopic.toolLink.label} &rarr;
                  </Link>
                )}
              </div>

              {/* Title with Numeric Index */}
              <h1
                style={{
                  fontSize: '1.6rem',
                  fontWeight: 800,
                  color: '#0f172a',
                  margin: '0 0 0.5rem 0',
                  lineHeight: 1.3,
                  letterSpacing: '-0.01em',
                }}
              >
                <span style={{ color: '#002e5d', marginRight: '8px' }}>{activeTopic.number}</span>
                {activeTopic.title}
              </h1>

              {/* Summary Lead */}
              <p style={{ fontSize: '0.92rem', color: '#475569', margin: '0 0 1rem 0', lineHeight: 1.55 }}>
                {activeTopic.summary}
              </p>

              {/* Metadata Tags */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: '4px',
                  marginBottom: '1.5rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                {activeTopic.badge && (
                  <span
                    style={{
                      fontSize: '0.68rem',
                      fontWeight: 700,
                      background: '#f1f5f9',
                      color: '#334155',
                      border: '1px solid #cbd5e1',
                      padding: '1px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    {activeTopic.badge}
                  </span>
                )}
                {activeTopic.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSearchQuery(tag)}
                    style={{
                      fontSize: '0.68rem',
                      color: '#64748b',
                      background: 'transparent',
                      border: '1px solid #e2e8f0',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                    }}
                  >
                    #{tag}
                  </button>
                ))}
              </div>

              {/* Topic Article Content */}
              <div style={{ fontSize: '0.9rem', color: '#1e293b', lineHeight: 1.65 }}>
                {activeTopic.content}
              </div>

              {/* Linear Pager Navigation */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: '2.5rem',
                  paddingTop: '1.25rem',
                  borderTop: '1px solid #e2e8f0',
                  flexWrap: 'wrap',
                  gap: '12px',
                }}
              >
                {prevTopic ? (
                  <button
                    type="button"
                    onClick={() => selectTopic(prevTopic.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      maxWidth: '260px',
                    }}
                  >
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b' }}>
                      &larr; Previous [{prevTopic.number}]
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#002e5d', marginTop: '2px' }}>
                      {prevTopic.title}
                    </span>
                  </button>
                ) : (
                  <div />
                )}

                {nextTopic ? (
                  <button
                    type="button"
                    onClick={() => selectTopic(nextTopic.id)}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      cursor: 'pointer',
                      textAlign: 'right',
                      maxWidth: '260px',
                    }}
                  >
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#64748b' }}>
                      Next [{nextTopic.number}] &rarr;
                    </span>
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#002e5d', marginTop: '2px' }}>
                      {nextTopic.title}
                    </span>
                  </button>
                ) : (
                  <div />
                )}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: '#64748b' }}>
              Select a section from the index on the left.
            </div>
          )}
        </main>
      </div>

      <Footer />
    </div>
  );
}
