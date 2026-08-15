# pi-ds-anchored-standard

A Pi extension that anchors the first model request with a deliberately minimal
prompt and tool catalog, then restores the normal Pi environment for the rest of
the session.

The design is inspired by
[`xiaobright/dsh-anchored-standard`](https://github.com/xiaobright/dsh-anchored-standard).
This package implements the same first-request conditioning idea using Pi's
extension events and dynamic tool loading.

## What it does

For a blank session, request 1 is reduced to:

| field | value |
|---|---|
| system prompt | `You are a helpful software engineer assistant.` |
| tools | `bash`, `read` |
| output budget | `max_tokens: 1024` |
| messages | the system prompt and current user message only |

Pi's generated workspace instructions, context files, skill catalog, tool
instructions, and later extension prompt additions are excluded from that first
provider request.

The session promotes on the first configured durable signal—the first tool call
or first completed assistant message by default. From the next request onward,
the extension restores:

- the full registered tool catalog;
- Pi's normal system prompt and context;
- prompt additions from other installed extensions;
- the provider's normal output budget.

If the 1024-token bootstrap response ends with `stopReason: "length"`, the
extension promotes and queues one hidden steering continuation inside the same
agent run. This avoids stopping at the bootstrap limit without restarting the
model's work as a separate follow-up turn.

## How it works

The implementation lives in [`src/phases.ts`](src/phases.ts):

1. `session_start` and `before_agent_start` derive the phase from the durable
   transcript and activate either the bootstrap tools or the full catalog.
2. `before_agent_start` captures the normal Pi prompt before temporarily
   replacing it with the minimal persona.
3. `before_provider_request` enforces the final request-1 shape after Pi builds
   the provider payload: exact prompt, tool schemas, message list, and token limit.
4. `tool_call` and `message_end` promote according to `promoteOn`.
5. A length-truncated bootstrap response uses `deliverAs: "steer"` to continue
   once with the restored runtime.

No phase flag is persisted. Any assistant or tool-result entry in the session
transcript means the session is already promoted, so resume, fork, and reload
retain the correct phase. If a configured bootstrap tool is unavailable, the
extension degrades to the full catalog instead of exposing an incomplete set.

## Install

```sh
pi install /path/to/pi-ds-anchored-standard
```

Restart Pi or run `/reload`. For a one-off local run:

```sh
pi -e ./src/index.ts
```

## Configuration

The bundled entry uses these defaults:

```ts
createAnchoredStandard({
  bootstrapTools: ["bash", "read"],
  bootstrapMaxTokens: 1024,
  promoteOn: "either",
  minimalPrompt: ANCHORED_MINIMAL_PROMPT,
});
```

`promoteOn` also accepts `"tool-call"` or `"assistant-message"`.
Set `minimalPrompt: null` only when you intentionally want Pi's normal prompt
and context during the bootstrap request.

## Validation

We ran the same animated-HTML task at `high` and `max` thinking levels with the
full-catalog control, the initial fresh `followUp`, and the final same-run
`steer` continuation.

<table>
<thead><tr><th></th><th>High</th><th>Max</th></tr></thead>
<tbody>
<tr>
<th>Full-catalog control</th>
<td><img src="validation/animated-html/animations/control-high.gif" alt="Control high animation" width="360"></td>
<td><img src="validation/animated-html/animations/control-max.gif" alt="Control max animation" width="360"></td>
</tr>
<tr>
<th>Fresh <code>followUp</code></th>
<td><img src="validation/animated-html/animations/followup-high.gif" alt="Follow-up high animation" width="360"></td>
<td><img src="validation/animated-html/animations/followup-max.gif" alt="Follow-up max blank animation" width="360"></td>
</tr>
<tr>
<th>Same-run <code>steer</code></th>
<td><img src="validation/animated-html/animations/steer-high.gif" alt="Steer high animation" width="360"></td>
<td><img src="validation/animated-html/animations/steer-max.gif" alt="Steer max animation" width="360"></td>
</tr>
</tbody>
</table>

These are the actual browser-rendered outputs from the checked-in runs. The
tested agents generated the HTML without previewing or validating it; each
animation was captured afterward using the same viewport and encoding settings.

Visual inspection found that the fresh `followUp` restarted and simplified the
work: its `max` SVG collapsed to a `0×0` render. Both final `steer` outputs
rendered correctly, showing that same-run continuation preserved the interrupted
work while restoring Pi's full runtime.

The retained evidence under
[`validation/animated-html/`](validation/animated-html/) contains:

- complete sanitized Pi conversations for the six runs that produced artifacts;
- each generated HTML file and its browser screenshot;
- all six browser-recorded animations shown above;
- the sanitizer and SHA-256 manifest.

See the [validation report](validation/animated-html/README.md) for the visual
comparison and sanitization details.

## Trajectory signal

The `/trajectory` command reports `let me`, `we`, and `let's` counts, staged
replies, reasoning-block count, and reasoning-length median. The detector is
inspired by
[`xiaobright/modeltest`'s DeepSeek V4 trajectory analysis](https://github.com/xiaobright/modeltest/blob/main/docs/v4.1/DEEPSEEK_V4_TRAJECTORY_ANALYSIS_20260814.md).

This fingerprint is a diagnostic signal, not proof that bootstrap promotion
worked or failed. It was measured on structured engineering tasks and does not
reliably transfer to creative generation; the animated validation above
produced many `let me` hits despite a verified bootstrap.

## Verify

```sh
npm install
npm test
npm run typecheck
```

The test suite covers phase derivation, exact request-1 shaping, promotion,
prompt/tool restoration, missing-tool degradation, truncation continuation,
and trajectory statistics.

## Notes

- `pi.setActiveTools()` is process-global, so the extension reasserts each
  session's derived phase on every `before_agent_start` event.
- Blocked or failed tool calls still promote because the tool-call signal is
  durable.
- The minimal prompt applies only to the bootstrap request. The captured normal
  Pi prompt returns after promotion.

## License

MIT
