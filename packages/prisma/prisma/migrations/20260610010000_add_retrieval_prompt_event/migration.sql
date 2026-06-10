-- DET-321: inline retrieval prompts in the Article tab. One additive enum value
-- on the closed article-learning event vocabulary — the learner attempting an
-- inline prompt (revealing its source-passage answer) is a recordable learning
-- EVENT, never knowledge (the DET-315 earning gate is untouched).
--
-- Hand-authored (not `migrate dev`-generated) so it deliberately contains NO
-- `DROP INDEX "articulation_embedding_hnsw_idx"` — that HNSW index is hand-written
-- raw SQL Prisma can't model and every `migrate dev` tries to drop it (see the
-- Articulation.embedding schema comment).

-- AlterEnum
ALTER TYPE "ArticleLearningEventType" ADD VALUE 'retrieval_prompt_attempted';
