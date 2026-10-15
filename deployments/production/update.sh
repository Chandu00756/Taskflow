#!/usr/bin/env bash
# Rebuild and restart after you pull new code. Takes a backup first.
#
#   cd ~/Taskflow && <pull the latest code> && bash deployments/production/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "==> Backing up the database"
mkdir -p backups
f="backups/taskflow-pre-update-$(date +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U taskflow --no-owner --clean --if-exists taskflow' | gzip > "$f"
echo "    $f"

echo "==> Building new images"
docker compose build

echo "==> Restarting changed services"
docker compose up -d
docker image prune -f >/dev/null

echo "==> Status"
docker compose ps
