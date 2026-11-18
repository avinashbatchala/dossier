-- What a custom section counts as (E24-5, #406): Extra activities unless the user says otherwise.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CustomSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'ENTRIES',
    "countsAs" TEXT NOT NULL DEFAULT 'EXTRA_ACTIVITIES',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomSection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CustomSection" ("createdAt", "format", "id", "profileId", "title", "updatedAt") SELECT "createdAt", "format", "id", "profileId", "title", "updatedAt" FROM "CustomSection";
DROP TABLE "CustomSection";
ALTER TABLE "new_CustomSection" RENAME TO "CustomSection";
CREATE INDEX "CustomSection_profileId_idx" ON "CustomSection"("profileId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

