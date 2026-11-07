#!/bin/sh
# Agent2API supervisor installer for Relaxin / RootHide.
# The supervisor is the only LaunchDaemon; the gateway is started/stopped by
# the App's foreground/background lifecycle.
set -u

PKG="com.chiyu.agent2api"
DATA="/var/mobile/Library/agent2api"
GATEWAY_PORT="${AGENT2API_PROXY_PORT:-3065}"
CONTROL_PORT="${AGENT2API_SUPERVISOR_PORT:-3066}"
LOG="$DATA/install.log"

log() {
    echo "[agent2api] $*"
    echo "[agent2api] $*" >>"$LOG" 2>/dev/null || true
}

mkdir -p "$DATA" 2>/dev/null || true
chown -R root:wheel "$DATA" 2>/dev/null || true
chmod 755 "$DATA" 2>/dev/null || true

# 1. RootHide root
JB=""
for d in /private/var/containers/Bundle/Application/.jbroot-* \
         /var/containers/Bundle/Application/.jbroot-*; do
    if [ -d "$d" ]; then
        JB="$d"
        break
    fi
done

# 2. Find supervisor / gateway / UI
SUPERVISOR=""
for f in \
    "${JB:+$JB/usr/local/bin/agent2api-supervisor}" \
    /var/jb/usr/local/bin/agent2api-supervisor \
    /usr/local/bin/agent2api-supervisor; do
    if [ -n "$f" ] && [ -x "$f" ]; then SUPERVISOR="$f"; break; fi
done
[ -n "$SUPERVISOR" ] || { log "ERROR: 鎵句笉鍒?agent2api-supervisor"; exit 1; }

BIN=""
for f in \
    "${JB:+$JB/usr/local/bin/agent2api-server}" \
    /var/jb/usr/local/bin/agent2api-server \
    /usr/local/bin/agent2api-server; do
    if [ -n "$f" ] && [ -x "$f" ]; then BIN="$f"; break; fi
done
[ -n "$BIN" ] || { log "ERROR: 鎵句笉鍒?agent2api-server"; exit 1; }

UI=""
for u in \
    "${JB:+$JB/usr/local/share/agent2api/ui}" \
    /var/jb/usr/local/share/agent2api/ui \
    /usr/local/share/agent2api/ui; do
    if [ -n "$u" ] && [ -f "$u/m.html" ]; then UI="$u"; break; fi
done
[ -n "$UI" ] || { log "ERROR: 鎵句笉鍒伴潰鏉?UI"; exit 1; }

APP=""
for a in \
    "${JB:+$JB/Applications/Agent2API.app}" \
    /var/jb/Applications/Agent2API.app \
    /Applications/Agent2API.app; do
    if [ -n "$a" ] && [ -d "$a" ]; then APP="$a"; break; fi
done

PACKDIR=""
for p in \
    "${JB:+$JB/usr/local/share/agent2api/packs}" \
    /var/jb/usr/local/share/agent2api/packs \
    /usr/local/share/agent2api/packs; do
    if [ -n "$p" ] && [ -d "$p" ]; then PACKDIR="$p"; break; fi
done

# 3. Make real-path copies for launchd. RootHide launchd often cannot exec
# the randomized .jbroot-* path even though the shell can.
REAL_SUPERVISOR="$SUPERVISOR"
REAL_BIN="$BIN"
REAL_UI="$UI"
make_real() {
    src="$1"
    dst="$2"
    if [ -z "$JB" ]; then return 1; fi
    case "$src" in
        "$JB"/*) ;;
        *) return 1 ;;
    esac
    mkdir -p "$(dirname "$dst")" 2>/dev/null || return 1
    if [ -d "$src" ]; then
        mkdir -p "$dst" 2>/dev/null || return 1
        cp -R "$src"/. "$dst"/ 2>/dev/null || return 1
    else
        cp -f "$src" "$dst" 2>/dev/null || return 1
    fi
    return 0
}
if [ -n "$JB" ]; then
    make_real "$SUPERVISOR" /usr/local/bin/agent2api-supervisor && REAL_SUPERVISOR=/usr/local/bin/agent2api-supervisor
    make_real "$BIN" /usr/local/bin/agent2api-server && REAL_BIN=/usr/local/bin/agent2api-server
    make_real "$UI" /usr/local/share/agent2api/ui && REAL_UI=/usr/local/share/agent2api/ui
fi
chmod 755 "$REAL_SUPERVISOR" "$REAL_BIN" 2>/dev/null || true

# 4. Preseed plugin packs
if [ -n "$PACKDIR" ]; then
    mkdir -p "$DATA/plugins"
    for one in "$PACKDIR"/*; do
        [ -d "$one" ] || continue
        id="$(basename "$one")"
        rm -rf "$DATA/plugins/$id"
        cp -R "$one" "$DATA/plugins/$id" 2>/dev/null || true
    done
    if [ -f "$PACKDIR/plugins.json" ]; then
        cp "$DATA/plugins/plugins.json" "/tmp/a2a-plugins.json.bak.$(date +%s)" 2>/dev/null || true
        cp "$PACKDIR/plugins.json" "$DATA/plugins/plugins.json" 2>/dev/null || true
    fi
    chown -R root:wheel "$DATA/plugins" 2>/dev/null || true
    chmod -R 755 "$DATA/plugins" 2>/dev/null || true
    log "宸查缃彃浠讹細$PACKDIR"
fi

# 5. Plist
write_plist() {
    plist="$1"
    supervisor="$2"
    bin="$3"
    ui="$4"
    mkdir -p "$(dirname "$plist")" 2>/dev/null || return 1
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PKG</string>
  <key>ProgramArguments</key><array><string>$supervisor</string></array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT2API_PROXY_HOME</key><string>$DATA</string>
    <key>HOME</key><string>$DATA</string>
    <key>AGENT2API_UI_DIR</key><string>$ui</string>
    <key>AGENT2API_SERVER_BIN</key><string>$bin</string>
    <key>AGENT2API_HOST</key><string>127.0.0.1</string>
    <key>AGENT2API_PROXY_PORT</key><string>$GATEWAY_PORT</string>
    <key>AGENT2API_SUPERVISOR_PORT</key><string>$CONTROL_PORT</string>
    <key>AGENT2API_ALLOW_EXEC</key><string>1</string>
    <key>AGENT2API_INPROC</key><string>1</string>
    <key>AGENT2API_ALLOW_UNSIGNED_PLUGIN_INSTALL</key><string>1</string>
    <key>AGENT2API_DEPLOY</key><string>ios</string>
    <key>AGENT2API_SELF_UPDATE</key><string>0</string>
    <key>AGENT2API_VERBOSE</key><string>0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DATA/supervisor.log</string>
  <key>StandardErrorPath</key><string>$DATA/supervisor.log</string>
  <key>AbandonProcessGroup</key><false/>
  <key>LowPriorityIO</key><false/>
</dict>
</plist>
EOF
    chown root:wheel "$plist" 2>/dev/null || true
    chmod 644 "$plist" 2>/dev/null || true
    log "plist=$plist"
}

PLISTS=""
if [ -d /Library/LaunchDaemons ] || mkdir -p /Library/LaunchDaemons 2>/dev/null; then
    P="/Library/LaunchDaemons/$PKG.plist"
    write_plist "$P" "$REAL_SUPERVISOR" "$REAL_BIN" "$REAL_UI" && PLISTS="$PLISTS $P"
fi
if [ -n "$JB" ]; then
    P="$JB/Library/LaunchDaemons/$PKG.plist"
    write_plist "$P" "$REAL_SUPERVISOR" "$REAL_BIN" "$REAL_UI" && PLISTS="$PLISTS $P"
fi
if [ -d /var/jb ]; then
    P="/var/jb/Library/LaunchDaemons/$PKG.plist"
    write_plist "$P" "$REAL_SUPERVISOR" "$REAL_BIN" "$REAL_UI" && PLISTS="$PLISTS $P"
fi

# 6. launchctl
LCTLS=""
for l in /bin/launchctl /usr/bin/launchctl \
         "${JB:+$JB/usr/bin/launchctl}" \
         "${JB:+$JB/bin/launchctl}" \
         /var/jb/usr/bin/launchctl; do
    if [ -n "$l" ] && [ -x "$l" ]; then
        case " $LCTLS " in *" $l "*) ;; *) LCTLS="$LCTLS $l" ;; esac
    fi
done
[ -n "$LCTLS" ] || { log "ERROR: 鎵句笉鍒?launchctl"; exit 1; }

# 系统 launchctl 优先；RootHide 的 jbroot launchctl 有时会把作业装进 user/501
GOOD_LCTL=""
for l in $LCTLS; do
    GOOD_LCTL="$l"
    break
done

# 7. Stop old gateway/supervisor/app process
for l in $LCTLS; do
    "$l" bootout system/"$PKG" >/dev/null 2>&1 || true
    "$l" bootout user/501/"$PKG" >/dev/null 2>&1 || true
done
killall -9 agent2api-supervisor agent2api-server agent2api-providers agent2api-web-providers >/dev/null 2>&1 || true
sleep 1

# 8. Start supervisor and verify control port
health_supervisor() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 2 "http://127.0.0.1:$CONTROL_PORT/health" 2>/dev/null | grep -q '"supervisor":"ok"'
        return $?
    fi
    if command -v wget >/dev/null 2>&1; then
        wget -qO- "http://127.0.0.1:$CONTROL_PORT/health" 2>/dev/null | grep -q '"supervisor":"ok"'
        return $?
    fi
    return 1
}

job_running() {
    domain="$1"
    OUT="$("$GOOD_LCTL" print "$domain/$PKG" 2>&1)"
    echo "$OUT" | grep -q 'state = running'
}

REGISTERED=0
for p in $PLISTS; do
    [ -f "$p" ] || continue
    log "try supervisor plist $p"
    "$GOOD_LCTL" bootstrap system "$p" >/tmp/a2a-supervisor-boot.out 2>&1 || {
        OUT="$(cat /tmp/a2a-supervisor-boot.out 2>/dev/null)"
        log "bootstrap: $OUT"
        "$GOOD_LCTL" load -w "$p" >/tmp/a2a-supervisor-boot.out 2>&1 || true
        OUT="$(cat /tmp/a2a-supervisor-boot.out 2>/dev/null)"
        [ -n "$OUT" ] && log "load: $OUT"
    }
    "$GOOD_LCTL" enable system/"$PKG" >/dev/null 2>&1 || true
    i=0
    while [ "$i" -lt 20 ]; do
        if job_running system || job_running user/501; then
            log "supervisor registered (state=running)"
            REGISTERED=1
            if job_running user/501 && ! job_running system; then
                log "supervisor 在 user/501，数据目录交给 mobile"
                chown -R mobile:mobile "$DATA" 2>/dev/null || true
            fi
            break
        fi
        if health_supervisor; then
            log "supervisor ready on $CONTROL_PORT"
            REGISTERED=1
            break
        fi
        i=$((i + 1))
        sleep 1
    done
    [ "$REGISTERED" = "1" ] && break
    "$GOOD_LCTL" print system/"$PKG" 2>&1 | head -n 8 | while IFS= read -r line; do log "$line"; done
    "$GOOD_LCTL" bootout system/"$PKG" >/dev/null 2>&1 || true
done

if [ "$REGISTERED" != "1" ]; then
    log "ERROR: supervisor 娌℃湁鍦?$CONTROL_PORT 鍝嶅簲"
    tail -n 80 "$DATA/supervisor.log" 2>/dev/null | while IFS= read -r line; do log "supervisor.log: $line"; done
    exit 1
fi

# 9. UI cache (app is still old until user opens it; no gateway is started here)
if [ -n "$APP" ]; then
    chmod -R 755 "$APP" 2>/dev/null || true
    chown -R root:wheel "$APP" 2>/dev/null || true
    if command -v uicache >/dev/null 2>&1; then
        uicache -p "$APP" >/dev/null 2>&1 || uicache -a >/dev/null 2>&1 || true
    fi
fi

log "install OK: supervisor running; gateway is stopped until the App sends /start"
exit 0
