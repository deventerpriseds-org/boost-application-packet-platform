// Intake / OAuth / Settings screens.

function IntakeScreen() {
  const { toast } = useApp();
  const [connected, setConnected] = React.useState({ gmail:true, calendar:true, linkedin:false, indeed:true, greenhouse:false, hh:false });

  return (
    <DesktopShell title="Intake · inbox monitoring" active="intake">
      <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:14 }}>
        <div className="px-h1" style={{ fontSize:20 }}>Intake</div>
        <div className="px-meta">The engine reads job alerts + listings → enriches → surfaces in your swipe queue.</div>

        <div style={{ display:'grid', gridTemplateColumns:'1.4fr 1fr', gap:18 }}>
          <div>
            <SectionTitle sub="OAuth-connected">Sources</SectionTitle>
            <div className="px-box" style={{ padding:0 }}>
              {[
                { id:'gmail',     n:'Gmail',                   s:'r***@gmail.com · scopes: read · 12 alerts today',  c:true  },
                { id:'calendar',  n:'Google Calendar',         s:'syncing · 4 events this week',                      c:true  },
                { id:'linkedin',  n:'LinkedIn Saved + Alerts', s:'connect to pull job alerts + saved jobs',          c:false },
                { id:'indeed',    n:'Indeed Job Alerts',       s:'syncing · 6 alerts today',                          c:true  },
                { id:'greenhouse',n:'Greenhouse',              s:'optional · for direct applications',                c:false },
                { id:'hh',        n:'Hiring Manager handles',  s:'optional · import warm intros via LinkedIn export', c:false },
              ].map((src, i, arr) => {
                const isConnected = connected[src.id];
                return (
                  <div key={src.id} style={{ padding:'12px 14px', borderBottom: i < arr.length-1 ? '1.5px solid var(--proto-rule-soft)' : 'none', display:'flex', alignItems:'center', gap:12 }}>
                    <div className="px-logo" style={{ width:32, height:32, fontSize:13 }}>{src.n[0]}</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:14, fontWeight:700 }}>{src.n}</div>
                      <div className="px-small">{src.s}</div>
                    </div>
                    {isConnected ? (
                      <>
                        <Pill color={PROTO.green}>✓ Connected</Pill>
                        <div className="px-btn px-btn-ghost" style={{ fontSize:11 }} onClick={() => { setConnected(p => ({ ...p, [src.id]: false })); toast(`Disconnected ${src.n}`); }}>Disconnect</div>
                      </>
                    ) : (
                      <div className="px-btn px-btn-dark" style={{ fontSize:12 }} onClick={() => { setConnected(p => ({ ...p, [src.id]: true })); toast(`Connected ${src.n} ✓`); }}>Connect</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <SectionTitle>Pipeline volume · last 7d</SectionTitle>
              <div className="px-box" style={{ padding:12 }}>
                {[['Job alerts ingested', 84],['Deduplicated', 52],['Passed engine filter', 28],['In swipe queue', 12],['Saved by you', 8]].map(([k,v], i) => (
                  <div key={k} style={{ marginBottom:6 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}><span>{k}</span><b>{v}</b></div>
                    <Bar value={(v/84) * 100} color={i === 0 ? 'var(--proto-ink)' : i < 3 ? 'var(--proto-accent)' : PROTO.green} />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <SectionTitle>Engine filters</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, display:'flex', flexDirection:'column', gap:8 }}>
                <FilterRow k="Match floor" v="≥ 70%" />
                <FilterRow k="Location" v="SF, NYC, Remote" />
                <FilterRow k="Comp floor" v="$300k+" />
                <FilterRow k="Stage / size" v="Series C → Public" />
                <FilterRow k="Exclude" v="Stealth · pre-seed" />
                <div className="px-btn px-btn-ghost" style={{ fontSize:11, alignSelf:'flex-start' }}>Edit filters</div>
              </div>
            </div>

            <div>
              <SectionTitle>Last 24h log</SectionTitle>
              <div className="px-box" style={{ padding:12, fontSize:12, lineHeight:1.6 }}>
                <div>06:14 · Pulled 12 new alerts</div>
                <div>06:15 · Deduplicated 4 (already in pipeline)</div>
                <div>06:18 · Enriched 8 with stakeholders + signals</div>
                <div>06:22 · Promoted 3 to "Hot" (recruiter outreach)</div>
                <div>07:42 · Cloudflare CTO recruiter replied → moved to <b>Engaged</b></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

function FilterRow({ k, v }) {
  return <div style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1.5px solid var(--proto-rule-soft)' }}><span className="px-small">{k}</span><b>{v}</b></div>;
}

function SettingsScreen() {
  const { persona, demoState } = useApp();
  return (
    <DesktopShell title="Settings" active="settings">
      <div style={{ padding:20, display:'flex', flexDirection:'column', gap:14, maxWidth:880 }}>
        <div className="px-h1" style={{ fontSize:22 }}>Settings</div>
        <div className="px-meta">Profile, notifications, integrations, billing</div>

        <div className="px-box" style={{ padding:14, display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
          <SettingsBlock title="Account" rows={[
            ['Name', PERSONAS[persona].user.name],
            ['Role', PERSONAS[persona].label],
            ['Location', PERSONAS[persona].user.loc],
            ['Demo state', DEMO_STATES[demoState].label],
          ]} />
          <SettingsBlock title="Notifications" rows={[
            ['Daily briefing', '7:00 AM · email + push'],
            ['Hot signals', 'Real-time push'],
            ['Cadence stalls', 'Once per day digest'],
            ['Weekly review', 'Sunday 6 PM'],
          ]} />
          <SettingsBlock title="Templates & playbooks" rows={[
            ['Outreach templates', '14 active · 5 archived'],
            ['Playbook library',   `${PLAYBOOKS_X.length} playbooks`],
            ['Role baselines',     '8 master profiles'],
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

function SettingsBlock({ title, rows }) {
  return (
    <div>
      <div className="px-label">{title}</div>
      <div style={{ marginTop:8, display:'flex', flexDirection:'column', gap:6 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display:'flex', justifyContent:'space-between', padding:'4px 0', borderBottom:'1.5px solid var(--proto-rule-soft)' }}>
            <span className="px-small">{k}</span><span style={{ fontSize:13, fontWeight:600 }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { IntakeScreen, SettingsScreen });
