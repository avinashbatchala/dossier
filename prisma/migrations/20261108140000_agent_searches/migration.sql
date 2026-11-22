CREATE TABLE "AgentSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentSearch_sort_createdAt_idx" ON "AgentSearch"("sort", "createdAt");

CREATE TABLE "AgentCandidateSearch" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "searchId" TEXT,
    "searchName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCandidateSearch_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentCandidateSearch_candidateId_searchId_key" ON "AgentCandidateSearch"("candidateId", "searchId");
CREATE INDEX "AgentCandidateSearch_searchId_idx" ON "AgentCandidateSearch"("searchId");
ALTER TABLE "AgentCandidateSearch" ADD CONSTRAINT "AgentCandidateSearch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "AgentCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentCandidateSearch" ADD CONSTRAINT "AgentCandidateSearch_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "AgentSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A malformed/empty legacy setting must not stop an upgrade or create an
-- unusable search. This is the only database-upgrade conversion, never seed.
DO $$
DECLARE q JSONB;
BEGIN
  BEGIN
    SELECT "value"::jsonb INTO q FROM "Setting" WHERE "key" = 'agentQuery';
  EXCEPTION WHEN invalid_text_representation THEN
    q := NULL;
  END;
  IF jsonb_typeof(q) = 'object' AND jsonb_typeof(q->'keywords') = 'string'
     AND length(regexp_replace(q->>'keywords', '^\s+|\s+$', '', 'g')) BETWEEN 1 AND 200 THEN
    INSERT INTO "AgentSearch" ("id", "name", "query", "updatedAt")
    VALUES ('agent-search-legacy', 'My search', jsonb_build_object(
      'keywords', regexp_replace(q->>'keywords', '^\s+|\s+$', '', 'g'),
      'place', regexp_replace(left(regexp_replace(CASE WHEN jsonb_typeof(q->'place') = 'string' THEN q->>'place' ELSE '' END, '^\s+|\s+$', '', 'g'), 200), '^\s+|\s+$', '', 'g'),
      'country', CASE WHEN lower(regexp_replace(q->>'country', '^\s+|\s+$', '', 'g')) ~ '^[a-z]{2}$' THEN lower(regexp_replace(q->>'country', '^\s+|\s+$', '', 'g')) ELSE '' END,
      'radiusKm', CASE WHEN q->'radiusKm' IN ('10'::jsonb, '25'::jsonb, '50'::jsonb, '100'::jsonb, '200'::jsonb) THEN q->'radiusKm' ELSE '25'::jsonb END,
      'remoteOnly', CASE WHEN jsonb_typeof(q->'remoteOnly') = 'boolean' THEN q->'remoteOnly' ELSE 'false'::jsonb END,
      'postedWithin', CASE WHEN q->>'postedWithin' IN ('any', 'day', '3days', 'week', 'month') THEN q->>'postedWithin' ELSE 'any' END
    ), CURRENT_TIMESTAMP);
  END IF;
  DELETE FROM "Setting" WHERE "key" = 'agentQuery';
END $$;
