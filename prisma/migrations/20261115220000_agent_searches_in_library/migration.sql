-- The job agent's finds in the library (E22-8, #394): each run of an agent
-- search is a PostingSearch, marked with the agent search it ran for.
-- AlterTable
ALTER TABLE "PostingSearch" ADD COLUMN     "agentSearchId" TEXT,
ADD COLUMN     "agentSearchName" TEXT;

-- CreateIndex
CREATE INDEX "PostingSearch_agentSearchId_idx" ON "PostingSearch"("agentSearchId");

-- AddForeignKey
ALTER TABLE "PostingSearch" ADD CONSTRAINT "PostingSearch_agentSearchId_fkey" FOREIGN KEY ("agentSearchId") REFERENCES "AgentSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
