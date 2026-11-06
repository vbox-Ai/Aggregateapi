#!/bin/sh
set -u
PKG="com.chiyu.agent2api"
for l in /bin/launchctl /usr/bin/launchctl /var/jb/usr/bin/launchctl; do
    [ -x "$l" ] && "$l" bootout system/"$PKG" >/dev/null 2>&1 || true
done
killall -9 agent2api-server >/dev/null 2>&1 || true
exit 0
