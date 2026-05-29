-- NOTE: `prisma migrate dev` generated a `DROP INDEX
-- "articulation_embedding_hnsw_idx"` here; removed by hand (the recurring
-- pgvector HNSW landmine — see the warning next to Articulation.embedding in
-- schema.prisma). Dropping it would silently destroy semantic-search perf.

-- CreateTable
CREATE TABLE "intake_question" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "kind" TEXT,
    "answer" TEXT,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "intake_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "intake_question_conceptId_idx" ON "intake_question"("conceptId");

-- CreateIndex
CREATE INDEX "intake_question_userId_idx" ON "intake_question"("userId");

-- AddForeignKey
ALTER TABLE "intake_question" ADD CONSTRAINT "intake_question_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_question" ADD CONSTRAINT "intake_question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
