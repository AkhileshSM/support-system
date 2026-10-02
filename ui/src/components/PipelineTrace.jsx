/**
 * PipelineTrace.jsx — Visual execution flow showing
 * which agents ran and in what order for the last ticket.
 */

const STAGES = [
  {
    id: 'intake',
    label: 'Intake',
    agent: 'triage-orchestrator',
    icon: '📥',
    desc: 'Receives ticket & stores context in workflow memory',
    color: '#38bdf8',
  },
  {
    id: 'fanout',
    label: 'Fan-out',
    agent: 'parallel',
    icon: '⚡',
    desc: 'Decision gate + SLA run in parallel. Sentiment waits for the gate.',
    color: '#a78bfa',
  },
  {
    id: 'gate',
    label: 'Gate',
    agent: 'gate-agent',
    icon: '🚦',
    desc: 'One Ollama /v1/systemone call classifies team, urgency, threat, and escalation',
    color: '#c4b5fd',
  },
  {
    id: 'sla',
    label: 'SLA Lookup',
    agent: 'sla-agent',
    icon: '⏱️',
    desc: 'Deterministic skill — looks up SLA minutes for account tier',
    color: '#34d399',
  },
  {
    id: 'sentiment',
    label: 'Sentiment',
    agent: 'sentiment-agent',
    icon: '💬',
    desc: 'Full path only: tone, urgency, and frustration. Skipped when the gate is confident.',
    color: '#fbbf24',
  },
  {
    id: 'routing',
    label: 'AI Routing',
    agent: 'triage-orchestrator',
    icon: '🎯',
    desc: 'Full path only: app.ai() picks team and escalation. Skipped when the gate is confident.',
    color: '#38bdf8',
  },
  {
    id: 'escalation',
    label: 'Escalation',
    agent: 'escalation-agent',
    icon: '🚨',
    desc: 'If escalate=true: AI drafts alert, case stored in global memory',
    color: '#f87171',
  },
]

function Stage({ stage, active, done, skipped, result }) {
  const opacity = skipped ? 0.3 : 1
  const borderColor = done
    ? stage.color
    : active
    ? stage.color + 'aa'
    : 'var(--border)'
  const bg = done
    ? stage.color + '14'
    : active
    ? stage.color + '08'
    : 'var(--bg3)'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, opacity }}>
      {/* Icon + connector */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <div style={{
          width: 36, height: 36,
          borderRadius: '50%',
          background: bg,
          border: `2px solid ${borderColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16,
          transition: 'all 0.4s',
          boxShadow: done ? `0 0 10px ${stage.color}44` : 'none',
        }}>
          {done && !active ? '✓' : stage.icon}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, paddingTop: 6, paddingBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: done ? 'var(--text)' : 'var(--text3)' }}>
            {stage.label}
          </span>
          {skipped && (
            <span style={{
              fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--text3)', border: '1px solid var(--border2)',
              padding: '1px 6px', borderRadius: 3,
            }}>
              skipped
            </span>
          )}
          <span style={{
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            color: stage.color, background: stage.color + '15',
            padding: '1px 6px', borderRadius: 3, border: `1px solid ${stage.color}33`,
          }}>
            {stage.agent}
          </span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.55 }}>
          {stage.desc}
        </div>
        {(done || skipped) && result && (
          <div style={{
            marginTop: 6, padding: '6px 10px',
            background: stage.color + '10',
            border: `1px solid ${stage.color}33`,
            borderRadius: 6, fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'var(--text2)',
            maxWidth: '100%',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {result}
          </div>
        )}
      </div>
    </div>
  )
}

export default function PipelineTrace({ executionResult, isRunning }) {
  if (!executionResult && !isRunning) return null

  const r = executionResult || {}
  const sentiment = r.sentiment || {}
  const escalated = r.escalated
  const gate = r.gate || {}
  const fast = r.decision_path === 'fast'
  const gateConfidence = gate.confidence == null ? null : `${Math.round(gate.confidence * 100)}%`
  const gateLatency = r.gate_latency_ms == null ? '—' : `${r.gate_latency_ms}ms`

  // Build per-stage status
  const stageResults = {
    intake:     r.ticket_id ? `ticket_id=${r.ticket_id}` : null,
    fanout:     'asyncio.gather(gate-agent.decide, sla-agent.get_policy)',
    gate:       gate.ok
      ? `ok · confidence=${gateConfidence} · latency=${gateLatency} · path=${r.decision_path || '—'}`
      : (r.decision_path
          ? `unavailable — ${gate.error || 'error'} · path=${r.decision_path}`
          : null),
    sla:        r.sla_minutes ? `sla_minutes=${r.sla_minutes}  priority_boost=${r.priority_boost}` : null,
    sentiment:  fast
      ? 'skipped — fast path used the gate'
      : (sentiment.urgency ? `${sentiment.label} · urgency=${sentiment.urgency} · frustration=${sentiment.frustration_level}/10` : null),
    routing:    fast
      ? 'skipped — team taken from the gate'
      : (r.team ? `→ team=${r.team}  escalate=${r.escalated}  confidence=${Math.round((r.confidence||0)*100)}%` : null),
    escalation: r.escalation?.case_id ? `case_id=${r.escalation.case_id}  severity=${r.escalation.severity}` : (escalated === false ? 'skipped — escalation not needed' : null),
  }

  const allDone = !!executionResult

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.title}>Execution Pipeline</span>
        {isRunning && !allDone && (
          <span style={styles.running}>
            <span style={styles.runDot} />
            running
          </span>
        )}
        {allDone && (
          <span style={{ fontSize: 11, color: '#34d399', fontFamily: 'JetBrains Mono, monospace' }}>
            ✓ completed
          </span>
        )}
      </div>

      <div style={styles.stages}>
        {STAGES.map((stage, i) => {
          const skipped = allDone && (
            (stage.id === 'escalation' && !escalated) ||
            (fast && (stage.id === 'sentiment' || stage.id === 'routing'))
          )
          const done = allDone && !skipped
          const active = isRunning && !allDone

          return (
            <div key={stage.id} style={{ position: 'relative' }}>
              {i < STAGES.length - 1 && (
                <div style={{
                  position: 'absolute',
                  left: 17, top: 36,
                  width: 2, height: 'calc(100% - 20px)',
                  background: done ? stage.color + '40' : 'var(--border)',
                  transition: 'background 0.4s',
                }} />
              )}
              <Stage
                stage={stage}
                active={active}
                done={done}
                skipped={skipped}
                result={stageResults[stage.id]}
              />
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
    animation: 'fadeInUp 0.3s ease',
  },
  header: {
    padding: '12px 16px',
    background: 'var(--bg3)',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  title: { fontSize: 12, fontWeight: 600, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: 1 },
  running: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#fbbf24', fontFamily: 'JetBrains Mono, monospace' },
  runDot: {
    width: 7, height: 7, borderRadius: '50%',
    background: '#fbbf24',
    animation: 'pulse-dot 1s ease-in-out infinite',
  },
  stages: { padding: '16px 16px 4px' },
}
