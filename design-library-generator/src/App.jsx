import React, { useEffect } from 'react'
import { AppProvider, useApp, useRoute } from './state.jsx'
import { Shell } from './shell.jsx'
import { handleGoogleCallback } from './auth.js'
import Upload from './screens/Upload.jsx'
import Extract from './screens/Extract.jsx'
import Review from './screens/Review.jsx'
import Export from './screens/Export.jsx'
import Showcase from './screens/Showcase.jsx'

function Router() {
  const { dispatch } = useApp()
  const { path } = useRoute()

  useEffect(() => {
    // Handle Google OAuth callback — runs once on load
    handleGoogleCallback().then((user) => {
      if (user) dispatch({ type: 'SET_USER', user })
    }).catch(console.error)
  }, [])

  const screen = path.replace(/^\//, '').split('/')[0] || 'upload'

  return (
    <Shell>
      {screen === 'upload' && <Upload />}
      {screen === 'extract' && <Extract />}
      {screen === 'review' && <Review />}
      {screen === 'export' && <Export />}
      {screen === 'showcase' && <Showcase />}
    </Shell>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Router />
    </AppProvider>
  )
}
