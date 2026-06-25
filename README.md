# Cognigy Copilot Chrome Extension

[![CI](https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension/actions/workflows/ci.yml)
[![codecov lib](https://codecov.io/gh/TheHenkelmann/cognigy-copilot-chrome-extension/graph/badge.svg?component=lib)](https://app.codecov.io/gh/TheHenkelmann/cognigy-copilot-chrome-extension/components/lib)
[![codecov](https://codecov.io/gh/TheHenkelmann/cognigy-copilot-chrome-extension/graph/badge.svg)](https://app.codecov.io/gh/TheHenkelmann/cognigy-copilot-chrome-extension)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Chrome extension for [Cognigy.AI](https://www.cognigy.com/) — flow visualization, naming standards, integrity checks, release tooling, and JSON code view embedded directly in the Cognigy UI.

Built as a side project and used daily by **15–20 developers** to ship flows faster with consistent quality.

Severity levels used throughout: **3 = Error**, **2 = Warning**, **1 = Info**.

## Features

### Flow Copilot

- **GoTo / Execute connections** — visualizes links between GoTo and Execute Flow nodes and their target nodes (blue overlay within the same flow; badges on target nodes for incoming jumps from other flows)
- **Nodes recolored by functional group** — background and shape colors in the chart:
  - **Gray** — Debug, Log, Placeholder (subtle)
  - **Slate gray** — Utils (Profile, Context, Analytics, Goals, Ratings, Transcript, Agent Availability, Handover, Search Extract Output)
  - **Purple** — Integration / technical (HTTP Request, Email, Code)
  - **Yellow / gold** — Flow-control branches (Then, Else, Case, Default, On First Execution, Afterwards; If / Switch / Once as yellow SVG shapes)
  - **Green** — Flow control (Start, End, GoTo, Execute Flow, Stop, Sleep, Think, Wait, Trigger Function)
  - **Orange** — Responses (Say, Question, Optional Question, On Question, On Answer, Datepicker)
  - **Blue** — AI / Agents (LLM Prompt, AI Agent Job, Tool Answer; generally nodes whose type contains `ai`, `agent`, or `llm`)

### Naming Convention

- Automatically renames nodes according to the [Naming Convention](#naming-convention) (prefix rules per node type, including `GT_` / `GTW_` / `EX_` for GoTo and Execute Flow)
- Automatically fills analytics steps (`node_` prefix, sanitized)
- **Exception:** Code nodes labeled **"Emit"** are neither renamed nor given an analytics step

### Flow Integrity Check / Auto Bug Recognition

- Detects **[47 bug patterns](#bug-patterns)** at project and flow level (empty configs, dead paths, missing LLM/connection references, extension structure, GoTo/Execute targets, and more)
- Integrity panel in the flow editor (FAB) with severity tabs, auto-fix, dismiss rules, and deep links to affected nodes

### Release Tooling

- **Check tab** — release gate before building:
  - Hard refresh of all flows and nodes from the server
  - Check for errors (severity 3), warnings (severity 2), and info messages (severity 1, excluding naming)
  - Naming convention check with optional Autofix All
  - Run all playbooks in batches of 100 in parallel and wait for task completion
- **Annotate tab** — release name, commit message (max. 500 characters), flow diff against the last snapshot (Monaco side-by-side)
- **Build tab** — create snapshot → package → generate download link → start download; store release metadata locally

### Diff Viewer

- Compares the **current editor state** with **locally stored release snapshots** from release tooling
- Flow list with status (added / removed / changed), Monaco diff editor, snapshot picker in the sidebar

### Code Display

- Additional **Code** tab in the flow editor
- Shows the flow as **structured JSON** in execution order (read-only Monaco) — faster overview, copy/paste, and LLM context
- Fallback textarea plus compact issue diagnostics if Monaco fails to load

## Naming Convention

The naming engine (`inject/naming/naming-engine.js`) applies one of three rules per node type:

| Rule | Meaning |
| ---- | ------- |
| **prefix** | `PREFIX_Description` — e.g. `S_Welcome`, `HTTP_GetUser`, `Q_Age` |
| **static** | Fixed name — e.g. `Start`, `T_default`, `Stop and Return`, `TODO` |
| **custom** | Special logic — e.g. If condition as label, Case value, GoTo/Execute target |

**GoTo / Execute Flow** names reflect the target flow and node:

- GoTo (continue): `GT_[FlowName] …`
- GoTo (wait): `GTW_[FlowName] …`
- Execute Flow: `EX_[FlowName] …`
- Self-reference: `GT_[SELF]` or `EX_[SELF]`

**Analytics steps** are derived from the node label (`node_` + sanitized label, max. 128 characters). Then/Else inherit context from the parent If label.

Extension nodes (not `@cognigy/*`) default to the `EXT_` prefix.

The full rule table lives in `NAMING_RULES` in `inject/naming/naming-engine.js`.

## Bug Patterns

The project-map issue detector (`inject/project-map/issues.js`) implements **47 detection rules**. GoTo and Execute Flow checks share the same seven patterns (with prefix `goto_` or `execute_flow_` respectively).

Chart validation in the integrity panel also reports `gotoExecute` (**severity 3**) and `deadPath` (**severity 2**) at runtime (cross-flow view).

Naming convention violations (`naming_convention_violation`, **severity 1**) are scanned separately and are not counted among the 47 bug patterns.

### Flow structure & configuration

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `dead_path` | 2 | Nodes unreachable at runtime after a terminator (GoTo, Stop, AI Agent Tool Answer) |
| `duplicate_node_label_in_flow` | 1 | Multiple nodes in the same flow share the same label |
| `if_condition_empty` | 2 | If node has no condition and no rule comparison |
| `say_node_empty_payload` | 2 | Say node has no text, data, or channel payload |
| `code_node_empty` | 2 | Active code node has no code content |
| `switch_duplicate_case_value` | 2 | Switch has duplicate case values |

### Context & HTTP

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `add_to_context_missing_key` | 3 | Add To Context node has no key |
| `remove_from_context_missing_key` | 3 | Remove From Context node has no key |
| `http_request_missing_url` | 3 | HTTP Request has no URL |
| `http_request_invalid_payload_json` | 3 | HTTP Request has invalid JSON payload |
| `http_request_invalid_headers_json` | 3 | HTTP Request has invalid headers JSON |
| `http_request_missing_auth_connection` | 3 | HTTP Request uses auth but has no connection |
| `trigger_function_invalid_parameters_json` | 3 | Trigger Function has invalid parameters JSON |

### GoTo & Execute Flow

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `*_missing_flow_node_config` | 3 | No `config.flowNode` set |
| `*_empty_target_flow_reference` | 3 | Empty flow reference |
| `*_target_flow_not_found` | 3 | Target flow does not exist in the project |
| `*_empty_target_node_reference` | 3 | Empty node reference |
| `*_target_node_not_found` | 3 | Target node does not exist in the target flow |
| `*_self_reference` | 3 | Node references itself |
| `*_target_disabled` | 3 | Target node is disabled |

`*` = `goto` or `execute_flow`

### LLM

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `llm_reference_missing` | 3 | LLM slot set but reference missing |
| `llm_reference_not_found` | 3 | LLM reference unknown in the project |
| `llm_used_test_failed` | 3 | Used LLM failed its connection test |
| `llm_used_test_inconclusive` | 3 | Used LLM could not be verified |
| `llm_default_missing` | 3 | LLM-capable nodes exist but no default LLM in the project |
| `llm_unused` | 1 | LLM unused (connection test OK) |
| `llm_unused_test_failed` | 2 | LLM unused, connection test failed |
| `llm_unused_test_inconclusive` | 2 | LLM unused, connection test inconclusive |
| `llm_fallback_reference_missing` | 3 | Fallback LLM reference missing |
| `llm_fallback_reference_not_found` | 3 | Fallback LLM unknown |
| `llm_fallback_test_failed` | 2 | Fallback LLM connection test failed |
| `llm_fallback_test_inconclusive` | 1 | Fallback LLM connection test inconclusive |
| `llm_connection_not_found` | 3 | LLM connection does not exist |
| `llm_connection_deprecated` | 3 | LLM connection is deprecated |

### Extensions & connections

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `extension_missing_required_config_field` | 3 | Required extension config field missing |
| `extension_unexpected_child_slots` | 2 | Unexpected child slots in extension container |
| `extension_missing_child_slot` | 2 | Expected child slot missing |
| `extension_surplus_child_node` | 2 | Surplus child node |
| `extension_unexpected_child_node` | 2 | Unexpected child node |
| `extension_force_child_active` | 2 | Child node forced active |
| `extension_node_type_not_registered` | 3 | Extension node type not registered |
| `extension_connection_type_unavailable` | 3 | Connection type unavailable for extension |
| `extension_connection_removed` | 3 | Referenced connection removed |
| `extension_connection_deprecated` | 3 | Referenced connection deprecated |
| `extension_connection_type_mismatch` | 3 | Connection type does not match extension |

### AI Agent

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `ai_agent_tool_answer_missing_or_empty` | 3 | AI Agent Tool Answer missing or empty |

### Chart validation (integrity panel)

| Pattern | Severity | Description |
| ------- | -------- | ----------- |
| `gotoExecute` | 3 | GoTo or Execute Flow references a missing target flow or node (cross-flow chart check) |
| `deadPath` | 2 | Dead path nodes after terminating nodes in the current flow (chart check) |

## Architecture

```mermaid
flowchart LR
  CS["content.js isolated world"] -->|"injects + postMessage bridge"| INJ["inject.js module loader"]
  INJ --> MOD["inject/* feature modules"]
  CS -->|"chrome.runtime.connect"| SW["background.js service worker"]
  INJ --> MON["Monaco editor vendored"]
  MOD --> PM["project-map IndexedDB cache"]
```

| Layer                  | Role                                                                 |
| ---------------------- | -------------------------------------------------------------------- |
| `content.js`           | Injects page scripts, bridges `postMessage` ↔ `chrome.runtime`       |
| `inject.js`            | Loads feature modules into the page context                          |
| `inject/naming/*`      | Validation engine, naming, integrity UI, chart overlays              |
| `inject/project-map/*` | Flow topology, issue detection, structured JSON builder              |
| `inject/release/*`     | Release/snapshot UI and Cognigy REST API client                      |
| `inject/flow-code/*`   | Code tab, JSON rendering from project map                            |
| `background.js`        | Extension service worker (message routing)                           |

## Supported deployments

Works on Cognigy-hosted and partner-hosted instances:

- `*.cognigy.cloud`
- `*.cognigy.ai`
- `live.ai.telekomcloud.com` (Telekom Cloud partner deployment)

## Install (developer / unpacked)

```bash
git clone https://github.com/TheHenkelmann/cognigy-copilot-chrome-extension.git
cd cognigy-copilot-chrome-extension
npm install
npm run build    # copies Monaco assets → inject/vendor/monaco/
```

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory
4. Open a Cognigy project — the Copilot FAB appears in the flow editor

## Development

```bash
npm run lint          # ESLint
npm run format:check  # Prettier
npm run typecheck     # tsc --checkJs (scoped)
npm run test:coverage # Vitest + coverage
npm run build         # Monaco vendor copy
```

Coverage is split intentionally:

| Scope                                                                     | Role                                               | Gate                                |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------- |
| `lib/**`                                                                  | Extracted, unit-testable core (logger, helpers)    | **90 %+** (Codecov component `lib`) |
| `inject/naming/naming-engine.js`, `inject/project-map/structured-json.js` | Pure-logic inject modules                          | Informational only (`inject-core`)  |
| Remaining `inject/**`                                                     | UI / Chrome integration                            | Not in coverage scope               |

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## Privacy

- **No telemetry** — the extension does not phone home
- **No third-party backend** — API calls go directly to your Cognigy instance
- Cognigy session tokens are intercepted in-page only to call Cognigy's own REST API on your behalf
- Release snapshots and issue dismissals are stored locally (IndexedDB / `localStorage`)

## Permissions

| Permission                            | Why                                          |
| ------------------------------------- | -------------------------------------------- |
| `storage`                             | Persist settings, cached project data, releases locally |
| `*.cognigy.cloud/*`, `*.cognigy.ai/*` | Inject copilot into Cognigy UI               |
| `live.ai.telekomcloud.com/*`          | Telekom Cloud Cognigy deployments            |

## Related projects

- [`cognigy-api-client`](https://github.com/TheHenkelmann/cognigy-api-client) — typed Python SDK for the Cognigy REST API

## License

MIT — see [LICENSE](LICENSE). Cognigy® is a trademark of Cognigy GmbH; this project is community-maintained and not affiliated with Cognigy.

Monaco Editor assets are vendored under MIT — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
