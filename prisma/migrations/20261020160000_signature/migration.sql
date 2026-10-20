-- AlterTable
ALTER TABLE "Application" ADD COLUMN "signatureOnLetter" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);
