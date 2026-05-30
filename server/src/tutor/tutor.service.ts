import {
  type Articulation,
  type CognitiveState,
  ConceptStatus,
  LinkStatus,
  StateTrigger,
} from '@kibadist/prisma'
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'

import { AiService } from '../ai/ai.service'
import { ConceptStateService } from '../concept-state/concept-state.service'
import { ConceptsService } from '../concepts/concepts.service'
import { PrismaService } from '../prisma/prisma.service'
import { addDays } from '../retrieval/sm2'
import { SearchService } from '../search/search.service'
import {
  buildTutorPrompt,
  parseTutorQuestion,
  TUTOR_ANGLES,
  type TutorAngle,
} from './tutor.prompt'

/** Below this many CONFIRMED links a RETRIEVED concept is "thinly connected" —
 *  recalled often but never stress-tested, the fluency illusion the Tutor
 *  exists to break (DET-193). */
const MIN_CONFIRMED_LINKS = 2
const ELIGIBLE_LIMIT = 20

/** The Tutor's question for one challenge: the question + the angle it took. */
export interface TutorChallenge {
  question: string
  angle: TutorAngle
}

/** A concept the Tutor should auto-challenge: RETRIEVED but thinly connected. */
export interface EligibleConcept {
  id: string
  title: string
  cognitiveState: CognitiveState
}

/** The user's response to a Tutor challenge, persisted as a new articulation. */
export interface RespondTutorInput {
  question: string
  response: string
  defended: boolean
}

/** The persisted articulation plus the concept's resulting cognitive state. */
export interface TutorRespondResult {
  articulation: Articulation
  cognitiveState: CognitiveState
}

/**
 * The Socratic Tutor (DET-193). Challenges the user's OWN compression (their
 * latest articulation) to expose gaps. It asks exactly ONE question, never
 * answers it, never gives a model answer, and never grades — the model output is
 * metadata, never knowledge. The user's reply IS canonical cognition: it is
 * stored as a new articulation (their words), and the exchange is logged as a
 * RetrievalEvent with `score: null` so the concept's history holds the challenge
 * without ever attaching a grade. A self-declared "defended" reply promotes the
 * concept RETRIEVED → DEFENDED; a "found a gap" reply pulls the next review
 * sooner without any state change.
 */
@Injectable()
export class TutorService {
  private readonly logger = new Logger(TutorService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiService,
    private readonly concepts: ConceptsService,
    private readonly conceptState: ConceptStateService,
    private readonly search: SearchService,
  ) {}

  /**
   * Generate a single Socratic question for a concept the user owns. Reads the
   * concept title + their LATEST articulation (the compression to challenge) and
   * picks an angle: the caller's if given, else a deterministic rotation keyed on
   * how many times this concept has been retrieved (so repeated challenges cycle
   * through angles rather than repeating one). PERSISTS NOTHING — the question is
   * ephemeral until the user responds.
   */
  async challenge(
    userId: string,
    conceptId: string,
    angle?: TutorAngle,
  ): Promise<TutorChallenge> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)

    const concept = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { title: true },
    })
    // assertOwnedNonInbox already guarantees existence; satisfy the type.
    const title = concept?.title ?? ''

    const latest = await this.prisma.articulation.findFirst({
      where: { conceptId, userId },
      orderBy: { createdAt: 'desc' },
      select: { body: true },
    })
    if (!latest) {
      throw new BadRequestException(
        'Articulate this concept before a tutor challenge',
      )
    }

    const chosenAngle = angle ?? (await this.rotateAngle(conceptId, userId))

    const { system, prompt } = buildTutorPrompt({
      title,
      articulation: latest.body,
      angle: chosenAngle,
    })

    let text: string
    try {
      const result = await this.ai.complete({
        system,
        prompt,
        temperature: 0.7,
        maxTokens: 300,
      })
      text = result.text
    } catch (error) {
      this.logger.warn(
        `Tutor challenge generation failed for ${conceptId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
      throw new ServiceUnavailableException(
        'The tutor is unavailable right now — try again shortly',
      )
    }

    const question = parseTutorQuestion(text)
    if (!question) {
      throw new ServiceUnavailableException(
        'The tutor is unavailable right now — try again shortly',
      )
    }

    return { question, angle: chosenAngle }
  }

  /**
   * Persist the user's response to a Tutor challenge (DET-193). The response is
   * canonical user cognition, so it is stored as a NEW articulation; the exchange
   * is also logged as a RetrievalEvent with `score: null` (the Tutor never
   * grades). These two writes commit together. The state/schedule update is
   * best-effort and must never roll back the articulation: a self-declared
   * "defended" reply attempts RETRIEVED → DEFENDED (an illegal move, e.g. still
   * EXPLAINED, is caught and logged); a "found a gap" reply pulls the next review
   * to tomorrow without touching the state.
   */
  async respond(
    userId: string,
    conceptId: string,
    dto: RespondTutorInput,
  ): Promise<TutorRespondResult> {
    await this.concepts.assertOwnedNonInbox(userId, conceptId)

    const articulation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.articulation.create({
        data: { body: dto.response, conceptId, userId },
      })
      // The exchange joins the concept's history WITHOUT a grade: score stays
      // null because the Tutor exposes gaps, it never scores understanding.
      await tx.retrievalEvent.create({
        data: {
          conceptId,
          userId,
          question: dto.question,
          response: dto.response,
          score: null,
        },
      })

      if (dto.defended) {
        // Survived the challenge → promote. Best-effort: an illegal move (the
        // concept hasn't reached RETRIEVED yet) is caught so the recorded
        // articulation + event still commit.
        try {
          await this.conceptState.transition(
            {
              conceptId,
              userId,
              to: 'DEFENDED',
              trigger: StateTrigger.TUTOR_DEFENDED,
            },
            tx,
          )
        } catch (error) {
          this.logger.warn(
            `Tutor DEFENDED transition skipped for ${conceptId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        }
      } else {
        // Found a gap → no state change, but resurface sooner so the user
        // revisits the weak spot before it fades.
        await tx.concept.updateMany({
          where: { id: conceptId, userId },
          data: { nextReviewAt: addDays(new Date(), 1) },
        })
      }

      return created
    })

    // Embed-on-write so the new articulation is searchable. Best-effort and
    // OUTSIDE the tx (like ArticulationsService): AI downtime never loses the write.
    await this.search.indexArticulation(articulation.id, dto.response)

    const after = await this.prisma.concept.findFirst({
      where: { id: conceptId, userId },
      select: { cognitiveState: true },
    })

    return {
      articulation,
      cognitiveState: after?.cognitiveState ?? 'EXPLAINED',
    }
  }

  /**
   * Concepts the Tutor should auto-challenge (DET-193): owned, earned (non-INBOX)
   * concepts that are RETRIEVED but thinly connected — fewer than
   * {@link MIN_CONFIRMED_LINKS} CONFIRMED links. These are recalled often yet
   * never stress-tested or defended, the fluency illusion the Tutor breaks.
   */
  async eligible(userId: string): Promise<EligibleConcept[]> {
    const candidates = await this.prisma.concept.findMany({
      where: {
        userId,
        status: { not: ConceptStatus.INBOX },
        cognitiveState: 'RETRIEVED',
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, cognitiveState: true },
    })

    const eligible: EligibleConcept[] = []
    for (const concept of candidates) {
      const confirmedLinks = await this.prisma.link.count({
        where: {
          userId,
          status: LinkStatus.CONFIRMED,
          OR: [
            { sourceConceptId: concept.id },
            { targetConceptId: concept.id },
          ],
        },
      })
      if (confirmedLinks < MIN_CONFIRMED_LINKS) eligible.push(concept)
      if (eligible.length >= ELIGIBLE_LIMIT) break
    }

    return eligible
  }

  /**
   * Pick the next angle deterministically (no randomness): rotate through
   * {@link TUTOR_ANGLES} keyed on how many times this concept has been retrieved,
   * so back-to-back challenges take different angles.
   */
  private async rotateAngle(
    conceptId: string,
    userId: string,
  ): Promise<TutorAngle> {
    const count = await this.prisma.retrievalEvent.count({
      where: { conceptId, userId },
    })
    return TUTOR_ANGLES[count % TUTOR_ANGLES.length]
  }
}
