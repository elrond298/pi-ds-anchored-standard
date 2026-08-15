# AGENTS.md

## Project overview

`pi-anchored-standard` is a Pi extension that ports
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)
to pi's dynamic tool loading:

- a blank session exposes only `bash` + `read` + `write` on its first model
  request (`pi.setActiveTools`); `write` is the Pi adaptation for one-shot file
  generation, while callers can explicitly configure the original two-tool set;
- the session promotes to the full registered tool catalog after its first
  durable promotion signal — first `tool_call` or first assistant
  `message_end`, whichever comes first (`promoteOn: "either"`);
- the phase is derived from the durable session transcript (any
  assistant/toolResult entry), so resume, fork, and reload preserve it
  without stored state;
- a missing bootstrap tool degrades to the full catalog instead of leaving
  the model with nothing;
- a bundled trajectory detector (`/trajectory`, `src/detect.ts`) verifies the
  bootstrap is effective via the "let me" word-frequency fingerprint from
  xiaobright/modeltest's DeepSeek V4 trajectory analysis (anchored sessions
  keep `let me` ≈ 0–1, `we`/`let's` dominate).

The package is loaded by Pi from `./src/index.ts` via the `pi.extensions`
field. Core logic lives in `src/phases.ts` (the `createAnchoredStandard`
factory); `src/index.ts` is the entry exporting the default configuration.

## Development

```sh
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```

## Git guidance

Use Conventional Commits for commit messages, for example
`feat: promote on first assistant message`, `fix: degrade to full catalog on
missing bootstrap tool`, or `docs: document minimalPrompt option`.
