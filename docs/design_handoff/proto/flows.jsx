// Flow screens: Interview Prep, Live Recording, AI Debrief, Offer.

/* ─────────── Interview list ─────────── */
function InterviewListScreen() {
  const { opps } = useApp();
  const upcoming = opps.filter(o => ['screen','r1','panel','final'].includes(o.stage));
  const times = ['Tomorrow 10:00','Thu 14:30','Fri 09:00','Next Mon 11:00'];

  return (
    <DesktopShell title="Interviews" active="interview">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div className="px-h1" style={{ fontSize:20 }}>Interview pipeline</div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:10 }}>
          {[
            { l:'This week', v: Math.min(upcoming.length, 3), s:'scheduled' },
            { l:'Prep pending', v:'2', s:'within 48h', c: PROTO.yellow },
            { l:'Debriefs missing', v:'1', s:'1d overdue', c: PROTO.red },
            { l:'Mock sessions',  v:'3', s:'last 7d' },
          ].map((k,i) => (
            <div key={i} className="px-box" style={{ padding:'10px 12px' }}>
              <div className="px-label">{k.l}</div>
              <div style={{ fontSize:22, fontWeight:700, color: k.c || 'var(--proto-ink)' }}>{k.v}</div>
              <div className="px-small">{k.s}</div>
            </div>
          ))}
        </div>

        <SectionTitle>Upcoming</SectionTitle>
        <div className="px-box">
          <div style={{ display:'grid', gridTemplateColumns:'60px 1fr 110px 110px 220px', padding:'8px 12px', background:'var(--proto-panel)', borderBottom:'2px solid var(--proto-ink)', fontSize:11, fontWeight:700, textTransform:'uppercase', color:'var(--proto-ink2)' }}>
            <div></div><div>Opportunity</div><div>Stage</div><div>When</div><div>Action</div>
          </div>
          {upcoming.length === 0 ? (
            <div className="px-dashed" style={{ padding:30, margin:14, textAlign:'center', color:'var(--proto-ink3)' }}>
              No interviews scheduled. Move opportunities into Screening to schedule.
            </div>
          ) : upcoming.map((o, i) => (
            <div key={o.id} style={{ display:'grid', gridTemplateColumns:'60px 1fr 110px 110px 220px', padding:'10px 12px', borderBottom: i < upcoming.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', alignItems:'center' }}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ cursor:'pointer' }} onClick={() => go(`/opp/${o.id}`)}>
                <div style={{ fontWeight:700 }}>{o.company}</div>
                <div className="px-small">{o.role}</div>
              </div>
              <div><StageBadge stage={o.stage} /></div>
              <div className="px-small">{times[i % times.length]}</div>
              <div style={{ display:'flex', gap:6 }}>
                <div className="px-btn px-btn-accent" style={{ fontSize:11 }} onClick={() => go(`/interview/${o.id}/prep`)}>Prep</div>
                <div className="px-btn px-btn-ghost" style={{ fontSize:11 }} onClick={() => go(`/interview/${o.id}/record`)}>Record</div>
                <div className="px-btn px-btn-ghost" style={{ fontSize:11 }} onClick={() => go(`/interview/${o.id}/debrief`)}>Debrief</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────── Prep ─────────── */
function InterviewPrepScreen() {
  const route = useRoute();
  const oppId = parseInt(route.parts[1] || '7', 10);
  const o = ALL_OPPS.find(x => x.id === oppId) || ALL_OPPS[0];
  const { toast, features } = useApp();
  const [answered, setAnswered] = React.useState({});

  return (
    <DesktopShell title={`Interview prep — ${o.company}`} active="interview">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ fontSize:12 }}><L to="/interview">← Back to interviews</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:22 }}>{o.company} · panel prep</div>
            <div className="px-meta">Tomorrow 10:00 · 4 interviewers · {o.role}</div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div className="px-btn" style={{ fontSize:12 }} onClick={() => toast('Mock scheduled')}>Schedule mock</div>
            <div className="px-btn px-btn-accent" style={{ fontSize:12 }} onClick={() => go(`/interview/${o.id}/record`)}>Start recording →</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          <div>
            <SectionTitle sub="based on signals + interviewer history">Likely questions · 7</SectionTitle>
            <div className="px-box">
              {INTERVIEW_Q.map((q, i) => {
                const color = q.strength === 'strong' ? PROTO.green : q.strength === 'medium' ? PROTO.yellow : PROTO.red;
                const label = q.strength === 'strong' ? 'Strong' : q.strength === 'medium' ? 'Medium' : q.strength === 'weak' ? 'Weak spot' : 'Rough';
                return (
                  <div key={i} style={{ padding:'10px 12px', borderBottom: i < INTERVIEW_Q.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
                    <div style={{ fontSize:14, fontWeight:600 }}>{i + 1}. {q.q}</div>
                    <div style={{ marginTop:6, display:'flex', gap:6 }}>
                      <Pill color={color}>{label}</Pill>
                      <div className="px-btn px-btn-ghost" style={{ fontSize:11, padding:'2px 8px' }} onClick={() => setAnswered(p => ({ ...p, [i]: !p[i] }))}>{answered[i] ? '▼ Hide answer' : '▶ Suggested answer'}</div>
                    </div>
                    {answered[i] && (
                      <div className="px-box-soft" style={{ padding:10, marginTop:8, background:'var(--proto-panel)', fontSize:13, lineHeight:1.45 }}>
                        <b>Frame:</b> Start with the operating principle, then 1 hard tradeoff you owned, then 1 measurable outcome. End with a question back.<br/><br/>
                        <b>Proof bullets:</b> migration architecture · cost runway · board cadence · 9 senior hires<br/><br/>
                        <b>Question back:</b> "Where would the board push back on this in year one?"
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Interviewers</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { n:'D. Amodei',  r:'CEO · narrative', sig:'Strict on safety framing' },
                  { n:'D. Krueger', r:'COO · ops model', sig:'Looks for board readiness' },
                  { n:'L. Chen',    r:'VP People',       sig:'Already a sponsor — friendly' },
                  { n:'J. Clark',   r:'VP Policy',       sig:'Will probe governance' },
                ].map((p, i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div className="px-ava">{p.n.split(' ').map(x => x[0]).join('')}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:700 }}>{p.n}</div>
                      <div className="px-small">{p.r}</div>
                    </div>
                    <Pill color={'var(--proto-ink2)'}>{p.sig}</Pill>
                  </div>
                ))}
              </div>
            </div>

            {features.ai && (
              <div>
                <SectionTitle>Coverage map</SectionTitle>
                <div className="px-box" style={{ padding:12 }}>
                  {[['Tech depth', 92],['Strategy & vision', 78],['Stakeholder mgmt', 84],['AI governance', 58],['Cost discipline', 88]].map(([k,v]) => (
                    <div key={k} style={{ marginBottom:6 }}>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>{k}</span><b>{v}%</b></div>
                      <Bar value={v} color={v > 75 ? PROTO.green : v > 60 ? PROTO.yellow : PROTO.red} />
                    </div>
                  ))}
                  <div className="px-note" style={{ marginTop:8 }}>Weakest: AI governance. Read playbook excerpt before Thu.</div>
                </div>
              </div>
            )}

            <div>
              <SectionTitle>Materials</SectionTitle>
              <div className="px-box" style={{ padding:10, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                {['22-min prep pack (PDF)','AI Governance playbook excerpt','Mock interview recording — Apr 18','Stakeholder map · live','Cheat-sheet · 1pg'].map(a => (
                  <div key={a} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1.5px solid var(--proto-rule-soft)' }}>
                    <span>{a}</span><span className="px-small">›</span>
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

/* ─────────── Recording ─────────── */
function InterviewRecordScreen() {
  const route = useRoute();
  const oppId = parseInt(route.parts[1] || '7', 10);
  const o = ALL_OPPS.find(x => x.id === oppId) || ALL_OPPS[0];
  const { toast, features } = useApp();
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed]     = React.useState(0);
  const [notes, setNotes]         = React.useState('');

  React.useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;

  const cues = [
    'Lead with operating principle',
    'Reference modernization case study',
    'Pivot to AI governance framing — your weak spot',
    'Ask: where would board push back year 1?',
  ];

  return (
    <DesktopShell title={`Recording · ${o.company}`} active="interview">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, height:'100%' }}>
        <div style={{ fontSize:12 }}><L to={`/interview/${o.id}/prep`}>← Back to prep</L></div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18, flex:1, minHeight:0 }}>
          <div className="px-box" style={{ background:'#0e0e0e', color:'#fff', display:'flex', flexDirection:'column', position:'relative', overflow:'hidden' }}>
            <div className="px-photo" style={{ height:'100%', flex:1, background:'#1a1a1a', borderColor:'#333' }} />
            <div style={{ position:'absolute', top:12, left:12, right:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ width:12, height:12, borderRadius:'50%', background: recording ? PROTO.red : '#666', animation: recording ? 'toast-in 1s infinite' : 'none' }} />
                <span style={{ fontSize:13, fontWeight:700 }}>{recording ? 'REC' : 'READY'}</span>
                <span style={{ fontSize:13, color:'#bbb' }}>{fmt(elapsed)}</span>
              </div>
              <div className="px-chip" style={{ background:'#222', color:'#ccc', borderColor:'#333' }}>{o.company} · panel</div>
            </div>
            <div style={{ position:'absolute', bottom:14, left:0, right:0, display:'flex', justifyContent:'center', gap:8 }}>
              {!recording ? (
                <div className="px-btn px-btn-red" style={{ fontSize:14, padding:'8px 18px' }} onClick={() => setRecording(true)}>● Start recording</div>
              ) : (
                <>
                  <div className="px-btn" style={{ fontSize:13 }} onClick={() => { setRecording(false); }}>⏸ Pause</div>
                  <div className="px-btn px-btn-dark" style={{ fontSize:13 }} onClick={() => { setRecording(false); toast('Saved · generating debrief'); setTimeout(() => go(`/interview/${o.id}/debrief`), 500); }}>■ Stop & debrief</div>
                </>
              )}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:12, minHeight:0 }}>
            {features.ai && (
              <div className="px-box" style={{ padding:12 }}>
                <div className="px-label">Live AI cues {recording && <span style={{ color: PROTO.green }}>● listening</span>}</div>
                <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:8 }}>
                  {cues.map((c, i) => (
                    <div key={i} style={{ padding:'6px 8px', background: i === Math.min(Math.floor(elapsed / 30), cues.length - 1) && recording ? 'var(--proto-yellow-soft)' : 'var(--proto-panel)', border:'1.5px solid var(--proto-rule-soft)', fontSize:12, fontWeight: i === Math.floor(elapsed/30) && recording ? 700 : 400 }}>
                      {i === Math.min(Math.floor(elapsed/30), cues.length - 1) && recording && '▶ '}{c}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-box" style={{ padding:12, flex:1, display:'flex', flexDirection:'column' }}>
              <div className="px-label">Live notes</div>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Type as you go…"
                style={{ flex:1, minHeight:160, marginTop:8, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-paper)', fontFamily:"'Caveat', cursive", fontSize:15, padding:10, resize:'none', color:'var(--proto-ink)' }} />
            </div>

            <div className="px-box" style={{ padding:12, fontSize:12 }}>
              <div className="px-label">Auto-transcribed</div>
              <div style={{ marginTop:8, fontSize:12, color:'var(--proto-ink2)', lineHeight:1.5, minHeight:60 }}>
                {recording ? '… AI is transcribing live · transcript will be available immediately after stop.' : 'Transcript appears here after recording starts.'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────── Debrief ─────────── */
function InterviewDebriefScreen() {
  const route = useRoute();
  const oppId = parseInt(route.parts[1] || '7', 10);
  const o = ALL_OPPS.find(x => x.id === oppId) || ALL_OPPS[0];
  const { features, toast, moveStage } = useApp();

  return (
    <DesktopShell title={`Debrief · ${o.company}`} active="interview">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ fontSize:12 }}><L to="/interview">← Back to interviews</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:22 }}>{o.company} · panel debrief</div>
            <div className="px-meta">Recorded 47:18 · 4 speakers · transcript ready</div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div className="px-btn" style={{ fontSize:12 }}>Export PDF</div>
            <div className="px-btn px-btn-green" style={{ fontSize:12 }} onClick={() => { moveStage(o.id, 'final'); toast('Moved to Final Round'); go(`/opp/${o.id}`); }}>Advance to Final →</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {features.debrief && (
              <div className="px-box" style={{ padding:14, background:'var(--proto-accent-soft)', borderColor:'var(--proto-accent)' }}>
                <div className="px-label" style={{ color:'var(--proto-accent)' }}>AI summary</div>
                <div style={{ fontSize:14, lineHeight:1.5, marginTop:6 }}>
                  Strong on tech depth & modernization narrative. Lost momentum during AI governance question — leaned on theory vs. operating example. CEO probed cost-discipline pivot well. Two follow-ups requested: a 1-pager on governance, and references for cost-led modernization.
                </div>
                <div style={{ display:'flex', gap:6, marginTop:10 }}>
                  <Pill color={PROTO.green}>Likelihood of advance: 78%</Pill>
                  <Pill color={PROTO.yellow}>2 follow-ups owed</Pill>
                </div>
              </div>
            )}

            <div>
              <SectionTitle>By question</SectionTitle>
              <div className="px-box">
                {[
                  { q:'Walk us through your last modernization charter', s:'strong',  note:'Concrete numbers, owned tradeoffs cleanly' },
                  { q:'AI governance framing for our board',            s:'weak',    note:'Hedged · led with theory · weakest moment' },
                  { q:'30/60/90 here',                                  s:'strong',  note:'Crisp, tied to their public infra debt' },
                  { q:'Lost stakeholder you rebuilt',                   s:'medium',  note:'Solid story; could have closed the loop tighter' },
                  { q:'Platform vs product investment ratio',           s:'medium',  note:'Right answer, abstract delivery' },
                  { q:'What would you cut?',                            s:'rough',   note:'Avoided specifics · interviewer pushed back' },
                ].map((r, i) => {
                  const color = r.s === 'strong' ? PROTO.green : r.s === 'medium' ? PROTO.yellow : PROTO.red;
                  return (
                    <div key={i} style={{ padding:'10px 12px', borderBottom: i < 5 ? '1.5px solid var(--proto-rule-soft)' : 'none', display:'flex', gap:10, alignItems:'flex-start' }}>
                      <div style={{ width:8, height:8, marginTop:6, background: color, flexShrink:0 }} />
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600 }}>{r.q}</div>
                        <div className="px-small">{r.note}</div>
                      </div>
                      <Pill color={color}>{r.s}</Pill>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Follow-ups to send</SectionTitle>
              <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:8 }}>
                <div className="px-box-soft" style={{ padding:10 }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>📎 1pg AI governance POV</div>
                  <div className="px-small">Owed to: D. Amodei & J. Clark · target end of day</div>
                  <div className="px-btn px-btn-accent" style={{ fontSize:12, marginTop:8, alignSelf:'flex-start' }} onClick={() => toast('Drafting from playbook')}>Draft from playbook</div>
                </div>
                <div className="px-box-soft" style={{ padding:10 }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>📎 References — cost-led modernization</div>
                  <div className="px-small">Owed to: D. Krueger · target tomorrow AM</div>
                  <div className="px-btn px-btn-accent" style={{ fontSize:12, marginTop:8, alignSelf:'flex-start' }} onClick={() => toast('Draft started')}>Draft references</div>
                </div>
                <div className="px-box-soft" style={{ padding:10 }}>
                  <div style={{ fontWeight:700, fontSize:13 }}>✉ Thank-yous (4)</div>
                  <div className="px-small">Templated · ready to review</div>
                  <div className="px-btn" style={{ fontSize:12, marginTop:8, alignSelf:'flex-start' }} onClick={() => toast('Drafts opened in queue')}>Review thank-yous</div>
                </div>
              </div>
            </div>

            <div>
              <SectionTitle>Update Q-bank</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:6 }}>
                <div>2 new questions captured:</div>
                <div>• "Where would the board push back on this in year one?"</div>
                <div>• "What's your operating ratio between platform and product invest?"</div>
                <div className="px-btn px-btn-ghost" style={{ fontSize:11, marginTop:4, alignSelf:'flex-start' }} onClick={() => toast('Added to Q-bank')}>+ Add to library</div>
              </div>
            </div>

            <div>
              <SectionTitle>Recording</SectionTitle>
              <div className="px-box" style={{ padding:12 }}>
                <div className="px-photo" style={{ height:90 }} />
                <div style={{ display:'flex', justifyContent:'space-between', marginTop:8, fontSize:12 }}>
                  <span>47:18 · 4 speakers</span>
                  <span className="px-link">View transcript ›</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

/* ─────────── Offer / negotiation ─────────── */
function OfferScreen() {
  const route = useRoute();
  const oppId = parseInt(route.parts[1] || '20', 10);
  const o = ALL_OPPS.find(x => x.id === oppId) || ALL_OPPS[0];
  const { toast } = useApp();
  const [base, setBase] = React.useState(475);
  const [equity, setEquity] = React.useState(0.55);
  const [sign, setSign] = React.useState(100);

  return (
    <DesktopShell title={`Offer — ${o.company}`} active="opps">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, maxWidth:1100 }}>
        <div style={{ fontSize:12 }}><L to={`/opp/${o.id}`}>← Back to {o.company}</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:22 }}>Offer negotiation · {o.company}</div>
            <div className="px-meta">First offer received · counter target prepared</div>
          </div>
          <div style={{ display:'flex', gap:6 }}>
            <div className="px-btn px-btn-ghost" style={{ fontSize:12 }} onClick={() => toast('Decline drafted')}>Decline</div>
            <div className="px-btn px-btn-accent" style={{ fontSize:12 }} onClick={() => toast('Counter sent')}>Send counter</div>
            <div className="px-btn px-btn-green" style={{ fontSize:12 }} onClick={() => toast('🎉 Offer accepted')}>Accept offer</div>
          </div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
          <OfferCol title="Their offer" badge="Initial" badgeColor={'var(--proto-ink3)'} base={420} equity={0.35} sign={75} total={420 + 0.35*40000 + 75} />
          <OfferCol title="Your counter" badge="Drafted" badgeColor={'var(--proto-accent)'} base={base} equity={equity} sign={sign} total={base + equity*40000 + sign} editable onBase={setBase} onEquity={setEquity} onSign={setSign} />
          <OfferCol title="Walk-away" badge="Floor" badgeColor={PROTO.red} base={440} equity={0.45} sign={50} total={440 + 0.45*40000 + 50} />
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          <div>
            <SectionTitle>Counter draft</SectionTitle>
            <div className="px-box" style={{ padding:14, fontSize:14, lineHeight:1.6 }}>
              Hi D. Henry — thank you for the offer. After thinking it through, I'd like to propose a counter that better reflects the scope and current market for this seat:<br/><br/>
              · Base: <b>${base}k</b> (vs $420k) — anchored to median for CTO at $1–10B ARR companies<br/>
              · Equity: <b>{equity}%</b> (vs 0.35%) — reflecting the scope of platform modernization charter<br/>
              · Signing: <b>${sign}k</b> (vs $75k) — covers unvested equity I'd leave behind<br/><br/>
              Total: <b>${(base + equity*40000 + sign).toFixed(0)}k</b>. Happy to walk through the comp benchmarks I'm using — Cloudflare, Datadog, Ramp ranges.
              <div style={{ display:'flex', gap:6, marginTop:14 }}>
                <Pill color={PROTO.green}>Tone: collaborative</Pill>
                <Pill color={'var(--proto-accent)'}>Anchored to data</Pill>
                <Pill color={PROTO.yellow}>Leverage: competing offer</Pill>
              </div>
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Comp benchmarks</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12 }}>
                {[['Cloudflare CTO', 480, 0.6],['Datadog VPE', 440, 0.4],['Ramp CTO', 510, 0.7],['Snowflake', 390, 0.3],['Median', 455, 0.5]].map(([c, b, e], i) => (
                  <div key={c} style={{ display:'grid', gridTemplateColumns:'1.4fr 70px 70px', padding:'6px 0', borderBottom: i < 4 ? '1.5px solid var(--proto-rule-soft)' : 'none' }}>
                    <span>{c}</span><span>${b}k</span><span>{e}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <SectionTitle>Leverage</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:6 }}>
                <div>• Cloudflare CTO panel Thu (74% advance)</div>
                <div>• 2 active recruiter pings · Ramp + Coinbase</div>
                <div>• Open OSS work attached to deck (forwarded 3×)</div>
                <Pill color={PROTO.green}>Strong leverage</Pill>
              </div>
            </div>
            <div>
              <SectionTitle>Timing</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>Their decision window</span><b>Jun 3</b></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>Cloudflare timing</span><b>Jun 7–10</b></div>
                <div style={{ display:'flex', justifyContent:'space-between' }}><span>Recommended counter</span><b>By Mon</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

function OfferCol({ title, badge, badgeColor, base, equity, sign, total, editable, onBase, onEquity, onSign }) {
  return (
    <div className="px-box" style={{ padding:14, display:'flex', flexDirection:'column', gap:10 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div className="px-h3">{title}</div>
        <Pill color={badgeColor}>{badge}</Pill>
      </div>
      <Field label="Base" value={`$${base}k`} editable={editable} onChange={v => onBase && onBase(parseInt(v.replace(/\D/g,'')) || 0)} />
      <Field label="Equity" value={`${equity}%`} editable={editable} onChange={v => onEquity && onEquity(parseFloat(v.replace(/[^0-9.]/g,'')) || 0)} />
      <Field label="Signing" value={`$${sign}k`} editable={editable} onChange={v => onSign && onSign(parseInt(v.replace(/\D/g,'')) || 0)} />
      <div className="px-divider" />
      <div style={{ display:'flex', justifyContent:'space-between' }}>
        <span className="px-label">TCY1</span>
        <span style={{ fontSize:18, fontWeight:700 }}>${total.toFixed(0)}k</span>
      </div>
    </div>
  );
}

function Field({ label, value, editable, onChange }) {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
      <span className="px-label">{label}</span>
      {editable ? (
        <input value={value} onChange={e => onChange(e.target.value)} style={{ width:80, textAlign:'right', border:'1.5px solid var(--proto-rule-soft)', padding:'2px 6px', background:'var(--proto-paper)', fontFamily:"'Caveat', cursive", fontSize:14, fontWeight:700, color:'var(--proto-ink)' }} />
      ) : (
        <span style={{ fontWeight:700 }}>{value}</span>
      )}
    </div>
  );
}

Object.assign(window, { InterviewListScreen, InterviewPrepScreen, InterviewRecordScreen, InterviewDebriefScreen, OfferScreen });
