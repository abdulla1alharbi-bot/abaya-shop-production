#!/bin/sh
set -e
echo "Running database migrations..."
./apps/api/node_modules/.bin/prisma migrate deploy --schema=./apps/api/prisma/schema.prisma
echo "Migrations complete. Starting API server..."
exec node apps/api/dist/app.js
