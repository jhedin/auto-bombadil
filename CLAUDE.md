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
