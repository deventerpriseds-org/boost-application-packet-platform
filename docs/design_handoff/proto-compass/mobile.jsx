// Mobile screens: Today briefing, Swipe queue, Pipeline, Outreach, Prep, Detail.

/* ─────────────────── Today briefing ─────────────────── */
function MTodayScreen() {
  const { opps, personaInfo, demoInfo, toast } = useApp();
  const m = demoInfo.metrics;
  return (
    <PhoneShell title="Tue, May 22 · Morning Briefing" footerActive="today">
      <div style={{ padding:14, display:'flex', flexDirection:'column', gap:12 }}>
        <div className="px-note" style={{ padding:'10px 12px' }}>
          <div style={{ fontWeight:700 }}>{m.hot || demoInfo.swipe_remaining} signals overnight</div>
          <div className="px-small" style={{ textTransform:'none' }}>{demoInfo.blurb}</div>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
          {[
            { l:'Active', v: m.active, p:'/pipeline' },
            { l:'Hot',    v: m.hot, c: PROTO.red, p:'/pipeline' },
            { l:'Reply',  v: m.replyRate },
            { l:'Asset opens', v: m.assetOpens, c:'var(--proto-accent)' },
          ].map((k,i) => (
            <div key={i} className="px-box" style={{ padding:'10px 12px', cursor:'pointer' }} onClick={() => k.p && go(k.p)}>
              <div className="px-label">{k.l}</div>
              <div style={{ fontSize:24, fontWeight:700, color: k.c || 'var(--proto-ink)' }}>{k.v}</div>
            </div>
          ))}
        </div>

        <SectionTitle sub="2 min review">Do these next</SectionTitle>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {opps.slice(0, 4).map((o, i) => (
            <div key={o.id} className="px-box" style={{ padding:10, display:'flex', gap:10, alignItems:'center', cursor:'pointer' }} onClick={() => go(`/opp/${o.id}`)}>
              <div className="px-logo" style={{ width:32, height:32 }}>{o.logo}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700 }}>{o.company}</div>
                <div className="px-small">{['Open prep pack', 'Approve outreach', 'Debrief panel', 'Review follow-up'][i] || 'Review'}</div>
              </div>
              <Pill color={o.urgency === 'Hot' ? PROTO.red : 'var(--proto-accent)'}>{['🔥 hot','due','prep','warm'][i]}</Pill>
            </div>
          ))}
        </div>

        <div className="px-btn px-btn-accent" style={{ alignSelf:'center', padding:'10px 24px', marginTop:8 }} onClick={() => go('/swipe')}>
          Start swipe queue · {demoInfo.swipe_remaining} new →
        </div>
      </div>
    </PhoneShell>
  );
}

/* ─────────────────── Swipe queue ─────────────────── */
function MSwipeScreen() {
  const { opps, moveStage, dismiss, toast, demoInfo, features } = useApp();
  // Show 'discovered' or 'saved' opps in queue
  const queue = React.useMemo(() => {
    const inQueue = opps.filter(o => ['discovered','saved','enriched'].includes(o.stage));
    if (inQueue.length > 0) return inQueue;
    // If demo state doesn't have any, fall back to broader catalog
    return ALL_OPPS.slice(0, demoInfo.swipe_remaining || 5).map(o => ({ ...o, stage: 'discovered' }));
  }, [opps, demoInfo]);

  const [idx, setIdx] = React.useState(0);
  const [drag, setDrag] = React.useState({ x: 0, y: 0, active: false, decision: null });
  const cardRef = React.useRef(null);

  const current = queue[idx];
  const next    = queue[idx + 1];

  const decide = (decision) => {
    if (!current) return;
    if (decision === 'keep')  { moveStage(current.id, 'saved');     toast(`Saved ${current.company} → build packet`); }
    if (decision === 'maybe') { moveStage(current.id, 'enriched');  toast(`${current.company} → Maybe / research`); }
    if (decision === 'pass')  { dismiss(current.id);                toast(`Dismissed ${current.company}`); }
    setDrag({ x: 0, y: 0, active: false, decision: null });
    setIdx(i => i + 1);
  };

  // Real swipe gesture handlers
  const onPointerDown = (e) => {
    if (!features.swipe) return;
    cardRef.current?.setPointerCapture(e.pointerId);
    setDrag({ x: 0, y: 0, active: true, decision: null, startX: e.clientX, startY: e.clientY });
  };
  const onPointerMove = (e) => {
    if (!drag.active) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    let decision = null;
    if (dx > 60) decision = 'keep';
    else if (dx < -60) decision = 'pass';
    else if (dy > 60) decision = 'maybe';
    setDrag(d => ({ ...d, x: dx, y: dy, decision }));
  };
  const onPointerUp = () => {
    if (!drag.active) return;
    const { x, y } = drag;
    if (x > 100)        { decide('keep');  return; }
    if (x < -100)       { decide('pass');  return; }
    if (y > 100)        { decide('maybe'); return; }
    setDrag({ x: 0, y: 0, active: false, decision: null });
  };

  if (!current) {
    return (
      <PhoneShell title="Swipe Queue" footerActive="swipe">
        <div style={{ padding:24, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:14 }}>
          <div style={{ fontSize:48 }}>✓</div>
          <div className="px-h2">Inbox zero</div>
          <div className="px-meta" style={{ textAlign:'center' }}>All opportunities reviewed. New ones arrive overnight.</div>
          <div className="px-btn px-btn-dark" onClick={() => { setIdx(0); }}>Re-run today's queue</div>
          <div className="px-btn px-btn-ghost" onClick={() => go('/pipeline')}>Open pipeline →</div>
        </div>
      </PhoneShell>
    );
  }

  const rotation = drag.x / 14;

  return (
    <PhoneShell title={`Swipe · ${idx + 1} / ${queue.length}`} footerActive="swipe">
      <div style={{ padding:'10px 14px 0', display:'flex', flexDirection:'column', height:'100%', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <Bar value={(idx / queue.length) * 100} color={'var(--proto-accent)'} height={4} />
          <span className="px-small" style={{ minWidth:30, textAlign:'right' }}>{queue.length - idx} left</span>
        </div>

        <div style={{ position:'relative', flex:1, marginTop:8 }}>
          {/* Background card */}
          {next && (
            <SwipeCard o={next} style={{
              position:'absolute', inset:0, transform:'scale(0.96) translateY(8px)', opacity:0.5,
              pointerEvents:'none', zIndex:1,
            }} />
          )}
          {/* Front card */}
          <SwipeCard
            o={current}
            cardRef={cardRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            decision={drag.decision}
            style={{
              position:'absolute', inset:0, zIndex:2,
              transform: drag.active ? `translate(${drag.x}px, ${drag.y}px) rotate(${rotation}deg)` : 'none',
              transition: drag.active ? 'none' : 'transform 220ms ease-out',
              cursor: 'grab',
              touchAction:'none',
            }}
          />
        </div>

        {/* Action buttons */}
        <div style={{ display:'flex', justifyContent:'space-around', padding:'10px 0 6px' }}>
          <ActionBtn label="✕ Dismiss" color={PROTO.red}    onClick={() => decide('pass')} />
          <ActionBtn label="↓ Maybe"   color={PROTO.yellow} onClick={() => decide('maybe')} />
          <ActionBtn label="✓ Keep"    color={PROTO.green}  onClick={() => decide('keep')} />
        </div>
        <div style={{ textAlign:'center', paddingBottom:12 }}>
          <span className="px-link" style={{ fontSize:12 }} onClick={() => { moveStage(current.id, 'saved'); go(`/packet/${current.id}`); }}>Keep &amp; build packet now →</span>
        </div>
      </div>
    </PhoneShell>
  );
}

function ActionBtn({ label, color, onClick }) {
  return <div onClick={onClick} className="px-btn" style={{ padding:'10px 18px', fontSize:14, fontWeight:700, color, borderColor: color, background:'var(--proto-paper)', minWidth:80, justifyContent:'center' }}>{label}</div>;
}

function SwipeCard({ o, decision, cardRef, style, ...handlers }) {
  return (
    <div ref={cardRef} {...handlers}
      className="px-box"
      style={{
        display:'flex', flexDirection:'column', padding:14, gap:10, userSelect:'none',
        boxShadow:'4px 4px 0 rgba(0,0,0,.08)', background:'var(--proto-paper)',
        ...style,
      }}>
      {/* Decision overlay */}
      {decision === 'keep'  && <CardOverlay tilt={-12} label="KEEP"  color={PROTO.green} pos="left" />}
      {decision === 'pass'  && <CardOverlay tilt={12}  label="PASS"  color={PROTO.red} pos="right" />}
      {decision === 'maybe' && <CardOverlay tilt={0}   label="MAYBE" color={PROTO.yellow} pos="bottom" />}

      <div style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
        <div className="px-logo" style={{ width:44, height:44, fontSize:18 }}>{o.logo}</div>
        <div style={{ flex:1 }}>
          <div className="px-h2">{o.company}</div>
          <div className="px-meta">{o.loc}</div>
        </div>
        <MatchScore n={o.match} size={40} />
      </div>

      <div className="px-divider" />

      <div style={{ fontSize:14, fontWeight:700 }}>{o.role}</div>
      <div className="px-meta">{o.comp}</div>

      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
        <Pill color={o.urgency === 'Hot' ? PROTO.red : o.urgency === 'Warm' ? PROTO.yellow : 'var(--proto-ink3)'}>{o.urgency}</Pill>
        <Pill color={PROTO.purple}>{o.fit}</Pill>
        <Pill color={'var(--proto-ink2)'}>{o.source}</Pill>
      </div>

      <div className="px-divider" />

      <div>
        <div className="px-label">Why surfaced</div>
        <div style={{ fontSize:13, marginTop:4, lineHeight:1.4 }}>{o.why}</div>
      </div>

      {o.hm && o.hm !== '—' && (
        <div className="px-box-soft" style={{ padding:8, fontSize:12 }}>
          <span className="px-small">Hiring manager</span> · <b>{o.hm}</b>
        </div>
      )}

      <div style={{ marginTop:'auto', textAlign:'center' }}>
        <div className="px-small">⟵ swipe to decide ⟶</div>
      </div>
    </div>
  );
}

function CardOverlay({ label, color, tilt, pos }) {
  return (
    <div style={{
      position:'absolute', top: pos === 'bottom' ? 'auto' : 24, bottom: pos === 'bottom' ? 24 : 'auto',
      left: pos === 'left' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      right: pos === 'right' ? 16 : (pos === 'bottom' ? 0 : 'auto'),
      margin: pos === 'bottom' ? '0 auto' : 0, width: pos === 'bottom' ? 'fit-content' : 'auto',
      padding:'8px 16px', border:`3px solid ${color}`, color, fontSize:24, fontWeight:900,
      transform:`rotate(${tilt}deg)`, background:'rgba(255,255,255,.7)', zIndex:5, fontFamily:"'Caveat Brush', cursive",
    }}>{label}</div>
  );
}

/* ─────────────────── Pipeline (mobile) ─────────────────── */
function MPipelineScreen() {
  const { opps } = useApp();
  const [stage, setStage] = React.useState('all');
  const stages = ['all', 'engaged', 'screen', 'r1', 'panel', 'final'];

  const filtered = stage === 'all' ? opps : opps.filter(o => o.stage === stage);

  return (
    <PhoneShell title="Pipeline" footerActive="pipeline">
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'flex', gap:6, overflowX:'auto', paddingBottom:4 }}>
          {stages.map(s => (
            <div key={s} className="px-chip" onClick={() => setStage(s)} style={{ whiteSpace:'nowrap', cursor:'pointer', background: stage === s ? 'var(--proto-ink)' : 'var(--proto-panel)', color: stage === s ? 'var(--proto-paper)' : 'var(--proto-ink2)' }}>
              {s === 'all' ? 'All' : STAGES.find(st => st.id === s)?.label || s}
            </div>
          ))}
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {filtered.map(o => (
            <div key={o.id} className="px-box" style={{ padding:10, display:'flex', gap:10, alignItems:'center', cursor:'pointer' }} onClick={() => go(`/opp/${o.id}`)}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700 }}>{o.company}</div>
                <div className="px-small">{o.role}</div>
                <div style={{ marginTop:4, display:'flex', gap:5 }}>
                  <StageBadge stage={o.stage} />
                  {o.urgency === 'Hot' && <Pill color={PROTO.red}>🔥</Pill>}
                </div>
              </div>
              <MatchScore n={o.match} size={32} />
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-dashed" style={{ padding:24, textAlign:'center', color:'var(--proto-ink3)' }}>No opportunities in {stage}.</div>
          )}
        </div>
      </div>
    </PhoneShell>
  );
}

/* ─────────────────── Outreach (mobile) ─────────────────── */
function MOutreachScreen() {
  const { opps, toast } = useApp();
  return (
    <PhoneShell title="Outreach queue" footerActive="outreach">
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:6 }}>
          {[['Due', 3, PROTO.red], ['Sent', 21, PROTO.green], ['Replies', 6, 'var(--proto-accent)']].map(([l, v, c]) => (
            <div key={l} className="px-box" style={{ padding:8, textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:700, color: c }}>{v}</div>
              <div className="px-small">{l}</div>
            </div>
          ))}
        </div>

        {opps.slice(0, 8).map((o, i) => {
          const states = ['due','sent','draft','scheduled','sent','due','sent','scheduled'];
          const state = states[i];
          const stateColor = state === 'sent' ? PROTO.green : state === 'due' ? PROTO.red : state === 'draft' ? PROTO.yellow : 'var(--proto-accent)';
          return (
            <div key={o.id} className="px-box" style={{ padding:10, display:'flex', gap:10, alignItems:'center' }} onClick={() => state !== 'sent' && go(`/outreach/${o.id}`)}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:13, fontWeight:700 }}>{o.company}</div>
                <div className="px-small">{['HM outreach', 'Follow-up #1', 'Value-add link', 'Follow-up #2', 'Initial', 'Re-engage', 'Thank-you', 'Intro DM'][i]}</div>
              </div>
              <Pill color={stateColor}>{state}</Pill>
            </div>
          );
        })}
      </div>
    </PhoneShell>
  );
}

/* ─────────────────── Mobile interview prep ─────────────────── */
function MInterviewScreen() {
  const { opps } = useApp();
  const upcoming = opps.filter(o => ['screen','r1','panel','final'].includes(o.stage));
  return (
    <PhoneShell title="Interview prep" footerActive="interview">
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        {upcoming.map((o, i) => (
          <div key={o.id} className="px-box" style={{ padding:12, cursor:'pointer' }} onClick={() => go(`/interview/${o.id}/prep`)}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>{o.company}</div>
                <div className="px-small">{['Tomorrow 10:00','Thu 14:30','Fri 09:00','Mon 11:00'][i % 4]}</div>
              </div>
              <StageBadge stage={o.stage} />
            </div>
            <div style={{ marginTop:8, display:'flex', gap:6 }}>
              <Bar value={[60, 85, 40, 70][i % 4]} color={PROTO.green} />
            </div>
            <div className="px-small" style={{ marginTop:4 }}>Prep · {[60,85,40,70][i%4]}% covered · weak spot: AI gov.</div>
          </div>
        ))}
        {upcoming.length === 0 && (
          <div className="px-dashed" style={{ padding:30, textAlign:'center', color:'var(--proto-ink3)' }}>No interviews. Push opps into screening.</div>
        )}
      </div>
    </PhoneShell>
  );
}

/* ─────────────────── Mobile opp detail ─────────────────── */
function MOppDetailScreen() {
  const route = useRoute();
  const { opps, moveStage, toast } = useApp();
  const oppId = parseInt(route.parts[1] || '1', 10);
  const o = opps.find(x => x.id === oppId) || ALL_OPPS.find(x => x.id === oppId);
  if (!o) return <PhoneShell title="Not found">Opp not found</PhoneShell>;

  return (
    <PhoneShell title={o.company}>
      <div style={{ padding:12, display:'flex', flexDirection:'column', gap:12 }}>
        <div className="px-link" style={{ fontSize:12 }} onClick={() => go('/pipeline')}>← Back</div>
        <div style={{ display:'flex', gap:12 }}>
          <div className="px-logo" style={{ width:44, height:44, fontSize:18 }}>{o.logo}</div>
          <div style={{ flex:1 }}>
            <div className="px-h2">{o.role}</div>
            <div className="px-small">{o.comp}</div>
            <div style={{ marginTop:4, display:'flex', gap:5 }}>
              <StageBadge stage={o.stage} />
              {o.urgency === 'Hot' && <Pill color={PROTO.red}>🔥 Hot</Pill>}
            </div>
          </div>
          <MatchScore n={o.match} />
        </div>

        <div className="px-box" style={{ padding:10 }}>
          <div className="px-label">Next action</div>
          <div style={{ fontSize:14, fontWeight:700, marginTop:4 }}>Prep panel · Thu 14:30</div>
          <div className="px-btn px-btn-accent" style={{ fontSize:12, marginTop:8 }} onClick={() => go(`/interview/${o.id}/prep`)}>Open prep pack</div>
        </div>

        <div className="px-box" style={{ padding:10 }}>
          <div className="px-label">Why surfaced</div>
          <div style={{ fontSize:13, marginTop:4 }}>{o.why}</div>
        </div>

        <div className="px-box" style={{ padding:10 }}>
          <div className="px-label">Move to</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5, marginTop:6 }}>
            {['screen','r1','panel','final','offer'].map(s => (
              <div key={s} className="px-chip" style={{ cursor:'pointer', background: o.stage === s ? 'var(--proto-ink)' : 'var(--proto-panel)', color: o.stage === s ? 'var(--proto-paper)' : 'var(--proto-ink2)' }} onClick={() => { moveStage(o.id, s); toast(`→ ${STAGES.find(x => x.id === s)?.label}`); }}>
                {STAGES.find(x => x.id === s)?.label}
              </div>
            ))}
          </div>
        </div>

        <div className="px-btn px-btn-ghost" style={{ fontSize:12, alignSelf:'flex-start' }} onClick={() => go(`/opp/${o.id}`)}>Open desktop view →</div>
      </div>
    </PhoneShell>
  );
}

Object.assign(window, { MTodayScreen, MSwipeScreen, MPipelineScreen, MOutreachScreen, MInterviewScreen, MOppDetailScreen, MPacketScreen, MComposeScreen });

/* ─────────────────── Mobile packet ─────────────────── */
function MPacketScreen() {
  const { opps, getPacket } = useApp();
  const candidates = opps.filter(o => ['saved','enriched','applied','outreach','engaged'].includes(o.stage));
  const statusColor = (s) => ({ building: PROTO.yellow, review:'var(--proto-accent)', changes: PROTO.orange, approved: PROTO.green, sent: PROTO.green }[s] || 'var(--proto-ink3)');
  return (
    <PhoneShell title="Application packets" footerActive="">
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        <div className="px-note" style={{ padding:'8px 10px', textTransform:'none' }}>Approve an opportunity → build a keyword-tailored packet: resume, portfolio, intro video.</div>
        {candidates.map(o => {
          const p = getPacket(o.id);
          const done = Object.values(p.artifacts).filter(a => a === 'approved').length;
          return (
            <div key={o.id} className="px-box" style={{ padding:12, cursor:'pointer' }} onClick={() => go(`/packet/${o.id}`)}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div className="px-logo">{o.logo}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:700 }}>{o.company}</div>
                  <div className="px-small">{o.role}</div>
                </div>
                <Pill color={statusColor(p.status)}>{p.status === 'none' ? 'start' : p.status}</Pill>
              </div>
              {p.status !== 'none' && <div style={{ marginTop:8 }}><Bar value={done/4*100} color={PROTO.green} /><div className="px-small" style={{ marginTop:3 }}>{done}/4 approved · round {p.round}</div></div>}
            </div>
          );
        })}
        {candidates.length === 0 && <div className="px-dashed" style={{ padding:24, textAlign:'center', color:'var(--proto-ink3)' }}>Approve opps from swipe first.</div>}
      </div>
    </PhoneShell>
  );
}

/* ─────────────────── Mobile compose/answers ─────────────────── */
function MComposeScreen() {
  const { opps } = useApp();
  const route = useRoute();
  const isAnswers = route.parts[0] === 'answers';
  return (
    <PhoneShell title={isAnswers ? 'Application answers' : 'Outreach composer'} footerActive="">
      <div style={{ padding:'10px 12px', display:'flex', flexDirection:'column', gap:10 }}>
        <div className="px-note" style={{ padding:'8px 10px', textTransform:'none' }}>{isAnswers ? 'Screenshot an application form → copy-paste answer blocks.' : 'Cold email · LinkedIn connect/DM · InMail · call script, personalized per contact.'}</div>
        {opps.map(o => (
          <div key={o.id} className="px-box" style={{ padding:12, display:'flex', alignItems:'center', gap:10, cursor:'pointer' }} onClick={() => go(`${isAnswers ? '/answers' : '/compose'}/${o.id}`)}>
            <div className="px-logo">{o.logo}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:700 }}>{o.company}</div>
              <div className="px-small">{o.role}</div>
            </div>
            <span className="px-link" style={{ fontSize:12 }}>{isAnswers ? 'Autofill →' : 'Compose →'}</span>
          </div>
        ))}
      </div>
      <div style={{ padding:'0 12px 12px' }}>
        <div className="px-small" style={{ textAlign:'center' }}>Full composer on desktop · <span className="px-link" onClick={() => go('/compose/1')}>open a sample →</span></div>
      </div>
    </PhoneShell>
  );
}
