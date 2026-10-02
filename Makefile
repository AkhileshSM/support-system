# ═══════════════════════════════════════════════════════════════
#  Makefile — Customer Support Multi-Agent System
#  Usage: make <target>
# ═══════════════════════════════════════════════════════════════

.PHONY: help up down build logs restart ui-dev clean check-env pull-gate-model eval

## Show this help
help:
	@grep -E '^## .+' Makefile | sed 's/## /  /'

## Copy .env.example → .env (edit before running)
setup:
	@cp -n .env.example .env && echo "✓ Created .env — set OLLAMA_API_BASE if Ollama is not on port 11434" || echo "! .env already exists"

## Pull the local System One model used by the decision gate (default tev1:0.8b)
pull-gate-model:
	ollama pull $${SYSTEMONE_MODEL:-tev1:0.8b}

## Compare the decision gate with the existing two-call path (Ollama on localhost)
eval:
	SYSTEMONE_BASE=$${SYSTEMONE_BASE:-http://127.0.0.1:11434} python3 eval/run_eval.py

## Build all containers
build:
	docker compose build

## Start the full stack (build if needed)
up: check-env
	docker compose up --build -d
	@echo ""
	@echo "  ✓  UI:             http://localhost:3000"
	@echo "  ✓  Control plane:  http://localhost:8080"
	@echo ""
	@echo "  Watch logs: make logs"

## Start in foreground (shows logs inline)
up-fg: check-env
	docker compose up --build

## Stop all containers
down:
	docker compose down

## Tail logs from all services
logs:
	docker compose logs -f

## Tail logs for a specific agent  (e.g. make logs-agent SVC=orchestrator)
logs-agent:
	docker compose logs -f $(SVC)

## Restart a single service  (e.g. make restart SVC=sentiment-agent)
restart:
	docker compose restart $(SVC)

## Rebuild and restart a single service
rebuild:
	docker compose up -d --build $(SVC)

## Run the React UI locally in dev mode (hot reload)
## Requires Node.js. Proxies /api to localhost:8080 (run af server separately)
ui-dev:
	cd ui && npm install && npm run dev

## Remove containers, images, volumes
clean:
	docker compose down --rmi local -v --remove-orphans

## Check .env exists and has the API key
check-env:
	@test -f .env || (echo "ERROR: .env not found. Run: make setup" && exit 1)
	@grep -q "OLLAMA_API_BASE=" .env || (echo "ERROR: Set OLLAMA_API_BASE in .env" && exit 1)
	@echo "✓ .env looks good"
