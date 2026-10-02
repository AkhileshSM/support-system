# Customer Support Triage — Multi-Agent System

A production-style support triage system built with **AgentField**, **Python**, **React**, and **Docker Compose**. Routing uses a local Ollama model. A small [System One](https://docs.ollama.com/api/systemone) decision gate can skip the two chat calls on easy tickets.

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
└────────┬─────────────────────────────────┘
         │                         (agentfield-net)
         ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐  ┌────────────┐
│orchestr. │  │  gate    │  │sentiment │  │  sla  │  │ escalation │
│ port 9001│  │ port 9005│  │ port 9002│  │ :9003 │  │  port 9004 │
│ Reasoner │  │  Skill   │  │ Reasoner │  │ Skill │  │  Reasoner  │
│          │  │ systemone│  │  Ollama  │  │ rules │  │   Ollama   │
└──────────┘  └────┬─────┘  └──────────┘  └───────┘  └────────────┘
                   │
                   ▼
         Ollama on the host :11434
         POST /v1/systemone  (tev1:0.8b)
         POST /api/chat      (gemma4:31b-cloud)
```

## Ticket flow

```
Submit ticket
     │
     ▼
triage-orchestrator.handle_ticket
     │
     ├── asyncio.gather ──────────────────────────┐
     │                                             │
     ▼                                             ▼
gate-agent.decide                    sla-agent.get_policy
 POST /v1/systemone                   (pure Python rules)
 team, urgency, threat,               sla_minutes, boost
 escalation, frustration
     │
     ├─ confident, not critical, not an escalation candidate
     │       │
     │       ▼
     │   FAST PATH
     │   team + one-line summary from the gate
     │   sentiment synthesized from gate answers
     │   sentiment-agent and app.ai() are not called
     │
     └─ low confidence, error, critical, or escalation candidate
             │
             ▼
        FULL PATH (unchanged)
        sentiment-agent.analyze
        orchestrator app.ai() routing
             │
             escalate=true?
             │
             ▼
        escalation-agent.create_case
             │
             ▼
        Result: same fields as before, plus
        decision_path, gate, gate_latency_ms
```

The gate is an optimization. It is never the only authority. A low score, a transport error, a missing model, critical urgency, `needs_escalation`, or an enterprise account already marked high urgency all take the full path. Escalation is created only on that full path.

## Decision gate

`gate-agent` is a Skill. It does not call `app.ai()`. It sends one raw HTTP request to Ollama:

```
POST ${SYSTEMONE_BASE}/v1/systemone
model: ${SYSTEMONE_MODEL}     # default tev1:0.8b
```

The live call times out after `SYSTEMONE_TIMEOUT_S` (default 3 seconds) and returns `{"ok": false, "error": "..."}` instead of raising. The orchestrator then runs sentiment and routing as before. The first call after a cold start can exceed that timeout while Ollama loads `tev1:0.8b`; that ticket takes the full path, and later tickets can take the fast path.

`tev1:0.8b` is experimental, with about a 2,000-token context, and the state is included again for every question. Ticket text (subject + body) is truncated to 1,200 characters and the question text is kept short.

Confidence is distribution concentration (`1 - H/ln N`), not a calibrated probability of being correct. On a 42-ticket local run, `tev1:0.8b` kept the minimum under 0.7, so every ticket took the full path. That is the intended safety behavior. Lower `GATE_CONFIDENCE_MIN` only after you measure field accuracy with `eval/run_eval.py`.

### Schema checked against the Ollama docs

Checked on 2026-10-02 against [the System One API](https://docs.ollama.com/api/systemone) and the [decision guide](https://docs.ollama.com/capabilities/decision). The request shape in older notes does not match that API. This repo follows the published schema:

| Question | Type | Criteria | Answer used |
|---|---|---|---|
| `team` | `choice` | object, 4 team keys | `choice` |
| `urgency` | `choice` | `low` / `medium` / `high` / `critical` | `choice` |
| `contains_threat` | `noul` | object with `false` and `true` strings | probability `noul` |
| `needs_escalation` | `noul` | object with `false` and `true` strings | probability `noul` |
| `frustration` | `score` | array of 10 descriptions, low to high | weighted `score` |

Assumptions on top of that schema:

- A noul answer is a probability, not a boolean. `>= 0.5` becomes true.
- Noul answers have no `confidence`. The gate uses `abs(p - 0.5) * 2` (0 at a coin flip, 1 at 0 or 1) and then takes the minimum across every answer.
- `score` is a weighted index from 0 through 9, not a 1–10 rating. Index 0 maps to frustration 1 and index 9 maps to frustration 10.
- Fast path also requires the ticket not be enterprise + high urgency, because that case is already an escalation in the routing prompt.
- There is no Ollama CLI or client library for this endpoint. The gate uses `httpx`.

Inside Docker the base URL is `http://host.docker.internal:11434`, not `localhost`.

## Quick start

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)
- [Ollama](https://ollama.com) **0.35 or newer**, reachable on port 11434
- The chat model the agents already use, plus the decision-gate model:

```bash
ollama pull gemma4:31b-cloud
make pull-gate-model          # ollama pull tev1:0.8b
```

`tev1:0.8b` is the default gate. Set `SYSTEMONE_MODEL` to swap it. `nimble` is another local System One model and can be compared with the eval script.

### 1. Clone and configure

```bash
git clone https://github.com/AkhileshSM/support-system.git
cd support-system

make setup              # copies .env.example → .env
```

`.env` is gitignored. Commit `.env.example` only. The example file has no secrets.

### 2. Start everything

```bash
make up
```

This builds and starts 7 containers:

- `agentfield-server` — control plane
- `orchestrator` — triage agent (fast path or full path)
- `gate-agent` — Ollama `/v1/systemone` decision gate
- `sentiment-agent` — sentiment and urgency, full path only
- `sla-agent` — deterministic SLA lookup
- `escalation-agent` — escalation cases
- `ui` — React UI served by nginx

### 3. Open the UI

| Service | URL |
|---|---|
| React UI | http://localhost:3000 |
| AgentField dashboard | http://localhost:8080 |

The pipeline trace shows a Gate stage. On a fast-path ticket, Sentiment and AI Routing are marked skipped. The result panel shows `decision_path`, gate confidence, and gate latency.

### Development

```bash
make logs
make ui-dev                              # React on http://localhost:5173
make rebuild SVC=gate-agent
make down
make clean
```

### Evaluation

`eval/tickets.py` holds 42 labeled tickets, including the four UI presets. Labels are `team`, `urgency`, and `escalate` (critical, or enterprise and high).

```bash
# Host Ollama, not the Docker hostname
SYSTEMONE_BASE=http://127.0.0.1:11434 \
SYSTEMONE_MODEL=tev1:0.8b \
python eval/run_eval.py

# Optional third column
SYSTEMONE_COMPARE_MODEL=nimble python eval/run_eval.py

# Dataset only, no model calls
python eval/run_eval.py --check
```

The script prints accuracy per field, the fast-path rate, and p50/p95 latency. `SYSTEMONE_MODEL`, `BASELINE_MODEL`, and `SYSTEMONE_COMPARE_MODEL` come from the environment. The existing path is the two production chat prompts (sentiment, then routing), not a second trip through the orchestrator, so the gate is not mixed into column (a).

## Project structure

```
support-system/
├── docker-compose.yml              # 7-service stack
├── Dockerfile.server               # AgentField control plane
├── Makefile                        # make up / down / logs / pull-gate-model
├── .env.example                    # copy → .env (gitignored)
├── nginx/
│   └── nginx.conf
├── eval/
│   ├── tickets.py                  # 42 labeled tickets, including UI presets
│   └── run_eval.py                 # existing path vs systemone gate
├── agents/
│   ├── orchestrator/
│   │   ├── app.py                  # Fast path or full sentiment + routing
│   │   ├── startup.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── gate/
│   │   ├── app.py                  # Skill: POST /v1/systemone
│   │   ├── systemone.py            # Request builder and normalizer
│   │   ├── startup.py
│   │   ├── requirements.txt
│   │   └── Dockerfile
│   ├── sentiment/
│   ├── sla/
│   └── escalation/
└── ui/
    └── src/
        ├── components/
        │   ├── PipelineTrace.jsx   # Gate stage; sentiment/routing skipped on fast path
        │   ├── ResultPanel.jsx     # decision_path, gate confidence, latency
        │   └── AgentStatusBar.jsx  # includes gate-agent
        └── hooks/
            └── useAgents.js
```

## API

All via the control plane at `http://localhost:8080`:

| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/execute/triage-orchestrator.handle_ticket` | Triage pipeline |
| POST | `/api/v1/execute/gate-agent.decide` | Decision gate only |
| POST | `/api/v1/execute/sentiment-agent.analyze` | Sentiment only |
| POST | `/api/v1/execute/sla-agent.get_policy` | SLA lookup only |
| POST | `/api/v1/execute/escalation-agent.list_cases` | List escalation cases |
| GET  | `/api/v1/executions` | Execution history |
| GET  | `/api/v1/agents` | Registered agents |
| GET  | `/health` | Control plane health |

### Example: submit a ticket

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

The result still has `ticket_id`, `team`, `escalated`, `confidence`, `summary`, `sla_minutes`, `priority_boost`, `sentiment` (`label`, `urgency`, `frustration_level`, `key_emotion`, `contains_threat`), `escalation`, and `processed_at`. It also has:

| Field | Meaning |
|---|---|
| `decision_path` | `"fast"` or `"full"` |
| `gate` | Normalized gate dict, or `{"ok": false, "error": "..."}` |
| `gate_latency_ms` | System One call time, when the gate returned one |

A clear low-urgency ticket comes back with `decision_path: "fast"`. The data-loss ticket above is critical, so it takes `decision_path: "full"` and can still escalate. If Ollama is down or `tev1:0.8b` is not pulled, the gate returns `ok: false` and the orchestrator runs the full path instead of failing the request on the gate call. The full path itself still needs the chat model.

## Configuration

| Variable | Default | Used by |
|---|---|---|
| `OLLAMA_API_BASE` | `http://host.docker.internal:11434` | Chat agents |
| `SYSTEMONE_BASE` | `http://host.docker.internal:11434` | `gate-agent` |
| `SYSTEMONE_MODEL` | `tev1:0.8b` | `gate-agent` and `eval/run_eval.py` |
| `GATE_CONFIDENCE_MIN` | `0.7` | Orchestrator fast-path threshold |
| `SYSTEMONE_TIMEOUT_S` | `3` | Gate HTTP timeout |
| `BASELINE_MODEL` | `gemma4:31b-cloud` | Eval script, existing path |
| `SYSTEMONE_COMPARE_MODEL` | unset | Eval script, optional third column |
