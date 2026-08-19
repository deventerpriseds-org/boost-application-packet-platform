// Asset view: one card per merge field, formatted like the document, with
// provenance in the margin. Selecting a keyword, a requirement or a posting echo
// in the margin highlights it in the text on the left.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Wraps keyword occurrences (yellow) and posting echoes (tan) in one pass.
function Marked({ text, terms, active, echoes, activeEcho }) {
  const labels = React.useMemo(() => (terms || []).map(id => ({ id, label: termById(id)?.term, kind: 'kw' })).filter(t => t.label && t.label.length > 1), [terms]);
  const echoLabels = React.useMemo(() => (echoes || []).map(m => ({ id: m.phrase, label: m.phrase, kind: 'echo' })), [echoes]);
  const all = React.useMemo(() => [...labels, ...echoLabels].sort((a, b) => b.label.length - a.label.length), [labels, echoLabels]);
  const re = React.useMemo(() => all.length ? new RegExp('(' + all.map(l => esc(l.label)).join('|') + ')', 'gi') : null, [all]);
  if (!re) return <>{text}</>;
  return (
    <>{String(text).split(re).map((p, i) => {
      const hit = all.find(l => l.label.toLowerCase() === p.toLowerCase());
      if (!hit) return <React.Fragment key={i}>{p}</React.Fragment>;
      const on = hit.kind === 'kw' ? active === hit.id : (activeEcho || '').toLowerCase() === hit.label.toLowerCase();
      return <mark key={i} className={(hit.kind === 'kw' ? 'kw-mark' : 'echo-mark') + (on ? ' is-on' : '')}>{p}</mark>;
    })}</>
  );
}

function Rule({ rule, text, observed, state }) {
  if (!rule) return null;
  const n = text ? wordCount(text) : null;
  const detail = observed || (rule.includes('word') && n ? `${n} words` : null);
  const color = state === 'warn' ? 'var(--proto-yellow)' : state === 'fail' ? 'var(--proto-red)' : 'var(--proto-ink3)';
  return <span className="px-small" style={{ fontWeight: 600, color }}>{detail ? `${detail} · ${rule}` : rule}</span>;
}

const MATCH_WORD = { exact: 'Exact term', variant: 'Reworded', loose: 'Loose — not scored' };

function KeyChip({ id, active, open, onHover, onLeave, onOpen }) {
  const t = termById(id); if (!t) return null;
  const on = active === id || open === id;
  const loose = t.match === 'loose';
  return (
    <span onMouseEnter={() => onHover(id)} onMouseLeave={onLeave} onClick={() => onOpen(open === id ? null : id)}
      title={`${MATCH_WORD[t.match] || 'unmatched'} · click for options`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
        background: loose && !on ? 'transparent' : 'var(--proto-accent-soft)',
        color: loose && !on ? 'var(--proto-ink3)' : 'var(--text-brand)',
        boxShadow: on ? 'inset 0 0 0 1.5px var(--surface-brand-default)' : loose ? 'inset 0 0 0 1px var(--proto-rule-soft)' : 'none' }}>
      {t.match === 'variant' && <span style={{ fontSize: 9, opacity: .75 }}>≈</span>}
      {t.term}
    </span>
  );
}

// Opened from a keyword chip: where the term came from, and what to do if you
// would rather not claim it.
function KeyDetail({ id, slot, onClose, onAsk }) {
  const t = termById(id); if (!t) return null;
  const swap = SKILL_ROWS.find(r => r.term === id && r.action === 'swapped');
  const [pick, setPick] = React.useState('');
  return (
    <div className="px-box" style={{ padding: 11, marginTop: 9, background: 'var(--proto-panel)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{t.term}</span>
        <span className="px-small" style={{ fontWeight: 700 }}>{MATCH_WORD[t.match] || 'unmatched'}</span>
        <span onClick={onClose} className="px-small" style={{ cursor: 'pointer', fontWeight: 700 }}>✕</span>
      </div>
      <div className="px-small" style={{ textTransform: 'none', marginTop: 5, fontStyle: 'italic' }}>Posting says “{t.postingSays}”</div>
      {t.note && <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 5, color: 'var(--proto-ink2)' }}>{t.note}</div>}
      {swap && <div style={{ fontSize: 11.5, marginTop: 6 }}>Took the place of <b>{swap.orig}</b> in {swap.list}.</div>}
      <div className="px-small" style={{ marginTop: 9, fontWeight: 700 }}>Not comfortable claiming this?</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 5 }}>
        {swap && (
          <button className="px-btn" style={{ fontSize: 11, justifyContent: 'flex-start' }}
            onClick={() => onAsk(`I am not comfortable claiming ${t.term}. Put ${swap.orig} back in ${swap.list} and record the keyword as uncovered rather than met.`)}>
            Put back “{swap.orig}”
          </button>
        )}
        <div style={{ display: 'flex', gap: 5 }}>
          <select className="px-input" value={pick} onChange={e => setPick(e.target.value)} style={{ flex: 1, fontSize: 11, minWidth: 0 }}>
            <option value="">Swap for another skill…</option>
            {SKILL_BANK.filter(s => s !== t.term).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="px-btn" style={{ fontSize: 11 }} disabled={!pick}
            onClick={() => onAsk(`Replace ${t.term} in ${slot} with ${pick}, and tell me which posting line loses its coverage.`)}>Swap</button>
        </div>
        <button className="px-btn" style={{ fontSize: 11, justifyContent: 'flex-start' }}
          onClick={() => onAsk(`Drop ${t.term} entirely and leave the line it covers open. I would rather show a gap than overstate.`)}>Drop it, leave the line open</button>
      </div>
    </div>
  );
}

// Figure echoes are already corrected in the text above. This is the trail:
// what was changed, why, and how to walk it back.
function EchoTrail({ mirrors, onAsk, activeEcho, setActiveEcho, reverted, setReverted, slot }) {
  const [kept, setKept] = React.useState({});
  if (!mirrors || !mirrors.length) return null;
  const figs = mirrors.filter(m => m.kind === 'figure');
  const phrases = mirrors.filter(m => m.kind !== 'figure');
  return (
    <div style={{ marginTop: 9 }}>
      {figs.length > 0 && (
        <>
          <div className="px-label" style={{ marginBottom: 4 }}>Changes made</div>
          {figs.map((m, i) => {
            const undone = !!reverted[m.phrase];
            const on = (activeEcho || '').toLowerCase() === (undone ? m.phrase : m.fix).toLowerCase();
            return (
              <div key={i} onMouseEnter={() => setActiveEcho(undone ? m.phrase : m.fix)} onMouseLeave={() => setActiveEcho(null)}
                style={{ padding: '6px', borderRadius: 5, borderTop: '1px solid var(--proto-rule-soft)', background: on ? 'var(--proto-yellow-soft)' : 'transparent' }}>
                <div className="px-small" style={{ fontWeight: 700, color: undone ? 'var(--proto-red)' : 'var(--proto-green)' }}>{undone ? "Undone · the ad's figure is back" : 'Corrected'}</div>
                <div style={{ fontSize: 11.5, marginTop: 2, lineHeight: 1.45 }}>
                  <s style={{ color: 'var(--proto-ink3)' }}>{m.phrase}</s> → <b>{m.fix}</b>
                </div>
                <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>{m.why} Ad says “{m.posting}”.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <span className="px-link" style={{ fontSize: 11 }} onClick={() => setReverted(r => ({ ...r, [m.phrase]: !r[m.phrase] }))}>{undone ? 'Redo correction' : 'Undo'}</span>
                  <span className="px-link" style={{ fontSize: 11 }} onClick={() => onAsk && onAsk(`In ${slot}, “${m.phrase}” was changed to “${m.fix}”. Use this instead: `)}>Suggest something different</span>
                </div>
              </div>
            );
          })}
        </>
      )}
      {phrases.length > 0 && (
        <>
          <div className="px-label" style={{ margin: '9px 0 4px' }}>Wording kept from the posting</div>
          {phrases.map((m, i) => {
            const on = (activeEcho || '').toLowerCase() === m.phrase.toLowerCase();
            const gone = kept[i] === 'reworded';
            return (
              <div key={i} onMouseEnter={() => setActiveEcho(m.phrase)} onMouseLeave={() => setActiveEcho(null)}
                style={{ padding: '6px', borderRadius: 5, borderTop: '1px solid var(--proto-rule-soft)', background: on ? 'var(--proto-yellow-soft)' : 'transparent' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, minWidth: 0, textDecoration: gone ? 'line-through' : 'none' }}>{m.phrase}</span>
                  <span className="px-small" style={{ fontWeight: 700, color: gone ? 'var(--proto-yellow)' : 'var(--proto-ink2)' }}>{gone ? 'rewording' : 'kept'}</span>
                </div>
                <div className="px-small" style={{ textTransform: 'none', fontStyle: 'italic' }}>{m.why} Ad says “{m.posting}”.</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                  <span className="px-link" style={{ fontSize: 11 }} onClick={() => setKept(s => ({ ...s, [i]: gone ? 'kept' : 'reworded' }))}>{gone ? 'Undo' : 'Reword it'}</span>
                  <span className="px-link" style={{ fontSize: 11 }} onClick={() => onAsk && onAsk(`Reword “${m.phrase}” in ${slot} so it does not echo the posting verbatim.`)}>Ask assistant</span>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// Requirement chip: the id alone means nothing until it is spelled out, so it
// carries its kind and its competency.
function ReqChip({ id, onPick, short, quiet }) {
  const r = reqById(id); if (!r) return null;
  const covered = r.coverage === 'covered';
  const bg = quiet ? 'var(--proto-panel-deep)' : covered ? 'var(--proto-green-soft)' : 'var(--proto-red-soft)';
  const fg = quiet ? 'var(--proto-ink)' : covered ? 'var(--proto-green)' : 'var(--proto-red)';
  return (
    <span onClick={() => onPick && onPick(id)} title={`${KIND_LABEL[r.kind]} · ${r.verbatim}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999, cursor: onPick ? 'pointer' : 'default',
        background: bg, color: fg }}>
      <b style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5 }}>{r.id}</b>
      {!short && <span style={{ fontWeight: 500, color: quiet ? 'var(--proto-ink)' : 'var(--proto-ink2)' }}>{r.competency}</span>}
    </span>
  );
}

function ReqLegend() {
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      {[['M', 'Must-have requirement', REQUIREMENTS.filter(r => r.kind === 'must_have').length],
        ['D', 'Responsibility (what you would do)', REQUIREMENTS.filter(r => r.kind === 'responsibility').length],
        ['N', 'Nice-to-have', REQUIREMENTS.filter(r => r.kind === 'nice_to_have').length]].map(([k, l, n]) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, fontSize: 11, color: 'var(--proto-ink2)' }}>
          <b style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, background: 'var(--proto-panel-deep)', borderRadius: 4, padding: '1px 5px', color: 'var(--proto-ink)' }}>{k}1–{k}{n}</b>{l}
        </span>
      ))}
    </div>
  );
}

// What this one asset proves, in words rather than raw counts.
function assetCoverage(type) {
  const doc = ASSET_DOCS[type]; if (!doc) return null;
  const reqs = new Set(), terms = new Set();
  doc.sections.forEach(s => { (s.reqs || []).forEach(r => reqs.add(r)); (s.terms || []).forEach(t => terms.add(t)); });
  const byKind = (k) => { const all = REQUIREMENTS.filter(r => r.kind === k); return { n: all.filter(r => reqs.has(r.id)).length, d: all.length }; };
  const lib = libTerms();
  return {
    resp: byKind('responsibility'), must: byKind('must_have'), nice: byKind('nice_to_have'),
    kw: { n: lib.filter(t => terms.has(t.id)).length, d: lib.length },
    dyn: doc.sections.filter(s => s.dynamic).length, statics: doc.sections.filter(s => !s.dynamic).length,
    missingMust: REQUIREMENTS.filter(r => r.kind === 'must_have' && !reqs.has(r.id)),
  };
}

function AssetHeader({ type, onPick, onFocus, onAsk }) {
  const c = assetCoverage(type); if (!c) return null;
  const [open, setOpen] = React.useState(false);
  const fails = attentionFor(type).filter(a => a.sev === 'fail');
  const items = attentionFor(type).filter(a => a.sev === 'warn' || a.sev === 'open');
  const calls = attentionFor(type).filter(a => a.sev === 'soft');
  const done = attentionFor(type).filter(a => a.sev === 'fixed');
  const g = gateFor(type);
  const Cell = ({ l, n, d, sub }) => (
    <div style={{ minWidth: 118 }}>
      <div className="px-label">{l}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 }}>
        <b style={{ fontSize: 19, lineHeight: 1, color: n === d ? 'var(--proto-green)' : 'var(--proto-yellow)' }}>{n}</b>
        <span style={{ fontSize: 12, color: 'var(--proto-ink3)' }}>of {d}</span>
      </div>
      <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>{sub}</div>
    </div>
  );
  if (!open) return (
    <div className="px-box" onClick={() => setOpen(true)}
      style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', cursor: 'pointer' }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>What this {ASSET_DOCS[type].label.toLowerCase()} answers</span>
      <span className="px-small">{c.must.n}/{c.must.d} must-haves · {c.kw.n}/{c.kw.d} keywords</span>
      {done.length > 0 && <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-green)' }}>{done.length} corrected</span>}
      {fails.length > 0 && <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-red)' }}>{fails.length} to fix</span>}
      {items.length > 0 && <span className="px-small" style={{ fontWeight: 700, color: SEV_COLOR[items[0].sev] }}>{items.length} to review</span>}
      {calls.length > 0 && <span className="px-small">{calls.length} your call</span>}
      <div style={{ flex: 1 }} />
      <span className="px-link" style={{ fontSize: 11.5 }}>Show ▾</span>
    </div>
  );

  return (
    <div className="px-box" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>What this {ASSET_DOCS[type].label.toLowerCase()} answers</span>
            <div style={{ flex: 1 }} />
            <span className="px-link" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }} onClick={() => setOpen(false)}>Hide ▴</span>
          </div>
          <div className="px-small" style={{ textTransform: 'none', marginTop: 3 }}>
            {c.must.n === c.must.d
              ? 'Every must-have requirement is answered somewhere in this asset.'
              : `${c.missingMust.map(r => r.competency).join(', ')} is not answered here — check the other assets.`}
            {' '}{c.dyn} of {c.dyn + c.statics} blocks were written for this posting; the rest is template text you cannot change from the zap.
          </div>
        </div>
        <Cell l="Must-haves" n={c.must.n} d={c.must.d} sub="answered in this asset" />
        <Cell l="Responsibilities" n={c.resp.n} d={c.resp.d} sub="referenced" />
        <Cell l="Nice-to-haves" n={c.nice.n} d={c.nice.d} sub="referenced" />
        <Cell l="ATS keywords" n={c.kw.n} d={c.kw.d} sub="placed in this asset" />
      </div>
      {fails.concat(items).concat(calls).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {fails.concat(items).concat(calls).map(a => (            <div key={a.id} onClick={() => a.sec ? onFocus(a.sec) : (a.req && onPick && onPick(a.req))}
              style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '8px 10px', borderRadius: 8, cursor: a.sec || a.req ? 'pointer' : 'default', background: SEV_SOFT[a.sev] }}>
              <span className="px-small" style={{ fontWeight: 700, color: SEV_COLOR[a.sev], whiteSpace: 'nowrap', minWidth: 118 }}>{SEV_LABEL[a.sev]}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>{a.title}</span>
                <span className="px-small" style={{ textTransform: 'none' }}>{a.detail}</span>
              </span>
              {a.sec && <span className="px-link" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>Go to field →</span>}
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div className="px-label">Already corrected in this asset</div>
          {done.map(a => (
            <div key={a.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 8, background: 'var(--proto-green-soft)', flexWrap: 'wrap' }}>
              <span className="px-small" style={{ fontWeight: 700, color: 'var(--proto-green)', minWidth: 118 }}>Corrected</span>
              <span style={{ flex: 1, minWidth: 160 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, display: 'block' }}>{a.title}</span>
                <span className="px-small" style={{ textTransform: 'none' }}>{a.detail}</span>
              </span>
              <button className="px-btn" style={{ fontSize: 11 }} onClick={() => a.sec && onFocus(a.sec)}>Review →</button>
            </div>
          ))}
        </div>
      )}
      {g === 'pass' && fails.length === 0 && items.length === 0 && <div className="px-small" style={{ color: 'var(--proto-green)', fontWeight: 700 }}>Nothing to review on this asset.</div>}
    </div>
  );
}

function FieldList({ items, active, onHover, onLeave }) {
  return (
    <div>
      {items.map((it, i) => {
        const on = it.term && active === it.term;
        return (
          <div key={i} onMouseEnter={() => it.term && onHover(it.term)} onMouseLeave={onLeave}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 16px minmax(0,1fr)', gap: 8, alignItems: 'baseline', padding: '5px 6px', borderRadius: 5, background: on ? '#fff8b0' : 'transparent', borderBottom: i < items.length - 1 ? '1px solid var(--proto-rule-soft)' : 'none' }}>
            <span style={{ fontSize: 12.5, color: 'var(--proto-ink)' }}>{it.orig}</span>
            <span style={{ fontSize: 11, color: 'var(--proto-ink3)', textAlign: 'center' }}>{it.action === 'kept' ? '' : '→'}</span>
            <span style={{ fontSize: 12.5, fontWeight: it.action === 'kept' ? 400 : 600 }}>{it.action === 'kept' ? <span className="px-small">unchanged</span> : it.final}</span>
          </div>
        );
      })}
    </div>
  );
}

function PickList({ items, onAsk, label }) {
  const [sel, setSel] = React.useState(() => items.map(i => !!i.selected));
  const [q, setQ] = React.useState('');
  const chosen = sel.filter(Boolean).length;
  const shown = items.map((it, i) => ({ it, i })).filter(({ it }) => !q || it.text.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {items.length > 10 && (
        <input className="px-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Find…" style={{ width: '100%', fontSize: 12, marginBottom: 8 }} />
      )}
      <div style={{ maxHeight: items.length > 10 ? 260 : 'none', overflow: items.length > 10 ? 'auto' : 'visible' }}>
        {shown.map(({ it, i }) => {
          const on = sel[i];
          return (
            <div key={i} onClick={() => setSel(s => s.map((v, j) => j === i ? !v : v))}
              style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) auto', gap: 9, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--proto-rule-soft)', cursor: 'pointer', opacity: on ? 1 : .55 }}>
              <span style={{ width: 13, height: 13, borderRadius: 3, marginTop: 2, background: on ? 'var(--surface-brand-default)' : 'transparent', boxShadow: on ? 'none' : 'inset 0 0 0 1px var(--border-input)', color: '#fff', fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</span>
              <span style={{ fontSize: 12.5, lineHeight: 1.5, textDecoration: it.blocked ? 'line-through' : 'none' }}>{it.text}</span>
              {it.req ? <ReqChip id={it.req} short /> : <span className="px-small" style={{ textAlign: 'right' }} title={it.blocked || 'No matching line in this posting'}>{it.blocked ? 'omit' : '—'}</span>}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 9, alignItems: 'center' }}>
        <span className="px-small">{chosen} of {items.length} on the page</span>
        <div style={{ flex: 1 }} />
        <button className="px-btn" style={{ fontSize: 11.5 }} onClick={() => onAsk && onAsk(`Use these for ${label}: ` + items.filter((_, i) => sel[i]).map(i => i.text).join(' | '))}>Send to assistant</button>
      </div>
    </div>
  );
}

// Ask-for-a-change box, opened in place so the request is attached to the field
// it is about.
function AskBox({ slot, onAsk, onClose }) {
  const [t, setT] = React.useState('');
  const [sent, setSent] = React.useState(false);
  if (sent) return <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-green)', fontWeight: 700 }}>Sent to the assistant for {slot}. Changes appear field by field before saving.</div>;
  return (
    <div className="px-box" style={{ padding: 10, marginTop: 9, background: 'var(--proto-panel)' }}>
      <div className="px-label" style={{ marginBottom: 5 }}>Ask for a change · {slot}</div>
      <textarea autoFocus value={t} onChange={e => setT(e.target.value)} rows={2} placeholder={`What should change in ${slot}?`}
        style={{ width: '100%', resize: 'vertical', padding: '7px 9px', fontSize: 12, fontFamily: 'inherit', color: 'var(--proto-ink)', background: 'var(--proto-paper)', border: '1px solid var(--border-input)', borderRadius: 8, outline: 'none' }} />
      <div style={{ display: 'flex', gap: 6, marginTop: 7, alignItems: 'center' }}>
        <span className="px-small" style={{ flex: 1, textTransform: 'none' }}>Scoped to this field only.</span>
        <button className="px-btn" style={{ fontSize: 11 }} onClick={onClose}>Cancel</button>
        <button className="px-btn px-btn-accent" style={{ fontSize: 11 }} disabled={!t.trim()} onClick={() => { onAsk(`In ${slot}: ${t.trim()}`); setSent(true); }}>Send</button>
      </div>
    </div>
  );
}

function AssetBlock({ s, kind, onPick, onAsk, wide, focus, onFocused }) {
  const [before, setBefore] = React.useState(false);
  const [active, setActive] = React.useState(null);
  const [activeEcho, setActiveEcho] = React.useState(null);
  const [openKey, setOpenKey] = React.useState(null);
  const [ask, setAsk] = React.useState(false);
  const [reverted, setReverted] = React.useState({});
  const figs = (s.mirrors || []).filter(m => m.kind === 'figure');
  // The corrections are already in the text; reverting one puts the ad's figure back.
  const fix = React.useCallback((str) => figs.reduce((acc, m) => reverted[m.phrase] ? acc
    : String(acc).replace(new RegExp(esc(m.phrase), 'gi'), m.fix), str), [figs, reverted]);
  const ref = React.useRef(null);
  const hit = focus === s.id;
  React.useEffect(() => {
    if (!hit || !ref.current) return;
    let el = ref.current.parentElement;
    while (el && el.scrollHeight <= el.clientHeight + 4) el = el.parentElement;
    if (el) el.scrollTop = Math.max(0, ref.current.offsetTop - 16);
    const t = setTimeout(() => onFocused && onFocused(), 2200);
    return () => clearTimeout(t);
  }, [hit]);
  const stat = !s.dynamic;
  const ruleState = ruleStateFor(s.a, s.id);
  const items = attentionFor(s.a, s.id);
  const shownItems = s.items ? s.items.map(i => ({ ...i, final: i.final ? fix(i.final) : i.final, text: i.text ? fix(i.text) : i.text })) : null;
  const shownAfter = typeof s.after === 'string' ? fix(s.after) : s.after;
  const echoTerms = figs.map(m => reverted[m.phrase] ? { ...m } : { ...m, phrase: m.fix }).concat((s.mirrors || []).filter(m => m.kind !== 'figure'));
  const listText = (s.type === 'list' && s.items) ? s.items.map(i => i.final).filter(Boolean).join(' ')
    : (s.type === 'select' && s.items) ? s.items.filter(i => i.selected).map(i => i.text).join(' ') : null;
  const content = (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--proto-ink)' }}>{s.slot}</span>
        <Rule rule={s.rule} text={s.type === 'text' ? s.after : listText} observed={s.ruleObserved} state={ruleState} />
        <div style={{ flex: 1 }} />
        {s.field && <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--proto-ink3)' }}>{s.field}</code>}
      </div>

      {s.type === 'list' ? <FieldList items={shownItems} active={active} onHover={setActive} onLeave={() => setActive(null)} />
        : s.type === 'select' ? <PickList items={shownItems} onAsk={onAsk} label={s.slot} />
        : s.type === 'pipe'
          ? <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11.5, lineHeight: 1.9, wordBreak: 'break-word', whiteSpace: 'pre-line' }}><Marked text={shownAfter} terms={s.terms} active={active} echoes={echoTerms} activeEcho={activeEcho} /></div>
          : <div style={{ fontSize: kind === 'letter' ? 13 : 12.5, lineHeight: kind === 'letter' ? 1.75 : 1.65, whiteSpace: 'pre-line', color: stat ? 'var(--proto-ink2)' : 'var(--proto-ink)' }}>
              <Marked text={shownAfter} terms={s.terms} active={active} echoes={echoTerms} activeEcho={activeEcho} />
            </div>}

      {before && s.before && (
        <div style={{ marginTop: 9, padding: 10, borderRadius: 8, background: 'var(--surface-info-subtle)', boxShadow: 'inset 0 0 0 1px var(--blue-200)' }}>
          <div className="px-small" style={{ color: 'var(--text-info)', fontWeight: 700, marginBottom: 3 }}>
            ORIGINAL {s.sameAsBefore ? '· identical, template text is not merged per packet' : '· before this posting'}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--proto-ink2)', whiteSpace: 'pre-line' }}>{s.before}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
        {s.before && s.type !== 'list' && (
          <span className="px-link" style={{ fontSize: 11.5 }} onClick={() => setBefore(v => !v)}>{before ? 'Hide original' : 'Show original'}</span>
        )}
        <span className="px-link" style={{ fontSize: 11.5 }} onClick={() => setAsk(v => !v)}>Ask for a change</span>
      </div>
      {ask && <AskBox slot={s.slot} onAsk={onAsk} onClose={() => setAsk(false)} />}
    </div>
  );
  const margin = (
    <div style={{ minWidth: 0, borderLeft: wide ? '1px solid var(--proto-rule-soft)' : 'none', borderTop: wide ? 'none' : '1px solid var(--proto-rule-soft)', paddingLeft: wide ? 14 : 0, paddingTop: wide ? 0 : 10 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {stat
          ? <span className="px-small" style={{ fontWeight: 700 }}>Template · same in every packet</span>
          : <><span className="px-small" style={{ fontWeight: 700, color: 'var(--text-brand)' }}>{s.edited ? 'Written for this posting' : 'From profile'}</span>
              {s.pass && <span className="px-small">pass {s.pass}</span>}</>}
      </div>
      {items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 9 }}>
          {items.map(a => (
            <div key={a.id} style={{ padding: '6px 8px', borderRadius: 6, background: SEV_SOFT[a.sev] }}>
              <div className="px-small" style={{ fontWeight: 700, color: SEV_COLOR[a.sev] }}>{SEV_LABEL[a.sev]}</div>
              <div style={{ fontSize: 11.5, lineHeight: 1.45, marginTop: 2 }}>{a.title}</div>
              {a.detail && <div className="px-small" style={{ textTransform: 'none', marginTop: 2 }}>{a.detail}</div>}
              {a.ask && <button className="px-btn" style={{ fontSize: 11, marginTop: 5 }} onClick={() => onAsk && onAsk(a.ask + ' ')}>Answer</button>}
            </div>
          ))}
        </div>
      )}
      {(s.terms || []).length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>Keywords placed</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {s.terms.map(id => <KeyChip key={id} id={id} active={active} open={openKey} onHover={setActive} onLeave={() => setActive(null)} onOpen={setOpenKey} />)}
          </div>
          {openKey && <KeyDetail id={openKey} slot={s.slot} onClose={() => setOpenKey(null)} onAsk={onAsk} />}
        </div>
      )}
      {(s.reqs || []).length > 0 && (
        <div style={{ marginTop: 9 }}>
          <div className="px-label" style={{ marginBottom: 4 }}>Posting lines answered</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{s.reqs.map(id => <ReqChip key={id} id={id} onPick={onPick} />)}</div>
        </div>
      )}
      {s.why && <div style={{ fontSize: 11.5, lineHeight: 1.5, marginTop: 9, color: 'var(--proto-ink2)' }}>{s.why}</div>}
      {(s.missingTerms || []).length > 0 && (
        <div className="px-small" style={{ marginTop: 8, color: 'var(--proto-yellow)', textTransform: 'none' }}>
          Claimed but not in the text: {s.missingTerms.map(id => termById(id)?.term).join(', ')}
        </div>
      )}
      <EchoTrail mirrors={s.mirrors} onAsk={onAsk} activeEcho={activeEcho} setActiveEcho={setActiveEcho} reverted={reverted} setReverted={setReverted} slot={s.slot} />
      {active && (() => {
        const t = termById(active);
        const r = t && reqById(t.reqs[0]);
        return r ? <div className="px-small" style={{ marginTop: 8, fontStyle: 'italic', textTransform: 'none' }}>“{r.verbatim}”</div> : null;
      })()}
    </div>
  );
  return (
    <div ref={ref} className="px-box" style={{ padding: 14, display: 'grid', gridTemplateColumns: wide ? 'minmax(0,1fr) 250px' : '1fr', gap: 16, background: stat ? 'var(--proto-panel)' : 'var(--proto-paper)', boxShadow: hit ? 'inset 0 0 0 2px var(--surface-brand-default)' : undefined, transition: 'box-shadow 200ms' }}>
      {content}{margin}
    </div>
  );
}

function AssetDocView({ type, onPick, onAsk, header, focusSec }) {
  const doc = ASSET_DOCS[type];
  const wide = useWide(1080);
  const [focus, setFocus] = React.useState(focusSec || null);
  React.useEffect(() => { if (focusSec) setFocus(focusSec); }, [focusSec]);
  if (!doc) return <div className="px-box" style={{ padding: 18, textAlign: 'center' }}><span className="px-small">Nothing drafted yet.</span></div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {header !== false && <AssetHeader type={type} onPick={onPick} onFocus={setFocus} onAsk={onAsk} />}
      {doc.sections.map(s => <AssetBlock key={s.id} s={{ ...s, a: type }} kind={doc.kind} onPick={onPick} onAsk={onAsk} wide={wide} focus={focus} onFocused={() => setFocus(null)} />)}
      <ReqLegend />
    </div>
  );
}

Object.assign(window, { AssetDocView, AssetBlock, AssetHeader, assetCoverage, FieldList, PickList, Marked, KeyChip, KeyDetail, ReqChip, ReqLegend, EchoTrail, AskBox });
