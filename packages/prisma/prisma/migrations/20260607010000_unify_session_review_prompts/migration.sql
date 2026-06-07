-- One retrieval engine (DET-310): the Session queue now draws from approved
-- Spaced Review prompts (DET-288/301) alongside concept-state items, so a
-- SessionItem can reference a ReviewPrompt instead of a Concept.
--
-- Hand-authored (not `migrate dev`-generated) per this project's convention, to
-- avoid the generator touching the hand-written HNSW vector index Prisma can't
-- model. Purely additive: a new enum value, a nullable column, an index, an FK,
-- plus a covering index on review_prompt for the session-start due query.

-- A new reason: an approved article review prompt surfaced in a session.
-- (PG 16 permits ALTER TYPE ... ADD VALUE inside a transaction; the value is not
-- used in DML within this migration, so the in-transaction usage rule is moot.)
ALTER TYPE "SessionItemReason" ADD VALUE 'ARTICLE_PROMPT';

-- conceptId becomes optional: a prompt item may target an article section that
-- has no earned concept yet.
ALTER TABLE "session_item" ALTER COLUMN "conceptId" DROP NOT NULL;

-- The prompt a session item resurfaces, when it is a review-prompt item.
ALTER TABLE "session_item" ADD COLUMN "reviewPromptId" TEXT;

-- CreateIndex
CREATE INDEX "session_item_reviewPromptId_idx" ON "session_item"("reviewPromptId");

-- CreateIndex: approved prompts the engine can resurface, soonest-due first.
CREATE INDEX "review_prompt_userId_status_nextReviewAt_idx" ON "review_prompt"("userId", "status", "nextReviewAt");

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_reviewPromptId_fkey" FOREIGN KEY ("reviewPromptId") REFERENCES "review_prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
