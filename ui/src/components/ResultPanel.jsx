import { useState } from 'react'

const TEAM_ICONS = {
  'support-engineering': '🛠️',
  'billing':             '💳',
  'general':             '💬',
  'sales':               '📈',
}

const URGENCY_COLORS = {
  low:      { bg: 'rgba(52,211,153,0.08)',  border: 'rgba(52,211,153,0.25)',  text: '#34d399' },
  medium:   { bg: 'rgba(251,191,36,0.08)',  border: 'rgba(251,191,36,0.25)',  text: '#fbbf24' },
  high:     { bg: 'rgba(251,146,60,0.08)',  border: 'rgba(251,146,60,0.25)',  text: '#fb923c' },
  critical: { bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', text: '#f87171' },
}

const SEVERITY_COLORS = {
  P1: { bg: 'rgba(248,113,113,0.15)', text: '#f87171' },
  P2: { bg: 'rgba(251,146,60,0.15)',  text: '#fb923c' },
  P3: { bg: 'rgba(251,191,36,0.15)',  text: '#fbbf24' },
}

function Badge({ label, color }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 9px', borderRadius: 4,
      fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
      background: color.bg, color: color.text,
      border: `1px solid ${color.border || color.text + '44'}`,
      textTransform: 'uppercase', letterSpacing: 0.5,
    }}>
      {label}
    </span>
  )
}

function Meter({ value, max = 10, color }) {
  const pct = Math.min(100, (value / max) * 100)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text2)', minWidth: 20 }}>{value}</span>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, minWidth: 120, paddingTop: 2 }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text)' }}>{children}</span>
    </div>
  )
}

export default function ResultPanel({ result, executionId, durationMs, status, error }) {
  const [showRaw, setShowRaw] = useState(false)

  if (status === 'failed') {
    return (
      <div style={{ ...styles.card, borderColor: 'rgba(248,113,113,0.3)' }}>
        <div style={styles.errorHeader}>
          <span>❌ Execution Failed</span>
          {executionId && <span style={styles.execId}>{executionId}</span>}
        </div>
        <div style={styles.errorBody}>
          <p style={{ color: 'var(--red)', marginBottom: 8 }}>{error}</p>
          <p style={{ color: 'var(--text2)', fontSize: 12 }}>
            Check that all 4 agent containers are running and healthy. The control plane must be reachable at port 8080.
          </p>
        </div>
      </div>
    )
  }

  if (!result) return null

  const sentiment = result.sentiment || {}
  const escalation = result.escalation
  const urg = URGENCY_COLORS[sentiment.urgency] || URGENCY_COLORS.low
  const teamIcon = TEAM_ICONS[result.team] || '📋'
  const confidencePct = Math.round((result.confidence || 0) * 100)

  return (
    <div style={styles.card}>
      {/* ── Header ─────────────────────────────────────────── */}
      <div style={styles.header}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={styles.successDot} />
          <span style={styles.headerTitle}>Triage Complete</span>
          <span style={{ fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace' }}>
            {durationMs ? `${(durationMs / 1000).toFixed(2)}s` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {executionId && (
            <span style={styles.execId}>{executionId}</span>
          )}
          <button style={styles.rawToggle} onClick={() => setShowRaw(r => !r)}>
            {showRaw ? 'formatted' : 'raw json'}
          </button>
        </div>
      </div>

      {showRaw ? (
        <div style={styles.rawJson}>
          <pre>{JSON.stringify({ executionId, durationMs, result }, null, 2)}</pre>
        </div>
      ) : (
        <>
          {/* ── Hero Cards ─────────────────────────────────── */}
          <div style={styles.heroGrid}>
            {/* Routed to */}
            <div style={styles.heroCard}>
              <div style={styles.heroIcon}>{teamIcon}</div>
              <div style={styles.heroLabel}>Routed To</div>
              <div style={styles.heroValue}>{result.team?.replace('-', ' ') || '—'}</div>
              <div style={styles.heroSub}>confidence {confidencePct}%</div>
            </div>

            {/* SLA */}
            <div style={styles.heroCard}>
              <div style={styles.heroIcon}>⏱️</div>
              <div style={styles.heroLabel}>SLA Target</div>
              <div style={styles.heroValue}>{result.sla_minutes >= 60 ? `${result.sla_minutes / 60}h` : `${result.sla_minutes}m`}</div>
              <div style={styles.heroSub}>{result.priority_boost ? '⬆ priority boost' : 'standard priority'}</div>
            </div>

            {/* Urgency */}
            <div style={{ ...styles.heroCard, background: urg.bg, borderColor: urg.border }}>
              <div style={styles.heroIcon}>🎯</div>
              <div style={styles.heroLabel}>Urgency</div>
              <div style={{ ...styles.heroValue, color: urg.text }}>{sentiment.urgency || '—'}</div>
              <div style={styles.heroSub}>{sentiment.label || ''}</div>
            </div>

            {/* Escalated */}
            <div style={{
              ...styles.heroCard,
              background: result.escalated ? 'rgba(248,113,113,0.08)' : 'rgba(52,211,153,0.05)',
              borderColor: result.escalated ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.2)',
            }}>
              <div style={styles.heroIcon}>{result.escalated ? '🚨' : '✅'}</div>
              <div style={styles.heroLabel}>Escalation</div>
              <div style={{ ...styles.heroValue, color: result.escalated ? '#f87171' : '#34d399' }}>
                {result.escalated ? 'Escalated' : 'Not needed'}
              </div>
              <div style={styles.heroSub}>{result.escalated ? escalation?.case_id || '' : 'handled normally'}</div>
            </div>
          </div>

          {/* ── Summary ────────────────────────────────────── */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>AI Summary</div>
            <p style={{ color: 'var(--text2)', fontSize: 13, lineHeight: 1.65, fontStyle: 'italic' }}>
              "{result.summary}"
            </p>
          </div>

          {/* ── Sentiment Detail ───────────────────────────── */}
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Sentiment Analysis</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              <Row label="Emotion">
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: urg.text }}>
                  {sentiment.key_emotion || '—'}
                </span>
              </Row>
              <Row label="Tone">
                <Badge label={sentiment.label || '—'} color={urg} />
              </Row>
              <Row label="Frustration">
                <Meter value={sentiment.frustration_level || 0} max={10} color={urg.text} />
              </Row>
              <Row label="Threat Signal">
                {sentiment.contains_threat ? (
                  <span style={{ color: '#f87171', fontSize: 12, fontWeight: 600 }}>⚠️ YES — Customer mentioned cancellation or escalation</span>
                ) : (
                  <span style={{ color: '#34d399', fontSize: 12 }}>✓ None detected</span>
                )}
              </Row>
            </div>
          </div>

          {/* ── Escalation Case ────────────────────────────── */}
          {escalation && (
            <div style={{ ...styles.section, borderTop: '1px solid rgba(248,113,113,0.2)', background: 'rgba(248,113,113,0.03)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <div style={styles.sectionTitle}>🚨 Escalation Case</div>
                <span style={{
                  ...SEVERITY_COLORS[escalation.severity],
                  padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {escalation.severity}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                <Row label="Case ID">
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: '#f87171' }}>{escalation.case_id}</span>
                </Row>
                <Row label="Alert Message">
                  <span style={{ color: 'var(--text)', lineHeight: 1.55 }}>{escalation.alert_message}</span>
                </Row>
                <Row label="Action Required">
                  <span style={{ color: '#fbbf24', lineHeight: 1.55 }}>{escalation.action_required}</span>
                </Row>
              </div>
            </div>
          )}

          {/* ── Ticket ID ──────────────────────────────────── */}
          <div style={styles.footer}>
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>Ticket ID</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--accent)' }}>
              {result.ticket_id}
            </span>
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>Processed</span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text2)' }}>
              {result.processed_at ? new Date(result.processed_at).toLocaleTimeString() : '—'}
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
    animation: 'fadeInUp 0.35s ease',
  },
  header: {
    padding: '14px 20px',
    background: 'var(--bg3)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  successDot: {
    width: 8, height: 8, borderRadius: '50%',
    background: 'var(--green)',
    boxShadow: '0 0 6px var(--green)',
  },
  headerTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  execId: {
    fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
    color: 'var(--text3)', background: 'var(--bg)', padding: '2px 7px',
    borderRadius: 4, border: '1px solid var(--border)',
  },
  rawToggle: {
    background: 'none', border: '1px solid var(--border2)', borderRadius: 4,
    color: 'var(--text3)', fontSize: 11, padding: '3px 8px',
    cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
  },
  heroGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 0,
    borderBottom: '1px solid var(--border)',
  },
  heroCard: {
    padding: '18px 16px',
    borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', gap: 3,
    background: 'var(--bg2)',
  },
  heroIcon: { fontSize: 18, marginBottom: 4 },
  heroLabel: { fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1 },
  heroValue: { fontSize: 16, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize' },
  heroSub: { fontSize: 11, color: 'var(--text3)' },
  section: { padding: '16px 20px', borderBottom: '1px solid var(--border)' },
  sectionTitle: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 },
  rawJson: { padding: 20, overflowX: 'auto', fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text2)', lineHeight: 1.6 },
  errorHeader: {
    padding: '14px 20px', background: 'rgba(248,113,113,0.08)',
    borderBottom: '1px solid rgba(248,113,113,0.2)',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 14, fontWeight: 600, color: '#f87171',
  },
  errorBody: { padding: 20 },
  footer: {
    padding: '10px 20px',
    background: 'var(--bg3)',
    display: 'flex', gap: 16, alignItems: 'center',
  },
}
