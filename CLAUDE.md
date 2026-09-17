# auto-bombadil

## TypeSafe

This project builds AI features with [TypeSafe](https://typesafe.ai): typed
judgments and probabilities from System One models (Jev) that code composes.

- Use the `typesafe-ai` skill in `.claude/skills/typesafe-ai/` whenever a
  feature needs semantic understanding, routing, ranking, extraction, or
  verification. Read the live docs it links to before writing an integration.
- The API key lives in `TYPESAFE_API_KEY` (see `.env.example`). Keep it in an
  untracked `.env`; never commit it or expose it client-side.
- Keep known rules, calculations, and lookups in code. Ask TypeSafe narrow,
  typed questions and let code own the workflow.

## Updating the skill

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai -a claude-code -y
```

## Bombadil (UI property-based testing)

[Bombadil](https://github.com/antithesishq/bombadil) explores the UI
autonomously and checks properties. It is installed as a dev dependency
(`@antithesishq/bombadil`, which bundles the CLI binary and TypeScript types).

- Specification: `bombadil/specification.ts`. It re-exports the browser
  defaults; add domain-specific properties and action generators next to them.
  Manual: https://antithesishq.github.io/bombadil/
- Run against a running app: `npm run test:ui -- http://localhost:3000`.
  Extra CLI flags go after the URL. `BOMBADIL_TIME_LIMIT` overrides the
  default 1 minute. Results land in `bombadil-output/` (gitignored).
- Inspect a run: `npm run inspect:ui`. Type-check specs: `npm run typecheck:ui`.
- Bombadil finds Chromium via the `CHROME` env var or on PATH. In a root
  container pass `--no-sandbox`. With a Chromium older than the one Bombadil
  targets, also pass `--chrome-grant-permissions=` (the default grant list
  includes `local-network`, which older builds reject).

## auto-bombadil loop

See README.md for the full loop. Key points for changes:

- Deterministic facts stay in code (`src/link.ts` checks link targets exist;
  `src/weights.ts` owns the risk formula and the exploration floor). Jev only
  answers narrow questions about a control's source in `src/judge.ts`.
- `bombadil/key.ts` is shared between the spec (runs in Bombadil's embedded
  JS engine, no Node APIs, no network) and the Node tooling. Keep it plain.
- Judgments are cached in `.auto-bombadil/judgments.json` by code hash.
  Changing a question in `src/judge.ts` needs a cache clear to take effect.
- A top-level spec may export only properties and action generators. Keep
  extractor cells unexported (or in a helper module not re-exported with
  `export *`), and call `.named("x")` on cells the tooling reads from the
  trace, since the bundler does not always name them.
- Run `npm run typecheck` before committing. Node runs the `.ts` sources
  directly via type stripping, so avoid enums and parameter properties.
