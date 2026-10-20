-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "startYear" INTEGER,
    "startMonth" INTEGER,
    "endYear" INTEGER,
    "endMonth" INTEGER,
    "current" BOOLEAN NOT NULL DEFAULT false,
    "bullets" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSkill" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("projectId","skillId")
);

-- CreateIndex
CREATE INDEX "ProjectSkill_skillId_idx" ON "ProjectSkill"("skillId");

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;
