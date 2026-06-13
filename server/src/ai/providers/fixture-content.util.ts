/**
 * Deterministic, source-grounded content synthesis for the fixture AI provider
 * (DET-343). Pure functions — NO LLM, NO I/O, NO randomness — that turn a
 * transformer prompt back into a schema-valid JSON response.
 *
 * WHY THIS EXISTS. The whole article engine (v2 and v3) requires live LLM calls,
 * so in any environment without an `OPENAI_API_KEY` — exactly the unattended
 * browser-verification environment — NOTHING can be generated and none of the
 * acceptance criteria can be observed end-to-end. The fixture provider closes
 * that gap: it parses the SAME prompts the real services build (the block lines
 * carry every source id + classification verbatim) and emits deterministic JSON
 * that is GENUINELY grounded in those real ids. The downstream machinery is the
 * real thing — `assembleArticleV3`, the grounding/provenance checks, the coverage
 * computation, and the quality gate all run unchanged — so a fixture run produces
 * a true v3 article (high important coverage, grounded concepts/claims/prompts,
 * 0 unsupported claims) that the reader renders and the gate marks READY.
 *
 * This module intentionally does NOT import the transformer's zod schemas (it
 * lives in the lower `ai` layer). It emits plain objects that match the documented
 * JSON shapes; the callers re-validate with their own schemas, so a drift would
 * surface as a normal validation failure, never as silently-wrong data.
 */

/** A source block parsed back out of a prompt's block listing. */
export interface ParsedBlock {
  id: string
  blockType: string
  /** Present for v3 prompts (`[id] (type/classification) text`); null for v2. */
  classification: string | null
  text: string
}

/**
 * Parse the block lines from any transformer prompt. Two formats are recognised:
 *  - classifier: `[0] (paragraph) some text`
 *  - v3:         `[ckxyz…] (paragraph/DEFINITION) some text`
 * Only lines that START a block are collected; non-matching lines (headers,
 * trailing instructions, continuations) are ignored. This is deliberately
 * conservative — a block whose text wrapped onto a second line keeps its id and
 * first line, which is all grounding needs.
 */
export function parseBlocks(prompt: string): ParsedBlock[] {
  const out: ParsedBlock[] = []
  for (const rawLine of prompt.split('\n')) {
    const line = rawLine.trimEnd()
    // `[id] (meta) text` — id has no ']'; meta has no ')'.
    const m = line.match(/^\[([^\]]+)\]\s+\(([^)]*)\)\s?(.*)$/)
    if (!m) continue
    const id = m[1].trim()
    const meta = m[2].trim()
    const text = m[3].trim()
    if (!id) continue
    const slash = meta.indexOf('/')
    if (slash >= 0) {
      const classification = meta.slice(slash + 1).trim()
      out.push({
        id,
        blockType: meta.slice(0, slash).trim(),
        classification: classification.length > 0 ? classification : null,
        text,
      })
    } else {
      out.push({ id, blockType: meta, classification: null, text })
    }
  }
  return out
}

// --- Block classification (fixture replacement for the LLM classifier) -------

/** Substance classes the coverage/concept machinery treats as "important". */
const SUBSTANCE = new Set([
  'MAIN_ARGUMENT',
  'DEFINITION',
  'EXAMPLE',
  'EVIDENCE',
  'METHOD',
])

interface FixtureClassification {
  index: number
  classification: string
  removable?: boolean
  noiseReason?: string
}

/**
 * Heuristically classify one block by its type + text. Deterministic and
 * intentionally generous with substance classes so that a real source yields a
 * meaningful mix (definitions, examples, arguments) — the raw material the v3
 * gate measures coverage and concepts against. Mirrors the editorial roles the
 * real prompt enumerates; it is a stand-in for the model, not a clone of it.
 */
export function classifyBlock(blockType: string, text: string): string {
  const t = text.trim()
  const lower = t.toLowerCase()
  const len = t.length

  // Obvious chrome → removable noise (the real heuristic pre-pass catches most
  // of this before the LLM; we repeat a thin version for completeness).
  if (
    len <= 200 &&
    /all rights reserved|©|privacy policy|terms of service|cookie policy|skip to (?:main )?content|main menu|share this|subscribe to our newsletter/i.test(
      t,
    )
  ) {
    return 'NAVIGATION_NOISE'
  }

  if (blockType === 'heading') return 'BACKGROUND'
  if (len < 25) return 'UNCERTAIN'

  if (/^(for example|for instance|e\.g\.|consider|imagine|suppose)\b/i.test(t))
    return 'EXAMPLE'
  if (
    /\b(is|are) (a|an|the|defined|called|known)\b|\b(refers to|means that|is defined as)\b/i.test(
      lower,
    )
  )
    return 'DEFINITION'
  if (
    /\d+\s?%|\bstudy\b|\bstudies\b|\bresearch\b|\bsurvey\b|\baccording to\b|\bdata\b/i.test(
      lower,
    )
  )
    return 'EVIDENCE'
  if (
    /^(first|second|third|next|then|finally|step\b)|\bsteps?\b|\bprocedure\b/i.test(
      lower,
    )
  )
    return 'METHOD'
  return 'MAIN_ARGUMENT'
}

/** Build the classifier's JSON response from its prompt. */
export function synthesizeClassification(prompt: string): string {
  const blocks = parseBlocks(prompt)
  const classifications: FixtureClassification[] = blocks.map((b) => {
    const idx = Number.parseInt(b.id, 10)
    const cls = classifyBlock(b.blockType, b.text)
    const item: FixtureClassification = {
      index: Number.isInteger(idx) ? idx : 0,
      classification: cls,
    }
    if (cls === 'NAVIGATION_NOISE') {
      item.removable = true
      item.noiseReason = 'navigation/boilerplate chrome'
    }
    return item
  })
  return JSON.stringify({ classifications })
}

// --- v3 rewrite + learning synthesis -----------------------------------------

function truncate(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trimEnd()}…`
}

/** A short, human-ish concept label derived from a definition/example block. */
function deriveLabel(text: string): string {
  const t = text.trim()
  // "X is/are/refers to …" → "X"; otherwise the first handful of words.
  const m = t.match(/^(.{2,60}?)\s+(?:is|are|refers to|means|is defined as)\b/i)
  if (m) return capitalize(m[1].replace(/[.,;:]+$/, '').trim())
  const words = t.split(/\s+/).slice(0, 6).join(' ')
  return capitalize(words.replace(/[.,;:]+$/, ''))
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)
}

/** Map a substance/block signal to a v3 rewrite block type. */
function blockTypeFor(b: ParsedBlock): string {
  if (b.blockType === 'list') return 'list'
  if (b.classification === 'DEFINITION') return 'definition'
  if (b.classification === 'EXAMPLE') return 'example'
  return 'paragraph'
}

/**
 * Synthesize the v3 REWRITE LLM JSON from its prompt. Every content block cites
 * its own real source id, so important-source coverage is maximal and provenance
 * resolves to `source` in `assembleArticleV3`. Headings open sections; everything
 * before the first heading lands in an opening section.
 */
export function synthesizeRewrite(prompt: string): string {
  const blocks = parseBlocks(prompt)
  const content = blocks.filter((b) => b.text.length > 0)

  interface Section {
    heading: string
    sourceBlockIds: string[]
    blocks: {
      type: string
      text: string
      sourceBlockIds: string[]
      fidelityRisk: string
      items?: string[]
    }[]
  }

  const sections: Section[] = []
  const open = (heading: string, headingId?: string): Section => {
    const section: Section = {
      heading,
      sourceBlockIds: headingId ? [headingId] : [],
      blocks: [],
    }
    sections.push(section)
    return section
  }

  const firstHeading = content.find((b) => b.blockType === 'heading')
  let current: Section | null = null
  for (const b of content) {
    if (b.blockType === 'heading') {
      current = open(truncate(b.text, 120) || 'Section', b.id)
      continue
    }
    if (!current) current = open('Overview')
    const type = blockTypeFor(b)
    const block: Section['blocks'][number] = {
      type,
      text: b.text,
      sourceBlockIds: [b.id],
      fidelityRisk: 'low',
    }
    if (type === 'list') block.items = [b.text]
    current.blocks.push(block)
  }
  if (sections.length === 0) {
    // No usable content blocks — still emit a valid (empty-section) shape.
    open('Overview')
  }

  const title =
    (firstHeading && truncate(firstHeading.text, 120)) ||
    (content[0] && truncate(content[0].text, 80)) ||
    'Source-Grounded Learning Article'
  const argument = content.find(
    (b) => b.classification === 'MAIN_ARGUMENT' || b.blockType !== 'heading',
  )
  const summary = argument
    ? truncate(argument.text, 280)
    : 'A learning-first restatement of the source, grounded in its own blocks.'

  return JSON.stringify({ title, summary, sections })
}

/**
 * Synthesize the v3 LEARNING-EXTRACTION JSON from its prompt. Concepts come from
 * DEFINITION/EXAMPLE blocks, claims from MAIN_ARGUMENT/EVIDENCE blocks; every
 * item cites a real source id so it survives the code-side grounding checks
 * (concepts grounded, claims `grounded` not `unsupported`). At least one grounded
 * retrieval prompt is always emitted so a substantive source clears the gate.
 */
export function synthesizeLearning(prompt: string): string {
  const blocks = parseBlocks(prompt)
  const important = blocks.filter(
    (b) => b.classification != null && SUBSTANCE.has(b.classification),
  )
  const conceptBlocks = blocks
    .filter(
      (b) =>
        b.classification === 'DEFINITION' || b.classification === 'EXAMPLE',
    )
    .slice(0, 6)
  const claimBlocks = blocks
    .filter(
      (b) =>
        b.classification === 'MAIN_ARGUMENT' || b.classification === 'EVIDENCE',
    )
    .slice(0, 6)
  const headings = blocks.filter((b) => b.blockType === 'heading')

  const keyConcepts = conceptBlocks.map((b) => ({
    label: deriveLabel(b.text),
    definition: truncate(b.text, 240),
    sourceBlockIds: [b.id],
  }))

  const keyClaims = claimBlocks.map((b) => ({
    text: truncate(b.text, 240),
    sourceBlockIds: [b.id],
  }))

  const retrievalPrompts: { prompt: string; sourceBlockIds: string[] }[] = []
  for (const c of keyConcepts.slice(0, 4)) {
    retrievalPrompts.push({
      prompt: `What does "${c.label}" mean, and why does it matter here?`,
      sourceBlockIds: c.sourceBlockIds,
    })
  }
  for (const c of claimBlocks.slice(0, 2)) {
    retrievalPrompts.push({
      prompt: `Recall and restate this point in your own words: ${truncate(c.text, 90)}`,
      sourceBlockIds: [c.id],
    })
  }
  // Guarantee at least one grounded prompt for any source with content, so a
  // thin-but-real source still clears the NO_RETRIEVAL_PROMPTS gate. Any real id
  // is "grounded" (the assembler checks existence, not importance).
  if (retrievalPrompts.length === 0 && blocks.length > 0) {
    retrievalPrompts.push({
      prompt: 'Recall the main point this source makes, without looking back.',
      sourceBlockIds: [blocks[0].id],
    })
  }

  const sourceNotes =
    important.length > 0
      ? [
          {
            text: 'Every claim above is drawn from the source; connective framing is marked as AI scaffolding.',
            sourceBlockIds: [important[0].id],
          },
        ]
      : []

  const learningPath =
    headings.length > 0
      ? headings.slice(0, 6).map((h) => ({
          objective: `Understand: ${truncate(h.text, 80)}`,
          sectionRefs: [truncate(h.text, 120)],
        }))
      : [
          {
            objective: 'Work through the source and recall its key points.',
            sectionRefs: ['1'],
          },
        ]

  return JSON.stringify({
    learningPath,
    keyConcepts,
    keyClaims,
    retrievalPrompts,
    sourceNotes,
  })
}

// --- Provider-level routing ---------------------------------------------------

/** Which transformer call a prompt/system pair represents. */
export type FixtureCallKind =
  | 'classification'
  | 'v3_rewrite'
  | 'v3_learning'
  | 'unknown'

/**
 * Identify the call from its system prompt. The system strings are stable
 * module constants in the prompt builders, so a substring match is reliable.
 */
export function detectCallKind(system: string | undefined): FixtureCallKind {
  const s = system ?? ''
  if (s.includes('Block Classifier')) return 'classification'
  if (s.includes('Source-Grounded Rewriter')) return 'v3_rewrite'
  if (s.includes('Learning Extractor')) return 'v3_learning'
  return 'unknown'
}

/**
 * Produce the deterministic completion text for a request. Returns valid JSON for
 * every recognised call; for an unrecognised call (e.g. a v2-only prompt) it
 * returns `{}`, which the caller's schema rejects and surfaces as a normal
 * validation failure — never silently-wrong content.
 */
export function synthesizeCompletion(
  system: string | undefined,
  prompt: string,
): string {
  switch (detectCallKind(system)) {
    case 'classification':
      return synthesizeClassification(prompt)
    case 'v3_rewrite':
      return synthesizeRewrite(prompt)
    case 'v3_learning':
      return synthesizeLearning(prompt)
    default:
      return '{}'
  }
}
