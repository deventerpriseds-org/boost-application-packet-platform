// App state + tiny hash router for the Executive Engine clickable prototype.

/* ─────── Hash router ─────── */
function useRoute() {
  const [hash, setHash] = React.useState(() => window.location.hash || '#/');
  React.useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  // Strip leading "#"
  const path = hash.replace(/^#/, '') || '/';
  const parts = path.split('/').filter(Boolean); // e.g. ['opp', '1', 'overview']
  return { path, parts };
}

function go(path) {
  if (!path.startsWith('#')) path = '#' + path;
  window.location.hash = path;
}

/* ─────── App state ─────── */
const AppCtx = React.createContext(null);

// Default tweaks — exposed via the EDITMODE markers in the host HTML.
function AppProvider({ initial, children }) {
  // Persona, demo state, visuals, features
  const [persona,    setPersona]    = React.useState(initial.persona    || 'CTO');
  const [demoState,  setDemoState]  = React.useState(initial.demoState  || 'mid');
  const [density,    setDensity]    = React.useState(initial.density    || 'comfortable');
  const [dark,       setDark]       = React.useState(initial.dark       || false);
  const [accent,     setAccent]     = React.useState(initial.accent     || '#3a5fc8');
  const [features,   setFeatures]   = React.useState(initial.features   || { ai: true, swipe: true, recording: true, debrief: true, cadence: true });
  const [view,       setView]       = React.useState(initial.view       || 'desktop'); // 'desktop' | 'mobile'

  // Mutable pipeline — opp_id -> stage_id
  const [stageMap, setStageMap] = React.useState(() => ({ ...DEMO_STATES[initial.demoState || 'mid'].stages }));
  // Re-seed when demo state changes
  React.useEffect(() => {
    setStageMap({ ...DEMO_STATES[demoState].stages });
  }, [demoState]);

  // Apply dark-mode + accent. Dark is driven by the .proto-dark class (the
  // Compass bundle's preview-pin strips data-theme/.dark, so we avoid those);
  // shell.jsx overrides the design-system tokens under .proto-dark. Accent points
  // the brand tokens at the chosen color so it cascades everywhere.
  React.useEffect(() => {
    const root = document.documentElement;
    if (dark) root.classList.add('proto-dark');
    else root.classList.remove('proto-dark');
    root.style.setProperty('--proto-accent', accent);
    root.style.setProperty('--surface-brand-default', accent);
    root.style.setProperty('--proto-density', density === 'compact' ? '0.85' : '1');
  }, [dark, accent, density]);

  // ─── Application packets (declared before `opps` which reads them) ───
  const defaultPacket = (oppId) => ({
    status: 'none',          // none | building | review | changes | approved | sent
    round: 1,
    jdAnalyzed: false,
    coveredKw: [],           // keywords currently worked into the resume
    templates: { resume: 0, cover: 0, portfolio: 0, video: 0 }, // selected template index (0 = default)
    artifacts: {             // todo | drafting | review | changes | approved
      resume: 'todo', cover: 'todo', portfolio: 'todo', video: 'todo',
    },
    feedback: [],            // { round, from, note, kind }
  });
  const [packets, setPackets] = React.useState({});
  const [dismissed, setDismissed] = React.useState({});

  // Derived: opportunities for this persona, with their current stage
  const opps = React.useMemo(() => {
    return ALL_OPPS
      .filter(o => o.rolesFor.includes(persona))
      .map(o => ({ ...o, stage: stageMap[o.id] || null, packet: (packets[o.id] || defaultPacket(o.id)).status }))
      .filter(o => o.stage !== null && !dismissed[o.id]); // only show staged, non-dismissed opps
  }, [persona, stageMap, packets, dismissed]);

  // Helpers
  const moveStage = React.useCallback((oppId, newStage) => {
    setStageMap(prev => ({ ...prev, [oppId]: newStage }));
  }, []);

  const getPacket = React.useCallback((oppId) => packets[oppId] || defaultPacket(oppId), [packets]);
  const updatePacket = React.useCallback((oppId, patch) => {
    setPackets(prev => {
      const base = prev[oppId] || defaultPacket(oppId);
      const next = typeof patch === 'function' ? patch(base) : { ...base, ...patch };
      return { ...prev, [oppId]: next };
    });
  }, []);

  // Dismiss an opp from the pipeline (soft-remove)
  const dismiss = React.useCallback((oppId) => setDismissed(p => ({ ...p, [oppId]: true })), []);

  // Toasts for action feedback
  const [toasts, setToasts] = React.useState([]);
  const toast = React.useCallback((msg, color = 'ink') => {
    const id = Math.random();
    setToasts(t => [...t, { id, msg, color }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2200);
  }, []);

  const value = {
    persona, setPersona,
    demoState, setDemoState,
    density, setDensity,
    dark, setDark,
    accent, setAccent,
    features, setFeatures,
    view, setView,
    opps, stageMap, moveStage,
    packets, getPacket, updatePacket,
    dismiss, dismissed,
    toast, toasts,
    personaInfo: PERSONAS[persona],
    demoInfo: DEMO_STATES[demoState],
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

function useApp() {
  const v = React.useContext(AppCtx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/* ─────── Toast UI ─────── */
function ToastTray() {
  const { toasts } = useApp();
  return (
    <div style={{ position:'fixed', bottom:24, left:'50%', transform:'translateX(-50%)', zIndex:9999, display:'flex', flexDirection:'column', gap:6, pointerEvents:'none' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: 'var(--text-primary)', color:'var(--surface-background-primary)', padding:'9px 15px',
          fontFamily:"'Inter', system-ui, sans-serif", borderRadius:'8px',
          fontSize:13, fontWeight:600, animation:'toast-in 200ms ease-out',
          boxShadow:'0 8px 24px rgba(15,23,42,.28)',
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { useRoute, go, AppCtx, AppProvider, useApp, ToastTray });
