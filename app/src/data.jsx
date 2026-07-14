import { useCallback, useEffect, useState, useRef } from 'react'
import { api } from './api.js'

// Loads the opportunity catalog for the active persona from the live service layer.
// Polls every `pollMs` so real-time-ingested opportunities (LinkedIn alerts) pop
// in; calls onNew(opp) for each newly-appeared id after the first load.
export function useOpportunities(personaKey, { pollMs = 15000, onNew, includeDemo = true } = {}) {
  const [state, setState] = useState({ loading: true, error: null, opportunities: [], byStage: {}, stages: [] })
  const knownIds = useRef(null) // null until first successful load
  const onNewRef = useRef(onNew); onNewRef.current = onNew

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

  return { ...state, reload, optimisticMove, optimisticDismiss }
}

export const personaName = (key) => key
