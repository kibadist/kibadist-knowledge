// Retrieval card generator (DET-192). Pure, no I/O. Cards are generated from the
// USER'S COMPRESSION (their articulation) and approved edges — NEVER from the
// source document. This is the non-negotiable rule: the user is tested on what
// they claim to understand, not on what an external author wrote.
//
// MVP card types: CLOZE (blank a salient term in the compression), EXPLAIN
// (open recall), CONNECT (uses an approved edge), BOUNDARY (scope of the claim).
// EXPLAIN and BOUNDARY are always available, so every earned concept has at
// least one card.

export type RetrievalCardType = 'CLOZE' | 'EXPLAIN' | 'CONNECT' | 'BOUNDARY'

export interface RetrievalCard {
  type: RetrievalCardType
  prompt: string
  /** The expected answer where one is well-defined (CLOZE). Null for open cards
   *  that are self/AI-graded against the compression. */
  answer: string | null
  /** True for every card — provenance marker that this came from the user's
   *  compression, not the source. Surfaced in the UI per the DoD. */
  fromCompression: true
}

export interface CardInput {
  /** The concept's title (the user's own short name for it). */
  title: string
  /** The user's canonical compression/articulation. */
  articulation: string
  /** Approved (CONFIRMED) edges to other concepts, for CONNECT cards. */
  edges?: { targetTitle: string; relationKind?: string | null }[]
}

// Short, common words that make poor cloze blanks.
const STOPWORDS = new Set([
  'the',
  'and',
  'that',
  'this',
  'with',
  'from',
  'have',
  'has',
  'are',
  'was',
  'were',
  'for',
  'not',
  'but',
  'they',
  'their',
  'them',
  'then',
  'than',
  'into',
  'over',
  'under',
  'when',
  'what',
  'which',
  'because',
  'about',
  'would',
  'could',
  'should',
  'these',
  'those',
  'such',
  'also',
  'its',
  'it',
  'a',
  'an',
  'of',
  'to',
  'in',
  'is',
  'as',
  'on',
  'at',
  'or',
  'be',
  'by',
  'we',
  'you',
])

/** Pick the most "salient" word in the compression to blank: the longest token
 *  that isn't a stopword. Returns null if nothing suitable (very short text). */
function salientWord(articulation: string): string | null {
  const words = articulation.match(/\p{L}[\p{L}\p{N}-]{4,}/gu) ?? []
  let best: string | null = null
  for (const w of words) {
    if (STOPWORDS.has(w.toLowerCase())) continue
    if (!best || w.length > best.length) best = w
  }
  return best
}

/** Replace the first whole-word occurrence of `word` with a blank. */
function blankOut(text: string, word: string): string {
  const i = text.toLowerCase().indexOf(word.toLowerCase())
  if (i < 0) return text
  return `${text.slice(0, i)}_____${text.slice(i + word.length)}`
}

/**
 * Generate retrieval cards for a concept from its compression (+ approved edges).
 * Always returns at least one card (EXPLAIN). Deterministic and source-free.
 */
export function generateCards(input: CardInput): RetrievalCard[] {
  const title = input.title.trim() || 'this concept'
  const articulation = input.articulation.trim()
  const cards: RetrievalCard[] = []

  // EXPLAIN — always present: open recall of the whole idea.
  cards.push({
    type: 'EXPLAIN',
    prompt: `From memory, explain "${title}" in your own words.`,
    answer: null,
    fromCompression: true,
  })

  // CLOZE — blank a salient term from the user's own compression.
  if (articulation) {
    const word = salientWord(articulation)
    if (word) {
      cards.push({
        type: 'CLOZE',
        prompt: `Fill the blank in your own articulation:\n\n${blankOut(
          articulation,
          word,
        )}`,
        answer: word,
        fromCompression: true,
      })
    }
  }

  // CONNECT — uses an approved edge, so the user recalls the relationship they
  // themselves drew (DET-191).
  const edge = input.edges?.find((e) => e.targetTitle?.trim())
  if (edge) {
    cards.push({
      type: 'CONNECT',
      prompt: `How does "${title}" relate to "${edge.targetTitle.trim()}"?${
        edge.relationKind
          ? ` (you linked them as ${edge.relationKind.toLowerCase()})`
          : ''
      }`,
      answer: null,
      fromCompression: true,
    })
  }

  // BOUNDARY — the scope facet of the compression (DET-190).
  cards.push({
    type: 'BOUNDARY',
    prompt: `What is the boundary of "${title}" — what does it NOT claim?`,
    answer: null,
    fromCompression: true,
  })

  return cards
}
