// Packet builder from app/src/screens/PacketBuilder.jsx, with the QC layer and
// the assistant added. <New> marks anything the app does not have today.

const TYPE_SUB = {
  resume: 'Keyword-tailored from your master resume',
  compact_resume: 'One-page version that fits without overflow',
  cover: 'Specific to company & role',
  portfolio: '3 case studies mapped to pain points',
  video: '90-second tailored open — Script + record',
};
const STATUS_TONE = { todo: 'panel', drafting: 'yellow', review: 'accent', changes: 'red', approved: 'green' };

function StepCircle({ num, done, active, tone }) {
  const bg = tone || (done ? 'var(--proto-green)' : active ? 'var(--surface-brand-default)' : 'var(--proto-panel-deep)');
  const color = done || active || tone ? '#fff' : 'var(--proto-ink2)';
  return (
    <div style={{ width: 28, height: 28, borderRadius: '50%', background: bg, color, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700 }}>
      {done && !tone ? '✓' : num}
    </div>
  );
}

// Layout switch for the extracted-rows block: 'tabs' or 'columns'.
// Flip this one constant back to 'columns' to restore the three-column version.
const PARSED_LAYOUT = 'tabs';

function ParsedBlocks({ onOpenQC, onPick }) {
  const lib = libTerms(), model = modelTerms();
  const three = useWide(1040);
  const resp = REQUIREMENTS.filter(r => r.kind === 'responsibility');
  const must = REQUIREMENTS.filter(r => r.kind === 'must_have');
  const nice = REQUIREMENTS.filter(r => r.kind === 'nice_to_have');
  const Row = ({ r }) => {
    const [open, setOpen] = React.useState(false);
    const ev = r.evidence;
    return (
      <div style={{ padding: '11px 0', borderTop: '1px solid var(--proto-rule-soft)' }}>
        <div onClick={() => ev ? setOpen(o => !o) : (onPick && onPick(r.id))} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: COV_COLOR[r.coverage] }} />
          <span style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(150px, 210px)', gap: 14, alignItems: 'baseline' }}>
            <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{r.verbatim}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexDirection: 'column' }}>
              <ReqChip id={r.id} quiet />
              {ev
                ? <span className="px-link" style={{ fontSize: 11.5 }}>{open ? 'hide evidence' : 'evidenced — show the line'}</span>
                : <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--proto-red)' }}>no evidence found</span>}
            </span>
          </span>
        </div>
        {open && ev && (
          <div style={{ margin: '8px 0 2px 15px', padding: '9px 11px', borderRadius: 7, background: 'var(--proto-panel)', borderLeft: '2px solid var(--proto-green)' }}>
            <div style={{ fontSize: 11.5, lineHeight: 1.55, fontStyle: 'italic' }}>“{ev.quote}”</div>
            <div className="px-small" style={{ textTransform: 'none', marginTop: 4, fontWeight: 700 }}>{ev.source}</div>
            {ev.extra && <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>{ev.extra}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <span className="px-link" style={{ fontSize: 11 }} onClick={() => onPick && onPick(r.id)}>Where it is used →</span>
            </div>
          </div>
        )}
      </div>
    );
  };
  const Sub = ({ l, rows }) => {
    const c = rows.filter(r => r.coverage === 'covered').length;
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16, marginBottom: 2 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.3px', textTransform: 'uppercase', color: 'var(--proto-ink)' }}>{l}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: c === rows.length ? 'var(--proto-green)' : 'var(--proto-red)' }}>{c}/{rows.length} evidenced</span>
      </div>
    );
  };
  const Head = ({ l, rows }) => {
    const c = rows.filter(r => r.coverage === 'covered').length;
    return (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 4, borderBottom: '2px solid var(--proto-rule)' }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{l}</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: c === rows.length ? 'var(--proto-green)' : 'var(--proto-red)' }}>{c}/{rows.length}</span>
      </div>
    );
  };
  const kwCol = (
    <div>
      <div className="px-small" style={{ textTransform: 'none', margin: '6px 0 8px' }}>Matched against the {TERM_LIB.id} library. Green is placed in an asset, red has no evidence to place.</div>
      <div style={{ display: 'grid', gridTemplateColumns: three ? 'repeat(2, minmax(0,1fr))' : '1fr', columnGap: 22 }}>
        {lib.map(t => (
          <div key={t.id} onClick={() => onPick && onPick(t.reqs[0])} title={`answers ${t.reqs.join(', ')}`}
            style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '11px 0', borderTop: '1px solid var(--proto-rule-soft)', cursor: 'pointer' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 6, flexShrink: 0, background: t.status === 'open' ? 'var(--proto-red)' : 'var(--proto-green)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: t.status === 'open' ? 'var(--proto-red-soft)' : 'var(--proto-green-soft)', color: 'var(--proto-ink)' }}>{t.term}</span>
                <span style={{ fontSize: 11.5, fontWeight: 600, color: t.status === 'open' ? 'var(--proto-red)' : 'var(--proto-green)' }}>{t.status === 'open' ? 'nothing to place it on' : 'placed'}</span>
              </span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, display: 'block', marginTop: 5 }}>“{t.postingSays}”</span>
              <span className="px-small" style={{ display: 'block', textTransform: 'none', marginTop: 2 }}>answers {t.reqs.join(', ')} · appears {t.freq}× in the ad</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, marginTop: 8 }}>{lib.filter(t => t.status !== 'open').length} of {lib.length} placed</div>
      <div className="px-small" style={{ marginTop: 8, textTransform: 'none' }}>{TERM_LIB.size.toLocaleString()} terms in the library · {TERM_LIB.sources.join(', ')}</div>
      <div className="px-small" style={{ marginTop: 6, textTransform: 'none' }}>{model.length} model suggestions with no library entry, so they earn no score credit: {model.map(t => t.term).join(', ')}</div>
    </div>
  );
  const cov = (rows) => rows.filter(r => r.coverage === 'covered').length;
  const TABS = [
    { k: 'resp', l: 'Responsibilities', n: cov(resp), d: resp.length },
    { k: 'req', l: 'Requirements', n: cov([...must, ...nice]), d: must.length + nice.length },
    { k: 'kw', l: 'ATS keywords', n: lib.filter(t => t.status !== 'open').length, d: lib.length },
  ];
  const [tab, setTab] = React.useState('resp');
  const body = PARSED_LAYOUT === 'tabs' ? (
    <>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto' }}>
        {TABS.map(t => (
          <div key={t.k} onClick={() => setTab(t.k)} className={'px-tab ' + (tab === t.k ? 'px-tab-active' : 'px-tab-idle')} style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
            {t.l}
            <span style={{ fontSize: 11, fontWeight: 700, color: t.n === t.d ? 'var(--proto-green)' : 'var(--proto-red)' }}>{t.n}/{t.d}</span>
          </div>
        ))}
      </div>
      {tab === 'resp' && resp.map(r => <Row key={r.id} r={r} />)}
      {tab === 'req' && (
        <>
          <Sub l="Must have" rows={must} />
          {must.map(r => <Row key={r.id} r={r} />)}
          <Sub l="Nice to have" rows={nice} />
          {nice.map(r => <Row key={r.id} r={r} />)}
        </>
      )}
      {tab === 'kw' && kwCol}
    </>
  ) : (
    <div style={{ display: 'grid', gridTemplateColumns: three ? 'repeat(3, minmax(0,1fr))' : '1fr', gap: 24 }}>
      <div>
        <Head l="Responsibilities" rows={resp} />
        {resp.map(r => <Row key={r.id} r={r} />)}
      </div>
      <div>
        <Head l="Requirements" rows={[...must, ...nice]} />
        <Sub l="Must have" rows={must} />
        {must.map(r => <Row key={r.id} r={r} />)}
        <Sub l="Nice to have" rows={nice} />
        {nice.map(r => <Row key={r.id} r={r} />)}
      </div>
      <div>
        <Head l="ATS keywords" rows={[]} />
        {kwCol}
      </div>
    </div>
  );
  return (
    <div className="px-box" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Extracted from this posting</span>
        <div style={{ flex: 1 }} />
        <span className="px-link" style={{ fontSize: 12 }} onClick={onOpenQC}>See where each one is answered →</span>
      </div>
      <div className="px-small" style={{ textTransform: 'none', marginBottom: 12 }}>Every line the parse pulled out of the ad, verbatim, with the profile line that evidences it. Click any row to read the excerpt it was matched against. These ids are what the assets refer to later.</div>
      {body}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--proto-rule-soft)' }}><ReqLegend /></div>
    </div>
  );
}

// The comparison the step is named after: ad on the left, profile on the right.
function ProfileCompare({ onOpenQC }) {
  const rows = matchRows();
  const wide = useWide(900);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {rows.map(r => (
          <div key={r.k} className="px-box" style={{ padding: 11 }}>
            <div className="px-label">{r.l}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 3 }}>
              <b style={{ fontSize: 22, lineHeight: 1, color: FIT_COLOR[r.fit] }}>{r.n}</b>
              <span style={{ fontSize: 13, color: 'var(--proto-ink3)' }}>of {r.d}</span>
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 700, marginTop: 4, color: FIT_COLOR[r.fit] }}>{FIT_LABEL[r.fit]}</div>
            <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>
              {r.missing.length ? `Missing: ${r.missing.map(m => m.competency || m.term).join(', ')}` : r.sub}
            </div>
          </div>
        ))}
      </div>

      <div className="px-box" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: wide ? '150px minmax(0,1fr) minmax(0,1fr) 116px' : '1fr', gap: 10, padding: '9px 14px', background: 'var(--proto-panel)', borderBottom: '1px solid var(--proto-rule-soft)' }}>
          <span className="px-label">Dimension</span>
          {wide && <><span className="px-label">The posting asks for</span><span className="px-label">Your profile evidences</span><span className="px-label" style={{ textAlign: 'right' }}>Fit</span></>}
        </div>
        {PROFILE_COMPARE.map(c => (
          <div key={c.l} style={{ display: 'grid', gridTemplateColumns: wide ? '150px minmax(0,1fr) minmax(0,1fr) 116px' : '1fr', gap: 10, padding: '10px 14px', borderBottom: '1px solid var(--proto-rule-soft)', alignItems: 'baseline' }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{c.l}</span>
            <span style={{ fontSize: 12, color: 'var(--proto-ink2)' }}>{c.posting}</span>
            <span style={{ fontSize: 12 }}>{c.yours}{c.note && <span className="px-small" style={{ display: 'block', textTransform: 'none' }}>{c.note}</span>}</span>
            <span style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: wide ? 'flex-end' : 'flex-start' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: FIT_COLOR[c.fit] }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: FIT_COLOR[c.fit] }}>{FIT_LABEL[c.fit]}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="px-small" style={{ textTransform: 'none', flex: 1 }}>Fit is graded against your stored profile only — nothing here has been written into an asset yet.</span>
        <button className="px-btn" style={{ fontSize: 12 }} onClick={onOpenQC}>See how the assets answer these →</button>
      </div>
    </div>
  );
}

function ArtifactCard({ a, onOpenQC, onAsk }) {
  const { mode } = useMode();
  const additive = mode === 'additive';
  const g = gateFor(a.type);
  const blocked = additive && g === 'fail';
  return (
    <div className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{TYPE_LABEL_QC[a.type]}</div>
          <div style={{ fontSize: 12, color: 'var(--proto-ink2)', marginTop: 3 }}>{TYPE_SUB[a.type]}</div>
        </div>
        {g && <New inline label="QC"><GateBadge type={a.type} onClick={() => onOpenQC(a.type)} /></New>}
        <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
      </div>

      {a.status === 'todo' && (
        <div className="px-small" style={{ color: 'var(--proto-yellow)', textTransform: 'none' }}>
          App bug: the <code>todo</code> pill uses an undefined <code>--proto-panel-soft</code> and takes its text color from a near-white surface token, so it renders white-on-white live. Legible here.
        </div>
      )}

      {a.docUrl && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="px-btn" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{a.docUrl.includes('/presentation/') ? 'Open Slides ↗' : 'Open Google Doc ↗'}</button>
          <button className="px-btn" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Copy tracked link</button>
        </div>
      )}

      {ASSET_DOCS[a.type] && (additive
        ? <New label="fields, keywords, provenance"><AssetDocView type={a.type} onAsk={onAsk} /></New>
        : <div className="px-box" style={{ padding: 10, fontSize: 12, lineHeight: 1.6, background: 'var(--proto-panel)' }}>
            <span className="px-link">▸ View draft</span>
            <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-yellow)', textTransform: 'none' }}>Today the draft is one collapsed string — no fields, no keywords, no reasons.</div>
          </div>)}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {a.status === 'todo' && <button className="px-btn px-btn-accent">{a.type === 'video' ? 'Generate script' : 'Generate draft'}</button>}
        {(a.status === 'review' || a.status === 'changes') && (
          <>
            <button className="px-btn px-btn-green" disabled={blocked}>Approve</button>
            <button className="px-btn">Regenerate</button>
            {additive && <button className="px-btn" onClick={() => onAsk(`In the ${TYPE_LABEL_QC[a.type].toLowerCase()}: `)}>Ask for a change</button>}
          </>
        )}
        {a.status === 'approved' && <button className="px-btn">Reopen</button>}
        {blocked && (() => {
          const list = attentionFor(a.type).filter(x => x.sev === 'fail');
          const it = list[0] || attentionFor(a.type)[0];
          return (
            <New inline label="gate">
              <button className="px-btn" style={{ fontSize: 11.5, color: 'var(--proto-red)', fontWeight: 700 }} onClick={() => onOpenQC(a.type, it && it.sec)}>
                {list.length} to fix — {it ? it.title : 'open QC'} →
              </button>
            </New>
          );
        })()}
      </div>
    </div>
  );
}

function PacketBuilderScreen({ onAsk, assistOpen, setAssistOpen, seed, setSeed }) {
  const { mode } = useMode();
  const additive = mode === 'additive';
  const wide = useWide(1200);
  const canDock = useWide(1440);
  const [activeStep, setActiveStep] = React.useState('jd');
  const [drawer, setDrawer] = React.useState(null);
  const [jdBusy, setJdBusy] = React.useState(false);
  const [jdRun, setJdRun] = React.useState(true);
  const [panelOpen, setPanelOpen] = React.useState(false);
  const atsModal = () => !panelOpen ? null : (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px' }}>
      <div onClick={() => setPanelOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.34)', backdropFilter: 'blur(2px)' }} />
      <div className="px-fade" style={{ position: 'relative', width: 'min(420px, 96vw)', maxHeight: '84vh', overflow: 'auto', background: 'var(--proto-paper)', borderRadius: 14, border: '1px solid var(--proto-rule-soft)', boxShadow: '0 24px 60px rgba(15,23,42,.30)', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>ATS analysis</div>
            <div className="px-small">{PACKET.company} · {PACKET.role}</div>
          </div>
          <span onClick={() => setPanelOpen(false)} className="px-btn" style={{ padding: '2px 8px', cursor: 'pointer' }}>✕</span>
        </div>
        {sidePanel}
      </div>
    </div>
  );
  const p = PACKET, artifacts = ARTIFACTS;
  const lib = libTerms();
  const placed = lib.filter(t => t.status !== 'open');
  const openTerms = lib.filter(t => t.status === 'open');
  const atsScore = Math.round(placed.length / lib.length * 100);
  const runJd = () => { setJdBusy(true); setTimeout(() => { setJdBusy(false); setJdRun(true); }, 1100); };

  const STEPS = [
    { key: 'jd', label: 'JD analysis', sub: 'Extract keywords & ATS terms', done: jdRun },
    { key: 'resume', label: 'Resume', sub: 'Keyword-tailored from master', done: false },
    { key: 'cover', label: 'Cover letter', sub: 'Tailored narrative', done: true },
    { key: 'portfolio', label: 'Portfolio', sub: 'Assemble work samples', done: false },
    { key: 'video', label: 'Intro video', sub: 'Script + record 60s', done: false },
    ...(additive ? [{ key: 'qc', label: 'QC & evidence', sub: 'Before approval', done: false, isNew: true }] : []),
    { key: 'send', label: 'Review & send', sub: 'Approval rounds', done: false },
  ];
  const byStep = (k) => k === 'resume' ? artifacts.filter(a => a.type === 'resume' || a.type === 'compact_resume') : artifacts.filter(a => a.type === k);
  const nextOf = (k) => STEPS[STEPS.findIndex(s => s.key === k) + 1];
  React.useEffect(() => { if (!additive && activeStep === 'qc') setActiveStep('send'); }, [additive, activeStep]);

  const sidePanel = (
    <>
      <div className="px-box" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--proto-ink2)' }}>Keywords &amp; ATS terms</div>
          <div style={{ fontSize: 20, fontWeight: 800, color: atsScore >= 80 ? 'var(--proto-green)' : 'var(--proto-accent)' }}>{atsScore}%</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {placed.map(t => <span key={t.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--proto-green-soft)', color: 'var(--proto-green)', fontWeight: 600 }}>{t.term}</span>)}
          {openTerms.map(t => <span key={t.id} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 99, background: 'var(--proto-red-soft)', color: 'var(--proto-red)', fontWeight: 600 }}>{t.term}</span>)}
        </div>
        <div className="px-small">{placed.length}/{lib.length} placed</div>
        {!additive && <div className="px-small" style={{ color: 'var(--proto-yellow)', textTransform: 'none' }}>App bug: gap chips read <code>missingKw</code>, which the API never returns, so this list is always empty live.</div>}
        <button className="px-btn px-btn-accent" style={{ width: '100%' }}>Auto-optimize resume</button>
      </div>

      {additive && (
        <New label="QC Summary" style={{ marginTop: 12 }}>
          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--proto-ink2)', marginBottom: 10 }}>QC Summary</div>
            <ScoreBlock type="resume" compact />
            <div className="px-divider" style={{ margin: '12px 0' }} />
            {['resume', 'compact_resume', 'cover', 'portfolio'].map(t => (
              <div key={t} onClick={() => { setPanelOpen(false); setDrawer({ type: t }); }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer', borderTop: '1px solid var(--proto-rule-soft)' }}>
                <span style={{ fontSize: 12, flex: 1 }}>{TYPE_LABEL_QC[t]}</span>
                <GateBadge type={t} small onClick={() => { setPanelOpen(false); setDrawer({ type: t }); }} />
              </div>
            ))}
            <button className="px-btn" style={{ width: '100%', fontSize: 12, marginTop: 10 }} onClick={() => { setPanelOpen(false); setActiveStep('qc'); }}>Open QC →</button>
          </div>
        </New>
      )}
    </>
  );

  const stepContent = (
    <>
      {activeStep === 'jd' && (
        <>
          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Extracted from triggering email</div>
              <Pill tone="accent">from email</Pill>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: '8px 0', fontSize: 13 }}>
              {[['Source', 'LinkedIn'], ['Role', 'Head of Engineering'], ['Comp', '$300–360k + eq'], ['Location', 'Austin, TX · hybrid'], ['Hiring manager', 'Kylie Brandt']].map(([k, v]) => (
                <React.Fragment key={k}>
                  <div style={{ color: 'var(--proto-ink2)', fontWeight: 500 }}>{k}</div>
                  <div style={{ fontWeight: 500 }}>{v}</div>
                </React.Fragment>
              ))}
            </div>
          </div>

          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Job description <span className="px-small" style={{ marginLeft: 8, fontWeight: 400 }}>parsed</span></div>
              <button className="px-btn" style={{ fontSize: 12 }}>Re-parse JD</button>
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.7 }}>
              SafetyIQ is hiring a Head of Engineering to own its safety-critical platform through the next phase of scale: modernization across three business units, SOC 2 Type II and ISO 27001 ownership, a distributed organization of 60+, and an $18M engineering P&amp;L.
            </div>
          </div>

            {additive
              ? <New label="parsed into rows"><ParsedBlocks onOpenQC={() => setActiveStep('qc')} /></New>
            : <div className="px-box" style={{ padding: 16 }}>
                <div className="px-label">Requirements</div>
                <div className="px-small" style={{ marginTop: 6, textTransform: 'none', color: 'var(--proto-yellow)' }}>
                  Empty today. The parse writes <code>jd_requirements</code> and <code>jd_table</code> as HTML and this screen never reads them.
                </div>
              </div>}

          <div className="px-box" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Posting vs your profile</div>
                <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>Side by side: what the ad asks for, and what your <span className="px-link">master profile</span> can evidence today.</div>
              </div>
              <button className="px-btn px-btn-accent" disabled={jdBusy} onClick={runJd}>{jdBusy ? 'Running…' : jdRun ? 'Run again' : 'Run comparison'}</button>
              <button className="px-btn" style={{ fontSize: 12 }}>Build entire packet</button>
            </div>
            {additive && jdRun && !jdBusy && (
              <New label="comparison" style={{ marginTop: 14 }}>
                <ProfileCompare onOpenQC={() => setActiveStep('qc')} />
              </New>
            )}
            {jdBusy && <div className="px-small" style={{ marginTop: 10 }}>Matching keywords, comparing your profile…</div>}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="px-btn px-btn-accent" onClick={() => setActiveStep('resume')}>Next: Resume →</button>
          </div>
        </>
      )}

      {['resume', 'cover', 'portfolio', 'video'].includes(activeStep) && (
        <>
          {byStep(activeStep).map(a => <ArtifactCard key={a.id} a={a} onOpenQC={(t, sec) => setDrawer({ type: t, sec })} onAsk={onAsk} />)}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="px-btn px-btn-accent" onClick={() => setActiveStep(nextOf(activeStep).key)}>Next: {nextOf(activeStep).label} →</button>
          </div>
        </>
      )}

      {activeStep === 'qc' && <QCStep onOpenAsset={(t, sec) => setDrawer({ type: t, sec })} onAsk={onAsk} />}

      {activeStep === 'send' && (
        <div className="px-box" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Review &amp; send</div>
          <div>
            {artifacts.map(a => (
              <div key={a.type} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                <div style={{ flex: 1, fontSize: 13 }}>{TYPE_LABEL_QC[a.type]}</div>
                {gateFor(a.type) && <New inline label="gate"><GateBadge type={a.type} small onClick={() => setDrawer({ type: a.type })} /></New>}
                <Pill tone={STATUS_TONE[a.status]}>{a.status}</Pill>
              </div>
            ))}
          </div>
          {additive
            ? <New label="gate">
                {(() => {
                  const fails = ATTENTION.filter(a => a.sev === 'fail');
                  if (!fails.length) return (
                    <div className="px-box" style={{ padding: 12, background: 'var(--proto-green-soft)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--proto-green)' }}>Nothing blocks sending</div>
                    </div>
                  );
                  const byAsset = [...new Set(fails.map(f => f.asset))];
                  return (
                    <div className="px-box" style={{ padding: 12, background: 'var(--proto-red-soft)' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--proto-red)' }}>
                        {fails.length} item{fails.length === 1 ? '' : 's'} to fix across {byAsset.length} asset{byAsset.length === 1 ? '' : 's'}
                      </div>
                      <div className="px-small" style={{ marginTop: 4, textTransform: 'none' }}>Sending stays locked until each one is fixed or the decision is recorded.</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 9 }}>
                        {fails.map(f => (
                          <div key={f.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', flexWrap: 'wrap', padding: '7px 9px', borderRadius: 7, background: 'var(--proto-paper)' }}>
                            <span className="px-small" style={{ fontWeight: 700, minWidth: 88 }}>{TYPE_LABEL_QC[f.asset]}</span>
                            <span style={{ flex: 1, minWidth: 180 }}>
                              <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>{f.title}</span>
                              <span className="px-small" style={{ textTransform: 'none' }}>{f.detail}</span>
                            </span>
                            <button className="px-btn" style={{ fontSize: 11 }} onClick={() => setDrawer({ type: f.asset, sec: f.sec })}>{f.sec ? 'Open field →' : 'Open asset →'}</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
              </New>
            : <div className="px-small">Approve all artifacts above to unlock sending.</div>}
        </div>
      )}
    </>
  );

  const railItems = STEPS.map((step, i) => {
    const active = activeStep === step.key;
    const item = (
      <div onClick={() => setActiveStep(step.key)}
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', background: active ? 'var(--proto-accent-soft)' : 'transparent', border: active ? '1px solid var(--surface-brand-default)' : '1px solid transparent' }}>
        <StepCircle num={i + 1} done={step.done} active={active} tone={step.isNew ? GATE_COLOR[PACKET_GATE] : null} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--text-brand)' : 'var(--proto-ink)' }}>{step.label}</div>
          <div className="px-small" style={{ marginTop: 1, fontSize: 11 }}>{step.sub}</div>
        </div>
      </div>
    );
    return step.isNew ? <New key={step.key} label="new step">{item}</New> : <React.Fragment key={step.key}>{item}</React.Fragment>;
  });

  const railChips = STEPS.map((step, i) => {
    const active = activeStep === step.key;
    const chip = (
      <div onClick={() => setActiveStep(step.key)}
        style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', borderRadius: 99, cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 500, background: active ? 'var(--surface-brand-default)' : step.done ? 'var(--proto-green-soft)' : 'var(--proto-panel)', color: active ? '#fff' : step.done ? 'var(--proto-green)' : 'var(--proto-ink2)', border: active ? 'none' : '1px solid var(--proto-rule-soft)' }}>
        <span>{step.done ? '✓' : i + 1}</span><span>{step.label}</span>
      </div>
    );
    return step.isNew ? <New inline key={step.key} label="new">{chip}</New> : <React.Fragment key={step.key}>{chip}</React.Fragment>;
  });

  return (
    <DesktopShell title="Packet builder">
      <div style={{ marginBottom: 16 }}>
        <div className="px-small px-link" style={{ marginBottom: 8 }}>← Packets</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Packet — {p.company}</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2 }}>{p.company} · {p.role}</div>
            <div className="px-small" style={{ marginTop: 2 }}>ATS keyword optimization + tailored assets</div>
          </div>
          <div onClick={() => setPanelOpen(true)} title="Open ATS analysis" style={{ textAlign: 'right', cursor: 'pointer' }}>
            <div className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)', marginBottom: 2 }}>ATS Match</div>
            <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, color: 'var(--proto-green)' }}>{atsScore}%</div>
            <div className="px-link" style={{ fontSize: 11 }}>Keywords &amp; ATS terms →</div>
          </div>
          <New label="auditable">
            <span onClick={() => setActiveStep('qc')} style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', cursor: 'pointer', paddingLeft: 14, borderLeft: '1px solid var(--proto-rule-soft)' }}>
              <span className="px-small" style={{ textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-brand)' }}>Match</span>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 32, fontWeight: 800, lineHeight: 1 }}>{PACKET_SCORE}</span>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: GATE_SOFT[PACKET_GATE], color: GATE_COLOR[PACKET_GATE], textTransform: 'uppercase' }}>{PACKET_GATE}</span>
              </span>
            </span>
          </New>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {wide && <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>{railItems}</div>}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!wide && (
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 0 4px' }}>{railChips}</div>
          )}
          {stepContent}
        </div>
        {canDock && additive && (
          <div style={{ width: assistOpen ? 340 : 280, flexShrink: 0, position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
            <Assist docked open={assistOpen} setOpen={setAssistOpen} seed={seed} setSeed={setSeed} />
          </div>
        )}
      </div>

      {additive && !canDock && <Assist open={assistOpen} setOpen={setAssistOpen} seed={seed} setSeed={setSeed} />}
      {atsModal()}

      {drawer && <QCDrawer type={drawer.type} sec={drawer.sec} onClose={() => setDrawer(null)} onAsk={onAsk} />}
    </DesktopShell>
  );
}

function App() {
  const [mode, setMode] = React.useState(() => localStorage.getItem('qc-proto-mode') || 'additive');
  const [hl, setHl] = React.useState(() => localStorage.getItem('qc-proto-hl') !== '0');
  const [assistOpen, setAssistOpen] = React.useState(false);
  const [seed, setSeed] = React.useState('');
  React.useEffect(() => {
    document.body.dataset.mode = mode; document.body.dataset.hl = mode === 'additive' && hl ? 'on' : 'off';
    localStorage.setItem('qc-proto-mode', mode); localStorage.setItem('qc-proto-hl', hl ? '1' : '0');
  }, [mode, hl]);
  const onAsk = (t) => { setSeed(t || ' '); setAssistOpen(true); };
  return (
    <ModeCtx.Provider value={{ mode, hl }}>
      <PacketBuilderScreen onAsk={onAsk} assistOpen={assistOpen} setAssistOpen={setAssistOpen} seed={seed} setSeed={setSeed} />
      <ProtoControls mode={mode} setMode={setMode} hl={hl} setHl={setHl} offset={0} />
    </ModeCtx.Provider>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
