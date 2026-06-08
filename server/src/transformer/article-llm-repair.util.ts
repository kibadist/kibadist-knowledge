/**
 * Structural repair for the generator LLM's article JSON (`ArticleLlmV2Schema`),
 * applied BEFORE zod validation via `completeJson`'s `repair` hook.
 *
 * The schema is deliberately strict so downstream consumers can rely on every
 * section having a `blocks` array and every section / subsection / block having a
 * stable anchor `id`. But the generator occasionally drifts in benign ways that
 * would otherwise FAIL the whole article:
 *   - a container section that carries only `subsections` and omits `blocks`,
 *   - a section / subsection / block missing its anchor `id`,
 *   - an empty `subtitle.text` (the field is optional, so an empty one is best
 *     dropped rather than rejected).
 *
 * This pass normalizes *shape only* — it never invents meaning or provenance.
 * Anchor ids are internal (DOM anchors + learning-event keys), distinct from the
 * `sourceBlockIds` the pipeline validates against the real source, so generating
 * them is safe. Pure and deterministic (a traversal counter, no clocks/RNG), so
 * it can run on every attempt.
 */
export function repairArticleLlmV2(parsed: unknown): unknown {
  if (!isRecord(parsed)) return parsed
  const out: Record<string, unknown> = { ...parsed }

  // Drop an empty optional subtitle — the field is optional but its text must be
  // non-empty, so an absent subtitle is valid where an empty one is not.
  if (isRecord(out.subtitle)) {
    const text = out.subtitle.text
    if (typeof text !== 'string' || text.trim() === '') {
      delete out.subtitle
    }
  }

  if (Array.isArray(out.sections)) {
    const counter = { n: 0 }
    out.sections = out.sections.map((section, i) =>
      repairSection(section, 'sec', i, counter),
    )
  }

  return out
}

interface Counter {
  n: number
}

function repairSection(
  section: unknown,
  prefix: string,
  index: number,
  counter: Counter,
): unknown {
  if (!isRecord(section)) return section
  const out: Record<string, unknown> = { ...section }

  if (!isNonEmptyString(out.id)) {
    out.id = makeId(prefix, out.heading, index, counter)
  }
  const sectionId = out.id as string

  // Every section must carry a blocks array — a pure container (subsections only)
  // gets an empty one rather than failing the article.
  if (!Array.isArray(out.blocks)) {
    out.blocks = []
  } else {
    out.blocks = out.blocks.map((block, bi) =>
      repairBlock(block, sectionId, bi, counter),
    )
  }

  if (Array.isArray(out.subsections)) {
    out.subsections = out.subsections.map((sub, si) =>
      repairSection(sub, `${sectionId}-sub`, si, counter),
    )
  }

  return out
}

function repairBlock(
  block: unknown,
  sectionId: string,
  index: number,
  counter: Counter,
): unknown {
  if (!isRecord(block)) return block
  if (isNonEmptyString(block.id)) return block
  counter.n += 1
  return { ...block, id: `${sectionId}-b${index}-${counter.n}` }
}

function makeId(
  prefix: string,
  heading: unknown,
  index: number,
  counter: Counter,
): string {
  counter.n += 1
  const base = slug(heading) || `${prefix}-${index}`
  return `gen-${base}-${counter.n}`
}

function slug(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
