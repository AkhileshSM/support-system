FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim
LABEL description="AgentField gate-agent — Ollama /v1/systemone decision gate"
WORKDIR /agent
COPY --from=builder /install /usr/local
COPY app.py startup.py systemone.py ./
# Compose healthchecks call curl, which python:3.11-slim does not ship.
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -u 1000 agentuser
USER agentuser
ENV PYTHONUNBUFFERED=1
EXPOSE 9005
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=15s \
    CMD curl -f http://localhost:9005/health || exit 1
CMD ["python", "app.py"]
