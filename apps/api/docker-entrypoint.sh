#!/bin/sh
set -e

PRISMA="./apps/api/node_modules/.bin/prisma"
SCHEMA="./apps/api/prisma/schema.prisma"
TSX="./apps/api/node_modules/.bin/tsx"

echo "Pushing database schema..."
"$PRISMA" db push --schema="$SCHEMA" --accept-data-loss

echo "Seeding database..."
"$TSX" ./apps/api/prisma/seed.ts

echo "Starting API server..."
exec node apps/api/dist/app.js
