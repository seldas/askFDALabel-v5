'use client';

import React from 'react';
import { withAppBase } from '../utils/appPaths';

interface StartPageProps {
  onLogin: () => void;
  onSignUp: () => void;
  onGuest: () => void;
}

export default function StartPage({ onLogin, onSignUp, onGuest }: StartPageProps) {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: '#f3f6f8',
      padding: '2rem'
    }}>
      <div style={{
        background: 'white',
        maxWidth: '600px',
        width: '100%',
        borderRadius: '0',
        boxShadow: 'none',
        padding: '3rem',
        border: '1px solid #b8c8d7',
        borderTop: '3px solid #071f3d'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <img 
            src={withAppBase("/askFDALabel_hero.png")}
            alt="AskFDALabel"
            style={{ maxWidth: '80%', height: 'auto', marginBottom: '1.5rem' }}
          />
          <h1 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#071f3d', marginBottom: '1rem' }}>
            Welcome to AskFDALabel
          </h1>
        </div>

        <div style={{
          background: '#fff1f1',
          border: '1px solid #f7d2d2',
          borderRadius: '0',
          borderTop: '3px solid #b50909',
          padding: '1rem 1.5rem',
          marginBottom: '2rem'
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: '#991b1b', margin: '0 0 0.5rem 0' }}>
            FDA Internal System Disclaimer
          </h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#7f1d1d', lineHeight: 1.5 }}>
            For authorized use only. Content may be subject to internal FDA policies. This tool is under development and subject to change without notice.  
          </p>
        </div>

        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: '0.95rem', color: '#475569', lineHeight: 1.6 }}>
            Login is required to use this system. If you do not have an account or just want to try it out, you can continue as a guest.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button 
            onClick={onLogin}
            style={{
              width: '100%',
              padding: '12px',
            background: '#0759a5',
              color: 'white',
              border: 'none',
            borderRadius: '2px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.2s'
            }}
            onMouseOver={(e) => e.currentTarget.style.background = '#071f3d'}
            onMouseOut={(e) => e.currentTarget.style.background = '#0759a5'}
          >
            Login
          </button>
          
            <button 
              onClick={onGuest}
              style={{
                width: '100%',
                padding: '12px',
                background: 'white',
                color: '#334155',
                border: '1px solid #b8c8d7',
                borderRadius: '2px',
                fontSize: '0.95rem',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = '#edf4fa';
                e.currentTarget.style.borderColor = '#0071bc';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = 'white';
                e.currentTarget.style.borderColor = '#b8c8d7';
              }}
            >
              Continue as Guest
            </button>
        </div>

        <div style={{ marginTop: '2rem', textAlign: 'center', fontSize: '0.9rem', color: '#64748b' }}>
          Don't have an account?{' '}
          <button 
            onClick={onSignUp}
            style={{
              background: 'none',
              border: 'none',
              color: '#0759a5',
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline'
            }}
          >
            Sign up
          </button>
        </div>
      </div>

      <div style={{ marginTop: '3rem', textAlign: 'center', fontSize: '0.85rem', color: '#94a3b8', maxWidth: '600px', lineHeight: '1.6' }}>
        AskFDALabel &copy; 2026. FDA/NCTR This is an on-going research effort that is not for official use yet.
        <br />
        Please contact us (<a href="mailto:Leihong.wu@fda.hhs.gov" style={{ color: '#0759a5', textDecoration: 'none' }}>Leihong.wu@fda.hhs.gov</a>) for more details about this project.
      </div>
    </div>
  );
}
