#!/bin/bash
# launchd: com.jade.jade3-to-bluesky (moved from ~/Library/Scripts/jade3-to-bluesky.sh so it is under git
# and the fix-reported-errors task can patch it on a branch). Runs
# scripts/post-clip.mjs with the repo's .env; failures are recorded and notified by
# job-wrapper via ~/Developer/error-reporting, a missed run by its heartbeat.
JOB_WRAPPER_LIB="${JOB_WRAPPER_LIB:-/Users/jade/Developer/job-wrapper/job-wrapper.sh}"
[ -r "$JOB_WRAPPER_LIB" ] || { echo "FATAL: job-wrapper missing" >&2; exit 78; }
. "$JOB_WRAPPER_LIB"

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
job_init jade3-to-bluesky "$REPO_DIR/scripts/post-bluesky.log" 5d
job_log "--- started ---"

# Pinned to the node this job has always used; falls back to nvm default.
if [ -x /Users/jade/.nvm/versions/node/v20.18.2/bin/node ]; then
    PATH="/Users/jade/.nvm/versions/node/v20.18.2/bin:$PATH"
else
    job_setup_node || { JOB_FAIL_REASON="node not found on PATH"; exit 127; }
fi

cd "$REPO_DIR"
# .env holds export lines; source it with -eu off so an odd value can't abort.
set +eu
# shellcheck disable=SC1091
source .env
set -eu

code=0
node "scripts/post-clip.mjs" >> "$JOB_LOG_FILE" 2>&1 || code=$?
if (( code != 0 )); then
    JOB_FAIL_REASON="post-clip.mjs failed (exit $code)"
fi
job_log "--- finished (exit $code) ---"
exit "$code"
