// Compression quality core (DET-190). Pure, no I/O — the single source of truth
// for "is this articulation the user's own words, or a copy of the source?".
//
// The product's canonical artifact is the user's OWN compression, never the
// source text or an AI restatement. A hard anti-behavior is letting the user
// paste the source past the gate. This module gives a lightweight, deterministic
// signal that detects verbatim/near-verbatim copying so the Articulate gate can
// ask the user to rephrase. It NEVER rewrites for the user — it only flags.
//
// Algorithm: normalize both texts to lowercase word tokens, then measure how
// much of the articulation's 4-word shingle set also appears in the source. High
// overlap = the articulation is lifted from the source. We also catch the
// degenerate case where the whole normalized articulation is a contiguous
// substring of the source. Everything is bounded (token caps, set ops) so there
// is no ReDoS or pathological-input blowup on the synchronous gate path.

/** k for k-word shingles. 4 catches copied phrases without over-flagging the
 *  short connective runs ("this is the") that any English prose shares. */
const SHINGLE_SIZE = 4

/** Need at least this many shingles before an overlap ratio is meaningful;
 *  below it we fall back to the exact-substring check only. */
const MIN_SHINGLES_FOR_RATIO = 5

/** At/above this fraction of the articulation's shingles appearing in the
 *  source, we treat it as copied rather than articulated. */
const VERBATIM_OVERLAP = 0.7

/** Token caps so a huge source/articulation can't blow up the gate path. */
const MAX_SOURCE_TOKENS = 20_000
const MAX_ARTICULATION_TOKENS = 2_000

export interface CompressionSignal {
  /** The articulation reads as copied from the source — block + ask to rephrase. */
  verbatim: boolean
  /** Fraction (0..1) of the articulation's shingles found in the source. */
  sourceOverlap: number
  /** A user-facing nudge when `verbatim`, else null. Never a rewrite. */
  message: string | null
}

/** Lowercase, strip punctuation to spaces, collapse whitespace, split to words. */
function tokenize(input: string, cap: number): string[] {
  const tokens = input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  return tokens.length > cap ? tokens.slice(0, cap) : tokens
}

/** The set of k-word shingles (joined by space) over a token list. */
function shingles(tokens: string[], k: number): Set<string> {
  const set = new Set<string>()
  for (let i = 0; i + k <= tokens.length; i++) {
    set.add(tokens.slice(i, i + k).join(' '))
  }
  return set
}

/**
 * Assess whether `articulation` is the user's own words relative to `sourceText`.
 * Empty/absent source (or articulation) means nothing to copy from → not verbatim.
 */
export function assessCompression(
  articulation: string | null | undefined,
  sourceText: string | null | undefined,
): CompressionSignal {
  const notCopied: CompressionSignal = {
    verbatim: false,
    sourceOverlap: 0,
    message: null,
  }

  const art = (articulation ?? '').trim()
  const src = (sourceText ?? '').trim()
  if (!art || !src) return notCopied

  const artTokens = tokenize(art, MAX_ARTICULATION_TOKENS)
  const srcTokens = tokenize(src, MAX_SOURCE_TOKENS)
  if (artTokens.length === 0 || srcTokens.length === 0) return notCopied

  // Degenerate copy: the whole normalized articulation appears verbatim inside
  // the normalized source. Catches short articulations the shingle ratio skips.
  const artNorm = artTokens.join(' ')
  const srcNorm = srcTokens.join(' ')
  const isSubstring = artNorm.length > 0 && srcNorm.includes(artNorm)

  const artShingles = shingles(artTokens, SHINGLE_SIZE)
  let sourceOverlap = 0
  if (artShingles.size > 0) {
    const srcShingles = shingles(srcTokens, SHINGLE_SIZE)
    let matched = 0
    for (const s of artShingles) if (srcShingles.has(s)) matched++
    sourceOverlap = matched / artShingles.size
  }

  const ratioVerbatim =
    artShingles.size >= MIN_SHINGLES_FOR_RATIO &&
    sourceOverlap >= VERBATIM_OVERLAP

  const verbatim = isSubstring || ratioVerbatim
  return {
    verbatim,
    sourceOverlap: isSubstring ? Math.max(sourceOverlap, 1) : sourceOverlap,
    message: verbatim
      ? 'This restates the source almost verbatim. Compression has to be in your own words — try explaining the core claim as if to a smart friend, without looking at the source.'
      : null,
  }
}
