import { redirect } from 'next/navigation'

/**
 * The Transformer index is gone (DET-300): capture is unified into the single
 * "Add a source" flow on /inbox, and the inbox IS the triage view of captured
 * sources. The two front doors no longer compete, so this route just forwards to
 * the inbox. Source pipeline + article views still live under /transformer/[id]
 * and /transformer/articles/[id], reached from the inbox rows.
 */
export default function TransformerIndexPage() {
  redirect('/inbox')
}
