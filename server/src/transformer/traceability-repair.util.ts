/**
 * Pre-validation traceability repair for the two pre-generator LLM stages — the
 * structure model (DET-251) and the reshaping plan (DET-252). Both stages must
 * cite ONLY real source block ids; the code guards (`assertKnownIds` / the plan's
 * Guard A) fail the WHOLE article "loudly" on any untraceable id. But the LLM
 * occasionally hallucinates a plausible-looking cuid, which sinks an otherwise
 * faithful model over a single invented reference.
 *
 * Applied via `completeJson`'s `repair` hook (pure, runs on every attempt BEFORE
 * zod), these drop references the source cannot back: an invented id is removed
 * from its array, and an entry left with NO valid references is dropped entirely
 * (a claim/section/etc. whose only provenance was invented was never trustworthy).
 * The repair can only DELETE invented provenance — never fabricate it — so every
 * surviving reference stays 100% traceable and `assertKnownIds` then passes.
 *
 * This is the harder sibling of `repairArticleLlmV2`: that one regenerates
 * INTERNAL anchor ids (safe to invent); this one prunes SOURCE provenance (which
 * must never be invented, only dropped). Both are pure and deterministic.
 *
 * Note: if a repair empties a `.min(1)` array (e.g. every section was
 * hallucinated, or a structure-model entry array becomes empty when it was the
 * only content) the downstream zod validation still fails the article — there is
 * genuinely nothing traceable left to build from, which is the correct outcome.
 */

/** Keep only the ids present in the source. Non-array / non-string ⇒ dropped. */
function knownIds(value: unknown, known: ReadonlySet<string>): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (id): id is string => typeof id === 'string' && known.has(id),
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// --- Structure model -------------------------------------------------------

/**
 * Drop untraceable references from the structure model (DET-251). title/subtitle
 * fall back to `null` (the schema makes them optional+nullable) when nothing backs
 * them; every preserved-item array drops entries left without a valid reference;
 * `noiseDecisions` and `uncertainBlockIds` keep only ids that exist.
 */
export function repairStructureModel(
  parsed: unknown,
  known: ReadonlySet<string>,
): unknown {
  if (!isRecord(parsed)) return parsed
  const out: Record<string, unknown> = { ...parsed }

  out.title = repairOptionalTraceable(out.title, known)
  out.subtitle = repairOptionalTraceable(out.subtitle, known)

  for (const key of [
    'claims',
    'definitions',
    'examples',
    'caveats',
    'terminology',
    'originalOutline',
  ] as const) {
    out[key] = repairTraceableEntries(out[key], known)
  }

  // noiseDecisions cite a single `blockId`; a decision about an invented block is
  // meaningless, so drop it.
  if (Array.isArray(out.noiseDecisions)) {
    out.noiseDecisions = out.noiseDecisions.filter(
      (n) =>
        isRecord(n) && typeof n.blockId === 'string' && known.has(n.blockId),
    )
  }

  // uncertainBlockIds is a bare id list — keep only the real ones.
  if (Array.isArray(out.uncertainBlockIds)) {
    out.uncertainBlockIds = knownIds(out.uncertainBlockIds, known)
  }

  return out
}

/** An optional `{ text, sourceBlockIds }` → null when no cited block survives. */
function repairOptionalTraceable(
  value: unknown,
  known: ReadonlySet<string>,
): unknown {
  if (!isRecord(value)) return value
  const ids = knownIds(value.sourceBlockIds, known)
  if (ids.length === 0) return null
  return { ...value, sourceBlockIds: ids }
}

/** Map an array of `{ …, sourceBlockIds }` entries, dropping any left unsourced. */
function repairTraceableEntries(
  value: unknown,
  known: ReadonlySet<string>,
): unknown {
  if (!Array.isArray(value)) return value
  const kept: unknown[] = []
  for (const entry of value) {
    // Non-objects are real breakage, not benign drift — leave them for zod.
    if (!isRecord(entry)) {
      kept.push(entry)
      continue
    }
    const ids = knownIds(entry.sourceBlockIds, known)
    if (ids.length === 0) continue
    kept.push({ ...entry, sourceBlockIds: ids })
  }
  return kept
}

// --- Reshaping plan --------------------------------------------------------

/**
 * Drop untraceable references from the reshaping plan (DET-252). Only the plan's
 * Guard A throws — on a section's (or its heading's / subsection's) cited ids — so
 * those are the references that must be pruned to avoid a loud FAILED: a section
 * with no surviving `sourceBlockIds` is dropped; an empty optional
 * `headingSourceBlockIds` is omitted; subsections are pruned one level the same
 * way. Reordering audits anchored on an invented block are dropped too (a reorder
 * of a nonexistent block is meaningless), keeping the DET-275 coverage honest.
 * `removedBlocks` is left untouched — the service already tolerates unknown ids
 * there (it moves them to warnings and keeps the block).
 */
export function repairReshapingPlan(
  parsed: unknown,
  known: ReadonlySet<string>,
): unknown {
  if (!isRecord(parsed)) return parsed
  const out: Record<string, unknown> = { ...parsed }

  if (Array.isArray(out.sections)) {
    out.sections = out.sections
      .map((s) => repairPlanSection(s, known))
      .filter((s) => s !== null)
  }

  if (Array.isArray(out.reorderings)) {
    out.reorderings = out.reorderings
      .map((r) => repairReordering(r, known))
      .filter((r) => r !== null)
  }

  return out
}

/** Prune a plan section's cited ids; returns null when nothing traceable remains. */
function repairPlanSection(
  section: unknown,
  known: ReadonlySet<string>,
): unknown {
  // Non-objects are real breakage — hand them to zod rather than silently drop.
  if (!isRecord(section)) return section
  const ids = knownIds(section.sourceBlockIds, known)
  if (ids.length === 0) return null
  const out: Record<string, unknown> = { ...section, sourceBlockIds: ids }

  // headingSourceBlockIds is optional — omit it entirely when empty rather than
  // leaving an empty array the schema would reject if it were required elsewhere.
  if (Array.isArray(section.headingSourceBlockIds)) {
    const heading = knownIds(section.headingSourceBlockIds, known)
    if (heading.length > 0) out.headingSourceBlockIds = heading
    else delete out.headingSourceBlockIds
  }

  if (Array.isArray(section.subsections)) {
    out.subsections = section.subsections
      .map((sub) => repairPlanSection(sub, known))
      .filter((sub) => sub !== null)
  }

  return out
}

/** Drop a reorder audit anchored on an invented block; prune its cluster ids. */
function repairReordering(audit: unknown, known: ReadonlySet<string>): unknown {
  if (!isRecord(audit)) return audit
  if (
    typeof audit.sourceBlockId !== 'string' ||
    !known.has(audit.sourceBlockId)
  )
    return null
  const out: Record<string, unknown> = { ...audit }
  if (Array.isArray(audit.movedWithClusterIds)) {
    const cluster = knownIds(audit.movedWithClusterIds, known)
    if (cluster.length > 0) out.movedWithClusterIds = cluster
    else delete out.movedWithClusterIds
  }
  return out
}
