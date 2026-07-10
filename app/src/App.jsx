import React from 'react'
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

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  )
}
