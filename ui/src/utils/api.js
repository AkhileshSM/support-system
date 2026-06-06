/**
 * api.js — AgentField REST API client
 *
 * All calls go through /api which nginx proxies to the
 * AgentField control plane at http://agentfield-server:8080
 */

const BASE = '/api/v1'

// ── Generic request helper ───────────────────────────────────
async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.message || data.error || `HTTP ${res.status}`)
  return data
}

// ── Execute a reasoner/skill synchronously ───────────────────
export async function execute(target, input) {
  return request(`/execute/${target}`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  })
}

// ── Submit a ticket (calls triage-orchestrator.handle_ticket) ─
export async function submitTicket(ticket) {
  return execute('triage-orchestrator.handle_ticket', ticket)
}

// ── Get execution details by ID ──────────────────────────────
export async function getExecution(executionId) {
  return request(`/executions/${executionId}`)
}

// ── List recent executions for a specific agent ──────────────
export async function listExecutions({ agent, limit = 20, status } = {}) {
  const params = new URLSearchParams()
  if (agent)  params.set('agent', agent)
  if (limit)  params.set('limit', limit)
  if (status) params.set('status', status)
  return request(`/executions?${params}`)
}

// ── List registered agents (discovery) ──────────────────────
export async function listAgents() {
  return request('/agents')
}

// ── Get agent health / status ────────────────────────────────
export async function getAgentStatus(nodeId) {
  return request(`/agents/${nodeId}`)
}

// ── List escalation cases (via escalation-agent skill) ───────
export async function listEscalations(limit = 20) {
  return execute('escalation-agent.list_cases', { limit })
}

// ── Control plane health ─────────────────────────────────────
export async function getHealth() {
  const res = await fetch('/api/health')
  return res.ok ? res.json() : { status: 'unreachable' }
}
