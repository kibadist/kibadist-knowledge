import {
  canSuggestAutomatically,
  decidePromptScheduling,
  type PromptSchedulingInput,
} from './prompt-scheduling'

/** A baseline input that satisfies every auto-schedule condition. */
function eligible(
  overrides: Partial<PromptSchedulingInput> = {},
): PromptSchedulingInput {
  return {
    origin: 'user_authored_text',
    riskClass: 'low_risk_recall',
    hasSourceSpan: true,
    hasUserAuthoredExplanation: true,
    sourceConfidence: 'source_supported',
    autoScheduleEnabled: true,
    bulkApprovalClicked: false,
    ...overrides,
  }
}

describe('decidePromptScheduling — the strict auto-schedule rule', () => {
  it('auto-schedules when every condition holds', () => {
    const d = decidePromptScheduling(eligible())
    expect(d.status).toBe('scheduled')
    expect(d.autoScheduled).toBe(true)
    expect(d.reason).toBe('auto_schedule_rule_met')
  })

  it('a bulk-approval CTA substitutes for the settings toggle', () => {
    const d = decidePromptScheduling(
      eligible({ autoScheduleEnabled: false, bulkApprovalClicked: true }),
    )
    expect(d.status).toBe('scheduled')
  })

  it('the user-authored explanation substitutes for a source span', () => {
    const d = decidePromptScheduling(
      eligible({ hasSourceSpan: false, hasUserAuthoredExplanation: true }),
    )
    expect(d.status).toBe('scheduled')
  })
})

describe('decidePromptScheduling — falls back to suggested', () => {
  it('AI-prose origin requires approval', () => {
    const d = decidePromptScheduling(eligible({ origin: 'ai_article_prose' }))
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('origin_requires_approval')
  })

  it('inferred misconception requires approval', () => {
    const d = decidePromptScheduling(
      eligible({ origin: 'inferred_misconception' }),
    )
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('origin_requires_approval')
  })

  it('interpretation-heavy prompts require approval', () => {
    const d = decidePromptScheduling(eligible({ riskClass: 'interpretation' }))
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('risk_requires_approval')
  })

  it('transfer prompts require approval', () => {
    const d = decidePromptScheduling(eligible({ riskClass: 'transfer' }))
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('risk_requires_approval')
  })

  it('no source span and no stored explanation requires approval', () => {
    const d = decidePromptScheduling(
      eligible({ hasSourceSpan: false, hasUserAuthoredExplanation: false }),
    )
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('no_source_or_explanation')
  })

  it('low source confidence requires approval even for eligible origins', () => {
    const d = decidePromptScheduling(
      eligible({ sourceConfidence: 'needs_review' }),
    )
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('low_source_confidence')
  })

  it('unsupported/invented support requires approval', () => {
    const d = decidePromptScheduling(
      eligible({ sourceConfidence: 'unsupported_or_invented' }),
    )
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('low_source_confidence')
  })

  it('absent user consent requires approval', () => {
    const d = decidePromptScheduling(
      eligible({ autoScheduleEnabled: false, bulkApprovalClicked: false }),
    )
    expect(d.status).toBe('suggested')
    expect(d.reason).toBe('user_consent_absent')
  })
})

describe('canSuggestAutomatically', () => {
  it('allows suggestions from user-authored and AI-prose-grounded origins', () => {
    expect(canSuggestAutomatically('user_authored_text')).toBe(true)
    expect(canSuggestAutomatically('source_grounded_claim')).toBe(true)
    expect(canSuggestAutomatically('ai_article_prose')).toBe(true)
    expect(canSuggestAutomatically('inferred_misconception')).toBe(true)
  })

  it('blocks auto-suggestion of unconfirmed relationships and transfer prompts', () => {
    expect(canSuggestAutomatically('unconfirmed_relationship')).toBe(false)
    expect(canSuggestAutomatically('transfer_application')).toBe(false)
    expect(canSuggestAutomatically('living_concept_metaphor')).toBe(false)
  })
})
