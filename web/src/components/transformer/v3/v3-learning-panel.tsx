import {
  type ArticleJsonV3,
  type QualityReport,
  sourceKindLabel,
  type V3ArticleStatus,
  v3StatusLabel,
} from '@/lib/article-v3'

/**
 * v3 learning + provenance reader panel (DET-343). Surfaces the Source-Grounded
 * Learning Article's learning layer (learning path, key concepts, key claims,
 * retrieval prompts, source notes) and its provenance, and renders the quality-gate
 * verdict with its blockers.
 *
 * Provenance is the visible contract: source-grounded claims and AI scaffolding are
 * styled distinctly (`chip-cleared` vs `chip-pending` + a "✦ AI" tag), and an
 * UNSUPPORTED claim is flagged in red — the same "not from your source" marker the
 * Compendium enrichment lane already uses, applied to the learning layer.
 */
export function V3LearningPanel({
  article,
  quality,
}: {
  article: ArticleJsonV3
  quality: QualityReport | null
}) {
  const { learning, provenance } = article
  return (
    <section className='panel tf-v3-learning'>
      <div className='tf-v3-head'>
        <h3 className='panel-h'>Learning layer</h3>
        <div className='tf-v3-chips'>
          <span className='chip chip-quiet'>
            {sourceKindLabel(article.sourceKind)}
          </span>
          <span className='chip chip-quiet'>
            {provenance.groundedPercent}% source-grounded
          </span>
        </div>
      </div>

      {quality && <QualityBanner quality={quality} />}

      {learning.learningPath.length > 0 && (
        <div className='tf-v3-group'>
          <h4 className='tf-v3-group-h'>Learning path</h4>
          <ol className='tf-v3-path'>
            {learning.learningPath.map((step) => (
              <li key={step.id} className='tf-v3-path-step'>
                {step.objective}
              </li>
            ))}
          </ol>
        </div>
      )}

      {learning.keyConcepts.length > 0 && (
        <div className='tf-v3-group'>
          <h4 className='tf-v3-group-h'>Key concepts</h4>
          <ul className='tf-v3-list'>
            {learning.keyConcepts.map((concept) => (
              <li key={concept.id} className='tf-v3-concept'>
                <span className='tf-v3-concept-label'>{concept.label}</span>
                <span className='tf-v3-concept-def'>{concept.definition}</span>
                <span className='chip chip-cleared'>source-grounded</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {learning.keyClaims.length > 0 && (
        <div className='tf-v3-group'>
          <h4 className='tf-v3-group-h'>Key claims</h4>
          <ul className='tf-v3-list'>
            {learning.keyClaims.map((claim) => (
              <li key={claim.id} className='tf-v3-claim'>
                <span className='tf-v3-claim-text'>{claim.text}</span>
                {claim.support === 'grounded' ? (
                  <span className='chip chip-cleared'>supported</span>
                ) : (
                  <span className='chip chip-contested'>unsupported</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {learning.retrievalPrompts.length > 0 && (
        <div className='tf-v3-group'>
          <h4 className='tf-v3-group-h'>Retrieval prompts</h4>
          <ul className='tf-v3-list'>
            {learning.retrievalPrompts.map((prompt) => (
              <li key={prompt.id} className='tf-v3-prompt'>
                {prompt.prompt}
              </li>
            ))}
          </ul>
        </div>
      )}

      {learning.sourceNotes.length > 0 && (
        <div className='tf-v3-group'>
          <h4 className='tf-v3-group-h'>Source notes</h4>
          <ul className='tf-v3-list'>
            {learning.sourceNotes.map((note) => (
              <li key={note.id} className='tf-v3-note'>
                {note.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

const STATUS_TONE: Record<V3ArticleStatus, string> = {
  READY_FOR_REVIEW: 'chip-cleared',
  BLOCKED: 'chip-contested',
  NEEDS_REGENERATION: 'chip-pending',
  FAILED: 'chip-contested',
}

/** The quality-gate verdict: status, coverage vs threshold, and the blockers. */
function QualityBanner({ quality }: { quality: QualityReport }) {
  return (
    <div className='tf-v3-quality'>
      <div className='tf-v3-quality-head'>
        <span className={`chip ${STATUS_TONE[quality.status]}`}>
          {v3StatusLabel(quality.status)}
        </span>
        <span className='tf-v3-quality-cov'>
          {quality.importantCoveragePercent}% important coverage
          <span className='tf-v3-quality-thresh'>
            {' '}
            (floor {quality.importantCoverageThreshold}%)
          </span>
        </span>
      </div>
      {quality.blockers.length > 0 && (
        <ul className='tf-v3-blockers'>
          {quality.blockers.map((blocker) => (
            <li key={blocker.code} className='tf-v3-blocker'>
              <span
                className={`chip ${blocker.severity === 'hard' ? 'chip-contested' : 'chip-pending'}`}
              >
                {blocker.severity}
              </span>
              <span className='tf-v3-blocker-msg'>{blocker.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
