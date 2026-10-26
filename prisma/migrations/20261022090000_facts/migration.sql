-- CreateTable
CREATE TABLE "Fact" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "text" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Fact_applicationId_sort_idx" ON "Fact"("applicationId", "sort");

-- AddForeignKey
ALTER TABLE "Fact" ADD CONSTRAINT "Fact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Each application's "Anything I should know?" note becomes its first fact.
INSERT INTO "Fact" ("id", "applicationId", "text", "sort", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, "id", btrim("userNote"), 0, "createdAt", "createdAt"
FROM "Application"
WHERE btrim("userNote") <> '';

-- AlterTable
ALTER TABLE "Application" DROP COLUMN "userNote";
