FROM python:3.11-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.11-slim
LABEL description="AgentField escalation-agent"
WORKDIR /agent
COPY --from=builder /install /usr/local
COPY app.py startup.py ./
RUN useradd -m -u 1000 agentuser
USER agentuser
ENV PYTHONUNBUFFERED=1
EXPOSE 9004
CMD ["python", "app.py"]
