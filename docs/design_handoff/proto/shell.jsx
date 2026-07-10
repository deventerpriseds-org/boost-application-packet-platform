// Shell, layout primitives, and shared mini-components for the clickable prototype.
// Mirrors the wireframe aesthetic from exec/chrome.jsx but with real interactivity.

(function injectStyles(){
  if (document.getElementById('proto-base-styles')) return;
  const s = document.createElement('style');
  s.id = 'proto-base-styles';
  s.textContent = `
    :root {
      --proto-paper: ${PROTO.paper};
      --proto-ink: ${PROTO.ink};
      --proto-ink2: ${PROTO.ink2};
      --proto-ink3: ${PROTO.ink3};
      --proto-rule: ${PROTO.ink};
      --proto-rule-soft: ${PROTO.ruleSoft};
      --proto-panel: ${PROTO.panel};
      --proto-panel-deep: ${PROTO.panelDeep};
      --proto-accent: ${PROTO.accent};
      --proto-accent-soft: ${PROTO.accentSoft};
      --proto-green: ${PROTO.green};   --proto-green-soft: ${PROTO.greenSoft};
      --proto-red: ${PROTO.red};       --proto-red-soft: ${PROTO.redSoft};
      --proto-yellow: ${PROTO.yellow}; --proto-yellow-soft: ${PROTO.yellowSoft};
      --proto-purple: ${PROTO.purple}; --proto-purple-soft: ${PROTO.purpleSoft};
      --proto-orange: ${PROTO.orange};
      --proto-density: 1;
    }
    .proto-dark {
      --proto-paper: ${PROTO_DARK.paper};
      --proto-ink: ${PROTO_DARK.ink};
      --proto-ink2: ${PROTO_DARK.ink2};
      --proto-ink3: ${PROTO_DARK.ink3};
      --proto-rule: ${PROTO_DARK.ink};
      --proto-rule-soft: ${PROTO_DARK.ruleSoft};
      --proto-panel: ${PROTO_DARK.panel};
      --proto-panel-deep: ${PROTO_DARK.panelDeep};
      --proto-accent-soft: ${PROTO_DARK.accentSoft};
      --proto-green-soft: ${PROTO_DARK.greenSoft};
      --proto-red-soft: ${PROTO_DARK.redSoft};
      --proto-yellow-soft: ${PROTO_DARK.yellowSoft};
      --proto-purple-soft: ${PROTO_DARK.purpleSoft};
    }
    html, body, #root { height: 100%; }
    body { background: var(--proto-paper); color: var(--proto-ink); font-family:'Caveat', cursive; overflow:hidden; }

    /* utility classes — match wireframe aesthetic */
    .px-root { background: var(--proto-paper); color: var(--proto-ink); font-family:'Caveat', cursive; width:100%; height:100%; display:flex; flex-direction:column; overflow:hidden; }
    .px-box { border: 2px solid var(--proto-ink); background: var(--proto-paper); }
    .px-box-soft { border: 1.5px solid var(--proto-rule-soft); background: var(--proto-paper); }
    .px-panel { background: var(--proto-panel); border: 2px solid var(--proto-ink); }
    .px-hatch { background-image: repeating-linear-gradient(45deg, var(--proto-rule-soft) 0, var(--proto-rule-soft) 1px, transparent 1px, transparent 7px); background-color: var(--proto-panel); }
    .px-dashed { border: 2px dashed var(--proto-rule-soft); background: var(--proto-paper); }
    .px-pill { display:inline-flex; align-items:center; gap:4px; padding: 2px 8px; border: 1.5px solid var(--proto-ink); background: var(--proto-paper); font-size:11px; border-radius:99px; font-weight:600; }
    .px-chip { display:inline-flex; align-items:center; gap:4px; padding: 1px 6px; border: 1px solid var(--proto-rule-soft); background: var(--proto-panel); font-size:11px; color: var(--proto-ink2); }
    .px-btn { display:inline-flex; align-items:center; gap:6px; padding:5px 12px; border:2px solid var(--proto-ink); background: var(--proto-paper); color: var(--proto-ink); font-family:'Caveat',cursive; font-size:13px; font-weight:600; cursor:pointer; user-select:none; transition: transform 80ms ease, background 100ms ease; }
    .px-btn:hover { background: var(--proto-panel); }
    .px-btn:active { transform: translate(1px,1px); }
    .px-btn-dark { background: var(--proto-ink); color: var(--proto-paper); }
    .px-btn-dark:hover { background: var(--proto-ink2); }
    .px-btn-accent { background: var(--proto-accent); color:#fff; border-color: var(--proto-accent); }
    .px-btn-green { background: var(--proto-green); color:#fff; border-color: var(--proto-green); }
    .px-btn-red { background: var(--proto-red); color:#fff; border-color: var(--proto-red); }
    .px-btn-yellow { background: var(--proto-yellow); color:#fff; border-color: var(--proto-yellow); }
    .px-btn-ghost { border-color: var(--proto-rule-soft); background: transparent; }
    .px-btn:disabled, .px-btn[aria-disabled="true"] { opacity:.5; pointer-events:none; }

    .px-h1 { font-size:22px; font-weight:700; letter-spacing:-0.3px; }
    .px-h2 { font-size:17px; font-weight:700; }
    .px-h3 { font-size:14px; font-weight:700; }
    .px-label { font-size:11px; color: var(--proto-ink3); letter-spacing:.5px; text-transform:uppercase; font-weight:600; }
    .px-meta { font-size:12px; color: var(--proto-ink2); }
    .px-small { font-size:11px; color: var(--proto-ink3); }
    .px-divider { height:1.5px; background: var(--proto-rule-soft); }
    .px-divider-bold { height:2px; background: var(--proto-ink); }

    .px-bar { height:6px; background: var(--proto-panel-deep); border:1px solid var(--proto-ink); position:relative; }
    .px-bar > i { display:block; height:100%; background: var(--proto-ink); }

    .px-ava { width:32px; height:32px; border-radius:50%; border:2px solid var(--proto-ink); background: var(--proto-panel); display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex-shrink:0; color: var(--proto-ink); }
    .px-logo { width:32px; height:32px; border:2px solid var(--proto-ink); background: var(--proto-panel); display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:14px; flex-shrink:0; color: var(--proto-ink); }

    .px-tab { padding:8px 14px; cursor:pointer; border-right:2px solid var(--proto-ink); font-size:13px; font-weight:600; white-space:nowrap; color: var(--proto-ink); transition: background 100ms ease; }
    .px-tab-active { background: var(--proto-paper); border-bottom:2px solid var(--proto-paper); margin-bottom:-2px; }
    .px-tab-idle { background: var(--proto-panel); color: var(--proto-ink2); }
    .px-tab-idle:hover { background: var(--proto-panel-deep); }

    .px-photo { position:relative; background: var(--proto-panel); border:1.5px solid var(--proto-rule-soft); overflow:hidden; }
    .px-photo::after { content:""; position:absolute; inset:0; background:
      linear-gradient(to top right, transparent calc(50% - 1px), var(--proto-rule-soft) 50%, transparent calc(50% + 1px)),
      linear-gradient(to top left,  transparent calc(50% - 1px), var(--proto-rule-soft) 50%, transparent calc(50% + 1px));
    }

    .px-note { background:#fff7c8; border:1.5px solid #d4b842; padding:6px 8px; font-size:12px; color:#5a4a2a; }
    .proto-dark .px-note { background: #3b3318; border-color:#7a6228; color:#e0c878; }

    .px-link { color: var(--proto-accent); cursor:pointer; text-decoration: underline dotted; text-underline-offset:2px; }

    /* Card flip / appear animations */
    @keyframes toast-in { from { transform: translateY(8px); opacity:0; } to { transform: translateY(0); opacity:1; } }
    @keyframes proto-fade { from { opacity:0; transform: translateY(4px); } to { opacity:1; transform: translateY(0); } }
    .px-fade { animation: proto-fade 180ms ease-out; }

    /* Scrollbar (subtle) */
    *::-webkit-scrollbar { width:10px; height:10px; }
    *::-webkit-scrollbar-thumb { background: var(--proto-rule-soft); border-radius: 99px; }
    *::-webkit-scrollbar-track { background: transparent; }
  `;
  document.head.appendChild(s);
})();

/* ─────── DesktopShell ─────── */
function DesktopShell({ title, active, children }) {
  const { personaInfo, demoInfo, setView } = useApp();
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
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 16px', borderBottom:'2px solid var(--proto-ink)', background: 'var(--proto-paper)', flexShrink:0 }}>
        <div onClick={() => go('/')} style={{ cursor:'pointer', fontFamily:"'Caveat Brush', cursive", fontSize:22, letterSpacing:-0.5, lineHeight:1 }}>Pipeline<span style={{color:'var(--proto-accent)'}}>·</span>Exec</div>
        <div style={{ borderLeft:'2px solid var(--proto-rule-soft)', paddingLeft:12, fontSize:13, color: 'var(--proto-ink2)' }}>{title}</div>
        <div style={{ flex:1 }} />
        <div className="px-box-soft" style={{ padding:'4px 10px', fontSize:12, color: 'var(--proto-ink3)', display:'flex', alignItems:'center', gap:6, minWidth:230 }}>
          <span>⌕</span><span>Search opportunities, contacts, playbooks…</span>
        </div>
        <div className="px-btn px-btn-ghost" style={{ padding:'3px 10px', fontSize:12 }} onClick={() => go('/')}>🔔 6</div>
        <div className="px-btn px-btn-ghost" style={{ padding:'3px 10px', fontSize:12 }} onClick={() => setView('mobile')} title="Switch to mobile view">📱 Mobile</div>
        <div className="px-ava" title={personaInfo.user.name}>{personaInfo.user.initials}</div>
      </div>

      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
        {/* Left nav */}
        <div style={{ width:170, borderRight:'2px solid var(--proto-ink)', background:'var(--proto-panel)', display:'flex', flexDirection:'column', flexShrink:0 }}>
          {nav.map(n => (
            <div key={n.id} onClick={() => go(n.path)} style={{
              padding:'8px 12px', cursor:'pointer', fontSize:13,
              borderBottom: '1.5px solid var(--proto-rule-soft)',
              borderLeft: currentActive === n.id ? '4px solid var(--proto-accent)' : '4px solid transparent',
              background: currentActive === n.id ? 'var(--proto-paper)' : 'transparent',
              fontWeight: currentActive === n.id ? 700 : 400,
              color: 'var(--proto-ink)',
              display:'flex', alignItems:'center', gap:8,
            }}>
              <span style={{ width:14, textAlign:'center' }}>{n.icon}</span>{n.label}
            </div>
          ))}
          <div style={{ flex:1 }} />
          <div style={{ padding:10, display:'flex', flexDirection:'column', gap:6, borderTop:'1.5px solid var(--proto-rule-soft)' }}>
            <div className="px-small" style={{ fontSize:10 }}>Persona</div>
            <div style={{ fontSize:12, fontWeight:700 }}>{personaInfo.label}</div>
            <div className="px-small" style={{ fontSize:10, textTransform:'uppercase' }}>{demoInfo.label}</div>
            <div className="px-btn px-btn-dark" style={{ width:'100%', justifyContent:'center', fontSize:12, marginTop:4 }} onClick={() => go('/opps')}>+ Opportunity</div>
          </div>
        </div>

        {/* Page body */}
        <div style={{ flex:1, overflow:'auto', background: 'var(--proto-paper)' }} className="px-fade" key={route.path}>{children}</div>
      </div>
    </div>
  );
}

/* ─────── PhoneShell — iOS-y phone bezel ─────── */
function PhoneShell({ title, children, footer = true, footerActive }) {
  const { personaInfo, setView } = useApp();
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
        <div style={{ padding:'4px 16px 10px', borderBottom:'2px solid var(--proto-ink)', display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
          <div className="px-ava" style={{ width:30, height:30, fontSize:12 }}>{personaInfo.user.initials}</div>
          <div style={{ flex:1 }}>
            <div className="px-small" style={{ fontSize:11 }}>{title}</div>
            <div className="px-h3" style={{ fontSize:15 }}>Good morning, {personaInfo.user.name.split(' ')[0]}</div>
          </div>
          <div style={{ fontSize:16 }} onClick={() => setView('desktop')} title="Switch to desktop">🖥️</div>
        </div>

        <div style={{ flex:1, overflow:'auto', position:'relative' }}>{children}</div>

        {footer && (
          <div style={{ display:'flex', justifyContent:'space-around', padding:'8px 8px 14px', borderTop:'2px solid var(--proto-ink)', background:'var(--proto-panel)', flexShrink:0, fontSize:11 }}>
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
