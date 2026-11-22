-- CreateEnum
CREATE TYPE "CustomSectionFormat" AS ENUM ('ENTRIES', 'LINES', 'INLINE');

-- CreateTable
CREATE TABLE "CustomSection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "format" "CustomSectionFormat" NOT NULL DEFAULT 'ENTRIES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomItem" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "subtitle" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "details" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "onResumes" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomItem_sectionId_idx" ON "CustomItem"("sectionId");

-- AddForeignKey
ALTER TABLE "CustomItem" ADD CONSTRAINT "CustomItem_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "CustomSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
