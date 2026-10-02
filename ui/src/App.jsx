import { useState } from 'react'
import AgentStatusBar from './components/AgentStatusBar'
import TicketForm     from './components/TicketForm'
import ResultPanel    from './components/ResultPanel'
import ExecutionHistory from './components/ExecutionHistory'
import PipelineTrace  from './components/PipelineTrace'
import { useExecution } from './hooks/useExecution'
import { useHistory }   from './hooks/useHistory'

export default function App() {
  const exec    = useExecution()
  const history = useHistory()
  const [activeTab, setActiveTab] = useState('form')   // 'form' | 'history' | 'about'

  async function handleSubmit(ticketData) {
    await exec.submit(ticketData)
    if (exec.status !== 'failed') {
      // Will be captured after re-render via effect — use a small defer
      setTimeout(() => {
        history.addEntry(ticketData, exec)
      }, 100)
    }
  }

  // Capture result after state settles
  function handleSubmitAndRecord(ticketData) {
    exec.reset()
    const startTs = Date.now()

    import('./utils/api').then(({ submitTicket }) => {
      submitTicket(ticketData)
        .then(data => {
          const entry = {
            status: data.status === 'succeeded' ? 'succeeded' : 'failed',
            result: data.result ?? data,
            error: data.status === 'failed' ? (data.error || 'Execution failed') : null,
            executionId: data.execution_id,
            durationMs: data.duration_ms ?? (Date.now() - startTs),
          }

          // Update execution display state
          exec.submit.__setState?.(entry) // fallback: handled below

          history.addEntry(ticketData, entry)

          // Directly set via internal approach
          _setDisplay(entry)
        })
        .catch(err => {
          const entry = {
            status: 'failed',
            error: err.message,
            result: null,
            executionId: null,
            durationMs: Date.now() - startTs,
          }
          history.addEntry(ticketData, entry)
          _setDisplay(entry)
        })
    })
  }

  const [display, _setDisplay] = useState(null)

  function onFormSubmit(ticketData) {
    _setDisplay({ status: 'submitting' })
    handleSubmitAndRecord(ticketData)
  }

  const isSubmitting = display?.status === 'submitting'

  return (
    <div style={styles.root}>
      {/* ── Top Header ─────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logo}>
            <span style={styles.logoIcon}>⚡</span>
            <div>
              <div style={styles.logoTitle}>Support Triage</div>
              <div style={styles.logoSub}>Powered by AgentField</div>
            </div>
          </div>
        </div>

        <nav style={styles.nav}>
          {[
            { id: 'form',    label: '📨 Triage' },
            { id: 'history', label: `📋 History ${history.entries.length > 0 ? `(${history.entries.length})` : ''}` },
            { id: 'about',   label: '🏗️ Architecture' },
          ].map(tab => (
            <button
              key={tab.id}
              style={{ ...styles.navBtn, ...(activeTab === tab.id ? styles.navActive : {}) }}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div style={styles.headerRight}>
          <a href="http://localhost:8080" target="_blank" rel="noreferrer" style={styles.dashLink}>
            Open Dashboard ↗
          </a>
        </div>
      </header>

      {/* ── Agent Status Bar ───────────────────────────────── */}
      <AgentStatusBar />

      {/* ── Main Content ───────────────────────────────────── */}
      <main style={styles.main}>

        {/* ════════════ TRIAGE TAB ════════════ */}
        {activeTab === 'form' && (
          <div style={styles.triageLayout}>
            {/* Left column — form */}
            <div style={styles.leftCol}>
              <TicketForm onSubmit={onFormSubmit} isSubmitting={isSubmitting} />
            </div>

            {/* Right column — results + pipeline */}
            <div style={styles.rightCol}>
              {/* Pipeline trace — shows while running and after */}
              {(isSubmitting || display?.status === 'succeeded' || display?.status === 'failed') && (
                <PipelineTrace
                  executionResult={display?.status === 'succeeded' ? display.result : null}
                  isRunning={isSubmitting}
                />
              )}

              {/* Result panel */}
              {display && display.status !== 'submitting' && (
                <ResultPanel
                  result={display.result}
                  executionId={display.executionId}
                  durationMs={display.durationMs}
                  status={display.status}
                  error={display.error}
                />
              )}

              {/* Empty state */}
              {!display && (
                <div style={styles.emptyRight}>
                  <div style={styles.emptyRightIcon}>🤖</div>
                  <div style={styles.emptyRightTitle}>Ready to triage</div>
                  <div style={styles.emptyRightDesc}>
                    Fill in the form and click <strong>Run Triage Pipeline</strong>.<br/>
                    Your ticket will flow through the decision gate, then the rest of the pipeline.
                  </div>
                  <div style={styles.flowPreview}>
                    {['📥 Intake', '🚦 Gate', '⏱️ SLA', '💬 Sentiment', '🎯 Route', '🚨 Escalate?'].map((s, i, arr) => (
                      <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={styles.flowStep}>{s}</span>
                        {i < arr.length - 1 && <span style={{ color: 'var(--text3)' }}>→</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ════════════ HISTORY TAB ════════════ */}
        {activeTab === 'history' && (
          <div style={styles.singleCol}>
            <ExecutionHistory entries={history.entries} onClear={history.clear} />
          </div>
        )}

        {/* ════════════ ARCHITECTURE TAB ════════════ */}
        {activeTab === 'about' && (
          <div style={styles.archPage}>
            <ArchitecturePanel />
          </div>
        )}
      </main>
    </div>
  )
}

const SERVICES = [
  { label: 'triage-orchestrator', port: 9001, color: '#38bdf8', role: 'Reasoner · chooses fast or full' },
  { label: 'gate-agent',          port: 9005, color: '#c4b5fd', role: 'Skill · one /v1/systemone call' },
  { label: 'sentiment-agent',     port: 9002, color: '#fbbf24', role: 'Reasoner · full path only' },
  { label: 'sla-agent',           port: 9003, color: '#34d399', role: 'Skill · SLA minutes, no LLM' },
  { label: 'escalation-agent',    port: 9004, color: '#f87171', role: 'Reasoner · only if escalate' },
]

const FLOW = [
  {
    kicker: 'Every ticket',
    color: '#a78bfa',
    steps: [
      'UI posts the ticket to triage-orchestrator.handle_ticket.',
      'The orchestrator stores the ticket, then calls gate-agent.decide and sla-agent.get_policy together.',
      'gate-agent sends subject, body, and account tier to Ollama POST /v1/systemone (tev1:0.8b).',
      'A timeout, a missing model, or a bad response comes back as ok: false. The ticket continues.',
    ],
  },
  {
    kicker: 'Fast path',
    color: '#34d399',
    steps: [
      'Used when the gate is ok, confidence is at least 0.7, urgency is not critical, and needs_escalation is false.',
      'Enterprise accounts with high urgency stay on the full path, because that case already escalates.',
      'Team and summary come from the gate. The summary is the subject, with no extra model call.',
      'Sentiment on the result is filled in from the gate so the response shape stays the same.',
      'sentiment-agent.analyze and the routing app.ai() call do not run.',
    ],
  },
  {
    kicker: 'Full path',
    color: '#38bdf8',
    steps: [
      'Used when the gate is unsure, unavailable, marks the ticket critical, or flags escalation.',
      'sentiment-agent.analyze reads tone, urgency, frustration, and threat.',
      'The orchestrator app.ai() call picks team, summary, confidence, and whether to escalate.',
      'Escalation runs only here. escalation-agent.create_case drafts the alert and stores the case.',
    ],
  },
]

const STACK = [
  { layer: 'Frontend',      tech: 'React 18 + Vite',         note: 'Served by nginx in Docker on port 3000' },
  { layer: 'Reverse Proxy', tech: 'nginx',                   note: '/api/* → agentfield-server:8080' },
  { layer: 'Control Plane', tech: 'AgentField',              note: 'Routing, memory, execution DAG, audit' },
  { layer: 'Orchestrator',  tech: 'Python 3.11 · port 9001', note: 'Gate plus SLA in parallel, then fast or full' },
  { layer: 'Decision gate', tech: 'Ollama /v1/systemone',    note: 'gate-agent :9005 · tev1:0.8b · 3s timeout' },
  { layer: 'Chat models',   tech: 'Ollama gemma4:31b-cloud', note: 'Sentiment, routing, and escalation on the full path' },
  { layer: 'SLA',           tech: 'Python skill · port 9003', note: 'Deterministic minutes and priority boost' },
  { layer: 'Escalation',    tech: 'Python · port 9004',      note: 'Alert draft stored in global memory' },
  { layer: 'Models',        tech: 'Host Ollama :11434',      note: 'Containers use host.docker.internal, not localhost' },
]

export function ArchitecturePanel() {
  return (
    <div style={styles.archCard}>
      <div style={styles.archTitle}>System Architecture</div>
      <p style={styles.archDesc}>
        Seven containers share the <span style={styles.inlineCode}>agentfield-net</span> bridge.
        The UI talks only to the AgentField control plane, and agents call each other through that plane.
        <span style={styles.inlineCode}>gate-agent</span> asks local Ollama
        <span style={styles.inlineCode}>POST /v1/systemone</span> once.
        A confident answer skips the sentiment and routing models. An unsure answer, a gate error, or an escalation candidate runs the original pipeline.
      </p>

      <div style={styles.archDiagram}>
        <div style={styles.archBox('#38bdf8')}>
          <div style={styles.archBoxTitle}>React UI</div>
          <div style={styles.archBoxSub}>Port 3000</div>
          <div style={styles.archBoxDetail}>Nginx serves the app and proxies /api</div>
        </div>
        <div style={styles.archArrow}>→</div>
        <div style={styles.archBox('#a78bfa')}>
          <div style={styles.archBoxTitle}>AgentField</div>
          <div style={styles.archBoxSub}>Control plane · port 8080</div>
          <div style={styles.archBoxDetail}>Routing · memory · DAG · audit</div>
        </div>
        <div style={styles.archArrow}>→</div>
        <div style={styles.serviceCol}>
          {SERVICES.map(service => (
            <div key={service.label} style={{ ...styles.archBox(service.color), padding: '8px 14px', minWidth: 0, textAlign: 'left' }}>
              <div style={{ ...styles.archBoxTitle, fontSize: 12 }}>{service.label}</div>
              <div style={{ ...styles.archBoxSub, fontSize: 10 }}>Port {service.port}</div>
              <div style={styles.archBoxDetail}>{service.role}</div>
            </div>
          ))}
        </div>
        <div style={styles.archArrow}>→</div>
        <div style={styles.archBox('#c4b5fd')}>
          <div style={styles.archBoxTitle}>Ollama</div>
          <div style={styles.archBoxSub}>Host port 11434</div>
          <div style={styles.archBoxDetail}>tev1:0.8b for the gate</div>
          <div style={styles.archBoxDetail}>gemma4:31b-cloud for chat</div>
        </div>
      </div>

      <div>
        <div style={styles.blockLabel}>Ticket flow</div>
        <div style={styles.pathGrid}>
          {FLOW.map(column => (
            <div key={column.kicker} style={{ ...styles.pathCard, borderColor: column.color + '55' }}>
              <div style={{ ...styles.pathKicker, color: column.color }}>{column.kicker}</div>
              <ol style={styles.stepList}>
                {column.steps.map(step => (
                  <li key={step} style={styles.step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={styles.blockLabel}>What the result adds</div>
        <div style={styles.stackGrid}>
          {[
            { field: 'decision_path', detail: '"fast" or "full". Shown on the result and in history.' },
            { field: 'gate', detail: 'Team, urgency, threat, escalation, frustration, confidence. ok: false carries the error.' },
            { field: 'gate_latency_ms', detail: 'How long the /v1/systemone call took.' },
          ].map(row => (
            <div key={row.field} style={styles.stackRow}>
              <span style={styles.stackTech}>{row.field}</span>
              <span style={{ ...styles.stackNote, gridColumn: '2 / -1' }}>{row.detail}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={styles.stackGrid}>
        {STACK.map(row => (
          <div key={row.layer} style={styles.stackRow}>
            <span style={styles.stackLayer}>{row.layer}</span>
            <span style={styles.stackTech}>{row.tech}</span>
            <span style={styles.stackNote}>{row.note}</span>
          </div>
        ))}
      </div>

      <div style={styles.archCode}>
        <div style={styles.archCodeTitle}>Quick Start</div>
        <pre style={styles.archPre}>{`# Ollama 0.35 or newer, then the gate model
ollama pull tev1:0.8b
make pull-gate-model

# Copy env. Containers reach Ollama at host.docker.internal:11434
cp .env.example .env
make up

# UI and control plane
open http://localhost:3000
open http://localhost:8080`}</pre>
      </div>
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────

function archBox(color) {
  return {
    background: color + '10',
    border: `1px solid ${color}44`,
    borderRadius: 10,
    padding: '14px 18px',
    minWidth: 160,
    textAlign: 'center',
  }
}

const styles = {
  root: { display: 'flex', flexDirection: 'column', minHeight: '100vh' },

  header: {
    display: 'flex', alignItems: 'center', gap: 16,
    padding: '12px 24px',
    background: 'var(--bg2)',
    borderBottom: '1px solid var(--border)',
    position: 'sticky', top: 0, zIndex: 50,
  },
  headerLeft: { display: 'flex', alignItems: 'center' },
  logo: { display: 'flex', alignItems: 'center', gap: 10 },
  logoIcon: {
    width: 32, height: 32, borderRadius: 8,
    background: 'linear-gradient(135deg, #6ee7f7, #a78bfa)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16,
  },
  logoTitle: { fontSize: 15, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 },
  logoSub: { fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace' },

  nav: { display: 'flex', gap: 4, marginLeft: 'auto' },
  navBtn: {
    background: 'none', border: '1px solid transparent', borderRadius: 7,
    color: 'var(--text2)', fontSize: 13, fontWeight: 500, padding: '6px 14px',
    cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit',
  },
  navActive: {
    background: 'rgba(110,231,247,0.08)',
    border: '1px solid rgba(110,231,247,0.2)',
    color: 'var(--accent)',
  },
  headerRight: { display: 'flex', alignItems: 'center' },
  dashLink: {
    fontSize: 12, color: 'var(--text3)', textDecoration: 'none',
    padding: '5px 10px', borderRadius: 6,
    border: '1px solid var(--border2)',
    transition: 'color 0.15s',
    fontFamily: 'JetBrains Mono, monospace',
  },

  main: { flex: 1, padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' },

  triageLayout: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 20,
    alignItems: 'start',
  },
  leftCol:  { display: 'flex', flexDirection: 'column', gap: 16 },
  rightCol: { display: 'flex', flexDirection: 'column', gap: 16 },

  singleCol: { maxWidth: 900, margin: '0 auto', width: '100%' },
  archPage: { maxWidth: 1040, margin: '0 auto', width: '100%' },

  emptyRight: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: '48px 32px',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 12, textAlign: 'center',
  },
  emptyRightIcon: { fontSize: 40, marginBottom: 4, opacity: 0.5 },
  emptyRightTitle: { fontSize: 17, fontWeight: 600, color: 'var(--text)' },
  emptyRightDesc: { fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, maxWidth: 320 },
  flowPreview: {
    display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap',
    justifyContent: 'center', marginTop: 8,
  },
  flowStep: {
    fontSize: 11, color: 'var(--text3)',
    background: 'var(--bg3)', padding: '3px 8px',
    borderRadius: 4, border: '1px solid var(--border)',
  },

  archCard: {
    background: 'var(--bg2)', border: '1px solid var(--border)',
    borderRadius: 12, padding: 28,
    display: 'flex', flexDirection: 'column', gap: 24,
  },
  archTitle: { fontSize: 18, fontWeight: 700, color: 'var(--text)' },
  archDesc: { fontSize: 14, color: 'var(--text2)', lineHeight: 1.7 },
  archDiagram: {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 16,
    padding: 20, background: 'var(--bg3)',
    border: '1px solid var(--border)', borderRadius: 10,
  },
  serviceCol: { display: 'flex', flexDirection: 'column', gap: 8, flex: '1 1 220px', minWidth: 200 },
  blockLabel: {
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12,
  },
  pathGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
    gap: 12,
  },
  pathCard: {
    background: 'var(--bg3)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 14px 8px',
  },
  pathKicker: {
    fontSize: 12, fontWeight: 700, letterSpacing: 0.4,
    textTransform: 'uppercase', marginBottom: 8,
  },
  stepList: { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 8 },
  step: { fontSize: 12, color: 'var(--text2)', lineHeight: 1.55 },
  inlineCode: {
    fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
    color: 'var(--accent)', background: 'var(--bg3)',
    padding: '1px 5px', borderRadius: 4, margin: '0 3px',
  },
  archArrow: { fontSize: 20, color: 'var(--text3)', flexShrink: 0 },
  archBox: (color) => ({
    background: color + '10', border: `1px solid ${color}44`,
    borderRadius: 10, padding: '14px 18px', minWidth: 160, textAlign: 'center',
  }),
  archBoxTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 },
  archBoxSub: { fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text3)' },
  archBoxDetail: { fontSize: 10, color: 'var(--text3)', marginTop: 4 },

  stackGrid: { display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'auto' },
  stackRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(110px, 150px) minmax(150px, 220px) minmax(180px, 1fr)',
    gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
  stackLayer: { fontSize: 12, fontWeight: 600, color: 'var(--text2)' },
  stackTech: { fontSize: 12, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)' },
  stackNote: { fontSize: 12, color: 'var(--text3)' },

  archCode: {
    background: '#0d1117', border: '1px solid var(--border)',
    borderRadius: 10, overflow: 'hidden',
  },
  archCodeTitle: {
    padding: '10px 16px', background: 'var(--bg3)',
    borderBottom: '1px solid var(--border)',
    fontSize: 11, fontWeight: 600, color: 'var(--text3)',
    textTransform: 'uppercase', letterSpacing: 1,
  },
  archPre: {
    padding: 20, fontSize: 12, lineHeight: 1.7,
    fontFamily: 'JetBrains Mono, monospace', color: 'var(--text2)',
    overflowX: 'auto',
  },
}
