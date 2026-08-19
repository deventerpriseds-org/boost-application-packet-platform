// Assistant: where you ask for a change, correct a swap, or walk one back.
// Docked right rail on the packet screen; every asset block can seed it.

const QUICK = [
  { l: 'Put back an original', t: 'Put back the original wording in ' },
  { l: 'Undo a swap', t: 'Undo the swap of ' },
  { l: 'Shorten to fit', t: 'Shorten this to fit its word rule: ' },
  { l: 'Say why', t: 'Why did you change ' },
  { l: 'Keyword is wrong', t: 'This keyword does not apply to me: ' },
];

const SEEDED = [
  { who: 'you', t: 'Undo the swap of M&A Due Diligence. I want it in Skills 2.' },
  { who: 'ai', t: 'Done — M&A Due Diligence is back in Skills 2, and Kubernetes moved to Relevant 2 to keep its keyword covered.',
    changes: [
      { field: 'SkillsBullets2', from: 'Kubernetes', to: 'M&A Due Diligence' },
      { field: 'RelevantBullets2', from: 'Corporate AI Use Cases', to: 'Kubernetes' },
    ],
    note: 'Heads up: M&A is on your omission list, so the next run will drop it again unless you take it off the list.' },
];

function Assist({ open, setOpen, seed, setSeed, docked }) {
  const [msgs, setMsgs] = React.useState(SEEDED);
  const [text, setText] = React.useState('');
  const [scope, setScope] = React.useState('This packet');
  const boxRef = React.useRef(null);

  React.useEffect(() => { if (seed) { setText(seed); setOpen(true); setSeed(''); } }, [seed]);
  React.useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [msgs, open]);

  const send = () => {
    const t = text.trim(); if (!t) return;
    setMsgs(m => [...m, { who: 'you', t }, {
      who: 'ai', pending: true,
      t: 'Working on it. I will show the exact fields I touch before anything is saved.',
    }]);
    setText('');
  };

  if (!open) return docked ? (
    <div className="px-box" style={{ padding: 14 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>Assistant</div>
      <div className="px-small" style={{ textTransform: 'none', marginTop: 3 }}>Ask for changes, corrections, or a walk-back. {msgs.filter(m => m.who === 'you').length} request{msgs.filter(m => m.who === 'you').length === 1 ? '' : 's'} in this packet.</div>
      <button className="px-btn px-btn-accent" style={{ width: '100%', marginTop: 10, fontSize: 12 }} onClick={() => setOpen(true)}>Open assistant</button>
    </div>
  ) : (
    <button className="px-btn px-btn-accent" onClick={() => setOpen(true)}
      style={{ position: 'fixed', right: 18, bottom: 74, zIndex: 55, borderRadius: 999, padding: '9px 16px', boxShadow: '0 8px 24px rgba(15,23,42,.18)' }}>
      Assistant · {msgs.filter(m => m.who === 'you').length}
    </button>
  );

  const frame = docked
    ? { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 140px)', borderRadius: 12, border: '1px solid var(--proto-rule-soft)', background: 'var(--proto-paper)', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 2px 10px rgba(15,23,42,.05)' }
    : { position: 'fixed', right: 0, top: 54, bottom: 0, width: 'min(380px, 92vw)', zIndex: 56, background: 'var(--proto-paper)', borderLeft: '1px solid var(--proto-rule-soft)', display: 'flex', flexDirection: 'column', boxShadow: '-12px 0 32px rgba(15,23,42,.10)' };

  return (
    <div style={frame}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>Assistant</div>
          <div className="px-small">{docked ? 'Docked · stays with the packet' : 'Ask for changes, corrections, or a walk-back'}</div>
        </div>
        <span onClick={() => setOpen(false)} className="px-btn" style={{ padding: '2px 8px', cursor: 'pointer' }}>{docked ? '–' : '✕'}</span>
      </div>

      <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--proto-rule-soft)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <span className="px-small">Scope</span>
        {['This packet', 'This asset', 'My profile'].map(s => (
          <span key={s} onClick={() => setScope(s)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', background: scope === s ? 'var(--surface-brand-default)' : 'var(--proto-panel)', color: scope === s ? 'var(--text-on-brand)' : 'var(--proto-ink2)' }}>{s}</span>
        ))}
      </div>

      <div ref={boxRef} style={{ flex: 1, overflow: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minHeight: docked ? 200 : 0 }}>
        {msgs.map((m, i) => m.who === 'you' ? (
          <div key={i} style={{ alignSelf: 'flex-end', maxWidth: '88%', background: 'var(--surface-brand-default)', color: 'var(--text-on-brand)', padding: '8px 11px', borderRadius: '12px 12px 3px 12px', fontSize: 12.5, lineHeight: 1.5 }}>{m.t}</div>
        ) : (
          <div key={i} style={{ maxWidth: '94%' }}>
            <div style={{ background: 'var(--proto-panel)', padding: '9px 11px', borderRadius: '12px 12px 12px 3px', fontSize: 12.5, lineHeight: 1.55 }}>
              {m.t}
              {m.changes && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {m.changes.map((c, j) => (
                    <div key={j} style={{ display: 'flex', gap: 6, alignItems: 'baseline', fontSize: 11.5, background: 'var(--proto-paper)', borderRadius: 6, padding: '5px 7px' }}>
                      <code style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: 'var(--proto-ink3)' }}>{c.field}</code>
                      <span style={{ color: 'var(--text-info)' }}>{c.from}</span><span style={{ color: 'var(--proto-ink3)' }}>→</span><span style={{ fontWeight: 600 }}>{c.to}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.note && <div className="px-small" style={{ marginTop: 7, color: 'var(--proto-yellow)', textTransform: 'none' }}>{m.note}</div>}
            </div>
            {m.changes && (
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="px-btn px-btn-green" style={{ fontSize: 11.5 }}>Keep</button>
                <button className="px-btn" style={{ fontSize: 11.5 }}>Revert</button>
                <button className="px-btn" style={{ fontSize: 11.5 }}>Re-run QC</button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ padding: 12, borderTop: '1px solid var(--proto-rule-soft)' }}>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
          {QUICK.map(q => (
            <span key={q.l} onClick={() => setText(q.t)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 9px', borderRadius: 999, cursor: 'pointer', background: 'var(--proto-panel)', color: 'var(--proto-ink2)' }}>{q.l}</span>
          ))}
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="Tell me what to change…"
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }}
          style={{ width: '100%', resize: 'vertical', padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit', color: 'var(--proto-ink)', background: 'var(--proto-paper)', border: '1px solid var(--border-input)', borderRadius: 8, outline: 'none' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <span className="px-small">Changes are shown field by field before saving</span>
          <div style={{ flex: 1 }} />
          <button className="px-btn px-btn-accent" style={{ fontSize: 12 }} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { Assist });
