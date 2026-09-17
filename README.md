# auto-bombadil

Steer [Bombadil](https://github.com/antithesishq/bombadil), a property-based
UI fuzzer, with [TypeSafe](https://typesafe.ai)'s Jev model. Jev reads the
code behind each control and answers narrow questions ("can this throw?",
"does it validate input?"), code turns those probabilities plus the observed
state graph into branch weights, and Bombadil samples its next click from
those weights.

Bombadil's specification runtime has no network access, so this is a batch
loop rather than a live one. Every command takes `--app example` (default)
`--app todomvc`, or `--app todomvc-jquery`.

The short path needs no exploratory run first:

1. `npm run auto:weights -- --app todomvc` discovers controls from the app's
   static HTML, maps each to its source, asks Jev about it (cached by code
   hash), propagates risk backwards through links, and writes the app's
   weight table. If a trace from an earlier run exists it is merged in, which
   adds controls that only appear after interaction (rendered list items).
2. `npm run auto:run -- --app todomvc --spec todomvc --time 60s` runs the
   weighted spec. On a violation it prints Bombadil's `--reproduce` command,
   which replays that exact action sequence in seconds instead of exploring
   again.

The full loop adds a baseline and a graph:

- `npm run auto:run -- --app todomvc --time 30s` runs the uniform spec
  without stopping at violations and leaves a trace under `.auto-bombadil/`.
- `npm run auto:graph -- --app todomvc` prints the state graph the trace
  implies: pages, edges, and which edges led to violations.
- `npm run auto:compare -- --app todomvc --runs 4 --time 60s` runs the
  uniform spec and the weighted spec back to back with exit on first
  violation and reports time to first violation.

The committed weight tables (`bombadil/*weights.json`) already carry Jev's
judgments for both apps, so the weighted specs run with no API key at all.

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

**todomvc-jquery** (`examples/todomvc-jquery`): the jQuery TodoMVC from
tastejs/todomvc, dist build with its vendored jQuery, Handlebars, and
Director, unmodified. Same invariants as above.

Both TodoMVC specs use `bombadil/todomvc-actions.ts` instead of Bombadil's
default input generator: short random strings and frequent Enter, which
raises Bombadil from about 1 to about 10 states per second on these apps.

The toggle-all invariant fails on the unmodified ES5 app. The view's `toggleAll`
render command assigns `checked` to the label element instead of the checkbox
input, and the click handler is bound to the label only, so clicking the
checkbox itself changes nothing in the model. Jev, reading the source with no
hint about the bug, gives that control "no direct handler 0.83" and "wrong
update target 0.58", the two facts behind the failure. In the jQuery app the
same control is properly bound through a delegated change handler, and Jev
ranks it last there.

The jQuery app fails a different invariant, `selectedFilterMatchesRoute`:
its "Clear completed" handler sets the in-memory filter to `all` and
re-renders, but leaves the URL at `#/completed` or `#/active`. The view then
shows All while the route says otherwise, and a reload would flip it back.
Jev's first pass did not flag that button, for two reasons worth recording.
None of the questions asked about state kept in two places, so a route-sync
question was added (on this app it is a fit, not a prediction; it is a
prediction for the next app). And the code slice held the line that binds
the handler but not the handler body, because `destroyCompleted` is defined
elsewhere in the file. The linker now follows one hop from a matched line to
the functions it hands off to, and sends files under 12k characters whole.
With the handler visible, Jev scores the button 0.27 on route-sync, the
lowest of any control in the app.

## What Jev is asked

One request per control, all questions in parallel, over the control's
markup and the script excerpts that mention it (`src/judge.ts`):

- crash-type: can it throw or reject unhandled; can it log a console error
- consistency-type: does a handler run for direct interaction with this
  element; does each DOM update target the right element; is every dependent
  view refreshed after the model changes; does a change of displayed view or
  filter also update the route
- unguarded state changes; whether failure needs repeated interaction
- a severity Score with three levels

The linker (`src/link.ts`) sends a script whole when it is under 12k
characters. Larger files are cut to windows around lines that mention the
control's id, classes (with camelCase variants), placeholder, text, or
route, plus one hop to the functions those lines reference. Minified and
vendored scripts are skipped.

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
| `bombadil/todomvc-actions.ts` | Fast input generator for form-driven apps |
| `bombadil/todomvc.ts`, `todomvc-uniform.ts` | Weighted and baseline ES5 TodoMVC specs |
| `bombadil/todomvc-jquery.ts`, `todomvc-jquery-uniform.ts` | Weighted and baseline jQuery TodoMVC specs |
| `src/trace.ts` | Trace to graph |
| `src/link.ts` | Control to code slice, plus deterministic checks (missing link targets) |
| `src/judge.ts` | Jev questions and the judgment cache |
| `src/weights.ts` | Policy: judgments and graph statistics to weights |
| `src/cli.ts` | `serve`, `run`, `graph`, `weights`, `compare` |
| `examples/site` | Example pages from Bombadil's integration tests (MIT) |
| `examples/todomvc` | Reference TodoMVC, vanilla ES5 (MIT) |
| `examples/todomvc-jquery` | Reference TodoMVC, jQuery (MIT) |

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

### TodoMVC, ES5

Two measurements, because the input generator changed in between. Four
runs each, 60 second cap, exit on first violation. Every violation was
`toggleAllReflectsItems`.

With Bombadil's default inputs (long random strings, about 1 state per
second), weights judged from one 30 second uniform run:

| Policy | Runs with a violation | Mean time to first violation | Median | Per run |
| --- | --- | --- | --- | --- |
| Uniform | 3 of 4 | 38.0 s | 48.4 s | timeout, 48.4, 6.8, 58.9 |
| Jev-weighted | 4 of 4 | 13.9 s | 14.1 s | 14.1, 11.5, 2.3, 27.8 |

With the fast input generator (about 10 states per second):

| Policy | Runs with a violation | Mean time to first violation | Median |
| --- | --- | --- | --- |
| Uniform | 4 of 4 | 3.2 s | 3.1 s |
| Jev-weighted | 4 of 4 | 3.4 s | 3.9 s |

So the weights mattered when each action was expensive and stopped mattering
once the fuzzer could brute-force this bug in seconds. That is the honest
shape of the result: steering pays in proportion to how costly a wasted
action is and how rare the bug is. On this app with fast inputs the bug is
three cheap actions from the start, and nothing beats random.

### TodoMVC, jQuery

Four runs each, 60 second cap, fast inputs, weights from the final table
(Clear-completed ranked second, flagged for route sync). Every violation was
`selectedFilterMatchesRoute`.

| Policy | Runs with a violation | Mean time to first violation | Median | Per run |
| --- | --- | --- | --- | --- |
| Uniform | 4 of 4 | 40.3 s | 50.6 s | 58.3, 42.4, 9.9, 50.6 |
| Jev-weighted | 4 of 4 | 33.8 s | 42.2 s | 17.9, 59.4, 42.2, 15.6 |

A small edge for the weights with a spread wide enough that four runs cannot
separate the two. This bug needs a longer sequence than the ES5 one: add a
todo, complete it, switch filter, clear completed, then two seconds with no
filter change. Raising one button's weight by about 1.4x barely changes how
often that sequence occurs. Steering by control is the wrong grain for a
sequence-shaped bug; a policy over paths would be the next step, and the
trace graph already has the data for it.
