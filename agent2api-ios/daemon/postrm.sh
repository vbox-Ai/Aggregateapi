#!/bin/sh
# Clean uninstall: remove all gateway data, accounts, API keys and plugins.
# Only on actual removal/purge; upgrades keep the data.
set -u
PKG="com.chiyu.agent2api"
DATA="/var/mobile/Library/agent2api"
case "${1:-}" in
    remove|purge)
        for l in /bin/launchctl /usr/bin/launchctl /var/jb/usr/bin/launchctl; do
            [ -x "$l" ] && "$l" bootout system/"$PKG" >/dev/null 2>&1 || true
            [ -x "$l" ] && "$l" bootout user/501/"$PKG" >/dev/null 2>&1 || true
        done
        killall -9 agent2api-supervisor agent2api-server agent2api-providers agent2api-web-providers >/dev/null 2>&1 || true
        rm -rf "$DATA"
        rm -rf /var/mobile/Library/Caches/"$PKG"
        ;;
esac
exit 0
