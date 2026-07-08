// Multi-channel Outreach Composer + Application Answers autofill.

/* ═══════════════ Outreach Composer ═══════════════ */
const CHANNELS = [
  { id:'email',    label:'Cold email',        limit: 1200, icon:'✉' },
  { id:'connect',  label:'LinkedIn connect',  limit: 300,  icon:'in' },
  { id:'dm',       label:'LinkedIn DM',       limit: 800,  icon:'in' },
  { id:'inmail',   label:'InMail',            limit: 1000, icon:'in' },
  { id:'call',     label:'Cold-call script',  limit: 700,  icon:'☎' },
  { id:'followup', label:'Follow-up',         limit: 600,  icon:'↻' },
];

const TONES = ['Direct', 'Warm', 'POV-led'];
// Message templates — first is the default used for speed.
const MSG_TEMPLATES = ['Standard', 'Value-add POV', 'Referral intro', 'Re-engage'];

function injectAfterOpener(base, line) {
  const parts = base.split('\n\n');
  if (parts.length <= 1) return line + '\n\n' + base;
  parts.splice(1, 0, line);
  return parts.join('\n\n');
}

function applyTemplate(base, tmpl, o, contact) {
  if (tmpl === 'Value-add POV')  return injectAfterOpener(base, `A quick POV first: the fastest lever at ${o.company} is instrumenting cost before adding capability — I've run exactly that play.`);
  if (tmpl === 'Referral intro') return injectAfterOpener(base, `${o.recruiter && o.recruiter !== '—' ? o.recruiter.split('(')[0].trim() : 'A mutual contact'} suggested I reach out about this directly.`);
  if (tmpl === 'Re-engage')      return injectAfterOpener(base, `Circling back on my earlier note — I still think there's a strong fit worth 20 minutes.`);
  return base; // Standard
}

function draftFor(channel, o, contact, tone, name) {
  const first = contact.n.split(' ')[0];
  const role = o.role.split(',')[0];
  const openers = {
    Direct: `${first} —`,
    Warm: `Hi ${first},`,
    'POV-led': `${first} — a quick point of view before I introduce myself.`,
  };
  const open = openers[tone];
  switch (channel) {
    case 'connect':
      return `${open} I lead platform modernization at scale and follow ${o.company}'s infra work closely. Would value connecting as you build out the ${role} seat.`;
    case 'dm':
      return `${open}\n\nSaw the ${role} search at ${o.company}. I've spent 4 years on exactly the ${o.why.toLowerCase()} problem — happy to share a 1-page POV on where I'd start. Open to a quick call this week?`;
    case 'inmail':
      return `${open}\n\nI'm reaching out about the ${role} role. Short version: I've rebuilt platform + cost at $1–10B ARR companies, and your recent signals (reliability push, AI inference) map to work I've owned end-to-end.\n\nI've attached a one-page POV. Worth 20 minutes?\n\n— ${name}`;
    case 'call':
      return `OPENER\n"Hi ${first}, ${name} — I'll be brief. I lead platform modernization and I'm calling specifically about the ${role} role at ${o.company}."\n\nHOOK\n"I noticed [reliability push / AI inference]. I've solved that exact problem — cut infra spend 22% while doubling traffic."\n\nASK\n"Could we find 20 minutes this week? I'll send a 1-page POV first so it's worth your time."\n\nOBJECTION: 'send info' → "Absolutely — what's the best email? I'll keep it to one page."`;
    case 'followup':
      return `${open} circling back on my note about the ${role} role — I know inboxes are brutal. The 1-page POV is still the fastest way to see fit. Any interest in a short call?`;
    default: // email
      return `Subject: Thoughts on platform ops at ${o.company}\n\n${open}\n\nI'm reaching out about the ${role} role. I've spent the last 4 years on ${o.why.toLowerCase()} at companies in the $1–10B ARR band — my POV on the three places ops debt eats velocity fits on a page (attached).\n\nHappy to walk through it if useful.\n\n— ${name}`;
  }
}

function OutreachComposerScreen() {
  const route = useRoute();
  if (!route.parts[1]) return <DesktopShell title="Composer" active="compose"><ComposerPicker /></DesktopShell>;
  return <ComposerDetail oppId={parseInt(route.parts[1], 10)} />;
}

function ComposerDetail({ oppId }) {
  const { opps, toast, personaInfo, features } = useApp();
  const o = opps.find(x => x.id === oppId) || ALL_OPPS.find(x => x.id === oppId) || opps[0];

  const details = OPP_DETAILS[(o && o.id) || 1] || OPP_DETAILS[1];
  const contacts = details.stakeholders;
  const [channel, setChannel] = React.useState('email');
  const [tone, setTone] = React.useState('Direct');
  const [tmpl, setTmpl] = React.useState('Standard');
  const [contactIdx, setContactIdx] = React.useState(0);
  const contact = contacts[contactIdx];
  const ch = CHANNELS.find(c => c.id === channel);
  const [body, setBody] = React.useState(() => draftFor('email', o || ALL_OPPS[0], contacts[0], 'Direct', personaInfo.user.name));

  if (!o) return <DesktopShell title="Composer" active="compose"><ComposerPicker /></DesktopShell>;

  const regen = (nextCh = channel, nextTone = tone, nextContact = contact, nextTmpl = tmpl) => {
    setBody(applyTemplate(draftFor(nextCh, o, nextContact, nextTone, personaInfo.user.name), nextTmpl, o, nextContact));
  };

  const over = body.length > ch.limit;

  const copy = () => { try { navigator.clipboard?.writeText(body); } catch(e){} toast('Copied to clipboard'); };

  return (
    <DesktopShell title={`Composer — ${o.company}`} active="compose">
      <div style={{ padding:'12px 18px', display:'flex', flexDirection:'column', gap:12 }}>
        <div style={{ fontSize:12 }}><L to="/compose">← All composer</L> · <L to={`/opp/${o.id}`}>{o.company} command center</L></div>

        {/* Channel tabs */}
        <div style={{ display:'flex', gap:0, border:'2px solid var(--proto-ink)', overflow:'hidden', width:'fit-content' }}>
          {CHANNELS.map((c, i) => (
            <div key={c.id} onClick={() => { setChannel(c.id); regen(c.id); }} style={{
              padding:'7px 14px', cursor:'pointer', fontSize:13, fontWeight: channel === c.id ? 700 : 500,
              borderRight: i < CHANNELS.length-1 ? '1.5px solid var(--proto-ink)' : 'none',
              background: channel === c.id ? 'var(--proto-ink)' : 'var(--proto-paper)',
              color: channel === c.id ? 'var(--proto-paper)' : 'var(--proto-ink2)',
            }}>{c.label}</div>
          ))}
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 1fr', gap:18 }}>
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {/* Recipient + tone controls */}
            <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
              <span className="px-label">To</span>
              <div style={{ display:'flex', gap:4 }}>
                {contacts.map((c, i) => (
                  <div key={i} onClick={() => { setContactIdx(i); regen(channel, tone, c); }} className="px-chip" style={{ cursor:'pointer', background: contactIdx === i ? 'var(--proto-ink)' : 'var(--proto-panel)', color: contactIdx === i ? 'var(--proto-paper)' : 'var(--proto-ink2)' }}>{c.n}</div>
                ))}
              </div>
              <div style={{ flex:1 }} />
              <span className="px-label">Tone</span>
              <div style={{ display:'flex', border:'1.5px solid var(--proto-ink)' }}>
                {TONES.map((t, i) => (
                  <div key={t} onClick={() => { setTone(t); regen(channel, t); }} style={{ padding:'3px 10px', fontSize:12, cursor:'pointer', borderRight: i < 2 ? '1.5px solid var(--proto-ink)' : 'none', background: tone === t ? 'var(--proto-accent)' : 'var(--proto-paper)', color: tone === t ? '#fff' : 'var(--proto-ink2)', fontWeight: tone === t ? 700 : 500 }}>{t}</div>
                ))}
              </div>
            </div>

            {/* Template row */}
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <span className="px-label">Template</span>
              <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                {MSG_TEMPLATES.map((t, i) => (
                  <div key={t} onClick={() => { setTmpl(t); regen(channel, tone, contact, t); }} style={{
                    cursor:'pointer', padding:'3px 10px', fontSize:12, borderRadius:99, fontWeight:600,
                    border:`1.5px solid ${tmpl === t ? 'var(--proto-ink)' : 'var(--proto-rule-soft)'}`,
                    background: tmpl === t ? 'var(--proto-ink)' : 'var(--proto-paper)',
                    color: tmpl === t ? 'var(--proto-paper)' : 'var(--proto-ink2)',
                  }}>{t}{i === 0 ? ' · default' : ''}</div>
                ))}
              </div>
            </div>

            {/* Editor */}
            <div className="px-box" style={{ padding:0, display:'flex', flexDirection:'column' }}>
              <div style={{ padding:'6px 10px', borderBottom:'1.5px solid var(--proto-rule-soft)', display:'flex', alignItems:'center', gap:8 }}>
                <span className="px-small">{ch.label} · to {contact.n} ({contact.r})</span>
                <div style={{ flex:1 }} />
                <span className="px-small" style={{ color: over ? PROTO.red : 'var(--proto-ink3)', fontWeight: over ? 700 : 400 }}>{body.length} / {ch.limit}{over ? ' · over limit' : ''}</span>
              </div>
              <textarea value={body} onChange={e => setBody(e.target.value)} style={{ minHeight:280, border:'none', outline:'none', background:'var(--proto-paper)', fontFamily:"'Caveat',cursive", fontSize:15, padding:12, resize:'vertical', color:'var(--proto-ink)', lineHeight:1.5 }} />
            </div>

            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              <div className="px-btn px-btn-ghost" onClick={() => regen()}>↻ Regenerate</div>
              <div className="px-btn" onClick={copy}>⧉ Copy</div>
              <div style={{ flex:1 }} />
              <div className="px-btn px-btn-ghost" onClick={() => toast('Saved to drafts')}>Save draft</div>
              <div className="px-btn px-btn-green" onClick={() => toast(`${ch.label} sent to ${contact.n} ✓`)}>{channel === 'call' ? 'Log call' : 'Send / queue'}</div>
            </div>
          </div>

          {/* Right rail */}
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <SectionTitle>Personalization signals</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:6 }}>
                <div>⚡ {contact.sig}</div>
                <div>• Why surfaced: {o.why}</div>
                <div>• Match to {contact.n}: {contact.match}%</div>
                <div className="px-btn px-btn-ghost" style={{ fontSize:11, marginTop:4, alignSelf:'flex-start' }} onClick={() => { setBody(b => b + `\n\nP.S. ${contact.sig} — that's exactly the kind of problem I'd want to own.`); toast('Signal woven in'); }}>+ Weave into draft</div>
              </div>
            </div>

            {features.ai && (
              <div>
                <SectionTitle sub="tap to swap in">Hooks that convert</SectionTitle>
                <div className="px-box" style={{ padding:12, display:'flex', flexDirection:'column', gap:6, fontSize:12 }}>
                  {['Reliability push → cost angle', 'AI inference scaling story', 'Board-readable operating cadence', 'Open-source proof (1.2k★)'].map(h => (
                    <div key={h} className="px-box-soft" style={{ padding:'6px 8px', cursor:'pointer' }} onClick={() => { setBody(b => `${h}. ` + b); toast('Hook added'); }}>{h}</div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <SectionTitle>Reply-rate benchmark</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12 }}>
                {[['Cold email', 34], ['LinkedIn connect', 51], ['InMail', 28], ['Follow-up', 22]].map(([l, v]) => (
                  <div key={l} style={{ marginBottom:6 }}>
                    <div style={{ display:'flex', justifyContent:'space-between' }}><span>{l}</span><b>{v}%</b></div>
                    <Bar value={v} color={l.toLowerCase().includes(ch.label.split(' ')[0].toLowerCase()) ? PROTO.green : 'var(--proto-accent)'} />
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

function ComposerPicker() {
  const { opps } = useApp();
  return (
    <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
      <div>
        <div className="px-h1" style={{ fontSize:20 }}>Outreach composer</div>
        <div className="px-meta">Draft cold emails, LinkedIn connects & DMs, InMail, and cold-call scripts — personalized per contact, with tone and reply-rate benchmarks.</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {opps.map(o => (
          <div key={o.id} className="px-box" style={{ padding:14, cursor:'pointer' }} onClick={() => go(`/compose/${o.id}`)}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ flex:1 }}>
                <div className="px-h3">{o.company}</div>
                <div className="px-small">{o.role}</div>
              </div>
            </div>
            <div style={{ display:'flex', gap:5, marginTop:10, flexWrap:'wrap' }}>
              {['Cold email','LinkedIn','Call'].map(c => <Pill key={c} color={'var(--proto-ink2)'}>{c}</Pill>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════ Application Answers autofill ═══════════════ */
function AppAnswersScreen() {
  const route = useRoute();
  if (!route.parts[1]) return <DesktopShell title="Application answers" active="answers"><AnswersPicker /></DesktopShell>;
  return <AnswersDetail oppId={parseInt(route.parts[1], 10)} />;
}

function AnswersDetail({ oppId }) {
  const { opps, toast, personaInfo } = useApp();
  const o = opps.find(x => x.id === oppId) || ALL_OPPS.find(x => x.id === oppId) || opps[0];

  const [captured, setCaptured] = React.useState(false);
  const [copied, setCopied] = React.useState({});
  const [style, setStyle] = React.useState('Concise');
  const ANSWER_STYLES = ['Concise', 'Detailed', 'STAR method'];

  const styleWrap = (base, star) => {
    if (style === 'Detailed') return base + ' In practice that meant setting the operating cadence, aligning the exec team, and reporting outcomes to the board every cycle.';
    if (style === 'STAR method') return star || `Situation: ${base} Task: own the outcome. Action: I led the change end-to-end. Result: measurable impact within two quarters.`;
    return base; // Concise (default)
  };

  const answerFor = (q) => {
    if (q.q.includes('authorized')) return 'Yes — I am authorized to work in the US.';
    if (q.q.includes('sponsorship')) return 'No — I do not require visa sponsorship.';
    if (q.q.includes('salary')) return o.comp.replace(' + eq', '') + ' base + equity, negotiable on total package.';
    if (q.q.includes('start date')) return 'Available within 4 weeks of signed offer (standard notice).';
    if (q.q.includes('relocation') || q.q.includes('hybrid')) return `Open to ${o.loc.includes('Remote') ? 'remote and hybrid' : 'hybrid; ' + o.loc.split('/')[0].trim() + ' based'}.`;
    if (q.q.includes('hear about')) return `Referred through the ${o.source} pipeline; long-time follower of ${o.company}'s platform work.`;
    if (q.q.includes('interested')) return styleWrap(`${o.company}'s ${o.role.split(',')[0]} charter maps directly to what I've done for 4 years — ${o.why}. The chance to own that end-to-end is exactly the seat I want.`);
    if (q.q.includes('leadership')) return styleWrap(
      `I led platform modernization at a $1–10B ARR company: rebuilt the control plane to 99.99% reliability, cut infra spend 22% while doubling AI inference traffic, and scaled the org past 120 with a board-readable operating cadence.`,
      `Situation: inherited a platform straining under growth. Task: raise reliability without runaway cost. Action: rebuilt the control plane and instrumented spend. Result: 99.99% reliability, 22% lower spend, org scaled past 120.`
    );
    return styleWrap(`My approach to ${o.role.split(',')[0].toLowerCase()} centers on cost-conscious modernization: stabilize reliability, instrument cost, then invest the savings into AI platform capability — all on a cadence the board can read.`);
  };

  const doCopy = (i, text) => { try { navigator.clipboard?.writeText(text); } catch(e){} setCopied(c => ({ ...c, [i]: true })); toast('Copied answer ' + (i+1)); setTimeout(() => setCopied(c => ({ ...c, [i]: false })), 1500); };
  const copyAll = () => { const all = APP_QUESTIONS.map((q,i) => `${q.q}\n${answerFor(q)}`).join('\n\n'); try { navigator.clipboard?.writeText(all); } catch(e){} toast('All answers copied'); };

  if (!o) return <DesktopShell title="Application answers" active="answers"><AnswersPicker /></DesktopShell>;

  return (
    <DesktopShell title={`Application answers — ${o.company}`} active="answers">
      <div style={{ padding:'12px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div style={{ fontSize:12 }}><L to="/answers">← All applications</L></div>
        <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between' }}>
          <div>
            <div className="px-h1" style={{ fontSize:20 }}>{o.company} · application autofill</div>
            <div className="px-meta">Drop a screenshot of the form → get copy-paste-ready blocks for every field.</div>
          </div>
          {captured && <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={copyAll}>⧉ Copy all answers</div>}
        </div>

        {!captured ? (
          <div className="px-dashed" style={{ padding:40, textAlign:'center', cursor:'pointer' }} onClick={() => { setCaptured(true); toast('Form parsed · 9 questions detected'); }}>
            <div style={{ fontSize:36 }}>⇪</div>
            <div className="px-h3" style={{ marginTop:8 }}>Drop a screenshot or PDF of the application form</div>
            <div className="px-meta" style={{ marginTop:4 }}>…or paste from clipboard. We detect the questions and draft each answer from your profile + the JD.</div>
            <div className="px-btn px-btn-accent" style={{ marginTop:14, display:'inline-flex' }}>Use sample form →</div>
          </div>
        ) : (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 300px', gap:18 }}>
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              <SectionTitle sub="9 fields detected · edit before copying">Detected questions</SectionTitle>
              <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                <span className="px-label">Answer style</span>
                <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                  {ANSWER_STYLES.map((t, i) => (
                    <div key={t} onClick={() => { setStyle(t); toast(`Answer style: ${t}`); }} style={{
                      cursor:'pointer', padding:'3px 10px', fontSize:12, borderRadius:99, fontWeight:600,
                      border:`1.5px solid ${style === t ? 'var(--proto-ink)' : 'var(--proto-rule-soft)'}`,
                      background: style === t ? 'var(--proto-ink)' : 'var(--proto-paper)',
                      color: style === t ? 'var(--proto-paper)' : 'var(--proto-ink2)',
                    }}>{t}{i === 0 ? ' · default' : ''}</div>
                  ))}
                </div>
              </div>
              {APP_QUESTIONS.map((q, i) => {
                const ans = answerFor(q);
                return (
                  <div key={i} className="px-box" style={{ padding:12 }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:8 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:700 }}>{q.q}</div>
                        <div style={{ display:'flex', gap:5, marginTop:3 }}>
                          <Pill color={'var(--proto-ink3)'}>{q.cat}</Pill>
                          <span className="px-small">{ans.length}/{q.limit}</span>
                        </div>
                      </div>
                      <div className="px-btn px-btn-ghost" style={{ fontSize:11, padding:'3px 9px', background: copied[i] ? 'var(--proto-green-soft)' : undefined, borderColor: copied[i] ? PROTO.green : undefined, color: copied[i] ? PROTO.green : undefined }} onClick={() => doCopy(i, ans)}>{copied[i] ? '✓ Copied' : '⧉ Copy'}</div>
                    </div>
                    <AnswerBox initial={ans} short={q.short} />
                  </div>
                );
              })}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <SectionTitle>Captured form</SectionTitle>
                <div className="px-box" style={{ padding:8 }}>
                  <div className="px-photo" style={{ height:150 }} />
                  <div className="px-small" style={{ marginTop:6, textAlign:'center' }}>greenhouse-form.png · 9 fields</div>
                </div>
              </div>
              <div>
                <SectionTitle>Profile source</SectionTitle>
                <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:5 }}>
                  <div>Name · {personaInfo.user.name}</div>
                  <div>Role baseline · {personaInfo.masterRole}</div>
                  <div>Comp target · {o.comp}</div>
                  <div>Location · {o.loc}</div>
                  <div className="px-btn px-btn-ghost" style={{ fontSize:11, marginTop:4, alignSelf:'flex-start' }} onClick={() => go('/settings')}>Edit profile</div>
                </div>
              </div>
              <div className="px-note">Every answer is drafted from your profile and this JD, then editable. Copy field-by-field or grab them all.</div>
            </div>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}

function AnswerBox({ initial, short }) {
  const [v, setV] = React.useState(initial);
  React.useEffect(() => setV(initial), [initial]);
  return (
    <textarea value={v} onChange={e => setV(e.target.value)} style={{ width:'100%', marginTop:8, minHeight: short ? 40 : 76, border:'1.5px solid var(--proto-rule-soft)', background:'var(--proto-panel)', fontFamily:"'Caveat',cursive", fontSize:14, padding:8, resize:'vertical', color:'var(--proto-ink)', lineHeight:1.4 }} />
  );
}

function AnswersPicker() {
  const { opps } = useApp();
  return (
    <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
      <div>
        <div className="px-h1" style={{ fontSize:20 }}>Application answers</div>
        <div className="px-meta">Pick an opportunity, drop a screenshot of its application form, and get copy-paste blocks for every question.</div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
        {opps.map(o => (
          <div key={o.id} className="px-box" style={{ padding:14, cursor:'pointer' }} onClick={() => go(`/answers/${o.id}`)}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div className="px-logo">{o.logo}</div>
              <div style={{ flex:1 }}>
                <div className="px-h3">{o.company}</div>
                <div className="px-small">{o.role}</div>
              </div>
              <span className="px-link" style={{ fontSize:12 }}>Autofill →</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { OutreachComposerScreen, AppAnswersScreen });
