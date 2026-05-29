interface LexicalDocLike {
  root?: { type?: string }
}

/**
 * Notes created before the rich-text editor stored a plain string in `body`.
 * This guards the viewer/editor against feeding non-Lexical strings to
 * `parseEditorState`, which would throw.
 */
export function isLexicalStateJSON(value: string | null | undefined): boolean {
  if (!value) return false
  const trimmed = value.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const parsed = JSON.parse(trimmed) as LexicalDocLike
    return parsed?.root?.type === 'root'
  } catch {
    return false
  }
}
