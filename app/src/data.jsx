import { useCallback, useEffect, useState, useRef, useMemo } from 'react'
import { api } from './api.js'

// Discovery stages the location/remote preference filters. Committed opps (applied → offer) are NEVER
// hidden by a discovery filter — you don't lose sight of something you're already pursuing.
const FRESH_STAGES = ['discovered', 'saved', 'enriched']

// The SINGLE location/remote rule, mirrored from the backend search gate (jdSearch.keepCard) so the UI
// and the ingest layer agree. targets empty + no remote-only = keep everything.
function matchesLocationPrefs(o, prefs) {
  const hasTargets = prefs.targetGeoIds.size > 0
  if (!hasTargets && !prefs.remoteOnly) return true
  const inTarget = hasTargets && o.metroGeoId && prefs.targetGeoIds.has(o.metroGeoId)
  const isRemote = o.workMode === 'remote'
  if (hasTargets && prefs.remoteOnly) return inTarget || isRemote // "remote plus"
  if (hasTargets) return inTarget
  return isRemote // no targets + remote-only
}
function applyLocationPrefs(opps, prefs) {
  if (!prefs.targetGeoIds.size && !prefs.remoteOnly) return opps
  return opps.filter((o) => (FRESH_STAGES.includes(o.stage) ? matchesLocationPrefs(o, prefs) : true))
}

// Loads the opportunity catalog for the active persona from the live service layer.
// Polls every `pollMs` so real-time-ingested opportunities (LinkedIn alerts) pop
// in; calls onNew(opp) for each newly-appeared id after the first load.
export function useOpportunities(personaKey, { pollMs = 15000, onNew, includeDemo = true } = {}) {
  const [state, setState] = useState({ loading: true, error: null, opportunities: [], byStage: {}, stages: [] })
  const knownIds = useRef(null) // null until first successful load
  const onNewRef = useRef(onNew); onNewRef.current = onNew
  // Owner location/remote preference (Settings ▸ Locations). Loaded once + refreshed on the poll so a
  // pref change propagates to EVERY screen that consumes this hook (Today scrub, Swipe, Opportunities,
  // Pipeline) from this one source — no per-screen duplication, no stale counts.
  const [prefs, setPrefs] = useState({ targetGeoIds: new Set(), remoteOnly: false })
  const loadPrefs = useCallback(() => {
    api.searchPrefsGet().then((p) => { if (p && p.ok !== false) setPrefs({ targetGeoIds: new Set(p.targetGeoIds || []), remoteOnly: !!p.remoteOnly }) }).catch(() => {})
  }, [])
  useEffect(() => { loadPrefs() }, [loadPrefs])

  const reload = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await api.listOpportunities({ persona: personaKey })
      if (res.error) throw new Error(res.error)
      const opportunities = res.opportunities || []
      // Detect newly-arrived opportunities (after the first load) → notify.
      if (knownIds.current) {
        for (const o of opportunities) {
          if (!knownIds.current.has(o.id)) onNewRef.current?.(o)
        }
      }
      knownIds.current = new Set(opportunities.map((o) => o.id))
      setState({ loading: false, error: null, opportunities, byStage: res.byStage || {}, stages: res.stages || [] })
    } catch (err) {
      if (!silent) setState({ loading: false, error: String(err.message || err), opportunities: [], byStage: {}, stages: [] })
    }
  }, [personaKey, includeDemo])

  // Reset the known-set when persona changes so we don't toast the whole list.
  useEffect(() => { knownIds.current = null; reload() }, [reload])

  // Background poll for live arrivals (silent — no loading flicker).
  useEffect(() => {
    if (!pollMs) return
    const t = setInterval(() => reload({ silent: true }), pollMs)
    return () => clearInterval(t)
  }, [reload, pollMs])

  // Optimistically move an opportunity's stage locally, persist to the API,
  // and roll back on failure.
  const optimisticMove = useCallback(async (id, stage, onError) => {
    let prev
    setState((s) => {
      const opportunities = s.opportunities.map((o) => {
        if (o.id === id) { prev = o.stage; return { ...o, stage } }
        return o
      })
      return { ...s, opportunities }
    })
    try {
      const res = await api.moveStage(id, stage)
      if (res.error) throw new Error(res.error)
    } catch (err) {
      // rollback
      setState((s) => ({ ...s, opportunities: s.opportunities.map((o) => (o.id === id ? { ...o, stage: prev } : o)) }))
      onError?.(err)
    }
  }, [])

  // Optimistically remove a dismissed opportunity, persist, roll back on failure.
  const optimisticDismiss = useCallback(async (id, onError) => {
    let prev
    setState((s) => {
      prev = s.opportunities.find((o) => o.id === id)
      return { ...s, opportunities: s.opportunities.filter((o) => o.id !== id) }
    })
    try {
      const res = await api.dismiss(id)
      if (res.error) throw new Error(res.error)
    } catch (err) {
      setState((s) => (prev ? { ...s, opportunities: [...s.opportunities, prev] } : s))
      onError?.(err)
    }
  }, [])

  // Undo a dismiss: re-insert the opportunity locally and clear the dismissed
  // flag server-side. `opp` is the row we removed on dismiss (captured by the caller).
  const optimisticUndismiss = useCallback(async (opp, onError) => {
    if (!opp) return
    setState((s) => (s.opportunities.some((o) => o.id === opp.id) ? s : { ...s, opportunities: [...s.opportunities, opp] }))
    try {
      const res = await api.undismiss(opp.id)
      if (res.error) throw new Error(res.error)
    } catch (err) {
      setState((s) => ({ ...s, opportunities: s.opportunities.filter((o) => o.id !== opp.id) }))
      onError?.(err)
    }
  }, [])

  // Single funnel: every consumer sees the location/remote-filtered discovery set + committed opps.
  const visible = useMemo(() => applyLocationPrefs(state.opportunities, prefs), [state.opportunities, prefs])
  return { ...state, opportunities: visible, allOpportunities: state.opportunities, prefs, reloadPrefs: loadPrefs, reload, optimisticMove, optimisticDismiss, optimisticUndismiss }
}
