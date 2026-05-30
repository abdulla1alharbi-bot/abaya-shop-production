#!/bin/sh
set -e

PRISMA="./apps/api/node_modules/.bin/prisma"
SCHEMA="./apps/api/prisma/schema.prisma"
TSX="./apps/api/node_modules/.bin/tsx"
SEED="./apps/api/prisma/seed.ts"

echo "Pushing database schema..."
"$PRISMA" db push --schema="$SCHEMA" --accept-data-loss

echo "Seeding database..."
if [ -f "$TSX" ]; then
  "$TSX" "$SEED" && echo "Seed complete." || echo "Seed failed (non-fatal — app will auto-create defaults on first use)."
else
  echo "tsx not found — skipping seed (app will auto-create defaults on first use)."
fi

echo "Starting API server..."
exec node apps/api/dist/app.js
