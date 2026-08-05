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
            background: '#ffffff',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
            padding: '2.5rem',
          }}
        >
          {/* Header Badge & Title */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
            <div
              style={{
                width: '44px',
                height: '44px',
                borderRadius: '12px',
                background: '#eff6ff',
                color: '#2563eb',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#0f172a' }}>
                FDALabel Disclaimer
              </h1>
              <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600 }}>
                U.S. Food and Drug Administration (FDA) / NCTR
              </span>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #f1f5f9', margin: '1.5rem 0' }} />

          {/* Section 1: Purpose */}
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>
              1. Purpose and Scope
            </h2>
            <p style={{ fontSize: '0.92rem', color: '#334155', lineHeight: 1.6, margin: 0 }}>
              <strong>FDALabel</strong> is a web-based application developed by the U.S. Food and Drug Administration (FDA) National Center for Toxicological Research (NCTR). It is designed to perform customization, structured query, and visualization of human and animal drug labeling metadata derived from official FDA labeling sources.
            </p>
          </section>

          {/* Section 2: Medical & Legal Disclaimer */}
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>
              2. Medical and Legal Notice
            </h2>
            <div
              style={{
                background: '#f8fafc',
                borderLeft: '4px solid #2563eb',
                padding: '1.25rem',
                borderRadius: '0 8px 8px 0',
                marginBottom: '1rem',
              }}
            >
              <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem', color: '#334155', lineHeight: 1.65 }}>
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
          <section style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.75rem' }}>
              3. Official Resources & Contact
            </h2>
            <p style={{ fontSize: '0.92rem', color: '#334155', lineHeight: 1.6, marginBottom: '1rem' }}>
              For official FDA prescribing information, please consult official FDA drug approval documentation, DailyMed, or contact the relevant drug application sponsor.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '1.25rem' }}>
              <a
                href="https://www.fda.gov/ScienceResearch/BioinformaticsTools/ucm289739.htm"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  background: '#f1f5f9',
                  color: '#1e293b',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  border: '1px solid #cbd5e1',
                }}
              >
                <span>🌐</span> FDA Bioinformatics Tools Page ↗
              </a>
              <a
                href="https://nctr-crs.fda.gov/fdalabel/ui/contact"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '10px 16px',
                  borderRadius: '8px',
                  background: '#2563eb',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  textDecoration: 'none',
                  boxShadow: '0 2px 6px rgba(37, 99, 235, 0.25)',
                }}
              >
                <span>✉️</span> Contact FDALabel ↗
              </a>
            </div>
          </section>
        </div>
      </main>

      <Footer />
    </Page>
  );
}
