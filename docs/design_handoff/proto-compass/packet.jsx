// Application Packet builder — the core "approve → build → review → ready to send" workflow.
// JD keyword / ATS optimization + tailored resume, portfolio, video intro, approval rounds.

/* ─────────────── Packet list (when no opp chosen) ─────────────── */
function PacketListScreen() {
  const { opps, getPacket } = useApp();
  // opps that are candidates for a packet: saved / maybe / applied stages
  const candidates = opps.filter(o => ['saved','enriched','applied','outreach','engaged'].includes(o.stage));
  const inFlight   = opps.filter(o => getPacket(o.id).status !== 'none');

  const statusColor = (s) => ({ building: PROTO.yellow, review:'var(--proto-accent)', changes: PROTO.orange, approved: PROTO.green, sent: PROTO.green }[s] || 'var(--proto-ink3)');

  return (
    <DesktopShell title="Application packets" active="packet">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:16 }}>
        <div>
          <div className="px-h1" style={{ fontSize:20 }}>Application packets</div>
          <div className="px-meta">Each approved opportunity gets a tailored packet — keyword-optimized resume, portfolio, and intro video, built through approval rounds until it's ready to send.</div>
        </div>

        {inFlight.length > 0 && (
          <div>
            <SectionTitle sub="in progress">Building now</SectionTitle>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
              {inFlight.map(o => {
                const p = getPacket(o.id);
                const done = Object.values(p.artifacts).filter(a => a === 'approved').length;
                return (
                  <div key={o.id} className="px-box" style={{ padding:14, cursor:'pointer' }} onClick={() => go(`/packet/${o.id}`)}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div className="px-logo">{o.logo}</div>
                      <div style={{ flex:1 }}>
                        <div className="px-h3">{o.company}</div>
                        <div className="px-small">{o.role}</div>
                      </div>
                      <Pill color={statusColor(p.status)}>{p.status}</Pill>
                    </div>
                    <div style={{ marginTop:10 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:3 }}><span>Artifacts approved</span><b>{done}/4</b></div>
                      <Bar value={done/4*100} color={PROTO.green} />
                    </div>
                    <div className="px-small" style={{ marginTop:6 }}>Round {p.round} · {p.jdAnalyzed ? 'JD analyzed' : 'JD not analyzed'}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <SectionTitle sub="approved from swipe / saved — start a packet">Ready to start</SectionTitle>
          <div className="px-box">
            <div style={{ display:'grid', gridTemplateColumns:'50px 1fr 1.2fr 100px 120px 130px', padding:'6px 12px', background:'var(--proto-panel)', borderBottom:'2px solid var(--proto-ink)', fontSize:11, fontWeight:700, textTransform:'uppercase', color:'var(--proto-ink2)' }}>
              <div></div><div>Company</div><div>Role</div><div>Match</div><div>Packet</div><div>Action</div>
            </div>
            {candidates.map((o, i) => {
              const p = getPacket(o.id);
              return (
                <div key={o.id} style={{ display:'grid', gridTemplateColumns:'50px 1fr 1.2fr 100px 120px 130px', padding:'10px 12px', borderBottom: i < candidates.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', alignItems:'center', fontSize:13 }}>
                  <div className="px-logo" style={{ width:30, height:30 }}>{o.logo}</div>
                  <div style={{ fontWeight:700 }}>{o.company}</div>
                  <div className="px-meta">{o.role}</div>
                  <div><MatchScore n={o.match} size={26} /></div>
                  <div>{p.status === 'none' ? <span className="px-small">not started</span> : <Pill color={statusColor(p.status)}>{p.status}</Pill>}</div>
                  <div><div className="px-btn px-btn-dark" style={{ fontSize:11 }} onClick={() => go(`/packet/${o.id}`)}>{p.status === 'none' ? 'Build packet' : 'Open'}</div></div>
                </div>
              );
            })}
            {candidates.length === 0 && <div className="px-dashed" style={{ margin:14, padding:24, textAlign:'center', color:'var(--proto-ink3)' }}>No saved opportunities yet — approve some from the <span className="px-link" onClick={() => go('/swipe')}>swipe queue</span>.</div>}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────── Packet builder (per opp) ─────────────── */
const PACKET_STEPS = [
  { id:'jd',        label:'JD analysis',   icon:'⌕', desc:'Extract keywords & ATS terms' },
  { id:'resume',    label:'Resume',        icon:'▤', desc:'Keyword-tailored from master' },
  { id:'cover',     label:'Cover letter',  icon:'✎', desc:'Tailored narrative' },
  { id:'portfolio', label:'Portfolio',     icon:'◫', desc:'Assemble work samples' },
  { id:'video',     label:'Intro video',   icon:'◉', desc:'Script + record 60s' },
  { id:'review',    label:'Review & send',  icon:'✓', desc:'Approval rounds' },
];

function PacketBuilderScreen() {
  const route = useRoute();
  const { opps, getPacket, updatePacket, toast, persona, personaInfo, moveStage } = useApp();
  const userName = personaInfo.user.name;
  const oppId = parseInt(route.parts[1] || '0', 10);
  const o = opps.find(x => x.id === oppId) || ALL_OPPS.find(x => x.id === oppId);
  const step = route.parts[2] || 'jd';
  const p = getPacket(oppId);

  // Ensure a packet exists in 'building' state on first open — seeded from the
  // triggering email: JD already extracted, keywords the master baseline already
  // covers pre-marked, so the user starts from a strong draft rather than scratch.
  React.useEffect(() => {
    if (o && p.status === 'none') {
      const bank = KEYWORDS[persona] || KEYWORDS.CTO;
      const musts = bank.filter(k => k.must);
      const missing = musts.slice(-2).map(k => k.kw);           // leave 2 must-haves to optimize
      const seed = bank.filter(k => !missing.includes(k.kw)).map(k => k.kw);
      updatePacket(oppId, { status: 'building', jdAnalyzed: true, coveredKw: seed });
    }
  }, [oppId]);

  if (!o) return <DesktopShell title="Not found" active="packet"><div style={{ padding:40 }}>Opportunity not found. <L to="/packet">Back to packets</L></div></DesktopShell>;

  const kwBank = KEYWORDS[persona] || KEYWORDS.CTO;
  const covered = p.coveredKw.length;
  const atsScore = Math.round(30 + (covered / kwBank.length) * 65);

  const setArtifact = (key, status) => updatePacket(oppId, prev => ({ ...prev, artifacts: { ...prev.artifacts, [key]: status } }));
  const setTemplate = (key, idx) => updatePacket(oppId, prev => ({ ...prev, templates: { ...prev.templates, [key]: idx } }));

  const goStep = (s) => go(`/packet/${oppId}/${s}`);

  const artifactColor = (s) => ({ todo:'var(--proto-ink3)', drafting: PROTO.yellow, review:'var(--proto-accent)', changes: PROTO.orange, approved: PROTO.green }[s] || 'var(--proto-ink3)');

  return (
    <DesktopShell title={`Packet — ${o.company}`} active="packet">
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        {/* Header */}
        <div style={{ padding:'10px 18px', borderBottom:'2px solid var(--proto-ink)', display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ fontSize:12 }}><L to="/packet">← Packets</L></div>
          <div className="px-logo">{o.logo}</div>
          <div style={{ flex:1 }}>
            <div className="px-h3">{o.company} · {o.role}</div>
            <div className="px-small">ATS keyword optimization + tailored assets · Round {p.round}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div className="px-label">ATS match</div>
            <div style={{ fontSize:20, fontWeight:700, color: atsScore >= 80 ? PROTO.green : atsScore >= 60 ? PROTO.yellow : PROTO.red }}>{atsScore}%</div>
          </div>
          <Pill color={artifactColor(p.status === 'approved' || p.status === 'sent' ? 'approved' : 'drafting')}>{p.status}</Pill>
          <div className={`px-btn ${p.status === 'approved' ? 'px-btn-green' : 'px-btn-ghost'}`} aria-disabled={p.status !== 'approved'} style={{ fontSize:12 }} onClick={() => { if (p.status === 'approved') { updatePacket(oppId, { status:'sent' }); moveStage(oppId, 'applied'); toast(`Packet sent to ${o.company} · moved to Applied`); } }}>Send packet →</div>
        </div>

        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {/* Left step rail */}
          <div style={{ width:210, borderRight:'2px solid var(--proto-ink)', background:'var(--proto-panel)', overflow:'auto', flexShrink:0 }}>
            {PACKET_STEPS.map((s, i) => {
              const st = s.id === 'jd' ? (p.jdAnalyzed ? 'approved' : 'todo')
                       : s.id === 'review' ? p.status
                       : (p.artifacts[s.id] || 'todo');
              const active = step === s.id;
              return (
                <div key={s.id} onClick={() => goStep(s.id)} style={{
                  padding:'11px 12px', cursor:'pointer', borderBottom:'1.5px solid var(--proto-rule-soft)',
                  borderLeft: active ? '4px solid var(--proto-accent)' : '4px solid transparent',
                  background: active ? 'var(--proto-paper)' : 'transparent',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ width:18, height:18, borderRadius:'50%', border:`1.5px solid ${artifactColor(st)}`, color: artifactColor(st), fontSize:10, display:'inline-flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontWeight:700 }}>{st === 'approved' ? '✓' : i + 1}</span>
                    <span style={{ fontSize:13, fontWeight: active ? 700 : 600 }}>{s.label}</span>
                  </div>
                  <div className="px-small" style={{ marginLeft:26, marginTop:2 }}>{s.desc}</div>
                </div>
              );
            })}
          </div>

          {/* Center + right */}
          <div style={{ flex:1, overflow:'auto', padding:18 }} key={step} className="px-fade">
            {step === 'jd'        && <JDStep o={o} p={p} kwBank={kwBank} atsScore={atsScore} updatePacket={updatePacket} oppId={oppId} toast={toast} goStep={goStep} />}
            {step === 'resume'    && <ArtifactStep o={o} p={p} keyName="resume" title="Tailored resume" atsScore={atsScore} setArtifact={setArtifact} setTemplate={setTemplate} toast={toast} goStep={goStep} kwBank={kwBank} covered={covered} userName={userName} />}
            {step === 'cover'     && <ArtifactStep o={o} p={p} keyName="cover" title="Cover letter" atsScore={atsScore} setArtifact={setArtifact} setTemplate={setTemplate} toast={toast} goStep={goStep} kwBank={kwBank} covered={covered} userName={userName} />}
            {step === 'portfolio' && <PortfolioStep o={o} p={p} setArtifact={setArtifact} setTemplate={setTemplate} toast={toast} goStep={goStep} />}
            {step === 'video'     && <VideoStep o={o} p={p} setArtifact={setArtifact} setTemplate={setTemplate} toast={toast} goStep={goStep} />}
            {step === 'review'    && <ReviewStep o={o} p={p} updatePacket={updatePacket} oppId={oppId} toast={toast} />}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ── Template selector — a default is pre-picked for speed; user can swap ── */
const TEMPLATE_SETS = {
  resume:    ['Infra Modernization', 'AI / Platform', 'Turnaround / Cost', 'Growth / Scale'],
  cover:     ['High-fit direct', 'Stretch narrative', 'Referral intro', 'POV-led'],
  portfolio: ['Modernization pack', 'AI transformation pack', 'Cost & reliability pack'],
  video:     ['60s exec intro', '90s role pitch', 'Story-led open'],
};

function TemplateBar({ keyName, p, setTemplate, toast }) {
  const opts = TEMPLATE_SETS[keyName] || [];
  const sel = (p.templates && p.templates[keyName]) || 0;
  return (
    <div className="px-box" style={{ padding:'8px 10px', display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
      <span className="px-label" style={{ whiteSpace:'nowrap' }}>Template</span>
      <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
        {opts.map((t, i) => (
          <div key={t} onClick={() => { setTemplate(keyName, i); toast(`Template: ${t}`); }} style={{
            cursor:'pointer', padding:'3px 10px', fontSize:12, borderRadius:99, fontWeight:600,
            border:`1.5px solid ${sel === i ? 'var(--proto-ink)' : 'var(--proto-rule-soft)'}`,
            background: sel === i ? 'var(--proto-ink)' : 'var(--proto-paper)',
            color: sel === i ? 'var(--proto-paper)' : 'var(--proto-ink2)',
          }}>{t}{i === 0 ? ' · default' : ''}</div>
        ))}
      </div>
    </div>
  );
}

/* ── Step 1: JD — pre-extracted from the triggering email, add research on top ── */
function JDStep({ o, p, kwBank, atsScore, updatePacket, oppId, toast, goStep }) {
  const details = OPP_DETAILS[o.id] || OPP_DETAILS[1];
  const [jd, setJd] = React.useState(
`${o.role} — ${o.company} (${o.loc})
Comp: ${o.comp}

ABOUT THE ROLE (auto-extracted from ${o.source} alert)
${o.company} is hiring a ${o.role.split(',')[0]}. ${o.why}. Reporting into ${o.hm && o.hm !== '—' ? o.hm : 'the executive team'}${o.recruiter && o.recruiter !== '—' ? `; recruiter contact ${o.recruiter}` : ''}.

SIGNALS (from research enrichment)
${details.signals.slice(0,3).map(s => '• ' + s).join('\n')}`
  );
  const [extra, setExtra] = React.useState('');
  const toggleKw = (kw) => updatePacket(oppId, prev => ({ ...prev, coveredKw: prev.coveredKw.includes(kw) ? prev.coveredKw.filter(k => k !== kw) : [...prev.coveredKw, kw] }));
  const optimizeAll = () => { updatePacket(oppId, { coveredKw: kwBank.map(k => k.kw), jdAnalyzed: true }); toast('Missing must-haves worked into resume ✓'); };
  const reanalyze = () => { updatePacket(oppId, { jdAnalyzed: true }); toast('Re-analyzed with added context'); };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <SectionTitle right={<Pill color={PROTO.green}>✓ from email</Pill>}>Extracted from triggering email</SectionTitle>
        <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
          <div style={{ display:'flex', justifyContent:'space-between' }}><span className="px-small">Source</span><b>{o.source} · {o.sourceDate}</b></div>
          <div style={{ display:'flex', justifyContent:'space-between' }}><span className="px-small">Role</span><b>{o.role}</b></div>
          <div style={{ display:'flex', justifyContent:'space-between' }}><span className="px-small">Comp</span><b>{o.comp}</b></div>
          <div style={{ display:'flex', justifyContent:'space-between' }}><span className="px-small">Location</span><b>{o.loc}</b></div>
          <div style={{ display:'flex', justifyContent:'space-between' }}><span className="px-small">Hiring manager</span><b>{o.hm && o.hm !== '—' ? o.hm : '—'}</b></div>
        </div>

        <SectionTitle sub="editable · pre-filled from the posting">Job description</SectionTitle>
        <textarea value={jd} onChange={e => setJd(e.target.value)} style={{ minHeight:150, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-paper)', fontFamily:"'Caveat',cursive", fontSize:14, padding:10, color:'var(--proto-ink)', resize:'vertical', lineHeight:1.4 }} />

        <SectionTitle sub="optional — paste from the posting or your research">Add more context</SectionTitle>
        <div className="px-dashed" style={{ padding:12, textAlign:'center', cursor:'pointer' }} onClick={() => { setExtra('[Attached research: Glassdoor notes, mutual-contact intel, recent press…]'); reanalyze(); }}>
          <div style={{ fontSize:20 }}>⇪</div>
          <div className="px-small">Drop a screenshot / PDF, or click to paste extra research</div>
        </div>
        {extra && <div className="px-note" style={{ fontSize:12 }}>{extra}</div>}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <SectionTitle right={<Pill color={atsScore >= 80 ? PROTO.green : PROTO.yellow}>ATS {atsScore}%</Pill>}>Keywords & ATS terms</SectionTitle>
        <div className="px-box" style={{ padding:12 }}>
          <div className="px-label" style={{ marginBottom:8 }}>Auto-matched against your master baseline · tap to toggle</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {kwBank.map(k => {
              const on = p.coveredKw.includes(k.kw);
              return (
                <div key={k.kw} onClick={() => toggleKw(k.kw)} style={{ cursor:'pointer', padding:'3px 9px', border:`1.5px solid ${on ? PROTO.green : (k.must ? PROTO.red : 'var(--proto-rule-soft)')}`, background: on ? 'var(--proto-green-soft)' : 'var(--proto-paper)', color: on ? PROTO.green : (k.must ? PROTO.red : 'var(--proto-ink2)'), borderRadius:99, fontSize:12, fontWeight:600 }}>
                  {on ? '✓ ' : (k.must ? '! ' : '')}{k.kw}
                </div>
              );
            })}
          </div>
          <div className="px-small" style={{ marginTop:8 }}>! = must-have still missing · ✓ = already covered by your baseline · {p.coveredKw.length}/{kwBank.length}</div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <div className="px-btn px-btn-accent" onClick={optimizeAll}>⚡ Auto-optimize resume</div>
          <div className="px-btn px-btn-ghost" onClick={() => goStep('resume')}>Next: resume →</div>
        </div>
        <div className="px-note">Your baseline already covers most terms — you're starting at {atsScore}%, not from scratch. Fill the {kwBank.length - p.coveredKw.length} gaps to top out.</div>
      </div>
    </div>
  );
}

/* ── Steps 2/3: Resume / Cover — editable artifact with keyword coverage + approval ── */
function ArtifactStep({ o, p, keyName, title, atsScore, setArtifact, setTemplate, toast, goStep, kwBank, covered, userName }) {
  const status = p.artifacts[keyName] || 'todo';
  const tpl = (p.templates && p.templates[keyName]) || 0;
  const tplName = (TEMPLATE_SETS[keyName] || ['Default'])[tpl];
  const resumeSummaries = [
    `Modernization-minded ${o.role.split(',')[0]}. ${p.coveredKw.slice(0,4).join(' · ') || 'add keywords in JD step'}.`,
    `AI/platform-first executive. Built inference platforms at scale; ${p.coveredKw.slice(0,3).join(' · ')}.`,
    `Turnaround operator. Cut cost while raising reliability; ${p.coveredKw.slice(0,3).join(' · ')}.`,
    `Scale leader. Grew org + platform 3×; ${p.coveredKw.slice(0,3).join(' · ')}.`,
  ];
  const coverOpeners = [
    `Your ${o.role} charter maps closely to what I've spent the last four years doing — ${o.why}.`,
    `On paper this is a stretch, and that's exactly why I'm writing: ${o.why} is the problem I want next.`,
    `${o.recruiter && o.recruiter !== '—' ? o.recruiter.split('(')[0].trim() : 'A mutual contact'} suggested I reach out about the ${o.role.split(',')[0]} role.`,
    `Before I introduce myself — here's my one-paragraph POV on ${o.why.toLowerCase()}.`,
  ];
  const buildText = (tIdx) => keyName === 'resume'
    ? `${userName} — ${o.role.split(',')[0]}   [${TEMPLATE_SETS.resume[tIdx]} template]\n\nSUMMARY\n${resumeSummaries[tIdx]}\n\nSELECTED IMPACT\n• Modernized control plane → 99.99% reliability in 14 months\n• Cut infra spend 22% while doubling AI inference traffic\n• Scaled org to 120+ with a board-readable operating cadence\n\nKEYWORDS WORKED IN\n${p.coveredKw.join(', ') || '—'}`
    : `Dear ${o.hm && o.hm !== '—' ? o.hm : 'Hiring Team'},\n\n${coverOpeners[tIdx]} I've attached a one-page point of view.\n\nI'd welcome a conversation.\n\n— ${userName}`;
  const [text, setText] = React.useState(() => buildText(tpl));
  React.useEffect(() => { setText(buildText(tpl)); }, [tpl]);

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:18, height:'100%' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:10, minHeight:0 }}>
        <SectionTitle right={<Pill color={status === 'approved' ? PROTO.green : status === 'review' ? 'var(--proto-accent)' : PROTO.yellow}>{status}</Pill>}>{title}</SectionTitle>
        <TemplateBar keyName={keyName} p={p} setTemplate={setTemplate} toast={toast} />
        <div className="px-box" style={{ padding:0, flex:1, display:'flex', flexDirection:'column', minHeight:300 }}>
          <div style={{ padding:'6px 10px', borderBottom:'1.5px solid var(--proto-rule-soft)', display:'flex', gap:6, alignItems:'center' }}>
            <span className="px-small">{keyName === 'resume' ? 'Resume v' + p.round + '.2' : 'Cover letter'} · {tplName}</span>
            <div style={{ flex:1 }} />
            <div className="px-btn px-btn-ghost" style={{ fontSize:11, padding:'2px 8px' }} onClick={() => { setText(buildText(tpl)); setArtifact(keyName, 'drafting'); toast('Regenerated from template'); }}>↻ Regenerate</div>
          </div>
          <textarea value={text} onChange={e => setText(e.target.value)} style={{ flex:1, border:'none', outline:'none', background:'var(--proto-paper)', fontFamily:"'Caveat',cursive", fontSize:15, padding:12, resize:'none', color:'var(--proto-ink)', lineHeight:1.5 }} />
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <div className="px-btn" onClick={() => { setArtifact(keyName, 'review'); toast('Sent for review'); }}>Submit for review</div>
          <div className="px-btn px-btn-green" onClick={() => { setArtifact(keyName, 'approved'); toast(`${title} approved ✓`); }}>Approve</div>
          <div style={{ flex:1 }} />
          <div className="px-btn px-btn-ghost" onClick={() => goStep(keyName === 'resume' ? 'cover' : 'portfolio')}>Next →</div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {keyName === 'resume' && (
          <div>
            <SectionTitle right={<Pill color={PROTO.green}>ATS {atsScore}%</Pill>}>Keyword coverage</SectionTitle>
            <div className="px-box" style={{ padding:12 }}>
              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                {kwBank.map(k => {
                  const on = p.coveredKw.includes(k.kw);
                  return <span key={k.kw} style={{ padding:'2px 7px', fontSize:11, borderRadius:99, border:`1.5px solid ${on ? PROTO.green : 'var(--proto-rule-soft)'}`, color: on ? PROTO.green : 'var(--proto-ink3)', background: on ? 'var(--proto-green-soft)' : 'transparent' }}>{on ? '✓ ' : ''}{k.kw}</span>;
                })}
              </div>
              <div className="px-divider" style={{ margin:'10px 0' }} />
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>Coverage</span><b>{covered}/{kwBank.length}</b></div>
              <Bar value={covered/kwBank.length*100} color={PROTO.green} />
              <div className="px-small" style={{ marginTop:6 }}>Missing must-haves drop recruiter ranking. Fix them in the <span className="px-link" onClick={() => goStep('jd')}>JD step</span>.</div>
            </div>
          </div>
        )}
        <div>
          <SectionTitle>Version history</SectionTitle>
          <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:6 }}>
            {[`v${p.round}.2 · current · keyword-optimized`, `v${p.round}.1 · +3 must-have terms`, 'v1.0 · from master baseline'].map((v, i) => (
              <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom: i < 2 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}><span>{v}</span>{i === 0 ? <Pill color={PROTO.green}>live</Pill> : <span className="px-link">restore</span>}</div>
            ))}
          </div>
        </div>
        <div>
          <SectionTitle>Reviewer feedback</SectionTitle>
          <FeedbackThread o={o} p={p} />
        </div>
      </div>
    </div>
  );
}

/* ── Step 4: Portfolio ── */
function PortfolioStep({ o, p, setArtifact, setTemplate, toast, goStep }) {
  const packs = {
    0: ['Platform modernization case study','Cost optimization POV — 1pg','Board operating cadence sample'],
    1: ['AI Transformation portfolio deck','Platform modernization case study','Open-source: edge-router'],
    2: ['Cost optimization POV — 1pg','Reliability postmortem writeup','Board operating cadence sample'],
  };
  const tpl = (p.templates && p.templates.portfolio) || 0;
  const samples = [
    { n:'Platform modernization case study', tag:'Deck · 8pg' },
    { n:'AI Transformation portfolio deck',   tag:'Deck · 14pg' },
    { n:'Cost optimization POV — 1pg',        tag:'PDF' },
    { n:'Open-source: edge-router',           tag:'GitHub · 1.2k★' },
    { n:'Board operating cadence sample',     tag:'PDF' },
    { n:'Reliability postmortem writeup',     tag:'Doc' },
  ];
  const [selected, setSelected] = React.useState(() => packs[tpl] || packs[0]);
  React.useEffect(() => { setSelected(packs[tpl] || packs[0]); }, [tpl]);
  const toggle = (n) => setSelected(sel => sel.includes(n) ? sel.filter(x => x !== n) : [...sel, n]);

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14, maxWidth:900 }}>
      <SectionTitle sub={`${selected.length} selected for ${o.company}`} right={<Pill color={p.artifacts.portfolio === 'approved' ? PROTO.green : PROTO.yellow}>{p.artifacts.portfolio}</Pill>}>Assemble portfolio</SectionTitle>
      <TemplateBar keyName="portfolio" p={p} setTemplate={setTemplate} toast={toast} />
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {samples.map(s => {
          const on = selected.includes(s.n);
          return (
            <div key={s.n} onClick={() => toggle(s.n)} className="px-box" style={{ padding:10, cursor:'pointer', borderColor: on ? PROTO.green : 'var(--proto-ink)', borderWidth: on ? 2 : 1.5 }}>
              <div className="px-photo" style={{ height:64, marginBottom:8 }} />
              <div style={{ display:'flex', alignItems:'flex-start', gap:6 }}>
                <span style={{ marginTop:1, color: on ? PROTO.green : 'var(--proto-ink3)', fontWeight:700 }}>{on ? '☑' : '☐'}</span>
                <div>
                  <div style={{ fontSize:13, fontWeight:700, lineHeight:1.2 }}>{s.n}</div>
                  <div className="px-small">{s.tag}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display:'flex', gap:6 }}>
        <div className="px-btn px-btn-green" onClick={() => { setArtifact('portfolio', 'approved'); toast('Portfolio locked'); }}>Approve selection</div>
        <div className="px-btn px-btn-ghost" onClick={() => goStep('video')}>Next: intro video →</div>
      </div>
    </div>
  );
}

/* ── Step 5: Intro video ── */
function VideoStep({ o, p, setArtifact, setTemplate, toast, goStep }) {
  const tpl = (p.templates && p.templates.video) || 0;
  const scripts = [
    `Hi — I'm reaching out about the ${o.role.split(',')[0]} role.\n\nIn 60 seconds: I've spent 4 years on exactly the platform-modernization + cost problem your team is facing. I'd bring an operating cadence your board can read from week one.\n\nHere's how I'd approach the first 90 days…`,
    `${o.company} team — a 90-second pitch for the ${o.role.split(',')[0]} seat.\n\nWhat I'd own: reliability, cost, and the AI platform roadmap. What I've done: cut infra spend 22% while doubling inference traffic. What I'd do first: instrument cost, stabilize reliability, then reinvest.\n\nLet's talk specifics.`,
    `Let me start with a story. Three years ago I inherited a platform melting under its own success…\n\nBy the end we'd hit 99.99% and cut spend 22%. That's the exact shape of the ${o.role.split(',')[0]} challenge at ${o.company} — and why I'm reaching out.`,
  ];
  const [script, setScript] = React.useState(() => scripts[tpl]);
  React.useEffect(() => { setScript(scripts[tpl]); }, [tpl]);
  const [recorded, setRecorded] = React.useState(p.artifacts.video === 'approved');

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <SectionTitle>60-second script</SectionTitle>
        <TemplateBar keyName="video" p={p} setTemplate={setTemplate} toast={toast} />
        <textarea value={script} onChange={e => setScript(e.target.value)} style={{ minHeight:200, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-paper)', fontFamily:"'Caveat',cursive", fontSize:15, padding:12, resize:'vertical', color:'var(--proto-ink)', lineHeight:1.5 }} />
        <div className="px-small">~{Math.round(script.split(' ').length / 2.5)}s at speaking pace · target 60s</div>
      </div>
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
        <SectionTitle right={<Pill color={p.artifacts.video === 'approved' ? PROTO.green : PROTO.yellow}>{p.artifacts.video}</Pill>}>Record</SectionTitle>
        <div className="px-box" style={{ background:'#0e0e0e', borderColor:'#333', height:220, position:'relative', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <div className="px-photo" style={{ position:'absolute', inset:0, background:'#1a1a1a', borderColor:'#333' }} />
          <div style={{ position:'relative', zIndex:2, textAlign:'center', color:'#ccc' }}>
            {recorded ? (<><div style={{ fontSize:32 }}>▶</div><div style={{ fontSize:13 }}>intro-{o.company.toLowerCase()}.mp4 · 0:58</div></>) : (<><div style={{ fontSize:32, color: PROTO.red }}>●</div><div style={{ fontSize:13 }}>ready to record</div></>)}
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {!recorded
            ? <div className="px-btn px-btn-red" onClick={() => { setRecorded(true); setArtifact('video', 'review'); toast('Recorded · sent for review'); }}>● Record 60s</div>
            : <><div className="px-btn px-btn-ghost" onClick={() => setRecorded(false)}>Re-record</div><div className="px-btn px-btn-green" onClick={() => { setArtifact('video', 'approved'); toast('Video approved ✓'); }}>Approve</div></>}
          <div style={{ flex:1 }} />
          <div className="px-btn px-btn-ghost" onClick={() => goStep('review')}>Next: review →</div>
        </div>
        <div className="px-note">Optional but high-signal for executive rounds — attach to first-round approvals.</div>
      </div>
    </div>
  );
}

/* ── Step 6: Review & approval rounds ── */
function ReviewStep({ o, p, updatePacket, oppId, toast }) {
  const [note, setNote] = React.useState('');
  const arts = [
    { key:'resume', label:'Resume' }, { key:'cover', label:'Cover letter' },
    { key:'portfolio', label:'Portfolio' }, { key:'video', label:'Intro video' },
  ];
  const allApproved = arts.every(a => p.artifacts[a.key] === 'approved');
  const artColor = (s) => ({ todo:'var(--proto-ink3)', drafting: PROTO.yellow, review:'var(--proto-accent)', changes: PROTO.orange, approved: PROTO.green }[s]);

  const requestChanges = () => {
    if (!note.trim()) { toast('Add a note first'); return; }
    updatePacket(oppId, prev => ({ ...prev, status:'changes', round: prev.round + 1, feedback: [{ round: prev.round, from:'Reviewer (you)', note, kind:'changes' }, ...prev.feedback] }));
    setNote('');
    toast('Changes requested · round ' + (p.round + 1));
  };
  const approvePacket = () => {
    if (!allApproved) { toast('Approve all artifacts first'); return; }
    updatePacket(oppId, prev => ({ ...prev, status:'approved', feedback: [{ round: prev.round, from:'Reviewer (you)', note:'Packet approved — ready to send', kind:'approved' }, ...prev.feedback] }));
    toast('Packet approved 🎉');
  };

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <SectionTitle sub={`round ${p.round}`}>Packet checklist</SectionTitle>
        <div className="px-box" style={{ padding:0 }}>
          {arts.map((a, i) => (
            <div key={a.key} style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 12px', borderBottom: i < arts.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
              <span style={{ width:18, height:18, borderRadius:'50%', border:`1.5px solid ${artColor(p.artifacts[a.key])}`, color: artColor(p.artifacts[a.key]), fontSize:10, display:'inline-flex', alignItems:'center', justifyContent:'center', fontWeight:700 }}>{p.artifacts[a.key] === 'approved' ? '✓' : '·'}</span>
              <div style={{ flex:1, fontSize:13, fontWeight:600 }}>{a.label}</div>
              <Pill color={artColor(p.artifacts[a.key])}>{p.artifacts[a.key]}</Pill>
              <div className="px-btn px-btn-ghost" style={{ fontSize:11 }} onClick={() => go(`/packet/${oppId}/${a.key === 'video' ? 'video' : a.key}`)}>Open</div>
            </div>
          ))}
        </div>
        <div className="px-box" style={{ padding:12, background: allApproved ? 'var(--proto-green-soft)' : 'var(--proto-panel)', borderColor: allApproved ? PROTO.green : 'var(--proto-ink)' }}>
          <div style={{ fontSize:14, fontWeight:700 }}>{allApproved ? '✓ All artifacts approved — ready to send' : `${arts.filter(a => p.artifacts[a.key] === 'approved').length}/4 approved`}</div>
          <div style={{ display:'flex', gap:6, marginTop:10 }}>
            <div className={`px-btn ${allApproved ? 'px-btn-green' : 'px-btn-ghost'}`} aria-disabled={!allApproved} onClick={approvePacket}>Approve packet</div>
            {p.status === 'approved' && <div className="px-btn px-btn-dark" onClick={() => { updatePacket(oppId, { status:'sent' }); toast('Packet sent · moved to Applied'); go(`/opp/${oppId}`); }}>Send now →</div>}
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        <SectionTitle sub="request another round">Feedback</SectionTitle>
        <div className="px-box" style={{ padding:12 }}>
          <textarea value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. 'Lead resume with the cost-optimization win; tighten cover letter to 3 sentences.'" style={{ width:'100%', minHeight:80, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-paper)', fontFamily:"'Caveat',cursive", fontSize:14, padding:8, resize:'vertical', color:'var(--proto-ink)' }} />
          <div className="px-btn px-btn-yellow" style={{ marginTop:8, fontSize:12 }} onClick={requestChanges}>Request changes → new round</div>
        </div>
        <FeedbackThread o={o} p={p} />
      </div>
    </div>
  );
}

function FeedbackThread({ o, p }) {
  const seed = [
    { round: 1, from:'AI reviewer', note:'Must-have keyword "cost optimization" missing from resume summary.', kind:'changes' },
    { round: 1, from:'AI reviewer', note:'Strong impact bullets — quantified and specific.', kind:'note' },
  ];
  const all = [...(p.feedback || []), ...seed];
  const kindColor = (k) => ({ changes: PROTO.orange, approved: PROTO.green, note:'var(--proto-ink3)' }[k] || 'var(--proto-ink3)');
  return (
    <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8, fontSize:12 }}>
      {all.length === 0 && <div className="px-small">No feedback yet.</div>}
      {all.map((f, i) => (
        <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', paddingBottom:8, borderBottom: i < all.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
          <div style={{ width:7, height:7, borderRadius:'50%', marginTop:4, background: kindColor(f.kind), flexShrink:0 }} />
          <div style={{ flex:1 }}>
            <div>{f.note}</div>
            <div className="px-small">Round {f.round} · {f.from}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { PacketListScreen, PacketBuilderScreen });
