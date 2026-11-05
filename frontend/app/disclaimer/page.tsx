'use client';

import React from 'react';
import Link from 'next/link';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { Page } from '../platform/primitives';

export default function DisclaimerPage() {
  return (
    <Page>
      <Header />

      <main className="fdl-shell" style={{ maxWidth: '900px', margin: '2rem auto', padding: '0 1rem' }}>
        <div
          style={{
            background: 'var(--fdl-paper, #ffffff)',
            borderRadius: 'var(--fdl-radius-sm, 2px)',
            border: '1px solid var(--fdl-line-soft, #d7e0e7)',
            borderTop: '3px solid var(--fdl-navy-800, #12375b)',
            padding: '2rem 2.5rem',
          }}
        >
          {/* Header Badge & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: 'var(--fdl-radius-sm, 2px)',
                background: 'var(--fdl-blue-050, #edf4fa)',
                color: 'var(--fdl-blue-700, #0759a5)',
                border: '1px solid var(--fdl-line-soft, #d7e0e7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)' }}>
                FDALabel Disclaimer
              </h1>
              <span style={{ fontSize: '0.825rem', color: 'var(--fdl-muted, #5e6e7c)', fontWeight: 600 }}>
                U.S. Food and Drug Administration (FDA) / NCTR
              </span>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--fdl-line-soft, #d7e0e7)', margin: '1.25rem 0' }} />

          {/* Section 1: Purpose */}
          <section style={{ marginBottom: '1.75rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '0.5rem' }}>
              1. Purpose and Scope
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--fdl-ink, #132332)', lineHeight: 1.6, margin: 0 }}>
              <strong>FDALabel</strong> is a web-based application developed by the U.S. Food and Drug Administration (FDA) National Center for Toxicological Research (NCTR). It is designed to perform customization, structured query, and visualization of human and animal drug labeling metadata derived from official FDA labeling sources.
            </p>
          </section>

          {/* Section 2: Medical & Legal Disclaimer */}
          <section style={{ marginBottom: '1.75rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '0.5rem' }}>
              2. Medical and Legal Notice
            </h2>
            <div
              style={{
                background: 'var(--fdl-canvas, #f3f6f8)',
                border: '1px solid var(--fdl-line-soft, #d7e0e7)',
                borderLeft: '3px solid var(--fdl-navy-800, #12375b)',
                padding: '1.25rem',
                borderRadius: 'var(--fdl-radius-sm, 2px)',
                marginBottom: '1rem',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem', color: 'var(--fdl-ink, #132332)', lineHeight: 1.65 }}>
                <li style={{ marginBottom: '0.5rem' }}>
                  <strong>Informational & Research Use Only:</strong> All information provided by FDALabel is intended strictly for educational, scientific research, and informational purposes.
                </li>
                <li style={{ marginBottom: '0.5rem' }}>
                  <strong>Not Medical Advice:</strong> Information available on this platform does not constitute medical, clinical, or legal advice, and must not be used as a substitute for professional clinical judgment, medical diagnosis, or treatment decisions.
                </li>
                <li>
                  <strong>Accuracy & Liability:</strong> While the FDA makes every reasonable effort to ensure the accuracy and completeness of the dataset, the agency assumes no legal responsibility or liability for the accuracy, completeness, or reliability of any information presented.
                </li>
              </ul>
            </div>
          </section>

          {/* Section 3: Official References & Contact */}
          <section style={{ marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--fdl-navy-950, #071f3d)', marginBottom: '0.5rem' }}>
              3. Official Resources & Contact
            </h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--fdl-ink, #132332)', lineHeight: 1.6, marginBottom: '1rem' }}>
              For official FDA prescribing information, please consult official FDA drug approval documentation, DailyMed, or contact the relevant drug application sponsor.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '1.25rem' }}>
              <a
                href="https://www.fda.gov/ScienceResearch/BioinformaticsTools/ucm289739.htm"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: 'var(--fdl-paper, #ffffff)',
                  color: 'var(--fdl-ink-soft, #273843)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  border: '1px solid var(--fdl-line, #b8c8d7)',
                }}
              >
                <span>🌐</span> FDA Bioinformatics Tools Page ↗
              </a>
              <a
                href="mailto:NCTRBioinformaticsSupport@fda.hhs.gov"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '8px 14px',
                  borderRadius: 'var(--fdl-radius-sm, 2px)',
                  background: 'var(--fdl-blue-700, #0759a5)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  border: '1px solid var(--fdl-blue-800, #004d80)',
                }}
              >
                <span>✉️</span> Report Technical Problems: NCTRBioinformaticsSupport@fda.hhs.gov
              </a>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </Page>
  );
}
