#!/bin/bash
# Starts a virtual display for the headed browser, runs the agent worker on it, and stops both together.
set -u

display="${DISPLAY:-:99}"
number="${display#:}"
rm -f "/tmp/.X${number}-lock"

Xvfb "$display" -screen 0 1366x900x24 -nolisten tcp &
xvfb=$!

for _ in $(seq 1 100); do
  [ -S "/tmp/.X11-unix/X${number}" ] && break
  kill -0 "$xvfb" 2>/dev/null || { echo "Xvfb exited before the display was ready" >&2; exit 1; }
  sleep 0.1
done

node dist/main.js &
app=$!
stopping=0
trap 'stopping=1; kill -TERM "$app" 2>/dev/null' TERM INT

wait -n "$app" "$xvfb"
status=$?

# A signal or a dead display leaves the worker running, so ask it to finish and take its status.
# A second TERM would make the worker exit at once, so a signal it was already sent is not repeated.
if kill -0 "$app" 2>/dev/null; then
  [ "$stopping" = 1 ] || kill -TERM "$app" 2>/dev/null
  wait "$app"
  status=$?
fi
kill "$xvfb" 2>/dev/null
exit "$status"
