/**
 * useAgents.js — polls the control plane every 8s
 * to get live status of all registered agents.
 */
import { useState, useEffect } from 'react'
import { listAgents, getHealth } from '../utils/api'

const POLL_MS = 8000

// Agents the status bar always shows, even before the control plane lists them.
export const KNOWN_AGENTS = [
  { id: 'triage-orchestrator', label: 'Orchestrator', icon: '🎯' },
  { id: 'gate-agent',          label: 'Gate',         icon: '🚦' },
  { id: 'sentiment-agent',     label: 'Sentiment',    icon: '💬' },
  { id: 'sla-agent',           label: 'SLA',          icon: '⏱️' },
  { id: 'escalation-agent',    label: 'Escalation',   icon: '🚨' },
]

export function useAgents() {
  const [agents, setAgents]         = useState([])
  const [cpHealth, setCpHealth]     = useState('unknown') // 'ok' | 'down' | 'unknown'
  const [lastChecked, setLastChecked] = useState(null)

  useEffect(() => {
    let timer

    async function poll() {
      try {
        const health = await getHealth()
        setCpHealth(health.status === 'ok' ? 'ok' : 'down')

        const data = await listAgents()
        setAgents(data.agents ?? data ?? [])
        setLastChecked(new Date())
      } catch {
        setCpHealth('down')
        setLastChecked(new Date())
      }
      timer = setTimeout(poll, POLL_MS)
    }

    poll()
    return () => clearTimeout(timer)
  }, [])

  return { agents, cpHealth, lastChecked }
}
