import type { SourceConfidence } from './article-learning.types'
import {
  buildReviewCompletedEvent,
  buildReviewPromptApprovedEvent,
  defaultReviewPromptStatus,
  promptTypeGroup,
  promptTypeRiskClass,
  REVIEW_PROMPT_GROUPS,
  REVIEW_PROMPT_TYPES,
  type ReviewPrompt,
} from './review-prompt'

/** A baseline approved/user-authored recall prompt with everything in place. */
function recallPrompt(overrides: Partial<ReviewPrompt> = {}): ReviewPrompt {
  return {
    prompt_id: 'rp_sec1_definition_recall_spaced-repetition',
    article_id: 'art_1',
    article_version_id: 'ver_1',
    section_id: 'sec_1',
    concept_id: 'concept_spaced-repetition',
    source_span_ids: ['span_1'],
    created_from_event_id: 'ale_7',
    prompt_type: 'definition_recall',
    origin: 'approved_concept_candidate',
    question: 'Explain spaced repetition in your own words.',
    expected_answer_summary: 'Reviewing material at increasing intervals.',
    status: 'suggested',
    schedule_metadata: {},
    ...overrides,
  }
}

describe('review-prompt vocabulary', () => {
  it('maps every prompt type to a display group', () => {
    for (const type of REVIEW_PROMPT_TYPES) {
      expect(REVIEW_PROMPT_GROUPS).toContain(promptTypeGroup(type))
    }
  })

  it('groups recall types under recall and interpretation/transfer elsewhere', () => {
    expect(promptTypeGroup('definition_recall')).toBe('recall')
    expect(promptTypeGroup('source_faithful_recall')).toBe('recall')
    expect(promptTypeGroup('misconception_repair')).toBe('misconception')
    expect(promptTypeGroup('contrast')).toBe('contrast')
    expect(promptTypeGroup('transfer')).toBe('transfer')
    expect(promptTypeGroup('metaphor_guardrail')).toBe('transfer')
  })

  it('classifies only recall types as low-risk recall', () => {
    expect(promptTypeRiskClass('definition_recall')).toBe('low_risk_recall')
    expect(promptTypeRiskClass('source_faithful_recall')).toBe(
      'low_risk_recall',
    )
    expect(promptTypeRiskClass('misconception_repair')).toBe('interpretation')
    expect(promptTypeRiskClass('contrast')).toBe('interpretation')
    expect(promptTypeRiskClass('transfer')).toBe('transfer')
    expect(promptTypeRiskClass('metaphor_guardrail')).toBe('transfer')
  })
})

describe('defaultReviewPromptStatus — honours the scheduling rule (§4)', () => {
  const supported: SourceConfidence = 'source_supported'

  it('defaults to suggested with no user consent, even for an eligible recall prompt', () => {
    const status = defaultReviewPromptStatus({
      origin: 'user_authored_text',
      prompt_type: 'definition_recall',
      source_span_ids: ['span_1'],
      hasUserAuthoredExplanation: true,
      sourceConfidence: supported,
    })
    expect(status).toBe('suggested')
  })

  it('auto-schedules a low-risk recall prompt from user-authored text once consent is given', () => {
    const status = defaultReviewPromptStatus(
      {
        origin: 'user_authored_text',
        prompt_type: 'definition_recall',
        source_span_ids: ['span_1'],
        hasUserAuthoredExplanation: true,
        sourceConfidence: supported,
      },
      { bulkApprovalClicked: true },
    )
    expect(status).toBe('scheduled')
  })

  it('never auto-schedules an interpretation-heavy type, even with consent', () => {
    const status = defaultReviewPromptStatus(
      {
        origin: 'missed_claim',
        prompt_type: 'misconception_repair',
        source_span_ids: ['span_1'],
        hasUserAuthoredExplanation: true,
        sourceConfidence: supported,
      },
      { autoScheduleEnabled: true },
    )
    expect(status).toBe('suggested')
  })

  it('never auto-schedules a transfer prompt, even with consent', () => {
    const status = defaultReviewPromptStatus(
      {
        origin: 'approved_concept_candidate',
        prompt_type: 'transfer',
        source_span_ids: ['span_1'],
        hasUserAuthoredExplanation: true,
        sourceConfidence: supported,
      },
      { autoScheduleEnabled: true },
    )
    expect(status).toBe('suggested')
  })

  it('never auto-schedules an AI-prose-only prompt', () => {
    const status = defaultReviewPromptStatus(
      {
        origin: 'ai_article_prose',
        prompt_type: 'source_faithful_recall',
        source_span_ids: [],
        hasUserAuthoredExplanation: false,
        sourceConfidence: 'article_supported_source_unavailable',
      },
      { autoScheduleEnabled: true },
    )
    expect(status).toBe('suggested')
  })
})

describe('buildReviewPromptApprovedEvent', () => {
  it('emits a review_prompt_approved event carrying the prompt identity', () => {
    const prompt = recallPrompt()
    const event = buildReviewPromptApprovedEvent({
      user_id: 'user_1',
      prompt,
      schedule_id: 'sched_9',
    })
    expect(event.event_type).toBe('review_prompt_approved')
    expect(event.user_id).toBe('user_1')
    expect(event.article_id).toBe('art_1')
    expect(event.section_id).toBe('sec_1')
    expect(event.source_span_ids).toEqual(['span_1'])
    // The learner-facing question rides in `prompt`, not as the answer.
    expect(event.prompt).toBe('Explain spaced repetition in your own words.')
    expect(event.user_answer).toBeUndefined()
    expect(event.metadata).toMatchObject({
      prompt_id: prompt.prompt_id,
      prompt_type: 'definition_recall',
      prompt_group: 'recall',
      concept_id: 'concept_spaced-repetition',
      created_from_event_id: 'ale_7',
      schedule_id: 'sched_9',
    })
  })
})

describe('buildReviewCompletedEvent', () => {
  it('emits a review_completed event linking back to the prompt and storing the answer verbatim', () => {
    const prompt = recallPrompt()
    const event = buildReviewCompletedEvent({
      user_id: 'user_1',
      prompt,
      schedule_id: 'sched_9',
      user_answer: '  intervals that grow over time  ',
      block_id: 'blk_3',
    })
    expect(event.event_type).toBe('review_completed')
    expect(event.section_id).toBe('sec_1')
    expect(event.block_id).toBe('blk_3')
    // Verbatim: the answer is stored exactly as written, untrimmed.
    expect(event.user_answer).toBe('  intervals that grow over time  ')
    expect(event.metadata).toMatchObject({
      prompt_id: prompt.prompt_id,
      prompt_type: 'definition_recall',
      concept_id: 'concept_spaced-repetition',
      schedule_id: 'sched_9',
    })
  })
})
