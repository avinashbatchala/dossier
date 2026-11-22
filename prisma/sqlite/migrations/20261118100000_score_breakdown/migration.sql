-- How a score adds up (E25-6, #413): the scoring engine's factors, cap and
-- requirements. Scores from before it have none.

-- AlterTable
ALTER TABLE "PostingScore" ADD COLUMN "breakdown" JSONB;
