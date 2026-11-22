-- Several profiles (E24-1, #402). Today's profile becomes the first one: it
-- takes the headline, the summary and the Base resume's settings, which were
-- global, and every section's rows. Its name is the headline, or "My profile".
-- The other basics, the languages and the facts stay shared.
-- Added by hand: the first profile and its rows, and COLLATE NOCASE on the
-- rebuilt Skill table (a skill's name is unique in its profile, ignoring case).
-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

INSERT INTO "Profile" ("id", "name", "headline", "summary", "settings", "updatedAt")
SELECT
    'first',
    COALESCE(NULLIF(substr(trim((SELECT "value" FROM "ProfileField" WHERE "key" = 'headline')), 1, 80), ''), 'My profile'),
    COALESCE((SELECT "value" FROM "ProfileField" WHERE "key" = 'headline'), ''),
    COALESCE((SELECT "value" FROM "ProfileField" WHERE "key" = 'summary'), ''),
    COALESCE((SELECT json_group_object("key", "value") FROM "Setting" WHERE "key" IN ('baseThemeId', 'resumeLanguage', 'resumeSections', 'fitBaseResume', 'skillOrder', 'experienceOrder', 'projectOrder', 'educationOrder')), '{}'),
    CURRENT_TIMESTAMP;

DELETE FROM "ProfileField" WHERE "key" IN ('headline', 'summary');
DELETE FROM "Setting" WHERE "key" IN ('baseThemeId', 'resumeLanguage', 'resumeSections', 'fitBaseResume', 'skillOrder', 'experienceOrder', 'projectOrder', 'educationOrder');

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Certification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "year" INTEGER,
    "month" INTEGER,
    "expiryYear" INTEGER,
    "expiryMonth" INTEGER,
    "credentialId" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Certification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Certification" ("profileId", "createdAt", "credentialId", "expiryMonth", "expiryYear", "id", "issuer", "link", "month", "name", "onResumes", "sort", "updatedAt", "year") SELECT 'first', "createdAt", "credentialId", "expiryMonth", "expiryYear", "id", "issuer", "link", "month", "name", "onResumes", "sort", "updatedAt", "year" FROM "Certification";
DROP TABLE "Certification";
ALTER TABLE "new_Certification" RENAME TO "Certification";
CREATE INDEX "Certification_profileId_idx" ON "Certification"("profileId");
CREATE TABLE "new_CustomSection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "format" TEXT NOT NULL DEFAULT 'ENTRIES',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomSection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CustomSection" ("profileId", "createdAt", "format", "id", "title", "updatedAt") SELECT 'first', "createdAt", "format", "id", "title", "updatedAt" FROM "CustomSection";
DROP TABLE "CustomSection";
ALTER TABLE "new_CustomSection" RENAME TO "CustomSection";
CREATE INDEX "CustomSection_profileId_idx" ON "CustomSection"("profileId");
CREATE TABLE "new_Education" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "degree" TEXT NOT NULL DEFAULT '',
    "school" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Education" ("profileId", "createdAt", "current", "degree", "endMonth", "endYear", "id", "notes", "school", "sort", "startMonth", "startYear", "updatedAt") SELECT 'first', "createdAt", "current", "degree", "endMonth", "endYear", "id", "notes", "school", "sort", "startMonth", "startYear", "updatedAt" FROM "Education";
DROP TABLE "Education";
ALTER TABLE "new_Education" RENAME TO "Education";
CREATE INDEX "Education_profileId_idx" ON "Education"("profileId");
CREATE TABLE "new_Experience" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "descriptor" TEXT NOT NULL DEFAULT '',
    "volunteering" BOOLEAN NOT NULL DEFAULT false,
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Experience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Experience" ("profileId", "bullets", "company", "createdAt", "current", "descriptor", "endMonth", "endYear", "id", "location", "role", "sort", "startMonth", "startYear", "updatedAt", "volunteering") SELECT 'first', "bullets", "company", "createdAt", "current", "descriptor", "endMonth", "endYear", "id", "location", "role", "sort", "startMonth", "startYear", "updatedAt", "volunteering" FROM "Experience";
DROP TABLE "Experience";
ALTER TABLE "new_Experience" RENAME TO "Experience";
CREATE INDEX "Experience_profileId_idx" ON "Experience"("profileId");
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("profileId", "bullets", "createdAt", "current", "endMonth", "endYear", "id", "link", "name", "sort", "startMonth", "startYear", "updatedAt") SELECT 'first', "bullets", "createdAt", "current", "endMonth", "endYear", "id", "link", "name", "sort", "startMonth", "startYear", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_profileId_idx" ON "Project"("profileId");
CREATE TABLE "new_Publication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "citation" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Publication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Publication" ("profileId", "citation", "createdAt", "id", "link", "onResumes", "sort", "updatedAt") SELECT 'first', "citation", "createdAt", "id", "link", "onResumes", "sort", "updatedAt" FROM "Publication";
DROP TABLE "Publication";
ALTER TABLE "new_Publication" RENAME TO "Publication";
CREATE INDEX "Publication_profileId_idx" ON "Publication"("profileId");
CREATE TABLE "new_Reference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "relation" TEXT NOT NULL DEFAULT '',
    "company" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Reference" ("profileId", "company", "createdAt", "email", "id", "name", "phone", "relation", "sort", "updatedAt") SELECT 'first', "company", "createdAt", "email", "id", "name", "phone", "relation", "sort", "updatedAt" FROM "Reference";
DROP TABLE "Reference";
ALTER TABLE "new_Reference" RENAME TO "Reference";
CREATE INDEX "Reference_profileId_idx" ON "Reference"("profileId");
CREATE TABLE "new_Skill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL COLLATE NOCASE,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "group" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Skill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Skill" ("profileId", "createdAt", "group", "id", "name", "sort") SELECT 'first', "createdAt", "group", "id", "name", "sort" FROM "Skill";
DROP TABLE "Skill";
ALTER TABLE "new_Skill" RENAME TO "Skill";
CREATE UNIQUE INDEX "Skill_profileId_name_key" ON "Skill"("profileId", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
