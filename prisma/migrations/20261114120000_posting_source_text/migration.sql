-- The job source as text instead of the PostingSource enum (#269), so a new
-- portal needs no migration. Every value is kept as it was ("JSEARCH", ...),
-- and the primary keys and indexes on "source" stay.
ALTER TABLE "Posting" ALTER COLUMN "source" SET DATA TYPE TEXT USING "source"::text;
ALTER TABLE "AgentCandidate" ALTER COLUMN "source" SET DATA TYPE TEXT USING "source"::text;
ALTER TABLE "PostingScore" ALTER COLUMN "source" SET DATA TYPE TEXT USING "source"::text;
ALTER TABLE "PostingSearch" ALTER COLUMN "source" SET DATA TYPE TEXT USING "source"::text;

DROP TYPE "PostingSource";
