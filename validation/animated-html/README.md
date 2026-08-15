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

![Final anchored max animation](demo.gif)

This animation is a six-second browser recording of the checked-in
[`artifacts/anchored-steer-max/pelican-bicycle.html`](artifacts/anchored-steer-max/pelican-bicycle.html),
converted to a 720-pixel, 10-fps GIF for README playback.

The control and final steering outputs rendered as recognizable animated
pelicans riding bicycles. The fresh follow-up restarted and simplified the
work; its max output produced an SVG root with a `0×0` browser layout, visible
as a blank screenshot.

| run | high | max |
|---|---|---|
| control | [preview](artifacts/control-high/preview.png) | [preview](artifacts/control-max/preview.png) |
| fresh `followUp` | [preview](artifacts/anchored-followup-high/preview.png) | [blank preview](artifacts/anchored-followup-max/preview.png) |
| same-run `steer` | [preview](artifacts/anchored-steer-high/preview.png) | [preview](artifacts/anchored-steer-max/preview.png) |

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
the GIF contain only the requested pelican artwork. [`SHA256SUMS`](SHA256SUMS)
records the sanitized validation bundle.
