-- CreateTable
CREATE TABLE "AgentSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AgentCandidateSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "candidateId" TEXT NOT NULL,
    "searchId" TEXT,
    "searchName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentCandidateSearch_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "AgentCandidate" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AgentCandidateSearch_searchId_fkey" FOREIGN KEY ("searchId") REFERENCES "AgentSearch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentSearch_sort_createdAt_idx" ON "AgentSearch"("sort", "createdAt");

-- CreateIndex
CREATE INDEX "AgentCandidateSearch_searchId_idx" ON "AgentCandidateSearch"("searchId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCandidateSearch_candidateId_searchId_key" ON "AgentCandidateSearch"("candidateId", "searchId");

-- Public PR 61: the job agent's one search ("agentQuery" in Setting) becomes
-- its first recurring search, kept to what a search may hold, as the
-- PostgreSQL migration does and legacyAgentQuery() does on import. One that
-- isn't valid JSON, or has no keywords, makes no search. Either way the
-- setting goes.
INSERT INTO "AgentSearch" ("id", "name", "query", "updatedAt")
SELECT
  'agent-search-legacy',
  'My search',
  json_object(
    'keywords', trim(json_extract("value", '$.keywords'), char(32, 9, 10, 11, 12, 13)),
    'place', CASE WHEN json_type("value", '$.place') = 'text'
      THEN trim(substr(trim(json_extract("value", '$.place'), char(32, 9, 10, 11, 12, 13)), 1, 200), char(32, 9, 10, 11, 12, 13))
      ELSE '' END,
    'country', CASE WHEN json_type("value", '$.country') = 'text'
        AND lower(trim(json_extract("value", '$.country'), char(32, 9, 10, 11, 12, 13))) GLOB '[a-z][a-z]'
      THEN lower(trim(json_extract("value", '$.country'), char(32, 9, 10, 11, 12, 13)))
      ELSE '' END,
    'radiusKm', CASE WHEN json_type("value", '$.radiusKm') IN ('integer', 'real') AND json_extract("value", '$.radiusKm') IN (10, 25, 50, 100, 200)
      THEN CAST(json_extract("value", '$.radiusKm') AS INTEGER)
      ELSE 25 END,
    'remoteOnly', json(CASE json_type("value", '$.remoteOnly') WHEN 'true' THEN 'true' ELSE 'false' END),
    'postedWithin', CASE WHEN json_type("value", '$.postedWithin') = 'text' AND json_extract("value", '$.postedWithin') IN ('any', 'day', '3days', 'week', 'month')
      THEN json_extract("value", '$.postedWithin')
      ELSE 'any' END
  ),
  CURRENT_TIMESTAMP
FROM "Setting"
WHERE "key" = 'agentQuery'
  AND json_valid("value")
  AND json_type("value") = 'object'
  AND json_type("value", '$.keywords') = 'text'
  AND length(trim(json_extract("value", '$.keywords'), char(32, 9, 10, 11, 12, 13))) BETWEEN 1 AND 200;

DELETE FROM "Setting" WHERE "key" = 'agentQuery';
