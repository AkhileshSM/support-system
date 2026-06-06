# 🤖 Customer Support Triage — Multi-Agent System

> A production-grade AI agent system built with **AgentField**, **Python**, **React**, and **Docker Compose**.

## Architecture

```
Your Browser
     │
     ▼
┌──────────────────┐     port 3000
│   React UI       │ ◄── nginx serves static files
│   (nginx)        │     /api/* proxied to control plane
└────────┬─────────┘
         │ /api/v1/execute/triage-orchestrator.handle_ticket
         ▼
┌──────────────────────────────────────────┐     port 8080
│   AgentField Control Plane               │
│   Routing · Memory · DAG · Policy · Audit│
└────────┬──────────────────────┬──────────┘
         │                      │  (all on agentfield-net)
    ┌────▼────────────────────────────────────────┐
    │                                             │
    ▼                        ▼          ▼         ▼
┌──────────┐   ┌──────────┐  ┌───────┐  ┌──────────────┐
│orchestrat│   │sentiment │  │  sla  │  │ escalation   │
│ port 9001│   │ port 9002│  │ :9003 │  │   port 9004  │
│ Reasoner │   │ Reasoner │  │ Skill │  │  Reasoner    │
│ (Claude) │   │ (Claude) │  │(rules)│  │  (Claude)    │
└──────────┘   └──────────┘  └───────┘  └──────────────┘
```

## Ticket Flow

```
Submit ticket
     │
     ▼
triage-orchestrator.handle_ticket
     │
     ├── asyncio.gather ──────────────────────────┐
     │         │                                   │
     ▼         ▼                                   ▼
sentiment-agent.analyze          sla-agent.get_policy
 (Claude: urgency, label,          (pure Python rules:
  frustration, threat)             sla_minutes, boost)
     │                                   │
     └───────────────┬───────────────────┘
                     ▼
          orchestrator: app.ai() routing
          (Claude decides: team + escalate)
                     │
              escalate=true?
                     │
                     ▼
          escalation-agent.create_case
          (Claude drafts alert, stores in
           global memory)
                     │
                     ▼
          Return structured result to UI
```

## Quick Start

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- An Anthropic API key (`sk-ant-...`)

### 1. Clone and configure

```bash
git clone <repo>
cd support-system

make setup              # copies .env.example → .env
nano .env               # add your ANTHROPIC_API_KEY
```

### 2. Start everything

```bash
make up
```

This builds and starts 6 containers:
- `agentfield-server` — control plane
- `orchestrator` — main triage agent
- `sentiment-agent` — Claude-powered sentiment analysis
- `sla-agent` — deterministic SLA policy lookup
- `escalation-agent` — escalation case manager
- `ui` — React UI served by nginx

### 3. Open the UI

| Service | URL |
|---|---|
| React UI | http://localhost:3000 |
| AgentField Dashboard | http://localhost:8080 |

### Development

```bash
# Watch all logs
make logs

# Run React UI with hot reload (needs Node.js)
make ui-dev    # runs on http://localhost:5173

# Restart a single agent after code change
make rebuild SVC=sentiment-agent

# Stop everything
make down

# Nuclear clean
make clean
```

## Project Structure

```
support-system/
├── docker-compose.yml              # 6-service stack
├── Dockerfile.server               # AgentField control plane
├── Makefile                        # make up / down / logs / rebuild
├── .env.example                    # copy → .env
├── nginx/
│   └── nginx.conf                  # Reverse proxy config
├── agents/
│   ├── orchestrator/
│   │   ├── app.py                  # Orchestrator agent
│   │   ├── startup.py              # Shared startup helper (retry loop)
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── sentiment/
│   │   ├── app.py                  # Sentiment + urgency analysis
│   │   ├── startup.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── sla/
│   │   ├── app.py                  # Deterministic SLA skill
│   │   ├── startup.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   └── escalation/
│       ├── app.py                  # Escalation case manager
│       ├── startup.py
│       ├── requirements.txt
│       └── Dockerfile
└── ui/
    ├── Dockerfile                  # Multi-stage: Node build → nginx
    ├── nginx-fallback.conf
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css
        ├── App.jsx                 # Main layout + tab routing
        ├── components/
        │   ├── TicketForm.jsx      # Submission form + presets
        │   ├── ResultPanel.jsx     # Full triage result display
        │   ├── AgentStatusBar.jsx  # Live agent health bar
        │   ├── ExecutionHistory.jsx# Session ticket log
        │   └── PipelineTrace.jsx   # Visual execution flow
        ├── hooks/
        │   ├── useExecution.js     # API submission + state
        │   ├── useAgents.js        # Live agent health polling
        │   └── useHistory.js       # Session history
        └── utils/
            └── api.js              # AgentField REST client
```

## API Endpoints

All via the control plane at `http://localhost:8080`:

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/execute/triage-orchestrator.handle_ticket` | Run full triage pipeline |
| POST | `/api/v1/execute/sentiment-agent.analyze` | Sentiment analysis only |
| POST | `/api/v1/execute/sla-agent.get_policy` | SLA lookup only |
| POST | `/api/v1/execute/escalation-agent.list_cases` | List escalation cases |
| GET  | `/api/v1/executions` | Execution history |
| GET  | `/api/v1/agents` | Registered agents |
| GET  | `/health` | Control plane health |

### Example: Submit a ticket via curl

```bash
curl http://localhost:8080/api/v1/execute/triage-orchestrator.handle_ticket \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "ticket_id": "T-001",
      "subject": "All production data gone - URGENT",
      "body": "We cannot access our database since this morning. Complete outage.",
      "customer_id": "CUST-ACME",
      "account_tier": "enterprise"
    }
  }'
```
