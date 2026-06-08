import { redirect } from 'next/navigation'

/**
 * The standalone Process page is gone (DET-313). Reading IS processing now — the
 * cleaned source, the refined article, and (DET-315) concept extraction all live
 * in the unified /read/[id] document workspace (DET-312). This route forwards
 * there so old links and bookmarks never 404. `[id]` is the inbox item id, the
 * same id /read resolves from, so the redirect is a straight pass-through.
 *
 * The interrogation Q&A this page used to host returns as an OPTIONAL
 * comprehension aid inside the Recall stage (DET-315) — never a mandatory pass.
 */
export default async function LegacyProcessRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/read/${id}`)
}
