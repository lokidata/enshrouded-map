#!/bin/sh
# Hot backup of the SQLite database (consistent even while the API runs): ./backup.sh [destination-file]
set -e
cd "$(dirname "$0")"
dest="${1:-./backup-$(date +%Y%m%d-%H%M%S).db}"
docker compose exec -T api python -c "
import sqlite3
src = sqlite3.connect('/data/app.db')
dst = sqlite3.connect('/data/backup.db')
src.backup(dst)
dst.close()"
docker compose cp api:/data/backup.db "$dest"
docker compose exec -T api rm /data/backup.db
echo "Saved to $dest"
