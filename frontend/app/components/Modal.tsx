'use client';

import React, { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  compact?: boolean;
}

export default function Modal({ isOpen, onClose, title, children, compact = false }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const mouseDownTarget = useRef<EventTarget | null>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleMouseDown = (e: React.MouseEvent) => {
    mouseDownTarget.current = e.target;
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (
      mouseDownTarget.current === overlayRef.current &&
      e.target === overlayRef.current
    ) {
      onClose();
    }
    mouseDownTarget.current = null;
  };

  return (
    <div 
      ref={overlayRef}
      className="modal-overlay" 
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      style={{ zIndex: 2000 }} // Keep z-index here to ensure it's on top
    >
      <div 
        className="modal-content animate-modal-enter"
        onClick={(e) => e.stopPropagation()}
        style={compact ? { maxWidth: '500px' } : {}}
      >
        <div className="modal-header" style={compact ? { padding: '1rem 1.25rem', borderBottom: 'none' } : {}}>
          <h3 style={{ 
            margin: 0, 
            fontSize: compact ? '1.1rem' : '1.25rem', 
            fontWeight: compact ? 700 : 800, 
            color: 'var(--fdl-navy-950, #071f3d)',
            letterSpacing: '-0.01em'
          }}>{title}</h3>
          <button 
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'var(--fdl-paper, #ffffff)',
              border: '1px solid var(--fdl-line, #b8c8d7)',
              borderRadius: 'var(--fdl-radius-sm, 2px)',
              width: compact ? '26px' : '30px',
              height: compact ? '26px' : '30px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--fdl-ink-soft, #273843)',
            }}
          >
            <svg width={compact ? "14" : "18"} height={compact ? "14" : "18"} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div className="modal-body" style={compact ? { padding: '0 1.25rem 1.25rem 1.25rem' } : {}}>
          {children}
        </div>
      </div>
    </div>
  );
}
