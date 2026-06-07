import {
  TransformedArticleStatus as ArticleStatus,
  CaptureSource,
  ConceptStatus,
  type Prisma,
  type TransformedArticleStatus,
  TransformerSourceStatus,
  TransformerSourceType,
} from '@kibadist/prisma'
import { Injectable } from '@nestjs/common'

import { ConceptStateService } from '../concept-state/concept-state.service'
import { PrismaService } from '../prisma/prisma.service'
import { extractTextDocument } from '../source-document/source-document'
import type { UpdateOnboardingDto } from './dto/update-onboarding.dto'
import {
  deriveOnboardingSteps,
  isOnboardingComplete,
  ONBOARDING_STEP_KEYS,
  type OnboardingStep,
} from './onboarding.steps'
import {
  STARTER_ARTICLE_JSON,
  STARTER_SOURCE_BLOCKS,
  STARTER_SOURCE_TEXT,
  STARTER_SOURCE_TITLE,
} from './starter-article.fixture'

/** The walkthrough status the Today checklist reads (DET-307). */
export interface OnboardingStatus {
  /** Show the checklist: not dismissed and not yet complete. */
  active: boolean
  dismissed: boolean
  completed: boolean
  /** The active workspace has no concepts and no sources — a true first run. */
  workspaceEmpty: boolean
  /** Seeded starter ids (null until "Try it with a built-in article" is used). */
  starterSourceId: string | null
  starterArticleId: string | null
  starterConceptId: string | null
  /** The starter article's status, or null if it was deleted like any source. */
  starterArticleStatus: TransformedArticleStatus | null
  steps: OnboardingStep[]
}

/** The seeded starter's ids, returned so the client can deep-link straight in. */
export interface StarterSeedResult {
  sourceId: string
  articleId: string
  conceptId: string
}

/**
 * First-run onboarding (DET-307). Seeds a real starter article through genuine
 * pipeline rows and reports the guided checklist, whose steps are DERIVED from
 * observable data (see `onboarding.steps.ts`). One `OnboardingState` row per user,
 * created lazily on first seed/update — a user who never onboards has no row, and
 * existing users with content are never shown the checklist (`workspaceEmpty` +
 * `started` gate it on the client).
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conceptState: ConceptStateService,
  ) {}

  /** The full checklist status for the active workspace. */
  async getStatus(
    userId: string,
    workspaceId: string,
  ): Promise<OnboardingStatus> {
    const state = await this.prisma.onboardingState.findUnique({
      where: { userId },
    })
    const starterArticleId = state?.starterArticleId ?? null

    const [eventTypes, earnedConceptCount, reviewPromptCount, articleStatus] =
      await Promise.all([
        this.starterEventTypes(userId, starterArticleId),
        this.prisma.concept.count({
          where: { userId, workspaceId, status: ConceptStatus.PERMANENT },
        }),
        starterArticleId
          ? this.prisma.reviewPrompt.count({
              where: { userId, articleId: starterArticleId },
            })
          : Promise.resolve(0),
        this.starterArticleStatus(userId, starterArticleId),
      ])

    const steps = deriveOnboardingSteps({
      eventTypes,
      earnedConceptCount,
      reviewPromptCount,
      completedSteps: state?.completedSteps ?? [],
    })
    const dismissed = Boolean(state?.dismissedAt)
    const completed = isOnboardingComplete(steps)

    // Stamp completion durably the first time it's observed, so the "never shown
    // again" guarantee survives even if a later concept is archived.
    if (completed && state && !state.completedAt) {
      await this.prisma.onboardingState.update({
        where: { userId },
        data: { completedAt: new Date() },
      })
    }

    const persistedComplete = completed || Boolean(state?.completedAt)

    return {
      active: !dismissed && !persistedComplete,
      dismissed,
      completed: persistedComplete,
      workspaceEmpty: await this.isWorkspaceEmpty(userId, workspaceId),
      starterSourceId: state?.starterSourceId ?? null,
      starterArticleId,
      starterConceptId: state?.starterConceptId ?? null,
      starterArticleStatus: articleStatus,
      steps,
    }
  }

  /**
   * Seed the built-in starter article (DET-307), idempotently. If a starter is
   * already seeded and its article still exists, returns it unchanged; otherwise
   * creates a real TransformerSource (READY) + its version-1 blocks + a FINAL
   * TransformedArticle + a companion INBOX concept (the Read-queue row), exactly
   * the rows an ordinary text capture would leave — so the article renders through
   * the normal reading surface and the row is deletable like any source.
   */
  async seedStarter(
    userId: string,
    workspaceId: string,
  ): Promise<StarterSeedResult> {
    const existing = await this.prisma.onboardingState.findUnique({
      where: { userId },
    })
    if (
      existing?.starterArticleId &&
      existing.starterSourceId &&
      existing.starterConceptId
    ) {
      const article = await this.prisma.transformedArticle.findFirst({
        where: { id: existing.starterArticleId, source: { userId } },
        select: { id: true },
      })
      if (article) {
        return {
          sourceId: existing.starterSourceId,
          articleId: existing.starterArticleId,
          conceptId: existing.starterConceptId,
        }
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const source = await tx.transformerSource.create({
        data: {
          userId,
          workspaceId,
          type: TransformerSourceType.TEXT,
          status: TransformerSourceStatus.READY,
          title: STARTER_SOURCE_TITLE,
          rawContent: STARTER_SOURCE_TEXT,
          extractedText: STARTER_SOURCE_TEXT,
          extractorVersion: 'onboarding-starter@1',
          blocksVersion: 1,
          metadata: { title: STARTER_SOURCE_TITLE, starter: true },
        },
      })
      await tx.transformerSourceBlock.createMany({
        data: STARTER_SOURCE_BLOCKS.map((b) => ({
          sourceId: source.id,
          version: 1,
          orderIndex: b.orderIndex,
          blockType: b.blockType,
          text: b.text,
          classificationStatus: 'classified',
          removable: false,
        })),
      })
      const article = await tx.transformedArticle.create({
        data: {
          sourceId: source.id,
          workspaceId,
          blocksVersion: 1,
          status: ArticleStatus.FINAL,
          articleJson: STARTER_ARTICLE_JSON as unknown as Prisma.InputJsonValue,
          fidelityScore: 100,
        },
      })
      // The companion INBOX concept mirrors a real capture (DET-300): same raw
      // material, hard-linked to the source, so it shows in Read and is discarded
      // like any other captured item.
      const concept = await tx.concept.create({
        data: {
          userId,
          workspaceId,
          title: STARTER_SOURCE_TITLE,
          sourceText: STARTER_SOURCE_TEXT,
          sourceDocument: extractTextDocument(
            STARTER_SOURCE_TEXT,
          ) as unknown as Prisma.InputJsonValue,
          captureSource: CaptureSource.PASTE,
          sourceId: source.id,
          status: ConceptStatus.INBOX,
        },
      })
      await this.conceptState.recordCapture(
        concept.id,
        userId,
        tx,
        'Seeded starter article (DET-307)',
      )
      return {
        sourceId: source.id,
        articleId: article.id,
        conceptId: concept.id,
      }
    })

    await this.prisma.onboardingState.upsert({
      where: { userId },
      create: {
        userId,
        starterSourceId: result.sourceId,
        starterArticleId: result.articleId,
        starterConceptId: result.conceptId,
        completedSteps: [],
      },
      update: {
        starterSourceId: result.sourceId,
        starterArticleId: result.articleId,
        starterConceptId: result.conceptId,
      },
    })
    return result
  }

  /**
   * Update the walkthrough (DET-307): dismiss it forever, and/or mark a step the
   * user completed that leaves no data trail (the Map view). Unknown step keys are
   * ignored; `completedSteps` is kept de-duplicated.
   */
  async update(
    userId: string,
    workspaceId: string,
    dto: UpdateOnboardingDto,
  ): Promise<OnboardingStatus> {
    const current = await this.prisma.onboardingState.findUnique({
      where: { userId },
    })
    const completedSteps = new Set(current?.completedSteps ?? [])
    if (dto.completedStep && isStepKey(dto.completedStep)) {
      completedSteps.add(dto.completedStep)
    }
    const dismissedAt =
      dto.dismissed === true
        ? (current?.dismissedAt ?? new Date())
        : dto.dismissed === false
          ? null
          : (current?.dismissedAt ?? null)

    await this.prisma.onboardingState.upsert({
      where: { userId },
      create: {
        userId,
        completedSteps: [...completedSteps],
        dismissedAt,
      },
      update: {
        completedSteps: [...completedSteps],
        dismissedAt,
      },
    })
    return this.getStatus(userId, workspaceId)
  }

  /** Distinct learning-event types logged against the starter article. */
  private async starterEventTypes(
    userId: string,
    starterArticleId: string | null,
  ): Promise<Set<string>> {
    if (!starterArticleId) return new Set()
    const rows = await this.prisma.articleLearningEvent.findMany({
      where: { userId, articleId: starterArticleId },
      distinct: ['eventType'],
      select: { eventType: true },
    })
    return new Set(rows.map((r) => r.eventType))
  }

  /** The starter article's status, or null if it no longer exists (deleted). */
  private async starterArticleStatus(
    userId: string,
    starterArticleId: string | null,
  ): Promise<TransformedArticleStatus | null> {
    if (!starterArticleId) return null
    const article = await this.prisma.transformedArticle.findFirst({
      where: { id: starterArticleId, source: { userId } },
      select: { status: true },
    })
    return article?.status ?? null
  }

  /** A true first run: no concepts (inbox or earned) and no sources yet. */
  private async isWorkspaceEmpty(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const [concepts, sources] = await Promise.all([
      this.prisma.concept.count({ where: { userId, workspaceId } }),
      this.prisma.transformerSource.count({
        where: { userId, workspaceId },
      }),
    ])
    return concepts === 0 && sources === 0
  }
}

function isStepKey(value: string): boolean {
  return (ONBOARDING_STEP_KEYS as readonly string[]).includes(value)
}
