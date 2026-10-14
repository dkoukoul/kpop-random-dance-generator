#!/usr/bin/env bash
#
# Delete generated mp3 files from temp/.
#
# Segment and output mp3s are throwaway build artifacts - only the _report.json
# files are read back after a job finishes (GET /api/download-report/:jobId), so
# those are left alone.
#
# Files modified within the last hour are skipped: a generation job downloads
# its segments and concatenates them in temp/, and deleting those mid-job would
# corrupt the mix being built.
#
# Usage: cleanup-temp-mp3.sh [--dry-run]
# Runs daily at 05:00 from cron (see crontab).

set -uo pipefail

# Resolve the project root from this script's location so cron's bare
# environment doesn't need a working directory set.
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMP_DIR="$PROJECT_DIR/temp"
LOG_FILE="$PROJECT_DIR/logs/temp-cleanup.log"

MIN_AGE_MINUTES=60

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

if [[ ! -d "$TEMP_DIR" ]]; then
  log "temp dir $TEMP_DIR not found, nothing to do"
  exit 0
fi

# -maxdepth 1 keeps this from following anything nested, and the -name filter
# means a stray non-mp3 in temp/ is never a candidate.
mapfile -d '' -t stale < <(
  find "$TEMP_DIR" -maxdepth 1 -type f -name '*.mp3' -mmin "+$MIN_AGE_MINUTES" -print0
)

if [[ ${#stale[@]} -eq 0 ]]; then
  log "no mp3 files older than ${MIN_AGE_MINUTES}m; nothing deleted"
  exit 0
fi

bytes=0
for f in "${stale[@]}"; do
  size=$(stat -c %s "$f" 2>/dev/null) || continue
  bytes=$(( bytes + size ))
done
human=$(numfmt --to=iec --suffix=B "$bytes" 2>/dev/null || echo "${bytes}B")

if [[ $DRY_RUN -eq 1 ]]; then
  log "DRY RUN: would delete ${#stale[@]} mp3 file(s), freeing $human"
  printf '%s\n' "${stale[@]}"
  exit 0
fi

deleted=0
failed=0
for f in "${stale[@]}"; do
  if rm -f -- "$f"; then
    deleted=$(( deleted + 1 ))
  else
    failed=$(( failed + 1 ))
    log "failed to delete $f"
  fi
done

kept=$(find "$TEMP_DIR" -maxdepth 1 -type f -name '*.mp3' | wc -l)
log "deleted $deleted mp3 file(s), freed $human; $kept newer than ${MIN_AGE_MINUTES}m kept; $failed failure(s)"

# Keep the log from growing without bound.
if [[ $(stat -c %s "$LOG_FILE" 2>/dev/null || echo 0) -gt 1048576 ]]; then
  tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
  log "log truncated to last 500 lines"
fi

exit 0
