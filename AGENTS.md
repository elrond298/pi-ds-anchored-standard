# AGENTS.md

## Project overview

`pi-ds-anchored-standard` targets improved DeepSeek V4 Pro 0813 performance in
Pi. Inspired by
[xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard),
it implements first-request conditioning through Pi's dynamic tool loading:

- the workaround activates only when the current model ID or display name
  contains `deepseek-v4-pro` (case-insensitive); all other models keep ordinary
  Pi behavior;
- a target model's blank-session first provider request uses the exact Minimal
  persona, the Minimal `bash` + `str_replace_editor` schemas, the provider's
  uncapped output budget, and no generated workspace or skill-catalog sections;
- the session restores the exact pre-bootstrap active tool list after its first
  durable promotion signal — first `tool_call` or first assistant `message_end`,
  whichever comes first (`promoteOn: "either"`);
- a bootstrap response ending at `stopReason: "length"` queues exactly one
  hidden steering continuation in the same agent run after promotion;
- the phase is derived from the durable session transcript (any
  assistant/toolResult entry), so resume, fork, and reload preserve it
  without stored state;
- a missing bootstrap tool leaves Pi's ordinary active tool list unchanged;
- the bundled `/trajectory` detector runs only for DeepSeek V4 Pro and reports
  word-frequency diagnostics including `let me`, `I'll` / `I will`, and
  `We'll` / `We will`; they are signals, not proof of successful conditioning.

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
