#!/bin/sh
# Wait until no healthy Agent2API gateway is on 3065, then exec the daemon.
# This keeps an existing healthy gateway (old deb / old nohup process) alive,
# but takes over automatically as soon as it dies.
BIN="${1:-/usr/local/bin/agent2api-server}"
PORT="${AGENT2API_PROXY_PORT:-3065}"
LOG="/var/mobile/Library/agent2api/launch.log"

port_open() {
    if command -v nc >/dev/null 2>&1; then
        nc -z 127.0.0.1 "$PORT" >/dev/null 2>&1
        return $?
    fi
    return 1
}

while :; do
    # 端口还被任何进程占着就等，不要抢；旧进程退出后自然接管。
    if port_open; then
        echo "$(date) port $PORT still open, waiting" >>"$LOG" 2>/dev/null || true
        sleep 2
        continue
    fi

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
