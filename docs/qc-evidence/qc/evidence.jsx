// QC surfaces. Section names follow the prompts: keyword distribution, swaps,
// word & character checks, summary validation, independent review.

const TYPE_LABEL_QC = { resume: 'Resume', compact_resume: 'ATS resume', cover: 'Cover letter', portfolio: 'Portfolio', video: 'Intro video' };

function gateLabel(type) {
  const g = gateFor(type); if (!g) return null;
  const rows = attentionFor(type);
  const hard = rows.filter(a => a.sev === 'fail').length;
  const review = rows.filter(a => a.sev === 'warn' || a.sev === 'open').length;
  const s = SCORES[type];
  const text = [hard ? `${hard} to fix` : null, review ? `${review} to review` : null].filter(Boolean).join(' · ') || 'clear';
  return { g, text: `${s ? s.composite : '—'} · ${text}` };
}

function GateBadge({ type, onClick, small }) {
  const l = gateLabel(type); if (!l) return null;
  return (
    <span onClick={onClick} title="Open QC"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: small ? '2px 8px' : '3px 10px', borderRadius: 999, cursor: 'pointer', fontSize: small ? 10.5 : 11, fontWeight: 700, background: GATE_SOFT[l.g], color: GATE_COLOR[l.g], whiteSpace: 'nowrap' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: GATE_COLOR[l.g] }} />{l.text}
    </span>
  );
}

function Bar({ v, color }) {
  return <span className="px-bar" style={{ display: 'block', marginTop: 4 }}><i style={{ width: Math.max(2, v) + '%', background: color || 'var(--surface-brand-default)' }} /></span>;
}

function ScoreBlock({ type, compact }) {
  const s = SCORES[type]; if (!s) return null;
  const musts = REQUIREMENTS.filter(r => r.kind === 'must_have');
  const lib = libTerms();
  const dims = [
    { l: 'Requirements', v: s.must, sub: `${musts.filter(r => r.coverage === 'covered').length}/${musts.length} must-have` },
    { l: 'Keywords', v: s.kw, sub: `${lib.filter(t => t.status !== 'open').length}/${lib.length} placed` },
    { l: 'Seniority fit', v: s.sen, sub: 'reviewer graded' },
  ];
  const g = gateFor(type);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <div>
          <div className="px-small" style={{ letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-brand)' }}>Match</div>
          <div style={{ fontSize: compact ? 30 : 38, fontWeight: 800, lineHeight: 1.05 }}>{s.composite}</div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, background: GATE_SOFT[g], color: GATE_COLOR[g], textTransform: 'uppercase', letterSpacing: '.4px' }}>{g}</span>
      </div>
      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {dims.map(d => (
          <div key={d.l}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 12, flex: 1 }}>{d.l}</span>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{d.v}</span>
            </div>
            <Bar v={d.v} color={d.v >= 95 ? 'var(--proto-green)' : d.v >= 85 ? 'var(--surface-brand-default)' : 'var(--proto-yellow)'} />
            <div className="px-small" style={{ marginTop: 2 }}>{d.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OpenItems({ compact, onAsk }) {
  if (!OPEN_ITEMS.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {OPEN_ITEMS.map(e => (
        <div key={e.id} className="px-box" style={{ padding: 12, background: 'var(--proto-red-soft)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, flex: 1 }}>{e.title}</span>
            <span className="px-small" style={{ fontWeight: 700 }}>{e.req}</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{e.detail}</div>
          {!compact && (
            <div style={{ display: 'flex', gap: 6, marginTop: 9, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="px-small" style={{ flex: '1 1 160px' }}>{e.ask}</span>
              <button className="px-btn" style={{ fontSize: 11.5 }} onClick={() => onAsk && onAsk(e.ask + ' ')}>Answer</button>
              <button className="px-btn" style={{ fontSize: 11.5 }}>Leave open</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* Two lists, deliberately separate: what is finished, and what still wants a
   decision. Each row lands on the field it concerns. */
function AttentionList({ onOpen, onAsk, only }) {
  const rows = ATTENTION.filter(a => only === 'fixed' ? a.sev === 'fixed' : a.sev !== 'fixed');
  if (!rows.length) return <div className="px-small" style={{ color: 'var(--proto-green)', fontWeight: 700 }}>Nothing open. Every check passes.</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {rows.map(a => (
        <div key={a.id} className="px-box" style={{ padding: '9px 11px', background: SEV_SOFT[a.sev], display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <span className="px-small" style={{ fontWeight: 700, color: SEV_COLOR[a.sev], minWidth: 116, whiteSpace: 'nowrap' }}>{SEV_LABEL[a.sev]}</span>
          <span style={{ flex: 1, minWidth: 180 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</span>
            <span className="px-small" style={{ display: 'block', textTransform: 'none', marginTop: 2 }}>{a.detail}</span>
          </span>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span className="px-small">{TYPE_LABEL_QC[a.asset]}</span>
            {a.sev === 'fixed'
              ? <>
                  <button className="px-btn" style={{ fontSize: 11 }} onClick={() => onAsk && onAsk(`${a.title} — use this instead: `)}>Change it</button>
                  <button className="px-btn" style={{ fontSize: 11 }} onClick={() => onOpen(a.asset, a.sec)}>Review →</button>
                </>
              : <>
                  {a.ask && <button className="px-btn" style={{ fontSize: 11 }} onClick={() => onAsk && onAsk(a.ask + ' ')}>Answer</button>}
                  <button className="px-btn" style={{ fontSize: 11 }} onClick={() => onOpen(a.asset, a.sec)}>{a.sec ? 'Open field →' : 'Open asset →'}</button>
                </>}
          </span>
        </div>
      ))}
    </div>
  );
}

/* Coverage: the posting on the left, keywords on the right */
function CoverageView({ pick, setPick, onAsk }) {
  const lib = libTerms(), model = modelTerms();
  const groups = [
    { k: 'responsibility', l: 'Responsibilities' },
    { k: 'must_have', l: 'Requirements · must have' },
    { k: 'nice_to_have', l: 'Requirements · nice to have' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,300px)', gap: 14, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map(g => {
          const rows = REQUIREMENTS.filter(r => r.kind === g.k);
          const closed = rows.filter(r => r.coverage === 'covered').length;
          return (
            <div key={g.k} className="px-box" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '9px 14px', display: 'flex', alignItems: 'baseline', gap: 8, background: 'var(--proto-panel)', borderBottom: '1px solid var(--proto-rule-soft)' }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{g.l}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: closed === rows.length ? 'var(--proto-green)' : 'var(--proto-red)' }}>{closed}/{rows.length}</span>
              </div>
              {rows.map(r => {
                const on = pick === r.id;
                return (
                  <div key={r.id} onClick={() => setPick(on ? null : r.id)}
                    style={{ padding: '9px 14px', borderBottom: '1px solid var(--proto-rule-soft)', cursor: 'pointer', background: on ? 'var(--proto-accent-soft)' : 'transparent' }}>
                    <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: COV_COLOR[r.coverage] }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.5 }}>{r.verbatim}</span>
                      <span className="px-small" style={{ whiteSpace: 'nowrap' }}>{r.pass ? `pass ${r.pass}` : 'open'}</span>
                    </div>
                    {on && (
                      <div style={{ marginTop: 8, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {Object.keys(ASSET_DOCS).map(t => ASSET_DOCS[t].sections.filter(s => (s.reqs || []).includes(r.id)).map(s => (
                          <div key={t + s.id} style={{ fontSize: 12, lineHeight: 1.5, paddingLeft: 9, borderLeft: '2px solid var(--proto-rule-soft)' }}>
                            <span className="px-small" style={{ fontWeight: 700 }}>{TYPE_LABEL_QC[t]} · {s.slot}</span>
                            <div style={{ marginTop: 2 }}>{s.type === 'select' ? (s.items.filter(i => i.selected && i.req === r.id).map(i => i.text).join(' ') || '—') : s.type === 'list' ? (s.items.filter(i => i.req === r.id).map(i => i.final).join(' · ') || '—') : String(s.after).slice(0, 190) + (String(s.after).length > 190 ? '…' : '')}</div>
                          </div>
                        )))}
                        {r.coverage === 'open' && <OpenItems compact onAsk={onAsk} />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="px-box" style={{ padding: 13 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Keywords</span>
            <div style={{ flex: 1 }} />
            <span className="px-small">{TERM_LIB.id}</span>
          </div>
          <div style={{ marginTop: 8 }}>
            {lib.map(t => (
              <div key={t.id} onClick={() => setPick(t.reqs[0])} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0', borderTop: '1px solid var(--proto-rule-soft)', cursor: 'pointer' }}>
                <span style={{ fontSize: 12, flex: 1, minWidth: 0 }}>{t.term}</span>
                <span className="px-small">{t.freq}×</span>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.status === 'open' ? 'var(--proto-red)' : 'var(--proto-green)' }} />
              </div>
            ))}
          </div>
          <div className="px-small" style={{ marginTop: 9 }}>{model.length} model suggestions not in the library: {model.map(t => t.term).join(', ')}. Not scored.</div>
        </div>
        <OpenItems onAsk={onAsk} />
      </div>
    </div>
  );
}

/* Swaps: what the prompt changed, and the keyword each change covers */
function SwapsView({ pick, onAsk }) {
  const lists = ['Skills 1', 'Skills 2', 'Relevant 1', 'Relevant 2', 'Relevant 3'];
  const [open, setOpen] = React.useState(null);
  const swapped = SKILL_ROWS.filter(r => r.action !== 'kept').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}><b style={{ fontSize: 16 }}>{swapped}</b><span className="px-small">changed</span></span>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}><b style={{ fontSize: 16 }}>{SKILL_ROWS.length - swapped}</b><span className="px-small">unchanged</span></span>
        <span className="px-small">Each change covers a keyword the posting uses. Click a row for the source line.</span>
      </div>
      {lists.map(list => {
        const rows = SKILL_ROWS.filter(r => r.list === list && (!pick || r.req === pick));
        if (!rows.length) return null;
        return (
          <div key={list} className="px-box" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '8px 14px', background: 'var(--proto-panel)', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>{list}</span>
              <span className="px-small">{rows.filter(r => r.action !== 'kept').length} of {rows.length} changed</span>
            </div>
            {rows.map((r, i) => {
              const key = list + i, on = open === key, t = r.term ? termById(r.term) : null;
              return (
                <div key={key} onClick={() => setOpen(on ? null : key)} style={{ padding: '8px 14px', borderBottom: '1px solid var(--proto-rule-soft)', cursor: 'pointer', background: on ? 'var(--proto-accent-soft)' : 'transparent' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 16px minmax(0,1fr) auto', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ fontSize: 12.5, color: 'var(--proto-ink)' }}>{r.orig}</span>
                    <span style={{ fontSize: 11, color: 'var(--proto-ink3)', textAlign: 'center' }}>{r.action === 'kept' ? '' : '→'}</span>
                    <span style={{ fontSize: 12.5, fontWeight: r.action === 'kept' ? 400 : 600 }}>{r.action === 'kept' ? <span className="px-small">unchanged</span> : r.final}</span>
                    {t && <span style={{ fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, background: t.source === 'model' ? 'var(--proto-panel-deep)' : 'var(--proto-accent-soft)', color: t.source === 'model' ? 'var(--proto-ink2)' : 'var(--text-brand)', whiteSpace: 'nowrap' }}>{t.term}</span>}
                  </div>
                  {on && (
                    <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {r.quote && <span style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--proto-ink2)' }}>“{r.quote}” <b style={{ fontStyle: 'normal', fontSize: 11 }}>{r.req}</b></span>}
                      <span className="px-small" style={{ textTransform: 'none' }}>{r.why}</span>
                      <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                        <button className="px-btn" style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); onAsk && onAsk(`Undo the swap of ${r.orig} in ${r.list}.`); }}>Undo this</button>
                        <button className="px-btn" style={{ fontSize: 11 }} onClick={(e) => { e.stopPropagation(); onAsk && onAsk(`Why did you change ${r.orig} in ${r.list}?`); }}>Ask why</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function PassesView({ onAsk }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {PASSES.map(p => (
        <div key={p.n} className="px-box" style={{ padding: 12, borderLeft: `3px solid ${p.halt ? 'var(--proto-red)' : 'var(--proto-green)'}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12.5, fontWeight: 700 }}>Pass {p.n}</span>
            <span className="px-small">{p.at}</span>
            <div style={{ flex: 1 }} />
            <span className="px-small" style={{ fontWeight: 700, color: p.open.length ? 'var(--proto-yellow)' : 'var(--proto-green)' }}>{p.halt ? 'stopped' : `closed ${p.closed.length}`} · {p.open.length} open</span>
          </div>
          <div style={{ fontSize: 12, marginTop: 5, lineHeight: 1.5 }}>{p.note}</div>
        </div>
      ))}
      <OpenItems onAsk={onAsk} />
    </div>
  );
}

function ChecksView({ type }) {
  const rows = CHECKS.filter(c => !type || c.a === type);
  const keys = [...new Set(rows.map(c => c.key))];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {keys.map(k => (
        <div key={k} className="px-box" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '8px 14px', background: 'var(--proto-panel)', borderBottom: '1px solid var(--proto-rule-soft)', fontSize: 12.5, fontWeight: 600 }}>{k}</div>
          {rows.filter(c => c.key === k).map((c, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 14px', borderTop: i ? '1px solid var(--proto-rule-soft)' : 'none', background: c.state === 'fail' ? 'var(--proto-red-soft)' : c.state === 'warn' ? 'var(--proto-yellow-soft)' : 'transparent' }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: c.soft ? 'var(--proto-rule)' : GATE_COLOR[c.state] }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, display: 'block' }}>{c.label}{!type && <span className="px-small"> · {TYPE_LABEL_QC[c.a]}</span>}</span>
                <span className="px-small">{c.observed} · target {c.expected}</span>
                {c.offenders && <span className="px-small" style={{ display: 'block', color: c.state === 'pass' ? 'var(--proto-ink3)' : 'var(--proto-red)', textTransform: 'none' }}>{c.offenders.join(' · ')}</span>}
              </span>
              <span className="px-small" style={{ fontWeight: 700, color: c.soft ? 'var(--proto-ink3)' : GATE_COLOR[c.state] }}>{c.soft ? 'your call' : c.state}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReviewerView({ type }) {
  const types = type ? [type] : ['resume', 'compact_resume', 'cover', 'portfolio'];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {!type && <div className="px-small">A second model with its own prompt, no access to the first model's reasoning. Claims that do not resolve to a posting line are dropped.</div>}
      {types.map(t => {
        const v = VERDICTS[t]; if (!v) return null;
        return (
          <div key={t} className="px-box" style={{ padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>{TYPE_LABEL_QC[t]}</span>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999, background: '#f3e8ff', color: '#6d28d9' }}>{v.grade}</span>
              <span className="px-small">agrees with {v.agree}/{v.total} · blind · {v.promptVersion}</span>
            </div>
            <div style={{ marginTop: 10 }}>
              {v.citations.map((c, i) => (
                <div key={i} style={{ padding: '6px 0', borderTop: '1px solid var(--proto-rule-soft)' }}>
                  <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--proto-ink2)' }}>“{c.quote}” <b style={{ fontStyle: 'normal' }}>{c.req}</b></div>
                  <div style={{ fontSize: 12.5, marginTop: 2 }}>{c.claim}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
              {v.critique.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: c.s === 'fail' ? 'var(--proto-red)' : c.s === 'warn' ? 'var(--proto-yellow)' : 'var(--proto-green)' }} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.5 }}>{c.t}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const QC_TABS = [
  { k: 'coverage', l: 'Coverage' },
  { k: 'swaps', l: 'Swaps' },
  { k: 'passes', l: 'Passes' },
  { k: 'checks', l: 'Checks' },
  { k: 'reviewer', l: 'Review' },
];

function QCStep({ onOpenAsset, onAsk }) {
  const [tab, setTab] = React.useState('coverage');
  const [pick, setPick] = React.useState(null);
  const types = ['resume', 'compact_resume', 'cover', 'portfolio'];
  const musts = REQUIREMENTS.filter(r => r.kind === 'must_have');
  const fails = CHECKS.filter(c => c.state === 'fail').length, warns = CHECKS.filter(c => c.state === 'warn').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="px-box" style={{ padding: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="px-h2">QC</div>
          <div className="px-meta" style={{ marginTop: 2 }}>{musts.filter(r => r.coverage === 'covered').length}/{musts.length} must-haves · {PACKET.passes} passes · {fails} to fix, {warns} to review</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            {types.map(t => (
              <span key={t} onClick={() => onOpenAsset(t)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 8, cursor: 'pointer', boxShadow: 'inset 0 0 0 1px var(--proto-rule-soft)', fontSize: 12 }}>
                {TYPE_LABEL_QC[t]} <GateBadge type={t} small />
              </span>
            ))}
          </div>
        </div>
        <div style={{ width: 220, flexShrink: 0 }}><ScoreBlock type="resume" compact /></div>
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Done for you</span>
          <span className="px-small">{ATTENTION.filter(a => a.sev === 'fixed').length} corrections already applied · change or revert any of them</span>
        </div>
        <AttentionList onOpen={onOpenAsset} onAsk={onAsk} only="fixed" />
      </div>

      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>Needs a decision</span>
          <span className="px-small">{ATTENTION.filter(a => a.sev !== 'fixed').length} left · things the run could not settle on its own</span>
        </div>
        <AttentionList onOpen={onOpenAsset} onAsk={onAsk} />
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto', alignItems: 'center' }}>
        {QC_TABS.map(t => <div key={t.k} onClick={() => setTab(t.k)} className={'px-tab ' + (tab === t.k ? 'px-tab-active' : 'px-tab-idle')}>{t.l}</div>)}
        <div style={{ flex: 1 }} />
        {pick && <span className="px-link" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => setPick(null)}>Clear {pick} ✕</span>}
      </div>

      {tab === 'coverage' && <CoverageView pick={pick} setPick={setPick} onAsk={onAsk} />}
      {tab === 'swaps' && <SwapsView pick={pick} onAsk={onAsk} />}
      {tab === 'passes' && <PassesView onAsk={onAsk} />}
      {tab === 'checks' && <ChecksView type={null} />}
      {tab === 'reviewer' && <ReviewerView type={null} />}
    </div>
  );
}

function QCDrawer({ type, sec, onClose, onAsk }) {
  const [tab, setTab] = React.useState('fields');
  React.useEffect(() => { if (sec) setTab('fields'); }, [sec]);
  if (!type) return null;
  const g = gateFor(type);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,.34)', backdropFilter: 'blur(2px)' }} />
      <div className="px-fade" style={{ position: 'relative', width: 'min(680px, 96vw)', background: 'var(--proto-paper)', borderLeft: '1px solid var(--proto-rule-soft)', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(15,23,42,.30)' }}>
        <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{TYPE_LABEL_QC[type]}</div>
            <div className="px-small">{PACKET.company} · {PACKET.role}</div>
          </div>
          <GateBadge type={type} />
          <span onClick={onClose} className="px-btn" style={{ padding: '2px 8px', cursor: 'pointer' }}>✕</span>
        </div>
        <div style={{ display: 'flex', gap: 2, padding: '0 10px', borderBottom: '1px solid var(--proto-rule-soft)', overflowX: 'auto' }}>
          {[['fields', 'Fields'], ['checks', 'Checks'], ['swaps', 'Swaps'], ['reviewer', 'Review'], ['score', 'Match']].map(([k, l]) => (
            <div key={k} onClick={() => setTab(k)} className={'px-tab ' + (tab === k ? 'px-tab-active' : 'px-tab-idle')} style={{ padding: '8px 10px', fontSize: 12 }}>{l}</div>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {tab === 'fields' && <AssetDocView type={type} onAsk={onAsk} focusSec={sec} />}
          {tab === 'checks' && <ChecksView type={type} />}
          {tab === 'swaps' && <SwapsView pick={null} onAsk={onAsk} />}
          {tab === 'reviewer' && <ReviewerView type={type} />}
          {tab === 'score' && <><ScoreBlock type={type} compact /><OpenItems onAsk={onAsk} /></>}
        </div>
        <div style={{ padding: '10px 14px', borderTop: '1px solid var(--proto-rule-soft)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {(() => {
            const fails = attentionFor(type).filter(a => a.sev === 'fail');
            const warns = attentionFor(type).filter(a => a.sev === 'warn' || a.sev === 'open');
            if (fails.length) return (
              <>
                <button className="px-btn" disabled style={{ whiteSpace: 'nowrap' }}>Approve</button>
                <span className="px-small" style={{ color: 'var(--proto-red)', flex: '1 1 160px', minWidth: 0, textTransform: 'none' }}>
                  <b>{fails.length} to fix</b> · {fails[0].title}{fails.length > 1 ? ` · +${fails.length - 1} more` : ''}
                </span>
              </>
            );
            if (warns.length) return (
              <>
                <button className="px-btn px-btn-green" style={{ whiteSpace: 'nowrap' }}>Approve with note</button>
                <span className="px-small" style={{ flex: '1 1 160px', minWidth: 0, textTransform: 'none' }}>{warns.length} to review · records who approved and why</span>
              </>
            );
            return <button className="px-btn px-btn-green" style={{ whiteSpace: 'nowrap' }}>Approve</button>;
          })()}
          <div style={{ flex: 1 }} />
          <button className="px-btn" style={{ fontSize: 12, whiteSpace: 'nowrap' }} onClick={() => onAsk && onAsk(`In the ${TYPE_LABEL_QC[type].toLowerCase()}: `)}>Ask for a change</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { TYPE_LABEL_QC, GateBadge, ScoreBlock, CoverageView, SwapsView, PassesView, ChecksView, ReviewerView, QCStep, QCDrawer, Bar, gateLabel, OpenItems, AttentionList });
