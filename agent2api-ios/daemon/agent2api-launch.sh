#!/bin/sh
# Wait until no healthy Agent2API gateway is on 3065, then exec the daemon.
# This keeps an existing healthy gateway (old deb / old nohup process) alive,
# but takes over automatically as soon as it dies.
BIN="${1:-/usr/local/bin/agent2api-server}"
PORT="${AGENT2API_PROXY_PORT:-3065}"
LOG="/var/mobile/Library/agent2api/launch.log"

while :; do
    if command -v curl >/dev/null 2>&1; then
        if curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; then
            echo "$(date) existing gateway healthy, waiting" >>"$LOG" 2>/dev/null || true
            sleep 5
            continue
        fi
    elif command -v wget >/dev/null 2>&1; then
        if wget -qO- "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'; then
            echo "$(date) existing gateway healthy, waiting" >>"$LOG" 2>/dev/null || true
            sleep 5
            continue
        fi
    elif command -v nc >/dev/null 2>&1; then
        if (printf 'GET /health HTTP/1.0\r\n\r\n'; sleep 1) | nc 127.0.0.1 "$PORT" 2>/dev/null | grep -q '"ok"'; then
            echo "$(date) existing gateway healthy, waiting" >>"$LOG" 2>/dev/null || true
            sleep 5
            continue
        fi
    fi

    echo "$(date) no healthy gateway, starting $BIN" >>"$LOG" 2>/dev/null || true
    exec "$BIN"
done
