# opencode-flow

Pipeline discipline for OpenCode. A small plugin that injects a **work contract** into every request, so the
agent works in a fixed order, verifies before claiming done, and closes the loop — without relying on the model
remembering to load a skill.

## What it does

| Hook | What is injected |
| --- | --- |
| `context` + `generate` | The full `flow.md` contract (phase map, three gates, checkpoint, verification ladder). |
| `compaction` | A short addendum asking the summarizer to preserve the current phase, the pending gate, and the edit permission. |
| `skills` (setup) | The bundled skills the phase map needs, registered in memory only. |

## Bundled skills

The phase map names skills (`grilling`, `to-spec`, `tdd`, …). Like Superpowers, they ship **inside this package**
under `skills/` and are registered at setup with `ctx.skill.transform`.

- **Add only if missing**: a bundled id is added only when no skill with that id is already registered. Your own
  edited copy in `~/.agents/skills`, or an install from `npx skills`, always wins.
- Nothing is copied to disk. Remove the plugin and the bundled skills disappear with it.
- 14 skills, MIT, taken from [mattpocock/skills](https://github.com/mattpocock/skills) — see `skills/LICENSE`.
- The bundle is read when the plugin loads. If you edit a bundled skill, reload the plugin (restart or touch
  `src/index.ts`).

## Trigger, estado y gate

Phase and gate are persisted **per session** in `ctx.storage` (key `flow:<sessionID>`), so they survive
compaction and are inherited by subagents through `parentID`. The transcript regex is only a fallback.

- **Inactive means silent.** With `active !== true` the plugin injects nothing into `context`/`generate` —
  no reminder, no contract. The flow is opt-in and stays invisible until you run `/flow`.
- **Artifact auto-advance.** In phase 5 the existence of `.scratch/<feature>/spec.md` advances to 6 by
  itself; in phase 6 any `*.md` inside `.scratch/<feature>/issues/` advances to 7. Phases 7-10 are
  declarative and never auto-advance.

## What it does not do

- It never writes project files. Its only durable footprint is its own state in session storage.
- It does not install skills to disk: bundled skills are registered in memory for the lifetime of the plugin.
- It does not change behavior per agent (plan vs build). Plan mode restricts tools by itself; being in build is
  the edit permission.
- It does not touch the message history, only `event.system`.

## Install

Add to `~/.config/opencode/opencode.json` (V2 key is `plugins`, paths must be directories and `~` is not expanded):

```jsonc
{
  "plugins": [
    "github:JoshuaCidbit/opencode-flow"
  ]
}
```

Local development uses an absolute path:

```jsonc
{
  "plugins": ["/home/you/plugins/opencode-flow"]
}
```

Override the contract file:

```jsonc
{
  "plugins": [
    { "package": "opencode-flow", "options": { "path": "/abs/custom-flow.md" } }
  ]
}
```

The default contract is resolved relative to this module (`../flow.md`), so the package works the same locally
and when fetched from git.

## Coexistence

Runs alongside `opencode-compact-notes`. Both push to the same `event.system` array on compaction.

## License

The plugin code is **MIT © JoshuaCidbit** — see [`LICENSE`](./LICENSE).

The 14 bundled skills under `skills/` are **MIT © 2026 Matt Pocock**, from
[mattpocock/skills](https://github.com/mattpocock/skills). Their license is kept verbatim at
[`skills/LICENSE`](./skills/LICENSE). They are redistributed unchanged, in memory only.
