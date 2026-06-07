'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { api, type OnboardingStepKey } from '@/lib/api'
import {
  nextOnboardingStep,
  ONBOARDING_STEP_COPY,
  onboardingProgress,
  onboardingStepHref,
} from '@/lib/onboarding'

/**
 * First-run onboarding (DET-307) — the guided "first source → first earned
 * concept" walkthrough, surfaced as a lightweight checklist panel on Today (never
 * a modal tour). A brand-new, empty workspace gets a single CTA to seed a real
 * built-in article; once seeded, the panel becomes a six-step checklist whose
 * done-ness is derived server-side from genuine activity, so it survives reloads
 * and can't drift. Each step deep-links into its surface with the right reading
 * mode. The panel persists until every step is done or the user dismisses it
 * forever — then it never returns.
 */
export function OnboardingPanel() {
  const router = useRouter()
  const queryClient = useQueryClient()
  const onboardingQuery = useQuery({
    queryKey: ['onboarding'],
    queryFn: api.getOnboarding,
  })

  const seed = useMutation({
    mutationFn: api.seedOnboardingStarter,
    onSuccess: (seedResult) => {
      // The starter now exists as a real source + article + Read row.
      queryClient.invalidateQueries({ queryKey: ['onboarding'] })
      queryClient.invalidateQueries({ queryKey: ['inbox'] })
      queryClient.invalidateQueries({ queryKey: ['transformer-sources'] })
      router.push(`/transformer/articles/${seedResult.articleId}`)
    },
  })

  const update = useMutation({
    mutationFn: api.updateOnboarding,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['onboarding'] }),
  })

  const status = onboardingQuery.data
  // Stay silent until the status resolves (no flash) and whenever the walkthrough
  // is inactive — dismissed forever or already complete.
  if (!status || !status.active) return null

  const started = status.starterArticleId !== null

  // Not yet started: only a brand-new (empty) workspace gets the first-run offer —
  // an existing user who never onboarded is never nagged.
  if (!started) {
    if (!status.workspaceEmpty) return null
    return (
      <section className='panel panel-raised onb-panel'>
        <div className='today-panel-head'>
          <span className='section-label'>§ Start here · First run</span>
        </div>
        <h2 className='today-panel-title'>Try it with a built-in article</h2>
        <p className='onb-lede'>
          The whole point of Kibadist is the feeling of <em>earned</em>{' '}
          understanding — and you only feel it after one full loop. Start with a
          short built-in article and we’ll walk you to your first earned,
          mapped, review-scheduled concept. About fifteen minutes.
        </p>
        <button
          type='button'
          className='btn-primary today-cta'
          onClick={() => seed.mutate()}
          disabled={seed.isPending}
        >
          {seed.isPending ? 'Setting it up…' : 'Try the starter article'}{' '}
          <span className='ar'>→</span>
        </button>
        {seed.isError && (
          <p className='today-empty'>
            Could not set up the starter article. Try again in a moment.
          </p>
        )}
        <button
          type='button'
          className='onb-dismiss'
          onClick={() => update.mutate({ dismissed: true })}
        >
          Skip — I’ll find my own way
        </button>
      </section>
    )
  }

  const { done, total, pct } = onboardingProgress(status.steps)
  const next = nextOnboardingStep(status.steps)
  const articleId = status.starterArticleId

  // A deleted starter (status null) leaves the article steps without a target;
  // surface a gentle re-seed rather than a dead checklist.
  const starterGone = status.starterArticleStatus === null

  return (
    <section className='panel panel-raised onb-panel'>
      <div className='today-panel-head'>
        <span className='section-label'>§ First run · Your first loop</span>
        <span className='head-count'>
          {done} / {total} done
        </span>
      </div>
      <h2 className='today-panel-title'>Earn your first concept</h2>

      <div className='track-progress'>
        <div className='track-progress-bar'>
          <span
            className={`track-progress-fill${pct === 100 ? ' is-complete' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className='track-progress-label'>{pct}%</span>
      </div>

      {starterGone ? (
        <div className='onb-gone'>
          <p className='today-empty'>
            You deleted the starter article — that’s fine, it’s yours to remove.
            Want a fresh one to finish the walkthrough?
          </p>
          <button
            type='button'
            className='btn-primary today-cta'
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
          >
            {seed.isPending ? 'Setting it up…' : 'Re-seed the starter'}{' '}
            <span className='ar'>→</span>
          </button>
        </div>
      ) : (
        <ol className='onb-steps'>
          {status.steps.map((step, i) => {
            const copy = ONBOARDING_STEP_COPY[step.key]
            const isNext = next?.key === step.key
            return (
              <li
                key={step.key}
                className={`onb-step${step.done ? ' is-done' : ''}${
                  isNext ? ' is-next' : ''
                }`}
              >
                <span className='onb-check' aria-hidden='true'>
                  {step.done ? '✓' : i + 1}
                </span>
                <div className='onb-step-body'>
                  <span className='onb-step-title'>{copy.title}</span>
                  <span className='onb-why'>{copy.why}</span>
                  {!step.done && (
                    <Link
                      href={onboardingStepHref(step.key, articleId)}
                      className='onb-step-cta'
                      onClick={() => markOnNavigate(step.key, update.mutate)}
                    >
                      {copy.cta} <span className='ar'>→</span>
                    </Link>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <button
        type='button'
        className='onb-dismiss'
        onClick={() => update.mutate({ dismissed: true })}
      >
        Dismiss the walkthrough
      </button>
    </section>
  )
}

/**
 * The Map step leaves no data trail (a concept is on the Map the moment it's
 * earned), so clicking through to it is what proves the user saw it — mark it as
 * the navigation happens. Other steps complete from their own activity.
 */
function markOnNavigate(
  key: OnboardingStepKey,
  mark: (input: { completedStep: OnboardingStepKey }) => void,
): void {
  if (key === 'map') mark({ completedStep: 'map' })
}
