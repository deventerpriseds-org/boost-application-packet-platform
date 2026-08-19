// Shell ported 1:1 from app/src/shell.jsx (nav list, TopBar, SideNav, Pill,
// MatchScore) + the prototype's own mode controls, which are NOT part of the app.

const NAV = [
  { path: '/today', label: 'Today', icon: '◉' },
  { path: '/swipe', label: 'Swipe', icon: '⧉' },
  { path: '/opportunities', label: 'Opportunities', icon: '◇' },
  { path: '/pipeline', label: 'Pipeline', icon: '▤' },
  { path: '/packets', label: 'Packets', icon: '▦' },
  { path: '/outreach', label: 'Outreach', icon: '✉' },
  { path: '/interview', label: 'Interviews', icon: '◍' },
  { path: '/library', label: 'Assets', icon: '◫' },
  { path: '/roles', label: 'Roles & Titles', icon: '☰' },
  { path: '/library/roles', label: 'Role Profiles', icon: '◈' },
  { path: '/library/playbooks', label: 'Playbooks', icon: '▥' },
  { path: '/call', label: 'Coach', icon: '☎' },
  { path: '/intake', label: 'Intake', icon: '⇊' },
];

// Pill: the repo's version resolves `var(--proto-${tone}-soft)` for background and
// `var(--proto-${tone})` for text. For tone 'panel' (artifact status 'todo') that
// means an undefined --proto-panel-soft background and a near-white
// --proto-panel text color — white-on-white in the live app. Kept 1:1 in shape,
// with an explicit tone map so the prototype is legible.
const PILL_TONE = { panel: { bg: 'var(--proto-panel-deep)', fg: 'var(--proto-ink2)' } };
const Pill = ({ children, tone, style }) => {
  const t = tone ? (PILL_TONE[tone] || { bg: `var(--proto-${tone}-soft)`, fg: `var(--proto-${tone})` }) : null;
  return <span className="px-pill" style={{ ...(t ? { background: t.bg, color: t.fg } : {}), ...style }}>{children}</span>;
};

function MatchScore({ value, size = 34 }) {
  const r = (size - 6) / 2, c = 2 * Math.PI * r, off = c * (1 - (value || 0) / 100);
  const color = value >= 88 ? 'var(--proto-green)' : value >= 78 ? 'var(--proto-accent)' : 'var(--proto-yellow)';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--proto-panel-deep)" strokeWidth="3" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const ModeCtx = React.createContext({ mode: 'additive', hl: true });
const useMode = () => React.useContext(ModeCtx);

// Wrapper for anything the current app does NOT have. Hidden in "current app"
// mode, outlined + labelled in highlight mode.
function New({ children, label, style, inline }) {
  const Tag = inline ? 'span' : 'div';
  return <Tag className="qc-new" data-newlabel={label || 'new'} style={style}>{children}</Tag>;
}

function TopBar({ title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', height: 54, borderBottom: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink: 0 }}>
      <div style={{ cursor: 'pointer', fontWeight: 700, fontSize: 16, letterSpacing: -0.3, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
        Pipeline<span style={{ color: 'var(--proto-accent)' }}>·</span>Exec
      </div>
      <div className="ee-hide-sm" style={{ borderLeft: '1px solid var(--proto-rule-soft)', paddingLeft: 12, fontSize: 13, color: 'var(--proto-ink2)' }}>{title}</div>
      <div style={{ flex: 1 }} />
      <button className="px-btn" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--surface-success-default)' }} />
        <span className="ee-hide-sm" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>von@enterpriseds.io</span>
      </button>
      <button className="px-btn" title="Settings">⚙</button>
      <button className="px-btn" title="Toggle theme">☀</button>
    </div>
  );
}

function SideNav() {
  return (
    <div style={{ width: 196, borderRight: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', padding: 12, flexShrink: 0, overflowY: 'auto' }}>
      {NAV.map((n) => {
        const on = n.path === '/packets';
        return (
          <div key={n.label}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 13, fontWeight: on ? 600 : 500, background: on ? 'var(--proto-accent-soft)' : 'transparent', color: on ? 'var(--text-brand)' : 'var(--proto-ink2)' }}>
            <span style={{ width: 16, textAlign: 'center' }}>{n.icon}</span>{n.label}
          </div>
        );
      })}
    </div>
  );
}

function DesktopShell({ children, title }) {
  return (
    <div className="px-root">
      <TopBar title={title} />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SideNav />
        <div className="px-fade" style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <div style={{ maxWidth: 1560, margin: '0 auto', paddingBottom: 72 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function ProtoControls({ mode, setMode, hl, setHl, offset }) {
  return (
    <div style={{ position: 'fixed', left: '50%', bottom: 16, transform: `translateX(calc(-50% - ${offset || 0}px))`, transition: 'transform 160ms ease', zIndex: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 999, background: 'var(--proto-paper)', border: '1px solid var(--proto-rule-soft)', boxShadow: '0 8px 28px rgba(15,23,42,.16)' }}>
      <span className="px-small" style={{ letterSpacing: '.4px', textTransform: 'uppercase', fontWeight: 700 }} title="UI spec only — no change to prompts, templates or merge fields">UI spec</span>
      <div style={{ display: 'flex', background: 'var(--proto-panel)', borderRadius: 999, padding: 2 }}>
        {[['asis', 'Current app'], ['additive', 'With QC layer']].map(([k, l]) => (
          <div key={k} onClick={() => setMode(k)}
            style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: mode === k ? 'var(--surface-brand-default)' : 'transparent', color: mode === k ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>{l}</div>
        ))}
      </div>
      <div onClick={() => setHl(!hl)} title="Outline and label everything that does not exist in the app today"
        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: mode === 'asis' ? 'not-allowed' : 'pointer', opacity: mode === 'asis' ? .4 : 1, fontSize: 12, fontWeight: 600, color: 'var(--proto-ink2)' }}>
        <span style={{ width: 30, height: 17, borderRadius: 999, background: hl ? '#7c3aed' : 'var(--proto-panel-deep)', position: 'relative', transition: 'background 140ms' }}>
          <span style={{ position: 'absolute', top: 2, left: hl ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left 140ms' }} />
        </span>
        Highlight additions
      </div>
    </div>
  );
}

function useWide(px) {
  const q = `(min-width: ${px}px)`;
  const [w, setW] = React.useState(() => window.matchMedia(q).matches);
  React.useEffect(() => { const m = window.matchMedia(q); const on = () => setW(m.matches); m.addEventListener('change', on); return () => m.removeEventListener('change', on); }, [q]);
  return w;
}

Object.assign(window, { NAV, Pill, MatchScore, DesktopShell, ModeCtx, useMode, New, ProtoControls, useWide });
