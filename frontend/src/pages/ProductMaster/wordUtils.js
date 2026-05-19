export function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns an array of segments: { type: 'plain'|'not_use'|'can_use'|'brand', text }
 * Longest match wins when phrases overlap.
 */
export function getSegments(text, suggestions = {}, activeKeywords = []) {
  if (!text) return [];

  const { not_use = [], can_use = [], brand = [] } = suggestions;
  const matches = [];

  const collect = (phrases, type) => {
    for (const phrase of phrases) {
      const p = phrase.trim();
      if (!p) continue;
      const re = new RegExp(escapeRegex(p), 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type, text: m[0] });
      }
    }
  };

  collect(not_use, 'not_use');
  collect(can_use, 'can_use');
  collect(brand,   'brand');
  collect(activeKeywords, 'keyword');

  // Sort: earlier start first; on tie, longer match first
  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  // Remove overlaps — first non-overlapping match wins
  const accepted = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      accepted.push(m);
      lastEnd = m.end;
    }
  }

  // Build plain+highlighted segments
  const segments = [];
  let pos = 0;
  for (const m of accepted) {
    if (pos < m.start) segments.push({ type: 'plain', text: text.slice(pos, m.start) });
    segments.push({ type: m.type, text: m.text });
    pos = m.end;
  }
  if (pos < text.length) segments.push({ type: 'plain', text: text.slice(pos) });

  return segments;
}

export function getDetected(segments) {
  return {
    not_use: segments.filter(s => s.type === 'not_use').map(s => s.text),
    can_use: segments.filter(s => s.type === 'can_use').map(s => s.text),
    brand:   segments.filter(s => s.type === 'brand').map(s => s.text),
  };
}

export function segmentsToHtml(segments) {
  return segments.map(seg => {
    const esc = escapeHtml(seg.text);
    if (seg.type === 'plain') return esc;
    return `<mark class="hl-${seg.type}">${esc}</mark>`;
  }).join('');
}
