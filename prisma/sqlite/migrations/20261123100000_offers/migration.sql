-- AlterTable
ALTER TABLE "Application" ADD COLUMN "contactedAt" DATETIME;
ALTER TABLE "Application" ADD COLUMN "messageDraft" JSONB;

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "salary" TEXT NOT NULL DEFAULT '',
    "decideBy" DATETIME,
    "startDate" DATETIME,
    "holidays" TEXT NOT NULL DEFAULT '',
    "office" TEXT NOT NULL DEFAULT '',
    "fromEmailId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_key" ON "Offer"("applicationId");
