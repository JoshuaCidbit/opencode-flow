# opencode-flow

Pipeline discipline for OpenCode. A small plugin that injects a **work contract** into every request, so the
agent works in a fixed order, verifies before claiming done, and closes the loop — without relying on the model
remembering to load a skill.

## What it does

| Hook | What is injected |
| --- | --- |
| `context` + `generate` | The full `flow.md` contract (phase map, three gates, checkpoint, verification ladder). |
| `compaction` | A short addendum asking the summarizer to preserve the current phase, the pending gate, and the edit permission. |

Phase and gate are **rescued from the transcript** with a regex on the narrated line
`[flow] fase N · gate pendiente: X`. If that line never appears, the addendum says
`fase desconocida (revisar historial)` — it never invents state.

## What it does not do

- It never writes to disk. There is no durable state: two terminals cannot contradict each other.
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
