#!/bin/bash
# launchd: com.jade.j3-release-day-rebuild. Runs scripts/j3-release-day-rebuild.mjs
# daily with the repo's .env, so an upcoming release goes live on its date.
# Failures are recorded and notified by job-wrapper via error-reporting,
# a missed run by its heartbeat.
JOB_WRAPPER_LIB="${JOB_WRAPPER_LIB:-$HOME/.local/lib/job-wrapper.sh}"
[ -r "$JOB_WRAPPER_LIB" ] || { echo "FATAL: job-wrapper missing" >&2; exit 78; }
. "$JOB_WRAPPER_LIB"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
job_init j3-release-day-rebuild "$REPO_DIR/scripts/j3-release-day-rebuild.log" 3d
job_log "--- started ---"

job_setup_node || { JOB_FAIL_REASON="node not found on PATH"; exit 127; }

cd "$REPO_DIR"
# .env holds export lines; source it with -eu off so an odd value can't abort.
set +eu
# shellcheck disable=SC1091
source .env
set -eu

# Arguments (e.g. --dry-run) pass through to node; a manual run with
# arguments is not the schedule's success, so it writes no heartbeat.
if [ $# -gt 0 ]; then JOB_NO_HEARTBEAT=1; fi
code=0
node "scripts/j3-release-day-rebuild.mjs" "$@" >> "$JOB_LOG_FILE" 2>&1 || code=$?
if (( code != 0 )); then
    JOB_FAIL_REASON="j3-release-day-rebuild.mjs failed (exit $code); see scripts/j3-release-day-rebuild.log"
fi
job_log "--- finished (exit $code) ---"
exit "$code"
