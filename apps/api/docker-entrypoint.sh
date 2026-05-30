#!/bin/sh
set -e
echo "Pushing database schema..."
./apps/api/node_modules/.bin/prisma db push --schema=./apps/api/prisma/schema.prisma --accept-data-loss
echo "Seeding database..."
./apps/api/node_modules/.bin/prisma db seed --schema=./apps/api/prisma/schema.prisma
echo "Starting API server..."
exec node apps/api/dist/app.js
