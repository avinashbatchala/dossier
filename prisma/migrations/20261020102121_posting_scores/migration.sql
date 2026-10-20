-- CreateTable
CREATE TABLE "PostingScore" (
    "source" "PostingSource" NOT NULL,
    "externalId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" JSONB NOT NULL,
    "redFlags" JSONB NOT NULL,
    "scoredWith" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostingScore_pkey" PRIMARY KEY ("source","externalId")
);
