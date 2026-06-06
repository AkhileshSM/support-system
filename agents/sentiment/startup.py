"""
startup.py — Shared startup helper for all AgentField agents.

Handles:
  - Retry loop until control plane is ready
  - Graceful shutdown on SIGTERM / SIGINT
  - Structured logging with timestamps
"""
import asyncio
import logging
import os
import signal
import sys
import time

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S",
)
log = logging.getLogger("startup")


def wait_for_control_plane(
    server_url: str,
    max_wait_seconds: int = 60,
    poll_interval: float = 2.0,
) -> None:
    """Block until the AgentField control plane is reachable."""
    health_url = f"{server_url}/health"
    deadline = time.time() + max_wait_seconds
    attempt = 0

    log.info(f"Waiting for control plane at {health_url} ...")

    while time.time() < deadline:
        attempt += 1
        try:
            resp = httpx.get(health_url, timeout=3.0)
            if resp.status_code < 300:
                log.info(f"Control plane ready (attempt {attempt})")
                return
        except Exception as exc:
            log.debug(f"Attempt {attempt}: {exc}")

        time.sleep(poll_interval)

    raise RuntimeError(
        f"Control plane at {server_url} not reachable after {max_wait_seconds}s"
    )


def install_shutdown_handler(app) -> None:
    """Install SIGTERM/SIGINT handlers for graceful Docker stop."""
    def _handle(signum, frame):
        log.info(f"Received signal {signum}, shutting down ...")
        sys.exit(0)

    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
