// Engine screens: Outreach Queue, Outreach Draft, Asset Analytics, Role Library, Playbook Library.

/* ─────────────────────── Outreach queue ─────────────────────── */
function OutreachScreen() {
  const { opps, toast } = useApp();
  const route = useRoute();

  // Build a cadence list from real opps
  const cadenceItems = React.useMemo(() => {
    return opps.slice(0, 8).map((o, i) => {
      const state = ['sent','due','draft','scheduled','sent','pending','scheduled','draft'][i % 8];
      const tasks = [
        'Apply + recruiter outreach', 'First follow-up (recruiter)', 'Hiring manager outreach',
        'Value-add / portfolio link', 'Second recruiter follow-up', 'Re-engage or archive',
        'Send thank-you · panel', 'Send mutual-intro DM',
      ];
      return { id: o.id, day: i * 2, task: tasks[i % tasks.length], who: o.company, state };
    });
  }, [opps]);

  return (
    <DesktopShell title="Outreach · cadence engine" active="outreach">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10 }}>
          {[
            { l:'Scheduled', v:'8', s:'next 7d' },
            { l:'Awaiting approval', v:'3', s:'drafts ready', c: PROTO.yellow },
            { l:'Sent (7d)', v:'21', s:'12 recruiters, 9 HMs' },
            { l:'Opens', v:'14', s:'67% open rate', c: PROTO.green },
            { l:'Replies', v:'6', s:'29% reply', c: 'var(--proto-accent)' },
          ].map((k,i) => (
            <div key={i} className="px-box" style={{ padding:'10px 12px' }}>
              <div className="px-label">{k.l}</div>
              <div style={{ fontSize:22, fontWeight:700, color: k.c || 'var(--proto-ink)' }}>{k.v}</div>
              <div className="px-small">{k.s}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.6fr 1fr', gap:18 }}>
          <div>
            <SectionTitle sub="actions waiting on you, top first">Cadence queue</SectionTitle>
            <div className="px-box" style={{ padding:0 }}>
              <div style={{ display:'grid', gridTemplateColumns:'80px 1fr 130px 110px 130px', padding:'6px 12px', background:'var(--proto-panel)', borderBottom:'2px solid var(--proto-ink)', fontSize:11, fontWeight:700, letterSpacing:.5, textTransform:'uppercase', color:'var(--proto-ink2)' }}>
                <div>Day</div><div>Task</div><div>Opportunity</div><div>State</div><div>Action</div>
              </div>
              {cadenceItems.map((c, i) => {
                const stateColor = c.state === 'sent' ? PROTO.green : c.state === 'due' ? PROTO.red : c.state === 'draft' ? PROTO.yellow : c.state === 'scheduled' ? 'var(--proto-accent)' : 'var(--proto-ink3)';
                return (
                  <div key={i} style={{ display:'grid', gridTemplateColumns:'80px 1fr 130px 110px 130px', padding:'10px 12px', borderBottom: i < cadenceItems.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', alignItems:'center', fontSize:13 }}>
                    <div className="px-small">Day {c.day}</div>
                    <div style={{ fontWeight:600, cursor:'pointer' }} onClick={() => go(`/outreach/${c.id}`)}>{c.task}</div>
                    <div className="px-meta" style={{ cursor:'pointer' }} onClick={() => go(`/opp/${c.id}`)}>{c.who}</div>
                    <div><Pill color={stateColor}>{c.state}</Pill></div>
                    <div>
                      {c.state === 'draft'     && <div className="px-btn px-btn-yellow" style={{ fontSize:11, padding:'3px 9px' }} onClick={() => go(`/outreach/${c.id}`)}>Review</div>}
                      {c.state === 'due'       && <div className="px-btn px-btn-red"    style={{ fontSize:11, padding:'3px 9px' }} onClick={() => go(`/outreach/${c.id}`)}>Send now</div>}
                      {c.state === 'scheduled' && <div className="px-btn px-btn-ghost"  style={{ fontSize:11, padding:'3px 9px' }} onClick={() => toast('Edit cadence')}>Edit</div>}
                      {c.state === 'sent'      && <span className="px-small">✓ sent</span>}
                      {c.state === 'pending'   && <div className="px-btn px-btn-ghost"  style={{ fontSize:11, padding:'3px 9px' }} onClick={() => toast('Decision queued')}>Decide</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Per-opportunity cadence</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:10 }}>
                {opps.slice(0, 5).map(o => (
                  <div key={o.id} style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => go(`/opp/${o.id}/outreach`)}>
                    <div className="px-logo" style={{ width:26, height:26, fontSize:12 }}>{o.logo}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:12, fontWeight:700 }}>{o.company}</div>
                      <div style={{ display:'flex', gap:2, marginTop:3 }}>
                        {[0,1,2,5,8,10,14].map((d, j) => (
                          <div key={j} style={{
                            width:18, height:8,
                            background: j <= (o.id % 5 + 1) ? 'var(--proto-ink)' : 'var(--proto-panel-deep)',
                            border:'1px solid var(--proto-ink)'
                          }} title={`Day ${d}`} />
                        ))}
                      </div>
                    </div>
                    <span className="px-small">d{(o.id * 3) % 14}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Templates in rotation</SectionTitle>
              <div className="px-box" style={{ padding:10, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                {['Recruiter — initial cold (34% reply)','Recruiter — follow-up #1 (22%)','HM — value-add (34%)','HM — mutual intro (51%)','Re-engage stale (12%)'].map(t => (
                  <div key={t} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1.5px solid var(--proto-rule-soft)', cursor:'pointer' }} onClick={() => go('/settings')}>
                    <span>{t}</span><span className="px-small">›</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Cadence health</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:8 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>Sequences on track</span><b>5 / 8</b></div>
                <div style={{ display:'flex', justifyContent:'space-between', color: PROTO.yellow }}><span>Stalling (skip 2+)</span><b>2</b></div>
                <div style={{ display:'flex', justifyContent:'space-between', color: PROTO.red }}><span>Recommend recycle</span><b>1</b></div>
                <Bar value={62} color={'var(--proto-accent)'} />
                <div className="px-small">62% of sends opened in &lt; 24h</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Outreach draft preview ─────────────────────── */
function OutreachDraftScreen() {
  const route = useRoute();
  const oppId = parseInt(route.parts[1] || '0', 10);
  const o = ALL_OPPS.find(x => x.id === oppId) || ALL_OPPS[0];
  const { toast, features } = useApp();
  const [body, setBody] = React.useState(
`${o.hm && o.hm !== '—' ? o.hm.split(' ')[0] : 'Hi'} — saw the ${o.role} role and your recent post on platform reliability scaling pain.

I've spent the last 4 years rebuilding ops at companies in the $1–10B ARR band; my POV on the three places ops debt eats payments velocity is short enough to fit on a page — attached. Happy to walk through it if useful.

— ${PERSONAS.CTO.user.name}`
  );
  const [sent, setSent] = React.useState(false);

  return (
    <DesktopShell title={`Outreach draft — ${o.company}`} active="outreach">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, maxWidth:880 }}>
        <div style={{ fontSize:12 }}><L to="/outreach">← Back to outreach queue</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:20 }}>Draft preview · {o.company} HM</div>
            <div className="px-meta">Day 5 · uses HM template v2 · estimated reply rate 31–37%</div>
          </div>
          <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go(`/opp/${o.id}`)}>View opportunity →</div>
        </div>

        <div className="px-box" style={{ padding:14 }}>
          <div className="px-small">To: {o.hm && o.hm !== '—' ? `${o.hm.toLowerCase().replace(' ','.')}.${o.company.toLowerCase().replace(/[^a-z]/g,'')}@email.com` : `hiring@${o.company.toLowerCase().replace(/[^a-z]/g,'')}.com`}</div>
          <div className="px-small">Subj: Thoughts on platform ops at {o.company}</div>
          <div className="px-divider" style={{ margin:'8px 0' }} />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            style={{
              width:'100%', minHeight:200, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-paper)',
              fontFamily:"'Caveat', cursive", fontSize:15, padding:10, color:'var(--proto-ink)', resize:'vertical',
            }}
          />
          <div style={{ display:'flex', gap:6, marginTop:10, alignItems:'center' }}>
            {features.ai && <Pill color={'var(--proto-accent)'}>Template: HM · value-add</Pill>}
            {features.ai && <Pill color={PROTO.green}>Est. reply 34%</Pill>}
            <Pill color={'var(--proto-ink2)'}>Attached: 1pg POV</Pill>
            <div style={{ flex:1 }} />
            {!sent && (
              <>
                <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => toast('Snoozed 24h')}>Snooze</div>
                <div className="px-btn" style={{ fontSize:12 }} onClick={() => toast('Saved as draft')}>Save draft</div>
                <div className="px-btn px-btn-green" style={{ fontSize:12 }} onClick={() => { setSent(true); toast(`Sent to ${o.company} ✓`); }}>Approve & send</div>
              </>
            )}
            {sent && (
              <>
                <Pill color={PROTO.green}>✓ Sent · just now</Pill>
                <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => go('/outreach')}>Back to queue</div>
              </>
            )}
          </div>
        </div>

        {/* Variations */}
        {features.ai && (
          <div>
            <SectionTitle sub="3 variants generated · pick or remix">AI variations</SectionTitle>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:10 }}>
              {[
                { label:'Concise · POV-led',  copy:'Skip the intro, lead with a sharp 2-sentence POV on infra debt, attach 1pg.' },
                { label:'Mutual-intro warm',  copy:'Mention a shared connection (Adam Pisoni) at the top, soften the ask.' },
                { label:'Story · case-study', copy:'Open with a story from your last modernization, attach a case study.' },
              ].map((v, i) => (
                <div key={i} className="px-box-soft" style={{ padding:10, cursor:'pointer' }} onClick={() => { setBody(v.copy + '\n\n' + body); toast(`Variant ${v.label} merged in`); }}>
                  <div className="px-label">Variant {String.fromCharCode(65 + i)}</div>
                  <div style={{ fontSize:13, fontWeight:700, marginTop:2 }}>{v.label}</div>
                  <div className="px-meta" style={{ marginTop:4 }}>{v.copy}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Asset analytics ─────────────────────── */
function AssetsScreen() {
  return (
    <DesktopShell title="Asset analytics" active="assets">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10 }}>
          {[
            { l:'Assets', v:'27', s:'in library' },
            { l:'Opens (7d)', v:'47', s:'across 8 ppl', c: 'var(--proto-accent)' },
            { l:'Avg view time', v:'3:42', s:'+22s vs prior' },
            { l:'Forwards', v:'8', s:'highest-signal', c: PROTO.green },
            { l:'Stale assets', v:'4', s:'>21d no opens', c: 'var(--proto-ink3)' },
          ].map((k,i) => (
            <div key={i} className="px-box" style={{ padding:'10px 12px' }}>
              <div className="px-label">{k.l}</div>
              <div style={{ fontSize:22, fontWeight:700, color: k.c || 'var(--proto-ink)' }}>{k.v}</div>
              <div className="px-small">{k.s}</div>
            </div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          <div>
            <SectionTitle>Library performance</SectionTitle>
            <div className="px-box">
              <div style={{ display:'grid', gridTemplateColumns:'2.5fr 1fr 70px 70px 70px 70px 80px', padding:'6px 12px', background:'var(--proto-panel)', borderBottom:'2px solid var(--proto-ink)', fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:.5, color:'var(--proto-ink2)' }}>
                <div>Asset</div><div>Type</div><div>Opens</div><div>Views</div><div>Dur</div><div>Fwd</div><div>Last</div>
              </div>
              {ASSETS_X.map((a, i) => (
                <div key={i} style={{ display:'grid', gridTemplateColumns:'2.5fr 1fr 70px 70px 70px 70px 80px', padding:'10px 12px', borderBottom: i < ASSETS_X.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', alignItems:'center', fontSize:13 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div className="px-photo" style={{ width:26, height:26 }} />
                    <span style={{ fontWeight:600 }}>{a.name}</span>
                  </div>
                  <div><Pill color={'var(--proto-ink2)'}>{a.type}</Pill></div>
                  <div style={{ fontWeight:700 }}>{a.opens}</div>
                  <div>{a.views}</div>
                  <div>{a.dur}</div>
                  <div>{a.forwards > 0 ? <span style={{ color: PROTO.green, fontWeight:700 }}>{a.forwards}↗</span> : '—'}</div>
                  <div className="px-small">{a.lastView}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Most-viewed slides</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                {[
                  { slide: 'Cover · "Operating a board-ready AI org"', v: 86 },
                  { slide: 'Slide 4 · Operating model diagram', v: 72 },
                  { slide: 'Slide 7 · 30/60/90 outline', v: 64 },
                  { slide: 'Slide 11 · Cost vs reliability tradeoffs', v: 41 },
                  { slide: 'Slide 14 · References + case studies', v: 22 },
                ].map((r, i) => (
                  <div key={i}>
                    <div style={{ display:'flex', justifyContent:'space-between' }}><span>{r.slide}</span><b>{r.v}%</b></div>
                    <Bar value={r.v} color={'var(--proto-accent)'} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Recent opens</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                {[
                  { who:'Cloudflare · M. Prince', asset:'AI Trans. deck', t:'24m ago · 2nd visit', c: PROTO.red },
                  { who:'Stripe recruiter',       asset:'CTO resume v3.2', t:'1h ago',            c: 'var(--proto-accent)' },
                  { who:'Anthropic · D. Henry',   asset:'30/60/90 — CF',   t:'3h ago · forwarded', c: PROTO.green },
                  { who:'Anonymous viewer',       asset:'Exec intro vid',  t:'Yest',              c: 'var(--proto-ink3)' },
                  { who:'Datadog recruiter',      asset:'Resume — Infra',  t:'2d',                c: 'var(--proto-ink3)' },
                ].map((r, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', borderBottom: i < 4 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
                    <div style={{ width:6, height:6, borderRadius:'50%', background: r.c }} />
                    <div style={{ flex:1 }}>
                      <div>{r.who}</div>
                      <div className="px-small">{r.asset} · {r.t}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Role library ─────────────────────── */
function RolesScreen() {
  const route = useRoute();
  const detail = route.parts[1];
  if (detail) return <RoleDetailScreen roleId={detail} />;

  const ROLES = [
    { id: 'cto',  name: 'CTO',                            use: 4, updated: 'Updated 3d ago' },
    { id: 'cpo',  name: 'CPO',                            use: 1, updated: 'Updated 1w ago' },
    { id: 'vpe',  name: 'VP Engineering',                 use: 3, updated: 'Updated 2d ago' },
    { id: 'vpp',  name: 'VP Product',                     use: 2, updated: 'Updated 5d ago' },
    { id: 'vpai', name: 'VP AI Transformation',           use: 2, updated: 'Updated today' },
    { id: 'digi', name: 'Digital Transformation Exec',    use: 1, updated: 'Updated 2w ago' },
    { id: 'ops',  name: 'Enterprise Operations Leader',   use: 1, updated: 'Updated 1w ago' },
    { id: 'pmo',  name: 'PMO / Agile Transformation',     use: 0, updated: 'Draft' },
  ];

  return (
    <DesktopShell title="Master role profiles" active="roles">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:20 }}>Master role library</div>
            <div className="px-meta">8 baselines · the engine tailors each opportunity from one of these</div>
          </div>
          <div className="px-btn px-btn-dark" style={{ fontSize:12 }}>+ New role</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
          {ROLES.map(r => (
            <div key={r.id} className="px-box" style={{ padding:14, cursor:'pointer', display:'flex', flexDirection:'column', gap:6 }} onClick={() => go(`/roles/${r.id}`)}>
              <div className="px-photo" style={{ height:56 }} />
              <div className="px-h3">{r.name}</div>
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                <Pill color={r.use > 0 ? 'var(--proto-accent)' : 'var(--proto-ink3)'}>{r.use > 0 ? `used in ${r.use}` : 'unused'}</Pill>
                <span className="px-small">{r.updated}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

function RoleDetailScreen({ roleId }) {
  const ROLE_NAMES = { cto:'CTO', vpe:'VP Engineering', vpp:'VP Product', vpai:'VP AI Transformation', cpo:'CPO', digi:'Digital Transformation Exec', ops:'Enterprise Operations Leader', pmo:'PMO / Agile' };
  const name = ROLE_NAMES[roleId] || roleId.toUpperCase();

  return (
    <DesktopShell title={`Role baseline — ${name}`} active="roles">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, maxWidth:1100 }}>
        <div style={{ fontSize:12 }}><L to="/roles">← Back to library</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:22 }}>{name}</div>
            <div className="px-meta">used by 4 active opps · updated 3d ago</div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div className="px-btn px-btn-ghost" style={{ fontSize:12 }}>Duplicate</div>
            <div className="px-btn px-btn-dark" style={{ fontSize:12 }}>Edit baseline</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:18 }}>
          <div className="px-box" style={{ padding:14 }}>
            <div className="px-label">Narrative</div>
            <div style={{ marginTop:6, fontSize:14, lineHeight:1.5 }}>
              Modernization-minded {name} who's spent the last 4 years rebuilding platform infrastructure at companies in the $1–10B ARR band. Operator-led; equally comfortable with the board narrative and the on-call rotation. AI-platform first, cost-conscious, multi-region by default.
            </div>
            <div className="px-divider" style={{ margin:'10px 0' }} />
            <div className="px-label">Key wins (used as proof)</div>
            <ul style={{ margin:'6px 0 0 18px', fontSize:13, lineHeight:1.6 }}>
              <li>Modernized control plane → 99.95 → 99.99 reliability in 14 mo</li>
              <li>Cut infra spend 22% while doubling AI inference traffic</li>
              <li>Hired 9 senior platform leads; built board ops cadence</li>
              <li>Open-source: 2 platform tools, 1.2k stars combined</li>
            </ul>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div className="px-box" style={{ padding:14 }}>
              <div className="px-label">Linked assets · auto-tailored from this</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                {['CTO Resume — Infra v3.2','AI Transformation Portfolio Deck','30/60/90 — master','Modernization case study','Platform cost POV — 1pg','Intro video — 60s'].map(a => (
                  <div key={a} style={{ display:'flex', justifyContent:'space-between', fontSize:13, padding:'4px 0', borderBottom:'1.5px solid var(--proto-rule-soft)' }}>
                    <span>{a}</span><span className="px-small">›</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-box" style={{ padding:14 }}>
              <div className="px-label">Playbooks linked</div>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                {['30/60/90','Annual Operating Cycle','AI Governance','Engineering Modernization','Cost Optimization'].map(p => (
                  <Pill key={p} color={'var(--proto-accent)'}>{p}</Pill>
                ))}
              </div>
            </div>
            <div className="px-box" style={{ padding:14 }}>
              <div className="px-label">Compensation reference</div>
              <div style={{ fontSize:18, fontWeight:700, marginTop:4 }}>$420–520k base + 0.4–0.7% eq</div>
              <Bar value={70} color={PROTO.green} />
              <div className="px-small" style={{ marginTop:6 }}>median target $475k · 12 reference points</div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────────────────── Playbooks ─────────────────────── */
function PlaybooksScreen() {
  const { toast } = useApp();
  const tags = ['All','Onboarding','Operating','Strategy','AI / Risk','Influence','Tech','People','Finance','Risk'];
  const [tag, setTag] = React.useState('All');
  const filtered = tag === 'All' ? PLAYBOOKS_X : PLAYBOOKS_X.filter(p => p.tag === tag);

  return (
    <DesktopShell title="Playbook library" active="playbooks">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:20 }}>Playbook library</div>
            <div className="px-meta">{PLAYBOOKS_X.length} playbooks · the engine attaches the right one per opportunity</div>
          </div>
          <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={() => toast('Drafting new playbook')}>+ New playbook</div>
        </div>

        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {tags.map(t => (
            <div key={t} className="px-chip" style={{ cursor:'pointer', background: tag === t ? 'var(--proto-ink)' : 'var(--proto-panel)', color: tag === t ? 'var(--proto-paper)' : 'var(--proto-ink2)' }} onClick={() => setTag(t)}>{t}</div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12 }}>
          {filtered.map(p => (
            <div key={p.id} className="px-box" style={{ padding:12, cursor:'pointer' }} onClick={() => toast(`Opening ${p.name}`)}>
              <div className="px-photo" style={{ height:60 }} />
              <div className="px-h3" style={{ marginTop:8 }}>{p.name}</div>
              <div style={{ display:'flex', gap:6, marginTop:6, alignItems:'center' }}>
                <Pill color={'var(--proto-ink2)'}>{p.tag}</Pill>
                <span className="px-small">{p.pages}p</span>
              </div>
              <div className="px-small" style={{ marginTop:6 }}>{p.uses > 0 ? `used in ${p.uses} opps` : 'not yet attached'}</div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

Object.assign(window, { OutreachScreen, OutreachDraftScreen, AssetsScreen, RolesScreen, PlaybooksScreen });
