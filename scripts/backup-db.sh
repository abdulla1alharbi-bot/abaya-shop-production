#!/bin/sh
# Daily PostgreSQL backup for the abaya-shop production server.
# Installed as a root cron job (see scripts/install-backup-cron.sh).
#
# - Dumps the abaya_shop DB from the postgres container (custom format, compressed)
# - Keeps the last 14 daily backups in /opt/backups
#
# RESTORE (destructive — restores over the live DB, stop the api first):
#   cd /opt/abaya-shop-production && docker compose stop api
#   docker exec -i <postgres-container> pg_restore -U abaya -d abaya_shop --clean --if-exists /tmp/restore.dump
#   (first: docker cp /opt/backups/<file>.dump <postgres-container>:/tmp/restore.dump)
#   docker compose start api

set -eu

BACKUP_DIR="/opt/backups"
CONTAINER="abaya-shop-production-postgres-1"
DB_NAME="abaya_shop"
DB_USER="abaya"
KEEP_DAYS=14

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d_%H%M%S)
TMP_IN_CONTAINER="/tmp/abaya_backup_$STAMP.dump"
OUT="$BACKUP_DIR/abaya_shop_$STAMP.dump"

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -F c -f "$TMP_IN_CONTAINER"
docker cp "$CONTAINER:$TMP_IN_CONTAINER" "$OUT"
docker exec "$CONTAINER" rm -f "$TMP_IN_CONTAINER"

# prune old backups
find "$BACKUP_DIR" -name 'abaya_shop_*.dump' -mtime +"$KEEP_DAYS" -delete

echo "[backup-db] OK $OUT ($(du -h "$OUT" | cut -f1))"
