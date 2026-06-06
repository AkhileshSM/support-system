# ── Build stage ───────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ── Runtime stage ─────────────────────────────────────────────
FROM python:3.11-slim

LABEL description="AgentField triage-orchestrator agent"

WORKDIR /agent
COPY --from=builder /install /usr/local
COPY app.py startup.py ./

# Non-root user for security
RUN useradd -m -u 1000 agentuser
USER agentuser

ENV PYTHONUNBUFFERED=1

EXPOSE 9001

HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
    CMD python -c "import httpx; httpx.get('http://localhost:9001/health', timeout=3)"

CMD ["python", "app.py"]
