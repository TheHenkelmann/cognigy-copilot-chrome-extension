# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Diff Viewer: per-side „Projekt“ buttons (between snapshot select and settings) to copy/download the full project flows of that side (not only diffs).
- Diff Viewer search: text/regex filter with ghosted non-matching flows and lines, per-side hit bubbles, scrollbar markers, and version-separated totals (deduped when both sides show the same snapshot).

### Changed

- Diff/project text exports include the flow id in brackets, e.g. `=== Flow: Name [id] (changed) ===`.

## [0.2.0] - 2026-07-16

### Added

- Shared snackbar notifications for release tooling and related overlays.
- YAML emit helpers with a vendored `js-yaml` shim for flow-code export paths.
- Snapshot ↔ endpoint mapping chips/tooltips and snapshot list patching in the Cognigy UI.
- Node-create defaults so newly created nodes pick up naming and analytics conventions immediately.
- Playbook run verdict APIs (`getPlaybookRun` / `listPlaybookRuns`) so release checks report assertion pass/fail, not only task completion.

### Changed

- Branch-child naming for `then` / `else` / `onFirstExecution` / `afterwards` / `onQuestion` / `onAnswer` now inherits analytics context from parent `if` / `once` / `optionalQuestion` labels.
- Release UI and API auth resolution improved for iframe/top-window naming state.
- Expanded GoTo / Execute Flow integrity checks and related unit tests.

## [0.1.0] - 2025-06-25

### Added

- Flow chat (Cmd/Ctrl+I) with Gemini streaming responses and bring-your-own API key.
- Naming and validation engine with issue detection and optional auto-fix.
- Release/snapshot tooling embedded in the Cognigy UI.
- Project map with structured execution-order JSON builder.
- ESLint, Prettier, scoped `tsc --checkJs`, Vitest with coverage, and Codecov CI.

[Unreleased]: https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension/releases/tag/v0.1.0
