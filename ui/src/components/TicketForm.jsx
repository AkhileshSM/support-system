import { useState } from 'react'

const TIERS = ['enterprise', 'pro', 'free']

const PRESETS = [
  {
    label: '🔴 Critical — Data Loss',
    subject: 'URGENT: All our production data has disappeared',
    body: 'We cannot access ANY of our customer records since this morning. Our entire database appears to be gone. This is completely catastrophic — we have a live demo in 2 hours and cannot function. I need someone on the phone NOW.',
    tier: 'enterprise',
  },
  {
    label: '🟠 High — Billing Issue',
    subject: 'Charged twice for the same invoice',
    body: "Hi, I noticed I was billed twice for invoice #INV-2048 this month — once on March 1st and again on March 3rd. I've already emailed billing three times with no response. This is really frustrating, please resolve ASAP.",
    tier: 'pro',
  },
  {
    label: '🟡 Medium — Feature Question',
    subject: 'How do I export data to CSV?',
    body: "I've been trying to figure out how to export my reports to CSV format but can't find the option anywhere. Is this a feature that exists? If so, where is it? If not, can it be added? Thanks in advance.",
    tier: 'free',
  },
  {
    label: '🟢 Low — Positive Feedback',
    subject: 'Just wanted to say your product is amazing',
    body: "I've been using your platform for 3 months now and it has completely transformed how our team operates. The API is incredibly well designed. Keep up the great work — looking forward to the roadmap features!",
    tier: 'pro',
  },
]

export default function TicketForm({ onSubmit, isSubmitting }) {
  const [form, setForm] = useState({
    ticket_id: `T-${Date.now().toString(36).toUpperCase()}`,
    subject: '',
    body: '',
    customer_id: `CUST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    account_tier: 'pro',
  })

  function set(field, value) {
    setForm(f => ({ ...f, [field]: value }))
  }

  function applyPreset(preset) {
    setForm(f => ({
      ...f,
      ticket_id: `T-${Date.now().toString(36).toUpperCase()}`,
      subject: preset.subject,
      body: preset.body,
      account_tier: preset.tier,
    }))
  }

  function regenerateIds() {
    setForm(f => ({
      ...f,
      ticket_id: `T-${Date.now().toString(36).toUpperCase()}`,
      customer_id: `CUST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.subject.trim() || !form.body.trim()) return
    onSubmit({ ...form })
    // Regenerate IDs for next submission
    regenerateIds()
  }

  const canSubmit = form.subject.trim() && form.body.trim() && !isSubmitting

  return (
    <div style={styles.card}>
      <div style={styles.cardHeader}>
        <span style={styles.cardTitle}>📨 Submit Support Ticket</span>
        <span style={styles.cardSub}>Powered by triage-orchestrator</span>
      </div>

      {/* ── Presets ────────────────────────────────────────── */}
      <div style={styles.presetsSection}>
        <div style={styles.presetsLabel}>Quick presets</div>
        <div style={styles.presets}>
          {PRESETS.map(p => (
            <button key={p.label} style={styles.presetBtn} onClick={() => applyPreset(p)} type="button">
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        {/* ── Meta row ─────────────────────────────────────── */}
        <div style={styles.metaRow}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Ticket ID</label>
            <div style={{ position: 'relative' }}>
              <input
                style={{ ...styles.input, ...styles.monoInput, paddingRight: 32 }}
                value={form.ticket_id}
                onChange={e => set('ticket_id', e.target.value)}
              />
              <button type="button" style={styles.regenBtn} onClick={regenerateIds} title="Regenerate IDs">↺</button>
            </div>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Customer ID</label>
            <input style={{ ...styles.input, ...styles.monoInput }} value={form.customer_id} onChange={e => set('customer_id', e.target.value)} />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Account Tier</label>
            <div style={styles.tierRow}>
              {TIERS.map(t => (
                <button
                  key={t}
                  type="button"
                  style={{ ...styles.tierBtn, ...(form.account_tier === t ? styles.tierActive : {}) }}
                  onClick={() => set('account_tier', t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Subject ──────────────────────────────────────── */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Subject</label>
          <input
            style={styles.input}
            placeholder="Briefly describe the issue..."
            value={form.subject}
            onChange={e => set('subject', e.target.value)}
            maxLength={200}
          />
        </div>

        {/* ── Body ─────────────────────────────────────────── */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Message</label>
          <textarea
            style={styles.textarea}
            placeholder="Describe the issue in detail. The AI agents will analyze sentiment, urgency, and determine the best team and escalation path..."
            value={form.body}
            onChange={e => set('body', e.target.value)}
            rows={6}
          />
          <div style={styles.charCount}>{form.body.length} chars</div>
        </div>

        {/* ── Submit ───────────────────────────────────────── */}
        <button type="submit" style={{ ...styles.submitBtn, opacity: canSubmit ? 1 : 0.4 }} disabled={!canSubmit}>
          {isSubmitting ? (
            <span style={styles.submitInner}>
              <span style={styles.spinner} /> Running the triage pipeline...
            </span>
          ) : (
            <span style={styles.submitInner}>⚡ Run Triage Pipeline</span>
          )}
        </button>
      </form>
    </div>
  )
}

const styles = {
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardHeader: {
    padding: '16px 20px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--bg3)',
  },
  cardTitle: { fontSize: 14, fontWeight: 600, color: 'var(--text)' },
  cardSub: { fontSize: 11, color: 'var(--text3)', fontFamily: 'JetBrains Mono, monospace' },
  presetsSection: { padding: '14px 20px', borderBottom: '1px solid var(--border)' },
  presetsLabel: { fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, fontWeight: 600 },
  presets: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  presetBtn: {
    background: 'var(--bg3)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    color: 'var(--text2)',
    fontSize: 12,
    padding: '5px 10px',
    cursor: 'pointer',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  form: { padding: 20, display: 'flex', flexDirection: 'column', gap: 14 },
  metaRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    background: 'var(--bg)',
    border: '1px solid var(--border2)',
    borderRadius: 7,
    color: 'var(--text)',
    fontSize: 13,
    padding: '8px 12px',
    outline: 'none',
    width: '100%',
    transition: 'border-color 0.15s',
    fontFamily: 'inherit',
  },
  monoInput: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12 },
  regenBtn: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: 'var(--text3)',
    cursor: 'pointer',
    fontSize: 14,
    lineHeight: 1,
    padding: 2,
  },
  tierRow: { display: 'flex', gap: 6 },
  tierBtn: {
    flex: 1,
    background: 'var(--bg)',
    border: '1px solid var(--border2)',
    borderRadius: 6,
    color: 'var(--text3)',
    fontSize: 12,
    fontWeight: 600,
    padding: '7px 4px',
    cursor: 'pointer',
    textTransform: 'capitalize',
    transition: 'all 0.15s',
    fontFamily: 'inherit',
  },
  tierActive: {
    background: 'rgba(110,231,247,0.1)',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  textarea: {
    background: 'var(--bg)',
    border: '1px solid var(--border2)',
    borderRadius: 7,
    color: 'var(--text)',
    fontSize: 13,
    padding: '10px 12px',
    outline: 'none',
    width: '100%',
    resize: 'vertical',
    minHeight: 120,
    lineHeight: 1.65,
    fontFamily: 'inherit',
    transition: 'border-color 0.15s',
  },
  charCount: { fontSize: 11, color: 'var(--text3)', textAlign: 'right', marginTop: 2 },
  submitBtn: {
    background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: 600,
    padding: '12px 20px',
    cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s',
    fontFamily: 'inherit',
  },
  submitInner: { display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' },
  spinner: {
    display: 'inline-block',
    width: 14,
    height: 14,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
}
