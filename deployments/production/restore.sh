#!/usr/bin/env bash
# Restore the database from a backup made by db-backup or update.sh.
#
#   bash deployments/production/restore.sh backups/taskflow-20261015-020000.sql.gz
#
# The app services are stopped during the restore and started again after.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

dump="${1:-}"
if [[ -z "$dump" || ! -f "$dump" ]]; then
  echo "Usage: $0 backups/<file>.sql.gz" >&2
  ls -1t backups/*.sql.gz 2>/dev/null | head -5 | sed 's/^/  available: /' >&2
  exit 1
fi

read -rp "This replaces ALL current data with $dump. Type 'restore' to continue: " answer
[[ "$answer" == "restore" ]] || { echo "Cancelled."; exit 1; }

apps="user-service task-service notification-service org-service itsm-service api-gateway web"
docker compose stop $apps
gunzip -c "$dump" | docker compose exec -T postgres psql -U taskflow -d taskflow -v ON_ERROR_STOP=1 -q
docker compose start $apps
echo "Restored $dump."
