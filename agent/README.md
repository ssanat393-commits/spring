# CICADA 2026 Python Monitoring Agent

This agent runs **directly on the monitored host** (separate from the cloud-hosted CICADA web application).

## Features
- Collects CPU, RAM, Disk, Network RX/TX rates, uptime, OS, and running processes via `psutil`.
- Persists raw unredacted snapshots locally in SQLite (`agent_local_buffer.db`).
- Strips usernames, home paths, credentials, and process arguments **before** transmitting over HTTPS/REST.
- Authenticates via per-host `X-Agent-Key` credentials issued in the **Hosts** view.

## Two-Tier Authenticated Pairing (Recommended)

1. In the CICADA SaaS console (**Hosts -> Mint Authenticated Collector Link**), generate a single-use HMAC-SHA256 enrollment link.
2. Run the one-line installer on your target Linux/macOS device:

```bash
curl -fsSL "<SAAS_URL>/api/agent/installer.sh?token=<SIGNED_TOKEN>" | bash
```

Or run directly from this folder using `--enroll-url` (credentials are persisted automatically to `~/.cicada-collector/credentials.json` with `0600` permissions):

```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 cicada_agent.py --enroll-url "<SAAS_URL>/api/agent/enroll?token=<SIGNED_TOKEN>" --interval 10
```

## Manual Credential Run

If you created a host via **Manual Key Registration**, start the agent with:

```bash
python3 cicada_agent.py \
  --server "http://localhost:3000" \
  --host-id "<YOUR_HOST_ID>" \
  --agent-key "<YOUR_AGENT_KEY>" \
  --interval 10
```
