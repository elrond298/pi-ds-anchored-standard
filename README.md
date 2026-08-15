# pi-anchored-standard

Bootstrap the first model request with a Minimal-aligned tool catalog, then
expose the full tool catalog — a pi extension port of
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard).

A blank session's first provider request matches upstream Minimal: the exact
persona system prompt, only **`bash` + `read`**, `max_tokens: 1024`, and no
workspace/skill catalog text. After the first tool call or assistant reply, the
full catalog, normal pi prompt/context, and provider output budget return. The
phase comes from the durable transcript, so resume, fork, and `/reload` preserve
it.

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

- **Request #1 prompt/context**: system prompt is exactly
  `You are a helpful software engineer assistant.`; replacing pi's generated
  prompt removes AGENTS.md/CLAUDE.md and skill-catalog sections.
- **Request #1 tools**: active tools are exactly `bash` + `read`.
- **Request #1 output**: provider payload is capped to `max_tokens: 1024`, the
  upstream reproduction's trajectory-critical budget.
- **Truncation continuation**: if request #1 exhausts that budget, the extension
  queues one hidden steering message so the same agent run resumes its reasoning
  with the restored prompt, tools, and provider budget instead of stopping at
  `stopReason: length`.
- **Promotion**: the first `tool_call` or the first assistant `message_end`
  restores the full registered catalog, provider budget, and Pi prompt before
  the next request, including user-installed tools and extension prompt additions
  (for example `ffgrep` and Ponytail). Blocked or failed tool calls still promote.
- **Durability**: any assistant/toolResult entry in the session transcript
  means promoted, so resume/fork/reload never re-bootstrap a session that
  already produced content.
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
Defaults reproduce upstream: `bootstrapTools: ["bash", "read"]`,
`bootstrapMaxTokens: 1024`, `promoteOn: "either"`, and
`minimalPrompt: ANCHORED_MINIMAL_PROMPT`. Set `minimalPrompt: null` only when
you deliberately want pi's normal bootstrap prompt/context instead.

## Verify

```sh
npm install
npm test
npm run typecheck
```

Manually capture request #1: it must contain only `bash`/`read`, the one-line
Minimal system prompt, the user message, and `max_tokens: 1024`. After its first
reply or tool call, request #2 uses the full catalog and normal provider budget.

## Notes

- The original eval effect was measured on DeepSeek V4 Pro (Project2); pi's
  models may condition differently on the catalog.
- `pi.setActiveTools` is process-global; the phase re-asserts on every user
  turn (`before_agent_start`), so session switches self-correct.
- With `minimalPrompt` set, the replacement applies to the bootstrap turn(s)
  only — the full pi prompt returns after promotion.

## License

MIT
