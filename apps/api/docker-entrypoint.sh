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
  if "$TSX" "$SEED"; then
    echo "Seed complete."
  else
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
    echo "WARNING: SEED FAILED — see the error above. The app still boots;"
    echo "ensureSystemDefaults() creates the records it hard-requires, but"
    echo "demo/sample data was NOT seeded. Do not ignore this."
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  fi
else
  echo "WARNING: tsx not found — skipping seed. ensureSystemDefaults() covers required records on boot."
fi

echo "Starting API server..."
exec node apps/api/dist/app.js
