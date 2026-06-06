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
                    Your ticket will flow through 4 AI agents in real time.
                  </div>
                  <div style={styles.flowPreview}>
                    {['📥 Intake', '⚡ Fan-out', '💬 Sentiment', '⏱️ SLA', '🎯 Route', '🚨 Escalate?'].map((s, i, arr) => (
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
          <div style={styles.singleCol}>
            <div style={styles.archCard}>
              <div style={styles.archTitle}>System Architecture</div>
              <p style={styles.archDesc}>
                This system runs 6 Docker containers connected via an internal bridge network.
                All inter-agent communication flows through the AgentField control plane — never directly between agents.
              </p>

              {/* Architecture diagram */}
              <div style={styles.archDiagram}>
                {/* UI */}
                <div style={styles.archBox('#38bdf8')}>
                  <div style={styles.archBoxTitle}>React UI</div>
                  <div style={styles.archBoxSub}>Port 3000</div>
                  <div style={styles.archBoxDetail}>Nginx reverse proxy</div>
                </div>
                <div style={styles.archArrow}>→</div>
                {/* Control plane */}
                <div style={styles.archBox('#a78bfa')}>
                  <div style={styles.archBoxTitle}>AgentField</div>
                  <div style={styles.archBoxSub}>Control Plane · Port 8080</div>
                  <div style={styles.archBoxDetail}>Routing · Memory · DAG · Policy</div>
                </div>
                <div style={styles.archArrow}>→</div>
                {/* Agents */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    { label: 'triage-orchestrator', port: 9001, color: '#38bdf8' },
                    { label: 'sentiment-agent',     port: 9002, color: '#fbbf24' },
                    { label: 'sla-agent',           port: 9003, color: '#34d399' },
                    { label: 'escalation-agent',    port: 9004, color: '#f87171' },
                  ].map(a => (
                    <div key={a.label} style={{ ...styles.archBox(a.color), padding: '8px 14px' }}>
                      <div style={{ ...styles.archBoxTitle, fontSize: 12 }}>{a.label}</div>
                      <div style={{ ...styles.archBoxSub, fontSize: 10 }}>Port {a.port}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tech stack table */}
              <div style={styles.stackGrid}>
                {[
                  { layer: 'Frontend',       tech: 'React 18 + Vite',          note: 'Served by nginx in Docker' },
                  { layer: 'Reverse Proxy',  tech: 'nginx',                     note: '/api/* → agentfield-server:8080' },
                  { layer: 'Control Plane',  tech: 'AgentField (Go binary)',     note: 'Routing, memory, DAG tracking, audit' },
                  { layer: 'Orchestrator',   tech: 'Python 3.11 + agentfield',  note: 'Parallel fan-out, AI routing' },
                  { layer: 'Sentiment',      tech: 'Python + Claude Sonnet',     note: 'Structured output via Pydantic' },
                  { layer: 'SLA',            tech: 'Python (Skill — no LLM)',   note: 'Pure deterministic lookup' },
                  { layer: 'Escalation',     tech: 'Python + Claude Sonnet',     note: 'AI-drafted alerts, global memory' },
                  { layer: 'Networking',     tech: 'Docker bridge network',      note: 'Agents communicate via agentfield-net' },
                ].map(row => (
                  <div key={row.layer} style={styles.stackRow}>
                    <span style={styles.stackLayer}>{row.layer}</span>
                    <span style={styles.stackTech}>{row.tech}</span>
                    <span style={styles.stackNote}>{row.note}</span>
                  </div>
                ))}
              </div>

              {/* Quick commands */}
              <div style={styles.archCode}>
                <div style={styles.archCodeTitle}>Quick Start</div>
                <pre style={styles.archPre}>{`# 1. Copy and fill your API key
cp .env.example .env
echo "ANTHROPIC_API_KEY=sk-ant-..." >> .env

# 2. Build and start everything
docker compose up --build

# 3. Open the UI
open http://localhost:3000

# 4. View AgentField dashboard
open http://localhost:8080

# 5. Watch logs for all agents
docker compose logs -f`}</pre>
              </div>
            </div>
          </div>
        )}
      </main>
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
    display: 'flex', alignItems: 'center', gap: 16,
    padding: 20, background: 'var(--bg3)',
    border: '1px solid var(--border)', borderRadius: 10,
    overflowX: 'auto',
  },
  archArrow: { fontSize: 20, color: 'var(--text3)', flexShrink: 0 },
  archBox: (color) => ({
    background: color + '10', border: `1px solid ${color}44`,
    borderRadius: 10, padding: '14px 18px', minWidth: 160, textAlign: 'center',
  }),
  archBoxTitle: { fontSize: 13, fontWeight: 700, color: 'var(--text)', marginBottom: 3 },
  archBoxSub: { fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text3)' },
  archBoxDetail: { fontSize: 10, color: 'var(--text3)', marginTop: 4 },

  stackGrid: { display: 'flex', flexDirection: 'column', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' },
  stackRow: {
    display: 'grid', gridTemplateColumns: '140px 200px 1fr',
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
