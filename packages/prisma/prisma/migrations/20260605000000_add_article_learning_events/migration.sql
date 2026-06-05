-- Generated Article Learning Modes coordination contract (DET-278).
-- Hand-authored (not `migrate dev`-generated) to follow this project's
-- convention and avoid touching the hand-written HNSW vector index Prisma can't
-- model. Purely additive: three new enums and one new table that is the
-- source-of-truth log for user activity against generated articles. Owned here,
-- consumed (never owned) by Concept Library / Retrieval Engine downstream.

-- CreateEnum
CREATE TYPE "ArticleLearningEventType" AS ENUM (
  'overview_viewed',
  'prediction_submitted',
  'section_revealed',
  'block_rewrite_started',
  'block_rewrite_submitted',
  'rewrite_peeked',
  'comparison_generated',
  'rewrite_revised',
  'concept_candidate_approved',
  'review_prompt_approved',
  'review_completed'
);

-- CreateEnum
CREATE TYPE "ReviewPromptStatus" AS ENUM (
  'suggested',
  'approved',
  'rejected',
  'scheduled',
  'retired'
);

-- CreateEnum
CREATE TYPE "SourceConfidence" AS ENUM (
  'source_supported',
  'article_supported_source_unavailable',
  'user_authored_unsourced',
  'unsupported_or_invented',
  'needs_review'
);

-- CreateTable
CREATE TABLE "article_learning_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleVersionId" TEXT,
    "sectionId" TEXT,
    "blockId" TEXT,
    "sourceSpanIds" TEXT[],
    "eventType" "ArticleLearningEventType" NOT NULL,
    "prompt" TEXT,
    "userAnswer" TEXT,
    "aiFeedback" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "article_learning_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "article_learning_event_userId_idx" ON "article_learning_event"("userId");

-- CreateIndex
CREATE INDEX "article_learning_event_userId_articleId_idx" ON "article_learning_event"("userId", "articleId");

-- CreateIndex
CREATE INDEX "article_learning_event_articleId_eventType_idx" ON "article_learning_event"("articleId", "eventType");

-- AddForeignKey
ALTER TABLE "article_learning_event" ADD CONSTRAINT "article_learning_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
