import { useAgents, KNOWN_AGENTS } from '../hooks/useAgents'

function StatusDot({ status }) {
  const color = status === 'online' ? '#34d399' : status === 'unknown' ? '#fbbf24' : '#f87171'
  return (
    <span style={{
      display: 'inline-block',
      width: 7, height: 7, borderRadius: '50%',
      background: color,
      boxShadow: status === 'online' ? `0 0 5px ${color}` : 'none',
      animation: status === 'online' ? 'pulse-dot 2.5s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  )
}

export default function AgentStatusBar() {
  const { agents, cpHealth, lastChecked } = useAgents()

  // Build a map from the live data for quick lookup
  const agentMap = {}
  agents.forEach(a => { agentMap[a.node_id || a.id] = a })

  const cpColor = cpHealth === 'ok' ? '#34d399' : cpHealth === 'down' ? '#f87171' : '#fbbf24'
  const checkedStr = lastChecked
    ? lastChecked.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'

  return (
    <div style={styles.bar}>
      {/* Control plane */}
      <div style={styles.cpSection}>
        <StatusDot status={cpHealth === 'ok' ? 'online' : cpHealth === 'down' ? 'offline' : 'unknown'} />
        <span style={{ fontSize: 11, fontWeight: 600, color: cpColor, fontFamily: 'JetBrains Mono, monospace' }}>
          Control Plane
        </span>
      </div>

      <div style={styles.divider} />

      {/* Individual agents */}
      <div style={styles.agentRow}>
        {KNOWN_AGENTS.map(agent => {
          const live = agentMap[agent.id]
          const status = live ? 'online' : cpHealth === 'ok' ? 'unknown' : 'offline'
          return (
            <div key={agent.id} style={styles.agentChip}>
              <StatusDot status={status} />
              <span style={styles.agentIcon}>{agent.icon}</span>
              <span style={{ fontSize: 12, color: status === 'online' ? 'var(--text)' : 'var(--text3)' }}>
                {agent.label}
              </span>
              {live?.version && (
                <span style={styles.version}>v{live.version}</span>
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={styles.timestamp}>Last checked: {checkedStr}</span>
      </div>
    </div>
  )
}

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 20px',
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  cpSection: { display: 'flex', alignItems: 'center', gap: 6 },
  divider: { width: 1, height: 16, background: 'var(--border2)' },
  agentRow: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  agentChip: { display: 'flex', alignItems: 'center', gap: 5 },
  agentIcon: { fontSize: 12 },
  version: {
    fontSize: 10,
    fontFamily: 'JetBrains Mono, monospace',
    color: 'var(--text3)',
    background: 'var(--bg3)',
    padding: '1px 4px',
    borderRadius: 3,
  },
  timestamp: { fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace' },
}
