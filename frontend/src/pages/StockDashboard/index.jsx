import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { stockService } from '../../services/stockService';

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS    = ['Screener', 'Analyser', 'Portfolio', 'Watchlist'];
const PERIODS = ['1mo', '3mo', '6mo', '1y', '2y', '5y', 'max'];

const SIG_STYLE = {
  'Strong Buy':  { bg: '#f6ffed', color: '#237804', border: '#b7eb8f' },
  'Buy':         { bg: '#f6ffed', color: '#389e0d', border: '#b7eb8f' },
  'Hold':        { bg: '#fffbe6', color: '#ad6800', border: '#ffe58f' },
  'Sell':        { bg: '#fff2f0', color: '#cf1322', border: '#ffa39e' },
  'Strong Sell': { bg: '#fff1f0', color: '#820014', border: '#ffa39e' },
};

const SENT_STYLE = {
  Bullish: { color: '#237804', bg: '#f6ffed', icon: '▲' },
  Bearish: { color: '#cf1322', bg: '#fff2f0', icon: '▼' },
  Neutral: { color: '#595959', bg: '#f5f5f5', icon: '→' },
};

const ACTION_STYLE = {
  green:  { bg: '#f6ffed', color: '#237804', border: '#b7eb8f' },
  orange: { bg: '#fffbe6', color: '#ad6800', border: '#ffe58f' },
  red:    { bg: '#fff2f0', color: '#cf1322', border: '#ffa39e' },
  blue:   { bg: '#e6f4ff', color: '#096dd9', border: '#91caff' },
};

const EE_ACTION_COLOR = {
  'Strong Buy Now':    '#237804',
  'Buy / Accumulate':  '#389e0d',
  'Hold & Accumulate': '#096dd9',
  'Hold':              '#ad6800',
  'Wait for Dip':      '#ad6800',
  'Book Profits':      '#cf1322',
};

const IMPACT_STYLE = {
  positive: { bg: '#f6ffed', color: '#237804', border: '#b7eb8f' },
  negative: { bg: '#fff2f0', color: '#cf1322', border: '#ffa39e' },
  neutral:  { bg: '#f5f5f5', color: '#595959', border: '#d9d9d9' },
  mixed:    { bg: '#fffbe6', color: '#ad6800', border: '#ffe58f' },
};

// ── Formatters ────────────────────────────────────────────────────────────────

const fmt    = (n, d = 2) => n == null ? '—' : Number(n).toFixed(d);
const fmtC   = (n) => n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const fmtM   = (n) => {
  if (n == null) return '—';
  if (n >= 1e12) return `₹${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `₹${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e7)  return `₹${(n / 1e7).toFixed(2)}Cr`;
  return `₹${n.toLocaleString('en-IN')}`;
};
const fmtPct  = (n) => n == null ? '—' : `${Number(n * 100).toFixed(2)}%`;
const fmtChg  = (n) => n == null ? '' : `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}%`;
const chgClr  = (n) => n == null ? '' : n >= 0 ? '#237804' : '#cf1322';

const fmtGlobal = (m) => {
  if (m.price == null) return '—';
  if (m.region === 'FX')        return m.price.toFixed(2);
  if (m.region === 'Commodity') return `$${m.price.toFixed(2)}`;
  if (m.currency === 'INR')     return `₹${m.price.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  return m.price.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

// ── Base components ───────────────────────────────────────────────────────────

function Spinner({ sm } = {}) {
  return <span className={`spinner${sm ? ' spinner--sm' : ''}`} />;
}

function SignalBadge({ signal }) {
  const s = SIG_STYLE[signal] || SIG_STYLE['Hold'];
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 10px', borderRadius: 999,
      fontSize: 12, fontWeight: 700,
      background: s.bg, color: s.color, border: `1px solid ${s.border}`,
    }}>{signal}</span>
  );
}

function GaugeBar({ value, min = 0, max = 100, label, thresholds }) {
  const pct   = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
  const color = thresholds
    ? value < thresholds[0] ? '#237804' : value < thresholds[1] ? '#faad14' : '#cf1322'
    : '#1890ff';
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontWeight: 700, color }}>{fmt(value)}</span>
      </div>
      <div style={{ height: 7, background: 'var(--border-light)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
    </div>
  );
}

function InfoRow({ label, value, valueStyle }) {
  return (
    <div className="stock-info-row">
      <span className="stock-info-label">{label}</span>
      <span className="stock-info-value" style={valueStyle}>{value ?? '—'}</span>
    </div>
  );
}

// ── Global Market Bar ─────────────────────────────────────────────────────────

function GlobalMarketBar() {
  const [markets, setMarkets] = useState([]);
  useEffect(() => {
    stockService.globalMarkets()
      .then(r => setMarkets(r.data || []))
      .catch(() => {});
  }, []);
  if (markets.length === 0) return null;
  return (
    <div className="market-bar">
      <div className="market-bar-scroll">
        {markets.map(m => (
          <div key={m.symbol} className="market-bar-item">
            <span className="market-bar-flag">{m.flag}</span>
            <span className="market-bar-name">{m.name}</span>
            {m.price != null ? (
              <>
                <span className="market-bar-price">{fmtGlobal(m)}</span>
                <span className="market-bar-chg" style={{ color: chgClr(m.change_pct) }}>
                  {m.change_pct != null ? `${m.change_pct >= 0 ? '+' : ''}${m.change_pct.toFixed(2)}%` : '—'}
                </span>
              </>
            ) : <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>—</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Load phase progress ───────────────────────────────────────────────────────

function LoadPhases({ status }) {
  const phases = [
    { key: 'basic',     label: 'Quick Quote'   },
    { key: 'analysis',  label: 'Full Analysis' },
    { key: 'sentiment', label: 'News Sentiment' },
  ];
  if (phases.every(p => ['done', 'error'].includes(status[p.key]))) return null;
  return (
    <div className="load-phases">
      {phases.map(({ key, label }) => {
        const s = status[key];
        return (
          <div key={key} className={`load-phase load-phase--${s}`}>
            <span className="load-phase-dot" />
            <span className="load-phase-label">{label}</span>
            {s === 'loading' && <Spinner sm />}
            {s === 'done'    && <span style={{ color: '#237804' }}>✓</span>}
            {s === 'pending' && <span style={{ fontSize: 11 }}>⏳</span>}
            {s === 'error'   && <span style={{ color: '#cf1322' }}>✗</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Entry / Exit timing card ──────────────────────────────────────────────────

function EntryExitCard({ ee, cur }) {
  if (!ee || !ee.action) return null;
  const acColor = EE_ACTION_COLOR[ee.action] || '#595959';
  const rrOk    = (ee.rr_ratio || 0) >= 1.5;

  return (
    <div className="ee-card">
      <div className="ee-card-top">
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📍 Entry / Exit Strategy
          </span>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)' }}>
            {ee.trade_type} · <strong style={{ color: 'var(--text)' }}>{ee.duration}</strong>
          </div>
        </div>
        <span className="ee-action-badge" style={{ background: acColor }}>
          {ee.action}
        </span>
      </div>

      <div className="ee-timing">{ee.buy_timing}</div>

      <div className="ee-zones">
        <div className="ee-zone ee-zone--buy">
          <div className="ee-zone-lbl">Buy Zone</div>
          <div className="ee-zone-range">
            ₹{ee.buy_zone_low?.toLocaleString('en-IN')}
            <span style={{ color: 'var(--text-3)', margin: '0 4px' }}>–</span>
            ₹{ee.buy_zone_high?.toLocaleString('en-IN')}
          </div>
        </div>

        <div className="ee-zone ee-zone--t1">
          <div className="ee-zone-lbl">Target 1</div>
          <div className="ee-zone-range">₹{ee.target_1?.toLocaleString('en-IN')}</div>
          <div className="ee-zone-sub" style={{ color: '#237804' }}>+{ee.upside_1}% upside</div>
        </div>

        <div className="ee-zone ee-zone--t2">
          <div className="ee-zone-lbl">Target 2</div>
          <div className="ee-zone-range">₹{ee.target_2?.toLocaleString('en-IN')}</div>
          <div className="ee-zone-sub" style={{ color: '#237804' }}>+{ee.upside_2}% upside</div>
        </div>

        <div className="ee-zone ee-zone--stop">
          <div className="ee-zone-lbl">Stop Loss</div>
          <div className="ee-zone-range" style={{ color: '#cf1322' }}>₹{ee.stop_loss?.toLocaleString('en-IN')}</div>
          <div className="ee-zone-sub" style={{ color: '#cf1322' }}>-{ee.downside_risk}% risk</div>
        </div>

        <div className="ee-zone ee-zone--rr" style={{ borderColor: rrOk ? '#b7eb8f' : '#ffa39e', background: rrOk ? '#f6ffed' : '#fff2f0' }}>
          <div className="ee-zone-lbl">Risk / Reward</div>
          <div className="ee-zone-range" style={{ color: rrOk ? '#237804' : '#cf1322' }}>
            1 : {ee.rr_ratio ?? '—'}
          </div>
          <div className="ee-zone-sub" style={{ color: rrOk ? '#237804' : '#cf1322' }}>
            {rrOk ? '✓ Tradeable' : '✗ Risk high'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Valuation card (Graham / Lynch / DCF) ─────────────────────────────────────

function ValuationCard({ val }) {
  if (!val) return null;
  const vcolMap = {
    'Deeply Undervalued': '#237804',
    'Undervalued':         '#389e0d',
    'Fairly Valued':       '#096dd9',
    'Slightly Overvalued': '#ad6800',
    'Overvalued':          '#cf1322',
    'N/A':                 '#8c8c8c',
  };
  const vcol = vcolMap[val.verdict] || '#8c8c8c';
  return (
    <div className="stock-detail-card">
      <h4 className="stock-detail-title">Valuation (Graham · Lynch · DCF)</h4>
      <div style={{ marginBottom: 12 }}>
        <span style={{
          padding: '3px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700,
          background: vcol + '18', color: vcol, border: `1px solid ${vcol}60`,
        }}>{val.verdict}</span>
      </div>
      <InfoRow label="Graham Number"     value={val.graham_number ? fmtC(val.graham_number) : '—'} />
      <InfoRow label="Margin of Safety"  value={val.margin_of_safety != null ? `${val.margin_of_safety}%` : '—'}
        valueStyle={{ fontWeight: 700, color: (val.margin_of_safety || 0) > 0 ? '#237804' : '#cf1322' }} />
      <InfoRow label="PEG Ratio"         value={val.peg_ratio != null ? fmt(val.peg_ratio, 2) : '—'}
        valueStyle={{ color: val.peg_ratio != null ? (val.peg_ratio < 1 ? '#237804' : val.peg_ratio > 2 ? '#cf1322' : 'var(--text)') : '' }} />
      <InfoRow label="EV / EBITDA"       value={val.ev_ebitda != null ? `${fmt(val.ev_ebitda, 1)}×` : '—'}
        valueStyle={{ color: val.ev_ebitda != null ? (val.ev_ebitda < 12 ? '#237804' : val.ev_ebitda > 25 ? '#cf1322' : 'var(--text)') : '' }} />
      <InfoRow label="FCF Yield"         value={val.fcf_yield != null ? `${val.fcf_yield}%` : '—'}
        valueStyle={{ color: (val.fcf_yield || 0) > 5 ? '#237804' : 'var(--text)' }} />
      <InfoRow label="Price / Sales"     value={val.price_to_sales != null ? `${fmt(val.price_to_sales, 2)}×` : '—'} />
      <InfoRow label="Book Value / Share"value={val.book_value_per_share ? fmtC(val.book_value_per_share) : '—'} />
      <InfoRow label="Current Ratio"     value={val.current_ratio != null ? fmt(val.current_ratio, 2) : '—'}
        valueStyle={{ color: val.current_ratio != null ? (val.current_ratio >= 1.5 ? '#237804' : '#cf1322') : '' }} />
      <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 10, lineHeight: 1.5 }}>
        {val.source_note}
      </p>
    </div>
  );
}

// ── Advanced technical indicators panel ───────────────────────────────────────

function AdvancedTechPanel({ tech }) {
  if (!tech || !Object.keys(tech).length) return null;
  const fibLevels = [23.6, 38.2, 50.0, 61.8, 78.6]
    .map(l => ({ label: `${l}%`, value: tech[`fib_${l}`] }))
    .filter(f => f.value);

  return (
    <div className="adv-tech-wrapper">
      <h4 className="stock-detail-title" style={{ gridColumn: '1/-1', marginBottom: 0 }}>
        Advanced Technical Indicators
      </h4>

      {/* Oscillators */}
      <div className="stock-detail-card">
        <h5 className="adv-tech-sub">Oscillators</h5>
        <GaugeBar label="Stochastic %K" value={tech.stoch_k ?? 50} min={0} max={100} thresholds={[25, 75]} />
        <GaugeBar label="Stochastic %D" value={tech.stoch_d ?? 50} min={0} max={100} thresholds={[25, 75]} />
        <GaugeBar label="Williams %R (abs)" value={Math.abs(tech.williams_r ?? 50)} min={0} max={100} thresholds={[20, 80]} />
        <InfoRow label="Williams %R"
          value={tech.williams_r != null ? fmt(tech.williams_r, 1) : '—'}
          valueStyle={{ color: tech.williams_r != null
            ? (tech.williams_r < -80 ? '#237804' : tech.williams_r > -20 ? '#cf1322' : 'var(--text)')
            : '' }} />
        <InfoRow label="ATR (volatility)" value={tech.atr != null ? fmtC(tech.atr) : '—'} />
        <InfoRow label="OBV Trend"
          value={tech.obv_trend ? tech.obv_trend.charAt(0).toUpperCase() + tech.obv_trend.slice(1) : '—'}
          valueStyle={{ color: tech.obv_trend === 'rising' ? '#237804' : '#cf1322', fontWeight: 700 }} />
        <InfoRow label="BB Width (volatility)"
          value={tech.bb_width != null ? `${(tech.bb_width * 100).toFixed(2)}%` : '—'} />
        <InfoRow label="MACD Histogram"
          value={tech.macd_histogram != null ? fmt(tech.macd_histogram, 4) : '—'}
          valueStyle={{ color: (tech.macd_histogram || 0) > 0 ? '#237804' : '#cf1322' }} />
      </div>

      {/* Ichimoku + Cross */}
      <div className="stock-detail-card">
        <h5 className="adv-tech-sub">Ichimoku Cloud & Trend</h5>
        <InfoRow label="Ichimoku Signal"
          value={tech.ichimoku_signal
            ? tech.ichimoku_signal.charAt(0).toUpperCase() + tech.ichimoku_signal.slice(1)
            : '—'}
          valueStyle={{ fontWeight: 700,
            color: tech.ichimoku_signal === 'bullish' ? '#237804'
                 : tech.ichimoku_signal === 'bearish' ? '#cf1322' : '#595959' }} />
        <InfoRow label="Tenkan (9-day)"  value={tech.tenkan ? fmtC(tech.tenkan) : '—'} />
        <InfoRow label="Kijun (26-day)"  value={tech.kijun  ? fmtC(tech.kijun)  : '—'} />
        <InfoRow label="MA Crossover"
          value={tech.cross === 'golden' ? '🌟 Golden Cross'
               : tech.cross === 'death'  ? '☠️ Death Cross' : '—'}
          valueStyle={{ fontWeight: 700,
            color: tech.cross === 'golden' ? '#237804' : tech.cross === 'death' ? '#cf1322' : 'var(--text)' }} />
        <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          Golden Cross: SMA50 crosses above SMA200 — strong bullish signal.<br />
          Death Cross: SMA50 crosses below SMA200 — strong bearish signal.
        </p>
      </div>

      {/* Pivot Points */}
      <div className="stock-detail-card">
        <h5 className="adv-tech-sub">Pivot Points (Daily)</h5>
        {[
          { l: 'Pivot (PP)', v: tech.pivot, c: '#096dd9' },
          { l: 'R3 Resistance', v: tech.r3, c: '#820014' },
          { l: 'R2 Resistance', v: tech.r2, c: '#cf1322' },
          { l: 'R1 Resistance', v: tech.r1, c: '#ff7875' },
          { l: 'S1 Support',    v: tech.s1, c: '#95de64' },
          { l: 'S2 Support',    v: tech.s2, c: '#52c41a' },
          { l: 'S3 Support',    v: tech.s3, c: '#237804' },
        ].map(({ l, v, c }) => (
          <InfoRow key={l} label={l} value={v ? fmtC(v) : '—'}
            valueStyle={{ color: c, fontWeight: 600 }} />
        ))}
        <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          Price above Pivot = bullish bias. Bounce off S1/S2 = buy zone. Break of R1/R2 = breakout.
        </p>
      </div>

      {/* Fibonacci */}
      <div className="stock-detail-card">
        <h5 className="adv-tech-sub">Fibonacci Retracement (52-week)</h5>
        {fibLevels.map(({ label, value }) => (
          <InfoRow key={label} label={label} value={fmtC(value)}
            valueStyle={{ fontWeight: 700, color: 'var(--primary)' }} />
        ))}
        <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
          Retracement from 52-week High to Low. Price near 61.8% or 38.2% is a high-probability reversal zone (Fibonacci Golden Ratio).
        </p>
      </div>
    </div>
  );
}

// ── Government Schemes Impact ─────────────────────────────────────────────────

function SchemesPanel({ schemes }) {
  if (!schemes || schemes.length === 0) return null;
  return (
    <div className="schemes-card">
      <h4 className="stock-detail-title">🏛️ Government Policy &amp; Scheme Impact</h4>
      <div className="schemes-list">
        {schemes.map((s, i) => {
          const st = IMPACT_STYLE[s.type] || IMPACT_STYLE.neutral;
          return (
            <div key={i} className="scheme-item">
              <span className="scheme-badge" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                {s.type === 'positive' ? '▲' : s.type === 'negative' ? '▼' : s.type === 'mixed' ? '◆' : '→'}&nbsp;{s.type}
              </span>
              <div>
                <div className="scheme-name">{s.name}</div>
                <div className="scheme-desc">{s.desc}</div>
              </div>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8 }}>
        Based on current GoI schemes, RBI policy, and sector-level regulations. Updated to Budget 2024-25.
      </p>
    </div>
  );
}

// ── Enhanced News Section ─────────────────────────────────────────────────────

function NewsSection({ sentiment, symbol }) {
  const s = sentiment || {};
  const domestic  = s.headlines  || [];
  const intl      = s.intl_news  || [];
  const macro     = s.macro_news || [];

  const allItems = [
    ...domestic.slice(0, 7).map(n => ({ ...n, scope: 'domestic' })),
    ...intl.slice(0, 4).map(n => ({ ...n, scope: 'international' })),
    ...macro.slice(0, 3).map(n => ({ ...n, scope: 'macro' })),
  ];

  if (allItems.length === 0) return null;

  const scopeTag = {
    domestic:      { label: '🇮🇳 NSE',    color: '#096dd9', bg: '#e6f4ff' },
    international: { label: '🌍 Global',  color: '#531dab', bg: '#f9f0ff' },
    macro:         { label: '📊 Macro',   color: '#0050b3', bg: '#e6f4ff' },
  };

  const impactTag = {
    positive: { label: '▲ Positive', color: '#237804', bg: '#f6ffed', border: '#b7eb8f' },
    negative: { label: '▼ Negative', color: '#cf1322', bg: '#fff2f0', border: '#ffa39e' },
    neutral:  { label: '→ Neutral',  color: '#595959', bg: '#f5f5f5', border: '#d9d9d9' },
  };

  return (
    <div className="stock-news-card">
      <h4 className="stock-detail-title">
        📰 News &amp; Market Intelligence
        {s.label && (
          <span style={{
            marginLeft: 10, fontSize: 12, fontWeight: 400,
            color: SENT_STYLE[s.label]?.color || 'var(--text-3)',
          }}>
            {SENT_STYLE[s.label]?.icon} {s.label} · {s.confidence}
            {s.counts && ` · ${s.counts.bullish}▲ ${s.counts.bearish}▼ ${s.counts.neutral}→`}
          </span>
        )}
      </h4>

      <div className="news-items">
        {allItems.map((item, i) => {
          const sc = scopeTag[item.scope]   || scopeTag.domestic;
          const im = impactTag[item.impact] || impactTag.neutral;
          const pubDate = item.published
            ? (() => { try { return new Date(item.published).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return item.published; } })()
            : null;
          return (
            <div key={i} className="news-item-card">
              <div className="news-item-tags">
                <span className="news-scope-tag" style={{ background: sc.bg, color: sc.color }}>
                  {sc.label}
                </span>
                <span className="news-impact-badge" style={{ background: im.bg, color: im.color, border: `1px solid ${im.border}` }}>
                  {im.label}
                </span>
                {item.source && (
                  <span className="news-source-tag">{item.source}</span>
                )}
              </div>
              <div className="news-item-content">
                {item.link
                  ? <a href={item.link} target="_blank" rel="noopener noreferrer" className="news-title">
                      {item.title}
                    </a>
                  : <span className="news-title">{item.title}</span>
                }
                {item.summary
                  ? <p className="news-summary">{item.summary}</p>
                  : <p className="news-summary news-summary--na">
                      Summary not available — click the headline to read the full article.
                    </p>
                }
                <div className="news-meta-row">
                  {pubDate && <span className="news-date">📅 {pubDate}</span>}
                  {item.link && (
                    <a href={item.link} target="_blank" rel="noopener noreferrer" className="news-read-more">
                      Read full article →
                    </a>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Detailed Financials helpers ───────────────────────────────────────────────

const EPS_LABELS = new Set(['EPS – Basic (₹)', 'EPS – Diluted (₹)']);

function computePeriodGroups(quarterly, periodType) {
  const { periods = [], rows = [] } = quarterly;
  if (!periods.length) return { periods: [], rows: [] };

  const getFY   = d => { const m = new Date(d).getMonth() + 1, y = new Date(d).getFullYear(); return m > 3 ? y + 1 : y; };
  const getMonth = d => new Date(d).getMonth() + 1;
  const belongs = (d, pt) => {
    const m = getMonth(d);
    if (pt === 'H1') return m === 6 || m === 9;
    if (pt === 'H2') return m === 12 || m === 3;
    return m === 6 || m === 9 || m === 12; // 9M
  };

  const groups = {};
  periods.forEach((p, i) => {
    if (!belongs(p, periodType)) return;
    const key = `FY${getFY(p)}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  });

  const sortedFYs = Object.keys(groups).sort((a, b) => parseInt(b.slice(2)) - parseInt(a.slice(2)));
  if (!sortedFYs.length) return { periods: [], rows: [] };

  const label = periodType === '9M' ? '9M' : periodType;
  return {
    periods: sortedFYs.map(fy => `${label} ${fy}`),
    rows: rows.map(row => ({
      label: row.label,
      values: sortedFYs.map(fy => {
        const idxs = groups[fy];
        if (EPS_LABELS.has(row.label)) return null; // not additive
        const vals = idxs.map(i => row.values[i]).filter(v => v != null);
        return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100 : null;
      }),
    })),
  };
}

// ── Financial table component ─────────────────────────────────────────────────

function FinTable({ title, stmt, unit, note }) {
  const { periods = [], rows = [] } = stmt || {};
  if (!rows.length) return <p className="fin-empty">No {title} data available for this stock.</p>;

  const TOTAL_ROWS = new Set(['Revenue', 'Gross Profit', 'EBITDA', 'Operating Profit (EBIT)',
    'Net Profit (PAT)', 'Net Income', 'Free Cash Flow (FCF)', 'Net Cash from Operations',
    'Total Assets', 'Total Liabilities', "Shareholders' Equity"]);

  const fmtVal = (v, lbl) => {
    if (v == null) return <span style={{ color: 'var(--text-3)' }}>—</span>;
    const isEPS = EPS_LABELS.has(lbl);
    if (isEPS) return `₹${Number(v).toFixed(2)}`;
    const abs = Math.abs(v);
    if (abs >= 100000) return `${(v / 100000).toFixed(1)}L`;  // Lakh Cr
    if (abs >= 1000)   return `${(v / 1000).toFixed(1)}K`;    // K Cr
    return v.toFixed(2);
  };

  return (
    <div className="fin-table-wrap">
      <div className="fin-table-header">
        <span>{title}</span>
        <span className="fin-unit-badge">Values in {unit} · growth vs prior period</span>
      </div>
      {note && <p className="fin-note">{note}</p>}
      <div className="table-responsive">
        <table className="fin-table">
          <thead>
            <tr>
              <th style={{ minWidth: 220, textAlign: 'left' }}>Particulars</th>
              {periods.map(p => <th key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const isBold = TOTAL_ROWS.has(row.label);
              return (
                <tr key={ri} className={isBold ? 'fin-row-total' : ''}>
                  <td className="fin-row-label">{row.label}</td>
                  {row.values.map((v, vi) => {
                    const prev = row.values[vi + 1];
                    const grew = v != null && prev != null && v > prev;
                    const fell = v != null && prev != null && v < prev;
                    const neg  = v != null && v < 0;
                    return (
                      <td key={vi} className="fin-row-val"
                        style={{ color: neg ? '#cf1322' : isBold ? 'var(--text)' : 'var(--text-2)' }}>
                        <span>{fmtVal(v, row.label)}</span>
                        {vi < row.values.length - 1 && v != null && prev != null && (
                          <span className={`fin-growth${grew ? ' grew' : fell ? ' fell' : ''}`}>
                            {grew ? '▲' : fell ? '▼' : ''}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BalanceSheetTable({ data }) {
  const { periods = [], assets = [], liabilities = [], equity = [] } = data.balance_sheet || {};
  const unit = data.unit;

  const Section = ({ title, rows, color }) => (
    <>
      <tr className="fin-row-section"><td colSpan={periods.length + 1} style={{ color }}>{title}</td></tr>
      {rows.map((row, ri) => {
        const isTot = row.label.startsWith('Total') || row.label.startsWith("Shareholders");
        return (
          <tr key={ri} className={isTot ? 'fin-row-total' : ''}>
            <td className="fin-row-label">{row.label}</td>
            {row.values.map((v, vi) => (
              <td key={vi} className="fin-row-val" style={{ color: v != null && v < 0 ? '#cf1322' : '' }}>
                {v != null ? (Math.abs(v) >= 1000 ? `${(v/1000).toFixed(1)}K` : v.toFixed(2)) : '—'}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );

  return (
    <div className="fin-table-wrap">
      <div className="fin-table-header">
        <span>Balance Sheet</span>
        <span className="fin-unit-badge">Values in {unit}</span>
      </div>
      <div className="table-responsive">
        <table className="fin-table">
          <thead>
            <tr>
              <th style={{ minWidth: 240, textAlign: 'left' }}>Particulars</th>
              {periods.map(p => <th key={p}>{p}</th>)}
            </tr>
          </thead>
          <tbody>
            <Section title="ASSETS" rows={assets} color="#096dd9" />
            <Section title="LIABILITIES" rows={liabilities} color="#cf1322" />
            <Section title="SHAREHOLDERS' EQUITY" rows={equity} color="#237804" />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RatiosTable({ ratios }) {
  if (!ratios) return null;
  const pct = v => v != null ? `${(v * 100).toFixed(2)}%` : '—';
  const x   = v => v != null ? `${Number(v).toFixed(2)}×` : '—';
  const n   = (v, d=2) => v != null ? Number(v).toFixed(d) : '—';

  const sections = [
    {
      title: 'Valuation Ratios', color: '#096dd9',
      rows: [
        { l: 'P/E (Trailing TTM)',     v: x(ratios.pe_trailing),   note: '<15 cheap, >30 expensive' },
        { l: 'P/E (Forward)',           v: x(ratios.pe_forward),    note: 'Based on next-year earnings est.' },
        { l: 'P/B Ratio',              v: x(ratios.pb_ratio),      note: '<1 possibly undervalued' },
        { l: 'P/S Ratio',              v: x(ratios.ps_ratio),      note: '<1 cheap on revenue basis' },
        { l: 'PEG Ratio',              v: n(ratios.peg_ratio),     note: '<1 undervalued for growth' },
        { l: 'EV / EBITDA',           v: x(ratios.ev_ebitda),     note: '<10 attractive' },
        { l: 'EV / Revenue',          v: x(ratios.ev_revenue),     note: 'Enterprise value relative to sales' },
      ],
    },
    {
      title: 'Profitability & Margins', color: '#237804',
      rows: [
        { l: 'Gross Margin',           v: pct(ratios.gross_margin),     note: 'Revenue after COGS' },
        { l: 'EBITDA Margin',          v: pct(ratios.ebitda_margin),    note: 'Operating efficiency' },
        { l: 'Operating Margin',       v: pct(ratios.operating_margin), note: 'EBIT / Revenue' },
        { l: 'Net Profit Margin',      v: pct(ratios.net_margin),       note: 'PAT / Revenue' },
        { l: 'Return on Equity (ROE)', v: pct(ratios.roe),              note: '>15% is good' },
        { l: 'Return on Assets (ROA)', v: pct(ratios.roa),              note: '>5% is healthy' },
        { l: 'EPS (Trailing)',         v: ratios.eps_trailing != null ? `₹${ratios.eps_trailing}` : '—', note: 'Trailing 12-month EPS' },
        { l: 'EPS (Forward)',          v: ratios.eps_forward  != null ? `₹${Number(ratios.eps_forward).toFixed(2)}` : '—', note: 'Analyst estimate next year' },
      ],
    },
    {
      title: 'Liquidity & Solvency', color: '#531dab',
      rows: [
        { l: 'Current Ratio',          v: n(ratios.current_ratio),  note: '>1.5 healthy; <1 caution' },
        { l: 'Quick Ratio',            v: n(ratios.quick_ratio),    note: '>1 ideal' },
        { l: 'Debt / Equity',          v: n(ratios.debt_to_equity), note: '<1 low leverage' },
        { l: 'Interest Coverage',      v: ratios.interest_coverage != null ? `${n(ratios.interest_coverage)}×` : '—', note: '>3× safe; <1.5× risky' },
      ],
    },
    {
      title: 'Dividend Metrics', color: '#ad6800',
      rows: [
        { l: 'Dividend Yield',         v: ratios.dividend_yield != null ? `${(ratios.dividend_yield * 100).toFixed(2)}%` : '—', note: '>3% good income' },
        { l: 'Payout Ratio',           v: pct(ratios.payout_ratio), note: '<60% sustainable' },
        { l: 'Dividend Per Share',     v: ratios.dividend_per_share != null ? `₹${ratios.dividend_per_share}` : '—', note: 'Last declared DPS' },
      ],
    },
    {
      title: 'Growth', color: '#00474f',
      rows: [
        { l: 'Revenue Growth (YoY)',   v: pct(ratios.revenue_growth),  note: 'Year-on-year top-line growth' },
        { l: 'Earnings Growth (YoY)',  v: pct(ratios.earnings_growth), note: 'Year-on-year PAT growth' },
      ],
    },
  ];

  return (
    <div className="fin-ratios-wrap">
      {sections.map(sec => (
        <div key={sec.title} className="fin-ratios-card">
          <div className="fin-ratios-title" style={{ color: sec.color }}>{sec.title}</div>
          {sec.rows.map(row => (
            <div key={row.l} className="fin-ratio-row">
              <div>
                <span className="fin-ratio-label">{row.l}</span>
                {row.note && <span className="fin-ratio-note"> — {row.note}</span>}
              </div>
              <span className="fin-ratio-val">{row.v}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CapStructureTable({ cs }) {
  if (!cs) return null;
  const fmtBig = v => {
    if (v == null) return '—';
    if (v >= 1e12) return `₹${(v/1e12).toFixed(2)}L Cr`;
    if (v >= 1e9)  return `₹${(v/1e9).toFixed(2)}B`;
    if (v >= 1e7)  return `₹${(v/1e7).toFixed(2)} Cr`;
    return `₹${v.toLocaleString('en-IN')}`;
  };
  const fmtShares = v => v == null ? '—' : `${(v / 1e7).toFixed(2)} Cr shares`;
  const pct = v => v == null ? '—' : `${(v * 100).toFixed(2)}%`;

  const rows = [
    { section: 'Market Metrics' },
    { l: 'Current Price',        v: cs.current_price != null ? `₹${cs.current_price.toLocaleString('en-IN')}` : '—' },
    { l: 'Market Capitalisation',v: fmtBig(cs.market_cap) },
    { l: 'Enterprise Value',     v: fmtBig(cs.enterprise_value) },
    { l: '52-Week High',         v: cs['52w_high'] != null ? `₹${cs['52w_high'].toLocaleString('en-IN')}` : '—' },
    { l: '52-Week Low',          v: cs['52w_low']  != null ? `₹${cs['52w_low'].toLocaleString('en-IN')}` : '—' },
    { l: 'Beta',                 v: cs.beta != null ? cs.beta.toFixed(2) : '—' },
    { section: 'Share Capital' },
    { l: 'Shares Outstanding',   v: fmtShares(cs.shares_outstanding) },
    { l: 'Float Shares',         v: fmtShares(cs.float_shares) },
    { l: 'Book Value Per Share', v: cs.book_value_per_share != null ? `₹${cs.book_value_per_share.toFixed(2)}` : '—' },
    { section: 'Debt & Cash' },
    { l: 'Total Debt',           v: fmtBig(cs.total_debt) },
    { l: 'Total Cash',           v: fmtBig(cs.total_cash) },
    { l: 'Net Debt (Debt–Cash)', v: cs.net_debt != null
        ? (cs.net_debt >= 0 ? fmtBig(cs.net_debt) : `Net Cash: ${fmtBig(-cs.net_debt)}`)
        : '—' },
    { section: 'Shareholding Pattern' },
    { l: 'Promoter / Insiders',  v: pct(cs.held_pct_insiders) },
    { l: 'Institutional Holding',v: pct(cs.held_pct_institutions) },
    { l: 'Short % of Float',     v: pct(cs.short_pct_float) },
  ];

  return (
    <div className="fin-cap-wrap">
      <div className="fin-table-header"><span>Capital Structure &amp; Shareholding</span></div>
      {rows.map((row, i) => {
        if (row.section) return (
          <div key={i} className="fin-cap-section">{row.section}</div>
        );
        return (
          <div key={i} className="fin-cap-row">
            <span className="fin-cap-label">{row.l}</span>
            <span className="fin-cap-val">{row.v}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Detailed Financials Section ────────────────────────────────────────────────

const FIN_SUBTABS = [
  { key: 'pl_annual',    label: 'P&L Annual' },
  { key: 'pl_quarterly', label: 'P&L Quarterly' },
  { key: 'half_yearly',  label: 'Half-Yearly' },
  { key: 'nine_months',  label: 'Nine Months' },
  { key: 'yearly',       label: 'Yearly Results' },
  { key: 'balance',      label: 'Balance Sheet' },
  { key: 'cashflow',     label: 'Cash Flows' },
  { key: 'ratios',       label: 'Ratios' },
  { key: 'capital',      label: 'Capital Structure' },
];

function FinancialsSection({ symbol }) {
  const [open,    setOpen]    = useState(false);
  const [fin,     setFin]     = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [subTab,  setSubTab]  = useState('pl_annual');

  useEffect(() => {
    if (!open || fin || loading) return;
    setLoading(true);
    stockService.financials(symbol)
      .then(r => setFin(r.data))
      .catch(() => setError('Financial statements unavailable for this stock.'))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line

  return (
    <div className="fin-section">
      <button className="fin-toggle-btn" onClick={() => setOpen(v => !v)}>
        📋 Detailed Financials
        <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8, fontWeight: 400 }}>
          Balance Sheet · P&amp;L · Cash Flows · Ratios · Capital Structure
        </span>
        <span style={{ marginLeft: 'auto' }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="fin-body">
          {loading && (
            <div style={{ padding: 32, textAlign: 'center' }}>
              <Spinner /> <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>Loading financial statements…</span>
            </div>
          )}
          {error && <p className="stock-error" style={{ margin: 16 }}>{error}</p>}
          {fin && !loading && (
            <>
              <div className="fin-subtab-bar">
                {FIN_SUBTABS.map(t => (
                  <button key={t.key}
                    className={`fin-subtab-btn${subTab === t.key ? ' fin-subtab-btn--active' : ''}`}
                    onClick={() => setSubTab(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>

              {subTab === 'pl_annual' && (
                <FinTable title={`Profit & Loss — Annual (${fin.unit})`}
                  stmt={fin.profit_loss.annual} unit={fin.unit} />
              )}
              {subTab === 'pl_quarterly' && (
                <FinTable title={`Profit & Loss — Quarterly (${fin.unit})`}
                  stmt={fin.profit_loss.quarterly} unit={fin.unit} />
              )}
              {subTab === 'half_yearly' && (() => {
                const h1 = computePeriodGroups(fin.profit_loss.quarterly, 'H1');
                const h2 = computePeriodGroups(fin.profit_loss.quarterly, 'H2');
                // merge H1 and H2 into a single table sorted by period desc
                const merged = { periods: [...h2.periods, ...h1.periods], rows: h1.rows.map((r, ri) => ({
                  label: r.label,
                  values: [...(h2.rows[ri]?.values || []), ...r.values],
                }))};
                return (
                  <FinTable title={`Half-Yearly Results (${fin.unit})`}
                    stmt={merged} unit={fin.unit}
                    note="H1 = Apr–Sep (Q1+Q2) · H2 = Oct–Mar (Q3+Q4) · Indian FY ends March" />
                );
              })()}
              {subTab === 'nine_months' && (
                <FinTable title={`Nine Months Results (${fin.unit})`}
                  stmt={computePeriodGroups(fin.profit_loss.quarterly, '9M')} unit={fin.unit}
                  note="9M = Apr–Dec (Q1+Q2+Q3) · Indian FY ends March · EPS not shown (not additive)" />
              )}
              {subTab === 'yearly' && (
                <FinTable title={`Yearly Results — Key Metrics (${fin.unit})`}
                  stmt={fin.profit_loss.annual} unit={fin.unit}
                  note="Full-year income statement (April–March fiscal year)" />
              )}
              {subTab === 'balance' && <BalanceSheetTable data={fin} />}
              {subTab === 'cashflow' && (
                <FinTable title={`Cash Flow Statement — Annual (${fin.unit})`}
                  stmt={fin.cash_flows.annual} unit={fin.unit}
                  note="Positive = cash inflow · Negative = cash outflow" />
              )}
              {subTab === 'ratios' && <RatiosTable ratios={fin.ratios} />}
              {subTab === 'capital' && <CapStructureTable cs={fin.capital_structure} />}

              <p style={{ fontSize: 10, color: 'var(--text-3)', padding: '8px 16px 0', borderTop: '1px solid var(--border-light)', marginTop: 12 }}>
                Source: yfinance / Yahoo Finance · Cached 60 min · Values in {fin.unit} unless stated ·
                yfinance may have ~15-min delay; verify with NSE/BSE for trading decisions.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Price Chart ───────────────────────────────────────────────────────────────

function PriceChart({ symbol }) {
  const [period,  setPeriod]  = useState('1y');
  const [data,    setData]    = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback((sym, per) => {
    setLoading(true); setError('');
    stockService.chart(sym, per)
      .then(r => setData(r.data || []))
      .catch(() => setError('Chart data unavailable.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (symbol) load(symbol, period); }, [symbol, period, load]);

  if (!symbol) return null;

  const first  = data[0]?.close;
  const last   = data[data.length - 1]?.close;
  const up     = last >= first;
  const lc     = up ? '#237804' : '#cf1322';
  const gid    = `grad-${symbol.replace(/\W/g, '')}`;

  return (
    <div className="stock-chart-card">
      <div className="stock-chart-header">
        <span style={{ fontWeight: 700, fontSize: 14 }}>Price History</span>
        <div className="stock-period-tabs">
          {PERIODS.map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`stock-period-btn${period === p ? ' stock-period-btn--active' : ''}`}>
              {p}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
      ) : error ? (
        <p style={{ color: 'var(--danger)', textAlign: 'center', padding: '60px 0' }}>{error}</p>
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={lc} stopOpacity={0.18} />
                <stop offset="95%" stopColor={lc} stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-3)' }}
              tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }}
              tickFormatter={v => `₹${v.toLocaleString('en-IN')}`}
              width={72} domain={['auto', 'auto']} />
            <Tooltip
              formatter={v => [`₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`, 'Close']}
              labelStyle={{ fontSize: 12 }} contentStyle={{ fontSize: 12 }}
            />
            <Area type="monotone" dataKey="close" stroke={lc} strokeWidth={2}
              fill={`url(#${gid})`} dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// ── Composite Score Bar ────────────────────────────────────────────────────────

function CompositeScore({ score }) {
  // score range roughly -15 to +15; clamp to display
  const pct   = Math.min(100, Math.max(0, ((score + 15) / 30) * 100));
  const color = score >= 3 ? '#237804' : score <= -3 ? '#cf1322' : '#ad6800';
  return (
    <div title={`Composite score: ${score > 0 ? '+' : ''}${score}`} style={{ width: 64 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
        <span style={{ fontWeight: 700, color }}>{score > 0 ? '+' : ''}{score}</span>
      </div>
      <div style={{ height: 5, background: 'var(--border-light)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// ── Screener signal detail tooltip ────────────────────────────────────────────

const TECH_DIMS = [
  { key: 'price_vs_sma50',   label: '50-day MA',    good: v => v === 'above',    fmt: v => v === 'above' ? 'Above ✓' : 'Below ✗' },
  { key: 'price_vs_sma200',  label: '200-day MA',   good: v => v === 'above',    fmt: v => v === 'above' ? 'Above ✓' : 'Below ✗' },
  { key: 'rsi',              label: 'RSI',           good: v => v < 50,           fmt: v => v != null ? fmt(v, 0) : '—' },
  { key: 'stoch_k',          label: 'Stochastic %K', good: v => v < 50,          fmt: v => v != null ? fmt(v, 0) : '—' },
  { key: 'ichimoku_signal',  label: 'Ichimoku',     good: v => v === 'bullish',   fmt: v => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
  { key: 'obv_trend',        label: 'OBV Trend',    good: v => v === 'rising',    fmt: v => v ? v.charAt(0).toUpperCase() + v.slice(1) : '—' },
  { key: 'macd_histogram',   label: 'MACD Hist',    good: v => v > 0,             fmt: v => v != null ? fmt(v, 3) : '—' },
  { key: 'valuation_verdict',label: 'Valuation',    good: v => v?.includes('Under'), fmt: v => v || '—' },
  { key: 'entry_action',     label: 'Entry Signal', good: v => v?.includes('Buy'), fmt: v => v || '—' },
];

function SignalDetail({ row }) {
  const [open, setOpen] = useState(false);
  if (!open) return (
    <button className="btn btn-sm" style={{ fontSize: 10, padding: '1px 6px' }} onClick={() => setOpen(true)}>
      Details
    </button>
  );
  return (
    <div className="signal-detail-popup" onClick={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontWeight: 700, fontSize: 12 }}>Signal Breakdown</span>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>✕</button>
      </div>
      {TECH_DIMS.map(d => {
        const val = row[d.key];
        const good = val != null ? d.good(val) : null;
        return (
          <div key={d.key} className="signal-dim-row">
            <span style={{ color: 'var(--text-3)', fontSize: 11 }}>{d.label}</span>
            <span style={{ fontWeight: 600, fontSize: 11, color: good === true ? '#237804' : good === false ? '#cf1322' : 'var(--text)' }}>
              {d.fmt(val)}
            </span>
          </div>
        );
      })}
      <div className="signal-dim-row" style={{ marginTop: 4, borderTop: '1px solid var(--border-light)', paddingTop: 4 }}>
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Risk (ATR)</span>
        <span style={{ fontSize: 11 }}>{row.atr != null ? fmtC(row.atr) : '—'}</span>
      </div>
      <div className="signal-dim-row">
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>% from 52W High</span>
        <span style={{ fontSize: 11, color: (row.week_52_pct || 0) < -20 ? '#237804' : 'var(--text)' }}>
          {row.week_52_pct != null ? `${row.week_52_pct}%` : '—'}
        </span>
      </div>
      <div className="signal-dim-row">
        <span style={{ color: 'var(--text-3)', fontSize: 11 }}>Graham MoS</span>
        <span style={{ fontSize: 11, color: (row.margin_of_safety || 0) > 0 ? '#237804' : '#cf1322' }}>
          {row.margin_of_safety != null ? `${row.margin_of_safety}%` : '—'}
        </span>
      </div>
    </div>
  );
}

// ── Quick Watch button ─────────────────────────────────────────────────────────

function WatchBtn({ symbol }) {
  const [st, setSt] = useState('idle'); // idle | adding | done | err
  const add = () => {
    setSt('adding');
    stockService.addWatchlist({ symbol })
      .then(() => { setSt('done'); setTimeout(() => setSt('idle'), 2500); })
      .catch(() => { setSt('err');  setTimeout(() => setSt('idle'), 2000); });
  };
  if (st === 'done') return <span style={{ color: '#237804', fontSize: 11, fontWeight: 700 }}>✓ Watched</span>;
  if (st === 'err')  return <span style={{ color: '#cf1322', fontSize: 11 }}>✗ Failed</span>;
  return (
    <button className="btn btn-sm" style={{ color: '#531dab', background: '#f9f0ff', border: '1px solid #d3adf7' }}
      disabled={st === 'adding'} onClick={add} title="Add to watchlist">
      {st === 'adding' ? '…' : '👁 Watch'}
    </button>
  );
}

// ── Refresh Frequency Panel ────────────────────────────────────────────────────

function RefreshPanel() {
  const [open, setOpen] = useState(false);
  const items = [
    { label: 'Basic Quote (price, 52W, SMAs)',  freq: '1 min',   note: 'yfinance fast_info endpoint' },
    { label: 'Full Analysis (technicals, P&L)', freq: '30 min',  note: 'Cached to avoid Yahoo rate limits' },
    { label: 'Chart Data',                       freq: '10 min',  note: 'OHLCV history; period-specific' },
    { label: 'News Sentiment',                   freq: '10 min',  note: 'Google News RSS, keyword scored' },
    { label: 'Global Markets (11 indices)',       freq: '5 min',   note: 'Parallel fetch via ThreadPoolExecutor' },
    { label: 'Screener Results',                 freq: '60 min',  note: 'Expensive pass — all NSE stocks' },
    { label: 'NSE Stock Universe (CSV)',          freq: '24 hrs',  note: 'From NSE EQUITY_L.csv archive' },
    { label: 'Portfolio P&L',                    freq: 'On demand', note: 'Real-time on each page load / add' },
  ];
  return (
    <div style={{ marginBottom: 12 }}>
      <button className="btn btn-sm btn-secondary" onClick={() => setOpen(v => !v)} style={{ fontSize: 11 }}>
        📡 Data refresh frequency {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="refresh-panel">
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 8, color: 'var(--text-2)' }}>
            Cache TTLs — data auto-refreshes after these intervals
          </div>
          {items.map(it => (
            <div key={it.label} className="refresh-row">
              <span className="refresh-label">{it.label}</span>
              <span className="refresh-freq">{it.freq}</span>
              <span className="refresh-note">{it.note}</span>
            </div>
          ))}
          <p style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 8 }}>
            To force a refresh, re-search the symbol — if it was cached it will serve the cached copy until TTL expires.
            For live trading, use NSE/BSE terminal feeds; yfinance has a ~15-min delay.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Screener Tab ──────────────────────────────────────────────────────────────

function ScreenerTab({ onSelect }) {
  const [minYield, setMinYield] = useState(3);
  const [maxPE,    setMaxPE]    = useState(50);
  const [results,  setResults]  = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [sorted,   setSorted]   = useState({ col: 'score', dir: -1 });

  const noDiv = minYield === 0;

  const run = () => {
    setLoading(true); setError('');
    setSorted({ col: noDiv ? 'score' : 'dividend_yield', dir: -1 });
    stockService.screener({ min_yield: minYield / 100, max_pe: maxPE })
      .then(r => setResults(r.data || []))
      .catch(() => setError('Screener failed. Check the backend is running.'))
      .finally(() => setLoading(false));
  };

  const sortBy = col => setSorted(s => ({ col, dir: s.col === col ? -s.dir : -1 }));
  const sortedRows = [...results].sort((a, b) => {
    const av = a[sorted.col] ?? -Infinity, bv = b[sorted.col] ?? -Infinity;
    return (av < bv ? -1 : av > bv ? 1 : 0) * sorted.dir;
  });
  const Th = ({ col, label }) => (
    <th onClick={() => sortBy(col)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label} {sorted.col === col ? (sorted.dir === -1 ? '↓' : '↑') : ''}
    </th>
  );

  return (
    <div className="stock-tab-body">
      <RefreshPanel />
      <div className="stock-screener-controls">
        <div className="stock-filter-group">
          <label className="stock-filter-label">
            Min Dividend Yield
            {noDiv && <span style={{ marginLeft: 6, color: '#096dd9', fontWeight: 700, fontSize: 11 }}>— All Stocks (no div filter)</span>}
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min={0} max={15} step={0.5} value={minYield}
              onChange={e => setMinYield(+e.target.value)} style={{ flex: 1 }} />
            <span className="stock-filter-val" style={noDiv ? { color: '#096dd9', fontWeight: 700 } : {}}>
              {noDiv ? 'Any' : `${minYield}%`}
            </span>
          </div>
        </div>
        <div className="stock-filter-group">
          <label className="stock-filter-label">Max P/E Ratio</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="range" min={5} max={200} step={5} value={maxPE}
              onChange={e => setMaxPE(+e.target.value)} style={{ flex: 1 }} />
            <span className="stock-filter-val">{maxPE}×</span>
          </div>
        </div>
        <button className="btn btn-primary stock-screen-btn" onClick={run} disabled={loading}>
          {loading ? <><Spinner sm /> Screening…</> : `🔍 Screen NSE Stocks${noDiv ? ' (All)' : ''}`}
        </button>
      </div>
      {error && <p className="stock-error">{error}</p>}
      {!loading && results.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, marginTop: 16 }}>
            {results.length} stocks · sorted by{' '}
            <strong>{noDiv ? 'Composite Score' : 'Dividend Yield'}</strong>
            {' '}· click column header to re-sort · click <strong>Details</strong> for full signal breakdown
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <Th col="symbol"         label="Symbol" />
                  <Th col="company_name"   label="Company" />
                  <Th col="sector"         label="Sector" />
                  <Th col="current_price"  label="Price ₹" />
                  <Th col="change_pct"     label="Chg%" />
                  {!noDiv && <Th col="dividend_yield" label="Div Yield" />}
                  <Th col="pe_ratio"       label="P/E" />
                  <Th col="rsi"            label="RSI" />
                  <Th col="week_52_pct"    label="vs 52W Hi" />
                  <Th col="score"          label="Score" />
                  <Th col="signal"         label="Signal" />
                  <th>Details</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(s => (
                  <tr key={s.symbol} style={{ position: 'relative' }}>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{s.symbol.replace('.NS', '')}</td>
                    <td style={{ fontSize: 12 }}>{s.company_name || '—'}</td>
                    <td style={{ fontSize: 11, color: 'var(--text-3)' }}>{s.sector || '—'}</td>
                    <td>{fmtC(s.current_price)}</td>
                    <td style={{ color: chgClr(s.change_pct), fontWeight: 600 }}>{fmtChg(s.change_pct)}</td>
                    {!noDiv && (
                      <td style={{ fontWeight: 700, color: '#237804' }}>
                        {s.dividend_yield != null ? `${(s.dividend_yield * 100).toFixed(2)}%` : '—'}
                      </td>
                    )}
                    <td>{s.pe_ratio != null ? fmt(s.pe_ratio, 1) : '—'}</td>
                    <td>
                      {s.rsi != null
                        ? <span style={{ fontWeight: 600, color: s.rsi < 35 ? '#237804' : s.rsi > 65 ? '#cf1322' : 'var(--text)' }}>
                            {fmt(s.rsi, 0)}
                          </span>
                        : '—'}
                    </td>
                    <td style={{ color: (s.week_52_pct || 0) < -20 ? '#237804' : 'var(--text)', fontSize: 12 }}>
                      {s.week_52_pct != null ? `${s.week_52_pct}%` : '—'}
                    </td>
                    <td><CompositeScore score={s.score ?? 0} /></td>
                    <td><SignalBadge signal={s.signal || 'Hold'} /></td>
                    <td style={{ position: 'relative' }}><SignalDetail row={s} /></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn-sm btn-secondary" onClick={() => onSelect(s.symbol)}>
                          Analyse →
                        </button>
                        <WatchBtn symbol={s.symbol} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!loading && results.length === 0 && !error && (
        <div className="stock-empty">
          <span style={{ fontSize: 40 }}>📊</span>
          <p>
            {noDiv
              ? <>Set P/E limit and click <strong>Screen NSE Stocks (All)</strong> to scan all stocks by composite signal.</>
              : <>Set filters and click <strong>Screen NSE Stocks</strong> to discover quality dividend stocks.</>}
          </p>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
            Score uses: fundamental (P/E, P/B, EPS, growth, ROE, D/E) · technical (RSI, MACD, SMA, Stochastic, Ichimoku, BB) ·
            valuation (Graham number, PEG, FCF yield) · sentiment (news, RBI, macro)
          </p>
        </div>
      )}
    </div>
  );
}

// ── Analyser Tab ──────────────────────────────────────────────────────────────

const PHASE_INIT = { basic: 'idle', analysis: 'idle', sentiment: 'idle' };

function AnalyserTab({ preloadSymbol }) {
  const [query,     setQuery]     = useState('');
  const [results,   setResults]   = useState([]);
  const [symbol,    setSymbol]    = useState(preloadSymbol || '');
  const [basic,     setBasic]     = useState(null);
  const [analysis,  setAnalysis]  = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [phases,    setPhases]    = useState(PHASE_INIT);
  const [error,     setError]     = useState('');
  const reqRef = useRef(0);

  useEffect(() => { if (preloadSymbol) loadAll(preloadSymbol); }, [preloadSymbol]); // eslint-disable-line

  const doSearch = q => {
    setQuery(q);
    if (q.length < 1) { setResults([]); return; }
    stockService.search(q).then(r => setResults(r.data || [])).catch(() => {});
  };

  const loadAll = sym => {
    const req = ++reqRef.current;
    setSymbol(sym); setQuery(''); setResults([]);
    setBasic(null); setAnalysis(null); setSentiment(null); setError('');
    setPhases({ basic: 'loading', analysis: 'pending', sentiment: 'pending' });

    stockService.basicQuote(sym)
      .then(r => {
        if (reqRef.current !== req) return;
        setBasic(r.data);
        setPhases(p => ({ ...p, basic: 'done', analysis: 'loading', sentiment: 'loading' }));
      })
      .catch(() => { if (reqRef.current !== req) return; setPhases(p => ({ ...p, basic: 'error', analysis: 'loading', sentiment: 'loading' })); });

    stockService.analyse(sym)
      .then(r => {
        if (reqRef.current !== req) return;
        setAnalysis(r.data);
        setPhases(p => ({ ...p, analysis: 'done' }));
      })
      .catch(() => {
        if (reqRef.current !== req) return;
        setError('Full analysis failed — showing quick quote only.');
        setPhases(p => ({ ...p, analysis: 'error' }));
      });

    stockService.sentiment(sym)
      .then(r => {
        if (reqRef.current !== req) return;
        setSentiment(r.data);
        setPhases(p => ({ ...p, sentiment: 'done' }));
      })
      .catch(() => { if (reqRef.current !== req) return; setPhases(p => ({ ...p, sentiment: 'error' })); });
  };

  const b        = basic    || {};
  const a        = analysis || {};
  const techData = a.technicals  || {};
  const rec      = a.recommendation || {};

  const displayPrice  = a.current_price  ?? b.current_price;
  const displayChg    = a.change_pct     ?? b.change_pct;
  const displayName   = a.company_name   ?? b.company_name;
  const displayYrHi   = techData.week_52_high ?? b.year_high;
  const displayYrLo   = techData.week_52_low  ?? b.year_low;
  const displaySma50  = techData.sma_50  ?? b.sma_50;
  const displaySma200 = techData.sma_200 ?? b.sma_200;
  const hasSomething  = basic || analysis;

  return (
    <div className="stock-tab-body">
      {/* Search bar */}
      <div className="stock-search-bar">
        <input
          className="stock-search-input"
          placeholder="Search any of 2000+ NSE stocks — symbol or company name (e.g. TCS, Reliance, HDFC Bank)…"
          value={query}
          onChange={e => doSearch(e.target.value)}
        />
        {results.length > 0 && (
          <div className="stock-search-dropdown">
            {results.map(res => (
              <div key={res.symbol} className="stock-search-item" onClick={() => loadAll(res.symbol)}>
                <span style={{ fontWeight: 700 }}>{res.symbol.replace('.NS', '')}</span>
                <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{res.company_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {phases.basic !== 'idle' && <LoadPhases status={phases} />}
      {error && <p className="stock-error" style={{ marginTop: 12 }}>{error}</p>}

      {hasSomething && (
        <>
          {/* Header */}
          <div className="stock-analysis-header">
            <div>
              <h2 className="stock-company-name">{displayName || symbol}</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4, alignItems: 'center' }}>
                <span className="stock-symbol-badge">{symbol.replace('.NS', '')}</span>
                {a.sector   && <span className="stock-sector-badge">{a.sector}</span>}
                {b.exchange && <span className="stock-sector-badge">{b.exchange}</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="stock-price">{fmtC(displayPrice)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: chgClr(displayChg) }}>{fmtChg(displayChg)} today</div>
            </div>
          </div>

          {/* Quick stats strip */}
          <div className="stock-quick-stats">
            {[
              { label: '52W High',    value: fmtC(displayYrHi) },
              { label: '52W Low',     value: fmtC(displayYrLo) },
              { label: '50-day SMA',  value: fmtC(displaySma50),
                color: displayPrice && displaySma50 ? (displayPrice > displaySma50 ? '#237804' : '#cf1322') : '' },
              { label: '200-day SMA', value: fmtC(displaySma200),
                color: displayPrice && displaySma200 ? (displayPrice > displaySma200 ? '#237804' : '#cf1322') : '' },
              { label: 'Market Cap',  value: fmtM(a.market_cap ?? b.market_cap) },
            ].map(({ label, value, color }) => (
              <div key={label} className="stock-qstat">
                <div className="stock-qstat-val" style={color ? { color } : {}}>{value}</div>
                <div className="stock-qstat-lbl">{label}</div>
              </div>
            ))}
          </div>

          {/* ★ Entry / Exit Timing — most prominent new section */}
          {analysis && <EntryExitCard ee={a.entry_exit} cur={displayPrice} />}

          {/* Signal + Sentiment row */}
          {(analysis || sentiment) && (
            <div className="stock-signal-row">
              <div className="stock-signal-card">
                <div className="stock-signal-card-title">AI Recommendation</div>
                {phases.analysis === 'loading' ? <Spinner sm /> : (
                  <>
                    <SignalBadge signal={rec.signal || 'Hold'} />
                    <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 6 }}>
                      Score: {rec.score > 0 ? '+' : ''}{rec.score ?? 0}
                    </div>
                  </>
                )}
              </div>
              <div className="stock-signal-card">
                <div className="stock-signal-card-title">News Sentiment</div>
                {phases.sentiment === 'loading' ? <Spinner sm /> : (
                  <>{(() => { const s = sentiment || {}; return (
                    <>
                      <span style={{ fontSize: 14, fontWeight: 700, color: SENT_STYLE[s.label]?.color || 'var(--text)' }}>
                        {SENT_STYLE[s.label]?.icon} {s.label || 'Neutral'}
                      </span>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>{s.confidence || 'Weak'} · {fmt(s.score, 2)}</div>
                    </>
                  );})()}</>
                )}
              </div>
              <div className="stock-signal-card">
                <div className="stock-signal-card-title">Dividend Yield</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: (a.dividend_yield || 0) > 0.03 ? '#237804' : 'var(--text)' }}>
                  {a.dividend_yield != null ? `${(a.dividend_yield * 100).toFixed(2)}%` : (phases.analysis === 'loading' ? '…' : '—')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>Payout: {fmtPct(a.payout_ratio)}</div>
              </div>
              <div className="stock-signal-card">
                <div className="stock-signal-card-title">Valuation Verdict</div>
                {analysis ? (
                  <span style={{ fontSize: 13, fontWeight: 700,
                    color: (a.valuation?.verdict_color === 'green' ? '#237804'
                         : a.valuation?.verdict_color === 'red' ? '#cf1322'
                         : a.valuation?.verdict_color === 'orange' ? '#ad6800' : 'var(--primary)') }}>
                    {a.valuation?.verdict || '—'}
                  </span>
                ) : <Spinner sm />}
                {a.valuation?.margin_of_safety != null && (
                  <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                    MoS: {a.valuation.margin_of_safety}%
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Price Chart */}
          <PriceChart symbol={symbol} />

          {analysis && (
            <>
              {/* Fundamentals + Technicals + Valuation */}
              <div className="stock-detail-grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                <div className="stock-detail-card">
                  <h4 className="stock-detail-title">Fundamentals</h4>
                  <InfoRow label="P/E Ratio"       value={a.pe_ratio     != null ? fmt(a.pe_ratio, 1)      : '—'} />
                  <InfoRow label="P/B Ratio"        value={a.pb_ratio     != null ? fmt(a.pb_ratio, 2)      : '—'} />
                  <InfoRow label="EPS"              value={a.eps          != null ? fmtC(a.eps)             : '—'} />
                  <InfoRow label="Revenue Growth"   value={a.revenue_growth  != null ? fmtPct(a.revenue_growth)  : '—'}
                    valueStyle={{ color: (a.revenue_growth  || 0) > 0 ? '#237804' : '#cf1322' }} />
                  <InfoRow label="Earnings Growth"  value={a.earnings_growth != null ? fmtPct(a.earnings_growth) : '—'}
                    valueStyle={{ color: (a.earnings_growth || 0) > 0 ? '#237804' : '#cf1322' }} />
                  <InfoRow label="ROE"              value={a.roe          != null ? fmtPct(a.roe)           : '—'} />
                  <InfoRow label="Debt / Equity"    value={a.debt_to_equity != null ? fmt(a.debt_to_equity, 2) : '—'} />
                  <InfoRow label="Industry"         value={a.industry} />
                </div>

                <div className="stock-detail-card">
                  <h4 className="stock-detail-title">Core Technicals</h4>
                  <GaugeBar label="RSI (14)" value={techData.rsi ?? 50} min={0} max={100} thresholds={[35, 65]} />
                  <InfoRow label="SMA 50"    value={techData.sma_50     != null ? fmtC(techData.sma_50)  : '—'}
                    valueStyle={{ color: techData.price_vs_sma50  === 'above' ? '#237804' : '#cf1322' }} />
                  <InfoRow label="SMA 200"   value={techData.sma_200    != null ? fmtC(techData.sma_200) : '—'}
                    valueStyle={{ color: techData.price_vs_sma200 === 'above' ? '#237804' : '#cf1322' }} />
                  <InfoRow label="MACD"      value={techData.macd       != null ? fmt(techData.macd, 4)   : '—'}
                    valueStyle={{ color: (techData.macd || 0) > (techData.macd_signal || 0) ? '#237804' : '#cf1322' }} />
                  <InfoRow label="BB Upper"  value={techData.bb_upper   != null ? fmtC(techData.bb_upper) : '—'} />
                  <InfoRow label="BB Lower"  value={techData.bb_lower   != null ? fmtC(techData.bb_lower) : '—'} />
                  <InfoRow label="52W High"  value={techData.week_52_high != null ? fmtC(techData.week_52_high) : '—'} />
                  <InfoRow label="% from Hi" value={techData.week_52_pct != null ? `${techData.week_52_pct}%` : '—'}
                    valueStyle={{ color: (techData.week_52_pct || 0) < -20 ? '#237804' : 'var(--text)' }} />
                </div>

                <ValuationCard val={a.valuation} />
              </div>

              {/* ★ Advanced Technical Indicators */}
              <AdvancedTechPanel tech={techData} />

              {/* Recommendation reasons */}
              {rec.reasons && rec.reasons.length > 0 && (
                <div className="stock-reasons-card">
                  <h4 className="stock-detail-title">Why {rec.signal}?</h4>
                  <div className="stock-reasons-list">
                    {rec.reasons.map((reason, i) => {
                      const bull = /above|growth|yield|Sustainable|bullish|oversold|Attractive|bull|beat|strong|dividend/i.test(reason);
                      const bear = /below|declin|bearish|overbought|payout.*risk|Expensive|leverage|Heavily|miss|fraud|ban/i.test(reason);
                      return (
                        <div key={i} className={`stock-reason-item${bull ? ' stock-reason--bull' : bear ? ' stock-reason--bear' : ''}`}>
                          <span style={{ marginRight: 6 }}>{bull ? '✅' : bear ? '⚠️' : '➡️'}</span>
                          {reason}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ★ Government Scheme Impact */}
              <SchemesPanel schemes={a.sector_schemes} />
            </>
          )}

          {/* ★ Detailed Financials */}
          {symbol && <FinancialsSection symbol={symbol} />}

          {/* ★ Enhanced News Section */}
          <NewsSection sentiment={sentiment} symbol={symbol} />
        </>
      )}

      {phases.basic === 'idle' && (
        <div className="stock-empty" style={{ marginTop: 40 }}>
          <span style={{ fontSize: 48 }}>📈</span>
          <p>Search any of 2000+ NSE stocks for deep analysis — entry timing, valuation, government policy impact, and market intelligence.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 12 }}>
            {['TCS.NS', 'INFY.NS', 'HDFCBANK.NS', 'ITC.NS', 'COALINDIA.NS', 'NTPC.NS'].map(s => (
              <button key={s} className="btn btn-sm btn-secondary" onClick={() => loadAll(s)}>
                {s.replace('.NS', '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Portfolio Insights Panel ──────────────────────────────────────────────────

function InsightsPanel() {
  const [insights, setInsights] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  useEffect(() => {
    stockService.portfolioInsights()
      .then(r => setInsights(r.data || []))
      .catch(() => setError('Could not load insights.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 16 }}><Spinner sm /> Loading insights…</div>;
  if (error)   return <p className="stock-error">{error}</p>;
  if (insights.length === 0) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>
        🧠 Holding Insights &amp; Recommendations
      </h4>
      <div className="insights-grid">
        {insights.map(ins => {
          const st = ACTION_STYLE[ins.action_color] || ACTION_STYLE.orange;
          return (
            <div key={ins.symbol} className="insight-card">
              <div className="insight-card-header">
                <div>
                  <span style={{ fontWeight: 700, color: 'var(--primary)', fontSize: 15 }}>
                    {ins.symbol.replace('.NS', '')}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-3)', marginLeft: 6 }}>{ins.company_name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {ins.urgency === 'high' && <span className="urgency-dot urgency-dot--high">●</span>}
                  <span style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
                    background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>{ins.action}</span>
                </div>
              </div>
              <div className="insight-stats">
                {[
                  { l: 'P&L %', v: `${ins.pnl_pct >= 0 ? '+' : ''}${ins.pnl_pct?.toFixed(2)}%`, c: chgClr(ins.pnl_pct) },
                  { l: 'Target', v: ins.price_target ? fmtC(ins.price_target) : '—', c: '#237804' },
                  { l: 'Stop Loss', v: ins.stop_loss_suggestion ? fmtC(ins.stop_loss_suggestion) : '—', c: '#cf1322' },
                  ...(ins.rsi != null ? [{ l: 'RSI', v: ins.rsi.toFixed(0),
                    c: ins.rsi < 35 ? '#237804' : ins.rsi > 65 ? '#cf1322' : 'var(--text)' }] : []),
                ].map(({ l, v, c }) => (
                  <div key={l} className="insight-stat">
                    <span className="insight-stat-lbl">{l}</span>
                    <span className="insight-stat-val" style={{ color: c }}>{v}</span>
                  </div>
                ))}
              </div>
              {ins.reasons && ins.reasons.length > 0 && (
                <ul className="insight-reasons">
                  {ins.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Portfolio Tab ─────────────────────────────────────────────────────────────

function PortfolioTab() {
  const [portfolio,    setPortfolio]    = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [showForm,     setShowForm]     = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [form,  setForm]  = useState({ symbol: '', type: 'buy', qty: '', price: '', brokerage: '20', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = () => {
    setLoading(true);
    stockService.getPortfolio().then(r => setPortfolio(r.data)).catch(() => {}).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const handleSubmit = async e => {
    e.preventDefault(); setFormErr('');
    if (!form.symbol || !form.qty || !form.price) { setFormErr('Symbol, qty, and price are required.'); return; }
    setSubmitting(true);
    try {
      await stockService.addTransaction({
        symbol:           form.symbol.toUpperCase() + (form.symbol.toUpperCase().endsWith('.NS') ? '' : '.NS'),
        transaction_type: form.type,
        quantity:  parseFloat(form.qty),
        price:     parseFloat(form.price),
        brokerage: parseFloat(form.brokerage) || 0,
        notes:     form.notes || null,
      });
      setShowForm(false);
      setForm({ symbol: '', type: 'buy', qty: '', price: '', brokerage: '20', notes: '' });
      load();
    } catch (err) {
      setFormErr(err.response?.data?.detail || 'Failed to add transaction.');
    } finally { setSubmitting(false); }
  };

  const del = async id => {
    if (!window.confirm('Delete this transaction?')) return;
    await stockService.deleteTransaction(id); load();
  };

  const p = portfolio || {};
  return (
    <div className="stock-tab-body">
      {!loading && portfolio && (
        <div className="stock-pf-summary">
          {[
            { label: 'Invested',      value: fmtC(p.total_invested), color: 'blue' },
            { label: 'Current Value', value: fmtC(p.current_value),  color: 'green' },
            { label: 'Net P&L',       value: `${(p.total_pnl||0)>=0?'+':''}${fmtC(p.total_pnl)}`, color: (p.total_pnl||0)>=0?'green':'red' },
            { label: 'Return %',      value: `${(p.pnl_pct||0)>=0?'+':''}${fmt(p.pnl_pct)}%`,     color: (p.pnl_pct||0)>=0?'green':'red' },
          ].map((c, i) => (
            <div key={i} className={`stock-pf-card stock-pf-card--${c.color}`}>
              <div className="stock-pf-val">{c.value}</div>
              <div className="stock-pf-lbl">{c.label}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 12 }}>
        {portfolio?.holdings?.length > 0 && (
          <button className="btn btn-sm btn-secondary" onClick={() => setShowInsights(v => !v)}>
            {showInsights ? '▲ Hide Insights' : '🧠 Show Insights'}
          </button>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? '✕ Cancel' : '+ Add Transaction'}
        </button>
      </div>
      {showForm && (
        <div className="stock-txn-form">
          <h4 style={{ marginBottom: 12, fontSize: 14 }}>New Transaction</h4>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            <div><label className="stock-filter-label">Symbol *</label>
              <input className="form-input" placeholder="e.g. TCS or TCS.NS"
                value={form.symbol} onChange={e => setForm(f => ({...f, symbol: e.target.value}))} /></div>
            <div><label className="stock-filter-label">Type *</label>
              <select className="form-input" value={form.type} onChange={e => setForm(f => ({...f, type: e.target.value}))}>
                <option value="buy">Buy</option><option value="sell">Sell</option><option value="dividend">Dividend</option>
              </select></div>
            <div><label className="stock-filter-label">Quantity *</label>
              <input className="form-input" type="number" min="0" step="any" placeholder="10"
                value={form.qty} onChange={e => setForm(f => ({...f, qty: e.target.value}))} /></div>
            <div><label className="stock-filter-label">Price ₹ *</label>
              <input className="form-input" type="number" min="0" step="any" placeholder="3500"
                value={form.price} onChange={e => setForm(f => ({...f, price: e.target.value}))} /></div>
            <div><label className="stock-filter-label">Brokerage ₹</label>
              <input className="form-input" type="number" min="0" step="any"
                value={form.brokerage} onChange={e => setForm(f => ({...f, brokerage: e.target.value}))} /></div>
            <div><label className="stock-filter-label">Notes</label>
              <input className="form-input" placeholder="optional"
                value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} /></div>
            {formErr && <p className="stock-error" style={{ gridColumn: '1/-1' }}>{formErr}</p>}
            <div style={{ gridColumn: '1/-1' }}>
              {form.qty && form.price && (
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6 }}>
                  Total: ₹{(parseFloat(form.qty||0)*parseFloat(form.price||0)+parseFloat(form.brokerage||0)).toFixed(2)}
                </p>
              )}
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <><Spinner sm /> Saving…</> : '✓ Save Transaction'}
              </button>
            </div>
          </form>
        </div>
      )}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><Spinner /></div>
      ) : (
        <>
          {p.holdings?.length > 0 && (
            <>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, marginTop: 8 }}>Holdings</h4>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Symbol</th><th>Company</th><th>Qty</th><th>Avg Cost</th>
                      <th>Price</th><th>Cost Basis</th><th>Curr Value</th>
                      <th>Dividends</th><th>P&amp;L</th><th>Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.holdings.map(h => (
                      <tr key={h.symbol}>
                        <td style={{ fontWeight: 700, color: 'var(--primary)' }}>{h.symbol.replace('.NS','')}</td>
                        <td style={{ fontSize: 12 }}>{h.company_name||'—'}</td>
                        <td>{h.qty}</td><td>{fmtC(h.avg_cost)}</td><td>{fmtC(h.current_price)}</td>
                        <td>{fmtC(h.cost_basis)}</td><td>{fmtC(h.current_value)}</td>
                        <td style={{ color:'#237804' }}>{fmtC(h.dividends)}</td>
                        <td style={{ fontWeight:700, color:chgClr(h.pnl) }}>{h.pnl>=0?'+':''}{fmtC(h.pnl)}</td>
                        <td style={{ color:chgClr(h.pnl_pct) }}>{h.pnl_pct>=0?'+':''}{fmt(h.pnl_pct)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {showInsights && <InsightsPanel />}
            </>
          )}
          <h4 style={{ fontSize: 14, fontWeight: 700, margin: '20px 0 10px' }}>Transaction Ledger</h4>
          {p.transactions?.length > 0 ? (
            <div className="table-responsive">
              <table className="data-table">
                <thead>
                  <tr><th>#</th><th>Symbol</th><th>Type</th><th>Qty</th><th>Price</th><th>Total</th><th>Brokerage</th><th>Notes</th><th>Date</th><th></th></tr>
                </thead>
                <tbody>
                  {p.transactions.map(tx => (
                    <tr key={tx.id}>
                      <td style={{color:'var(--text-3)'}}>{tx.id}</td>
                      <td style={{fontWeight:700}}>{tx.symbol.replace('.NS','')}</td>
                      <td>
                        <span style={{ padding:'2px 8px', borderRadius:999, fontSize:11, fontWeight:700,
                          background: tx.transaction_type==='buy'?'#f6ffed':tx.transaction_type==='sell'?'#fff2f0':'#fffbe6',
                          color:      tx.transaction_type==='buy'?'#237804':tx.transaction_type==='sell'?'#cf1322':'#ad6800',
                          border:`1px solid ${tx.transaction_type==='buy'?'#b7eb8f':tx.transaction_type==='sell'?'#ffa39e':'#ffe58f'}` }}>
                          {tx.transaction_type.toUpperCase()}
                        </span>
                      </td>
                      <td>{tx.quantity}</td><td>{fmtC(tx.price)}</td>
                      <td style={{fontWeight:600}}>{fmtC(tx.total_amount)}</td>
                      <td style={{color:'var(--text-3)'}}>{fmtC(tx.brokerage)}</td>
                      <td style={{fontSize:12,color:'var(--text-3)'}}>{tx.notes||'—'}</td>
                      <td style={{fontSize:12,color:'var(--text-3)'}}>
                        {tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td>
                        <button className="btn btn-sm" style={{color:'var(--danger)',background:'var(--danger-light)',border:'none'}}
                          onClick={()=>del(tx.id)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="stock-empty">
              <span style={{ fontSize: 36 }}>💼</span>
              <p>No transactions yet. Add your first trade to track P&amp;L.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Watchlist Tab ─────────────────────────────────────────────────────────────

function WatchlistTab({ onAnalyse }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ symbol:'', target:'', stop:'', notes:'' });
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState('');

  const load = () => { setLoading(true); stockService.getWatchlist().then(r=>setList(r.data||[])).catch(()=>{}).finally(()=>setLoading(false)); };
  useEffect(()=>{load();},[]);

  const handleSubmit = async e => {
    e.preventDefault(); setFormErr('');
    if (!form.symbol) { setFormErr('Symbol is required.'); return; }
    setSubmitting(true);
    try {
      await stockService.addWatchlist({
        symbol:       form.symbol.toUpperCase()+(form.symbol.toUpperCase().endsWith('.NS')?'':'.NS'),
        target_price: form.target ? parseFloat(form.target) : null,
        stop_loss:    form.stop   ? parseFloat(form.stop)   : null,
        notes:        form.notes || null,
      });
      setShowForm(false); setForm({symbol:'',target:'',stop:'',notes:''}); load();
    } catch(err) { setFormErr(err.response?.data?.detail||'Failed.'); } finally { setSubmitting(false); }
  };

  return (
    <div className="stock-tab-body">
      <div style={{display:'flex',justifyContent:'flex-end',marginBottom:12}}>
        <button className="btn btn-primary btn-sm" onClick={()=>setShowForm(v=>!v)}>
          {showForm?'✕ Cancel':'+ Watch Stock'}
        </button>
      </div>
      {showForm && (
        <div className="stock-txn-form">
          <h4 style={{marginBottom:12,fontSize:14}}>Add to Watchlist</h4>
          <form onSubmit={handleSubmit} style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:10}}>
            <div style={{gridColumn:'1/-1'}}>
              <label className="stock-filter-label">Symbol *</label>
              <input className="form-input" placeholder="e.g. ITC or ITC.NS"
                value={form.symbol} onChange={e=>setForm(f=>({...f,symbol:e.target.value}))} />
            </div>
            <div><label className="stock-filter-label">Target ₹</label>
              <input className="form-input" type="number" min="0" step="any"
                value={form.target} onChange={e=>setForm(f=>({...f,target:e.target.value}))} /></div>
            <div><label className="stock-filter-label">Stop Loss ₹</label>
              <input className="form-input" type="number" min="0" step="any"
                value={form.stop} onChange={e=>setForm(f=>({...f,stop:e.target.value}))} /></div>
            <div style={{gridColumn:'1/-1'}}>
              <label className="stock-filter-label">Notes</label>
              <input className="form-input" value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} />
            </div>
            {formErr && <p className="stock-error" style={{gridColumn:'1/-1'}}>{formErr}</p>}
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting?<><Spinner sm/>Adding…</>:'+ Add'}
            </button>
          </form>
        </div>
      )}
      {loading ? <div style={{display:'flex',justifyContent:'center',padding:60}}><Spinner /></div>
        : list.length === 0 ? (
          <div className="stock-empty"><span style={{fontSize:40}}>👁️</span><p>Watchlist is empty.</p></div>
        ) : (
          <div className="table-responsive" style={{marginTop:8}}>
            <table className="data-table">
              <thead><tr><th>Symbol</th><th>Company</th><th>Target ₹</th><th>Stop ₹</th><th>Added</th><th>Notes</th><th>Actions</th></tr></thead>
              <tbody>
                {list.map(w=>(
                  <tr key={w.id}>
                    <td style={{fontWeight:700,color:'var(--primary)'}}>{w.symbol.replace('.NS','')}</td>
                    <td style={{fontSize:12}}>{w.company_name||'—'}</td>
                    <td style={{color:'#237804',fontWeight:600}}>{w.target_price!=null?fmtC(w.target_price):'—'}</td>
                    <td style={{color:'#cf1322',fontWeight:600}}>{w.stop_loss!=null?fmtC(w.stop_loss):'—'}</td>
                    <td style={{fontSize:11,color:'var(--text-3)'}}>{w.added_at?new Date(w.added_at).toLocaleDateString('en-IN'):'—'}</td>
                    <td style={{fontSize:12}}>{w.notes||'—'}</td>
                    <td style={{display:'flex',gap:6}}>
                      <button className="btn btn-sm btn-secondary" onClick={()=>onAnalyse(w.symbol)}>Analyse</button>
                      <button className="btn btn-sm" style={{color:'var(--danger)',background:'var(--danger-light)',border:'none'}}
                        onClick={()=>stockService.removeWatchlist(w.id).then(load)}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StockDashboard() {
  const [activeTab,      setActiveTab]      = useState(0);
  const [analyserSymbol, setAnalyserSymbol] = useState('');

  const gotoAnalyser = symbol => { setAnalyserSymbol(symbol); setActiveTab(1); };

  return (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2>NSE Stock Dashboard</h2>
          <p className="page-subtitle">
            2000+ stocks · Entry/Exit timing · Graham valuation · Advanced technicals · Gov policy · Live news
          </p>
        </div>
        <span style={{ fontSize:11, padding:'3px 10px', borderRadius:999,
          background:'#f6ffed', color:'#237804', border:'1px solid #b7eb8f', fontWeight:600 }}>
          📡 Live NSE · yfinance
        </span>
      </div>

      <GlobalMarketBar />

      <div className="stock-tab-bar">
        {TABS.map((tab, i) => (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`stock-tab-btn${activeTab === i ? ' stock-tab-btn--active' : ''}`}>
            {['🔍','📊','💼','👁️'][i]} {tab}
          </button>
        ))}
      </div>

      {activeTab === 0 && <ScreenerTab onSelect={gotoAnalyser} />}
      {activeTab === 1 && <AnalyserTab preloadSymbol={analyserSymbol} key={analyserSymbol} />}
      {activeTab === 2 && <PortfolioTab />}
      {activeTab === 3 && <WatchlistTab onAnalyse={gotoAnalyser} />}
    </div>
  );
}
