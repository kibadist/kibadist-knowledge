'use client'

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { InlineRuns } from '@/components/reader/inline-runs'
import {
  type ArticleEnrichment,
  api,
  type CaptureSource,
  type EditorialLayout,
  type IllustrationSuggestion,
  type LearningConceptCandidate,
  type LearningRetrievalPrompt,
  type TerminologyEntry,
  type TransformerBlockView,
} from '@/lib/api'
import {
  type ArticleBlockV2,
  type ArticleV2,
  blockPlainText,
  orderedSections,
  sectionKeyTerms,
} from '@/lib/article-v2'
import { buildCitationIndex } from '@/lib/citations'
import {
  type AiAssistMode,
  buildEditorialPlan,
  type PlannedFigure,
  type StreamItem,
} from '@/lib/editorial-layout'
import { blockLocationLine } from '@/lib/transformer-format'

import 'katex/dist/katex.min.css'
import katex from 'katex'

import './magazine-article.css'

const CAPTURE_LABEL: Record<CaptureSource, string> = {
  PASTE: 'Pasted text',
  URL: 'Web link',
  PDF: 'PDF',
}

const ILLUS_LABEL: Record<IllustrationSuggestion['illustrationType'], string> =
  {
    editorial_cover: 'Plate',
    decorative_section: 'Plate',
    source_based_diagram: 'Fig.',
  }

export interface MagazineArticleProps {
  article: ArticleV2
  /** Transformer article id — needed to fetch rendered illustration bytes. */
  articleId: string
  /** Illustration suggestions; only approved + rendered ones become plates. */
  illustrations?: IllustrationSuggestion[]
  /** AI world-knowledge extras (IPA, etymology, key facts). NOT source-grounded —
   *  every surfaced field carries a visible "not from your source" marker. */
  enrichment?: ArticleEnrichment | null
  /** Generative editorial furniture (kicker, standfirst, sub-heads, pull-quote,
   *  stat band, marginal notes, figure placements). Null on older articles; the
   *  layout engine derives a full Compendium layout deterministically without it. */
  editorialLayout?: EditorialLayout | null
  /** The article's PINNED-version source blocks (DET-318) — the excerpts behind
   *  the citation markers. Absent ⇒ markers still number, popovers degrade. */
  sourceBlocks?: TransformerBlockView[]
  /** Deep-link a citation to its source block (the Inspector's block list). */
  onOpenSource?: (sourceBlockId: string) => void
  /** Source-grounded term definitions (DET-319) → typeset definition cards. */
  terminology?: TerminologyEntry[] | null
  /** Per-section concept candidates (DET-283/319) → key-concept devices. */
  conceptCandidates?: LearningConceptCandidate[] | null
  /** "Save as Concept" on a key-concept device — the existing idempotent
   *  validate flow (DET-283). Absent ⇒ the device renders without the action. */
  onValidateCandidate?: (candidate: LearningConceptCandidate) => void
  /** Typed retrieval prompts (DET-321) → at most one inline prompt per section,
   *  its source-passage answer hidden until the learner attempts it. */
  retrievalPrompts?: LearningRetrievalPrompt[] | null
  /** Fired ONCE when the learner reveals a prompt's source passage — becomes a
   *  `retrieval_prompt_attempted` learning event upstream. */
  onPromptAttempt?: (prompt: LearningRetrievalPrompt) => void
  /** Strict vs Enhanced (DET-323): 'strict' suppresses every ✦ AI-marked
   *  surface (enrichment, AI plates, ungrounded furniture, key-concept
   *  devices) at render time. Default 'enhanced'. */
  aiAssistMode?: AiAssistMode
  /** Fidelity status for the folio (DET-324): the article's gate result.
   *  `blocked` ⇒ the loud held-by-fidelity variant; `score` may be null on
   *  old articles (the line then omits the number). Absent ⇒ no status line. */
  fidelity?: { score: number | null; blocked: boolean } | null
  /** Opens the pipeline Inspector — the BLOCKED folio chip's escalation. */
  onInspectFidelity?: () => void
  provenance?: {
    sourceUrl?: string | null
    captureSource?: CaptureSource | null
  }
}

/**
 * Citation plumbing (DET-318): the index is built once from the article's own
 * `source_span_ids` (never fabricated) and handed down by context so the deep
 * block renderer can place superscript markers without prop-drilling. The
 * popover excerpt resolves against the pinned-version source blocks.
 */
interface CitationContextValue {
  numbersByBlockId: Map<string, number[]>
  orderedSourceIds: string[]
  sourceById: Map<string, TransformerBlockView>
  onOpenSource?: (sourceBlockId: string) => void
}

const CitationContext = createContext<CitationContextValue | null>(null)

/**
 * The Compendium render (DET-318) — a generated article presented as a
 * two-column, infobox-railed encyclopedia entry in the editorial-manuscript
 * brand. This is a *presentation* of the existing Article JSON v2: it maps the
 * blocks we already have onto the magazine vocabulary (headword, drop-cap lead,
 * § section bars, pull-quotes, marginalia, figure plates) and derives the rail
 * (contents, key-facts, see-also) from what the article carries. Encyclopedia
 * extras the schema doesn't model yet (IPA, etymology) are simply absent — the
 * layout reads cleanly without them, and the generator can fill them later.
 */
export function MagazineArticle({
  article,
  articleId,
  illustrations = [],
  enrichment,
  editorialLayout,
  sourceBlocks = [],
  onOpenSource,
  terminology,
  conceptCandidates,
  onValidateCandidate,
  retrievalPrompts,
  onPromptAttempt,
  aiAssistMode = 'enhanced',
  fidelity,
  onInspectFidelity,
  provenance,
}: MagazineArticleProps) {
  // Strict mode (DET-323): the plan drops AI furniture below; the enrichment
  // header surfaces (IPA/etymology/key facts) are gated here the same way.
  const showEnrichment = aiAssistMode !== 'strict' ? enrichment : null
  // The deterministic layout engine resolves the article + its editorial lanes
  // into a render-ready plan (DET-318): figures placed after each section's
  // opening paragraphs (never front-loaded), in-column vs span sized by type,
  // sequential figure numbers + (Fig. N) refs, two-part captions, and the
  // rhythm devices (drop-cap lead, one stat band, one pull-quote, marginalia)
  // spread to hit the cadence. The renderer below maps the plan 1:1 onto the
  // magazine vocabulary — all placement logic lives in the pure engine.
  const plan = useMemo(
    () =>
      buildEditorialPlan({
        article,
        illustrations,
        enrichment,
        editorialLayout,
        terminology,
        conceptCandidates,
        retrievalPrompts,
        aiAssistMode,
      }),
    [
      article,
      illustrations,
      enrichment,
      editorialLayout,
      terminology,
      conceptCandidates,
      retrievalPrompts,
      aiAssistMode,
    ],
  )

  // The stream sections (the abstract lede is lifted above the columns by the
  // plan; everything in `plan.sections` flows in the two-column body).
  const allSections = useMemo(() => orderedSections(article), [article])
  const sections = useMemo(() => {
    const inStream = new Set(plan.sections.map((s) => s.sectionId))
    return allSections.filter((s) => inStream.has(s.section_id))
  }, [allSections, plan.sections])

  const stats = useMemo(() => {
    let words = 0
    const terms = new Set<string>()
    for (const sec of sections) {
      for (const b of sec.blocks) {
        words += blockPlainText(b).split(/\s+/).filter(Boolean).length
      }
      for (const t of sectionKeyTerms(sec)) terms.add(t.term)
    }
    return {
      words,
      readMin: Math.max(1, Math.round(words / 220)),
      sectionCount: sections.length,
      terms: [...terms],
    }
  }, [sections])

  // The citation layer (DET-318): one number per distinct cited source block,
  // assigned in reading order; the popovers resolve excerpts against the
  // article's pinned-version blocks.
  const citations = useMemo<CitationContextValue>(() => {
    // Definition cards (DET-319) carry their own provenance — register them as
    // extra anchors so their markers resolve like any prose citation.
    const extras = plan.sections.flatMap((s) =>
      s.items.flatMap((item) =>
        item.kind === 'definition'
          ? [{ id: item.id, sourceIds: item.sourceIds }]
          : [],
      ),
    )
    const index = buildCitationIndex(article, extras)
    return {
      numbersByBlockId: index.numbersByBlockId,
      orderedSourceIds: index.orderedSourceIds,
      sourceById: new Map(sourceBlocks.map((b) => [b.id, b])),
      onOpenSource,
    }
  }, [article, plan.sections, sourceBlocks, onOpenSource])

  const host = hostOf(provenance?.sourceUrl ?? null)
  // `generated_at` can be absent/empty on older or adapted articles — never show
  // "Invalid Date"; omit the date (byline + infobox) when it doesn't parse.
  const generatedAt = new Date(article.generated_at)
  const date = Number.isNaN(generatedAt.getTime())
    ? null
    : generatedAt.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
  const captureLabel = provenance?.captureSource
    ? CAPTURE_LABEL[provenance.captureSource]
    : null

  return (
    <CitationContext.Provider value={citations}>
      <article className='kb-mag'>
        <ReadingProgress />

        <header className='kb-mag-head'>
          <div className='kb-mag-kicker'>
            {plan.kicker}
            {plan.kickerAi && <AiMark short />}
          </div>
          <h1 className='kb-mag-term'>{article.title}</h1>
          {(showEnrichment?.pronunciation || showEnrichment?.partOfSpeech) && (
            <div className='kb-mag-pronounce'>
              {showEnrichment.pronunciation && (
                <span className='ipa'>{showEnrichment.pronunciation}</span>
              )}
              {showEnrichment.partOfSpeech && (
                <span className='pos'>{showEnrichment.partOfSpeech}</span>
              )}
              <AiMark />
            </div>
          )}
          {showEnrichment?.etymology && (
            <p className='kb-mag-etym'>
              {showEnrichment.etymology} <AiMark />
            </p>
          )}
          <div className='kb-mag-byline'>
            <span className='author'>The Compendium</span>
            {host && (
              <>
                <span className='sep'>/</span>
                <a
                  className='cat'
                  href={provenance?.sourceUrl ?? undefined}
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  {host}
                </a>
              </>
            )}
            {date && (
              <>
                <span className='sep'>/</span>
                <span>{date}</span>
              </>
            )}
          </div>
        </header>

        <div className='kb-mag-folio'>
          <span className='ox'>Compendium</span>
          <span>
            {stats.sectionCount} section{stats.sectionCount === 1 ? '' : 's'}
          </span>
          <span>{stats.words.toLocaleString()} words</span>
          <span>{stats.readMin} min read</span>
          {/* Model-judged difficulty (DET-324) — AI lane, so it carries the mark. */}
          {showEnrichment?.difficulty && (
            <span className='diff'>
              {showEnrichment.difficulty} <AiMark short />
            </span>
          )}
          {/* Fidelity status (DET-324): the gate result, loud when BLOCKED —
              the chip escalates straight into the pipeline Inspector. */}
          {fidelity &&
            (fidelity.blocked ? (
              <button
                type='button'
                className='fid is-blocked'
                onClick={onInspectFidelity}
              >
                ⚠ Held by fidelity{onInspectFidelity ? ' — inspect' : ''}
              </button>
            ) : (
              <span className='fid'>
                Fidelity
                {fidelity.score != null ? ` ${fidelity.score}` : ' checked'}
              </span>
            ))}
          <span className='grow'>Source-grounded · earn what you keep</span>
        </div>

        {/* The faithful, source-grounded abstract lede (when present) sits full-
          width above the columns. A thin source has no abstract — the engine
          then supplies a generative standfirst, marked "not from your source". */}
        {plan.ledeParagraphs.length > 0 ? (
          <div className='kb-mag-lede'>
            {plan.ledeParagraphs.map((p) => (
              <p key={p.blockId} id={p.blockId}>
                <InlineRuns runs={p.runs} />
                <CiteMarks blockId={p.blockId} />
              </p>
            ))}
          </div>
        ) : plan.standfirst ? (
          <div className='kb-mag-lede'>
            <p>
              {plan.standfirst.text}
              {plan.standfirst.ai && <AiMark />}
            </p>
          </div>
        ) : null}

        <div className='kb-mag-layout'>
          <div className='kb-mag-stream'>
            {/* Rendered from the deterministic editorial plan: each section is a
              § bar followed by its ORDERED stream items (blocks, figures placed
              after the opening paragraphs, and the spread rhythm devices). No
              front-loading — figures live inside their section. */}
            {plan.sections.map((section) => (
              <Fragment key={section.sectionId}>
                <div className='kb-mag-sec' id={section.sectionId}>
                  <span className='num'>§ {pad(section.index)}</span>
                  <h2>{section.heading}</h2>
                </div>
                {section.items.map((item, i) => (
                  <StreamItemView
                    // biome-ignore lint/suspicious/noArrayIndexKey: device items have no id
                    key={itemKey(item, i)}
                    item={item}
                    articleId={articleId}
                    onValidateCandidate={onValidateCandidate}
                    onPromptAttempt={onPromptAttempt}
                  />
                ))}
              </Fragment>
            ))}
          </div>

          <aside className='kb-mag-rail'>
            <div className='kb-mag-infobox'>
              <div className='ib-head'>
                <div className='t'>{article.title}</div>
                <div className='s'>Compendium entry</div>
              </div>
              <div className='ib-sec'>Key facts</div>
              <dl>
                <InfoRow label='Sections' value={String(stats.sectionCount)} />
                {stats.terms.length > 0 && (
                  <InfoRow
                    label='Key terms'
                    value={String(stats.terms.length)}
                  />
                )}
                <InfoRow
                  label='Length'
                  value={`${stats.words.toLocaleString()} words`}
                />
                <InfoRow label='Reading' value={`${stats.readMin} min`} />
                {captureLabel && (
                  <InfoRow label='Source' value={captureLabel} />
                )}
                {host && <InfoRow label='Origin' value={host} />}
                {date && <InfoRow label='Compiled' value={date} />}
              </dl>
              {showEnrichment?.keyFacts &&
                showEnrichment.keyFacts.length > 0 && (
                  <>
                    <div className='ib-sec'>
                      Key facts <AiMark short />
                    </div>
                    <dl>
                      {showEnrichment.keyFacts.map((f) => (
                        <InfoRow
                          key={`${f.label}:${f.value}`}
                          label={f.label}
                          value={f.value}
                        />
                      ))}
                    </dl>
                  </>
                )}
            </div>

            {sections.length > 1 && (
              <nav className='kb-mag-toc' aria-label='Contents'>
                <div className='th'>Contents</div>
                <ol>
                  {sections.map((s, i) => (
                    <li key={s.section_id}>
                      <a href={`#${s.section_id}`}>
                        <span className='rn'>{pad(i + 1)}</span>
                        <span>{s.heading}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            )}

            {stats.terms.length > 0 && (
              <div className='kb-mag-seealso'>
                <div className='th'>See also</div>
                <div className='chips'>
                  {stats.terms.slice(0, 10).map((t) => (
                    <span key={t} className='chip'>
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Sources (DET-318): the article's bibliography-of-one. Honest about what
          is known — host/capture/date come from real provenance, and the count
          reflects only passages the article actually cites. */}
        {(citations.orderedSourceIds.length > 0 || host || captureLabel) && (
          <div className='kb-mag-sources'>
            <div className='th'>Sources</div>
            <ol>
              <li>
                {host ? (
                  <a
                    href={provenance?.sourceUrl ?? undefined}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    {host}
                  </a>
                ) : (
                  <span>{captureLabel ?? 'Imported source'}</span>
                )}
                {host && captureLabel && <span className='sep'>·</span>}
                {host && captureLabel && <span>{captureLabel}</span>}
                {date && <span className='sep'>·</span>}
                {date && <span>imported {date}</span>}
                {citations.orderedSourceIds.length > 0 && (
                  <>
                    <span className='sep'>·</span>
                    <span>
                      {citations.orderedSourceIds.length} passage
                      {citations.orderedSourceIds.length === 1 ? '' : 's'} cited
                    </span>
                  </>
                )}
              </li>
            </ol>
          </div>
        )}

        <div className='kb-mag-colophon'>
          <p>
            Compiled by the Kibadist Compendium from your source. The article is
            a worked example to read — <em>you earn the knowledge</em> by
            recalling and explaining it in the Exercise tab.
          </p>
          <div className='foot'>
            <span>Kibadist Compendium</span>
            <span>Source-grounded · light-only</span>
          </div>
        </div>
      </article>
    </CitationContext.Provider>
  )
}

/**
 * The superscript citation marks for one article block (DET-318). Renders
 * nothing when the block carries no provenance — citations are never invented.
 * Clicking a mark opens a popover with the exact source passage (from the
 * article's pinned-version blocks) and an "Open in Source" deep-link.
 */
function CiteMarks({ blockId }: { blockId: string }) {
  const ctx = useContext(CitationContext)
  const [open, setOpen] = useState<number | null>(null)
  if (!ctx) return null
  const numbers = ctx.numbersByBlockId.get(blockId)
  if (!numbers || numbers.length === 0) return null
  return (
    <span className='kb-mag-cites'>
      {numbers.map((n) => {
        const sourceId = ctx.orderedSourceIds[n - 1]
        const source = ctx.sourceById.get(sourceId)
        const isOpen = open === n
        return (
          <span key={n} className='kb-mag-cite'>
            <button
              type='button'
              aria-expanded={isOpen}
              aria-label={`Citation ${n} — show source passage`}
              onClick={() => setOpen(isOpen ? null : n)}
            >
              {n}
            </button>
            {isOpen && (
              <span className='kb-mag-cite-pop' role='dialog'>
                <span className='ch'>
                  Source passage · [{n}]
                  {source && blockLocationLine(source) && (
                    <span className='loc'>{blockLocationLine(source)}</span>
                  )}
                </span>
                <span className='cx'>
                  {source
                    ? source.text
                    : 'Original passage unavailable at this version.'}
                </span>
                {ctx.onOpenSource && (
                  <button
                    type='button'
                    className='co'
                    onClick={() => ctx.onOpenSource?.(sourceId)}
                  >
                    Open in Source →
                  </button>
                )}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** The honesty marker for AI world-knowledge that is NOT grounded in the user's
 *  source — a hard product requirement wherever enrichment appears. `short` is
 *  the compact "✦ AI" used where space is tight (e.g. the infobox header). */
function AiMark({ short }: { short?: boolean }) {
  return (
    <span className='kb-mag-aimark'>
      {short ? '✦ AI' : '✦ AI · not from your source'}
    </span>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='row'>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/** Render one planned stream item onto the magazine vocabulary. The plan has
 *  already decided placement, sizing, and the rhythm devices — this is a pure
 *  1:1 mapping. */
function StreamItemView({
  item,
  articleId,
  onValidateCandidate,
  onPromptAttempt,
}: {
  item: StreamItem
  articleId: string
  onValidateCandidate?: (candidate: LearningConceptCandidate) => void
  onPromptAttempt?: (prompt: LearningRetrievalPrompt) => void
}) {
  switch (item.kind) {
    case 'learningPrompt':
      return (
        <LearningPromptCard prompt={item.prompt} onAttempt={onPromptAttempt} />
      )
    case 'definition':
      // A source-grounded definition card (DET-319): term, definition, and the
      // same citation markers prose carries — its provenance is registered as
      // an extra anchor in the citation index.
      return (
        <div className='kb-mag-defcard'>
          <span className='dh'>Definition</span>
          <span className='dt'>{item.term}</span>
          <span className='dx'>
            {item.definition}
            <CiteMarks blockId={item.id} />
          </span>
        </div>
      )
    case 'keyConcept': {
      const c = item.candidate
      const validated = c.validationStatus === 'validated'
      return (
        <div className='kb-mag-concept'>
          <span className='ch'>
            Key concept <AiMark short />
          </span>
          <span className='ct'>{c.label}</span>
          <span className='cx'>{c.definition}</span>
          {validated ? (
            <span className='cs'>✓ In your concepts</span>
          ) : (
            onValidateCandidate && (
              <button
                type='button'
                className='ca'
                onClick={() => onValidateCandidate(c)}
              >
                Save as Concept →
              </button>
            )
          )}
        </div>
      )
    }
    case 'block':
      return (
        <MagazineBlock
          block={item.block}
          isLead={item.isLead ?? false}
          figureRef={item.figureRef}
        />
      )
    case 'figure':
      return <IllustrationPlate articleId={articleId} figure={item.figure} />
    case 'subhead':
      // An inline sub-head break for long sections (cadence rule).
      return <h3>{item.text}</h3>
    case 'statband':
      return (
        <div
          className='kb-mag-statband'
          style={{ '--cols': item.stats.length } as React.CSSProperties}
        >
          {item.stats.map((s) => (
            <div className='s' key={`${s.figure}:${s.label}`}>
              <div className='n'>{s.figure}</div>
              <div className='d'>
                {s.label}
                {item.ai && <AiMark short />}
              </div>
            </div>
          ))}
        </div>
      )
    case 'pullquote':
      return (
        <blockquote className='kb-mag-pull'>
          <p>{item.text}</p>
          {(item.attribution || item.ai) && (
            <div className='attrib'>
              {item.attribution}
              {item.ai && <AiMark short />}
            </div>
          )}
        </blockquote>
      )
    case 'marginal':
      return (
        <div className='kb-mag-marginal'>
          <span className='mh'>
            {item.title}
            {item.ai && <AiMark short />}
          </span>
          {item.text}
        </div>
      )
  }
}

/** A stable-ish key for a stream item: block id when present, else kind+index. */
function itemKey(item: StreamItem, i: number): string {
  if (item.kind === 'block') return item.block.block_id
  if (item.kind === 'figure') return `fig-${item.figure.suggestion.id}`
  if (item.kind === 'definition') return item.id
  if (item.kind === 'keyConcept') return `kc-${item.candidate.id}`
  if (item.kind === 'learningPrompt') return `lp-${item.prompt.id}`
  return `${item.kind}-${i}`
}

const PROMPT_TYPE_LABEL: Record<string, string> = {
  recall: 'Recall',
  prediction: 'Predict',
  contrast: 'Contrast',
  self_explanation: 'Explain it yourself',
  misconception_check: 'Misconception check',
}

/**
 * An inline retrieval prompt (DET-321): the typed self-test question after a
 * section's prose. The answer is the cited SOURCE PASSAGE — hidden until the
 * learner attempts the question; the first reveal fires `onAttempt` once
 * (recorded upstream as a `retrieval_prompt_attempted` learning event). Answer
 * in your head, then check — nothing here is saved as knowledge (DET-315).
 */
function LearningPromptCard({
  prompt,
  onAttempt,
}: {
  prompt: LearningRetrievalPrompt
  onAttempt?: (prompt: LearningRetrievalPrompt) => void
}) {
  const ctx = useContext(CitationContext)
  const [revealed, setRevealed] = useState(false)
  const typeLabel = prompt.promptType
    ? (PROMPT_TYPE_LABEL[prompt.promptType] ?? 'Self-test')
    : 'Self-test'
  const passages = prompt.sourceBlockIds
    .map((id) => ctx?.sourceById.get(id))
    .filter((b): b is TransformerBlockView => Boolean(b))

  const reveal = () => {
    if (!revealed) {
      setRevealed(true)
      onAttempt?.(prompt)
    }
  }

  return (
    <div className='kb-mag-prompt'>
      <span className='ph'>
        {typeLabel}
        {prompt.difficulty && <span className='pd'>· {prompt.difficulty}</span>}
      </span>
      <span className='pq'>{prompt.prompt}</span>
      {revealed ? (
        <span className='pa'>
          {passages.length > 0 ? (
            passages.map((p) => (
              <span key={p.id} className='px'>
                {p.text}
              </span>
            ))
          ) : (
            <span className='px'>
              The answer lives in the Source tab — this passage isn’t available
              at this version.
            </span>
          )}
        </span>
      ) : (
        <button type='button' className='pc' onClick={reveal}>
          Answer in your head, then check the source →
        </button>
      )}
    </div>
  )
}

/** One Article-JSON-v2 block in the magazine vocabulary. */
function MagazineBlock({
  block,
  isLead,
  figureRef,
}: {
  block: ArticleBlockV2
  isLead: boolean
  /** Figure number to bind as a trailing `(Fig. N)` reference (figure↔prose). */
  figureRef?: number
}) {
  switch (block.type) {
    case 'paragraph':
      return (
        <p className={isLead ? 'kb-mag-lead' : undefined} id={block.block_id}>
          <InlineRuns runs={block.content.runs} />
          {figureRef !== undefined && (
            <span className='kb-mag-figref'> (Fig. {figureRef})</span>
          )}
          <CiteMarks blockId={block.block_id} />
        </p>
      )
    case 'heading':
      // Section titles come from `section.heading` (§ bars); heading blocks are
      // in-column sub-heads.
      return (
        <h3 id={block.block_id}>
          <InlineRuns runs={block.content.runs} />
        </h3>
      )
    case 'list': {
      const items = block.content.items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: list items have no id
        <li key={i}>
          <InlineRuns runs={item} />
        </li>
      ))
      return block.content.ordered ? (
        <ol id={block.block_id}>{items}</ol>
      ) : (
        <ul id={block.block_id}>{items}</ul>
      )
    }
    case 'quote':
      // A quote becomes the pull-quote — the magazine's spanning display device.
      return (
        <blockquote className='kb-mag-pull' id={block.block_id}>
          <p>
            <InlineRuns runs={block.content.runs} />
          </p>
          {block.content.attribution && (
            <div className='attrib'>{block.content.attribution}</div>
          )}
        </blockquote>
      )
    case 'callout':
      // An aside becomes a marginal note (the mono side-note).
      return (
        <div className='kb-mag-marginal' id={block.block_id}>
          <span className='mh'>
            {block.content.title ?? block.content.variant ?? 'Note'}
          </span>
          <InlineRuns runs={block.content.runs} />
        </div>
      )
    case 'table': {
      const rows = block.content.rows
      if (rows.length === 0) return null
      const [head, ...body] = block.content.header ? rows : [null, ...rows]
      return (
        <table id={block.block_id}>
          {head && (
            <thead>
              <tr>
                {head.map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {body.map((row, ri) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id
              <tr key={ri}>
                {(row ?? []).map((c, ci) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: cells have no id
                  <td key={ci}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
    case 'code':
      return (
        <pre id={block.block_id}>
          <code>{block.content.text}</code>
        </pre>
      )
    case 'equation':
      // A display equation (DET-322): typeset, never split across columns. A
      // LaTeX parse failure falls back to the raw notation — honest, readable.
      return <EquationView block={block} />
    case 'image':
      return (
        <figure className='kb-mag-plate' id={block.block_id}>
          <div className='frame'>
            <span className='figtag'>Plate</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={block.content.src} alt={block.content.alt ?? ''} />
          </div>
          {block.content.caption && (
            <figcaption>{block.content.caption}</figcaption>
          )}
        </figure>
      )
    case 'divider':
      return null
  }
}

/** A planned figure as a captioned plate (authed blob fetch). The plan decides
 *  size (`span` hero vs in-column `Fig.`), figure number, and the two-part
 *  teaching caption; this component only fetches the bytes and renders. */
function IllustrationPlate({
  articleId,
  figure,
}: {
  articleId: string
  figure: PlannedFigure
}) {
  const { suggestion, size, figureNumber, caption } = figure
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const generatedAt = suggestion.image?.generatedAt

  useEffect(() => {
    let url: string | null = null
    let active = true
    setSrc(null)
    setFailed(false)
    api
      .getIllustrationImageBlob(articleId, suggestion.id)
      .then((blob) => {
        if (!active) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [articleId, suggestion.id, generatedAt])

  // The figtag is the in-prose handle: a span hero reads "Plate", an in-column
  // diagram reads "Fig. N" so the (Fig. N) prose ref resolves to it.
  const figtag =
    size === 'column'
      ? `${ILLUS_LABEL[suggestion.illustrationType]} ${figureNumber}`
      : ILLUS_LABEL[suggestion.illustrationType]

  return (
    <figure className={`kb-mag-plate${size === 'span' ? ' is-span' : ''}`}>
      <div className='frame'>
        <span className='figtag'>{figtag}</span>
        {failed ? (
          <div className='ph'>Illustration unavailable</div>
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={suggestion.caption} />
        ) : (
          <div className='ph'>Rendering…</div>
        )}
      </div>
      {(caption.takeaway || caption.detail) && (
        <figcaption>
          {figure.ai && <span className='aichip'>✦ AI</span>}
          {caption.takeaway && <b>{caption.takeaway}.</b>}
          {caption.detail && ` ${caption.detail}`}
        </figcaption>
      )}
    </figure>
  )
}

/**
 * A typeset display equation (DET-322). KaTeX renders the source's own LaTeX
 * (its output markup is generated from the math, safe to inject); a parse
 * failure degrades to the raw notation in a code frame rather than hiding the
 * math or pretending it rendered.
 */
function EquationView({
  block,
}: {
  block: Extract<ArticleBlockV2, { type: 'equation' }>
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(block.content.latex, {
        displayMode: true,
        throwOnError: true,
      })
    } catch {
      return null
    }
  }, [block.content.latex])
  if (html === null) {
    return (
      <pre className='kb-mag-eq-raw' id={block.block_id}>
        <code>{block.content.latex}</code>
      </pre>
    )
  }
  return (
    <div
      className='kb-mag-eq'
      id={block.block_id}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: KaTeX output is generated from the LaTeX, not user HTML
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

/** Reading-progress hairline driven by window scroll. */
function ReadingProgress() {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <div className='kb-mag-progress' style={{ width: `${pct}%` }} aria-hidden />
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
