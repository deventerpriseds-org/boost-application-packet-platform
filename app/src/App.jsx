import React, { useState } from 'react'
import { AppProvider, useApp, useRoute } from './state.jsx'
import { DesktopShell } from './shell.jsx'
import { useOpportunities } from './data.jsx'
import Today from './screens/Today.jsx'
import Opportunities from './screens/Opportunities.jsx'
import Pipeline from './screens/Pipeline.jsx'
import Swipe from './screens/Swipe.jsx'
import OppDetail from './screens/OppDetail.jsx'
import Packets from './screens/Packets.jsx'
import PacketBuilder from './screens/PacketBuilder.jsx'
import Outreach from './screens/Outreach.jsx'
import Composer from './screens/Composer.jsx'
import Interview from './screens/Interview.jsx'
import Offer from './screens/Offer.jsx'
import Answers from './screens/Answers.jsx'
import Call from './screens/Call.jsx'
import Library from './screens/Library.jsx'
import Intake from './screens/Intake.jsx'
import Settings from './screens/Settings.jsx'

const TITLES = { today: 'Today', intake: 'Intake', settings: 'Settings', opportunities: 'Opportunities', pipeline: 'Pipeline', swipe: 'Swipe', opp: 'Opportunity', packets: 'Packets', packet: 'Packet', outreach: 'Outreach', compose: 'Composer', interview: 'Interview', offer: 'Offer', answers: 'App answers', call: 'Voice coach', library: 'Library' }

function Router() {
  const { personaKey, toast, showDemo } = useApp()
  const { parts } = useRoute()
  const route = parts[0] || 'today'
  // One live data source shared across screens; polls so real-time-ingested
  // LinkedIn alerts pop in with a toast. Refetches when the demo toggle changes.
  const opps = useOpportunities(personaKey, { includeDemo: showDemo, onNew: (o) => toast(`New opportunity · ${o.company} — ${o.role}`) })

  let screen
  if (route === 'intake') screen = <Intake />
  else if (route === 'settings') screen = <Settings tab={parts[1] || 'account'} />
  else if (route === 'opportunities') screen = <Opportunities opps={opps} />
  else if (route === 'pipeline') screen = <Pipeline opps={opps} />
  else if (route === 'swipe') screen = <Swipe opps={opps} />
  else if (route === 'packets') screen = <Packets />
  else if (route === 'packet' && parts[1]) screen = <PacketBuilder id={parts[1]} />
  else if (route === 'outreach') screen = <Outreach />
  else if (route === 'compose' && parts[1]) screen = <Composer id={parts[1]} />
  else if (route === 'interview' && parts[1]) screen = <Interview id={parts[1]} tab={parts[2] || 'prep'} />
  else if (route === 'offer' && parts[1]) screen = <Offer id={parts[1]} />
  else if (route === 'answers' && parts[1]) screen = <Answers id={parts[1]} />
  else if (route === 'call') screen = <Call />
  else if (route === 'library') screen = <Library tab={parts[1] || 'assets'} />
  else if (route === 'opp' && parts[1]) screen = <OppDetail id={parts[1]} tab={parts[2] || 'overview'} />
  else screen = <Today opps={opps} />

  return <DesktopShell title={TITLES[route] || 'Today'}>{screen}</DesktopShell>
}

// Soft login gate: shown on load until the user signs in OR explicitly chooses
// to explore in demo mode. Signing in gives them their OWN data owner + a
// server-verified session; demo mode shares the sandbox owner.
function LoginGate() {
  const { signIn, enterDemo, providerReady } = useApp()
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const doSignIn = async (p) => {
    setErr(null); setBusy(p)
    try { await signIn(p) } catch (e) { setErr(String(e?.message || e)) } finally { setBusy(null) }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'var(--proto-panel-deep)' }}>
      <div className="px-box" style={{ padding: 32, maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 18, textAlign: 'center' }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>Executive Engine</div>
          <div className="px-small" style={{ marginTop: 6, lineHeight: 1.5 }}>Sign in to load <b>your own</b> pipeline, packets, and coach memory. Your data is kept separate from everyone else’s.</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="px-btn px-btn-accent" disabled={!providerReady?.microsoft || busy} onClick={() => doSignIn('microsoft')} style={{ padding: '11px 16px', fontSize: 14 }}>
            {busy === 'microsoft' ? 'Signing in…' : 'Continue with Microsoft'}
          </button>
          <button className="px-btn" disabled={!providerReady?.google || busy} onClick={() => doSignIn('google')} style={{ padding: '11px 16px', fontSize: 14 }}>
            {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
          </button>
          {!providerReady?.microsoft && !providerReady?.google && (
            <div className="px-small" style={{ color: 'var(--proto-red)' }}>No sign-in provider is configured yet — use demo mode below.</div>
          )}
        </div>

        {err && <div className="px-small" style={{ color: 'var(--proto-red)' }}>{err}</div>}

        <div style={{ borderTop: '1px solid var(--proto-rule-soft)', paddingTop: 14 }}>
          <span className="px-link" style={{ fontSize: 13, cursor: 'pointer' }} onClick={enterDemo}>Explore in demo mode →</span>
          <div className="px-small" style={{ marginTop: 4 }}>Shared sample workspace. You can sign in later from Settings.</div>
        </div>
      </div>
    </div>
  )
}

function Gate() {
  const { auth, demoBypass } = useApp()
  if (auth.loading) return null // avoid a flash of the gate while identity resolves
  if (!auth.user && !demoBypass) return <LoginGate />
  return <Router />
}

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  )
}
