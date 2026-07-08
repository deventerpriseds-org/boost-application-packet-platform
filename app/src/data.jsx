import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import { PERSONAS } from './state.jsx'

// Loads the opportunity catalog for the active persona from the live service layer.
// Returns { loading, error, data, byStage, stages, reload, optimisticMove }.
export function useOpportunities(personaKey) {
  const [state, setState] = useState({ loading: true, error: null, opportunities: [], byStage: {}, stages: [] })

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const res = await api.listOpportunities({ persona: personaKey })
      if (res.error) throw new Error(res.error)
      setState({
        loading: false, error: null,
        opportunities: res.opportunities || [],
        byStage: res.byStage || {}, stages: res.stages || [],
      })
    } catch (err) {
      setState({ loading: false, error: String(err.message || err), opportunities: [], byStage: {}, stages: [] })
    }
  }, [personaKey])

  useEffect(() => { reload() }, [reload])

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

  return { ...state, reload, optimisticMove }
}

export const personaName = (key) => PERSONAS[key]?.name || key
