// Top-level App: router + view selector (desktop / mobile).

function App() {
  const { view } = useApp();
  const route = useRoute();
  const parts = route.parts;
  const top = parts[0] || '';

  // Build the desktop screen for the given route
  const desktop = (() => {
    switch (top) {
      case '':           return <TodayScreen />;
      case 'opps':       return <OppsListScreen />;
      case 'opp':        return <CommandCenterScreen />;
      case 'pipeline':   return <PipelineScreen />;
      case 'packet':     return parts[1] ? <PacketBuilderScreen /> : <PacketListScreen />;
      case 'compose':    return <OutreachComposerScreen />;
      case 'answers':    return <AppAnswersScreen />;
      case 'outreach':   return parts[1] ? <OutreachDraftScreen /> : <OutreachScreen />;
      case 'assets':     return <AssetsScreen />;
      case 'roles':      return <RolesScreen />;
      case 'playbooks':  return <PlaybooksScreen />;
      case 'interview':  {
        const sub = parts[2];
        if (sub === 'prep')    return <InterviewPrepScreen />;
        if (sub === 'record')  return <InterviewRecordScreen />;
        if (sub === 'debrief') return <InterviewDebriefScreen />;
        return <InterviewListScreen />;
      }
      case 'offer':      return <OfferScreen />;
      case 'intake':     return <IntakeScreen />;
      case 'settings':   return <SettingsScreen />;
      case 'flows':      return <FlowsOverview />;
      default:           return <TodayScreen />;
    }
  })();

  // Mobile counterpart
  const mobile = (() => {
    switch (top) {
      case '':         return <MTodayScreen />;
      case 'swipe':    return <MSwipeScreen />;
      case 'pipeline': return <MPipelineScreen />;
      case 'outreach': return <MOutreachScreen />;
      case 'interview':return <MInterviewScreen />;
      case 'opp':      return <MOppDetailScreen />;
      case 'opps':     return <MPipelineScreen />;
      case 'packet':   return <MPacketScreen />;
      case 'compose':  return <MComposeScreen />;
      case 'answers':  return <MComposeScreen />;
      default:         return <MTodayScreen />;
    }
  })();

  return (
    <>
      {view === 'desktop' ? desktop : mobile}
      <ProtoTweaks />
      <ToastTray />
    </>
  );
}

/* ─────────── Flows overview — used by the design canvas wrapper ─────────── */
function FlowsOverview() {
  const flows = [
    { t:'Daily journey',   d:'Morning briefing → swipe → pipeline lands', p:'/' },
    { t:'Discover & save', d:'Swipe queue with real gesture',             p:'/swipe' },
    { t:'Application packet',d:'JD/ATS keywords → resume, portfolio, video → approval rounds', p:'/packet' },
    { t:'Outreach composer',d:'Cold email · LinkedIn · InMail · call script', p:'/compose' },
    { t:'Application answers',d:'Screenshot a form → copy-paste blocks',     p:'/answers' },
    { t:'Outreach cadence',d:'Queue · draft · send · analytics',          p:'/outreach' },
    { t:'Command center',  d:'Per-opp tabs · stakeholders · status',      p:'/opp/1' },
    { t:'Interview',       d:'Prep · record · debrief',                   p:'/interview/7/prep' },
    { t:'Offer',           d:'Negotiation tracker',                       p:'/offer/20' },
    { t:'Intake / setup',  d:'OAuth · filters · feed log',                p:'/intake' },
  ];
  return (
    <DesktopShell title="Flows overview">
      <div style={{ padding:24, display:'flex', flexDirection:'column', gap:16 }}>
        <div className="px-h1" style={{ fontSize:22 }}>Flows overview</div>
        <div className="px-meta">Jump into any flow. Tweaks change persona, demo state, dark mode, and feature flags.</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:14 }}>
          {flows.map(f => (
            <div key={f.t} className="px-box" style={{ padding:14, cursor:'pointer' }} onClick={() => go(f.p)}>
              <div className="px-h3">{f.t}</div>
              <div className="px-meta" style={{ marginTop:4 }}>{f.d}</div>
              <div className="px-link" style={{ marginTop:8, fontSize:12 }}>Enter →</div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

// Mount immediately — Babel runs after DOMContentLoaded has already fired
{
  const initial = window.__PROTO_INITIAL__ || {};
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(
    <AppProvider initial={initial}>
      <App />
    </AppProvider>
  );
}

window.App = App;
