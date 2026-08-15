# Animated HTML validation

This directory preserves the visual validation of the same-run steering
continuation in `pi-ds-anchored-standard`.

## Prompt

> Generate an HTML containing an animated SVG of a pelican riding a bicycle. Do not test or validate it yourself.

The tested agents generated their files without previewing or validating them.
Browser rendering and screenshots were performed afterward.

## Runs retained

All runs used `deepseek/deepseek-v4-pro` with the same installed Pi extensions.
The retained runs compare:

- **Control:** normal Pi prompt and full tool catalog from request 1.
- **Follow-up:** a length-truncated bootstrap queued a fresh low-level
  `followUp` run.
- **Steer:** a length-truncated bootstrap queued `steer` inside the same agent
  run, after restoring the normal prompt, tool catalog, and provider budget.

Each configuration was run at `high` and `max` thinking levels.

## Visual result

<table>
<thead><tr><th></th><th>High</th><th>Max</th></tr></thead>
<tbody>
<tr>
<th>Control</th>
<td><img src="animations/control-high.gif" alt="Control high animation" width="360"></td>
<td><img src="animations/control-max.gif" alt="Control max animation" width="360"></td>
</tr>
<tr>
<th>Fresh <code>followUp</code></th>
<td><img src="animations/followup-high.gif" alt="Follow-up high animation" width="360"></td>
<td><img src="animations/followup-max.gif" alt="Follow-up max blank animation" width="360"></td>
</tr>
<tr>
<th>Same-run <code>steer</code></th>
<td><img src="animations/steer-high.gif" alt="Steer high animation" width="360"></td>
<td><img src="animations/steer-max.gif" alt="Steer max animation" width="360"></td>
</tr>
</tbody>
</table>

Each GIF is a four-second browser recording of its checked-in HTML artifact,
converted at 540 pixels and 8 fps using the same viewport and encoding settings.
The control and final steering outputs render as recognizable animated pelicans
riding bicycles. The fresh follow-up restarted and simplified the work; its max
output has a `0×0` SVG layout and therefore appears blank.

## Preserved conversations

[`conversations/`](conversations/) contains the complete Pi JSONL entry sequence
for the six retained runs, including full reasoning, visible replies, tool calls,
tool results, stop reasons, usage data, the hidden continuation message, and
extension bookkeeping.

```text
control-high.jsonl
control-max.jsonl
anchored-followup-high.jsonl
anchored-followup-max.jsonl
anchored-steer-high.jsonl
anchored-steer-max.jsonl
```

## Sanitization

The conversations were derived from the original Pi session files with
[`sanitize-session.mjs`](sanitize-session.mjs). Conversational content is
preserved, while machine-sensitive metadata is transformed:

- session, entry, response, tool-call, and observational-memory IDs become
  deterministic local IDs;
- absolute timestamps become `elapsedMs` relative to the user prompt;
- the workspace path becomes `$WORKSPACE`;
- home-directory paths become `$HOME`.

The source session files are not committed. Generated HTML, screenshots, and
the GIFs contain only the requested pelican artwork. [`SHA256SUMS`](SHA256SUMS)
records the sanitized validation bundle.
