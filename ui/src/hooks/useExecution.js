/**
 * useExecution.js — React hook for submitting tickets and
 * polling execution results from AgentField.
 */
import { useState, useCallback, useRef } from 'react'
import { submitTicket } from '../utils/api'

export function useExecution() {
  const [state, setState] = useState({
    status: 'idle',      // idle | submitting | succeeded | failed
    result: null,
    error: null,
    executionId: null,
    durationMs: null,
  })
  const abortRef = useRef(null)

  const submit = useCallback(async (ticketData) => {
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort()
    abortRef.current = new AbortController()

    setState({ status: 'submitting', result: null, error: null, executionId: null, durationMs: null })

    const startTs = Date.now()

    try {
      const data = await submitTicket(ticketData)

      setState({
        status: data.status === 'succeeded' ? 'succeeded' : 'failed',
        result: data.result ?? data,
        error: data.status === 'failed' ? (data.error || 'Execution failed') : null,
        executionId: data.execution_id,
        durationMs: data.duration_ms ?? (Date.now() - startTs),
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      setState(s => ({
        ...s,
        status: 'failed',
        error: err.message || 'Unknown error',
        durationMs: Date.now() - startTs,
      }))
    }
  }, [])

  const reset = useCallback(() => {
    setState({ status: 'idle', result: null, error: null, executionId: null, durationMs: null })
  }, [])

  return { ...state, submit, reset }
}
