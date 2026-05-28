-- Redefine SQLite User table to add JSON columns and migrate role values.
PRAGMA foreign_keys=OFF;

CREATE TABLE "User_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SELLER',
    "extraPermissions" TEXT,
    "revokedPermissions" TEXT,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "User_new" (
  "id", "name", "username", "email", "password", "role",
  "extraPermissions", "revokedPermissions",
  "phone", "isActive", "createdAt", "updatedAt"
)
SELECT
  "id", "name", "username", "email", "password",
  CASE
    WHEN "role" = 'SALESPERSON' THEN 'SELLER'
    ELSE "role"
  END,
  NULL, NULL,
  "phone", "isActive", "createdAt", "updatedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "User_new" RENAME TO "User";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

PRAGMA foreign_keys=ON;
