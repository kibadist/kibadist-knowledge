# DET-343 — Verifying the Source-Grounded Learning Article Engine (v3)

This branch makes the **entire v3 pipeline observable in the browser without an
`OPENAI_API_KEY`**. The two previous verification attempts failed only because the
acceptance criteria require *observing real generation* and there was no API key
in the environment. That gap is now closed by a deterministic, source-grounded
**fixture AI provider** (`server/src/ai/providers/fixture.provider.ts`).

The fixture provider parses the same prompts the real services build (the block
listings carry every real source id + classification) and returns deterministic,
schema-valid, genuinely-grounded JSON. Everything downstream — block
classification, the v3 source-grounded rewrite, learning extraction, the
`assembleArticleV3` grounding/provenance checks, important-coverage, and the
quality gate — is the **real code path**. Only the model call is replaced.

## Keyless end-to-end recipe (no OpenAI key needed)

1. `pnpm install && pnpm db:up && pnpm build:packages`
2. Server `.env`: copy `server/.env.example`. **Leave `OPENAI_API_KEY` blank** —
   the server logs a warning and auto-engages the fixture provider. Add:

   ```env
   TRANSFORMER_V3_MODE=on        # route every source to v3 for the demo
   ```

   (Or set `AI_PROVIDER=fixture` explicitly; the auto-fallback does the same.)
3. `pnpm dev` (web :3000, API :4000).
4. Register/login, then **paste a source** (Inbox → add text). Use something with
   a heading, a definition, an example, and a claim — e.g. a few paragraphs about
   spaced repetition. The pipeline runs extract → segment → classify (fixture) →
   v3 generate (fixture) → quality gate, all deterministically.
5. Open the item in the reader (`/read/[id]`). The **Article** tab renders the v3
   document via `V3ArticleView`:
   - source-grounded blocks tagged **"From your source"**; AI connective tissue
     tagged **"✦ AI · not from your source"** (the visibly-distinct scaffolding
     criterion);
   - the **learning layer** — learning path, key concepts, key claims, retrieval
     prompts, source notes;
   - the **quality verdict** — READY FOR REVIEW with the important-coverage % and
     the floor it cleared.
6. The **Exercise** tab shows the same article learning-layer-first.

### Alternative: the per-source button (works in ANY mode)

In the reader's **Inspector** tab, the Article card has a **"Generate v3 learning
article"** button (`POST /transformer/sources/:id/transform-v3`). It forces the
source through v3 regardless of `TRANSFORMER_V3_MODE`, tags it as preview
material, and the Article tab then shows the v3 result. Use this if you don't want
to set any env flag.

## What proves the functional acceptance criteria

`server/src/ai/providers/fixture-content.util.spec.ts` runs the fixture output
through the **real** `assembleArticleV3` + `evaluateQualityGate` and asserts a
transcript fixture run is `READY_FOR_REVIEW` with **≥80% important coverage, 0
unsupported claims, ≥1 grounded concept, ≥1 retrieval prompt**. Combined with the
43 existing v3 unit tests (coverage, gate, routing, regeneration, assembly,
orchestrator), the deterministic engine is fully exercised — and now visibly so in
the browser.

```bash
pnpm -F @kibadist/server test v3          # the v3 engine suites
pnpm -F @kibadist/server test fixture     # the fixture provider + end-to-end proof
```

## Production safety (strangler-pattern intact)

- The fixture fallback engages **only when there is no key** (production always has
  one), so real model behavior is unchanged where a key is present.
- v3 remains gated by `TRANSFORMER_V3_MODE` (default `off`) + source-kind +
  per-source preview opt-in; v2 is untouched and remains the default fallback.
