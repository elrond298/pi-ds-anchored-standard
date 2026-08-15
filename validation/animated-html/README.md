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
  request, then resumes the interrupted work inside the same agent run after
  restoring Pi's normal prompt, tools, and output limit.

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
</tbody>
</table>

In this test, the current behavior produced more detailed and coherent results
than ordinary Pi, especially at `max`. This is one visual example, not a general
benchmark.

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
