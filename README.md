# auto-bombadil

Steer [Bombadil](https://github.com/antithesishq/bombadil), a property-based
UI fuzzer, with [TypeSafe](https://typesafe.ai)'s Jev model. Jev reads the
code behind each control and answers narrow questions ("can this throw?",
"does it validate input?"), code turns those probabilities plus the observed
state graph into branch weights, and Bombadil samples its next click from
those weights.

Bombadil's specification runtime has no network access, so this is a batch
loop rather than a live one:

1. `npm run auto:serve` serves `examples/site`, a hub of small pages copied
   from Bombadil's own integration tests (some buggy, some fine).
2. Run Bombadil once with any weights to get a trace:
   `npm run test:ui -- http://127.0.0.1:8765/`.
3. `npm run auto:graph -- bombadil-output/trace.jsonl` prints the state graph
   the trace implies: pages, edges, and which edges led to violations.
4. `npm run auto:weights -- bombadil-output/trace.jsonl` maps every control
   Bombadil saw to its source, asks Jev about it (cached by code hash in
   `.auto-bombadil/`), propagates risk backwards through links, and writes
   `bombadil/weights.json`.
5. Rerun Bombadil. `bombadil/specification.ts` imports the weight table and
   samples clicks proportionally, with a floor so every control stays
   reachable.

`npm run auto:compare -- --runs 4 --time 45s` runs the uniform baseline
(`bombadil/uniform.ts`) and the weighted spec back to back and reports time
to first violation. Set `TYPESAFE_API_KEY` in `.env` first; see
`.env.example`. In a root container also set
`BOMBADIL_EXTRA_ARGS="--no-sandbox --chrome-grant-permissions="` and
`CHROME=/path/to/chromium`.

## Layout

| Path | Purpose |
| --- | --- |
| `bombadil/key.ts` | Stable control identity shared by the spec and the tooling |
| `bombadil/policy.ts` | Click generator that reads a weight table |
| `bombadil/specification.ts` | Weighted spec (imports `weights.json`) |
| `bombadil/uniform.ts` | Baseline spec with equal weights |
| `src/trace.ts` | Trace to graph |
| `src/link.ts` | Control to code slice, plus deterministic checks (missing link targets) |
| `src/judge.ts` | Jev questions and the judgment cache |
| `src/weights.ts` | Policy: judgments and graph statistics to weights |
| `src/cli.ts` | `serve`, `graph`, `weights`, `compare` |
| `examples/site` | Example pages from Bombadil's integration tests (MIT) |

## First measurement

Four runs each, 45 second cap, exit on first violation, wall clock including
browser startup, on the example site with weights judged from one prior
25 second uniform run:

| Policy | Runs with a violation | Time to first violation, mean | Median |
| --- | --- | --- | --- |
| Uniform | 4 of 4 | 5.7 s | 3.4 s |
| Jev-weighted | 4 of 4 | 3.9 s | 2.1 s |

The example site is small and every bug is three clicks from the hub, so
both policies find one quickly and four runs are too few to call the gap
significant. What the weights got right is visible in `bombadil/weights.json`:
the three buggy buttons and the broken link rank at the top, the safe
counters and inputs at the bottom, and hub links inherit the risk of the
pages they lead to. A larger app with rarer bugs is the real test.
