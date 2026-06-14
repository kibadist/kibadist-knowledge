'use client'

import { useState } from 'react'

import {
  type ArticleBlockerReason,
  type ArticleCalloutTypeV3,
  type ArticleCalloutV3,
  type ArticleJsonV3,
  type ArticleParagraphV3,
  type ArticleSectionV3,
  type ArticleShapeV3,
  type ArticleStatusV3,
  type ArticleTableV3,
  type ClaimCandidateV3,
  type ConceptCandidateV3,
  isAiScaffolding,
  isBlockedStatusV3,
  type MisconceptionCandidateV3,
  type RetrievalPromptV3,
  type SectionRoleV3,
  type SourceKind,
  type SourceNoteV3,
  type TerminologyItemV3,
  v3ReadingMinutes,
} from '@/lib/article-v3'

import './article-v3-view.css'

/**
 * The Article JSON v3 reader (DET-357) — a learning-first surface that renders a
 * source-grounded learning article as a polished educational page rather than a
 * raw converted document. It is dispatched from the read workspace whenever the
 * resolved article's `schemaVersion === 'v3'`; v2 articles keep rendering through
 * the legacy Compendium (`MagazineArticle`) unchanged.
 *
 * Layout (top → bottom):
 *  - status banner: READY_FOR_REVIEW (quiet) vs a loud BLOCKED state with its
 *    blocker reasons + regeneration hints (DET-355).
 *  - hero: source-kind badge + shape, title, dek, reading-time/provenance byline.
 *  - learning path ("what you'll learn", DET-348).
 *  - abstract + main sections, with inline source-grounded callouts and tables
 *    placed beside the section they belong to. AI scaffolding (ungrounded or
 *    flagged) is rendered visually distinct (indigo) from source-grounded claims.
 *  - learning panels: key concepts, retrieval prompts, misconception warnings,
 *    key claims, terminology — all VISIBLE for review but never auto-accepted.
 *  - drawers: Source notes (references/bibliography/links live here, NOT in the
 *    body) and a Quality report / debug panel (DET-354).
 *
 * Provenance inspection is the dedicated DET-358 follow-up; here every
 * source-grounded fragment exposes a quiet "source ¶ (N)" affordance that calls
 * the optional `onInspect` callback (a no-op by default) so this reader stays
 * self-contained and testable without the inspector wired in.
 */

export interface ArticleV3InspectSelection {
  kind: string
  text: string
  sourceBlockIds: string[]
}

export function ArticleV3View({
  article,
  /** Lifecycle status — the v3 status preferred, falling back to the JSON's own. */
  status,
  onInspect,
  reviewSlot,
}: {
  article: ArticleJsonV3
  status?: ArticleStatusV3
  onInspect?: (selection: ArticleV3InspectSelection) => void
  /**
   * The interactive learning-review surface (DET-359). When supplied, it REPLACES
   * the read-only key-concepts + retrieval-prompts panels — the reader vets the
   * same suggestions here (accept / reject / edit; answer / save / reject / edit)
   * instead of only seeing them. Omitted (tests / the standalone demo), the
   * read-only panels render as before.
   */
  reviewSlot?: React.ReactNode
}) {
  const effectiveStatus = status ?? article.status
  const inspect = onInspect ?? (() => {})
  const minutes = v3ReadingMinutes(article)

  // Callouts + tables are placed beside the section they relate to. The top-level
  // arrays stay the source of truth; here we only index them for inline render.
  const calloutsBySection = article.calloutPlacements?.bySection ?? {}
  const unplacedCallouts = article.calloutPlacements?.unplaced ?? []
  const tablesBySection = groupTablesBySection(article.tables ?? [])

  return (
    <article className='av3' aria-label='Generated learning article'>
      <StatusBanner
        status={effectiveStatus}
        blockerReasons={article.qualityReport?.blockerReasons ?? []}
        regenerationHints={article.qualityReport?.regenerationHints ?? []}
      />

      {/* ---- Hero ---- */}
      <header className='av3-hero'>
        <div className='av3-eyebrow'>
          <span className='chip av3-kind chip-info'>
            {SOURCE_KIND_LABEL[article.sourceKind]}
          </span>
          <span className='av3-shape'>{SHAPE_LABEL[article.shape]}</span>
        </div>
        <h1 className='av3-title'>{article.title.text}</h1>
        {article.dek && <p className='av3-dek'>{article.dek}</p>}
        <ProvenanceByline article={article} minutes={minutes} />
      </header>

      {article.abstract.length > 0 && (
        <section className='av3-abstract'>
          {article.abstract.map((p, i) => (
            <Paragraph
              key={p.id}
              paragraph={p}
              kind='Abstract'
              lede={i === 0}
              onInspect={inspect}
            />
          ))}
        </section>
      )}

      {article.learningPath.length > 0 && (
        <LearningPath items={article.learningPath} />
      )}

      {/* ---- Main body ---- */}
      <div className='av3-body'>
        {article.sections.map((section) => (
          <Section
            key={section.id}
            section={section}
            callouts={calloutsBySection[section.id] ?? []}
            tables={tablesBySection.get(section.id) ?? []}
            onInspect={inspect}
          />
        ))}
      </div>

      {unplacedCallouts.length > 0 && (
        <section className='av3-unplaced' aria-label='Additional notes'>
          <h2 className='av3-panel-h'>Notes</h2>
          <div className='av3-callout-stack'>
            {unplacedCallouts.map((c) => (
              <Callout key={c.id} callout={c} onInspect={inspect} />
            ))}
          </div>
        </section>
      )}

      {/* ---- Learning panels (review surface, nothing auto-accepted) ---- */}
      <div className='av3-panels'>
        {/* When the host wires the DET-359 review surface, it REPLACES the two
            read-only panels: the reader acts on the same concepts/prompts here
            (accept/reject/edit; answer/save/reject/edit) rather than only seeing
            them. Without it (tests / demo), the read-only panels render. */}
        {reviewSlot ? (
          reviewSlot
        ) : (
          <>
            {article.keyConcepts.length > 0 && (
              <KeyConceptsPanel
                concepts={article.keyConcepts}
                onInspect={inspect}
              />
            )}
            {article.retrievalPrompts.length > 0 && (
              <RetrievalPromptsPanel
                prompts={article.retrievalPrompts}
                onInspect={inspect}
              />
            )}
          </>
        )}
        {article.misconceptionWarnings.length > 0 && (
          <MisconceptionsPanel
            misconceptions={article.misconceptionWarnings}
            onInspect={inspect}
          />
        )}
        {article.keyClaims.length > 0 && (
          <KeyClaimsPanel claims={article.keyClaims} onInspect={inspect} />
        )}
        {article.terminology.length > 0 && (
          <TerminologyPanel terms={article.terminology} onInspect={inspect} />
        )}
      </div>

      {/* ---- Drawers ---- */}
      <SourceNotesDrawer
        notes={article.sourceNotes ?? []}
        references={article.references ?? []}
      />
      {article.qualityReport && (
        <QualityReportPanel report={article.qualityReport} />
      )}
    </article>
  )
}

// --- Status banner -----------------------------------------------------------

/**
 * The article-status banner. A blocked/regeneration state is loud: it lists each
 * blocker reason and the actionable regeneration hints (DET-355). A readable
 * state shows a quiet "ready for review" confirmation; FINAL renders nothing
 * (the article speaks for itself).
 */
function StatusBanner({
  status,
  blockerReasons,
  regenerationHints,
}: {
  status: ArticleStatusV3
  blockerReasons: ArticleBlockerReason[]
  regenerationHints: string[]
}) {
  if (isBlockedStatusV3(status)) {
    return (
      <section className='av3-status av3-status--blocked' role='alert'>
        <div className='av3-status-head'>
          <span className='chip chip-contested'>{STATUS_LABEL[status]}</span>
          <p className='av3-status-title'>
            This article is held back from review.
          </p>
        </div>
        {blockerReasons.length > 0 && (
          <>
            <h3 className='av3-status-sub'>Why it's blocked</h3>
            <ul className='av3-blocker-list'>
              {blockerReasons.map((r, i) => (
                <li key={`${r.code}-${i}`} className='av3-blocker'>
                  <span className='chip chip-quiet av3-blocker-code'>
                    {BLOCKER_CODE_LABEL[r.code] ?? r.code}
                  </span>
                  <span className='av3-blocker-msg'>{r.message}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {regenerationHints.length > 0 && (
          <>
            <h3 className='av3-status-sub'>How to fix it</h3>
            <ul className='av3-hint-list'>
              {regenerationHints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    )
  }

  if (status === 'READY_FOR_REVIEW') {
    return (
      <section className='av3-status av3-status--ready'>
        <span className='chip chip-cleared'>{STATUS_LABEL[status]}</span>
        <span className='av3-status-note'>
          Passed every quality gate — review the concepts and prompts below.
        </span>
      </section>
    )
  }

  // DRAFT / GENERATING / FINAL — no banner; the reader shows the article itself.
  return null
}

// --- Hero byline -------------------------------------------------------------

function ProvenanceByline({
  article,
  minutes,
}: {
  article: ArticleJsonV3
  minutes: number
}) {
  const { provenance } = article
  const host = hostOf(provenance?.sourceUrl ?? null)
  const parts: React.ReactNode[] = []
  if (minutes > 0) parts.push(<span key='time'>{minutes} min read</span>)
  if (
    provenance?.representedSourceBlocks != null &&
    provenance.totalSourceBlocks != null
  ) {
    parts.push(
      <span key='cov'>
        {provenance.representedSourceBlocks}/{provenance.totalSourceBlocks}{' '}
        source blocks
      </span>,
    )
  }
  if (host) {
    parts.push(
      provenance?.sourceUrl ? (
        <a
          key='host'
          href={provenance.sourceUrl}
          target='_blank'
          rel='noopener noreferrer'
        >
          {host}
        </a>
      ) : (
        <span key='host'>{host}</span>
      ),
    )
  }
  if (parts.length === 0) return null
  return (
    <p className='av3-byline'>
      {parts.map((part, i) => (
        <span key={i} className='av3-byline-part'>
          {i > 0 && (
            <span className='av3-byline-dot' aria-hidden='true'>
              ·
            </span>
          )}
          {part}
        </span>
      ))}
    </p>
  )
}

// --- Learning path -----------------------------------------------------------

function LearningPath({ items }: { items: ArticleJsonV3['learningPath'] }) {
  return (
    <section className='av3-path' aria-label='What you will learn'>
      <h2 className='av3-panel-h'>What you'll learn</h2>
      <ol className='av3-path-list'>
        {items.map((item) => (
          <li key={item.id} className='av3-path-item'>
            <span className='av3-path-label'>
              {item.sectionId ? (
                <a href={`#av3-${item.sectionId}`}>{item.label}</a>
              ) : (
                item.label
              )}
            </span>
            {item.outcome && (
              <span className='av3-path-outcome'>{item.outcome}</span>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

// --- Sections + body ---------------------------------------------------------

function Section({
  section,
  callouts,
  tables,
  onInspect,
}: {
  section: ArticleSectionV3
  callouts: ArticleCalloutV3[]
  tables: ArticleTableV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  return (
    <section id={`av3-${section.id}`} className='av3-section'>
      <SectionHeading section={section} level={2} onInspect={onInspect} />
      {section.targetReaderOutcome && (
        <p className='av3-section-outcome'>{section.targetReaderOutcome}</p>
      )}
      {section.paragraphs.map((p) => (
        <Paragraph
          key={p.id}
          paragraph={p}
          kind='Paragraph'
          onInspect={onInspect}
        />
      ))}

      {tables.map((t) => (
        <Table key={t.id} table={t} onInspect={onInspect} />
      ))}

      {callouts.length > 0 && (
        <aside className='av3-callout-rail' aria-label='Section notes'>
          {callouts.map((c) => (
            <Callout key={c.id} callout={c} onInspect={onInspect} />
          ))}
        </aside>
      )}

      {section.subsections?.map((sub) => (
        <section key={sub.id} id={`av3-${sub.id}`} className='av3-subsection'>
          <SectionHeading section={sub} level={3} onInspect={onInspect} />
          {sub.paragraphs.map((p) => (
            <Paragraph
              key={p.id}
              paragraph={p}
              kind='Paragraph'
              onInspect={onInspect}
            />
          ))}
        </section>
      ))}
    </section>
  )
}

function SectionHeading({
  section,
  level,
  onInspect,
}: {
  section: ArticleSectionV3
  level: 2 | 3
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  const Tag = level === 2 ? 'h2' : 'h3'
  const className = level === 2 ? 'av3-h2' : 'av3-h3'
  const role = section.sectionRole
    ? SECTION_ROLE_LABEL[section.sectionRole]
    : null
  const grounded = section.sourceBlockIds.length > 0
  return (
    <div className='av3-heading-row'>
      {grounded ? (
        <Tag className={className}>
          <button
            type='button'
            className='av3-heading-btn'
            onClick={() =>
              onInspect({
                kind: 'Section heading',
                text: section.heading,
                sourceBlockIds: section.sourceBlockIds,
              })
            }
          >
            {section.heading}
          </button>
        </Tag>
      ) : (
        <Tag className={className}>{section.heading}</Tag>
      )}
      {role && <span className='av3-section-role'>{role}</span>}
    </div>
  )
}

/**
 * A body paragraph. A source-grounded paragraph is a clickable button that opens
 * the provenance inspector; AI scaffolding (ungrounded or flagged) is rendered
 * with a distinct indigo treatment and an "AI-assisted" chip so a reader can
 * never mistake it for a source-grounded claim (DET-357 UX requirement).
 */
function Paragraph({
  paragraph,
  kind,
  lede = false,
  onInspect,
}: {
  paragraph: ArticleParagraphV3
  kind: string
  lede?: boolean
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  const ai = isAiScaffolding(paragraph)
  if (ai) {
    return (
      <p
        className={`av3-paragraph av3-paragraph--ai${lede ? ' av3-paragraph--lede' : ''}`}
      >
        {paragraph.text}
        <span className='chip chip-ai av3-ai-chip'>✦ AI-assisted</span>
      </p>
    )
  }
  return (
    <button
      type='button'
      className={`av3-paragraph av3-paragraph--grounded${lede ? ' av3-paragraph--lede' : ''}`}
      onClick={() =>
        onInspect({
          kind,
          text: paragraph.text,
          sourceBlockIds: paragraph.sourceBlockIds,
        })
      }
    >
      {paragraph.text}
      <span className='av3-source-ref' aria-hidden='true'>
        source ¶ ({paragraph.sourceBlockIds.length})
      </span>
    </button>
  )
}

/** A source-grounded callout. AI-assisted ones carry an indigo provenance chip. */
function Callout({
  callout,
  onInspect,
}: {
  callout: ArticleCalloutV3
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  const ai = isAiScaffolding(callout)
  const label = CALLOUT_TYPE_LABEL[callout.type] ?? callout.type
  const grounded = callout.sourceBlockIds.length > 0
  const body = (
    <>
      <p className={`av3-callout-kind av3-callout-kind--${callout.type}`}>
        {label}
        {ai && <span className='chip chip-ai av3-ai-chip'>✦ AI-assisted</span>}
      </p>
      {callout.title && <p className='av3-callout-title'>{callout.title}</p>}
      <p className='av3-callout-body'>{callout.body}</p>
    </>
  )
  if (!grounded) {
    return <div className='av3-callout av3-callout--ai'>{body}</div>
  }
  return (
    <button
      type='button'
      className='av3-callout av3-callout--clickable'
      onClick={() =>
        onInspect({
          kind: `Callout: ${label}`,
          text: callout.title
            ? `${callout.title}: ${callout.body}`
            : callout.body,
          sourceBlockIds: callout.sourceBlockIds,
        })
      }
    >
      {body}
    </button>
  )
}

/** A source-grounded comparison table (DET-350). */
function Table({
  table,
  onInspect,
}: {
  table: ArticleTableV3
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  const flat = [
    table.title,
    table.columns.join(' | '),
    ...table.rows.map((r) => r.join(' | ')),
  ]
    .filter(Boolean)
    .join('\n')
  const grounded = table.sourceBlockIds.length > 0
  const figure = (
    <figure className='av3-table-wrap'>
      {table.title && (
        <figcaption className='av3-table-title'>{table.title}</figcaption>
      )}
      <table className='av3-table'>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={`${i}-${c}`}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={`r-${ri}-${row[0] ?? ''}`}>
              {row.map((cell, ci) => (
                <td key={`c-${ri}-${ci}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
  if (!grounded) return <div className='av3-table-block'>{figure}</div>
  return (
    <button
      type='button'
      className='av3-table-block av3-table-block--clickable'
      onClick={() =>
        onInspect({
          kind: 'Table',
          text: flat,
          sourceBlockIds: table.sourceBlockIds,
        })
      }
    >
      {figure}
    </button>
  )
}

// --- Learning panels ---------------------------------------------------------

/**
 * The key-concepts review panel (DET-351/359). Every concept is an AI-suggested
 * PROPOSAL — the panel makes that explicit ("not yet accepted") and never
 * promotes a concept to permanent knowledge; acceptance is the dedicated DET-359
 * review workflow. Concepts are ordered high → low importance.
 */
function KeyConceptsPanel({
  concepts,
  onInspect,
}: {
  concepts: ConceptCandidateV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  const ordered = [...concepts].sort(
    (a, b) => IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance],
  )
  return (
    <section className='av3-panel' aria-label='Key concepts'>
      <div className='av3-panel-head'>
        <h2 className='av3-panel-h'>Key concepts</h2>
        <span className='chip chip-ai'>✦ AI-suggested · not yet accepted</span>
      </div>
      <ul className='av3-concept-list'>
        {ordered.map((c) => (
          <li key={c.id} className='av3-concept'>
            <div className='av3-concept-top'>
              <span className='av3-concept-name'>{c.name}</span>
              <span className={`chip av3-imp av3-imp--${c.importance}`}>
                {c.importance}
              </span>
              <span className='chip chip-quiet'>
                {CONCEPT_TYPE_LABEL[c.type] ?? c.type}
              </span>
            </div>
            {c.shortDefinition && (
              <p className='av3-concept-def'>{c.shortDefinition}</p>
            )}
            <div className='av3-concept-foot'>
              <span className='av3-concept-state'>
                suggested state: {c.suggestedCognitiveState}
              </span>
              {c.sourceBlockIds.length > 0 && (
                <button
                  type='button'
                  className='av3-source-btn'
                  onClick={() =>
                    onInspect({
                      kind: `Concept: ${c.name}`,
                      text: c.shortDefinition ?? c.name,
                      sourceBlockIds: c.sourceBlockIds,
                    })
                  }
                >
                  source ¶ ({c.sourceBlockIds.length})
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * The retrieval-prompts review panel (DET-353/359). Prompts are AI-suggested and
 * VISIBLE for review; none is scheduled permanently here (that needs user
 * validation in the learning loop). The expected answer's source blocks are
 * reachable so a reviewer can check the prompt is answerable from the source.
 */
function RetrievalPromptsPanel({
  prompts,
  onInspect,
}: {
  prompts: RetrievalPromptV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  return (
    <section className='av3-panel' aria-label='Retrieval prompts'>
      <div className='av3-panel-head'>
        <h2 className='av3-panel-h'>Retrieval prompts</h2>
        <span className='chip chip-ai'>✦ AI-suggested · not yet scheduled</span>
      </div>
      <ul className='av3-prompt-list'>
        {prompts.map((p) => (
          <li key={p.id} className='av3-prompt'>
            <p className='av3-prompt-q'>{p.question}</p>
            <div className='av3-prompt-foot'>
              <span className='chip chip-quiet'>
                {PROMPT_TYPE_LABEL[p.promptType] ?? p.promptType}
              </span>
              <span className={`chip av3-diff av3-diff--${p.difficulty}`}>
                {p.difficulty}
              </span>
              {p.expectedAnswerSourceBlockIds.length > 0 && (
                <button
                  type='button'
                  className='av3-source-btn'
                  onClick={() =>
                    onInspect({
                      kind: 'Prompt answer source',
                      text: p.question,
                      sourceBlockIds: p.expectedAnswerSourceBlockIds,
                    })
                  }
                >
                  answer source ({p.expectedAnswerSourceBlockIds.length})
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function MisconceptionsPanel({
  misconceptions,
  onInspect,
}: {
  misconceptions: MisconceptionCandidateV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  return (
    <section className='av3-panel' aria-label='Common misconceptions'>
      <div className='av3-panel-head'>
        <h2 className='av3-panel-h'>Watch out for…</h2>
        <span className='chip chip-ai'>✦ AI-suggested</span>
      </div>
      <ul className='av3-misc-list'>
        {misconceptions.map((m) => (
          <li key={m.id} className='av3-misc'>
            <p className='av3-misc-wrong'>✗ {m.misconception}</p>
            <p className='av3-misc-right'>✓ {m.correction}</p>
            {m.sourceBlockIds.length > 0 && (
              <button
                type='button'
                className='av3-source-btn'
                onClick={() =>
                  onInspect({
                    kind: 'Misconception',
                    text: m.correction,
                    sourceBlockIds: m.sourceBlockIds,
                  })
                }
              >
                source ¶ ({m.sourceBlockIds.length})
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function KeyClaimsPanel({
  claims,
  onInspect,
}: {
  claims: ClaimCandidateV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  return (
    <section className='av3-panel' aria-label='Key claims'>
      <h2 className='av3-panel-h'>Key claims</h2>
      <ul className='av3-claim-list'>
        {claims.map((c) => (
          <li key={c.id} className='av3-claim'>
            <span className='chip chip-quiet av3-claim-type'>
              {CLAIM_TYPE_LABEL[c.claimType] ?? c.claimType}
            </span>
            <span className='av3-claim-text'>{c.text}</span>
            {c.sourceBlockIds.length > 0 && (
              <button
                type='button'
                className='av3-source-btn'
                onClick={() =>
                  onInspect({
                    kind: 'Claim',
                    text: c.text,
                    sourceBlockIds: c.sourceBlockIds,
                  })
                }
              >
                source ¶ ({c.sourceBlockIds.length})
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function TerminologyPanel({
  terms,
  onInspect,
}: {
  terms: TerminologyItemV3[]
  onInspect: (s: ArticleV3InspectSelection) => void
}) {
  return (
    <section className='av3-panel' aria-label='Terminology'>
      <h2 className='av3-panel-h'>Terminology</h2>
      <dl className='av3-term-list'>
        {terms.map((t) => (
          <div key={t.id} className='av3-term'>
            <dt className='av3-term-name'>{t.term}</dt>
            <dd className='av3-term-def'>
              {t.definition}
              {t.sourceBlockIds.length > 0 && (
                <button
                  type='button'
                  className='av3-source-btn'
                  onClick={() =>
                    onInspect({
                      kind: `Term: ${t.term}`,
                      text: t.definition,
                      sourceBlockIds: t.sourceBlockIds,
                    })
                  }
                >
                  source ¶ ({t.sourceBlockIds.length})
                </button>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

// --- Drawers -----------------------------------------------------------------

/**
 * Source notes + references (DET-348/350). References, bibliography, external
 * links and stripped navigation/footer material live HERE, in a collapsed
 * drawer — never as ordinary body sections — so the article reads as a learning
 * surface, not a source-layout clone. Omitted entirely when there's nothing to
 * show.
 */
function SourceNotesDrawer({
  notes,
  references,
}: {
  notes: SourceNoteV3[]
  references: ArticleJsonV3['references']
}) {
  if (notes.length === 0 && references.length === 0) return null
  return (
    <details className='av3-drawer'>
      <summary className='av3-drawer-summary'>
        Source notes &amp; references
        <span className='av3-drawer-count'>
          {notes.length + references.length}
        </span>
      </summary>
      <div className='av3-drawer-body'>
        {references.length > 0 && (
          <div className='av3-notes-group'>
            <h3 className='av3-notes-h'>References</h3>
            <ul className='av3-notes-list'>
              {references.map((r) => (
                <li key={r.id}>
                  {r.url ? (
                    <a href={r.url} target='_blank' rel='noopener noreferrer'>
                      {r.label}
                    </a>
                  ) : (
                    r.label
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {notes.length > 0 && (
          <div className='av3-notes-group'>
            <h3 className='av3-notes-h'>Notes</h3>
            <ul className='av3-notes-list'>
              {notes.map((n) => (
                <li key={n.id} className='av3-note'>
                  <span className='chip chip-quiet av3-note-kind'>
                    {SOURCE_NOTE_KIND_LABEL[n.kind] ?? n.kind}
                  </span>{' '}
                  {n.url ? (
                    <a href={n.url} target='_blank' rel='noopener noreferrer'>
                      {n.text}
                    </a>
                  ) : (
                    n.text
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  )
}

/**
 * The quality report / debug panel (DET-354). A collapsed drawer of the fidelity
 * scores, counts, and reviewer warnings — the provenance/quality evidence behind
 * the article's status. Collapsed by default so it stays a reviewer aid, not a
 * reading distraction.
 */
function QualityReportPanel({
  report,
}: {
  report: ArticleJsonV3['qualityReport']
}) {
  const [open, setOpen] = useState(false)
  const scores: { label: string; value: number; pct?: boolean }[] = [
    { label: 'Source coverage', value: report.sourceCoverageScore, pct: true },
    {
      label: 'Important source coverage',
      value: report.importantSourceCoverageScore,
      pct: true,
    },
    {
      label: 'Citation coverage',
      value: report.citationCoverageScore,
      pct: true,
    },
    {
      label: 'Exercise readiness',
      value: report.exerciseReadinessScore,
      pct: true,
    },
    { label: 'Readability', value: report.articleReadabilityScore, pct: true },
    {
      label: 'Provenance completeness',
      value: report.provenanceCompletenessScore,
      pct: true,
    },
  ]
  const counts: { label: string; value: number }[] = [
    { label: 'Unsupported claims', value: report.unsupportedClaimCount },
    {
      label: 'High-severity lost info',
      value: report.highSeverityLostInfoCount,
    },
    { label: 'Concept candidates', value: report.conceptCandidateCount },
    { label: 'Key claims', value: report.keyClaimCount },
    { label: 'Retrieval prompts', value: report.retrievalPromptCount },
    { label: 'Tables', value: report.tableCount },
    { label: 'Callouts', value: report.calloutCount },
  ]
  return (
    <details
      className='av3-drawer av3-drawer--quality'
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className='av3-drawer-summary'>Quality report</summary>
      {open && (
        <div className='av3-drawer-body'>
          <div className='av3-quality-grid'>
            {scores.map((s) => (
              <div key={s.label} className='av3-quality-cell'>
                <span className='av3-quality-val'>{formatScore(s.value)}</span>
                <span className='av3-quality-label'>{s.label}</span>
              </div>
            ))}
          </div>
          <ul className='av3-quality-counts'>
            {counts.map((c) => (
              <li key={c.label}>
                <span className='av3-quality-count'>{c.value}</span> {c.label}
              </li>
            ))}
          </ul>
          {report.reviewerWarnings.length > 0 && (
            <div className='av3-quality-warnings'>
              <h3 className='av3-notes-h'>Reviewer warnings</h3>
              <ul className='av3-notes-list'>
                {report.reviewerWarnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </details>
  )
}

// --- Helpers + label maps ----------------------------------------------------

function groupTablesBySection(
  tables: ArticleTableV3[],
): Map<string, ArticleTableV3[]> {
  const map = new Map<string, ArticleTableV3[]>()
  for (const t of tables) {
    for (const sectionId of t.relatedSectionIds ?? []) {
      const list = map.get(sectionId) ?? []
      list.push(t)
      map.set(sectionId, list)
    }
  }
  return map
}

function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

/** A 0–1 score → integer percent; a >1 value is treated as already a percent. */
function formatScore(value: number): string {
  const pct = value <= 1 ? value * 100 : value
  return `${Math.round(pct)}%`
}

const IMPORTANCE_RANK: Record<ConceptCandidateV3['importance'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

const SOURCE_KIND_LABEL: Record<SourceKind, string> = {
  transcript_lesson: 'Lesson transcript',
  structured_web_article: 'Web article',
  research_paper: 'Research paper',
  raw_notes: 'Raw notes',
  documentation: 'Documentation',
  unknown: 'Source',
}

const SHAPE_LABEL: Record<ArticleShapeV3, string> = {
  lesson_article: 'Lesson',
  concept_explainer: 'Concept explainer',
  research_digest: 'Research digest',
  technical_walkthrough: 'Technical walkthrough',
  reference_digest: 'Reference digest',
  structured_notes: 'Structured notes',
}

const STATUS_LABEL: Record<ArticleStatusV3, string> = {
  DRAFT: 'Draft',
  GENERATING: 'Generating',
  NEEDS_REGENERATION: 'Needs regeneration',
  BLOCKED_LOW_COVERAGE: 'Blocked · low coverage',
  BLOCKED_UNSUPPORTED_CLAIMS: 'Blocked · unsupported claims',
  BLOCKED_MISSING_CONCEPTS: 'Blocked · missing concepts',
  BLOCKED_FIDELITY: 'Blocked · fidelity',
  READY_FOR_REVIEW: 'Ready for review',
  FINAL: 'Final',
}

const BLOCKER_CODE_LABEL: Record<ArticleBlockerReason['code'], string> = {
  low_coverage: 'Low coverage',
  unsupported_claims: 'Unsupported claims',
  missing_concepts: 'Missing concepts',
  fidelity: 'Fidelity',
  lost_information: 'Lost information',
  weak_exercise_readiness: 'Weak exercise readiness',
}

const SECTION_ROLE_LABEL: Record<SectionRoleV3, string> = {
  introduction: 'Introduction',
  definition: 'Definition',
  boundaries: 'Boundaries',
  mechanism: 'Mechanism',
  types: 'Types',
  example: 'Example',
  application: 'Application',
  misconception: 'Misconception',
  evidence: 'Evidence',
  method: 'Method',
  results: 'Results',
  limitations: 'Limitations',
  implications: 'Implications',
  steps: 'Steps',
  reference: 'Reference',
  summary: 'Summary',
}

const CALLOUT_TYPE_LABEL: Record<ArticleCalloutTypeV3, string> = {
  definition: 'Definition',
  key_idea: 'Key idea',
  source_analogy: 'Analogy',
  caveat: 'Caveat',
  example: 'Example',
  warning: 'Warning',
  remember: 'Remember',
  compare: 'Compare',
}

const CONCEPT_TYPE_LABEL: Record<ConceptCandidateV3['type'], string> = {
  core_concept: 'Core concept',
  supporting_concept: 'Supporting',
  term: 'Term',
  process: 'Process',
  distinction: 'Distinction',
  method: 'Method',
  model: 'Model',
  misconception: 'Misconception',
}

const CLAIM_TYPE_LABEL: Record<ClaimCandidateV3['claimType'], string> = {
  definition: 'Definition',
  mechanism: 'Mechanism',
  distinction: 'Distinction',
  historical_claim: 'Historical',
  causal_claim: 'Causal',
  classification: 'Classification',
  example: 'Example',
  caveat: 'Caveat',
}

const PROMPT_TYPE_LABEL: Record<RetrievalPromptV3['promptType'], string> = {
  definition: 'Definition',
  mechanism: 'Mechanism',
  distinction: 'Distinction',
  sequence: 'Sequence',
  analogy: 'Analogy',
  misconception_repair: 'Misconception',
  transfer: 'Transfer',
}

const SOURCE_NOTE_KIND_LABEL: Record<SourceNoteV3['kind'], string> = {
  reference: 'Reference',
  bibliography: 'Bibliography',
  external_link: 'Link',
  removed_navigation: 'Removed nav',
  low_importance: 'Aside',
}
