# auto-bombadil

Steer [Bombadil](https://github.com/antithesishq/bombadil), a property-based
UI fuzzer, with [TypeSafe](https://typesafe.ai)'s Jev model. Jev reads the
code behind each control and answers narrow questions ("can this throw?",
"does it validate input?"), code turns those probabilities plus the observed
state graph into branch weights, and Bombadil samples its next click from
those weights.

Bombadil's specification runtime has no network access, so this is a batch
loop rather than a live one. Every command takes `--app example` (default)
or `--app todomvc`:

1. `npm run auto:run -- --app todomvc --time 30s` serves the app, runs the
   uniform baseline spec once without stopping at violations, and leaves a
   trace under `.auto-bombadil/`.
2. `npm run auto:graph -- --app todomvc` prints the state graph the trace
   implies: pages, edges, and which edges led to violations.
3. `npm run auto:weights -- --app todomvc` maps every control Bombadil saw
   to its source, asks Jev about it (cached by code hash), propagates risk
   backwards through links, and writes the app's weight table.
4. `npm run auto:compare -- --app todomvc --runs 4 --time 60s` runs the
   uniform spec and the weighted spec back to back with exit on first
   violation and reports time to first violation.

Set `TYPESAFE_API_KEY` in `.env` first; see `.env.example`. In a root
container also set `BOMBADIL_EXTRA_ARGS="--no-sandbox --chrome-grant-permissions="`
and `CHROME=/path/to/chromium`.

## Apps

**example** (`examples/site`): a hub of small pages copied from Bombadil's
integration tests. Three buttons crash after repeated clicks and one link is
broken; the rest are fine. Bombadil's default properties catch all of it.

**todomvc** (`examples/todomvc`): the reference vanilla ES5 TodoMVC from
tastejs/todomvc, unmodified. `bombadil/todomvc-props.ts` adds the classic
invariants: filters show the right items, "N items left" matches, the count
pluralizes, "Clear completed" appears exactly when needed, the toggle-all box
reflects the items, the chrome hides when empty, titles are never blank.

The toggle-all invariant fails on the unmodified app. The view's `toggleAll`
render command assigns `checked` to the label element instead of the checkbox
input, and the click handler is bound to the label only, so clicking the
checkbox itself changes nothing in the model. Jev, reading the source with no
hint about the bug, gives that control "no direct handler 0.83" and "wrong
update target 0.58", the two facts behind the failure.

## What Jev is asked

One request per control, all questions in parallel, over the control's
markup and the script excerpts that mention it (`src/judge.ts`):

- crash-type: can it throw or reject unhandled; can it log a console error
- consistency-type: does a handler run for direct interaction with this
  element; does each DOM update target the right element; is every dependent
  view refreshed after the model changes
- unguarded state changes; whether failure needs repeated interaction
- a severity Score with three levels

`src/weights.ts` combines them: crash and inconsistency each carry 35%,
severity 20%, unguarded state 10%. Links inherit half of their destination's
risk per hop. Controls never clicked get a novelty bonus. Everything sits on
a floor so exploration continues.

## Layout

| Path | Purpose |
| --- | --- |
| `bombadil/key.ts` | Stable control identity shared by the spec and the tooling |
| `bombadil/policy.ts` | Click generator that reads a weight table |
| `bombadil/specification.ts` | Weighted spec for the example site (imports `weights.json`) |
| `bombadil/uniform.ts` | Baseline spec for the example site with equal weights |
| `bombadil/todomvc-props.ts` | TodoMVC invariants |
| `bombadil/todomvc.ts`, `todomvc-uniform.ts` | Weighted and baseline TodoMVC specs |
| `src/trace.ts` | Trace to graph |
| `src/link.ts` | Control to code slice, plus deterministic checks (missing link targets) |
| `src/judge.ts` | Jev questions and the judgment cache |
| `src/weights.ts` | Policy: judgments and graph statistics to weights |
| `src/cli.ts` | `serve`, `run`, `graph`, `weights`, `compare` |
| `examples/site` | Example pages from Bombadil's integration tests (MIT) |
| `examples/todomvc` | Reference TodoMVC, vanilla ES5 (MIT) |

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

### TodoMVC

Four runs each, 60 second cap, exit on first violation, weights judged from
one prior 30 second uniform run. Every violation was `toggleAllReflectsItems`.

| Policy | Runs with a violation | Time to first violation, mean | Median | Per run |
| --- | --- | --- | --- | --- |
| Uniform | 3 of 4 | 38.0 s | 48.4 s | timeout, 48.4, 6.8, 58.9 |
| Jev-weighted | 4 of 4 | 13.9 s | 14.1 s | 14.1, 11.5, 2.3, 27.8 |

The weighted policy was faster in every pair, by 2.7x on average, on a bug
that neither the questions nor the weights were written to target. Still
four runs, so treat the ratio as a signal rather than a measurement. Bombadil
runs slowly on this app (about two states per second) because the default
input generator types long random strings, which is what makes the time
difference visible.
