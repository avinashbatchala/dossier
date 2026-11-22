-- CreateEnum
CREATE TYPE "SentVia" AS ENUM ('GMAIL', 'EMAIL', 'PORTAL', 'OTHER');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "sentVia" "SentVia";
