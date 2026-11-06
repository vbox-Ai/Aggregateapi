#!/bin/sh
# Agent2API 3.4.172 RootHide/Relaxin 修复版 postinst
# 目标：无论 dpkg 把文件落在真实根还是 .jbroot-*，都找到它们，
# 用真实绝对路径写 LaunchDaemon，并验证 3065 真的起来。
set -u

PKG="com.chiyu.agent2api"
DATA="/var/mobile/Library/agent2api"
PORT="3065"
LOG="$DATA/install.log"

log() {
    echo "[agent2api] $*"
    echo "[agent2api] $*" >>"$LOG" 2>/dev/null || true
}

mkdir -p "$DATA" 2>/dev/null || true
chown -R root:wheel "$DATA" 2>/dev/null || true
chmod 755 "$DATA" 2>/dev/null || true



# ---------- 1. 找 RootHide 的真实根 ----------
JB=""
for d in /private/var/containers/Bundle/Application/.jbroot-* \
         /var/containers/Bundle/Application/.jbroot-*; do
    if [ -d "$d" ]; then
        JB="$d"
        break
    fi
done
if [ -n "$JB" ]; then
    log "jbroot=$JB"
else
    log "未发现 .jbroot-*，按普通 rootful 处理"
fi

# ---------- 2. 找 daemon 和 UI（真实根 / jbroot 都查） ----------
BIN=""
for f in \
    "${JB:+$JB/usr/local/bin/agent2api-server}" \
    /var/jb/usr/local/bin/agent2api-server \
    /usr/local/bin/agent2api-server; do
    if [ -n "$f" ] && [ -x "$f" ]; then
        BIN="$f"
        break
    fi
done
if [ -z "$BIN" ]; then
    BIN="$(find "${JB:-/nonexistent}" /var/jb /usr/local /Applications \
        -name agent2api-server -type f 2>/dev/null | head -n 1)"
fi
[ -n "$BIN" ] || { log "ERROR: 找不到 agent2api-server"; exit 1; }
chmod 755 "$BIN" 2>/dev/null || true
log "BIN=$BIN"

UI=""
for u in \
    "${JB:+$JB/usr/local/share/agent2api/ui}" \
    /var/jb/usr/local/share/agent2api/ui \
    /usr/local/share/agent2api/ui; do
    if [ -n "$u" ] && [ -f "$u/m.html" ]; then
        UI="$u"
        break
    fi
done
if [ -z "$UI" ]; then
    U="$(find "${JB:-/nonexistent}" /var/jb /usr/local \
        -path '*/agent2api/ui/m.html' -type f 2>/dev/null | head -n 1)"
    [ -n "$U" ] && UI="$(dirname "$U")"
fi
[ -n "$UI" ] || { log "ERROR: 找不到面板 UI"; exit 1; }
log "UI=$UI"

APP=""
for a in \
    "${JB:+$JB/Applications/Agent2API.app}" \
    /var/jb/Applications/Agent2API.app \
    /Applications/Agent2API.app; do
    if [ -n "$a" ] && [ -d "$a" ]; then
        APP="$a"
        break
    fi
done
if [ -n "$APP" ]; then
    chmod -R 755 "$APP" 2>/dev/null || true
    chown -R root:wheel "$APP" 2>/dev/null || true
    if command -v uicache >/dev/null 2>&1; then
        uicache -p "$APP" >/dev/null 2>&1 || uicache -a >/dev/null 2>&1 || true
    fi
    log "APP=$APP"
fi

# ---------- 3. 预置插件 ----------
PACKDIR=""
for p in \
    "${JB:+$JB/usr/local/share/agent2api/packs}" \
    /var/jb/usr/local/share/agent2api/packs \
    /usr/local/share/agent2api/packs; do
    if [ -n "$p" ] && [ -d "$p" ]; then
        PACKDIR="$p"
        break
    fi
done
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
    log "已预置插件：$PACKDIR"
fi

# ---------- 4. 给 launchd 准备真实路径 ----------
# RootHide 的 launchd 对 .jbroot-* 绝对路径经常不认；优先用 /usr/local 真实路径。
REAL_BIN="$BIN"
if [ -n "$JB" ]; then
    case "$BIN" in
        "$JB"/*)
            if mkdir -p /usr/local/bin 2>/dev/null &&
               cp -f "$BIN" /usr/local/bin/agent2api-server 2>/dev/null; then
                REAL_BIN="/usr/local/bin/agent2api-server"
                chmod 755 "$REAL_BIN" 2>/dev/null || true
            fi
            ;;
    esac
fi

REAL_UI="$UI"
if [ -n "$JB" ]; then
    case "$UI" in
        "$JB"/*)
            if mkdir -p /usr/local/share/agent2api/ui 2>/dev/null &&
               cp -R "$UI"/. /usr/local/share/agent2api/ui/ 2>/dev/null; then
                REAL_UI="/usr/local/share/agent2api/ui"
            fi
            ;;
    esac
fi
log "REAL_BIN=$REAL_BIN"
log "REAL_UI=$REAL_UI"

# ---------- 4.5 安装 launcher ----------
# 这个 launcher 是 daemon 的“守门员”：
#   - 3065 已有健康网关：只 sleep，不抢端口；
#   - 旧网关死掉：立刻 exec 新 daemon；
#   - launchd 的 KeepAlive 会一直重启它，所以不会出现“旧进程死了就没人管”。
LAUNCHER="$(dirname "$REAL_BIN")/agent2api-launch"
mkdir -p "$(dirname "$LAUNCHER")" 2>/dev/null || true
cat >"$LAUNCHER" <<'LAUNCH'
#!/bin/sh
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
LAUNCH
chmod 755 "$LAUNCHER" 2>/dev/null || true
chown root:wheel "$LAUNCHER" 2>/dev/null || true
log "LAUNCHER=$LAUNCHER"

# ---------- 5. 生成 plist ----------
write_plist() {
    plist="$1"
    pbin="$2"
    pui="$3"
    mkdir -p "$(dirname "$plist")" 2>/dev/null || return 1
    cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$PKG</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>$LAUNCHER</string>
    <string>$pbin</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>AGENT2API_PROXY_HOME</key><string>$DATA</string>
    <key>HOME</key><string>$DATA</string>
    <key>AGENT2API_UI_DIR</key><string>$pui</string>
    <key>AGENT2API_HOST</key><string>127.0.0.1</string>
    <key>AGENT2API_PROXY_PORT</key><string>$PORT</string>
    <key>AGENT2API_CAPTCHA_ENABLED</key><string>0</string>
    <key>AGENT2API_SELF_UPDATE</key><string>0</string>
    <key>AGENT2API_ALLOW_EXEC</key><string>1</string>
    <key>AGENT2API_INPROC</key><string>1</string>
    <key>AGENT2API_DEPLOY</key><string>ios</string>
    <key>AGENT2API_VERBOSE</key><string>0</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>5</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>$DATA/server.log</string>
  <key>StandardErrorPath</key><string>$DATA/server.log</string>
  <key>AbandonProcessGroup</key><false/>
  <key>LowPriorityIO</key><false/>
</dict>
</plist>
EOF
    chown root:wheel "$plist" 2>/dev/null || true
    chmod 644 "$plist" 2>/dev/null || true
    log "plist=$plist"
}

remove_plists() {
    rm -f "/Library/LaunchDaemons/$PKG.plist" 2>/dev/null || true
    if [ -n "$JB" ]; then
        rm -f "$JB/Library/LaunchDaemons/$PKG.plist" 2>/dev/null || true
    fi
    if [ -d /var/jb ]; then
        rm -f "/var/jb/Library/LaunchDaemons/$PKG.plist" 2>/dev/null || true
    fi
}

# ---------- 6. 找 launchctl ----------
LCTLS=""
for l in \
    "${JB:+$JB/usr/bin/launchctl}" \
    "${JB:+$JB/bin/launchctl}" \
    /bin/launchctl \
    /var/jb/usr/bin/launchctl; do
    if [ -n "$l" ] && [ -x "$l" ]; then
        case " $LCTLS " in
            *" $l "*) ;;
            *) LCTLS="$LCTLS $l" ;;
        esac
    fi
done
[ -n "$LCTLS" ] || { log "ERROR: 找不到 launchctl"; exit 1; }
log "LCTLS=$LCTLS"

# 选一个能访问 system domain 的 launchctl，优先 jbroot 的
GOOD_LCTL=""
for l in $LCTLS; do
    if "$l" print system >/dev/null 2>&1; then
        GOOD_LCTL="$l"
        break
    fi
done
if [ -z "$GOOD_LCTL" ]; then
    for l in $LCTLS; do
        GOOD_LCTL="$l"
        break
    done
fi
log "GOOD_LCTL=$GOOD_LCTL"

# ---------- 8. 逐个组合尝试 ----------
health() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'
        return $?
    fi
    if command -v wget >/dev/null 2>&1; then
        wget -qO- "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"ok"'
        return $?
    fi
    if command -v nc >/dev/null 2>&1; then
        (printf 'GET /health HTTP/1.0\r\n\r\n'; sleep 1) | nc 127.0.0.1 "$PORT" 2>/dev/null | grep -q '"ok"'
        return $?
    fi
    return 1
}

# 如果 3065 上已经有一个健康网关，绝对不要为了“启动新 daemon”把它顶掉。
# 当前保持它继续服务；把我们的 plist 写好，下一次重启/重新越狱时再由 launchd 启动。
if health; then
    log "existing gateway on 3065 is healthy; keep it for this boot"
    if [ -d /Library/LaunchDaemons ] || mkdir -p /Library/LaunchDaemons 2>/dev/null; then
        write_plist "/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" >/dev/null 2>&1 || true
    fi
    if [ -n "$JB" ]; then
        write_plist "$JB/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" >/dev/null 2>&1 || true
    fi
    if [ -d /var/jb ]; then
        write_plist "/var/jb/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" >/dev/null 2>&1 || true
    fi

    # 只注册 launcher，不 bootout、不 kill 当前健康网关。
    # launcher 会先 sleep；旧网关一死，它就会 exec 新 daemon。
    REGISTERED=0
    for p in \
        "/Library/LaunchDaemons/$PKG.plist" \
        "${JB:+$JB/Library/LaunchDaemons/$PKG.plist}" \
        "/var/jb/Library/LaunchDaemons/$PKG.plist"; do
        [ -n "$p" ] && [ -f "$p" ] || continue
        OUT="$("$GOOD_LCTL" bootstrap system "$p" 2>&1)" && {
            log "launcher registered via $p"
            REGISTERED=1
            break
        }
        log "bootstrap skipped: $p: $OUT"
        OUT2="$("$GOOD_LCTL" load -w "$p" 2>&1)" && {
            log "launcher loaded via $p"
            REGISTERED=1
            break
        }
        log "load skipped: $p: $OUT2"
    done
    "$GOOD_LCTL" enable system/"$PKG" >/dev/null 2>&1 || true
    log "existing gateway left running; takeover launcher registered=$REGISTERED"
    exit 0
fi

try_plist() {
    p="$1"
    b="$2"
    u="$3"

    remove_plists
    if ! write_plist "$p" "$b" "$u"; then
        log "write plist failed: $p"
        return 1
    fi

    for l in $LCTLS; do
        "$l" bootout system/"$PKG" >/dev/null 2>&1 || true
    done
    killall -9 agent2api-server >/dev/null 2>&1 || true
    sleep 1

    log "try: $GOOD_LCTL bootstrap $p"
    OUT="$("$GOOD_LCTL" bootstrap system "$p" 2>&1)" || {
        log "bootstrap: $OUT"
        OUT2="$("$GOOD_LCTL" load -w "$p" 2>&1)" || log "load: $OUT2"
    }
    "$GOOD_LCTL" enable system/"$PKG" >/dev/null 2>&1 || true
    "$GOOD_LCTL" kickstart -k system/"$PKG" >/dev/null 2>&1 || true

    # 给迁移数据库/初始化插件留时间，不要 2 秒就把它 bootout 掉
    i=0
    while [ "$i" -lt 10 ]; do
        if health; then
            log "OK: gateway ready via $p"
            if command -v curl >/dev/null 2>&1; then
                log "health: $(curl -fsS --max-time 2 "http://127.0.0.1:$PORT/health" 2>/dev/null)"
            fi
            # 在其它可能被 launchd 扫描的位置放一份同样内容的 plist，
            # 保证重启后无论 launchd 扫哪个目录，启动参数都一致。
            if [ -n "$JB" ]; then
                write_plist "$JB/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
            fi
            if [ -d /var/jb ]; then
                write_plist "/var/jb/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
            fi
            if [ "$p" != "/Library/LaunchDaemons/$PKG.plist" ]; then
                write_plist "/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
            fi
            return 0
        fi
        i=$((i + 1))
        sleep 1
    done

    PRINT="$("$GOOD_LCTL" print system/"$PKG" 2>&1 | head -n 8)"
    [ -n "$PRINT" ] && log "$PRINT"

    # 端口可能还在 TIME_WAIT，或者数据库迁移较慢。只要 launchd 里 job 已经加载，
    # 就让 launcher/KeepAlive 继续重试，不要把安装判失败。
    if "$GOOD_LCTL" print system/"$PKG" >/dev/null 2>&1; then
        log "launcher loaded; health not ready yet, leaving it to retry"
        if [ -n "$JB" ]; then
            write_plist "$JB/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
        fi
        if [ -d /var/jb ]; then
            write_plist "/var/jb/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
        fi
        if [ "$p" != "/Library/LaunchDaemons/$PKG.plist" ]; then
            write_plist "/Library/LaunchDaemons/$PKG.plist" "$b" "$u" >/dev/null 2>&1 || true
        fi
        return 0
    fi

    "$GOOD_LCTL" bootout system/"$PKG" >/dev/null 2>&1 || true
    return 1
}

# 组合 1：标准 /Library + 真实路径
if [ -d /Library/LaunchDaemons ] || mkdir -p /Library/LaunchDaemons 2>/dev/null; then
    try_plist "/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" && exit 0
fi

# 组合 2：jbroot plist + jbroot 路径
if [ -n "$JB" ]; then
    try_plist "$JB/Library/LaunchDaemons/$PKG.plist" "$BIN" "$UI" && exit 0

    # 组合 3：jbroot plist + 真实路径（有些 RootHide 只认 jbroot plist）
    if [ "$REAL_BIN" != "$BIN" ] || [ "$REAL_UI" != "$UI" ]; then
        try_plist "$JB/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" && exit 0
    fi
fi

# 组合 4：/var/jb 路径
if [ -d /var/jb ]; then
    try_plist "/var/jb/Library/LaunchDaemons/$PKG.plist" "$BIN" "$UI" && exit 0
fi

# ---------- 9. 失败：留下标准 plist 和诊断，不再 nohup 假成功 ----------
if [ -d /Library/LaunchDaemons ]; then
    write_plist "/Library/LaunchDaemons/$PKG.plist" "$REAL_BIN" "$REAL_UI" >/dev/null 2>&1 || true
fi

log "ERROR: gateway 没有起来"
tail -n 80 "$DATA/server.log" 2>/dev/null | while IFS= read -r line; do
    log "server.log: $line"
done
exit 1
