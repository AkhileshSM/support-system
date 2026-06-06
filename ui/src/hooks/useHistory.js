/**
 * useHistory.js — maintains a client-side log of all ticket
 * submissions in this session, enriched with the execution result.
 */
import { useState, useCallback } from 'react'

export function useHistory() {
  const [entries, setEntries] = useState([])

  const addEntry = useCallback((ticket, executionData) => {
    setEntries(prev => [
      {
        id: executionData.executionId || `local-${Date.now()}`,
        ticket,
        result: executionData.result,
        status: executionData.status,
        durationMs: executionData.durationMs,
        submittedAt: new Date().toISOString(),
      },
      ...prev,
    ].slice(0, 50))  // Keep last 50
  }, [])

  const clear = useCallback(() => setEntries([]), [])

  return { entries, addEntry, clear }
}
