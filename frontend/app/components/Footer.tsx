'use client';

export default function Footer() {
  return (
    <footer
      style={{
        backgroundColor: '#002e5d',
        color: 'white',
        padding: '0.5rem 2rem',
        marginTop: '0',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        borderTop: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div style={{ maxWidth: '800px', opacity: 0.8, fontSize: '0.875rem' }}>
        <p style={{ marginBottom: '0.5rem', lineHeight: 1.6, color: 'white' }}>
          <strong>AskFDALabel</strong> &copy; 2026. FDA/NCTR{' '}
          <strong>This is an on-going research effort that is not for official use yet.</strong>
        </p>
      </div>
    </footer>
  );
}
