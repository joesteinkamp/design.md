# @google/design.md-evals

A small eval harness that asks the question DESIGN.md daily-driving cannot answer:

> When a coding agent is given DESIGN.md as context, do its outputs actually
> honor the design system — and *more* than they would with a different
> context format, or with no context at all?

This package is a **methodology sketch**. It is intentionally small. It runs
end-to-end against deterministic mock agents so the harness shape can be
validated before any model API spend, then provides a clear seam for
plugging in a real model.

---

## What it measures

For each `(design × task × format × agent)` cell the harness:

1. Loads a DESIGN.md fixture from `examples/`.
2. Builds a **context** in one of four formats (the A/B):
   - `designmd` — the full DESIGN.md file (the treatment).
   - `prose` — the markdown body only, frontmatter stripped (control: "is the structured part doing work?").
   - `dtcg` — the same tokens emitted as DTCG `tokens.json` (control: "is *this* format doing the work, vs. any structured tokens?").
   - `none` — empty string (control: "is the agent just doing what it would have done anyway?").
3. Asks an agent to render a task (e.g. "build a marketing hero") given that context.
4. Runs four layers of scoring on the output. Each layer is independently toggleable so you can run the cheap ones in CI and the expensive ones offline.

### Layer 1 — Token extraction (always on)

Pulls colors, font-families, and dimensions from the rendered HTML and compares them to the DESIGN.md frontmatter.

- **`colorScore`** — fraction of distinct hex colors in the output that fall within a perceptual tolerance of *some* declared `colors.*` token.
- **`typographyScore`** — fraction of distinct `font-family` declarations that match a family declared in `typography.*`.
- **`spacingScore`** — fraction of `px` / `rem` dimensions in the output that snap to the declared `spacing` / `rounded` scale.

### Layer 2 — Voice/copy rules (`copy`)

Reuses the existing `@google/design.md/linter` copy descriptors against a synthetic `DesignSystemState` built from the agent's HTML. Buttons, headings, and nav links from the output become virtual components; paragraph text becomes a synthetic prose section. The linter's `bannedTermInProse`, `approvedTermViolation`, `buttonExceedsWordLimit`, `errorPatternViolation`, `casingMismatch`, and `reservedNameForm` rules then run unchanged.

- **`copyScore`** — `1 − findings/labels`, floored at 0.

### Layer 3 — Semantic assertions (`semantic`)

Each `Task` may declare deterministic per-element assertions (e.g. "the `<button>` background must resolve to `{colors.primary}`"). The runner querySelectors the rendered HTML, reads inline `style`, resolves `{tokens.path}` against the frontmatter, and compares with the same color tolerance used by Layer 1.

- **`semanticScore`** — `passed/total` over the task's assertions.

### Layer 4 — Visual fidelity (`screenshot`, `vision`)

Behind opt-in flags. Renders each output to a PNG via Playwright, optionally persists screenshots, and optionally judges visual fidelity with Claude.

- **`structuralScore`** — fraction of `task.expectedElements` selectors that find a match. Always on by default; cheap (no Playwright, just `linkedom`).
- **`visionScore`** — Claude Sonnet 4.6 receives the screenshot, the task prompt, and the DESIGN.md, and returns a 0–1 fidelity score with a one-sentence rationale. Behind `--vision-judge`.

### Aggregate

Aggregate is a weighted mean of *only the subscores that ran*. Disabling a layer drops it from both numerator and denominator so you don't dilute the result. Default weights:

| Layer       | Weight |
|:------------|:------:|
| color       | 0.30 |
| typography  | 0.10 |
| spacing     | 0.10 |
| copy        | 0.15 |
| semantic    | 0.20 |
| structural  | 0.05 |
| vision      | 0.10 |

Aggregating across runs gives a single mean score per format. **The DESIGN.md hypothesis is that `byFormat.designmd.mean.aggregate` ≫ `byFormat.none.mean.aggregate`, and ≥ `byFormat.dtcg` and `byFormat.prose`.**

## Layer flags

```bash
bun run packages/evals/src/index.ts                              # default: copy + semantic + structural
bun run packages/evals/src/index.ts --layers copy,semantic       # custom subset
bun run packages/evals/src/index.ts --screenshots                # render PNGs; no vision judge
bun run packages/evals/src/index.ts --vision-judge               # implies --screenshots; needs ANTHROPIC_API_KEY
```

## What it does not measure (yet)

- **Color distance** — we use sRGB Euclidean distance, not CIEDE2000. Fine for a sketch; swap in `culori` or similar before publishing numbers.
- **Vision-judge prompt rigor** — the judge prompt is a sketch. A real harness would calibrate it against human-rated reference outputs.

## How to run

```bash
bun install                                # from repo root
bun run packages/evals/src/index.ts        # writes eval-report.json
bun run packages/evals/src/index.ts --out reports/2026-04-29.json
```

The default run uses two mock agents:

- `mock-token-aware` — extracts hex codes and font families from the context
  string and uses them. **This is the harness self-test:** with this agent,
  `designmd` and `dtcg` should score high, `prose` lower, `none` zero. If
  they do not, the scorer is broken.
- `mock-off-brand` — ignores context, paints in `#ff00ff`/Comic Sans. Should
  score near zero on every format. Sanity check that the scorer actually
  penalizes wrong outputs.

## How to wire in a real agent

Open `src/agents.ts` and replace the body of `claudeAgent.render`:

```ts
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

export const claudeAgent: Agent = {
  id: 'claude-sonnet-4-6',
  async render(task, context) {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: 'You are a UI engineer. Use only the design system in <design_system>. Output only HTML.',
      messages: [
        { role: 'user', content: `<design_system>\n${context}\n</design_system>\n\n${task.prompt}` },
      ],
    });
    return message.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  },
};
```

Then add it to the `agents` list in `src/index.ts`.

## How to add a task

Append to `TASKS` in `src/tasks.ts`. A good task is one where the right
answer is obvious-on-inspection (you can tell at a glance whether the
output used the brand palette) but where wrong answers are *also* plausible
(the agent has room to drift).

## How to add a fixture

Drop a `DESIGN.md` into `examples/<name>/` and add it to `DEFAULT_DESIGNS`
in `src/index.ts`. Fixtures should span the space of design systems
DESIGN.md is meant to describe — minimal palette, complex ramps,
different typography systems, themed/dark variants.

## Output shape

```json
{
  "startedAt": "...",
  "finishedAt": "...",
  "runs": [{
    "designId": "...", "taskId": "...", "format": "designmd", "agentId": "...",
    "output": "<!doctype html>...",
    "extracted": {...},
    "score": { "colorScore": 1, "typographyScore": 0.33, "spacingScore": 0,
               "copyScore": 0.5, "semanticScore": 1, "structuralScore": 1,
               "aggregate": 0.73 },
    "assertions": [{ "selector": "button", "role": "primary-cta", "passed": true, "detail": "ok" }],
    "copyFindings": [{ "rule": "casing-mismatch", "severity": "warning", "message": "..." }]
  }],
  "byFormat": {
    "designmd": { "count": 18, "mean": { "aggregate": 0.73, "colorScore": ..., "semanticScore": ..., ... } },
    "prose":    { "count": 18, "mean": { "aggregate": 0.24, ... } },
    "dtcg":     { "count": 18, "mean": { "aggregate": 0.71, ... } },
    "none":     { "count": 18, "mean": { "aggregate": 0.24, ... } }
  }
}
```

Diff `byFormat` across runs to detect regressions in the format itself
(e.g. a spec change that makes agents *less* likely to honor tokens).
