-- The profile a startup fits best (E24-6, #407): Startups match against
-- every profile and keep the best one's score. What's there was scored
-- against the first profile. Startup is rebuilt for the column; it has
-- nothing added by hand (COLLATE NOCASE and the trigger are on Skill,
-- Language and Theme).

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Startup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "website" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "remote" BOOLEAN,
    "stage" TEXT NOT NULL DEFAULT '',
    "roles" JSONB NOT NULL,
    "emails" JSONB NOT NULL,
    "links" JSONB NOT NULL,
    "postedAt" DATETIME,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "profileId" TEXT,
    "scoredWith" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "noApplicationsFrom" TEXT NOT NULL DEFAULT '',
    "emailsCheckedAt" DATETIME,
    "peopleCheckedAt" DATETIME,
    "notes" TEXT NOT NULL DEFAULT '',
    "seenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applicationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Startup_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Startup_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Startup" ("applicationId", "company", "createdAt", "details", "emails", "emailsCheckedAt", "externalId", "id", "links", "location", "noApplicationsFrom", "notes", "peopleCheckedAt", "postedAt", "reasons", "remote", "roles", "score", "scoredWith", "seenAt", "source", "stage", "status", "summary", "updatedAt", "website") SELECT "applicationId", "company", "createdAt", "details", "emails", "emailsCheckedAt", "externalId", "id", "links", "location", "noApplicationsFrom", "notes", "peopleCheckedAt", "postedAt", "reasons", "remote", "roles", "score", "scoredWith", "seenAt", "source", "stage", "status", "summary", "updatedAt", "website" FROM "Startup";
DROP TABLE "Startup";
ALTER TABLE "new_Startup" RENAME TO "Startup";
CREATE UNIQUE INDEX "Startup_applicationId_key" ON "Startup"("applicationId");
CREATE INDEX "Startup_status_score_idx" ON "Startup"("status", "score");
CREATE UNIQUE INDEX "Startup_source_externalId_key" ON "Startup"("source", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Startups so far were scored against the first profile (E24-6).
UPDATE "Startup" SET "profileId" = (SELECT "id" FROM "Profile" ORDER BY "sort", "createdAt" LIMIT 1);
