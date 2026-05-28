-- Recreate User with username (login) and optional email (SQLite).
PRAGMA foreign_keys=OFF;

CREATE TABLE "User_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SALESPERSON',
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "User_new" ("id", "name", "username", "email", "password", "role", "phone", "isActive", "createdAt", "updatedAt")
SELECT
  "id",
  "name",
  CASE
    WHEN LENGTH(TRIM(LOWER(
      CASE WHEN instr("email", '@') > 0 THEN substr("email", 1, instr("email", '@') - 1) ELSE "email" END
    ))) > 0 THEN TRIM(LOWER(
      CASE WHEN instr("email", '@') > 0 THEN substr("email", 1, instr("email", '@') - 1) ELSE "email" END
    ))
    ELSE 'user_' || substr("id", 1, 8)
  END AS "username",
  "email",
  "password",
  "role",
  "phone",
  "isActive",
  "createdAt",
  "updatedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "User_new" RENAME TO "User";

CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

PRAGMA foreign_keys=ON;
