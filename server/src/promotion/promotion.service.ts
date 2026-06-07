import {
  type CognitiveState,
  ConceptStatus,
  FrictionLevel,
  LinkRelation,
  LinkStatus,
  Prisma,
  QuestionActor,
  StateTrigger,
} from '@kibadist/prisma'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptStateService } from '../concept-state/concept-state.service'
import { ConceptsService } from '../concepts/concepts.service'
import { ConnectorService } from '../connector/connector.service'
import { DomainSuggestionService } from '../domains/domain-suggestion.service'
import { PrismaService } from '../prisma/prisma.service'
import { SearchService } from '../search/search.service'
import {
  asSourceDocument,
  type SourceDocument,
} from '../source-document/source-document'
import {
  type ReferenceQaContext,
  SourceQaService,
} from '../source-qa/source-qa.service'
import { TracksService } from '../tracks/tracks.service'
import { assessCompression, type CompressionSignal } from './compression'
import type { CommitPromotionDto } from './dto/commit-promotion.dto'
import {
  type FrictionProposal,
  modeForLevel,
  NEW_LEARNER_EARNED_THRESHOLD,
  proposeFriction,
  type TrackPull,
  trackPullForDepth,
} from './friction'
import {
  buildGradePrompt,
  buildQuestionPrompt,
  isPassingScore,
  parseGrade,
  parseQuestion,
} from './gate.prompt'
import {
  type ConnectionDecision,
  evaluateGates,
  type GateChecklist,
} from './gates'

const SUGGESTION_LIMIT = 5

export interface PromotionDraftDto {
  conceptId: string
  /** Adaptive Friction level (DET-197) — the user's CURRENT chosen depth. */
  frictionLevel: FrictionLevel
  articulation: string | null
  connectionsReviewed: boolean
  retrievalQuestion: string | null
  retrievalResponse: string | null
  retrievalScore: number | null
}

export interface SuggestedConnection {
  targetConceptId: string
  title: string
  similarity: number
  snippet: string
  /** The Connector's typed relationship proposal (DET-191). */
  relationKind: LinkRelation
  /** One-sentence Connector rationale citing both compressions. */
  rationale: string
}

export interface PromotionStateDto {
  conceptId: string
  title: string
  sourceText: string | null
  /** Structured source for the Reader (DET-210); null for pre-DET-210 captures. */
  sourceDocument: SourceDocument | null
  draft: PromotionDraftDto
  checklist: GateChecklist
  /** Compression quality signal (DET-190): flags a verbatim copy of the source so
   *  the UI can ask the user to rephrase. The Articulate gate fails when verbatim. */
  compression: CompressionSignal
  /** Adaptive Friction (DET-197): the CURRENT chosen level (mirrors draft). */
  frictionLevel: FrictionLevel
  /** The system's friction SUGGESTION + human-readable reasoning. The user may
   *  escalate/de-escalate from it; we never silently apply it. */
  frictionProposal: FrictionProposal
  /** Read-only reference Q&A (DET-208) the user explored while reading. Surfaced
   *  so Compression can DISPLAY it as scaffold — it never prefills or writes the
   *  canonical articulation, which stays user-authored via {@link saveArticulation}. */
  referenceQa: ReferenceQaContext[]
  /** Concept Library handoff (DET-211): when promotion is opened FROM a candidate,
   *  its source-grounded label + definition are surfaced as DISPLAY-ONLY reference
   *  context. This is scaffold the user may consult — it is NEVER written into
   *  draft.articulation (DET-190 no-prefill invariant), which stays user-authored. */
  candidateContext?: { label: string; definition: string | null }
}

/**
 * The Proof-of-Learning Gate (DET-189). Orchestrates the four gates — Articulate,
 * Connect, Retrieve, Validate — over a staging {@link PromotionDraft}, and is the
 * ONLY path that can move a concept from INBOX to PERMANENT.
 *
 * Knowledge artifacts (Articulation, Link, RetrievalEvent) are never attached to
 * the live INBOX concept mid-flow — that would break the DET-187 invariant. They
 * are written only inside the commit transaction, as the status flips.
 */
@Injectable()
export class PromotionService {
  private readonly logger = new Logger(PromotionService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly concepts: ConceptsService,
    private readonly ai: AiService,
    private readonly search: SearchService,
    private readonly sourceQa: SourceQaService,
    private readonly conceptState: ConceptStateService,
    private readonly connector: ConnectorService,
    // Track-first onboarding (DET-240): post-commit track enrollment + domain
    // suggestion for a concept captured against a target track.
    private readonly tracks: TracksService,
    private readonly domainSuggestion: DomainSuggestionService,
  ) {}

  /** Current promotion state for an inbox item: draft + gate checklist + the
   *  Adaptive Friction proposal (DET-197). Creates an empty draft on first open. */
  async getState(
    userId: string,
    conceptId: string,
    candidateId?: string,
  ): Promise<PromotionStateDto> {
    const concept = await this.requireInboxConcept(userId, conceptId)
    // Adaptive Friction proposal (DET-197): the system SUGGESTS a level from
    // cheap signals — novelty (distance from what's already earned), and the
    // source's conceptual weight (length). Importance is the user escalating, so
    // there is no separate importance signal here. The user may override; the
    // stored draft.frictionLevel only changes via setFriction.
    //
    // Gentler defaults (DET-311): a first-mile learner (few earned concepts) is
    // proposed LIGHT regardless of the push signals — they earn lightly and
    // deepen on schedule — and depth is PULLED up only by a destination track
    // that demands more. Both signals are resolved here and handed to the pure
    // proposer; gate semantics (which gates each level needs) are untouched.
    const [isNewLearner, track] = await Promise.all([
      this.isNewLearner(userId),
      this.trackPull(userId, concept.targetTrackId),
    ])
    // A freshly-created draft adopts the proposal as its STARTING chosen level
    // (DET-311), so the effective default a passive learner commits at follows
    // the suggestion (LIGHT for a first-miler) instead of the column default of
    // DEEP. A fresh draft has no articulation, so novelty is unknown → high. The
    // user still escalates/de-escalates via setFriction; an existing draft keeps
    // whatever level the user already chose (never re-initialized here).
    const initialLevel = proposeFriction({
      novelty: 1,
      importance: false,
      sourceLength: concept.sourceText?.length ?? 0,
      isNewLearner,
      track,
    }).level
    const draft = await this.ensureDraft(userId, conceptId, initialLevel)
    const maxSimilarity = await this.maxSimilarity(userId, draft.articulation)
    const frictionProposal = proposeFriction({
      // No articulation yet → unknown novelty; treat as high so we lean DEEP.
      novelty: maxSimilarity == null ? 1 : 1 - maxSimilarity,
      importance: false,
      sourceLength: concept.sourceText?.length ?? 0,
      isNewLearner,
      track,
    })
    // Read-only feed-forward (DET-208): show prior reference Q&A as scaffold the
    // user may consult while articulating. This NEVER seeds draft.articulation —
    // the canonical text comes only from saveArticulation's user-supplied body.
    let referenceQa: ReferenceQaContext[] = []
    try {
      referenceQa = await this.sourceQa.recentForContext(userId, conceptId)
    } catch (error) {
      this.logger.warn(
        `Reference Q&A context lookup failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    // Compression quality (DET-190): is the articulation the user's own words,
    // or a copy of the source? Drives both the Articulate gate and the UI nudge.
    const compression = assessCompression(
      draft.articulation,
      concept.sourceText,
    )
    // Concept Library handoff (DET-211): if opened from a candidate, surface its
    // label + definition as DISPLAY-ONLY reference context. We deliberately read
    // it into a separate field and NEVER touch draft.articulation — the canonical
    // articulation stays user-authored (DET-190 no-prefill invariant).
    const candidateContext = await this.candidateContextFor(
      userId,
      conceptId,
      candidateId,
    )
    return {
      conceptId,
      title: concept.title,
      sourceText: concept.sourceText,
      sourceDocument: asSourceDocument(concept.sourceDocument),
      draft: this.toDraftDto(draft),
      checklist: this.checklistFor(
        draft,
        draft.frictionLevel,
        concept.sourceText,
      ),
      compression,
      frictionLevel: draft.frictionLevel,
      frictionProposal,
      referenceQa,
      candidateContext,
    }
  }

  /**
   * Concept Library handoff (DET-211): load a candidate's DISPLAY-ONLY reference
   * context (label + source-grounded definition) for the promote screen. Scoped
   * to the owner + this concept so a foreign/mismatched id yields nothing. This
   * is reference scaffold ONLY — the caller surfaces it for display and never
   * writes it into draft.articulation (DET-190 no-prefill invariant).
   */
  private async candidateContextFor(
    userId: string,
    conceptId: string,
    candidateId?: string,
  ): Promise<{ label: string; definition: string | null } | undefined> {
    if (!candidateId) return undefined
    const candidate = await this.prisma.sourceConceptCandidate.findFirst({
      where: { id: candidateId, conceptId, userId },
      select: { label: true, definition: true },
    })
    if (!candidate) return undefined
    return { label: candidate.label, definition: candidate.definition }
  }

  /** Gate 1 — store the user's own-words articulation. */
  async saveArticulation(
    userId: string,
    conceptId: string,
    body: string,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { articulation: body },
    })
    return this.getState(userId, conceptId)
  }

  /**
   * Adaptive Friction (DET-197) — the user's explicit escalate/de-escalate. This
   * is the ONLY path that changes the stored level, so the system never silently
   * downgrades a Deep concept: any change to a lighter level is a deliberate user
   * act. `mode` is kept consistent (derived from the level) so the retrieval-pass
   * threshold and any reader of the legacy column stay in lockstep.
   */
  async setFriction(
    userId: string,
    conceptId: string,
    level: FrictionLevel,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { frictionLevel: level, mode: modeForLevel(level) },
    })
    return this.getState(userId, conceptId)
  }

  /** Gate 2/4 input — AI-proposed connections (semantic neighbors). These are
   *  suggestions only; nothing is created until the user approves them at commit. */
  async suggestConnections(
    userId: string,
    conceptId: string,
  ): Promise<SuggestedConnection[]> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation) return []

    // DET-191: the Connector surfaces TYPED relationships, ephemerally — the
    // concept is still INBOX, so nothing is persisted (DET-187). It is
    // best-effort (returns [] on failure), so it never blocks the gate.
    const proposals = await this.connector.proposeEphemeral(
      userId,
      conceptId,
      articulation,
    )
    return proposals.slice(0, SUGGESTION_LIMIT).map((p) => ({
      targetConceptId: p.targetConceptId,
      title: p.title,
      similarity: p.similarity,
      snippet: p.rationale.slice(0, 160),
      relationKind: p.relationKind,
      rationale: p.rationale,
    }))
  }

  /**
   * Gate 4 — record that the user has reviewed the AI-proposed connections. This
   * is server-recorded (not a client-asserted boolean) so the Validate gate is
   * re-checkable at commit and cannot be self-certified by a direct API caller.
   */
  async markConnectionsReviewed(
    userId: string,
    conceptId: string,
  ): Promise<PromotionStateDto> {
    await this.requireInboxConcept(userId, conceptId)
    await this.ensureDraft(userId, conceptId)
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: { connectionsReviewed: true },
    })
    return this.getState(userId, conceptId)
  }

  /** Gate 3 setup — generate ONE retrieval question from the articulation. */
  async generateRetrieval(
    userId: string,
    conceptId: string,
  ): Promise<{ question: string }> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation) {
      throw new BadRequestException('Write your articulation first')
    }

    const { system, prompt } = buildQuestionPrompt(articulation)
    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.4,
        maxTokens: 200,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Retrieval question generation failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'Could not generate a retrieval prompt right now — try again shortly',
      )
    }

    const question = parseQuestion(text)
    if (!question) {
      throw new ServiceUnavailableException(
        'Could not generate a retrieval prompt — try again',
      )
    }

    // Storing a (possibly new) question invalidates any prior recall+grade so a
    // user can't pass against an old question.
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: {
        retrievalQuestion: question,
        retrievalResponse: null,
        retrievalScore: null,
        retrievalPassed: false,
      },
    })
    return { question }
  }

  /** Gate 3 — grade the user's recall against their articulation (server-side). */
  async answerRetrieval(
    userId: string,
    conceptId: string,
    response: string,
  ): Promise<{ score: number; passed: boolean; feedback: string | null }> {
    await this.requireInboxConcept(userId, conceptId)
    const draft = await this.ensureDraft(userId, conceptId)
    const articulation = draft.articulation?.trim()
    if (!articulation || !draft.retrievalQuestion) {
      throw new BadRequestException(
        'Generate a retrieval prompt before answering',
      )
    }

    const { system, prompt } = buildGradePrompt({
      articulation,
      question: draft.retrievalQuestion,
      response,
    })
    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0,
        maxTokens: 200,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Retrieval grading failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'Could not grade your answer right now — try again shortly',
      )
    }

    const grade = parseGrade(text)
    if (!grade) {
      throw new ServiceUnavailableException(
        'Could not grade your answer — try again',
      )
    }

    const passed = isPassingScore(
      grade.score,
      modeForLevel(draft.frictionLevel),
    )
    await this.prisma.promotionDraft.update({
      where: { conceptId },
      data: {
        retrievalResponse: response,
        retrievalScore: grade.score,
        retrievalPassed: passed,
      },
    })
    return { score: grade.score, passed, feedback: grade.feedback }
  }

  /**
   * Commit — re-validate ALL four gates from server-held state and, only if they
   * pass, atomically write the knowledge artifacts and flip INBOX → PERMANENT.
   * Each gate is checked against persisted proof, not the client's word:
   * articulation text, the AI-graded retrieval score (re-scored against the
   * committed mode), the server-validated approved connections, and the draft's
   * `connectionsReviewed` flag. This is the single chokepoint enforcing the
   * epistemic guarantee; there is no other path to PERMANENT anywhere in the app.
   */
  async commit(userId: string, conceptId: string, dto: CommitPromotionDto) {
    const concept = await this.requireInboxConcept(userId, conceptId)
    const draft = await this.prisma.promotionDraft.findUnique({
      where: { conceptId },
    })
    if (!draft) {
      throw new BadRequestException('Start the promotion before committing')
    }

    // A root is "this stands alone" — contradicting it with approved links is an
    // incoherent request; reject it rather than silently ignoring isRoot.
    if (dto.isRoot && dto.connections.length > 0) {
      throw new BadRequestException(
        'A new root has no connections — uncheck root or remove the links',
      )
    }

    // Validate every approved connection: owned, earned (non-INBOX), not a self
    // link, and de-duplicated. AI suggestions never auto-apply — only what the
    // user listed here is created. We carry the relation label and the typed
    // relationKind the user accepted from a Connector proposal (DET-191).
    const targets = new Map<
      string,
      { relation?: string; relationKind?: LinkRelation }
    >()
    for (const c of dto.connections) {
      if (c.targetConceptId === conceptId) {
        throw new BadRequestException('A concept cannot link to itself')
      }
      await this.concepts.assertOwnedNonInbox(userId, c.targetConceptId)
      if (!targets.has(c.targetConceptId)) {
        targets.set(c.targetConceptId, {
          relation: c.relation,
          relationKind: c.relationKind,
        })
      }
    }

    // Adaptive Friction (DET-197): which gates are required and the retrieval
    // pass bar are both driven by the server-held draft.frictionLevel — never
    // the request body — so a client can't smuggle a lighter gate at commit.
    const mode = modeForLevel(draft.frictionLevel)
    const decision: ConnectionDecision = {
      connectionCount: targets.size,
      isRoot: dto.isRoot,
      // Gate 4 is server-authoritative: it comes from the persisted draft flag
      // (set when the user reviewed suggestions), never from the request body.
      connectionsReviewed: draft.connectionsReviewed,
      level: draft.frictionLevel,
    }
    // Re-derive the retrieval pass against the level's mode (DEEP/RIGOROUS demand
    // a higher score than the lighter levels), so a QUICK pass can't be smuggled
    // into a deeper save.
    const retrievalPassed =
      draft.retrievalScore != null && isPassingScore(draft.retrievalScore, mode)
    // DET-190 authoritative re-check: a verbatim copy of the source can never be
    // promoted, even if a client bypasses the UI. Compression must be original.
    const articulationIsOriginal = !assessCompression(
      draft.articulation,
      concept.sourceText,
    ).verbatim
    const checklist = evaluateGates(
      {
        articulation: draft.articulation,
        articulationIsOriginal,
        retrievalPassed,
      },
      decision,
    )
    if (!checklist.ready) {
      throw new BadRequestException({
        message: 'Promotion blocked: not all proof-of-learning gates are met',
        gates: checklist,
      })
    }

    const articulationBody = (draft.articulation as string).trim()
    const cognitiveState: CognitiveState = checklist.cognitiveState

    const articulationId = await this.prisma.$transaction(async (tx) => {
      // Delete-as-gate: the draft's `@unique` conceptId serializes concurrent
      // commits. The first tx to acquire the row deletes it; a racing second
      // commit blocks, then sees 0 rows and aborts before writing anything —
      // preventing duplicate artifacts or a double promotion.
      const claimed = await tx.promotionDraft.deleteMany({
        where: { conceptId, userId },
      })
      if (claimed.count === 0) {
        throw new ConflictException('This item has already been promoted')
      }

      const articulation = await tx.articulation.create({
        data: { conceptId, userId, body: articulationBody },
      })
      await tx.retrievalEvent.create({
        data: {
          conceptId,
          userId,
          question: draft.retrievalQuestion,
          response: draft.retrievalResponse,
          score: draft.retrievalScore,
        },
      })
      for (const [targetConceptId, edge] of targets) {
        try {
          await tx.link.create({
            data: {
              sourceConceptId: conceptId,
              targetConceptId,
              relation: edge.relation,
              relationKind: edge.relationKind,
              // A typed relationKind means the user accepted a Connector
              // proposal (AI); a bare manual link defaults to USER (DET-191).
              proposedBy: edge.relationKind
                ? QuestionActor.AI
                : QuestionActor.USER,
              status: LinkStatus.CONFIRMED,
              userId,
            },
          })
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException('That link already exists')
          }
          throw error
        }
      }
      await tx.concept.update({
        where: { id: conceptId },
        data: {
          status: ConceptStatus.PERMANENT,
          gateMode: mode,
          // Seed the spaced-retrieval schedule (DET-192): a freshly-earned
          // concept is immediately due for its first resurfacing. The SM-2
          // ease/interval/reps keep their column defaults until the first grade.
          nextReviewAt: new Date(),
        },
      })
      // Route the EXPLAINED/LINKED move through the state machine (DET-194) so
      // it is the single writer of `cognitiveState` and the promotion is logged
      // as a transition. Joins this commit via the tx client.
      await this.conceptState.transition(
        {
          conceptId,
          userId,
          to: cognitiveState,
          trigger: StateTrigger.PROMOTION,
        },
        tx,
      )
      return articulation.id
    })

    // Embed the new articulation so the now-permanent concept is searchable.
    // Best-effort (SearchService swallows failures) and outside the tx.
    await this.search.indexArticulation(articulationId, articulationBody)

    // A contradiction confirmed at the gate contests its target, same as one
    // confirmed later via the Links API (DET-191 → DET-194). Best-effort and
    // post-commit: an illegal target transition (e.g. ARCHIVED) must not undo a
    // promotion that already succeeded.
    for (const [targetConceptId, edge] of targets) {
      if (edge.relationKind !== LinkRelation.CONTRADICTION) continue
      try {
        await this.conceptState.transition({
          conceptId: targetConceptId,
          userId,
          to: 'CONTESTED',
          trigger: StateTrigger.CONTRADICTION,
          note: `contradicted by ${conceptId}`,
        })
      } catch (error) {
        this.logger.warn(
          `Could not contest ${targetConceptId} after promotion of ${conceptId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    }

    // RIGOROUS (DET-197): a publication-grade claim earns two extra obligations,
    // deferred to post-promotion because both operate only on EARNED concepts:
    //  - a Tutor pass — flagged via Concept.tutorRequested for the Socratic Tutor;
    //  - a Connector contradiction pass — surfacing conflicting neighbors.
    // Both are best-effort and post-tx: a failure here never undoes the commit.
    if (draft.frictionLevel === FrictionLevel.RIGOROUS) {
      try {
        await this.prisma.concept.updateMany({
          where: { id: conceptId, userId },
          data: { tutorRequested: true },
        })
      } catch (error) {
        this.logger.warn(
          `Could not flag Tutor pass for RIGOROUS concept ${conceptId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
      try {
        await this.connector.proposeAndPersist(userId, conceptId)
      } catch (error) {
        this.logger.warn(
          `RIGOROUS connector contradiction pass failed for ${conceptId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        )
      }
    } else {
      // DET-191 background pass: now that the concept is PERMANENT, surface and
      // PERSIST typed SUGGESTED proposals for later user approval. Fire-and-forget
      // and self-contained best-effort — a failure here never affects the commit.
      void this.connector
        .proposeAndPersist(userId, conceptId)
        .catch((error) => {
          this.logger.warn(
            `Connector background pass failed for ${conceptId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
    }

    // Track-first onboarding (DET-240): if this concept was captured against a
    // target track, enroll the now-earned concept into it (AI CANDIDATE) and,
    // when enrolled, best-effort suggest domains for it. Both are post-commit and
    // non-fatal — a failure here NEVER undoes a promotion that already succeeded,
    // and neither creates knowledge: the gate did that, this only organizes.
    try {
      const enrolledTrackId = await this.tracks.enrollPromotedConcept(
        userId,
        conceptId,
      )
      if (enrolledTrackId) {
        void this.domainSuggestion
          .suggestForConcept(userId, conceptId)
          .catch((error) => {
            this.logger.warn(
              `Domain suggestion after track enrollment failed for ${conceptId}: ${
                error instanceof Error ? error.message : String(error)
              }`,
            )
          })
      }
    } catch (error) {
      this.logger.warn(
        `Track enrollment after promotion failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }

    return this.concepts.findOne(userId, conceptId)
  }

  /** Abandon an in-progress promotion, discarding the staged inputs. */
  async abandon(userId: string, conceptId: string): Promise<void> {
    await this.requireInboxConcept(userId, conceptId)
    await this.prisma.promotionDraft.deleteMany({
      where: { conceptId, userId },
    })
  }

  /** Loads an inbox-status concept the user owns, or throws NotFound. Mirrors the
   *  intake interrogator's guard — promotion only applies to inbox items. */
  private async requireInboxConcept(userId: string, conceptId: string) {
    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId, status: ConceptStatus.INBOX },
      select: {
        id: true,
        title: true,
        sourceText: true,
        sourceDocument: true,
        // Track-pulled depth (DET-311): which track this is being earned into, if
        // any — its demanded depth can escalate the friction proposal.
        targetTrackId: true,
      },
    })
    if (!concept) throw new NotFoundException('Inbox item not found')
    return concept
  }

  /**
   * Returns the draft for an inbox concept, creating an empty one if needed.
   * Gentler defaults (DET-311): an `initialLevel` (the friction proposal) sets a
   * freshly-created draft's starting chosen level so the effective default
   * follows the suggestion; `mode` is kept in lockstep. It is applied ONLY on
   * creation — an existing draft keeps the user's chosen level untouched. Callers
   * that don't pass it fall back to the column defaults.
   */
  private async ensureDraft(
    userId: string,
    conceptId: string,
    initialLevel?: FrictionLevel,
  ) {
    const existing = await this.prisma.promotionDraft.findUnique({
      where: { conceptId },
    })
    if (existing) return existing
    return this.prisma.promotionDraft.create({
      data: {
        conceptId,
        userId,
        ...(initialLevel
          ? { frictionLevel: initialLevel, mode: modeForLevel(initialLevel) }
          : {}),
      },
    })
  }

  /**
   * Top semantic similarity of the staged articulation to the user's earned
   * concepts. Drives the Adaptive Friction novelty signal (novelty = 1 − this).
   * Returns null when there's no articulation yet (novelty is then unknown).
   * Best-effort: a search failure also yields null (treated as high novelty).
   */
  /**
   * Gentler defaults (DET-311): is this user still in their "first mile"? True
   * while they have earned fewer than {@link NEW_LEARNER_EARNED_THRESHOLD}
   * concepts — long enough to learn the loop without the full four-gate pass on
   * every clip. Counted across the user's PERMANENT concepts.
   */
  private async isNewLearner(userId: string): Promise<boolean> {
    const earned = await this.prisma.concept.count({
      where: { userId, status: ConceptStatus.PERMANENT },
    })
    return earned < NEW_LEARNER_EARNED_THRESHOLD
  }

  /**
   * Track-pulled depth (DET-311): if this concept is being earned into a track
   * (its `targetTrackId`), resolve that track's demanded depth into a friction
   * pull. Ownership-scoped through the workspace owner so a stale/foreign track
   * id yields nothing. Returns null when there is no target track or it is gone.
   */
  private async trackPull(
    userId: string,
    targetTrackId: string | null,
  ): Promise<TrackPull | null> {
    if (!targetTrackId) return null
    const track = await this.prisma.track.findFirst({
      where: { id: targetTrackId, workspace: { ownerUserId: userId } },
      select: { name: true, requiredDepth: true },
    })
    if (!track) return null
    return trackPullForDepth(track.name, track.requiredDepth)
  }

  private async maxSimilarity(
    userId: string,
    articulation: string | null,
  ): Promise<number | null> {
    const text = articulation?.trim()
    if (!text) return null
    try {
      const matches = await this.search.searchArticulations(userId, text, 1)
      return matches[0]?.similarity ?? 0
    } catch {
      return null
    }
  }

  private checklistFor(
    draft: {
      articulation: string | null
      connectionsReviewed: boolean
      retrievalScore: number | null
    },
    level: FrictionLevel,
    sourceText: string | null,
  ): GateChecklist {
    // Pre-commit checklist is advisory for `connect` (which approved links are
    // chosen at commit, so we show it with count 0). `validate` is real here —
    // it reflects the server-recorded review flag. The authoritative check for
    // all gates happens in commit().
    const retrievalPassed =
      draft.retrievalScore != null &&
      isPassingScore(draft.retrievalScore, modeForLevel(level))
    // DET-190: a verbatim copy of the source fails the Articulate gate.
    const articulationIsOriginal = !assessCompression(
      draft.articulation,
      sourceText,
    ).verbatim
    return evaluateGates(
      {
        articulation: draft.articulation,
        articulationIsOriginal,
        retrievalPassed,
      },
      {
        connectionCount: 0,
        isRoot: false,
        connectionsReviewed: draft.connectionsReviewed,
        level,
      },
    )
  }

  private toDraftDto(draft: {
    conceptId: string
    frictionLevel: FrictionLevel
    articulation: string | null
    connectionsReviewed: boolean
    retrievalQuestion: string | null
    retrievalResponse: string | null
    retrievalScore: number | null
  }): PromotionDraftDto {
    return {
      conceptId: draft.conceptId,
      frictionLevel: draft.frictionLevel,
      articulation: draft.articulation,
      connectionsReviewed: draft.connectionsReviewed,
      retrievalQuestion: draft.retrievalQuestion,
      retrievalResponse: draft.retrievalResponse,
      retrievalScore: draft.retrievalScore,
    }
  }
}
