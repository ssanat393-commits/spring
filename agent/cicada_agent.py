#!/usr/bin/env python3
"""
CICADA 2026 – Standalone Privacy-First Monitoring Agent
Executes on the monitored host using psutil, buffers raw metrics locally in SQLite,
sanitizes sensitive fields before egress, and transmits approved telemetry to CICADA backend.
"""

import argparse
import getpass
import hashlib
import json
import os
import platform
import re
import socket
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any, Dict, List

import psutil
import requests

CREDENTIAL_REGEXES = [
    re.compile(r"\bAIza[0-9A-Za-z\-_]{20,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9\-._~+/]+=*", re.IGNORECASE),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b"),
    re.compile(r"\bsk-[A-Za-z0-9\-_]{16,}\b"),
    re.compile(r"(--?(?:password|passwd|token|secret|api[-_]?key|dsn)\s*(?:=|\s+)\s*)([^\s\"']+)", re.IGNORECASE),
]

PATH_REGEXES = [
    re.compile(r"/Users/[A-Za-z0-9._-]+(?:/[^\s\"']*)*"),
    re.compile(r"/home/[A-Za-z0-9._-]+(?:/[^\s\"']*)*"),
    re.compile(r"[A-Za-z]:\\Users\\[A-Za-z0-9._-]+(?:\\[^\s\"']*)*"),
]


def init_local_db(db_path: str) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS local_raw_metrics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collected_at TEXT NOT NULL,
            raw_json TEXT NOT NULL,
            transmitted INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()
    return conn


def sanitize_cmdline(cmdline: str, username: str) -> str:
    cleaned = cmdline
    for rx in CREDENTIAL_REGEXES:
        cleaned = rx.sub("[REDACTED_SECRET]", cleaned)
    for rx in PATH_REGEXES:
        cleaned = rx.sub("[REDACTED_PERSONAL_PATH]", cleaned)
    if username and len(username) > 1:
        cleaned = re.sub(rf"\b{re.escape(username)}\b", "[REDACTED_USER]", cleaned)
    return cleaned


def collect_local_telemetry(host_id: str) -> Dict[str, Any]:
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    net = psutil.net_io_counters()
    boot_time = psutil.boot_time()
    uptime_seconds = max(0, int(time.time() - boot_time))
    username = getpass.getuser()
    hostname = socket.gethostname()

    try:
        load_avg = list(os.getloadavg())
    except (AttributeError, OSError):
        load_avg = [0.0, 0.0, 0.0]

    processes: List[Dict[str, Any]] = []
    for proc in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent", "username", "cmdline"]):
        try:
            info = proc.info
            raw_cmd = " ".join(info.get("cmdline") or []) or str(info.get("name") or "")
            processes.append(
                {
                    "pid": info["pid"],
                    "name": info["name"] or "unknown",
                    "cpuPct": round(float(info.get("cpu_percent") or 0.0), 1),
                    "memPct": round(float(info.get("memory_percent") or 0.0), 1),
                    "user": info.get("username") or username,
                    "cmdline": raw_cmd[:240],
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue

    processes.sort(key=lambda p: p["cpuPct"], reverse=True)

    return {
        "hostId": host_id,
        "hostname": hostname,
        "os": f"{platform.system()} {platform.release()}",
        "kernel": platform.version()[:60],
        "architecture": platform.machine(),
        "operatorUser": username,
        "homeDir": os.path.expanduser("~"),
        "uptimeSeconds": uptime_seconds,
        "cpuPct": round(psutil.cpu_percent(interval=0.5), 1),
        "ramPct": round(mem.percent, 1),
        "ramUsedGb": round(mem.used / (1024**3), 2),
        "ramTotalGb": round(mem.total / (1024**3), 2),
        "diskPct": round(disk.percent, 1),
        "diskUsedGb": round(disk.used / (1024**3), 2),
        "diskTotalGb": round(disk.total / (1024**3), 2),
        "netBytesRecv": net.bytes_recv,
        "netBytesSent": net.bytes_sent,
        "loadAvg": [round(x, 2) for x in load_avg],
        "processes": processes[:10],
        "collectedAt": datetime.now(timezone.utc).isoformat(),
    }


def enroll_with_authenticated_link(enroll_url: str, credentials_file: str) -> Dict[str, str]:
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    payload = {
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "kernel": platform.version()[:60],
        "architecture": platform.machine(),
        "ramTotalGb": round(mem.total / (1024**3), 1),
        "diskTotalGb": round(disk.total / (1024**3), 1),
    }
    resp = requests.post(enroll_url, json=payload, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    creds = {
        "server": str(data["serverUrl"]).rstrip("/"),
        "hostId": str(data["hostId"]),
        "agentKey": str(data["agentKey"]),
    }
    cred_dir = os.path.dirname(os.path.abspath(credentials_file))
    if cred_dir:
        os.makedirs(cred_dir, exist_ok=True)
    with open(credentials_file, "w", encoding="utf-8") as fh:
        json.dump(creds, fh, indent=2)
    try:
        os.chmod(credentials_file, 0o600)
    except OSError:
        pass
    print(f"[CICADA Collector] Enrolled as host={creds['hostId']} -> {creds['server']}")
    return creds


def main() -> None:
    parser = argparse.ArgumentParser(description="CICADA 2026 Tier-1 Privacy-First psutil Collector")
    parser.add_argument("--server", help="CICADA SaaS server base URL (e.g. https://your-app.run.app)")
    parser.add_argument("--host-id", help="Registered host ID")
    parser.add_argument("--agent-key", help="Registered X-Agent-Key credential")
    parser.add_argument("--enroll-url", help="Authenticated one-time SaaS enrollment link")
    parser.add_argument(
        "--credentials-file",
        default=os.path.expanduser("~/.cicada-collector/credentials.json"),
        help="Path to store paired X-Agent-Key credentials locally",
    )
    parser.add_argument("--interval", type=int, default=10, help="Collection interval in seconds")
    parser.add_argument("--local-db", default="agent_local_buffer.db", help="Local SQLite buffer file")
    parser.add_argument("--share-process-args", action="store_true", help="Send sanitized process args instead of stripping")
    parser.add_argument("--once", action="store_true", help="Collect and send one sample then exit")
    args = parser.parse_args()

    server_url = args.server
    host_id = args.host_id
    agent_key = args.agent_key

    if args.enroll_url:
        if os.path.exists(args.credentials_file) and not (server_url and host_id and agent_key):
            with open(args.credentials_file, "r", encoding="utf-8") as fh:
                saved = json.load(fh)
                server_url = saved.get("server")
                host_id = saved.get("hostId")
                agent_key = saved.get("agentKey")
        else:
            creds = enroll_with_authenticated_link(args.enroll_url, args.credentials_file)
            server_url = creds["server"]
            host_id = creds["hostId"]
            agent_key = creds["agentKey"]
    elif not (server_url and host_id and agent_key) and os.path.exists(args.credentials_file):
        with open(args.credentials_file, "r", encoding="utf-8") as fh:
            saved = json.load(fh)
            server_url = saved.get("server")
            host_id = saved.get("hostId")
            agent_key = saved.get("agentKey")

    if not (server_url and host_id and agent_key):
        parser.error("Provide --enroll-url OR (--server, --host-id, and --agent-key).")

    conn = init_local_db(args.local_db)
    headers = {"X-Agent-Key": agent_key, "Content-Type": "application/json"}
    prev_net = psutil.net_io_counters()
    prev_ts = time.time()

    print(f"[CICADA Collector] Tier-1 active for host={host_id} -> Tier-2 SaaS {server_url} (interval={args.interval}s)")

    while True:
        try:
            raw = collect_local_telemetry(host_id)
            now_ts = time.time()
            elapsed = max(1.0, now_ts - prev_ts)
            cur_net = psutil.net_io_counters()
            rx_kbps = round(((cur_net.bytes_recv - prev_net.bytes_recv) * 8) / (elapsed * 1000), 1)
            tx_kbps = round(((cur_net.bytes_sent - prev_net.bytes_sent) * 8) / (elapsed * 1000), 1)
            prev_net = cur_net
            prev_ts = now_ts

            # 1. Persist raw telemetry strictly locally in SQLite
            conn.execute(
                "INSERT INTO local_raw_metrics (collected_at, raw_json, transmitted) VALUES (?, ?, 0)",
                (raw["collectedAt"], json.dumps(raw)),
            )
            conn.commit()

            # 2. Pre-sanitize before leaving host
            host_hash = hashlib.sha256(raw["hostname"].encode()).hexdigest()[:10]
            sanitized_procs = []
            for p in raw["processes"]:
                sanitized_procs.append(
                    {
                        "pid": p["pid"],
                        "name": p["name"],
                        "cpuPct": p["cpuPct"],
                        "memPct": p["memPct"],
                        "cmdline": sanitize_cmdline(p["cmdline"], raw["operatorUser"])
                        if args.share_process_args
                        else "[ARGS_STRIPPED_LOCALLY]",
                    }
                )

            egress_payload = {
                "hostId": host_id,
                "hostname": f"node-{host_hash}",
                "os": raw["os"],
                "kernel": raw["kernel"],
                "uptimeSeconds": raw["uptimeSeconds"],
                "cpuPct": raw["cpuPct"],
                "ramPct": raw["ramPct"],
                "ramUsedGb": raw["ramUsedGb"],
                "ramTotalGb": raw["ramTotalGb"],
                "diskPct": raw["diskPct"],
                "diskUsedGb": raw["diskUsedGb"],
                "diskTotalGb": raw["diskTotalGb"],
                "netRxKbps": max(0.0, rx_kbps),
                "netTxKbps": max(0.0, tx_kbps),
                "loadAvg": raw["loadAvg"],
                "processes": sanitized_procs,
                "localIp": "redacted-at-agent",
                "operatorUser": "redacted-at-agent",
                "homeDir": "redacted-at-agent",
            }

            resp = requests.post(
                f"{server_url.rstrip('/')}/api/metrics/ingest",
                json=egress_payload,
                headers=headers,
                timeout=10,
            )
            resp.raise_for_status()
            print(f"[CICADA Collector] Transmitted sanitized snapshot CPU={raw['cpuPct']}% RAM={raw['ramPct']}%")
        except Exception as exc:
            print(f"[CICADA Collector] Collection/egress warning: {exc}")

        if args.once:
            break
        time.sleep(max(2, args.interval))


if __name__ == "__main__":
    main()
