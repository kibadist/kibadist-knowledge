-- CreateEnum
CREATE TYPE "QuestionActor" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "AnswerKind" AS ENUM ('REFERENCE_SCAFFOLD', 'USER_ATTEMPT', 'VALIDATED_ARTICULATION');

-- NOTE: Prisma generated a `DROP INDEX "articulation_embedding_hnsw_idx";` here
-- because the HNSW vector index is hand-written raw SQL it can't model (see the
-- MIGRATION LANDMINE note on Articulation.embedding in schema.prisma). It was
-- intentionally removed so semantic search keeps working.

-- CreateTable
CREATE TABLE "source_question" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "askedBy" "QuestionActor" NOT NULL DEFAULT 'USER',
    "questionText" TEXT NOT NULL,
    "answerText" TEXT,
    "answeredBy" "QuestionActor",
    "answerKind" "AnswerKind",
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_question_conceptId_idx" ON "source_question"("conceptId");

-- CreateIndex
CREATE INDEX "source_question_userId_idx" ON "source_question"("userId");

-- CreateIndex
CREATE INDEX "source_question_conceptId_createdAt_idx" ON "source_question"("conceptId", "createdAt");

-- AddForeignKey
ALTER TABLE "source_question" ADD CONSTRAINT "source_question_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_question" ADD CONSTRAINT "source_question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
