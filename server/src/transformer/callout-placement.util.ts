import type {
  ArticleCallout,
  ArticleCalloutPlacement,
  ArticleJsonV2,
  ArticleSectionV2,
} from './transformer.types'

/**
 * Deterministic inline-callout placement (DET-272). PURE, NO LLM.
 *
 * The article's end-matter — `keyTerms`, `sourceExamples`, `caveats` — is the
 * single source of truth for that content (plan decision 8). This utility does
 * NOT add, drop, or rewrite any of it; it merely decides WHERE each item reads
 * best inline by matching the item's `sourceBlockIds` against each section's
 * source-block set, exactly the overlap approach the web `placeIllustrations`
 * util uses. The output carries each item's text plus placement metadata; the
 * renderer shows it as a margin note / inline card and keeps a compact end index
 * for navigation. Re-running over the same article always yields the same result
 * (ids are derived by index, never random).
 *
 * Placement rule (per item):
 *  - score each section by how many of the item's sourceBlockIds it covers,
 *  - the section with the LARGEST overlap wins; ties break to the EARLIEST
 *    section in reading order,
 *  - zero overlap anywhere ⇒ the item is UNPLACED (it has nowhere confident to
 *    live and is rendered in the end-of-article general group).
 *
 * Subsection handling: a subsection's block ids are FLATTENED into its parent
 * section for placement (decision documented here for simplicity — callouts
 * anchor to top-level sections, never to nested subsections). The parent's own
 * `sourceBlockIds` are included too, mirroring `placeIllustrations`.
 */

/** A section's full source-block id set: its own ids + every (sub)block's ids. */
function sectionBlockIds(section: ArticleSectionV2): Set<string> {
  const ids = new Set<string>(section.sourceBlockIds)
  for (const b of section.blocks) for (const id of b.sourceBlockIds) ids.add(id)
  for (const sub of section.subsections ?? [])
    for (const id of sectionBlockIds(sub)) ids.add(id)
  return ids
}

/** How many of the item's source ids the section covers. */
function overlap(sectionIds: Set<string>, itemIds: string[]): number {
  let n = 0
  for (const id of itemIds) if (sectionIds.has(id)) n++
  return n
}

/** Normalize the three end-matter classes into a uniform callout shape. */
function endMatterItems(article: ArticleJsonV2): ArticleCallout[] {
  const out: ArticleCallout[] = []
  article.keyTerms.forEach((t, i) =>
    out.push({
      id: `co-keyTerm-${i}`,
      kind: 'keyTerm',
      // keyTerms carry `term`, not `text` — normalize so the renderer/index has
      // a single `text` field while keeping the original `term` for the label.
      term: t.term,
      text: t.term,
      sourceBlockIds: t.sourceBlockIds,
      placementReason: '',
    }),
  )
  article.sourceExamples.forEach((e, i) =>
    out.push({
      id: `co-example-${i}`,
      kind: 'example',
      text: e.text,
      sourceBlockIds: e.sourceBlockIds,
      placementReason: '',
    }),
  )
  article.caveats.forEach((c, i) =>
    out.push({
      id: `co-caveat-${i}`,
      kind: 'caveat',
      text: c.text,
      sourceBlockIds: c.sourceBlockIds,
      placementReason: '',
    }),
  )
  return out
}

/**
 * Place every end-matter item (key term / example / caveat) against the article's
 * sections by source-block overlap. Returns `{ bySection, unplaced }`; placed
 * callouts within a section preserve end-matter order (keyTerms → examples →
 * caveats, each by index). Deterministic and idempotent.
 */
export function placeCallouts(article: ArticleJsonV2): ArticleCalloutPlacement {
  const sections = article.sections
  // Precompute each section's id set once, in reading order.
  const sectionSets = sections.map((s) => ({
    id: s.id,
    heading: s.heading,
    ids: sectionBlockIds(s),
  }))

  const bySection: Record<string, ArticleCallout[]> = {}
  const unplaced: ArticleCallout[] = []

  for (const item of endMatterItems(article)) {
    let best: { id: string; heading: string; score: number } | null = null
    for (const sec of sectionSets) {
      const score = overlap(sec.ids, item.sourceBlockIds)
      // Strictly-greater keeps the FIRST section on ties (earliest reading order).
      if (score > 0 && (best === null || score > best.score)) {
        best = { id: sec.id, heading: sec.heading, score }
      }
    }

    if (!best) {
      unplaced.push({
        ...item,
        placementReason: 'No source-block overlap with any section.',
      })
      continue
    }

    const placed: ArticleCallout = {
      ...item,
      placementReason: `${best.score}/${item.sourceBlockIds.length} source block${
        item.sourceBlockIds.length === 1 ? '' : 's'
      } overlap section '${best.heading}'`,
    }
    if (!bySection[best.id]) bySection[best.id] = []
    bySection[best.id].push(placed)
  }

  return { bySection, unplaced }
}
