# pi-anchored-standard

Bootstrap the first model request with a Minimal-aligned tool catalog, then
expose the full tool catalog — a pi extension port of
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard).

A blank session sees only **`bash` + `read`** on its first model request. After
the session's first durable promotion signal — the first tool call **or** the
first assistant reply, whichever comes first — the full registered tool
catalog is exposed. The phase is derived from the session transcript, so
resume, fork, and `/reload` preserve it.

The original project's rationale: DeepSeek V4 Pro conditions strongly on the
API-visible tool catalog (Project2: Minimal 99/96 vs Standard 91/92). pi's
`pi.setActiveTools()` is the same mechanism — the change applies before the
next model request, with native deferred loading on Anthropic/OpenAI models
that support it.

## Install

```bash
pi install /path/to/pi-anchored-standard
```

Then restart Pi or run `/reload`. For a single run without installing:

```bash
pi -e ./src/index.ts
```

## Behavior

- **Request #1** (blank session): active tools are `bash` + `read` only; pi's
  system prompt shrinks accordingly (its tool list is generated from active
  tools).
- **Promotion**: the first `tool_call` or the first assistant `message_end`
  switches to the full registered catalog before the next model request.
  A blocked or failed tool execution still promotes — it is already durable
  in the transcript.
- **Durability**: any assistant/toolResult entry in the session transcript
  means promoted, so resume/fork/reload never re-bootstrap a session that
  already produced content.
- **Degradation**: a missing bootstrap tool (composition drift) degrades to
  the full catalog instead of leaving the model with no tools.
- **Degradation**: a missing bootstrap tool (composition drift) degrades to
  the full catalog instead of leaving the model with no tools.

## Trajectory detection (`/trajectory`)

Verifies the bootstrap is effective using the word-frequency fingerprint from
[xiaobright/modeltest's DeepSeek V4 trajectory analysis](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1/DEEPSEEK_V4_TRAJECTORY_ANALYSIS_20260814.md):
completed assistant messages (visible text **and** reasoning blocks) are
scanned case-insensitively with word boundaries:

| fingerprint | anchored / minimal | standard |
|---|---:|---:|
| `let me` | 0–1 per task | 208 |
| `we` | 165+ | 11 |
| `let's` | 88+ | 2 |
| staged replies | ~1 | 55 |

- `/trajectory` — notify with current stats (`let me` / `we` / `let's`,
  staged replies, reasoning blocks + p50) and an anchored/DRIFT verdict.
- Drift threshold: ≥ 2 `let me` hits (the analysis saw 0–1 on anchored runs).
  On first crossing, a one-time `warning` notification is shown.
- `createTrajectoryDetector({ driftThreshold })` is exported for custom setups.

A `let me`-heavy session means the bootstrap is not anchoring (extension not
loaded, composition drifted, or the model does not condition on the catalog).

## Options
`minimalPrompt: null` keeps pi's normal system prompt — its tool sections
already shrink to the active catalog, and the catalog is the mechanism the
original eval credits. Set `minimalPrompt: ANCHORED_MINIMAL_PROMPT`
(`"You are a helpful software engineer assistant."`) to also reproduce the
original's minimal complete system prompt on the bootstrap turn.

## Verify

```sh
npm install
npm test
npm run typecheck
```

Manually: start a blank session — the model can only call `bash`/`read`;
after its first reply or tool call, every tool is available.

## Notes

- The original eval effect was measured on DeepSeek V4 Pro (Project2); pi's
  models may condition differently on the catalog.
- `pi.setActiveTools` is process-global; the phase re-asserts on every user
  turn (`before_agent_start`), so session switches self-correct.
- With `minimalPrompt` set, the replacement applies to the bootstrap turn(s)
  only — the full pi prompt returns after promotion.

## License

MIT
