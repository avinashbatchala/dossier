-- What a custom section counts as (E24-5, #406): Extra activities unless the user says otherwise.

-- CreateEnum
CREATE TYPE "CustomSectionCountsAs" AS ENUM ('WORK_EXPERIENCE', 'EDUCATION', 'EXTRA_ACTIVITIES');

-- AlterTable
ALTER TABLE "CustomSection" ADD COLUMN "countsAs" "CustomSectionCountsAs" NOT NULL DEFAULT 'EXTRA_ACTIVITIES';
