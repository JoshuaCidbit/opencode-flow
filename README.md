# opencode-flow

Pipeline discipline for OpenCode. A small plugin that injects a **work contract** into every request, so the
agent works in a fixed order, verifies before claiming done, and closes the loop — without relying on the model
remembering to load a skill.

## What it does

| Hook | What is injected |
| --- | --- |
| `context` + `generate` | The contract's common block **plus the section of the current phase**, rebuilt on every active request. |
| `compaction` | A short addendum asking the summarizer to preserve the current phase, the pending gate, and the edit permission. |
| `skills` (setup) | The bundled skills the phase map needs, registered in memory only. |
| `tool` (setup) | The write gate: blocks writes the current phase does not allow (see below). |
| Commands | `/flow …` publishes `opencode-flow.state` (phase, feature, gate) through `session.instructions`. Experimental, see below. |

What is injected in `event.system` does **not** persist in message history, which is why the contract is
re-rendered per request instead of relying on "the first turn".

## Verificación (medida en un servidor OpenCode 2.4.2 aislado)

Lo verificable por API **está medido**, no inferido de los tipos:

- `ctx.session.instructions.entry.put/remove/…` con la key `opencode-flow.state`: se comprobó por HTTP
  (`GET /api/experimental/session/:id/instructions/entries`) que el entry **aparece** al ejecutar
  `/flow start`, **se actualiza en cada cambio de estado** (`next`, `back`, `rename`, `gate`, `resume`,
  auto-avance) y **desaparece** en `/flow off`. Resultado medido post-`start`:
  `opencode-flow.state="[flow] fase 1 · activo · feature auth"`.
- Las respuestas de comando (`help`, `status`, `off`) usan `synthetic` con `resume:false`, NO
  `delivery:"steer"`. Medido en ese servidor: **0 tokens de entrada, 0 de salida, 0 de coste y 0
  mensajes de asistente** por respuesta. Con `steer` se arrancaba un turno real (37-1359 tokens de
  entrada y 3-4 mensajes de asistente). El texto queda en la bandeja de la sesión
  (`type:"synthetic"` en `GET /api/session/:id/inbox`) y se muestra en el siguiente turno.
- Si `synthetic` no existe, cae a `prompt` y registra un aviso una sola vez.

Lo que **sigue sin verificarse** es el render del entry en la TUI: el estado existe y se refresca en
el servidor, pero que la interfaz lo pinte es cosa de OpenCode. Trata esa línea como experimental; el
resto del flow (fases, gate, contrato) no depende de ella.

## Install

Requires **OpenCode 2.4.2 or newer**: below that the runtime does not expose what the plugin needs
(`ctx.session.hook("tool")`, `session.synthetic`, `session.instructions`, `ctx.storage`).

Add to `~/.config/opencode/opencode.json` (V2 key is `plugins`, paths must be directories and `~` is not expanded):

```jsonc
{
  "plugins": ["github:JoshuaCidbit/opencode-flow"]
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
and when fetched from git. If `options.path` points to a file without `## Fase N` sections, the whole file is
injected as a degradation and logged once. If the contract is missing or empty, the plugin still works: it falls
back to a minimal brief derived from `src/phases.ts`, and the gate and skills stay armed.

## Commands

| Command | Effect |
| --- | --- |
| `/flow` | Starts at phase 1 with a provisional slug (`flow-<session tail>`); the gate is armed from the first turn. |
| `/flow <description>` | Starts at phase 1 with a slug derived from the description. |
| `/flow start [N] [slug]` | Starts/continues at phase N; `slug` names the feature. |
| `/flow next` | Advances one phase. |
| `/flow back [N]` | Goes back N phases (default 1); reopens artifacts. |
| `/flow rename <slug>` | Renames the feature; moves `.scratch/<old>/` if it exists and the target does not. |
| `/flow resume [slug]` | Reactivates a stopped flow, optionally adopting another slug. |
| `/flow status` | Phase, pending gate, whether the spec exists, whether it is active. |
| `/flow gate <name>` | Closes the gate and advances. |
| `/flow off` | Deactivates the flow for this session. |
| `/flow help` | Usage. |

`/workflow …` is an alias.

## Trigger, state and gate

Phase and gate are persisted **per session**, so they survive compaction and are inherited by subagents
through `parentID`. The transcript regex is only a fallback. Two storage backends, so a lost session
storage does not lose the flow:

- `ctx.storage` per session (key `flow:<sessionID>`), the primary source.
- `.flow-feature` in the project root, holding `{ slug, createdAt }`. That marker is how the plugin
  notices an in-flight flow on a new session, deduces the earned phase from artifacts on disk
  (`understanding.md` → 2, `glossary.md`/`GLOSSARY.md`/`CONTEXT.md` → 3, `design.md` → 4,
  spec → 6; tickets too → 7), and offers to resume exactly that feature. `/flow resume` says which
  phase it deduced and from which artifact, and points to `/flow back` if that artifact was not
  approved. **Storage wins:** when a phase is stored for the session, resume keeps it and says so.

- **Inactive means silent.** With `active !== true` the plugin injects nothing into `context`/`generate` —
  no reminder, no contract. The flow is opt-in and stays invisible until you run `/flow`.

### Write gate (phases 1-10)

The gate is a filesystem policy, not a guess from file names. It checks every `write`/`edit`/`patch`:

- **Phases 1-6:** only `.scratch/<feature>/**`; in phase 4 also `/tmp/opencode-proto-<feature>/**`.
- **Phases 2-3:** additionally `CONTEXT.md` and `docs/adr/**`, **only if they already existed when `/flow start`
  ran**. That snapshot is stored as `allow: string[]`; creating them later does not open the gate retroactively.
- **Phase 7 and later:** project code, only with `.scratch/<feature>/spec.md` written (and tickets in phase 7).
  Writing the spec/tickets inside `.scratch/` is always allowed, so the gate is never a dead end.
  Tickets are required **only if you committed to them** (`ticketsOpted`): by `/flow next` from a
  phase 6 you actually walked, by `/flow gate tickets`, or when `/flow resume` finds tickets already
  on disk. Resuming straight into 6/7 without tickets records `ticketsOpted:false` (the `tdd` path),
  so nothing demands tickets. Otherwise demanding them would invent a phase 6 you never walked.

Safety hardening: an artifact only closes a gate if it is non-empty and not a placeholder (`README.md`, hidden
files). Paths are resolved and canonicalized (`..` and symlinks that escape the project are blocked), and patches
are all-or-nothing across the allowed set.

### Artifact auto-advance

In phase 5 the presence of a non-empty `.scratch/<feature>/spec.md` advances to 6 by itself; in phase 6 a non-empty,
non-hidden ticket inside `.scratch/<feature>/issues/` advances to 7. Phases 7-10 are declarative and never
auto-advance.

## Contract layout and budget

`flow.md` has a **common block** plus one `## Fase N` section per phase. Only the common block and the current
phase's section are injected. The bundled contract injects at most ~6.4 KB per request measured with the LONGEST
possible slug (60 chars, `baseSlug`'s cut): a test fails if any phase exceeds 7 KB. `src/phases.ts` keeps only
structural data (number, name, skill, closes-with, gate, artifact), and a coherence test fails if the table and
sections diverge.

Two things deliberately live here and NOT in the contract, because they are for maintainers and the contract is
what the model pays for in every request:

- **Silence is opt-in.** When the flow is off the plugin injects nothing — no reminder, no contract. It stays
  invisible until the user types `/flow`. And within each turn the flow is conversational: it guides by asking,
  not by injecting notices.
- **The contract on disk is the active one.** `flow.md` is prose and is the source of truth for behaviour;
  `src/phases.ts` holds only the structural data. If the runtime exposes no tool hooks, the write gate disarms
  itself and says so at startup: it never breaks the session.

## Bundled skills

The phase map names skills (`grilling`, `to-spec`, `tdd`, …). Like Superpowers, they ship **inside this package**
under `skills/` and are registered at setup with `ctx.skill.transform`.

- **Add only if missing**: a bundled id is added only when no skill with that id is already registered. Your own
  edited copy in `~/.agents/skills`, or an install from `npx skills`, always wins.
- Nothing is copied to disk. Remove the plugin and the bundled skills disappear with it.
- 14 skills, MIT, taken from [mattpocock/skills](https://github.com/mattpocock/skills) — see `skills/LICENSE`.
- The bundle is read when the plugin loads. If you edit a bundled skill, reload the plugin (restart or touch
  `src/index.ts`).

## What it does not do

- It does not write project files. The only filesystem change it makes on its own is moving `.scratch/<old>/` to
  `.scratch/<new>/` on an explicit `/flow rename`.
- It does not install skills to disk: bundled skills are registered in memory for the lifetime of the plugin.
- It does not change behavior per agent (plan vs build). Plan mode restricts tools by itself; being in build is
  the edit permission.
- It does not touch the message history, only `event.system`.

## Coexistence

Runs alongside `opencode-compact-notes`. Both push to the same `event.system` array on compaction.

## License

The plugin code is **MIT © JoshuaCidbit** — see [`LICENSE`](./LICENSE).

The 14 bundled skills under `skills/` are **MIT © 2026 Matt Pocock**, from
[mattpocock/skills](https://github.com/mattpocock/skills). Their license is in `skills/LICENSE`.
