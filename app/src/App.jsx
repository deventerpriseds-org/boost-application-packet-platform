import React from 'react'
import { AppProvider, useApp, useRoute } from './state.jsx'
import { DesktopShell } from './shell.jsx'
import { useOpportunities } from './data.jsx'
import Today from './screens/Today.jsx'
import Opportunities from './screens/Opportunities.jsx'
import Pipeline from './screens/Pipeline.jsx'
import Swipe from './screens/Swipe.jsx'
import OppDetail from './screens/OppDetail.jsx'

const TITLES = { today: 'Today', opportunities: 'Opportunities', pipeline: 'Pipeline', swipe: 'Swipe', opp: 'Opportunity' }

function Router() {
  const { personaKey } = useApp()
  const { parts } = useRoute()
  const route = parts[0] || 'today'
  // One live data source shared across screens so stage moves reflect everywhere.
  const opps = useOpportunities(personaKey)

  let screen
  if (route === 'opportunities') screen = <Opportunities opps={opps} />
  else if (route === 'pipeline') screen = <Pipeline opps={opps} />
  else if (route === 'swipe') screen = <Swipe opps={opps} />
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
