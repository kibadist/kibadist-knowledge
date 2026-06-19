-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "GraphScope" AS ENUM ('ARTICLE', 'TRACK', 'DOMAIN', 'WORKSPACE', 'CONCEPT_NEIGHBORHOOD', 'MISCONCEPTION', 'REVIEW');

-- CreateEnum
CREATE TYPE "TrackType" AS ENUM ('LEARNING', 'RESEARCH', 'PROJECT', 'CAREER', 'COURSE', 'PAPER_REVIEW', 'PRODUCT_BUILDING');

-- CreateEnum
CREATE TYPE "TrackStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ImportanceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RequiredDepth" AS ENUM ('RECOGNIZE', 'EXPLAIN', 'APPLY', 'TEACH');

-- CreateEnum
CREATE TYPE "TrackConceptStatus" AS ENUM ('CANDIDATE', 'ACCEPTED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ReflectionKind" AS ENUM ('CLEARER', 'LESS_CLEAR', 'CONNECTED', 'CHALLENGE_NEXT');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "SessionItemReason" AS ENUM ('DUE', 'CONTESTED', 'REDISCOVERY', 'CHALLENGE', 'ARTICLE_PROMPT');

-- CreateEnum
CREATE TYPE "Certainty" AS ENUM ('ASSERTED', 'TENTATIVE', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "ChunkKind" AS ENUM ('MAIN_IDEA', 'DEFINITION', 'EXAMPLE', 'APPLICATION', 'HISTORY', 'REFERENCE', 'NOISE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChunkImportance" AS ENUM ('CORE', 'SUPPORTING', 'PERIPHERAL');

-- CreateEnum
CREATE TYPE "CandidateKind" AS ENUM ('CONCEPT', 'TERM', 'PERSON', 'METHOD', 'FORMULA', 'THEOREM', 'APPLICATION');

-- CreateEnum
CREATE TYPE "CandidateImportance" AS ENUM ('CORE', 'SUPPORTING', 'PREREQUISITE', 'PERIPHERAL');

-- CreateEnum
CREATE TYPE "Generator" AS ENUM ('SYSTEM', 'AI', 'USER');

-- CreateEnum
CREATE TYPE "CandidatePromotionStatus" AS ENUM ('CANDIDATE', 'DISMISSED', 'PROMOTED');

-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('INBOX', 'ARTICULATED', 'PERMANENT');

-- CreateEnum
CREATE TYPE "CaptureSource" AS ENUM ('PASTE', 'URL', 'PDF');

-- CreateEnum
CREATE TYPE "LinkStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LinkRelation" AS ENUM ('ANALOGY', 'CONTRADICTION', 'SUPPORTS', 'DEPENDS_ON', 'REFINES', 'REDUNDANT');

-- CreateEnum
CREATE TYPE "GateMode" AS ENUM ('QUICK', 'DEEP');

-- CreateEnum
CREATE TYPE "FrictionLevel" AS ENUM ('MINIMAL', 'LIGHT', 'DEEP', 'RIGOROUS');

-- CreateEnum
CREATE TYPE "CognitiveState" AS ENUM ('SEEN', 'PARSED', 'EXPLAINED', 'LINKED', 'RETRIEVED', 'DEFENDED', 'INTERNALIZED', 'DORMANT', 'CONTESTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StateTrigger" AS ENUM ('CAPTURE', 'INTAKE_PARSED', 'PROMOTION', 'LINK_CONFIRMED', 'RETRIEVAL_SUCCESS', 'TUTOR_DEFENDED', 'INTERNALIZED', 'DECAYED', 'REACTIVATED', 'CONTRADICTION', 'RESOLVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionActor" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "AnswerKind" AS ENUM ('REFERENCE_SCAFFOLD', 'USER_ATTEMPT', 'VALIDATED_ARTICULATION');

-- CreateEnum
CREATE TYPE "LivingConceptStatus" AS ENUM ('DRAFT', 'USER_VALIDATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ArticleLearningEventType" AS ENUM ('overview_viewed', 'prediction_submitted', 'section_revealed', 'block_rewrite_started', 'block_rewrite_submitted', 'rewrite_peeked', 'comparison_generated', 'rewrite_revised', 'concept_candidate_approved', 'review_prompt_approved', 'review_completed');

-- CreateEnum
CREATE TYPE "ReviewPromptStatus" AS ENUM ('suggested', 'approved', 'rejected', 'scheduled', 'retired');

-- CreateEnum
CREATE TYPE "SourceConfidence" AS ENUM ('source_supported', 'article_supported_source_unavailable', 'user_authored_unsourced', 'unsupported_or_invented', 'needs_review');

-- CreateEnum
CREATE TYPE "TransformerSourceType" AS ENUM ('TEXT', 'URL', 'PDF');

-- CreateEnum
CREATE TYPE "TransformerSourceStatus" AS ENUM ('INGESTED', 'EXTRACTING', 'EXTRACTED', 'SEGMENTED', 'CLASSIFYING', 'READY', 'EXTRACTION_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "TransformerBlockType" AS ENUM ('HEADING', 'PARAGRAPH', 'LIST', 'QUOTE', 'TABLE', 'CODE', 'CAPTION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TransformerBlockClass" AS ENUM ('MAIN_ARGUMENT', 'DEFINITION', 'EXAMPLE', 'EVIDENCE', 'METHOD', 'BACKGROUND', 'SIDEBAR', 'CITATION', 'NAVIGATION_NOISE', 'ADVERTISEMENT', 'FOOTER', 'DUPLICATE', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "SourceBlockRole" AS ENUM ('CORE_CLAIM', 'DEFINITION', 'EXAMPLE', 'ANALOGY', 'CAVEAT', 'TRANSITION', 'INSTRUCTOR_ASIDE', 'FILLER', 'NAVIGATION', 'REFERENCE', 'BIBLIOGRAPHY', 'EXTERNAL_LINK', 'CAPTION', 'TABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceBlockImportance" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "SourceBlockPlacement" AS ENUM ('MAIN_BODY', 'CALLOUT', 'SOURCE_NOTES', 'DISCARD');

-- CreateEnum
CREATE TYPE "TransformedArticleStatus" AS ENUM ('QUEUED', 'MODELING', 'PLANNING', 'GENERATING', 'CHECKING', 'FINAL', 'BLOCKED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_view" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "GraphScope" NOT NULL,
    "sourceConceptId" TEXT,
    "trackId" TEXT,
    "domainId" TEXT,
    "centerConceptId" TEXT,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "layout" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentDomainId" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concept_domain" (
    "conceptId" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdBy" "Generator" NOT NULL DEFAULT 'USER',
    "userValidated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_domain_pkey" PRIMARY KEY ("conceptId","domainId")
);

-- CreateTable
CREATE TABLE "track" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "TrackType" NOT NULL,
    "goal" TEXT,
    "requiredDepth" "RequiredDepth" NOT NULL DEFAULT 'EXPLAIN',
    "status" "TrackStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "track_concept" (
    "trackId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "orderIndex" INTEGER,
    "importance" "ImportanceLevel" NOT NULL DEFAULT 'MEDIUM',
    "requiredDepth" "RequiredDepth" NOT NULL DEFAULT 'EXPLAIN',
    "status" "TrackConceptStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdBy" "Generator" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "track_concept_pkey" PRIMARY KEY ("trackId","conceptId")
);

-- CreateTable
CREATE TABLE "concept" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceText" TEXT,
    "sourceDocument" JSONB,
    "captureSource" "CaptureSource",
    "sourceUrl" TEXT,
    "originArticleId" TEXT,
    "sourceId" TEXT,
    "status" "ConceptStatus" NOT NULL DEFAULT 'INBOX',
    "cognitiveState" "CognitiveState" NOT NULL DEFAULT 'SEEN',
    "gateMode" "GateMode",
    "nextReviewAt" TIMESTAMP(3),
    "reviewEase" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "reviewIntervalDays" INTEGER NOT NULL DEFAULT 0,
    "reviewReps" INTEGER NOT NULL DEFAULT 0,
    "tutorRequested" BOOLEAN NOT NULL DEFAULT false,
    "activation" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "activationAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "certainty" "Certainty" NOT NULL DEFAULT 'ASSERTED',
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "targetTrackId" TEXT,
    "snoozedUntil" TIMESTAMP(3),
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
    "embedding" vector(1536),
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
    "relationKind" "LinkRelation",
    "rationale" TEXT,
    "proposedBy" "QuestionActor" NOT NULL DEFAULT 'USER',
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

-- CreateTable
CREATE TABLE "promotion_draft" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "GateMode" NOT NULL DEFAULT 'QUICK',
    "frictionLevel" "FrictionLevel" NOT NULL DEFAULT 'DEEP',
    "articulation" TEXT,
    "connectionsReviewed" BOOLEAN NOT NULL DEFAULT false,
    "retrievalQuestion" TEXT,
    "retrievalResponse" TEXT,
    "retrievalScore" INTEGER,
    "retrievalPassed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promotion_draft_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "concept_state_transition" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "from" "CognitiveState",
    "to" "CognitiveState" NOT NULL,
    "trigger" "StateTrigger" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "concept_state_transition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "targetMinutes" INTEGER NOT NULL DEFAULT 10,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reflection" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "kind" "ReflectionKind" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reflection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_item" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conceptId" TEXT,
    "reviewPromptId" TEXT,
    "position" INTEGER NOT NULL,
    "reason" "SessionItemReason" NOT NULL DEFAULT 'DUE',
    "reviewedAt" TIMESTAMP(3),
    "recallScore" INTEGER,

    CONSTRAINT "session_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_chunk" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "summary" TEXT,
    "blockIds" TEXT[],
    "kind" "ChunkKind" NOT NULL DEFAULT 'OTHER',
    "importance" "ChunkImportance" NOT NULL DEFAULT 'SUPPORTING',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_concept_candidate" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chunkId" TEXT,
    "label" TEXT NOT NULL,
    "definition" TEXT,
    "aliases" TEXT[],
    "sourceBlockIds" TEXT[],
    "kind" "CandidateKind" NOT NULL DEFAULT 'CONCEPT',
    "importance" "CandidateImportance" NOT NULL DEFAULT 'SUPPORTING',
    "generatedBy" "Generator" NOT NULL DEFAULT 'AI',
    "promotionStatus" "CandidatePromotionStatus" NOT NULL DEFAULT 'CANDIDATE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_concept_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graph_node_position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "graph_node_position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "living_concept" (
    "id" TEXT NOT NULL,
    "conceptId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "personaName" TEXT NOT NULL,
    "personaSummary" TEXT NOT NULL,
    "voice" TEXT,
    "coreMetaphor" TEXT,
    "metaphorBreaks" TEXT,
    "status" "LivingConceptStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" "Generator" NOT NULL DEFAULT 'AI',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "living_concept_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "onboarding_state" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "starterSourceId" TEXT,
    "starterArticleId" TEXT,
    "starterConceptId" TEXT,
    "completedSteps" TEXT[],
    "dismissedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformer_sources" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "TransformerSourceType" NOT NULL,
    "status" "TransformerSourceStatus" NOT NULL DEFAULT 'INGESTED',
    "title" TEXT,
    "url" TEXT,
    "fileName" TEXT,
    "rawContent" TEXT,
    "rawFile" BYTEA,
    "metadata" JSONB,
    "extractedText" TEXT,
    "extractionError" TEXT,
    "extractorVersion" TEXT,
    "blocksVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformer_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformer_source_blocks" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "orderIndex" INTEGER NOT NULL,
    "blockType" "TransformerBlockType" NOT NULL,
    "text" TEXT NOT NULL,
    "headingLevel" INTEGER,
    "pageNumber" INTEGER,
    "charStart" INTEGER,
    "charEnd" INTEGER,
    "classification" "TransformerBlockClass",
    "classificationStatus" TEXT NOT NULL DEFAULT 'pending',
    "removable" BOOLEAN NOT NULL DEFAULT false,
    "noiseReason" TEXT,
    "role" "SourceBlockRole",
    "importance" "SourceBlockImportance",
    "placement" "SourceBlockPlacement",
    "roleReason" TEXT,
    "roleConfidence" DOUBLE PRECISION,
    "roleStatus" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "transformer_source_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformed_articles" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "blocksVersion" INTEGER NOT NULL,
    "status" "TransformedArticleStatus" NOT NULL DEFAULT 'QUEUED',
    "sourceDiagnosis" JSONB,
    "structureModel" JSONB,
    "segments" JSONB,
    "reshapingPlan" JSONB,
    "learningOutline" JSONB,
    "articleJson" JSONB,
    "fidelityReport" JSONB,
    "fidelityScore" INTEGER,
    "coverageReport" JSONB,
    "illustrationPlan" JSONB,
    "learningLayer" JSONB,
    "qualityReport" JSONB,
    "enrichment" JSONB,
    "editorialLayout" JSONB,
    "regenerationReport" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformed_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformer_illustration_images" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "suggestionId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mediaType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transformer_illustration_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "workspace_ownerUserId_idx" ON "workspace"("ownerUserId");

-- CreateIndex
CREATE INDEX "graph_view_workspaceId_idx" ON "graph_view"("workspaceId");

-- CreateIndex
CREATE INDEX "domain_workspaceId_idx" ON "domain"("workspaceId");

-- CreateIndex
CREATE INDEX "domain_parentDomainId_idx" ON "domain"("parentDomainId");

-- CreateIndex
CREATE INDEX "concept_domain_conceptId_idx" ON "concept_domain"("conceptId");

-- CreateIndex
CREATE INDEX "concept_domain_domainId_idx" ON "concept_domain"("domainId");

-- CreateIndex
CREATE INDEX "track_workspaceId_status_idx" ON "track"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "track_concept_trackId_idx" ON "track_concept"("trackId");

-- CreateIndex
CREATE INDEX "track_concept_conceptId_idx" ON "track_concept"("conceptId");

-- CreateIndex
CREATE INDEX "track_concept_trackId_orderIndex_idx" ON "track_concept"("trackId", "orderIndex");

-- CreateIndex
CREATE INDEX "concept_userId_idx" ON "concept"("userId");

-- CreateIndex
CREATE INDEX "concept_userId_status_idx" ON "concept"("userId", "status");

-- CreateIndex
CREATE INDEX "concept_userId_nextReviewAt_idx" ON "concept"("userId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "concept_userId_cognitiveState_idx" ON "concept"("userId", "cognitiveState");

-- CreateIndex
CREATE INDEX "concept_workspaceId_idx" ON "concept"("workspaceId");

-- CreateIndex
CREATE INDEX "concept_workspaceId_status_idx" ON "concept"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "concept_workspaceId_nextReviewAt_idx" ON "concept"("workspaceId", "nextReviewAt");

-- CreateIndex
CREATE INDEX "concept_workspaceId_cognitiveState_idx" ON "concept"("workspaceId", "cognitiveState");

-- CreateIndex
CREATE INDEX "concept_workspaceId_status_snoozedUntil_idx" ON "concept"("workspaceId", "status", "snoozedUntil");

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

-- CreateIndex
CREATE INDEX "intake_question_conceptId_idx" ON "intake_question"("conceptId");

-- CreateIndex
CREATE INDEX "intake_question_userId_idx" ON "intake_question"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_draft_conceptId_key" ON "promotion_draft"("conceptId");

-- CreateIndex
CREATE INDEX "promotion_draft_userId_idx" ON "promotion_draft"("userId");

-- CreateIndex
CREATE INDEX "source_question_conceptId_idx" ON "source_question"("conceptId");

-- CreateIndex
CREATE INDEX "source_question_userId_idx" ON "source_question"("userId");

-- CreateIndex
CREATE INDEX "source_question_conceptId_createdAt_idx" ON "source_question"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "concept_state_transition_conceptId_createdAt_idx" ON "concept_state_transition"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "concept_state_transition_userId_idx" ON "concept_state_transition"("userId");

-- CreateIndex
CREATE INDEX "session_userId_startedAt_idx" ON "session"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "session_userId_status_idx" ON "session"("userId", "status");

-- CreateIndex
CREATE INDEX "reflection_conceptId_createdAt_idx" ON "reflection"("conceptId", "createdAt");

-- CreateIndex
CREATE INDEX "reflection_sessionId_idx" ON "reflection"("sessionId");

-- CreateIndex
CREATE INDEX "session_item_sessionId_position_idx" ON "session_item"("sessionId", "position");

-- CreateIndex
CREATE INDEX "session_item_reviewPromptId_idx" ON "session_item"("reviewPromptId");

-- CreateIndex
CREATE INDEX "source_chunk_conceptId_position_idx" ON "source_chunk"("conceptId", "position");

-- CreateIndex
CREATE INDEX "source_chunk_userId_idx" ON "source_chunk"("userId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_conceptId_idx" ON "source_concept_candidate"("conceptId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_userId_idx" ON "source_concept_candidate"("userId");

-- CreateIndex
CREATE INDEX "source_concept_candidate_conceptId_promotionStatus_idx" ON "source_concept_candidate"("conceptId", "promotionStatus");

-- CreateIndex
CREATE UNIQUE INDEX "graph_node_position_conceptId_key" ON "graph_node_position"("conceptId");

-- CreateIndex
CREATE INDEX "graph_node_position_userId_idx" ON "graph_node_position"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "living_concept_conceptId_key" ON "living_concept"("conceptId");

-- CreateIndex
CREATE INDEX "living_concept_userId_idx" ON "living_concept"("userId");

-- CreateIndex
CREATE INDEX "article_learning_event_userId_idx" ON "article_learning_event"("userId");

-- CreateIndex
CREATE INDEX "article_learning_event_userId_articleId_idx" ON "article_learning_event"("userId", "articleId");

-- CreateIndex
CREATE INDEX "article_learning_event_articleId_eventType_idx" ON "article_learning_event"("articleId", "eventType");

-- CreateIndex
CREATE INDEX "review_prompt_userId_idx" ON "review_prompt"("userId");

-- CreateIndex
CREATE INDEX "review_prompt_userId_articleId_idx" ON "review_prompt"("userId", "articleId");

-- CreateIndex
CREATE INDEX "review_prompt_userId_status_idx" ON "review_prompt"("userId", "status");

-- CreateIndex
CREATE INDEX "review_prompt_userId_status_nextReviewAt_idx" ON "review_prompt"("userId", "status", "nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "review_prompt_userId_promptId_key" ON "review_prompt"("userId", "promptId");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_state_userId_key" ON "onboarding_state"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_entry_email_key" ON "waitlist_entry"("email");

-- CreateIndex
CREATE INDEX "transformer_sources_workspaceId_idx" ON "transformer_sources"("workspaceId");

-- CreateIndex
CREATE INDEX "transformer_sources_userId_idx" ON "transformer_sources"("userId");

-- CreateIndex
CREATE INDEX "transformer_sources_workspaceId_status_idx" ON "transformer_sources"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "transformer_source_blocks_sourceId_version_idx" ON "transformer_source_blocks"("sourceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "transformer_source_blocks_sourceId_version_orderIndex_key" ON "transformer_source_blocks"("sourceId", "version", "orderIndex");

-- CreateIndex
CREATE INDEX "transformed_articles_sourceId_idx" ON "transformed_articles"("sourceId");

-- CreateIndex
CREATE INDEX "transformed_articles_workspaceId_idx" ON "transformed_articles"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "transformer_illustration_images_articleId_suggestionId_key" ON "transformer_illustration_images"("articleId", "suggestionId");

-- AddForeignKey
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_view" ADD CONSTRAINT "graph_view_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain" ADD CONSTRAINT "domain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain" ADD CONSTRAINT "domain_parentDomainId_fkey" FOREIGN KEY ("parentDomainId") REFERENCES "domain"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_domain" ADD CONSTRAINT "concept_domain_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_domain" ADD CONSTRAINT "concept_domain_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "domain"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track" ADD CONSTRAINT "track_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_concept" ADD CONSTRAINT "track_concept_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "track_concept" ADD CONSTRAINT "track_concept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept" ADD CONSTRAINT "concept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept" ADD CONSTRAINT "concept_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

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

-- AddForeignKey
ALTER TABLE "intake_question" ADD CONSTRAINT "intake_question_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_question" ADD CONSTRAINT "intake_question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_draft" ADD CONSTRAINT "promotion_draft_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_draft" ADD CONSTRAINT "promotion_draft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_question" ADD CONSTRAINT "source_question_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_question" ADD CONSTRAINT "source_question_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_state_transition" ADD CONSTRAINT "concept_state_transition_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concept_state_transition" ADD CONSTRAINT "concept_state_transition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reflection" ADD CONSTRAINT "reflection_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_item" ADD CONSTRAINT "session_item_reviewPromptId_fkey" FOREIGN KEY ("reviewPromptId") REFERENCES "review_prompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_chunk" ADD CONSTRAINT "source_chunk_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_chunk" ADD CONSTRAINT "source_chunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_concept_candidate" ADD CONSTRAINT "source_concept_candidate_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_concept_candidate" ADD CONSTRAINT "source_concept_candidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_node_position" ADD CONSTRAINT "graph_node_position_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graph_node_position" ADD CONSTRAINT "graph_node_position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "living_concept" ADD CONSTRAINT "living_concept_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "concept"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "living_concept" ADD CONSTRAINT "living_concept_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_learning_event" ADD CONSTRAINT "article_learning_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_prompt" ADD CONSTRAINT "review_prompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "onboarding_state" ADD CONSTRAINT "onboarding_state_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_sources" ADD CONSTRAINT "transformer_sources_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_sources" ADD CONSTRAINT "transformer_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_source_blocks" ADD CONSTRAINT "transformer_source_blocks_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "transformer_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformed_articles" ADD CONSTRAINT "transformed_articles_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "transformer_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformed_articles" ADD CONSTRAINT "transformed_articles_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transformer_illustration_images" ADD CONSTRAINT "transformer_illustration_images_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "transformed_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- HNSW index for cosine-distance similarity search (embedding <=> query).
-- ⚠️ MIGRATION LANDMINE: hand-written raw SQL — Prisma cannot express vector
-- operator classes, so it is absent from the generated DDL above and every
-- `migrate dev` will try to DROP it. Always strip that DROP from new migrations
-- (see the warning next to Articulation.embedding in schema.prisma).
CREATE INDEX "articulation_embedding_hnsw_idx"
    ON "articulation" USING hnsw ("embedding" vector_cosine_ops);
