-- Several profiles (E24-1, #402). Today's profile becomes the first one: it
-- takes the headline, the summary and the Base resume's settings, which were
-- global, and every section's rows. Its name is the headline, or "My profile".
-- The other basics, the languages and the facts stay shared.

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "headline" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Profile" ("id", "name", "headline", "summary", "settings", "updatedAt")
SELECT
    'first',
    COALESCE(NULLIF(left(btrim((SELECT "value" FROM "ProfileField" WHERE "key" = 'headline')), 80), ''), 'My profile'),
    COALESCE((SELECT "value" FROM "ProfileField" WHERE "key" = 'headline'), ''),
    COALESCE((SELECT "value" FROM "ProfileField" WHERE "key" = 'summary'), ''),
    COALESCE(
        (SELECT jsonb_object_agg("key", "value") FROM "Setting"
         WHERE "key" IN ('baseThemeId', 'resumeLanguage', 'resumeSections', 'fitBaseResume', 'skillOrder', 'experienceOrder', 'projectOrder', 'educationOrder')),
        '{}'::jsonb
    ),
    CURRENT_TIMESTAMP;

DELETE FROM "ProfileField" WHERE "key" IN ('headline', 'summary');
DELETE FROM "Setting" WHERE "key" IN ('baseThemeId', 'resumeLanguage', 'resumeSections', 'fitBaseResume', 'skillOrder', 'experienceOrder', 'projectOrder', 'educationOrder');

-- Every section's rows go to the first profile.
ALTER TABLE "Certification" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "CustomSection" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Education" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Experience" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Project" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Publication" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Reference" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Skill" ADD COLUMN "profileId" TEXT NOT NULL DEFAULT 'first';
ALTER TABLE "Certification" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "CustomSection" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Education" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Experience" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Publication" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Reference" ALTER COLUMN "profileId" DROP DEFAULT;
ALTER TABLE "Skill" ALTER COLUMN "profileId" DROP DEFAULT;

-- A skill's name is unique in its profile, ignoring case (citext).
DROP INDEX "Skill_name_key";
CREATE UNIQUE INDEX "Skill_profileId_name_key" ON "Skill"("profileId", "name");

-- CreateIndex
CREATE INDEX "Certification_profileId_idx" ON "Certification"("profileId");
CREATE INDEX "CustomSection_profileId_idx" ON "CustomSection"("profileId");
CREATE INDEX "Education_profileId_idx" ON "Education"("profileId");
CREATE INDEX "Experience_profileId_idx" ON "Experience"("profileId");
CREATE INDEX "Project_profileId_idx" ON "Project"("profileId");
CREATE INDEX "Publication_profileId_idx" ON "Publication"("profileId");
CREATE INDEX "Reference_profileId_idx" ON "Reference"("profileId");

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Experience" ADD CONSTRAINT "Experience_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Education" ADD CONSTRAINT "Education_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomSection" ADD CONSTRAINT "CustomSection_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
