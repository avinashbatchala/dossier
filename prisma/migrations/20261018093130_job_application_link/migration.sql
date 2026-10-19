-- AlterTable
ALTER TABLE "Job" ADD COLUMN     "applicationId" TEXT;

-- CreateIndex
CREATE INDEX "Job_applicationId_idx" ON "Job"("applicationId");

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Link the jobs that already exist to their application, through the key
-- each application job has had ("application:", "units:", "refine:" or
-- "email:" and the application's id).
UPDATE "Job" SET "applicationId" = substring("key" from position(':' in "key") + 1)
WHERE split_part("key", ':', 1) IN ('application', 'units', 'refine', 'email')
  AND substring("key" from position(':' in "key") + 1) IN (SELECT "id" FROM "Application");

-- Jobs of applications deleted before this link existed: deleting an
-- application left its email jobs (and an import its other ones) behind.
DELETE FROM "Job"
WHERE split_part("key", ':', 1) IN ('application', 'units', 'refine', 'email')
  AND "applicationId" IS NULL;
