/**
 * The strict per-user rate limit applied to paid, OpenAI-backed endpoints
 * (DET-207). Matches the named `ai` throttler registered in app.module so the
 * limit lives in one place and is shared verbatim across every AI controller.
 *
 * Usage: `@Throttle(AI_THROTTLE)` on the paid handler.
 */
export const AI_THROTTLE = { ai: { limit: 20, ttl: 60_000 } } as const
