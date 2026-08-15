# Animated HTML validation

This directory preserves the visual validation of the same-run steering
continuation in `pi-ds-anchored-standard`.

## Prompt

> Generate an HTML containing an animated SVG of a pelican riding a bicycle. Do not test or validate it yourself.

## Runs retained

All runs used DeepSeek V4 Pro 0813, exposed in Pi as
`deepseek/deepseek-v4-pro`, with the same installed extensions.
The retained runs compare:

- **Ordinary Pi (control):** the extension is disabled. The model receives Pi's
  normal prompt, workspace context, and every enabled tool from the first
  request. This establishes the baseline for comparison.
- **New follow-up turn (first attempt):** the extension limits the first request,
  but a response cut off at 1,024 tokens starts a separate follow-up turn.
- **Continue the same run (current behavior):** the extension limits the first
  request to 1,024 tokens, then resumes interrupted work inside the same agent run
  after restoring Pi's normal prompt, tools, and output limit.
- **30,000-token bootstrap:** the current implementation loaded through
  [`bootstrap-30k.ts`](bootstrap-30k.ts), which only raises
  `bootstrapMaxTokens` from 1,024 to 30,000.

Each configuration was run at `high` and `max` thinking levels.

## Visual result

<table>
<thead><tr><th></th><th>High</th><th>Max</th></tr></thead>
<tbody>
<tr>
<th>Ordinary Pi<br>(extension disabled)</th>
<td><img src="animations/control-high.gif" alt="Ordinary Pi, high thinking" width="360"></td>
<td><img src="animations/control-max.gif" alt="Ordinary Pi, max thinking" width="360"></td>
</tr>
<tr>
<th>New follow-up turn<br>(first attempt)</th>
<td><img src="animations/followup-high.gif" alt="Separate follow-up, high thinking" width="360"></td>
<td><img src="animations/followup-max.gif" alt="Separate follow-up, max thinking" width="360"></td>
</tr>
<tr>
<th>Continue the same run<br>(current behavior)</th>
<td><img src="animations/steer-high.gif" alt="Same-run continuation, high thinking" width="360"></td>
<td><img src="animations/steer-max.gif" alt="Same-run continuation, max thinking" width="360"></td>
</tr>
<tr>
<th>30,000-token bootstrap</th>
<td><img src="animations/bootstrap-30k-high.gif" alt="30,000-token bootstrap, high thinking" width="360"></td>
<td><img src="animations/bootstrap-30k-max.gif" alt="30,000-token bootstrap, max thinking" width="360"></td>
</tr>
</tbody>
</table>

## Token-budget comparison

| Bootstrap limit | Thinking | Duration | Reasoning chars | Tool calls | Visual result |
| ---: | --- | ---: | ---: | ---: | --- |
| 1,024 | `high` | 162.5 s | 36,478 | 3 | baseline |
| 30,000 | `high` | 227.3 s | 44,357 | 3 | worse; rider is disconnected from the pedals |
| 1,024 | `max` | 291.5 s | 57,942 | 3 | baseline |
| 30,000 | `max` | 850.8 s | 182,491 | 1 | cleaner rider, bicycle, and scenery |

Durations run from the user message to the final assistant message. Raising the
limit did not improve performance consistently: both runs were slower, `high`
regressed visually, and the cleaner `max` result cost 2.9× the time and 3.1× the
reasoning text.

## Preserved conversations

[`conversations/`](conversations/) contains the complete Pi JSONL entry sequence
for the eight retained runs, including full reasoning, visible replies, tool calls,
tool results, stop reasons, usage data, the hidden continuation message, and
extension bookkeeping.

```text
control-high.jsonl
control-max.jsonl
anchored-followup-high.jsonl
anchored-followup-max.jsonl
anchored-steer-high.jsonl
anchored-steer-max.jsonl
anchored-30k-high.jsonl
anchored-30k-max.jsonl
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
