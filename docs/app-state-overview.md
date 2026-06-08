# Kibadist Knowledge — App State Overview

_A UX-oriented map of the app: product concept, information architecture, every screen, the core workflows, and known friction. Generated 2026-06-08 for UX-team analysis. Reflects `main` at this date._

---

## 1. What the product is

A **"Cognitive OS" for learning.** You feed in source material (a URL, PDF, or pasted text); an LLM pipeline ("the transformer") cleans it and reshapes it into a faithful, source-grounded **article**; you then learn the ideas through active reading, retrieval exercises, and spaced review. Concepts you genuinely understand become **earned knowledge** that lives on a concept **Map**, decays over time, and gets reinforced.

**The core promise:** _"Let users read beautifully, but never let reading be the final step."_ Reading is only the on-ramp; the product pushes you from passive reading → active recall → kept, connected, reviewed knowledge.

**Design language:** light-only "editorial manuscript" / paper theme (ISSN-style masthead, §-prefixed mono labels, serif display type). No dark mode by design.

---

## 2. The core loop (mental model)

```
        CAPTURE            READ              RECALL              KEEP               REVIEW
   ┌──────────────┐  ┌─────────────┐  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Add a source │→ │ Source ⇄    │→ │ Predict /      │→ │ Extract a    │→ │ Spaced review│
   │ (URL/PDF/    │  │ Article     │  │ Rewrite /      │  │ concept in   │  │ resurfaces   │
   │  text)       │  │ (read it)   │  │ Compare        │  │ your words   │  │ it on time   │
   └──────────────┘  └─────────────┘  └────────────────┘  └──────────────┘  └──────────────┘
        Sources          Sources            Sources             Sources           Today /
        (inbox)        → Article tab      → Exercise tab      → Exercise tab       Session
```

Wrapping the loop:
- **Tracks** — the goal layer ("understand X", "prepare for Y") that gives the loop intent.
- **Map / Domains** — where earned concepts live and connect.
- **Today / Progress** — the returning-user home and the honest measure of understanding.

---

## 3. Information architecture

### Primary navigation (top bar — the core loop, ≤5 items)

| Nav label | Route | Role |
|-----------|-------|------|
| **Today** | `/today` | Post-login home: "what should I do right now?" (badge: # due to recall) |
| **Sources** | `/inbox` | Capture + triage queue of source material (badge: # unprocessed). _Renamed from "Read" — PR #26._ |
| **Concepts** | `/concepts` | The Concept Library — everything you've earned or are learning |
| **Map** | `/graph` | The concept graph ("The Map") with scope selector |
| **Progress** | `/metrics` | "Understanding" — anti-vanity metrics |

### Secondary surfaces (reachable, off the top bar)

| Surface | Route | Reached from |
|---------|-------|--------------|
| Document workspace | `/read/[id]` | Every Sources/Today row → the main reading+learning screen |
| Tracks (list) | `/tracks` | Today's track panel; the goal-directed entry point |
| Track detail | `/tracks/[id]` | Tracks list |
| Concept detail | `/concepts/[id]` | Concepts list, Map nodes |
| Domains (list / detail) | `/domains`, `/domains/[id]` | Browse semantic regions (secondary to Tracks) |
| Understanding Session | `/session` | Today's "Start session" — the daily 5–15 min recall loop |
| Proof-of-Learning gate | `/inbox/[id]/promote` | The promote/earn flow for a concept |
| Focus / processing mode | `/inbox/process` | One-fragment-at-a-time triage |

### Auth & landing

| Screen | Route |
|--------|-------|
| Landing ("From source to understanding") | `/` |
| Login / Register | `/login`, `/register` |

### Redirects & legacy (no longer their own screens)

| Route | Behavior |
|-------|----------|
| `/transformer` | → redirects to `/inbox` (capture unified into Sources) |
| `/transformer/articles/[articleId]` | → redirects into `/read/[id]` on the right tab/mode |
| `/inbox/[id]` | → redirects to `/read/[id]` (reading IS processing now) |

### Developer-only (not in nav, no real data)

- `/reader/demo`, `/deep-reading/demo` — component story/state pages (the web package has no Storybook; these stand in).

---

## 4. Screen-by-screen

### Today (`/today`) — the home
The returning user's answer to "what now?" Stacked panels: **what's waiting to be read** (top of the Sources queue), the **active Track**, **due reviews**, and a **first-run onboarding walkthrough** for new users. Every reading row opens the document workspace; a progress glyph (read · recalled · kept) shows where each item stands.

### Sources (`/inbox`) — capture + triage
One **"Add a source"** card at the top (paste / link / PDF) and a triage **queue** of captured items below. Each row → the document workspace. This is the single front door for getting material in; the old separate "Transformer" capture flow was folded in here.

### Document workspace (`/read/[id]`) — **the heart of the app**
One screen per source, with three tabs:
- **Source** — the original text, cleaned (noise removed). Readable instantly.
- **Article** — the LLM-generated, source-grounded rewrite as a *worked example to read* (Overview + Deep reading).
- **Exercise** — *active* learning over that article: Predict → Rewrite → Compare (recall), then Extract concept candidates + Spaced review (keep).

A provenance eyebrow (capture source · host · date) sits above the tabs. While the article generates, it shows pipeline progress; if the fidelity check holds it back (BLOCKED) it's still readable with a notice pointing to Source. **Earning a concept happens here** — approving a candidate _in your own words_ promotes the item to real knowledge (the proof-of-learning gate, at low friction).

### Understanding Session (`/session`) — daily recall
The 5–15 minute loop: the system resurfaces earned concepts as questions; you retrieve the answer from memory, then self-grade. Drives the spaced-repetition schedule.

### Concepts (`/concepts`) & Concept detail (`/concepts/[id]`)
The library of units of understanding. Detail view shows a concept's own-words articulations (proof of learning), its connections, and its cognitive state (active/dormant, activation level, decay).

### Map (`/graph`) — "The Map"
The concept graph (nodes = concepts, edges = links) with a **scope selector** (all / domain / track). Where knowledge becomes visibly connected. Read-only over live data.

### Tracks (`/tracks`, `/tracks/[id]`) — the goal layer
"Learn with intent." A track is an ordered, editable plan of concepts with importance, required depth, and per-concept status (candidate → accepted → learning → …). Positioned as the product's primary _intentional_ entry point. Also surfaced via the toolbar Track switcher.

### Domains (`/domains`, `/domains/[id]`) — browse semantic regions
A lighter organize/browse layer that accretes over time; deliberately secondary to Tracks. Detail view = the domain's scoped Map + member concepts.

### Progress (`/metrics`) — "Understanding"
**Anti-vanity metrics**: numbers that only go up when you actually understand *more* (retention, depth, connectedness) — explicitly not streaks/volume vanity stats.

### Proof-of-Learning gate (`/inbox/[id]/promote`)
The four-gate ceremony (articulate → …) that turns a captured fragment into permanent, earned knowledge. _Captured ≠ knowledge._

### Auth/landing
Landing pitches "from source to understanding"; standard login/register.

---

## 5. The transformer pipeline (behind the article)

Capture → **extract & clean** (Readability/unpdf → blocks) → **classify blocks** → **structure model** (faithful inventory of what the source says) → **reshaping plan** (genre-aware layout) → **generate article** (typed v2 blocks) → **fidelity check** (every sentence vs. source; can BLOCK) → optional illustration/learning layers. Every stage is traceable to real source blocks; benign LLM drift is now repaired rather than failing the whole article.

The **pipeline-inspector page** (`/transformer/[sourceId]`) shows live status, the article card with **Transform / Re-run transform**, extraction errors, and a collapsed fidelity/blocks inspector. (See gap #1.)

---

## 6. Known UX gaps & open questions (for the UX team)

1. **Orphaned pipeline inspector.** `/transformer/[sourceId]` (status, re-run transform, fidelity inspector) is no longer linked from anywhere after the Sources refactor — reachable only by typing the URL. Decision needed: surface a "Behind the article" affordance, or treat it as power-user/debug only?
2. **"Source" appears at two levels.** The nav section is **Sources** (the collection); inside a document the first tab is **Source** (the cleaned original). Intentional but worth usability-checking for confusion.
3. **BLOCKED articles.** When the fidelity gate holds an article back, the Article tab is readable but flagged ("read it against the Source"). Is "BLOCKED-but-readable" the right model, or should it be hidden/retried more aggressively?
4. **Transient "Catching up…" state.** A just-generated/regenerating article can briefly show a self-healing "catching up" panel. Validate this reads as "loading," not "broken."
5. **Earning is implicit.** Promotion-to-knowledge happens inside the Exercise tab's Extract step (approve a candidate in your own words), not as an obvious standalone action. Is the "earn" moment legible enough?
6. **Tracks vs. Domains overlap.** Two organizing layers (intentional Tracks vs. emergent Domains) — confirm users understand when to use which.
7. **Demo/dev pages** (`/reader/demo`, `/deep-reading/demo`) are live routes; ensure they're not discoverable by real users.

---

## 7. One-paragraph summary for the deck

> Kibadist Knowledge turns reading into kept knowledge. You add a source (URL/PDF/text) under **Sources**; the app cleans it and generates a faithful **Article**; you read it, then run **Exercises** (predict, rewrite, compare, extract) that push you from recognition to recall and let you **earn** concepts in your own words. Earned concepts live on a **Map**, organized by goal-driven **Tracks**, resurfaced by **spaced review**, and measured by anti-vanity **Progress**. **Today** tells the returning user exactly what to do next. The whole experience is a single editorial, light-only reading environment.
