#!/bin/sh
# Do not stop a healthy gateway during an upgrade. The new launcher will wait
# for it to die and take over automatically.
set -u
PORT="${AGENT2API_PROXY_PORT:-3065}"
HEALTHY=0
if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"' && HEALTHY=1
elif command -v wget >/dev/null 2>&1; then
    wget -qO- "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"' && HEALTHY=1
elif command -v nc >/dev/null 2>&1; then
    (printf 'GET /health HTTP/1.0\r\n\r\n'; sleep 1) | nc 127.0.0.1 "$PORT" 2>/dev/null | grep -q '"ok"' && HEALTHY=1
fi
if [ "$HEALTHY" = "1" ]; then
    echo "[agent2api] existing gateway healthy; preinst will not stop it"
    exit 0
fi
PKG="com.chiyu.agent2api"
for l in /bin/launchctl /usr/bin/launchctl /var/jb/usr/bin/launchctl; do
    [ -x "$l" ] && "$l" bootout system/"$PKG" >/dev/null 2>&1 || true
done
killall -9 agent2api-server >/dev/null 2>&1 || true
exit 0
