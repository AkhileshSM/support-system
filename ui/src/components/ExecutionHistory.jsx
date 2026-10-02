const URGENCY_COLORS = {
  low:      '#34d399',
  medium:   '#fbbf24',
  high:     '#fb923c',
  critical: '#f87171',
}

const URGENCY_ICONS = {
  low: '🟢', medium: '🟡', high: '🟠', critical: '🔴',
}

export default function ExecutionHistory({ entries, onClear }) {
  if (entries.length === 0) {
    return (
      <div style={styles.empty}>
        <span style={styles.emptyIcon}>📋</span>
        <span style={styles.emptyText}>Ticket history will appear here</span>
        <span style={styles.emptyHint}>Submit your first ticket above</span>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Session History</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.count}>{entries.length} ticket{entries.length !== 1 ? 's' : ''}</span>
          <button style={styles.clearBtn} onClick={onClear}>clear</button>
        </div>
      </div>

      <div style={styles.list}>
        {entries.map((entry, i) => {
          const r = entry.result || {}
          const sentiment = r.sentiment || {}
          const urgency = sentiment.urgency || 'low'
          const urgColor = URGENCY_COLORS[urgency] || '#64748b'
          const urgIcon  = URGENCY_ICONS[urgency] || '⚪'

          return (
            <div key={entry.id} style={{ ...styles.row, animationDelay: `${i * 0.04}s` }}>
              {/* Left: urgency bar */}
              <div style={{ width: 3, alignSelf: 'stretch', background: urgColor, borderRadius: 2, flexShrink: 0 }} />

              {/* Content */}
              <div style={styles.rowContent}>
                <div style={styles.rowTop}>
                  <span style={styles.rowSubject}>{entry.ticket?.subject || '—'}</span>
                  <div style={styles.rowMeta}>
                    <span style={{ ...styles.badge, color: urgColor, borderColor: urgColor + '44', background: urgColor + '12' }}>
                      {urgIcon} {urgency}
                    </span>
                    {r.decision_path && (
                      <span style={{
                        ...styles.badge,
                        color: r.decision_path === 'fast' ? '#34d399' : '#38bdf8',
                        borderColor: r.decision_path === 'fast' ? '#34d39944' : '#38bdf844',
                        background: r.decision_path === 'fast' ? 'rgba(52,211,153,0.1)' : 'rgba(56,189,248,0.1)',
                      }}>
                        {r.decision_path} path
                      </span>
                    )}
                    {r.escalated && (
                      <span style={{ ...styles.badge, color: '#f87171', borderColor: '#f87171aa', background: 'rgba(248,113,113,0.1)' }}>
                        🚨 escalated
                      </span>
                    )}
                    <span style={styles.tier}>{entry.ticket?.account_tier}</span>
                  </div>
                </div>

                <div style={styles.rowBottom}>
                  <span style={styles.team}>
                    → {r.team?.replace('-', ' ') || 'pending'}
                  </span>
                  {r.summary && (
                    <span style={styles.summary}>{r.summary}</span>
                  )}
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 10, flexShrink: 0 }}>
                    <span style={styles.rowId}>{entry.ticket?.ticket_id}</span>
                    <span style={styles.rowTime}>
                      {entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : ''}
                    </span>
                    <span style={styles.rowTime}>
                      {entry.submittedAt ? new Date(entry.submittedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  container: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  header: {
    padding: '12px 16px',
    background: 'var(--bg3)',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1 },
  count: { fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace' },
  clearBtn: {
    background: 'none', border: '1px solid var(--border2)', borderRadius: 4,
    color: 'var(--text3)', fontSize: 11, padding: '2px 7px', cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
  },
  list: { display: 'flex', flexDirection: 'column', maxHeight: 400, overflowY: 'auto' },
  row: {
    display: 'flex',
    gap: 12,
    padding: '10px 16px 10px 12px',
    borderBottom: '1px solid var(--border)',
    animation: 'slide-in 0.25s ease both',
    transition: 'background 0.15s',
    cursor: 'default',
  },
  rowContent: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 5 },
  rowTop: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowSubject: { fontSize: 13, fontWeight: 500, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  rowMeta: { display: 'flex', gap: 5, flexShrink: 0 },
  badge: {
    fontSize: 10, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
    padding: '2px 6px', borderRadius: 3, border: '1px solid',
    textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap',
  },
  tier: {
    fontSize: 10, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace',
    background: 'var(--bg3)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--border)',
    textTransform: 'uppercase',
  },
  rowBottom: { display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' },
  team: { fontSize: 12, fontWeight: 600, color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 },
  summary: { fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, fontStyle: 'italic' },
  rowId: { fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text3)' },
  rowTime: { fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 6, padding: '36px 20px',
    background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 12,
  },
  emptyIcon: { fontSize: 28, opacity: 0.3 },
  emptyText: { fontSize: 13, color: 'var(--text3)', fontWeight: 500 },
  emptyHint: { fontSize: 12, color: 'var(--text3)', opacity: 0.6 },
}
