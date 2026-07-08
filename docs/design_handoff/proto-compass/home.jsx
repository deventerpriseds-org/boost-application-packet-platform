// Desktop screens: Today, Opportunities list, Pipeline, Command Center.

/* ─────────────────────── Today (home) ─────────────────────── */

// Bin an opportunity into a monitored-role family (mirrors the intake design)
function roleFamily(o) {
  const r = o.role.toLowerCase();
  if (r.includes('cto')) return 'CTO Roles';
  if (r.includes('ai')) return 'VP AI Transformation';
  if (r.includes('vp engineering')) return 'VP Engineering';
  if (r.includes('product')) return 'VP Product';
  if (r.includes('head') || r.includes('digital')) return 'Head of Digital';
  if (r.includes('engineering')) return 'VP Engineering';
  return 'Other roles';
}
const ROLE_DOT = {
  'CTO Roles': 'var(--surface-brand-default)',
  'VP Engineering': 'var(--surface-success-default)',
  'VP Product': 'var(--proto-purple)',
  'VP AI Transformation': 'var(--proto-orange)',
  'Head of Digital': 'var(--surface-error-default)',
  'Other roles': 'var(--proto-ink3)',
};

function InboxScrubHero() {
  const { opps, toast, demoInfo } = useApp();
  // "New overnight" = surfaced today, still awaiting triage (discovered/saved/enriched)
  const fresh = opps.filter(o => (o.sourceDate || '').toLowerCase().includes('today') || ['discovered','saved','enriched'].includes(o.stage));
  const bins = React.useMemo(() => {
    const map = {};
    fresh.forEach(o => { const f = roleFamily(o); map[f] = (map[f] || 0) + 1; });
    return Object.entries(map).sort((a,b) => b[1]-a[1]);
  }, [opps]);
  const total = fresh.length;
  const companies = [...new Set(fresh.slice(0,6).map(o => o.company))];

  return (
    <div className="px-box" style={{ padding:0, overflow:'hidden', borderColor:'var(--surface-brand-default)' }}>
      <div style={{ display:'flex', alignItems:'stretch', flexWrap:'wrap' }}>
        {/* Left accent block */}
        <div style={{ background:'var(--surface-brand-subtle)', padding:'16px 20px', display:'flex', flexDirection:'column', justifyContent:'center', minWidth:210, borderRight:'1px solid var(--proto-rule-soft)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--surface-success-default)', boxShadow:'0 0 0 3px var(--surface-success-subtle)' }} />
            <span className="px-label" style={{ color:'var(--text-brand)' }}>Latest inbox scrub</span>
          </div>
          <div style={{ fontSize:44, fontWeight:700, lineHeight:1, marginTop:8, color:'var(--text-brand)' }}>{total}</div>
          <div className="px-meta" style={{ marginTop:2 }}>new roles found overnight</div>
          <div className="px-small" style={{ marginTop:6 }}>Scanned {demoInfo.blurb.split('·')[0].trim()} · 6:14am</div>
        </div>

        {/* Middle: per-role breakdown */}
        <div style={{ flex:1, padding:'14px 18px', minWidth:280 }}>
          <div className="px-label" style={{ marginBottom:8 }}>Discovered by role</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'6px 20px' }}>
            {bins.map(([fam, n]) => (
              <div key={fam} onClick={() => go('/swipe')} style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', padding:'3px 0' }}>
                <span style={{ width:9, height:9, borderRadius:'50%', background: ROLE_DOT[fam] || 'var(--proto-ink3)', flexShrink:0 }} />
                <span style={{ fontSize:13, fontWeight:600, flex:1 }}>{fam}</span>
                <span className="px-pill" style={{ background:'var(--proto-panel)' }}>{n} new</span>
              </div>
            ))}
          </div>
          <div className="px-small" style={{ marginTop:10 }}>Sources: {companies.slice(0,5).join(' · ')}{companies.length > 5 ? ' …' : ''}</div>
        </div>

        {/* Right: CTA */}
        <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', justifyContent:'center', gap:8, borderLeft:'1px solid var(--proto-rule-soft)', minWidth:180 }}>
          <div className="px-btn px-btn-accent" style={{ justifyContent:'center' }} onClick={() => go('/swipe')}>Review {total} in swipe →</div>
          <div className="px-btn px-btn-ghost" style={{ justifyContent:'center', fontSize:12 }} onClick={() => go('/intake')}>Inbox monitoring</div>
          <div className="px-btn px-btn-ghost" style={{ justifyContent:'center', fontSize:12 }} onClick={() => toast('Re-scanning inbox…')}>↻ Re-scan now</div>
        </div>
      </div>
    </div>
  );
}

function TodayScreen() {
  const { opps, personaInfo, demoInfo, features, toast } = useApp();
  const m = demoInfo.metrics;

  const priorities = React.useMemo(() => {
    // Build priorities from opps + demo state
    const hot      = opps.filter(o => ['final','panel','offer'].includes(o.stage));
    const screens  = opps.filter(o => o.stage === 'screen' || o.stage === 'r1');
    const outreach = opps.filter(o => o.stage === 'outreach' || o.stage === 'engaged');
    const stale    = opps.filter(o => o.urgency === 'Cool');
    const items = [];
    if (hot[0])      items.push({ who: hot[0].company,      t: `${hot[0].stage === 'final' ? 'Final round' : hot[0].stage === 'panel' ? 'Panel' : 'Offer'} — ${hot[0].role.split(',')[0]}`, s: 'Open prep pack · 6 likely Qs · weak: AI governance framing', cta: 'Prep now', c: PROTO.red, go: `/opp/${hot[0].id}` });
    if (outreach[0]) items.push({ who: outreach[0].company, t: 'Hiring manager outreach — draft ready',     s: 'Approve & send · uses HM template v2 · est. 31% reply', cta: 'Review', c: PROTO.yellow, go: `/outreach/${outreach[0].id}` });
    if (screens[0])  items.push({ who: screens[0].company,  t: 'Recorded screening — debrief missing',      s: '12-min recording · AI summary ready', cta: 'Debrief', c: 'var(--proto-accent)', go: `/interview/${screens[0].id}/debrief` });
    if (stale[0])    items.push({ who: stale[0].company,    t: 'Going stale — no response in 7d',           s: 'Try value-add, recycle, or archive', cta: 'Decide', c: 'var(--proto-ink3)', go: `/opp/${stale[0].id}` });
    return items.slice(0, 5);
  }, [opps]);

  return (
    <DesktopShell title={`Today · May 22 · ${demoInfo.label}`} active="home">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:18 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', gap:20 }}>
          <div>
            <div className="px-h1" style={{ fontSize:26 }}>Good morning, {personaInfo.user.name.split(' ')[0]}.</div>
            <div className="px-meta">{priorities.length} priority actions · {m.active} active opportunities · {demoInfo.blurb}</div>
          </div>
          <div className="px-btn px-btn-accent" style={{ padding:'8px 16px' }} onClick={() => go('/opps')}>Review opportunities →</div>
        </div>

        {/* Latest inbox scrub — most immediate attention */}
        <InboxScrubHero />

        {/* KPI strip */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(6, 1fr)', gap:10 }}>
          {[
            { l:'Active',        v: m.active, s:'in pipeline' },
            { l:'Hot',           v: m.hot,    s:'response < 48h', c: PROTO.red },
            { l:'Reply rate',    v: m.replyRate, s:'30d' },
            { l:'Interview rate',v: m.interviewRate, s:'30d' },
            { l:'Days / stage',  v: m.avgDays, s:'avg', c: 'var(--proto-ink2)' },
            { l:'Asset opens',   v: m.assetOpens, s:'7d', c: 'var(--proto-accent)' },
          ].map((k,i) => (
            <div key={i} className="px-box" style={{ padding:'10px 12px' }}>
              <div className="px-label">{k.l}</div>
              <div style={{ fontSize:24, fontWeight:700, color: k.c || 'var(--proto-ink)', lineHeight:1.1 }}>{k.v}</div>
              <div className="px-small">{k.s}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          {/* Left: priority actions */}
          <div>
            <SectionTitle sub="ordered by next-best-action">Do these next</SectionTitle>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {priorities.length === 0 && (
                <div className="px-dashed" style={{ padding:14, textAlign:'center', color:'var(--proto-ink3)' }}>
                  All clear — nothing urgent. Try the <span className="px-link" onClick={() => go('/swipe')}>swipe queue</span> for new opps.
                </div>
              )}
              {priorities.map((a, i) => (
                <div key={i} className="px-box" style={{ padding:'10px 12px', display:'flex', alignItems:'center', gap:12, cursor:'pointer' }} onClick={() => go(a.go)}>
                  <div style={{ width:5, height:36, background:a.c, flexShrink:0 }} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{a.t} <span style={{color:'var(--proto-ink3)', fontWeight:400}}>· {a.who}</span></div>
                    <div className="px-small">{a.s}</div>
                  </div>
                  <div className="px-btn px-btn-dark" style={{ fontSize:12, padding:'4px 10px' }}>{a.cta}</div>
                </div>
              ))}
              <div className="px-btn px-btn-ghost" style={{ alignSelf:'flex-start', fontSize:12 }} onClick={() => toast('Refreshed priorities')}>↻ Refresh</div>
            </div>
          </div>

          {/* Right column */}
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>This week</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { d:'Wed 10:00', t:'Anthropic — Panel (4 interviewers)', tag:'Prep ready', c: PROTO.green, path:'/interview/7/prep' },
                  { d:'Thu 14:30', t:'Cloudflare — Final round',          tag:'Prep due',   c: PROTO.yellow, path:'/interview/1/prep' },
                  { d:'Fri 09:00', t:'Ramp — CTO screening',              tag:'Recorded',   c: 'var(--proto-accent)', path:'/interview/2/record' },
                ].map((e,i) => (
                  <div key={i} onClick={() => go(e.path)} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0', borderBottom: i<2?'1.5px solid var(--proto-rule-soft)':'none', cursor:'pointer' }}>
                    <div style={{ width:68, fontSize:11, color: 'var(--proto-ink3)', fontWeight:700 }}>{e.d}</div>
                    <div style={{ flex:1, fontSize:13 }}>{e.t}</div>
                    <Pill color={e.c}>{e.tag}</Pill>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Engagement signals</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8, fontSize:12 }}>
                <Signal text="👁 Cloudflare CTO opened deck" m="2× · 24m ago" />
                <Signal text="👁 Stripe recruiter viewed resume" m="1× · 1h ago" />
                <Signal text="↗ AI Transformation deck forwarded" m="Anthropic · 3h" />
                <Signal text="↺ Datadog re-visited resume" m="3rd visit · 5h" />
                <div style={{ display:'flex', justifyContent:'space-between', color: PROTO.red }}><span>⚠ Plaid — no opens in 7d</span><span className="px-small">ghosting risk</span></div>
              </div>
            </div>

            <div>
              <SectionTitle>Funnel health</SectionTitle>
              <div className="px-box" style={{ padding:12 }}>
                <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                  {[['Discovered → Saved', 60], ['Saved → Applied', 71], ['Applied → Reply', 31], ['Reply → Interview', 58], ['Interview → Offer', 22]].map(([l,v]) => (
                    <div key={l}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, marginBottom:2 }}><span>{l}</span><b>{v}%</b></div>
                      <Bar value={v} color={'var(--proto-accent)'} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

function Signal({ text, m }) {
  return <div style={{ display:'flex', justifyContent:'space-between' }}><span>{text}</span><span className="px-small">{m}</span></div>;
}

/* ─────────────────────── Opportunities list ─────────────────────── */
function OppsListScreen() {
  const { opps } = useApp();
  const [filter, setFilter] = React.useState('all');
  const [sort, setSort]     = React.useState('match');

  const filtered = opps
    .filter(o => filter === 'all' || (filter === 'hot' && o.urgency === 'Hot') || (filter === 'strategic' && o.fit === 'Strategic') || (filter === 'active' && !['discovered','saved'].includes(o.stage)))
    .sort((a, b) => sort === 'match' ? b.match - a.match : a.company.localeCompare(b.company));

  return (
    <DesktopShell title={`Opportunities · ${opps.length}`} active="opps">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="px-h1" style={{ fontSize:20 }}>All opportunities</div>
          <div className="px-meta">{filtered.length} shown</div>
          <div style={{ flex:1 }} />
          {['all','hot','strategic','active'].map(f => (
            <div key={f} className="px-chip" onClick={() => setFilter(f)} style={{ cursor:'pointer', background: filter === f ? 'var(--proto-ink)' : 'var(--proto-panel)', color: filter === f ? 'var(--proto-paper)' : 'var(--proto-ink2)', borderColor: filter === f ? 'var(--proto-ink)' : 'var(--proto-rule-soft)' }}>{f}</div>
          ))}
          <div style={{ borderLeft:'1.5px solid var(--proto-rule-soft)', height:18 }} />
          <div className="px-chip" onClick={() => setSort(sort === 'match' ? 'name' : 'match')} style={{ cursor:'pointer' }}>Sort: {sort === 'match' ? 'Match ↓' : 'Name A→Z'}</div>
        </div>

        <div className="px-box" style={{ padding:0 }}>
          <div style={{ display:'grid', gridTemplateColumns:'50px 1fr 1.2fr 0.8fr 100px 110px 100px', padding:'6px 12px', background:'var(--proto-panel)', borderBottom:'2px solid var(--proto-ink)', fontSize:11, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:'var(--proto-ink2)' }}>
            <div></div><div>Company</div><div>Role</div><div>Comp</div><div>Match</div><div>Stage</div><div>Urgency</div>
          </div>
          {filtered.map((o, i) => (
            <div key={o.id} onClick={() => go(`/opp/${o.id}`)} style={{ display:'grid', gridTemplateColumns:'50px 1fr 1.2fr 0.8fr 100px 110px 100px', padding:'10px 12px', borderBottom: i < filtered.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', alignItems:'center', cursor:'pointer', fontSize:13 }}>
              <div className="px-logo" style={{ width:32, height:32 }}>{o.logo}</div>
              <div style={{ fontWeight:700 }}>{o.company}</div>
              <div style={{ color:'var(--proto-ink2)' }}>{o.role}</div>
              <div className="px-small" style={{ fontSize:12 }}>{o.comp}</div>
              <div><MatchScore n={o.match} size={28} /></div>
              <div><StageBadge stage={o.stage} /></div>
              <div>
                {o.urgency === 'Hot'  && <Pill color={PROTO.red}>🔥 Hot</Pill>}
                {o.urgency === 'Warm' && <Pill color={PROTO.yellow}>Warm</Pill>}
                {o.urgency === 'Cool' && <Pill color={'var(--proto-ink3)'}>Cool</Pill>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Pipeline (kanban) ─────────────────────── */
function PipelineScreen() {
  const { opps, moveStage, toast } = useApp();
  const [draggingId, setDraggingId] = React.useState(null);
  const [overStage, setOverStage]   = React.useState(null);

  const byStage = React.useMemo(() => {
    const map = {};
    STAGES.forEach(s => map[s.id] = []);
    opps.forEach(o => { if (map[o.stage]) map[o.stage].push(o); });
    return map;
  }, [opps]);

  const onDrop = (stageId) => {
    if (draggingId == null) return;
    moveStage(draggingId, stageId);
    const opp = opps.find(o => o.id === draggingId);
    toast(`${opp?.company} → ${STAGES.find(s => s.id === stageId).label}`);
    setDraggingId(null);
    setOverStage(null);
  };

  const maxCount = Math.max(1, ...STAGES.map(s => byStage[s.id].length));
  const total = opps.length;

  return (
    <DesktopShell title="Pipeline · Q2" active="pipeline">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:12, height:'100%', overflow:'hidden' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div className="px-h2">All opportunities · {total}</div>
          <div className="px-meta">drag cards across stages</div>
          <div style={{ flex:1 }} />
          <div className="px-chip">View: Kanban</div>
          <div className="px-btn px-btn-ghost" style={{ fontSize:12 }}>⇣ Export</div>
          <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={() => go('/swipe')}>+ Add</div>
        </div>

        {/* Funnel viz */}
        <div className="px-box" style={{ padding:12 }}>
          <div className="px-label" style={{ marginBottom:8 }}>Stage funnel · live count</div>
          <div style={{ display:'flex', gap:2, alignItems:'flex-end', height:50 }}>
            {STAGES.map(s => {
              const c = byStage[s.id].length;
              const h = Math.max(8, (c / maxCount) * 50);
              return (
                <div key={s.id} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:3 }}>
                  <div style={{ fontSize:10, fontWeight:700 }}>{c}</div>
                  <div style={{ width:'100%', height:h, background: c > 0 ? 'var(--proto-ink)' : 'var(--proto-panel)', border:'1px solid var(--proto-ink)', transition: 'height 200ms ease' }} />
                </div>
              );
            })}
          </div>
          <div style={{ display:'flex', gap:2, marginTop:6 }}>
            {STAGES.map(s => (
              <div key={s.id} style={{ flex:1, fontSize:9, textAlign:'center', color:'var(--proto-ink3)', lineHeight:1.1 }}>{s.short}</div>
            ))}
          </div>
        </div>

        {/* Kanban — scrollable horizontally */}
        <div style={{ flex:1, overflowX:'auto', display:'flex', gap:0, border:'2px solid var(--proto-ink)' }}>
          {STAGES.map((s, i) => (
            <div
              key={s.id}
              onDragOver={(e) => { e.preventDefault(); setOverStage(s.id); }}
              onDragLeave={() => setOverStage(prev => prev === s.id ? null : prev)}
              onDrop={() => onDrop(s.id)}
              style={{
                minWidth:170, maxWidth:170, borderRight: i < STAGES.length-1 ? '1.5px solid var(--proto-ink)' : 'none',
                display:'flex', flexDirection:'column',
                background: overStage === s.id ? 'var(--proto-accent-soft)' : (i % 2 ? 'var(--proto-paper)' : 'transparent'),
                transition: 'background 120ms ease',
              }}>
              <div style={{ padding:'6px 10px', borderBottom:'1.5px solid var(--proto-ink)', display:'flex', alignItems:'center', gap:6, background:'var(--proto-panel)' }}>
                <span style={{ fontSize:12, fontWeight:700, flex:1 }}>{s.label}</span>
                <span className="px-chip">{byStage[s.id].length}</span>
              </div>
              <div style={{ flex:1, padding:6, display:'flex', flexDirection:'column', gap:6, minHeight:120 }}>
                {byStage[s.id].map(o => (
                  <div key={o.id}
                    draggable
                    onDragStart={() => setDraggingId(o.id)}
                    onClick={() => go(`/opp/${o.id}`)}
                    className="px-box"
                    style={{
                      padding:'6px 8px', cursor:'grab',
                      opacity: draggingId === o.id ? 0.4 : 1,
                      background: 'var(--proto-paper)',
                    }}>
                    <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                      <div className="px-logo" style={{ width:20, height:20, fontSize:11 }}>{o.logo}</div>
                      <div style={{ fontSize:11, fontWeight:700 }}>{o.company}</div>
                    </div>
                    <div style={{ fontSize:10, color:'var(--proto-ink2)', lineHeight:1.2, marginBottom:4 }}>{o.role}</div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <span style={{ fontSize:9, color:'var(--proto-ink3)' }}>{o.fit}</span>
                      <span style={{ fontSize:9, fontWeight:700, color: o.match >= 90 ? PROTO.green : 'var(--proto-accent)' }}>{o.match}</span>
                    </div>
                  </div>
                ))}
                {byStage[s.id].length === 0 && (
                  <div className="px-dashed" style={{ padding:8, textAlign:'center', fontSize:10, color:'var(--proto-ink3)' }}>empty</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Command Center ─────────────────────── */
function CommandCenterScreen() {
  const route = useRoute();
  const { opps, moveStage, toast } = useApp();
  const oppId = parseInt(route.parts[1] || '1', 10);
  const o = opps.find(x => x.id === oppId) || ALL_OPPS.find(x => x.id === oppId) || opps[0];
  const tab = route.parts[2] || 'overview';
  const tabs = ['overview','contacts','resume','outreach','templates','playbooks','interview prep','activity','analytics'];
  const details = OPP_DETAILS[o.id] || OPP_DETAILS[1];

  if (!o) {
    return <DesktopShell title="Not found" active="opps"><div style={{ padding:40 }}>Opportunity not found. <L to="/opps">Back to list</L></div></DesktopShell>;
  }

  const stageIdx = STAGES.findIndex(s => s.id === o.stage);
  const advanceStage = () => {
    if (stageIdx < STAGES.length - 1) {
      const next = STAGES[stageIdx + 1];
      moveStage(o.id, next.id);
      toast(`${o.company} advanced → ${next.label}`);
    }
  };

  return (
    <DesktopShell title={`${o.company} — ${o.role}`} active="opps">
      <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
        {/* Back link */}
        <div style={{ padding:'6px 16px', borderBottom:'1.5px solid var(--proto-rule-soft)', fontSize:12 }}>
          <L to="/opps">← All opportunities</L>
        </div>
        {/* Header */}
        <div style={{ padding:'14px 18px', borderBottom:'2px solid var(--proto-ink)', display:'flex', gap:14, alignItems:'flex-start' }}>
          <div className="px-logo" style={{ width:48, height:48, fontSize:20 }}>{o.logo}</div>
          <div style={{ flex:1 }}>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <div className="px-h1" style={{ fontSize:20 }}>{o.role}</div>
              {o.urgency === 'Hot' && <Pill color={PROTO.red}>🔥 Hot</Pill>}
              <Pill color={PROTO.purple}>{o.fit} fit</Pill>
            </div>
            <div className="px-meta" style={{ marginTop:2 }}>{o.company} · {o.loc} · {o.comp} · sourced from {o.source}</div>
            <div style={{ display:'flex', gap:4, marginTop:8, alignItems:'center', flexWrap:'wrap' }}>
              {STAGES.slice(1, 11).map((s, i) => (
                <React.Fragment key={s.id}>
                  <div onClick={() => { moveStage(o.id, s.id); toast(`${o.company} → ${s.label}`); }} style={{ padding:'2px 8px', fontSize:10, fontWeight:700, cursor:'pointer',
                    background: i <= stageIdx - 1 ? 'var(--proto-ink)' : 'var(--proto-panel)',
                    color: i <= stageIdx - 1 ? 'var(--proto-paper)' : 'var(--proto-ink2)',
                    border:'1.5px solid var(--proto-ink)' }}>{s.label}</div>
                  {i < 9 && <div style={{ flex:'0 0 6px', height:2, background: i < stageIdx - 1 ? 'var(--proto-ink)' : 'var(--proto-rule-soft)' }} />}
                </React.Fragment>
              ))}
              <div className="px-small" style={{ marginLeft:8 }}>currently <b>{STAGES.find(s => s.id === o.stage)?.label}</b></div>
            </div>
          </div>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6 }}>
            <MatchScore n={o.match} />
            <div style={{ display:'flex', gap:6 }}>
              <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go(`/compose/${o.id}`)}>Compose</div>
              <div className="px-btn px-btn-accent" style={{ fontSize:12 }} onClick={() => go(`/packet/${o.id}`)}>Build packet</div>
            </div>
            <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={advanceStage}>Advance stage ›</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', borderBottom:'2px solid var(--proto-ink)', overflowX:'auto', background: 'var(--proto-paper)', flexShrink:0 }}>
          {tabs.map(t => (
            <div key={t} onClick={() => go(`/opp/${o.id}/${t.replace(' ', '-')}`)}
              className={`px-tab ${tab.replace('-',' ') === t ? 'px-tab-active' : 'px-tab-idle'}`}
              style={{ textTransform:'capitalize' }}>
              {t}
            </div>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex:1, overflow:'auto', padding:18 }}>
          {tab === 'overview' && <OverviewTab o={o} details={details} />}
          {tab === 'contacts' && <ContactsTab details={details} />}
          {tab === 'outreach' && <OppOutreachTab o={o} />}
          {tab !== 'overview' && tab !== 'contacts' && tab !== 'outreach' && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--proto-ink3)', fontSize:14 }}>
              <div className="px-dashed" style={{ padding:'40px 60px', textAlign:'center' }}>
                <div className="px-h2" style={{ textTransform:'capitalize' }}>{tab.replace('-',' ')}</div>
                <div className="px-meta">tab content — wireframed separately</div>
                <div style={{ marginTop:14, display:'flex', gap:6, justifyContent:'center' }}>
                  <div className="px-btn px-btn-ghost" onClick={() => go(`/opp/${o.id}/overview`)}>Back to overview</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}

function OverviewTab({ o, details }) {
  const { moveStage, toast, features, getPacket } = useApp();
  const pkt = getPacket(o.id);
  const pktDone = Object.values(pkt.artifacts).filter(a => a === 'approved').length;
  const pktColor = { none:'var(--proto-ink3)', building: PROTO.yellow, review:'var(--proto-accent)', changes: PROTO.orange, approved: PROTO.green, sent: PROTO.green }[pkt.status];
  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {/* Application packet band — the core build workflow */}
        <div className="px-box" style={{ padding:14, borderColor: pktColor }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ flex:1 }}>
              <div className="px-label" style={{ color: pktColor }}>Application packet</div>
              <div className="px-h2" style={{ marginTop:2 }}>{pkt.status === 'none' ? 'Not started' : pkt.status === 'sent' ? 'Sent ✓' : `${pktDone}/4 artifacts approved`}</div>
              <div className="px-meta">Keyword-tailored resume, portfolio & intro video · approval rounds</div>
            </div>
            <div style={{ width:120 }}>
              <Bar value={pkt.status === 'none' ? 0 : pktDone/4*100} color={PROTO.green} />
            </div>
            <div className="px-btn px-btn-accent" onClick={() => go(`/packet/${o.id}`)}>{pkt.status === 'none' ? 'Build packet' : 'Open packet'} →</div>
          </div>
          <div style={{ display:'flex', gap:6, marginTop:10 }}>
            <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go(`/compose/${o.id}`)}>✎ Compose outreach</div>
            <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go(`/answers/${o.id}`)}>⌸ Application answers</div>
          </div>
        </div>
        {features.ai && (
          <div className="px-box" style={{ padding:14, background:'var(--proto-accent-soft)', borderColor: 'var(--proto-accent)' }}>
            <div className="px-label" style={{ color:'var(--proto-accent)' }}>Next best action</div>
            <div className="px-h2" style={{ marginTop:4 }}>{o.stage === 'panel' || o.stage === 'final' ? 'Prep for interview — Thu 14:30' : 'Send follow-up outreach today'}</div>
            <div className="px-meta" style={{ marginTop:2 }}>6 likely questions · weak spot: AI governance framing · 22-min pack ready</div>
            <div style={{ display:'flex', gap:6, marginTop:10 }}>
              <div className="px-btn px-btn-accent" onClick={() => go(`/interview/${o.id}/prep`)}>Open prep pack</div>
              <div className="px-btn" onClick={() => toast('Mock scheduled for tomorrow')}>Schedule mock</div>
              <div className="px-btn px-btn-ghost" onClick={() => toast('Snoozed 24h')}>Snooze</div>
            </div>
          </div>
        )}

        <div>
          <SectionTitle sub="enrichment found likely stakeholders">Stakeholder map</SectionTitle>
          <div className="px-box" style={{ padding:12 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
              {details.stakeholders.map((p, i) => (
                <div key={i} className="px-box-soft" style={{ padding:10, display:'flex', gap:10 }}>
                  <div className="px-ava">{p.n.split(' ').map(x => x[0]).join('').slice(0,2)}</div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700 }}>{p.n}</div>
                    <div className="px-small">{p.r}</div>
                    <div className="px-small" style={{ marginTop:3 }}>⚡ {p.sig}</div>
                  </div>
                  <Pill color={'var(--proto-accent)'}>{p.match}</Pill>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <div>
            <SectionTitle>Company signals</SectionTitle>
            <div className="px-box" style={{ padding:10, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
              {details.signals.map((s, i) => <div key={i}>• {s}</div>)}
            </div>
          </div>
          <div>
            <SectionTitle>Pain hypotheses</SectionTitle>
            <div className="px-box" style={{ padding:10, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
              {details.pain.map((p, i) => <div key={i}>{i + 1}. {p}</div>)}
              <Pill color={PROTO.green}>Talk to: 1, 2, 4 in panel</Pill>
            </div>
          </div>
        </div>

        <div>
          <SectionTitle sub="generated · review & approve">Tailored assets</SectionTitle>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
            {[
              { n:'Resume — Infra v3.2',  s:'tailored from CTO master',           state:'approved', c: PROTO.green },
              { n:'AI Trans. Deck',        s:'7 slides reordered for ' + o.company, state:'review',   c: PROTO.yellow },
              { n:'30/60/90 — ' + o.company, s:'derived from CTO baseline',        state:'draft',    c: 'var(--proto-ink3)' },
              { n:'Recruiter outreach',    s:'follow-up #2 · day 10',              state:'queued',   c: 'var(--proto-accent)' },
              { n:'Intro video script',    s:'90s tailored open',                  state:'draft',    c: 'var(--proto-ink3)' },
              { n:'AI Gov. playbook excerpt', s:'4-pager · attach to thank-you',   state:'review',   c: PROTO.yellow },
            ].map((a, i) => (
              <div key={i} className="px-box-soft" style={{ padding:10, cursor:'pointer' }} onClick={() => go('/assets')}>
                <div className="px-photo" style={{ height:50, marginBottom:8 }} />
                <div style={{ fontSize:12, fontWeight:700, lineHeight:1.2 }}>{a.n}</div>
                <div className="px-small">{a.s}</div>
                <div style={{ marginTop:6 }}><Pill color={a.c}>{a.state}</Pill></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        <div>
          <SectionTitle>Status</SectionTitle>
          <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
            <StatusRow k="Engagement" v={<Pill color={PROTO.green}>High interest</Pill>} sub="deck opened 2× · resume viewed 3×" />
            <StatusRow k="Action"     v={<Pill color={PROTO.yellow}>Prep required</Pill>} sub="panel Thu · 22-min pack ready" />
            <StatusRow k="Confidence" v={<Pill color={PROTO.purple}>{o.fit} fit</Pill>} sub="high probability · executive sponsor warm" />
            <StatusRow k="Urgency"    v={<Pill color={PROTO.red}>{o.urgency}</Pill>} sub="competing offer signal · close window 10d" />
            <StatusRow k="Deadline"   v={<span style={{ fontSize:13, fontWeight:700 }}>Jun 3</span>} sub="decision target communicated by VP People" />
          </div>
        </div>

        <div>
          <SectionTitle>Recent activity</SectionTitle>
          <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8, fontSize:12 }}>
            {[
              { t:'Today 9:14',  e:'M. Prince opened AI Transformation deck',  c: PROTO.green },
              { t:'Today 8:02',  e:'D. Henry replied — confirmed Thu panel',   c: 'var(--proto-accent)' },
              { t:'Yest. 17:40', e:'Resume v3.2 approved & attached',           c: 'var(--proto-ink2)' },
              { t:'Yest. 11:12', e:'Recruiter outreach — follow-up #1 sent',    c: 'var(--proto-ink2)' },
              { t:'Apr 28',      e:'Enriched · 4 stakeholders, 5 signals',      c: 'var(--proto-ink2)' },
              { t:'Apr 28',      e:'Saved from swipe queue (priority)',         c: 'var(--proto-ink2)' },
            ].map((a, i) => (
              <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start' }}>
                <div style={{ width:8, height:8, borderRadius:'50%', background: a.c, marginTop:4, flexShrink:0 }} />
                <div style={{ flex:1 }}>
                  <div>{a.e}</div>
                  <div className="px-small">{a.t}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <SectionTitle>Compensation target</SectionTitle>
          <div className="px-box" style={{ padding:12 }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12 }}>
              <span>Range</span><b>{o.comp}</b>
            </div>
            <div className="px-bar" style={{ height:10, marginBottom:6 }}>
              <i style={{ width:'65%', background: PROTO.green }} />
            </div>
            <div className="px-small">Equity: 0.4–0.7% · target $475k base + 0.55%</div>
            <div style={{ marginTop:8 }}>
              <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go(`/offer/${o.id}`)}>Open negotiation tracker →</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ContactsTab({ details }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:14 }}>
      {details.stakeholders.map((p, i) => (
        <div key={i} className="px-box" style={{ padding:14, display:'flex', gap:12 }}>
          <div className="px-ava" style={{ width:44, height:44, fontSize:16 }}>{p.n.split(' ').map(x => x[0]).join('').slice(0,2)}</div>
          <div style={{ flex:1 }}>
            <div className="px-h3">{p.n}</div>
            <div className="px-small">{p.r}</div>
            <div className="px-divider" style={{ margin:'8px 0' }} />
            <div className="px-meta">⚡ {p.sig}</div>
            <div style={{ display:'flex', gap:6, marginTop:8 }}>
              <div className="px-btn" style={{ fontSize:12 }}>Open LinkedIn</div>
              <div className="px-btn px-btn-dark" style={{ fontSize:12 }}>Draft outreach</div>
            </div>
          </div>
          <Pill color={'var(--proto-accent)'}>{p.match}</Pill>
        </div>
      ))}
    </div>
  );
}

function OppOutreachTab({ o }) {
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
      <SectionTitle sub={`${o.company} cadence · day ${(o.id * 3) % 14}`}>Cadence timeline</SectionTitle>
      <div className="px-box" style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
        {[
          { d: 0,  task:'Apply + send recruiter outreach', state:'sent' },
          { d: 1,  task:'View LinkedIn + connect',          state:'sent' },
          { d: 3,  task:'First follow-up (recruiter)',      state:'sent' },
          { d: 5,  task:'Hiring manager outreach',          state:'due'  },
          { d: 8,  task:'Value-add / portfolio link',       state:'scheduled' },
          { d: 10, task:'Second recruiter follow-up',       state:'scheduled' },
          { d: 14, task:'Pause, recycle, or archive',       state:'pending' },
        ].map((c, i) => (
          <div key={i} style={{ display:'grid', gridTemplateColumns:'60px 1fr 110px 80px', alignItems:'center', gap:10, padding:'6px 0', borderBottom: i < 6 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
            <div className="px-small">Day {c.d}</div>
            <div style={{ fontSize:13 }}>{c.task}</div>
            <Pill color={c.state === 'sent' ? PROTO.green : c.state === 'due' ? PROTO.red : c.state === 'scheduled' ? 'var(--proto-accent)' : 'var(--proto-ink3)'}>{c.state}</Pill>
            <div>{c.state === 'due' && <div className="px-btn px-btn-red" style={{ fontSize:11 }} onClick={() => go(`/outreach/${o.id}`)}>Send</div>}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusRow({ k, v, sub }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', paddingBottom:8, borderBottom:'1.5px solid var(--proto-rule-soft)' }}>
      <div>
        <div className="px-label">{k}</div>
        <div className="px-small" style={{ textTransform:'none' }}>{sub}</div>
      </div>
      <div>{v}</div>
    </div>
  );
}

Object.assign(window, { TodayScreen, OppsListScreen, PipelineScreen, CommandCenterScreen });
