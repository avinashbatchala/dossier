-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "contactedAt" TIMESTAMP(3),
ADD COLUMN     "messageDraft" JSONB;

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "salary" TEXT NOT NULL DEFAULT '',
    "decideBy" DATE,
    "startDate" DATE,
    "holidays" TEXT NOT NULL DEFAULT '',
    "office" TEXT NOT NULL DEFAULT '',
    "fromEmailId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Offer_applicationId_key" ON "Offer"("applicationId");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

