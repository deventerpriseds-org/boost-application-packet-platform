// Intake (per-role inbox monitoring 3-pane + OAuth folder setup) · Settings · Templates.

function intakeRoleFamily(o) {
  const r = o.role.toLowerCase();
  if (r.includes('cto')) return 'CTO Roles';
  if (r.includes('ai')) return 'VP AI Transformation';
  if (r.includes('vp engineering')) return 'VP Engineering';
  if (r.includes('product')) return 'VP Product';
  if (r.includes('head') || r.includes('digital')) return 'Head of Digital';
  if (r.includes('engineering')) return 'VP Engineering';
  return 'Other roles';
}
const INTAKE_DOT = {
  'CTO Roles': 'var(--surface-brand-default)',
  'VP Engineering': 'var(--surface-success-default)',
  'VP Product': 'var(--proto-purple)',
  'VP AI Transformation': 'var(--proto-orange)',
  'Head of Digital': 'var(--surface-error-default)',
  'Other roles': 'var(--proto-ink3)',
};
const FAMILY_FOLDER = {
  'CTO Roles': 'Jobs/CTO', 'VP Engineering': 'Jobs/VPE', 'VP Product': 'Jobs/VPP',
  'VP AI Transformation': 'Jobs/VPAI', 'Head of Digital': 'Jobs/HOD', 'Other roles': 'Jobs/Other',
};

/* ═══════════ Intake — per-role inbox monitoring (3-pane) ═══════════ */
function IntakeScreen() {
  const route = useRoute();
  if (route.parts[1] === 'setup') return <OAuthSetupScreen />;
  return <InboxMonitoringScreen />;
}

function InboxMonitoringScreen() {
  const { opps, toast } = useApp();
  // group all persona opps by role family
  const groups = React.useMemo(() => {
    const map = {};
    opps.forEach(o => { const f = intakeRoleFamily(o); (map[f] = map[f] || []).push(o); });
    return map;
  }, [opps]);
  const families = Object.keys(groups);
  const [activeFam, setActiveFam] = React.useState(families[0] || 'CTO Roles');
  const list = groups[activeFam] || [];
  const [selId, setSelId] = React.useState(list[0]?.id);
  const sel = list.find(o => o.id === selId) || list[0];

  React.useEffect(() => { if (!list.find(o => o.id === selId)) setSelId(list[0]?.id); }, [activeFam]);

  return (
    <DesktopShell title="Inbox monitoring (intake)" active="intake">
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        {/* header */}
        <div style={{ padding:'10px 18px', borderBottom:'1px solid var(--proto-rule-soft)', display:'flex', alignItems:'center', gap:12 }}>
          <div className="px-h2">Inbox monitoring</div>
          <span className="px-pill">OAuth · Gmail · ✓ connected</span>
          <div style={{ flex:1 }} />
          <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => toast('Re-scanning inbox…')}>↻ Re-scan inbox</div>
          <div className="px-btn" style={{ fontSize:12 }} onClick={() => go('/intake/setup')}>Folder setup</div>
        </div>

        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {/* Pane 1 — monitored roles */}
          <div style={{ width:230, borderRight:'1px solid var(--proto-rule-soft)', overflow:'auto', display:'flex', flexDirection:'column', background:'var(--proto-paper)' }}>
            <div className="px-label" style={{ padding:'10px 14px 6px' }}>Monitored roles · {families.length}</div>
            {families.map(fam => (
              <div key={fam} onClick={() => setActiveFam(fam)} style={{
                padding:'10px 14px', cursor:'pointer', display:'flex', alignItems:'center', gap:9,
                background: activeFam === fam ? 'var(--surface-brand-subtle)' : 'transparent',
                borderLeft: activeFam === fam ? '3px solid var(--surface-brand-default)' : '3px solid transparent',
              }}>
                <span style={{ width:9, height:9, borderRadius:'50%', background: INTAKE_DOT[fam], flexShrink:0 }} />
                <span style={{ flex:1, fontSize:13, fontWeight: activeFam === fam ? 600 : 500, color: activeFam === fam ? 'var(--text-brand)' : 'var(--proto-ink)' }}>{fam}</span>
                <span className="px-pill" style={{ background:'var(--proto-panel)' }}>{groups[fam].length}</span>
              </div>
            ))}
            <div style={{ flex:1 }} />
            <div style={{ padding:10, display:'flex', flexDirection:'column', gap:6, borderTop:'1px solid var(--proto-rule-soft)' }}>
              <div className="px-btn px-btn-accent" style={{ justifyContent:'center', fontSize:12 }} onClick={() => go('/roles')}>+ Add role</div>
            </div>
          </div>

          {/* Pane 2 — alerts for role */}
          <div style={{ width:300, borderRight:'1px solid var(--proto-rule-soft)', overflow:'auto', background:'var(--surface-background-secondary)' }}>
            <div style={{ padding:'10px 14px', display:'flex', alignItems:'center', gap:8, borderBottom:'1px solid var(--proto-rule-soft)', position:'sticky', top:0, background:'var(--surface-background-secondary)' }}>
              <div className="px-h3">{activeFam}</div>
              <span className="px-small">{list.length} alerts</span>
            </div>
            {list.map(o => (
              <div key={o.id} onClick={() => setSelId(o.id)} style={{
                padding:'11px 14px', cursor:'pointer', borderBottom:'1px solid var(--proto-rule-soft)',
                background: sel?.id === o.id ? 'var(--proto-paper)' : 'transparent',
                borderLeft: sel?.id === o.id ? '3px solid var(--surface-brand-default)' : '3px solid transparent',
              }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div className="px-logo" style={{ width:26, height:26, fontSize:12 }}>{o.logo}</div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{o.role.split(',')[0]}</div>
                    <div className="px-small">{o.company} · via {o.source}</div>
                  </div>
                  {o.urgency === 'Hot' && <span style={{ width:7, height:7, borderRadius:'50%', background:'var(--surface-error-default)' }} />}
                </div>
                <div className="px-small" style={{ marginTop:4 }}>{o.sourceDate}</div>
              </div>
            ))}
            {list.length === 0 && <div className="px-dashed" style={{ margin:14, padding:20, textAlign:'center', color:'var(--proto-ink3)' }}>No alerts in this role.</div>}
          </div>

          {/* Pane 3 — email preview + actions */}
          <div style={{ flex:1, overflow:'auto', padding:18 }}>
            {sel ? (
              <div style={{ maxWidth:640, display:'flex', flexDirection:'column', gap:14 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
                  <div className="px-logo" style={{ width:44, height:44, fontSize:18 }}>{sel.logo}</div>
                  <div style={{ flex:1 }}>
                    <div className="px-h2">{sel.role}</div>
                    <div className="px-meta">{sel.company} · via {sel.source} · {sel.sourceDate}</div>
                    <div style={{ display:'flex', gap:6, marginTop:6 }}>
                      <Pill color={'var(--surface-brand-default)'}>Matched: {activeFam}</Pill>
                      <Pill color={sel.match >= 85 ? PROTO.green : 'var(--proto-accent)'}>{sel.match}% match · {sel.fit}</Pill>
                    </div>
                  </div>
                </div>

                {/* email body */}
                <div className="px-box" style={{ padding:14, fontSize:13, lineHeight:1.6, color:'var(--proto-ink2)' }}>
                  <div className="px-small">From: jobs-noreply@{sel.source.toLowerCase().replace(/[^a-z]/g,'')}.com</div>
                  <div className="px-small">Subj: New job matching "{activeFam.replace(' Roles','')}" — {sel.company}</div>
                  <div className="px-divider" style={{ margin:'10px 0' }} />
                  <div>Hi Jordan, a new role just posted that matches your saved search:</div>
                  <div style={{ margin:'10px 0', fontWeight:600, color:'var(--proto-ink)' }}>{sel.role} at {sel.company}</div>
                  <div>Location: {sel.loc} · Compensation est. {sel.comp}</div>
                  <div>Why surfaced: {sel.why}</div>
                  {sel.hm && sel.hm !== '—' && <div>Hiring manager: {sel.hm}</div>}
                  <div style={{ marginTop:10 }}><span className="px-link">[ View posting → ]</span></div>
                </div>

                {/* triage actions */}
                <div className="px-panel" style={{ padding:14 }}>
                  <div className="px-label" style={{ marginBottom:10 }}>What do you want to do with this?</div>
                  <div style={{ display:'flex', gap:10 }}>
                    <div className="px-btn px-btn-green" style={{ flex:1, justifyContent:'center' }} onClick={() => { go(`/packet/${sel.id}`); }}>✓ Push to swipe queue</div>
                    <div className="px-btn px-btn-yellow" style={{ flex:1, justifyContent:'center' }} onClick={() => toast('Snoozed 24h')}>⏰ Snooze</div>
                    <div className="px-btn px-btn-red" style={{ flex:1, justifyContent:'center' }} onClick={() => toast(`Dismissed ${sel.company}`)}>✕ Dismiss</div>
                  </div>
                  <div className="px-small" style={{ marginTop:8 }}>Pushed alerts appear in the morning swipe queue. Snoozed alerts return after 24h.</div>
                </div>
                <div className="px-small">Source folder: {FAMILY_FOLDER[activeFam]} · mapped during OAuth setup</div>
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--proto-ink3)' }}>← select an alert to review</div>
            )}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ═══════════ OAuth + folder setup stepper ═══════════ */
function OAuthSetupScreen() {
  const { toast } = useApp();
  const [step, setStep] = React.useState(3); // land on Map folders (matches design)
  const steps = ['Connect email', 'Create roles', 'Map folders', 'Done'];
  const families = ['CTO Roles','VP Engineering','VP Product','VP AI Transformation','Head of Digital'];
  const alertCounts = { 'CTO Roles':7, 'VP Engineering':4, 'VP Product':3, 'VP AI Transformation':5, 'Head of Digital':2 };

  return (
    <DesktopShell title="Connect inbox · setup" active="intake">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:16, maxWidth:820 }}>
        <div style={{ fontSize:12 }}><L to="/intake">← Back to monitoring</L></div>

        {/* stepper */}
        <div style={{ display:'flex', alignItems:'center', gap:0 }}>
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700,
                  background: i < step ? 'var(--surface-success-default)' : i === step ? 'var(--surface-brand-default)' : 'var(--proto-panel-deep)',
                  color: i <= step ? '#fff' : 'var(--proto-ink3)' }}>{i < step ? '✓' : i+1}</div>
                <span style={{ fontSize:13, fontWeight: i === step ? 600 : 500, color: i <= step ? 'var(--proto-ink)' : 'var(--proto-ink3)' }}>{s}</span>
              </div>
              {i < steps.length-1 && <div style={{ flex:1, height:2, margin:'0 10px', background: i < step ? 'var(--surface-success-default)' : 'var(--proto-rule-soft)' }} />}
            </React.Fragment>
          ))}
        </div>

        {step === 0 && (
          <div className="px-box" style={{ padding:20 }}>
            <div className="px-h2">Connect your inbox</div>
            <div className="px-meta" style={{ marginBottom:14 }}>Read-only access to monitor job-alert folders.</div>
            {['Continue with Google / Gmail','Continue with Outlook / Microsoft 365','Continue with Yahoo Mail'].map(p => (
              <div key={p} className="px-btn" style={{ width:'100%', justifyContent:'space-between', marginBottom:8, padding:'12px 14px' }} onClick={() => { setStep(3); toast('Inbox connected'); }}>{p}<span>→</span></div>
            ))}
            <div className="px-small" style={{ marginTop:8 }}>🔒 Read-only access · revoke anytime in Settings</div>
          </div>
        )}

        {step === 3 && (
          <div className="px-box" style={{ padding:20 }}>
            <div className="px-h2">Map roles to inbox folders</div>
            <div className="px-meta">Choose where each role's alerts live. We'll watch only those folders.</div>
            <div className="px-note" style={{ margin:'12px 0' }}>Pro tip: set up filters in Gmail/Outlook to route LinkedIn/Indeed/Greenhouse alerts into role-specific folders first. The engine reads those folders, not your whole inbox.</div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {families.map(fam => (
                <div key={fam} className="px-box-soft" style={{ padding:'11px 14px', display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ width:9, height:9, borderRadius:'50%', background: INTAKE_DOT[fam] }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:600 }}>{fam}</div>
                    <div className="px-small">→ folder: {FAMILY_FOLDER[fam]} · {alertCounts[fam]} alerts found</div>
                  </div>
                  <Pill color={PROTO.green}>✓ mapped</Pill>
                  <div className="px-btn px-btn-ghost" style={{ fontSize:11 }} onClick={() => toast('Edit mapping')}>Edit</div>
                </div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8, marginTop:16, alignItems:'center' }}>
              <div className="px-btn px-btn-ghost" onClick={() => setStep(0)}>← Back</div>
              <div style={{ flex:1 }} />
              <div className="px-btn" onClick={() => toast('Auto-detecting folders…')}>Auto-detect folders</div>
              <div className="px-btn px-btn-accent" onClick={() => { toast('Monitoring started ✓'); go('/intake'); }}>Start monitoring →</div>
            </div>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}

/* ═══════════ Settings ═══════════ */
function SettingsScreen() {
  const route = useRoute();
  if (route.parts[1] === 'templates') return <TemplatesScreen />;
  const { persona, demoState } = useApp();
  const sections = [
    { id:'templates', label:'Templates', sub:'Reusable text + creative assets', to:'/settings/templates' },
    { id:'cadence', label:'Cadence engine', sub:'Sequence timing + rules' },
    { id:'connections', label:'Connections', sub:'Gmail, Calendar, LinkedIn', to:'/intake' },
    { id:'notifications', label:'Notifications', sub:'Briefing, signals, digests' },
    { id:'profiles', label:'Master profiles', sub:'8 role baselines', to:'/roles' },
    { id:'privacy', label:'Privacy', sub:'Data + read-only scopes' },
    { id:'billing', label:'Billing', sub:'Executive Pro · renews Aug 14' },
    { id:'recording', label:'Recording / consent', sub:'Interview capture rules' },
  ];
  return (
    <DesktopShell title="Settings" active="settings">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, maxWidth:980 }}>
        <div className="px-h1" style={{ fontSize:22 }}>Settings</div>
        <div className="px-meta">Profile, templates, connections, notifications, billing</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12 }}>
          {sections.map(s => (
            <div key={s.id} className="px-box" style={{ padding:14, display:'flex', alignItems:'center', gap:12, cursor: s.to ? 'pointer':'default' }} onClick={() => s.to && go(s.to)}>
              <div style={{ flex:1 }}>
                <div className="px-h3">{s.label}</div>
                <div className="px-small">{s.sub}</div>
              </div>
              {s.to && <span className="px-link">Open →</span>}
            </div>
          ))}
        </div>

        <div className="px-box" style={{ padding:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginTop:4 }}>
          <SettingsBlock title="Account" rows={[
            ['Name', PERSONAS[persona].user.name],
            ['Role', PERSONAS[persona].label],
            ['Location', PERSONAS[persona].user.loc],
            ['Demo state', DEMO_STATES[demoState].label],
          ]} />
          <SettingsBlock title="Plan" rows={[
            ['Plan', 'Executive Pro'],
            ['Seats', '1 (you) + 1 partner'],
            ['Renews', 'Aug 14'],
          ]} />
        </div>
      </div>
    </DesktopShell>
  );
}

/* ═══════════ Settings → Templates manager ═══════════ */
function TemplatesScreen() {
  const { toast } = useApp();
  const cats = [
    { id:'resume', label:'Resume', n:4 }, { id:'cover', label:'Cover letter', n:3 },
    { id:'recruiter', label:'Recruiter outreach', n:5 }, { id:'hm', label:'Hiring mgr outreach', n:3 },
    { id:'linkedin', label:'LinkedIn', n:3 }, { id:'thankyou', label:'Thank-you', n:3 },
    { id:'portfolio', label:'Portfolio decks', n:3 }, { id:'video', label:'Intro video', n:2 },
  ];
  const [cat, setCat] = React.useState('resume');
  const cards = {
    resume: [
      { n:'CTO — Infra Modernization', tag:'primary' }, { n:'CTO — AI / Platform', tag:'variant' },
      { n:'VP Eng — Platform', tag:'variant' }, { n:'VP Product — Ops', tag:'variant' },
    ],
    cover: [{ n:'High-fit direct', tag:'primary' }, { n:'Stretch narrative', tag:'variant' }, { n:'Referral intro', tag:'variant' }],
    recruiter: [{ n:'Initial — cold', tag:'primary' }, { n:'Follow-up #1', tag:'variant' }, { n:'Follow-up #2', tag:'variant' }, { n:'Re-engage stale', tag:'variant' }, { n:'Warm intro', tag:'variant' }],
  };
  const list = cards[cat] || [{ n:'Template A', tag:'primary' }, { n:'Template B', tag:'variant' }];

  return (
    <DesktopShell title="Settings · Templates" active="settings">
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        <div style={{ padding:'10px 18px', borderBottom:'1px solid var(--proto-rule-soft)', display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontSize:12 }}><L to="/settings">← Settings</L></div>
          <div className="px-h2">Templates</div>
          <span className="px-meta">All reusable text + creative assets the engine pulls from.</span>
        </div>
        <div style={{ flex:1, display:'flex', overflow:'hidden' }}>
          {/* category rail */}
          <div style={{ width:220, borderRight:'1px solid var(--proto-rule-soft)', overflow:'auto', padding:8 }}>
            {cats.map(c => (
              <div key={c.id} onClick={() => setCat(c.id)} style={{
                padding:'9px 12px', cursor:'pointer', borderRadius:8, marginBottom:2, display:'flex', alignItems:'center',
                background: cat === c.id ? 'var(--surface-brand-subtle)' : 'transparent',
                color: cat === c.id ? 'var(--text-brand)' : 'var(--proto-ink)', fontWeight: cat === c.id ? 600 : 500, fontSize:13,
              }}>
                <span style={{ flex:1 }}>{c.label}</span>
                <span className="px-small">{c.n}</span>
              </div>
            ))}
          </div>
          {/* cards */}
          <div style={{ flex:1, overflow:'auto', padding:18 }}>
            <div style={{ display:'flex', alignItems:'center', marginBottom:14 }}>
              <div className="px-h2" style={{ flex:1, textTransform:'capitalize' }}>{cats.find(c=>c.id===cat)?.label}</div>
              <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={() => toast('New template')}>+ New</div>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14 }}>
              {list.map((t, i) => (
                <div key={i} className="px-box" style={{ padding:14, cursor:'pointer' }} onClick={() => toast(`Editing ${t.n}`)}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
                    <div className="px-h3" style={{ flex:1 }}>{t.n}</div>
                    <Pill color={t.tag === 'primary' ? PROTO.green : 'var(--proto-ink3)'}>{t.tag}</Pill>
                  </div>
                  <div className="px-photo" style={{ height:70 }} />
                  <div className="px-small" style={{ marginTop:8 }}>Used 12× · last 2d ago · reply rate 31%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

function SettingsBlock({ title, rows }) {
  return (
    <div>
      <div className="px-label">{title}</div>
      <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1px solid var(--proto-rule-soft)' }}>
            <span className="px-small">{k}</span><span style={{ fontSize:13, fontWeight:600 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { IntakeScreen, SettingsScreen, OAuthSetupScreen, TemplatesScreen });
