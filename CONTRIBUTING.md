# Contributing

Thanks for your interest in improving Cognigy Copilot.

## Development setup

```bash
npm install
npm run build   # copies Monaco assets into inject/vendor/monaco/
```

Load the unpacked extension from this directory in `chrome://extensions` (Developer mode).

## Quality checks

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:coverage
```

### Coverage policy

- **`lib/**`is the quality gate** — target 90 %+ line coverage (enforced locally via Vitest and on Codecov as the`lib` component).
- **`inject/naming/naming-engine.js`** and **`inject/project-map/structured-json.js`** are included for transparency with partial unit tests; they are informational on Codecov (`inject-core` component), not blocking.
- UI-heavy inject modules (Monaco, release UI, state management) are excluded from coverage — they require browser/integration testing, not shallow unit tests.

## Pull requests

- Keep changes focused and include tests for logic changes in `lib/` or pure inject modules.
- Do not commit `node_modules/` or generated Monaco vendor files.
- Avoid mentioning employers or customer names in code comments or documentation.
