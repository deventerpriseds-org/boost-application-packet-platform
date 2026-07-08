// Shell, layout primitives, and shared mini-components for the clickable prototype.
// COMPASS EDITION: the same structure + interactivity as the hand-drawn version,
// but every --proto-* variable maps to a Compass token and every .px-* class is
// restyled to the Compass aesthetic (Inter, hairline borders, rounded, teal brand).

(function injectStyles(){
  if (document.getElementById('proto-base-styles')) return;
  const s = document.createElement('style');
  s.id = 'proto-base-styles';
  s.textContent = `
    :root {
      /* Map the prototype's palette onto Compass tokens.
         Compass tokens auto-flip in dark mode via [data-theme="dark"], so
         dark mode "just works" without a separate .proto-dark block. */
      --proto-paper: var(--surface-background-primary);
      --proto-ink: var(--text-primary);
      --proto-ink2: var(--text-secondary);
      --proto-ink3: var(--text-tertiary);
      --proto-rule: var(--border-strong);
      --proto-rule-soft: var(--border-default);
      --proto-panel: var(--surface-background-secondary);
      --proto-panel-deep: var(--surface-background-tertiary);
      --proto-accent: var(--surface-brand-default);
      --proto-accent-soft: var(--surface-brand-subtle);
      --proto-green: var(--surface-success-default);  --proto-green-soft: var(--surface-success-subtle);
      --proto-red: var(--surface-error-default);       --proto-red-soft: var(--surface-error-subtle);
      --proto-yellow: var(--surface-warning-default);  --proto-yellow-soft: var(--surface-warning-subtle);
      --proto-purple: var(--purple-600);               --proto-purple-soft: var(--purple-100);
      --proto-orange: var(--orange-600);
      --proto-density: 1;
      --proto-radius: 12px;
      --proto-radius-sm: 8px;
    }
    /* Dark mode — self-contained. The Compass bundle ships a "preview pin"
       that strips [data-theme="dark"] / .dark, so we drive dark ourselves via
       the .proto-dark class (which the pin never touches) and override the
       Compass tokens our screens consume directly. */
    .proto-dark {
      --surface-background-primary: var(--neutral-900);
      --surface-background-secondary: var(--neutral-800);
      --surface-background-tertiary: var(--neutral-700);
      --border-default: var(--neutral-700);
      --border-strong: var(--neutral-600);
      --border-input: var(--neutral-600);
      --border-brand: var(--brand-500);
      --text-primary: var(--neutral-50);
      --text-secondary: var(--neutral-400);
      --text-tertiary: var(--neutral-500);
      --text-brand: var(--brand-300);
      --text-link: var(--brand-300);
      --text-link-hover: var(--brand-200);
      --surface-brand-hover: var(--brand-400);
      --surface-brand-subtle: var(--brand-950);
      --surface-success-subtle: var(--green-950);
      --surface-error-subtle: var(--red-950);
      --surface-warning-subtle: var(--yellow-950);
      --surface-info-subtle: var(--blue-950);
      --text-info: var(--blue-400);
      --blue-200: var(--blue-800);
      --proto-purple: var(--purple-400);  --proto-purple-soft: var(--purple-950);
      --proto-orange: var(--orange-400);
    }
    html, body, #root { height: 100%; }
    body { background: var(--surface-background-secondary); color: var(--proto-ink); font-family:'Inter', system-ui, sans-serif; overflow:hidden; -webkit-font-smoothing:antialiased; }

    /* utility classes — Compass aesthetic */
    .px-root { background: var(--surface-background-secondary); color: var(--proto-ink); font-family:'Inter', system-ui, sans-serif; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; }
    .px-box { border: 1px solid var(--proto-rule-soft); background: var(--proto-paper); border-radius: var(--proto-radius); }
    .px-box-soft { border: 1px solid var(--proto-rule-soft); background: var(--proto-paper); border-radius: var(--proto-radius-sm); }
    .px-panel { background: var(--proto-panel); border: 1px solid var(--proto-rule-soft); border-radius: var(--proto-radius); }
    .px-hatch { background-image: repeating-linear-gradient(45deg, var(--proto-rule-soft) 0, var(--proto-rule-soft) 1px, transparent 1px, transparent 7px); background-color: var(--proto-panel); border-radius: var(--proto-radius-sm); }
    .px-dashed { border: 1.5px dashed var(--proto-rule-soft); background: var(--proto-paper); border-radius: var(--proto-radius); }
    .px-pill { display:inline-flex; align-items:center; gap:4px; padding: 2px 9px; background: var(--proto-panel); color: var(--proto-ink2); font-size:11px; border-radius:99px; font-weight:600; line-height:1.5; }
    .px-chip { display:inline-flex; align-items:center; gap:4px; padding: 2px 8px; background: var(--proto-panel); font-size:11px; color: var(--proto-ink2); border-radius:99px; font-weight:500; }
    .px-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 13px; border:1px solid var(--border-input); background: var(--proto-paper); color: var(--proto-ink); font-family:'Inter', system-ui, sans-serif; font-size:13px; font-weight:500; cursor:pointer; user-select:none; border-radius: var(--proto-radius-sm); transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
    .px-btn:hover { background: var(--proto-panel); border-color: var(--proto-rule); }
    .px-btn:active { background: var(--proto-panel-deep); }
    .px-btn-dark { background: var(--surface-brand-default); color: var(--text-on-brand); border-color: var(--surface-brand-default); }
    .px-btn-dark:hover { background: var(--surface-brand-hover); border-color: var(--surface-brand-hover); }
    .px-btn-accent { background: var(--surface-brand-default); color: var(--text-on-brand); border-color: var(--surface-brand-default); }
    .px-btn-accent:hover { background: var(--surface-brand-hover); border-color: var(--surface-brand-hover); }
    .px-btn-green { background: var(--surface-success-default); color:#fff; border-color: var(--surface-success-default); }
    .px-btn-green:hover { background: var(--surface-success-hover); border-color: var(--surface-success-hover); }
    .px-btn-red { background: var(--surface-error-default); color:#fff; border-color: var(--surface-error-default); }
    .px-btn-red:hover { background: var(--surface-error-hover); border-color: var(--surface-error-hover); }
    .px-btn-yellow { background: var(--surface-warning-default); color:#fff; border-color: var(--surface-warning-default); }
    .px-btn-ghost { border-color: transparent; background: transparent; color: var(--text-brand); }
    .px-btn-ghost:hover { background: var(--surface-brand-subtle); border-color: transparent; }
    .px-btn:disabled, .px-btn[aria-disabled="true"] { opacity:.45; pointer-events:none; }

    .px-h1 { font-size:24px; font-weight:600; letter-spacing:-0.2px; }
    .px-h2 { font-size:17px; font-weight:600; letter-spacing:-0.1px; }
    .px-h3 { font-size:14px; font-weight:600; }
    .px-label { font-size:11px; color: var(--proto-ink3); letter-spacing:.4px; text-transform:uppercase; font-weight:600; }
    .px-meta { font-size:12px; color: var(--proto-ink2); }
    .px-small { font-size:11px; color: var(--proto-ink3); }
    .px-divider { height:1px; background: var(--proto-rule-soft); }
    .px-divider-bold { height:1px; background: var(--proto-rule); }

    .px-bar { height:6px; background: var(--proto-panel-deep); border-radius:99px; position:relative; overflow:hidden; }
    .px-bar > i { display:block; height:100%; background: var(--surface-brand-default); border-radius:99px; }

    .px-ava { width:32px; height:32px; border-radius:50%; background: var(--surface-brand-subtle); display:inline-flex; align-items:center; justify-content:center; font-weight:600; font-size:12px; flex-shrink:0; color: var(--text-brand); }
    .px-logo { width:32px; height:32px; border-radius: var(--proto-radius-sm); background: var(--proto-panel-deep); display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex-shrink:0; color: var(--proto-ink2); }

    .px-tab { padding:9px 14px; cursor:pointer; font-size:13px; font-weight:500; white-space:nowrap; color: var(--proto-ink2); transition: color 120ms ease, border-color 120ms ease; border-bottom:2px solid transparent; }
    .px-tab-active { color: var(--text-brand); border-bottom:2px solid var(--border-brand); font-weight:600; }
    .px-tab-idle:hover { color: var(--proto-ink); }

    .px-photo { position:relative; background: var(--proto-panel-deep); border-radius: var(--proto-radius-sm); overflow:hidden; }
    .px-photo::after { content:""; position:absolute; inset:0; opacity:.5; background:
      linear-gradient(to top right, transparent calc(50% - 1px), var(--proto-rule-soft) 50%, transparent calc(50% + 1px)),
      linear-gradient(to top left,  transparent calc(50% - 1px), var(--proto-rule-soft) 50%, transparent calc(50% + 1px));
    }

    .px-note { background: var(--surface-info-subtle); border:1px solid var(--blue-200); padding:8px 10px; font-size:12px; color: var(--text-info); border-radius: var(--proto-radius-sm); }

    .px-link { color: var(--text-link); cursor:pointer; font-weight:500; text-decoration: none; }
    .px-link:hover { color: var(--text-link-hover); text-decoration: underline; }

    /* appear animations */
    @keyframes toast-in { from { transform: translateY(8px); opacity:0; } to { transform: translateY(0); opacity:1; } }
    @keyframes proto-fade { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }
    .px-fade { animation: proto-fade 180ms ease-out; }

    /* Scrollbar (subtle) */
    *::-webkit-scrollbar { width:10px; height:10px; }
    *::-webkit-scrollbar-thumb { background: var(--proto-rule-soft); border-radius: 99px; }
    *::-webkit-scrollbar-track { background: transparent; }

    /* Inputs/textareas inherit Inter */
    .px-root input, .px-root textarea, .px-root select { font-family:'Inter', system-ui, sans-serif; }
  `;
  document.head.appendChild(s);
})();

/* ─────── DesktopShell ─────── */
function DesktopShell({ title, active, children }) {
  const { personaInfo, demoInfo, setView, dark, setDark } = useApp();
  const route = useRoute();

  const nav = [
    { id: 'home',       label: 'Today',         icon: '◐', path: '/' },
    { id: 'opps',       label: 'Opportunities', icon: '◇', path: '/opps' },
    { id: 'pipeline',   label: 'Pipeline',      icon: '▤', path: '/pipeline' },
    { id: 'packet',     label: 'Packets',       icon: '▣', path: '/packet' },
    { id: 'compose',    label: 'Composer',      icon: '✎', path: '/compose' },
    { id: 'answers',    label: 'App Answers',   icon: '⌸', path: '/answers' },
    { id: 'outreach',   label: 'Outreach',      icon: '✉', path: '/outreach' },
    { id: 'assets',     label: 'Assets',        icon: '◫', path: '/assets' },
    { id: 'roles',      label: 'Role Profiles', icon: '◐', path: '/roles' },
    { id: 'playbooks',  label: 'Playbooks',     icon: '⌬', path: '/playbooks' },
    { id: 'interview',  label: 'Interviews',    icon: '◉', path: '/interview' },
    { id: 'intake',     label: 'Intake',        icon: '▦', path: '/intake' },
    { id: 'settings',   label: 'Settings',      icon: '○', path: '/settings' },
  ];

  // Auto-detect active from route if not provided
  const autoActive = React.useMemo(() => {
    const p = route.parts[0];
    if (!p) return 'home';
    if (p === 'opp') return 'opps';
    if (p === 'compose') return 'compose';
    if (p === 'answers') return 'answers';
    if (p === 'packet') return 'packet';
    return p;
  }, [route.path]);
  const currentActive = active || autoActive;

  return (
    <div className="px-root">
      {/* Top bar */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', borderBottom:'1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', flexShrink:0 }}>
        <div onClick={() => go('/')} style={{ cursor:'pointer', fontFamily:"'Inter', sans-serif", fontWeight:700, fontSize:17, letterSpacing:-0.3, lineHeight:1, color:'var(--text-primary)' }}>Pipeline<span style={{color:'var(--proto-accent)'}}>·</span>Exec</div>
        <div style={{ borderLeft:'1px solid var(--proto-rule-soft)', paddingLeft:12, fontSize:13, color: 'var(--proto-ink2)' }}>{title}</div>
        <div style={{ flex:1 }} />
        <div className="px-box-soft" style={{ padding:'6px 12px', fontSize:12, color: 'var(--proto-ink3)', display:'flex', alignItems:'center', gap:6, minWidth:230, background:'var(--proto-panel)', border:'none' }}>
          <span>⌕</span><span>Search opportunities, contacts, playbooks…</span>
        </div>
        <div className="px-btn px-btn-ghost" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => go('/')}>🔔 6</div>
        <div className="px-btn px-btn-ghost" style={{ padding:'5px 10px', fontSize:14 }} onClick={() => setDark(!dark)} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? '☀️' : '🌙'}</div>
        <div className="px-btn px-btn-ghost" style={{ padding:'5px 10px', fontSize:12 }} onClick={() => setView('mobile')} title="Switch to mobile view">📱 Mobile</div>
        <div className="px-ava" title={personaInfo.user.name}>{personaInfo.user.initials}</div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Left nav */}
        <div style={{ width:196, borderRight:'1px solid var(--proto-rule-soft)', background:'var(--proto-paper)', display:'flex', flexDirection:'column', flexShrink:0, padding:'8px' }}>
          {nav.map(n => (
            <div key={n.id} onClick={() => go(n.path)} style={{
              padding:'8px 10px', cursor:'pointer', fontSize:13, borderRadius:'8px', marginBottom:2,
              background: currentActive === n.id ? 'var(--surface-brand-subtle)' : 'transparent',
              fontWeight: currentActive === n.id ? 600 : 500,
              color: currentActive === n.id ? 'var(--text-brand)' : 'var(--proto-ink2)',
              display:'flex', alignItems:'center', gap:9,
            }}>
              <span style={{ width:15, textAlign:'center', opacity:.9 }}>{n.icon}</span>{n.label}
            </div>
          ))}
          <div style={{ flex:1 }} />
          <div style={{ padding:10, display:'flex', flexDirection:'column', gap:6, borderTop:'1px solid var(--proto-rule-soft)', marginTop:8 }}>
            <div className="px-small" style={{ fontSize:10 }}>Persona</div>
            <div style={{ fontSize:12, fontWeight:600 }}>{personaInfo.label}</div>
            <div className="px-small" style={{ fontSize:10, textTransform:'uppercase' }}>{demoInfo.label}</div>
            <div className="px-btn px-btn-dark" style={{ width:'100%', justifyContent:'center', fontSize:12, marginTop:4 }} onClick={() => go('/opps')}>+ Opportunity</div>
          </div>
        </div>

        {/* Page body */}
        <div style={{ flex:1, overflow:'auto', background: 'var(--surface-background-secondary)' }} className="px-fade" key={route.path}>{children}</div>
      </div>
    </div>
  );
}

/* ─────── PhoneShell — iOS-y phone bezel ─────── */
function PhoneShell({ title, children, footer = true, footerActive }) {
  const { personaInfo, setView, dark, setDark } = useApp();
  const route = useRoute();
  const auto = route.parts[0] || '';
  const active = footerActive || auto;

  return (
    <div style={{
      width:'100%', height:'100%', background: '#000',
      display:'flex', alignItems:'center', justifyContent:'center', padding:24,
    }}>
      <div style={{
        width: 390, height: 'min(844px, calc(100vh - 48px))',
        background: 'var(--proto-paper)',
        borderRadius: 44, overflow: 'hidden',
        border: '8px solid #111', boxShadow: '0 30px 60px rgba(0,0,0,.5)',
        display:'flex', flexDirection:'column', position:'relative',
      }}>
        {/* Dynamic island */}
        <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', width:96, height:24, background:'#000', borderRadius:99, zIndex:5 }} />

        {/* Status bar */}
        <div style={{ display:'flex', justifyContent:'space-between', padding:'12px 24px 8px', fontSize:12, fontWeight:700, flexShrink:0 }}>
          <span>9:41</span><span>●●●● 5G ▮</span>
        </div>

        {/* App header */}
        <div style={{ padding:'4px 16px 10px', borderBottom:'1px solid var(--proto-rule-soft)', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <div className="px-ava" style={{ width:30, height:30, fontSize:12 }}>{personaInfo.user.initials}</div>
          <div style={{ flex:1 }}>
            <div className="px-small" style={{ fontSize:11 }}>{title}</div>
            <div className="px-h3" style={{ fontSize:15 }}>Good morning, {personaInfo.user.name.split(' ')[0]}</div>
          </div>
          <div style={{ display:'flex', gap:6, alignItems:'center' }}>
            <div style={{ fontSize:15, cursor:'pointer' }} onClick={() => setDark(!dark)} title="Toggle dark mode">{dark ? '☀️' : '🌙'}</div>
            <div style={{ fontSize:16, cursor:'pointer' }} onClick={() => setView('desktop')} title="Switch to desktop">🖥️</div>
          </div>
        </div>

        <div style={{ flex:1, overflow:'auto', position:'relative' }}>{children}</div>

        {footer && (
          <div style={{ display:'flex', justifyContent:'space-around', padding:'8px 8px 14px', borderTop:'1px solid var(--proto-rule-soft)', background:'var(--proto-paper)', flexShrink:0, fontSize:11 }}>
            <NavTab id="today"    icon="◐" label="Today"    active={active === ''      || active === 'today'} path="/" />
            <NavTab id="swipe"    icon="◇" label="Swipe"    active={active === 'swipe'} path="/swipe" />
            <NavTab id="pipeline" icon="▤" label="Pipeline" active={active === 'pipeline'} path="/pipeline" />
            <NavTab id="outreach" icon="✉" label="Outreach" active={active === 'outreach'} path="/outreach" />
            <NavTab id="interview"icon="◉" label="Prep"    active={active === 'interview'} path="/interview" />
          </div>
        )}

        {/* Home indicator */}
        <div style={{ position:'absolute', bottom:6, left:'50%', transform:'translateX(-50%)', width:120, height:4, background:'var(--proto-ink)', borderRadius:99, opacity:.4 }} />
      </div>
    </div>
  );
}

function NavTab({ icon, label, active, path }) {
  return (
    <div onClick={() => go(path)} style={{ textAlign:'center', fontWeight: active ? 700 : 400, color: active ? 'var(--proto-ink)' : 'var(--proto-ink3)', cursor:'pointer', lineHeight:1.2 }}>
      <div style={{ fontSize: 14 }}>{icon}</div>
      <div>{label}</div>
    </div>
  );
}

/* ─────── Tiny helpers ─────── */
function Pill({ children, color = 'var(--proto-ink)', bg = 'var(--proto-paper)' }) {
  return <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 8px', border:`1.5px solid ${color}`, background:bg, color: color, fontSize:11, borderRadius:99, fontWeight:600, whiteSpace:'nowrap' }}>{children}</span>;
}

function StageBadge({ stage }) {
  const map = {
    'final':   { bg: 'var(--proto-purple-soft)', fg: PROTO.purple, label:'Final Round' },
    'panel':   { bg: 'var(--proto-purple-soft)', fg: PROTO.purple, label:'Panel' },
    'r1':      { bg: 'var(--proto-purple-soft)', fg: PROTO.purple, label:'Round 1' },
    'screen':  { bg: 'var(--proto-green-soft)',  fg: PROTO.green,  label:'Screening' },
    'engaged': { bg: 'var(--proto-accent-soft)', fg: 'var(--proto-accent)', label:'Engaged' },
    'outreach':{ bg: 'var(--proto-yellow-soft)', fg: PROTO.yellow, label:'Outreach' },
    'applied': { bg: 'var(--proto-yellow-soft)', fg: PROTO.yellow, label:'Applied' },
    'enriched':{ bg: 'var(--proto-panel)',       fg: 'var(--proto-ink2)', label:'Enriched' },
    'saved':   { bg: 'var(--proto-panel)',       fg: 'var(--proto-ink2)', label:'Saved' },
    'discovered':{ bg: 'transparent',            fg: 'var(--proto-ink3)', label:'Discovered' },
    'offer':   { bg: 'var(--proto-green-soft)',  fg: PROTO.green,  label:'Offer' },
    'accepted':{ bg: 'var(--proto-green-soft)',  fg: PROTO.green,  label:'Accepted' },
  };
  const c = map[stage] || { bg:'var(--proto-panel)', fg:'var(--proto-ink2)', label: stage };
  return <span style={{ padding:'2px 8px', background:c.bg, color:c.fg, border:`1.5px solid ${c.fg}`, fontSize:11, fontWeight:600, borderRadius:99, whiteSpace:'nowrap' }}>{c.label}</span>;
}

function MatchScore({ n, size = 30 }) {
  const color = n >= 90 ? PROTO.green : n >= 80 ? 'var(--proto-accent)' : n >= 70 ? PROTO.yellow : 'var(--proto-ink3)';
  const r = size / 2.4;
  const circ = 2 * Math.PI * r;
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
      <div style={{ position:'relative', width:size, height:size }}>
        <svg viewBox="0 0 36 36" style={{ width:size, height:size }}>
          <circle cx="18" cy="18" r="15" fill="none" stroke="var(--proto-rule-soft)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15" fill="none" stroke={color} strokeWidth="3"
            strokeDasharray={`${(n/100)*94} 100`} strokeLinecap="round" transform="rotate(-90 18 18)" />
        </svg>
        <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize: size <= 28 ? 10 : 11, fontWeight:700, color }}>{n}</div>
      </div>
    </div>
  );
}

function Bar({ value, color = 'var(--proto-ink)', height = 6 }) {
  return (
    <div style={{ height, background:'var(--proto-panel-deep)', border:'1px solid var(--proto-ink)', position:'relative' }}>
      <div style={{ width:`${value}%`, height:'100%', background: color, transition:'width 400ms ease' }} />
    </div>
  );
}

function SectionTitle({ children, sub, right }) {
  return (
    <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:10 }}>
      <div className="px-h2">{children}</div>
      {sub && <div className="px-meta">{sub}</div>}
      {right && <div style={{ marginLeft:'auto' }}>{right}</div>}
    </div>
  );
}

/* ─────── Click-to-go link helper ─────── */
function L({ to, children, ...rest }) {
  return <span className="px-link" onClick={() => go(to)} {...rest}>{children}</span>;
}

Object.assign(window, { DesktopShell, PhoneShell, NavTab, Pill, StageBadge, MatchScore, Bar, SectionTitle, L });
