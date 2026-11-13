#!/usr/bin/env bash
# Daily full PostgreSQL backup (run from cron OUTSIDE trading hours), 90-day retention.
#   0 3 * * *  /opt/unique-empire/scripts/backup.sh
# BACKUP_DIR must be (or be synced to) storage SEPARATE from this VPS, e.g. a mounted bucket or an rclone remote.
set -euo pipefail
cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backup}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR/full"

if docker compose exec -T db pg_dump -U "${POSTGRES_USER:-ue}" -Fc "${POSTGRES_DB:-unique_empire}" > "$BACKUP_DIR/full/ue_$STAMP.dump" \
   && [ -s "$BACKUP_DIR/full/ue_$STAMP.dump" ]; then
  find "$BACKUP_DIR/full" -name 'ue_*.dump' -mtime +90 -delete
  # Optional off-box copy, e.g.: rclone copy "$BACKUP_DIR" remote:unique-empire-backups
  echo "backup ok: ue_$STAMP.dump"
else
  rm -f "$BACKUP_DIR/full/ue_$STAMP.dump"
  docker compose exec -T api python -m scripts.report_backup_failure "pg_dump failed at $STAMP" || true
  echo "backup FAILED" >&2
  exit 1
fi
