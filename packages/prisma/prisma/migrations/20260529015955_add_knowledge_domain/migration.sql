-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('INBOX', 'ARTICULATED', 'PERMANENT');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateTable
CREATE TABLE "concept" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceText" TEXT,
    "status" "ConceptStatus" NOT NULL DEFAULT 'INBOX',
    "nextReviewAt" TIMESTAMP(3),
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articulation" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "articulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link" (
    "id" TEXT NOT NULL,
    "sourceConceptId" TEXT NOT NULL,
    "targetConceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "relation" TEXT,
    "status" "LinkStatus" NOT NULL DEFAULT 'SUGGESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retrieval_event" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT,
    "response" TEXT,
    "score" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retrieval_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "concept_userId_idx" ON "concept"("userId");

-- CreateIndex
CREATE INDEX "concept_userId_status_idx" ON "concept"("userId", "status");

-- CreateIndex
CREATE INDEX "concept_userId_nextReviewAt_idx" ON "concept"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "articulation_conceptId_idx" ON "articulation"("conceptId");

-- CreateIndex
CREATE INDEX "articulation_userId_idx" ON "articulation"("userId");

-- CreateIndex
CREATE INDEX "link_sourceConceptId_idx" ON "link"("sourceConceptId");

-- CreateIndex
CREATE INDEX "link_targetConceptId_idx" ON "link"("targetConceptId");

-- CreateIndex
CREATE INDEX "link_userId_idx" ON "link"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "link_sourceConceptId_targetConceptId_key" ON "link"("sourceConceptId", "targetConceptId");

-- CreateIndex
CREATE INDEX "retrieval_event_conceptId_idx" ON "retrieval_event"("conceptId");

-- CreateIndex
CREATE INDEX "retrieval_event_userId_idx" ON "retrieval_event"("userId");

-- CreateIndex
CREATE INDEX "retrieval_event_conceptId_createdAt_idx" ON "retrieval_event"("conceptId", "createdAt");

-- AddForeignKey
ALTER TABLE "concept" ADD CONSTRAINT "concept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulation" ADD CONSTRAINT "articulation_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articulation" ADD CONSTRAINT "articulation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_sourceConceptId_fkey" FOREIGN KEY ("sourceConceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_targetConceptId_fkey" FOREIGN KEY ("targetConceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "link" ADD CONSTRAINT "link_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_event" ADD CONSTRAINT "retrieval_event_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retrieval_event" ADD CONSTRAINT "retrieval_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
