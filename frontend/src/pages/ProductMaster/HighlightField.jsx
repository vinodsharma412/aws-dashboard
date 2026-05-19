import React, { useCallback, useMemo, useRef } from 'react';
import { getSegments, getDetected, segmentsToHtml } from './wordUtils';

const SHARED = {
  fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  fontSize:     '14px',
  lineHeight:   '1.5',
  padding:      '9px 12px',
  width:        '100%',
  boxSizing:    'border-box',
  border:       '1.5px solid transparent',
  borderRadius: '4px',
  whiteSpace:   'pre-wrap',
  wordWrap:     'break-word',
  overflowWrap: 'break-word',
  tabSize:      4,
};

const IND_CFG = {
  not_use: { icon: '🚫', label: 'Avoid', cls: 'hf-badge--not-use' },
  can_use: { icon: '✅', label: 'OK',    cls: 'hf-badge--can-use' },
  brand:   { icon: '™',  label: 'Brand', cls: 'hf-badge--brand'   },
};

export default function HighlightField({
  value = '',
  onChange,
  suggestions = {},
  activeKeywords = [],
  multiline = false,
  rows = 3,
  placeholder = '',
  maxLength,
}) {
  const inputRef    = useRef(null);
  const backdropRef = useRef(null);

  const segments = useMemo(() => getSegments(value, suggestions, activeKeywords), [value, suggestions, activeKeywords]);
  const detected = useMemo(() => getDetected(segments), [segments]);
  const hasAny   = detected.not_use.length + detected.can_use.length + detected.brand.length > 0;
  const isOver   = maxLength !== undefined && value.length > maxLength;

  const html = useMemo(() => segmentsToHtml(segments) + '\n', [segments]);

  const syncScroll = useCallback(() => {
    if (backdropRef.current && inputRef.current) {
      backdropRef.current.scrollTop  = inputRef.current.scrollTop;
      backdropRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  }, []);

  const borderColor = isOver ? 'var(--danger)' : 'var(--border)';

  const backdropStyle = {
    ...SHARED,
    position:      'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    color:         'transparent',
    background:    '#fff',
    pointerEvents: 'none',
    overflow:      'hidden',
    border:        '1.5px solid transparent',
  };

  const inputStyle = {
    ...SHARED,
    position:   'relative',
    background: 'transparent',
    color:      'var(--text)',
    outline:    'none',
    resize:     multiline ? 'vertical' : 'none',
    border:     `1.5px solid ${borderColor}`,
    display:    'block',
    // extra bottom padding so text doesn't sit under the counter
    paddingBottom: maxLength !== undefined ? '22px' : '9px',
    transition: 'border-color .18s ease, box-shadow .18s ease',
  };

  const focusBorder  = isOver ? 'var(--danger)' : 'var(--primary)';
  const focusShadow  = isOver
    ? '0 0 0 3px rgba(255,77,79,0.12)'
    : '0 0 0 3px rgba(24,144,255,0.12)';

  return (
    <div className="hf-row">
      {/* ── Left indicator ── */}
      <div className="hf-indicator">
        {hasAny
          ? Object.entries(IND_CFG).map(([type, cfg]) => {
              const words = detected[type];
              if (!words.length) return null;
              return (
                <div key={type} className={`hf-badge ${cfg.cls}`}
                     title={`${cfg.label}: ${words.join(', ')}`}>
                  <span className="hf-badge-icon">{cfg.icon}</span>
                  <span className="hf-badge-count">{words.length}</span>
                  <span className="hf-badge-label">{cfg.label}</span>
                </div>
              );
            })
          : <div className="hf-badge hf-badge--ok" title="No flagged words">✓</div>
        }
      </div>

      {/* ── Highlight wrapper ── */}
      <div style={{ position: 'relative', flex: 1 }}>
        <div
          ref={backdropRef}
          style={backdropStyle}
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {multiline ? (
          <textarea
            ref={inputRef}
            style={inputStyle}
            rows={rows}
            value={value}
            placeholder={placeholder}
            onChange={e => onChange(e.target.value)}
            onScroll={syncScroll}
            onFocus={e => { e.target.style.borderColor = focusBorder; e.target.style.boxShadow = focusShadow; }}
            onBlur={e  => { e.target.style.borderColor = borderColor; e.target.style.boxShadow = 'none'; }}
          />
        ) : (
          <input
            ref={inputRef}
            type="text"
            style={{ ...inputStyle, resize: 'none', whiteSpace: 'nowrap', overflow: 'hidden' }}
            value={value}
            placeholder={placeholder}
            onChange={e => onChange(e.target.value)}
            onFocus={e => { e.target.style.borderColor = focusBorder; e.target.style.boxShadow = focusShadow; }}
            onBlur={e  => { e.target.style.borderColor = borderColor; e.target.style.boxShadow = 'none'; }}
          />
        )}

        {/* Character counter — bottom-right inside the field */}
        {maxLength !== undefined && (
          <span style={{
            position:     'absolute',
            bottom:       5,
            right:        9,
            fontSize:     11,
            fontWeight:   isOver ? 700 : 400,
            color:        isOver ? 'var(--danger)' : 'var(--text-3)',
            pointerEvents:'none',
            background:   'rgba(255,255,255,0.88)',
            borderRadius: 3,
            padding:      '1px 5px',
            lineHeight:   1.4,
          }}>
            {value.length} / {maxLength}
          </span>
        )}
      </div>
    </div>
  );
}
