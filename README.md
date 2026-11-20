# CICADA 2026 – Smart Observability

Privacy-First AI-Assisted IT Monitoring Platform featuring **Egress Proof** local data sanitization, real-time WebSocket telemetry, SQLite persistence, standalone Python + `psutil` host monitoring, and Google Gemini diagnostics.

---

## Architecture Overview

```text
├── agent/                  # Standalone Python + psutil host agent (runs on monitored machines)
│   ├── cicada_agent.py     # Collects CPU/RAM/Disk/Net/Processes -> SQLite local buffer -> pre-egress sanitizer
│   └── requirements.txt
├── shared/                 # Pure TypeScript domain logic & node:test unit tests
│   ├── types.ts
│   ├── privacy/sanitizer.ts
│   ├── alerts/rules.ts
│   └── demo/simulator.ts
├── server/                 # Express REST API, WebSocket server, SQLite persistence & Gemini integration
│   ├── config/env.ts
│   ├── db/sqlite.ts
│   ├── middleware/security.ts
│   ├── routes/api.ts
│   └── services/
│       ├── gemini.ts       # Server-side @google/genai (gemini-4-hydrogen) over sanitized payloads only
│       └── realtime.ts     # WebSocket (/ws) + Hackathon Demo Mode loop
├── src/                    # React + Vite + TypeScript + Tailwind CSS frontend
│   ├── components/
│   │   ├── charts/         # Interactive SVG telemetry charts & radial gauges
│   │   ├── layout/         # Responsive Sidebar & TopBar
│   │   └── views/          # Overview, Live Monitoring, Hosts, Alerts, AI Insights, Egress Proof, Reports, Settings, Demo Mode
│   └── services/
├── server.ts               # Unified HTTP + WebSocket + Vite/Static production entrypoint
├── Dockerfile              # Google Cloud Run container build
└── .env.example            # Documented environment variables
```

---

## Core Capabilities

1. **Egress Proof (Core Privacy Innovation)**
   - Raw metrics, local file paths (`/Users/...`, `/home/...`, `C:\Users\...`), usernames, internal IPs, and CLI secret flags (`--token=...`, `--password=...`, `AIza...`, `ghp_...`, `sk-...`) remain strictly in local SQLite (`raw_local_snapshots`).
   - Only policy-approved, sanitized JSON payloads cross the network boundary or reach Gemini AI.
   - Dedicated **Egress Proof** view inspects all 6 stages: Raw Local Data -> Sensitive Fields Detected -> Fields Sanitized -> Approved Payload -> Executed Transmission -> Transmission Audit Log & Blocked Fields Log.

2. **Real-Time Fleet Monitoring & Alerting**
   - Live CPU, RAM, Disk, Network RX/TX, uptime, and running process tables streamed over WebSockets (`/ws`).
   - Automatic threshold evaluation (`Critical`, `High`, `Medium`, `Low`) for CPU, RAM, Disk, Network spikes, offline heartbeats, and sudden anomalies.
   - Full incident lifecycle (`Open -> Acknowledge -> Resolve / Dismiss`).

3. **Gemini AI Insights**
   - Server-side `@google/genai` (`gemini-4-hydrogen`) diagnostics and natural-language monitoring assistant.
   - Strictly separates **Observed Telemetry Facts** from **Possible Explanations & Root-Cause Hypotheses**.

4. **Hackathon Demo Mode**
   - 4 simulated hosts (`prod-api-eu-01`, `ml-inference-node-04`, `edge-gateway-02`, `db-replica-us-03`) clearly labeled `DEMO DATA`.
   - Trigger critical CPU/RAM/Disk/Network incidents or simulate offline hosts with one click.

---

## Local Setup & Startup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` and fill in your server secrets:
```bash
cp .env.example .env
```
Key variables:
- `GEMINI_API_KEY`: Google Gemini API key (server-side only; never exposed to browser).
- `PORT`: Defaults to `3000` locally (or `8080` in Cloud Run).
- `CICADA_DB_PATH`: SQLite database file path (default `./data/cicada.db`).
- `CICADA_SESSION_SECRET`: HMAC signing key for operator session tokens.
- `VITE_FIREBASE_*`: Optional Firebase Auth/Firestore client configuration. When unset, CICADA runs seamlessly with local SQLite persistence and operator sessions.

### 3. Start Full-Stack Dev Server (Backend + Frontend + WebSockets)
```bash
npm run dev
```
Open `http://localhost:3000`.

### 4. Run Unit Tests & Type Checking
```bash
npm test
npm run lint
npm run build
```

---

## Two-Tier Architecture: Edge Collector + Cloud SaaS (Authenticated Link)

CICADA separates telemetry into two tiers so sensitive host internals never cross onto the SaaS plane:

1. **Tier 1 — Edge Collector (`agent/cicada_agent.py`)**: Runs directly on your Linux, macOS, or Windows device using `psutil`, persists raw snapshots in a local SQLite buffer (`agent_local_buffer.db`), and strips usernames, home directory paths, private IPs, and CLI tokens before transmission.
2. **Tier 2 — Cloud SaaS Control Plane (`server.ts` / `/server/*`)**: Authenticates devices via HMAC-SHA256 single-use enrollment links (`POST /api/agent/enrollment-link` -> `POST /api/agent/enroll`), issues per-host `X-Agent-Key` credentials, evaluates alert thresholds, streams live WebSocket updates, and feeds only sanitized payloads to Gemini AI.

### Connect a Real Device (Recommended 1-Line Authenticated Link)
1. Open **Hosts** in the CICADA dashboard and enter a **Device Label** under **Mint Authenticated Collector Link**.
2. Run the generated one-line installer on your target Linux/macOS device:
   ```bash
   curl -fsSL "<SAAS_URL>/api/agent/installer.sh?token=<SIGNED_TOKEN>" | bash
   ```
   This creates `~/.cicada-collector/.venv`, installs `psutil` and `requests`, downloads `/api/agent/collector.py`, exchanges the single-use token at `POST /api/agent/enroll` for a per-host `X-Agent-Key` saved in `~/.cicada-collector/credentials.json` (`chmod 0600`), and starts streaming sanitized telemetry.
3. Click **Switch to Real Devices Only** in **Hosts** or **Overview** to hide synthetic `DEMO DATA` hosts.

### Manual Collector Setup (If Repo Cloned Locally)
```bash
cd agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 cicada_agent.py --enroll-url "<SAAS_URL>/api/agent/enroll?token=<SIGNED_TOKEN>" --interval 10
```

Or connect using a pre-registered `host-id` and `agent-key`:
```bash
python3 cicada_agent.py \
  --server "http://localhost:3000" \
  --host-id "<HOST_ID>" \
  --agent-key "<AGENT_KEY>" \
  --interval 10
```

---

## Google Cloud Run Deployment

1. Build and push the container image:
```bash
gcloud builds submit --tag gcr.io/<PROJECT_ID>/cicada-2026
```

2. Deploy to Cloud Run with environment secrets:
```bash
gcloud run deploy cicada-2026 \
  --image gcr.io/<PROJECT_ID>/cicada-2026 \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,CICADA_DB_PATH=/tmp/cicada.db" \
  --set-secrets "GEMINI_API_KEY=gemini-api-key:latest,CICADA_SESSION_SECRET=cicada-session-secret:latest"
```

> Note: Keep `agent/cicada_agent.py` running on your target Linux/macOS/Windows infrastructure pointing `--server` to your Cloud Run HTTPS URL.
