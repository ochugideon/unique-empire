"""Called by scripts/backup.sh when a backup fails, so the owner sees it (FR-146)."""
import sys

from app.services.technical import record_technical_event

if __name__ == "__main__":
    record_technical_event("CRITICAL", "BACKUP", "Scheduled database backup failed", {"detail": " ".join(sys.argv[1:])[:300]})
