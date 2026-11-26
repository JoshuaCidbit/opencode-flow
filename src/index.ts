import { readFile } from "node:fs/promises"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import {
  LAST_PHASE,
  badGateMessage,
  help,
  narration,
  parseCommand,
  phase,
  phaseBrief,
  phaseByGate,
  reminder,
  contextSummary,
} from "./phases.ts"
import { satisfied, gateRequirement, verdictFor, writeTarget } from "./gate.ts"
import {
  resolveState,
  stateKey,
  type FlowState,
  type StorageLike,
} from "./state.ts"

const LOG_PREFIX = "[opencode-flow]"

// Only these can change project files. Everything else (read, grep, glob, bash…) is out of scope:
// bash could write, but guessing from a command string would block far too much legitimate work.
const WRITING_TOOLS = new Set(["write", "edit", "patch", "multiedit"])

// Portable default: resolve `flow.md` next to this module, not an absolute home path.
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONTRACT = join(HERE, "..", "flow.md")
const SKILLS_ROOT = join(HERE, "..", "skills")

type BundledSkill = {
  id: string
  name: string
  description?: string
  path: string
  content: string
}

type SkillEditorLike = {
  list(): readonly { id: string }[]
  add(skill: BundledSkill): void
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function frontmatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) return {}
  const block = match[1]
  const name = block.match(/^name:\s*(.+)$/m)?.[1]
  const description = block.match(/^description:\s*(.+)$/m)?.[1]
  return {
    ...(name ? { name: unquote(name) } : {}),
    ...(description ? { description: unquote(description) } : {}),
  }
}

// Skills ship with the plugin (like Superpowers): categories/<id>/SKILL.md.
function readBundledSkills(root: string): BundledSkill[] {
  const found: BundledSkill[] = []
  let categories: string[]
  try {
    categories = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return found
  }

  for (const category of categories) {
    const categoryDir = join(root, category)
    let entries: string[]
    try {
      entries = readdirSync(categoryDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      continue
    }
    for (const id of entries) {
      const path = join(categoryDir, id, "SKILL.md")
      let content: string
      try {
        content = readFileSync(path, "utf8")
      } catch {
        continue
      }
      if (!content.trim()) continue
      const meta = frontmatter(content)
      found.push({
        id,
        name: meta.name ?? id,
        ...(meta.description ? { description: meta.description } : {}),
        path,
        content,
      })
    }
  }
  return found.sort((a, b) => a.id.localeCompare(b.id))
}

// Only adds what is absent: never shadows the user's own edits or `npx skills` installs.
function addMissingSkills(editor: SkillEditorLike, bundled: BundledSkill[]): string[] {
  const existing = new Set(editor.list().map((skill) => String(skill.id)))
  const added: string[] = []
  for (const skill of bundled) {
    if (existing.has(skill.id)) continue
    editor.add(skill)
    added.push(skill.id)
  }
  return added
}

export { addMissingSkills, readBundledSkills }

// The narration line this contract asks for, e.g. "[flow] fase 5 · gate pendiente: evidencia".
const STATE_RE = /\[flow\]\s*fase\s*(\d+)\s*·\s*gate pendiente:\s*([^\n]+)/gi
const UNKNOWN_PHASE = "fase desconocida (revisar historial)"
const UNKNOWN_GATE = "gate no identificado (revisar historial)"

type Disposable = { dispose: () => Promise<void> }

/**
 * Load the flow contract. A custom path can be supplied through plugin options:
 * { "package": "opencode-flow", "options": { "path": "/abs/flow.md" } }
 */
async function loadContract(options: Record<string, unknown>): Promise<string | undefined> {
  const custom = typeof options.path === "string" ? options.path : undefined
  const source = custom ?? DEFAULT_CONTRACT

  try {
    const text = await readFile(source, "utf8")
    if (!text.trim()) {
      console.error(`${LOG_PREFIX} contrato vacío: ${source}`)
      return undefined
    }
    return text
  } catch (error) {
    console.error(`${LOG_PREFIX} no pude leer el contrato en ${source}:`, error)
    return undefined
  }
}

function partText(part: unknown): string {
  if (typeof part === "string") return part
  if (!part || typeof part !== "object") return ""
  const typed = part as { type?: unknown; text?: unknown }
  return typed.type === "text" ? String(typed.text ?? "") : ""
}

// Tolerant to either `content` (current SDK) or `parts` (older shapes).
function messageText(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const typed = message as { parts?: unknown; content?: unknown }
  const raw = Array.isArray(typed.parts) ? typed.parts : Array.isArray(typed.content) ? typed.content : []
  return raw.map(partText).join("\n")
}

// Last narration line wins. With no match we degrade honestly instead of inventing state.
function lastState(messages: unknown): { phase: string; gate: string } {
  let phase = UNKNOWN_PHASE
  let gate = UNKNOWN_GATE
  if (!Array.isArray(messages)) return { phase, gate }

  for (const message of messages) {
    for (const match of messageText(message).matchAll(STATE_RE)) {
      phase = `fase ${match[1]}`
      gate = (match[2] ?? "").trim() || UNKNOWN_GATE
    }
  }
  return { phase, gate }
}

function addendum(messages: unknown): string {
  const { phase, gate } = lastState(messages)
  return [
    "# Estado del flow (compactación)",
    "Además del contrato de compactación, preserva estos tres campos en el resumen:",
    `- Fase actual del mapa: ${phase}`,
    `- Gate pendiente: ${gate}`,
    '- Permiso de edición: si consta que el usuario habilitó editar código, dilo; si no consta, escribe "no consta".',
    "Si la fase figura como desconocida, no la infieras del contenido: dila tal cual.",
  ].join("\n")
}

function push(event: { system?: unknown }, text: string, kind: string): void {
  // Defensive: if the event shape ever changes, never break the native request.
  if (!Array.isArray(event.system)) {
    console.error(`${LOG_PREFIX} forma inesperada en ${kind} (system no es array); omito`)
    return
  }
  event.system.push({ type: "text", text })
}

export { addendum, flowAddendum, lastState }

// Storage first, narration line as fallback. It never invents a phase.
function flowAddendum(state: FlowState | undefined, messages: unknown): string {
  if (state) {
    return [
      "# Estado del flow (compactación)",
      "Además del contrato de compactación, preserva estos campos en el resumen:",
      `- Fase actual del mapa: fase ${state.fase}`,
      `- Gate pendiente: ${state.gate ?? "checkpoint aprobado por el usuario"}`,
      `- Feature: ${state.feature ?? "no declarada"}`,
      `- Flow activo: ${state.active ? "sí" : "no"}`,
    ].join("\n")
  }
  return addendum(messages)
}

export default Plugin.define({
  id: "opencode-flow",
  async setup(ctx) {
    const contract = await loadContract(ctx.options ?? {})
    if (!contract) return

    const registrations: Disposable[] = []

    // Artefact paths resolve against the project, so the gate survives a different cwd.
    const projectRoot = String(ctx.location?.project?.directory ?? ctx.location?.directory ?? process.cwd())

    const storage = ctx.storage as unknown as StorageLike | undefined
    if (!storage) {
      console.error(`${LOG_PREFIX} ctx.storage no disponible; el estado no persistirá entre requests`)
    }

    const writeState = async (sessionID: string, state: FlowState): Promise<void> => {
      if (!storage) return
      await storage.set(stateKey(sessionID), state)
    }

    // Auto-advance: the artifact already on disk IS the user's act, so asking them to type
    // `/flow gate spec` is ceremony. Only file-verifiable phases (5, 6) move; 7-10 stay put.
    const advance = (state: FlowState): FlowState | undefined => {
      if (!state.active || !state.feature) return undefined
      if (!satisfied(state.fase, state.feature, projectRoot)) return undefined
      const next = state.fase >= LAST_PHASE ? state.fase : state.fase + 1
      if (next === state.fase) return undefined
      const entry = phase(next)
      return {
        fase: next,
        ...(entry?.gate ? { gate: entry.gate } : {}),
        ...(state.feature ? { feature: state.feature } : {}),
        active: true,
      }
    }

    // A3: `readState` resuelve estado Y dueño. Las escrituras van al dueño (ownerID),
    // nunca al hijo, para que un subagente no pueda avanzar fases al margen del padre.
    const readState = async (sessionID: string): Promise<{ state: FlowState; ownerID: string } | undefined> => {
      if (!storage) return undefined
      const base = await resolveState(
        storage,
        async (id) => {
          try {
            const info = (await ctx.session.get({ sessionID: id })) as { parentID?: string | null } | undefined
            return info ?? undefined
          } catch {
            return undefined
          }
        },
        sessionID,
      )
      if (!base) return undefined
      const moved = advance(base.state)
      if (!moved) return base
      try {
        await writeState(base.ownerID, moved)
      } catch {
        return base
      }
      return { state: moved, ownerID: base.ownerID }
    }

    // `/flow` is a user act, not a model decision. Same logic for both names: there is no alias field.
    if (ctx.command) {
      const execute = async (input: { sessionID: string; prompt?: unknown }): Promise<void> => {
        const root = input.prompt
        const text =
          typeof root === "string"
            ? root
            : typeof (root as { text?: unknown } | undefined)?.text === "string"
              ? (root as { text: string }).text
              : ""
        const parsed = parseCommand(text ?? "")
        const resolved = await readState(input.sessionID)
        // A3: escrituras al dueño; el hijo nunca es dueño del estado.
        const owner = resolved?.ownerID ?? input.sessionID
        const previous = resolved?.state

        switch (parsed.kind) {
          case "help":
            await ctx.session.prompt({ sessionID: input.sessionID, text: parsed.reason ? `${parsed.reason}\n\n${help()}` : help() })
            return
          case "bad-gate":
            await ctx.session.prompt({ sessionID: input.sessionID, text: badGateMessage(parsed.name) })
            return
          case "off":
            await writeState(owner, { fase: previous?.fase ?? 1, ...(previous?.gate ? { gate: previous.gate } : {}), ...(previous?.feature ? { feature: previous.feature } : {}), active: false })
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: `${narration(previous?.fase ?? 1, "flow desactivado")}\nFlow desactivado para esta sesión. Reactiva con /flow start [N] [slug].`,
            })
            return
          case "status": {
            if (!previous || !previous.active) {
              await ctx.session.prompt({ sessionID: input.sessionID, text: reminder() })
              return
            }
            const requirement = gateRequirement(previous.fase, previous.feature, projectRoot)
            await ctx.session.prompt({
              sessionID: input.sessionID,
              text: [contextSummary(previous), requirement ?? "gate: declarativo"].join(" · "),
            })
            return
          }
          case "gate": {
            const target = phaseByGate(parsed.gate)
            if (!target) {
              await ctx.session.prompt({ sessionID: input.sessionID, text: badGateMessage(parsed.gate) })
              return
            }
            const next = target.n >= LAST_PHASE ? target.n : target.n + 1
            const nextPhase = phase(next)
            const gate = nextPhase?.gate
            await writeState(owner, {
              fase: next,
              ...(gate ? { gate } : {}),
              ...(previous?.feature ? { feature: previous.feature } : {}),
              active: true,
            })
            await ctx.session.prompt({ sessionID: input.sessionID, text: phaseBrief(next, previous?.feature) })
            return
          }
          case "start": {
            const entry = phase(parsed.fase)
            const gate = entry?.gate
            await writeState(owner, {
              fase: parsed.fase,
              ...(gate ? { gate } : {}),
              ...(parsed.feature ?? previous?.feature ? { feature: parsed.feature ?? previous?.feature } : {}),
              active: true,
            })
            await ctx.session.prompt({ sessionID: input.sessionID, text: phaseBrief(parsed.fase, parsed.feature ?? previous?.feature) })
            return
          }
        }
      }

      registrations.push(
        await ctx.command.transform((editor) => {
          editor.add({ name: "flow", description: "Activa el mapa de fases y su gate por artefacto", execute })
          editor.add({ name: "workflow", description: "Alias de /flow", execute })
        }),
      )
    }

    // Active: the rules of the phase, once per turn — the narration instruction inside them must
    // survive compaction, which `ctx.session.prompt` history does not.
    // Inactive: total silence. Not even a reminder: the flow is opt-in and stays invisible.
    for (const kind of ["context", "generate"] as const) {
      registrations.push(
        await ctx.session.hook(kind, async (event) => {
          const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")
          const resolved = sessionID ? await readState(sessionID) : undefined
          const state = resolved?.state
          if (!state || !state.active) return
          push(event, phaseBrief(state.fase, state.feature), kind)
        }),
      )
    }

    // Compaction: storage-first addendum, narration line as fallback, never an invented phase.
    registrations.push(
      await ctx.session.hook("compaction", async (event) => {
        const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")
        const resolved = sessionID ? await readState(sessionID) : undefined
        push(event, flowAddendum(resolved?.state, event.messages), "compaction")
      }),
    )

    // Sin spec no hay código. If the runtime has no tool hooks, say so and carry on unarmed
    // rather than breaking the session.
    const gateAvailable = Boolean(ctx.tool && typeof ctx.tool.hook === "function")
    if (!gateAvailable) {
      console.error(`${LOG_PREFIX} ctx.tool.hook no disponible: el gate de escritura queda desactivado`)
    } else {
      registrations.push(
        await ctx.tool.hook("execute.before", async (event) => {
          const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")
          const resolved = sessionID ? await readState(sessionID) : undefined
          const state = resolved?.state
          if (!state || !state.active) return

          const tool = String((event as { tool?: unknown }).tool ?? "")
          // The hook fires for every tool. Only writing tools interest us; reading stays free.
          if (!WRITING_TOOLS.has(tool.toLowerCase())) return
          const target = writeTarget(tool, (event as { input?: unknown }).input, projectRoot)
          const verdict = verdictFor(
            { projectRoot, fase: state.fase, ...(state.feature ? { feature: state.feature } : {}) },
            target,
          )
          if (verdict.allow) return
          throw new Error(`GATE: ${verdict.reason}`)
        }),
      )
    }

    // Bundled skills: registered in memory only; disk copies (user's or npx) win.
    const bundled = readBundledSkills(SKILLS_ROOT)
    if (bundled.length > 0 && ctx.skill && typeof ctx.skill.transform === "function") {
      registrations.push(
        await ctx.skill.transform((editor) => {
          addMissingSkills(editor as unknown as SkillEditorLike, bundled)
        }),
      )
    }

    console.log(`${LOG_PREFIX} contrato cargado (${Buffer.byteLength(contract, "utf8")} bytes), ${bundled.length} skills empaquetadas, ${storage ? "storage disponible" : "storage NO disponible"}, gate ${gateAvailable ? "armado" : "DESARMADO"}`)
    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
})
