-- Approved review prompts store (DET-301): the Retrieval Engine's downstream sink
-- for DET-288 Spaced Review. Hand-authored (not `migrate dev`-generated) to follow
-- this project's convention and avoid touching the hand-written HNSW vector index
-- Prisma can't model. Purely additive: one new table. The `ReviewPromptStatus`
-- enum it references already exists (added in 20260605000000_add_article_learning_events),
-- so it is NOT recreated here.

-- CreateTable
CREATE TABLE "review_prompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleVersionId" TEXT,
    "sectionId" TEXT,
    "conceptId" TEXT,
    "promptId" TEXT NOT NULL,
    "promptType" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expectedAnswerSummary" TEXT NOT NULL,
    "sourceSpanIds" TEXT[],
    "createdFromEventId" TEXT,
    "status" "ReviewPromptStatus" NOT NULL DEFAULT 'approved',
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_prompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_prompt_userId_promptId_key" ON "review_prompt"("userId", "promptId");

-- CreateIndex
CREATE INDEX "review_prompt_userId_idx" ON "review_prompt"("userId");

-- CreateIndex
CREATE INDEX "review_prompt_userId_articleId_idx" ON "review_prompt"("userId", "articleId");

-- CreateIndex
CREATE INDEX "review_prompt_userId_status_idx" ON "review_prompt"("userId", "status");

-- AddForeignKey
ALTER TABLE "review_prompt" ADD CONSTRAINT "review_prompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
