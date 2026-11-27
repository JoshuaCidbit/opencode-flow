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
  advance,
  commitAdvance,
  resolveState,
  stateKey,
  type FlowState,
  type StorageLike,
} from "./state.ts"
import { makeLogger, OnceLog } from "./log.ts"
import { decide, WRITING_TOOLS } from "./gate-decision.ts"
import { renderFor } from "./contract.ts"

const LOG_PREFIX = "[opencode-flow]"

// Único sitio donde vive el prefijo de los logs: OnceLog lo aplica; aquí sólo se usa
// para construir los loggers de arranque, que existen antes de `setup(ctx)`.
const startupLog = new OnceLog(
  { error: (message, extra) => (extra !== undefined ? console.error(message, extra) : console.error(message)) },
  LOG_PREFIX,
)

// `push()` es una función libre, así que necesita su propio guardia de "una vez".
const pushLog = new OnceLog({ error: (message) => console.error(message) }, LOG_PREFIX)

// Memoria de proceso del último error interno del gate (regla 4). /flow status lo muestra.
let lastGateError: string | undefined


// El conjunto único de herramientas de escritura vive en gate-decision.ts. Antes había una
// copia aquí sin `apply_patch`: dos listas distintas son un agujero (lo que una filtra, la
// otra lo cuela).
//
// Importante: `bash` NO está, aunque pueda escribir. Adivinar desde una cadena de comando
// bloquearía demasiado trabajo legítimo; el gate es una barrera de guía, no de seguridad.

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

export { addMissingSkills, loadContract, readBundledSkills }

// The narration line this contract asks for, e.g. "[flow] fase 5 · gate pendiente: evidencia".
const STATE_RE = /\[flow\]\s*fase\s*(\d+)\s*·\s*gate pendiente:\s*([^\n]+)/gi
const UNKNOWN_PHASE = "fase desconocida (revisar historial)"
const UNKNOWN_GATE = "gate no identificado (revisar historial)"

type Disposable = { dispose: () => Promise<void> }

export type Contract = {
  text: string
  /** Ruta efectiva: la de `options.path` si se dio, si no la empaquetada. */
  source: string
}

/**
 * Load the flow contract. A custom path can be supplied through plugin options:
 * { "package": "opencode-flow", "options": { "path": "/abs/flow.md" } }
 *
 * `options.path` afecta de verdad a lo inyectado: si ese archivo no tiene secciones
 * `## Fase N`, no se adivina; se inyecta completo y se avisa una vez.
 */
async function loadContract(options: Record<string, unknown>): Promise<Contract | undefined> {
  const custom = typeof options.path === "string" ? options.path : undefined
  const source = custom ?? DEFAULT_CONTRACT

  try {
    const text = await readFile(source, "utf8")
    if (!text.trim()) {
      startupLog.once("contract-empty", `contrato vacío: ${source}`)
      return undefined
    }
    return { text, source }
  } catch (error) {
    startupLog.once("contract-unreadable", `no pude leer el contrato en ${source}: ${String(error)}`)
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

// Estado para compactación: PRIMERO el estado persistido, y sólo si no hay, la última
// narración del historial. Nunca inventa una fase: si no consta, lo dice.
//
// Antes había dos funciones (`addendum` y `flowAddendum`) con textos casi idénticos que
// podían divergir; ahora hay una sola, con la caída dentro.
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

  const { phase, gate } = lastState(messages)
  return [
    "# Estado del flow (compactación)",
    "Además del contrato de compactación, preserva estos campos en el resumen:",
    `- Fase actual del mapa: ${phase}`,
    `- Gate pendiente: ${gate}`,
    '- Permiso de edición: si consta que el usuario habilitó editar código, dilo; si no consta, escribe "no consta".',
    "No hay estado persistido: estos valores salen de la última narración, no los infieras del contenido.",
    "Si la fase figura como desconocida, no la inventes: dila tal cual.",
  ].join("\n")
}

function push(event: { system?: unknown }, text: string, kind: string): void {
  // Defensive: if the event shape ever changes, never break the native request.
  if (!Array.isArray(event.system)) {
    // Silencio total en lo conversacional: esto va a log, nunca al chat ni al contexto.
    pushLog.once(`push-shape:${kind}`, `forma inesperada en ${kind} (system no es array); omito`)
    return
  }
  event.system.push({ type: "text", text })
}

export { flowAddendum, lastState }

export default Plugin.define({
  id: "opencode-flow",
  async setup(ctx) {
    // A0: logger del runtime si existe; si no, consola. Todo fallo se registra una vez.
    const log = new OnceLog(makeLogger(ctx))

    // Punto 5: sin contrato (falta, está vacío o no se pudo leer) NO se aborta. El gate y las
    // skills siguen funcionando; sólo se pierde la guía en prosa y se avisa una vez.
    const loaded = await loadContract(ctx.options ?? {})
    const contract = loaded?.text
    const contractSource = loaded?.source ?? DEFAULT_CONTRACT
    if (!contract) {
      log.once("no-contract", "sin contrato: uso el brief mínimo derivado de phases.ts. El gate y las skills siguen activos.")
    }

    const registrations: Disposable[] = []

    // Artefact paths resolve against the project, so the gate survives a different cwd.
    const projectRoot = String(ctx.location?.project?.directory ?? ctx.location?.directory ?? process.cwd())

    const storage = ctx.storage as unknown as StorageLike | undefined
    if (!storage) {
      log.once("no-storage", "ctx.storage no disponible; el estado no persistirá entre requests")
    }

    const writeState = async (sessionID: string, state: FlowState): Promise<void> => {
      if (!storage) return
      await storage.set(stateKey(sessionID), state)
    }

    // A5: `readState` es PURO. Resuelve { state, ownerID } sin escribir ni tocar disco
    // más allá de leer storage. El auto-avance lo invoca el llamador, explícito.
    const readState = async (sessionID: string): Promise<{ state: FlowState; ownerID: string } | undefined> => {
      if (!storage) return undefined
      try {
        return await resolveState(
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
      } catch (error) {
        // A4: try/catch en la LECTURA de estado. Nunca rompe la petición nativa.
        log.once("readState", `readState falló: ${String(error)}`)
        return undefined
      }
    }

    // A5: avance explícito. El llamador decide cuándo; sólo escribe si hubo cambio.
    const advanceState = async (
      resolved: { state: FlowState; ownerID: string } | undefined,
    ): Promise<{ state: FlowState; ownerID: string; wrote: boolean } | undefined> => {
      if (!resolved || !storage) return resolved ? { ...resolved, wrote: false } : undefined
      const next = advance(resolved.state, (fase, feature) => satisfied(fase, feature, projectRoot), LAST_PHASE)
      const committed = await commitAdvance(storage, resolved.ownerID, resolved.state, next)
      return { state: committed.state, ownerID: resolved.ownerID, wrote: committed.wrote }
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
        // A5: lectura pura -> avance explícito. La fase ya viene actualizada.
        const resolved = await readState(input.sessionID)
        const moved = await advanceState(resolved)
        // A3: escrituras al dueño; el hijo nunca es dueño del estado.
        const owner = moved?.ownerID ?? input.sessionID
        const previous = moved?.state

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
              text: [
                contextSummary(previous),
                requirement ?? "gate: declarativo",
                ...(lastGateError ? [`AVISO: ${lastGateError}`] : []),
              ].join(" · "),
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
            await ctx.session.prompt({
              sessionID: input.sessionID,
              // Regla 3: es el ÚNICO fallo que se comunica al usuario, y sólo tras su
              // acto explícito (/flow start). Si el runtime no permite el hook, el flow
              // sólo guía: no debe fingir que bloquea.
              text: gateAvailable
                ? phaseBrief(parsed.fase, parsed.feature ?? previous?.feature)
                : `${phaseBrief(parsed.fase, parsed.feature ?? previous?.feature)}\n\nAVISO: gate de escritura no disponible en este runtime: el flow solo guía, no bloquea.`,
            })
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

    // Active: bloque común del contrato + sección de la fase actual, reconstruidos en cada
    // petición (lo inyectado en system NO persiste en el historial).
    // Inactive: total silence. Not even a reminder: the flow is opt-in and stays invisible.
    //
    // A6 (verificado en runtime 2.4.2, sonda en /tmp): `context` y `generate` NO co-disparan
    // en la misma petición; cada uno corresponde a un tipo de petición distinto, y
    // `compaction` sólo se dispara al compactar. Por eso no hay doble inyección por turno.
    // Aun así, si un runtime futuro los disparara ambos, el daño sería texto repetido, no
    // estado corrupto: el hook es de sólo lectura de estado. La dedup fina (marcador en el
    // texto) se pospone a 4e, donde el gate cambia igualmente.
    for (const kind of ["context", "generate"] as const) {
      registrations.push(
        await ctx.session.hook(kind, async (event) => {
          const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")
          const resolved = sessionID ? await readState(sessionID) : undefined
          const moved = await advanceState(resolved)
          const state = moved?.state
          if (!state || !state.active) return

          // Punto 4: el contrato efectivo es el que cargó `options.path` (o el empaquetado).
          // Punto 5: sin contrato, brief mínimo derivado de phases.ts (aviso ya registrado).
          const rendered = contract ? renderFor(contract, state.fase) : undefined
          if (rendered?.degraded) {
            log.once(
              `contract-degraded:${kind}`,
              `el contrato no tiene secciones '## Fase N' (${contractSource}); inyecto el archivo completo como degradación`,
            )
          }
          push(event, rendered?.text ?? phaseBrief(state.fase, state.feature), kind)
        }),
      )
    }

    // Compaction: storage-first addendum, narration line as fallback, never an invented phase.
    registrations.push(
      await ctx.session.hook("compaction", async (event) => {
        const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")
        const resolved = sessionID ? await readState(sessionID) : undefined
        const moved = await advanceState(resolved)
        push(event, flowAddendum(moved?.state, event.messages), "compaction")
      }),
    )

    // Sin spec no hay código. If the runtime has no tool hooks, say so and carry on unarmed
    // rather than breaking the session.
    const gateAvailable = Boolean(ctx.tool && typeof ctx.tool.hook === "function")
    if (!gateAvailable) {
      log.once("no-tool-hook", "ctx.tool.hook no disponible: el gate de escritura queda desactivado")
    } else {
      registrations.push(
        await ctx.tool.hook("execute.before", async (event) => {
          const tool = String((event as { tool?: unknown }).tool ?? "")
          const sessionID = String((event as { sessionID?: unknown }).sessionID ?? "")

          // A5 + regla 4: la decisión se resuelve en orden (filtro -> estado -> falla abierta).
          // Lectura: no toca storage ni disco.
          let resolved: { state: FlowState; ownerID: string } | undefined
          let internalError: unknown
          if (WRITING_TOOLS.has(tool.toLowerCase())) {
            try {
              const base = sessionID ? await readState(sessionID) : undefined
              resolved = await advanceState(base)
            } catch (error) {
              internalError = error
            }
          }

          const decision = decide({
            tool,
            ...(resolved?.state ? { state: resolved.state } : {}),
            ...(internalError !== undefined ? { internalError } : {}),
          })

          if (decision.kind === "free" || decision.kind === "allow") return

          if (decision.kind === "fail-open") {
            // Regla 4: permitir la escritura, registrar una vez y guardar para /flow status.
            lastGateError = `error interno en el gate: ${decision.error}`
            log.once("gate-internal", lastGateError)
            return
          }

          // `evaluate`: toda la política de fases y de rutas vive en gate.ts.
          const state = resolved?.state
          if (!state) return
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

    // Éxito de arranque: nivel debug, nunca una línea visible (regla 2).
    log.debug(
      "startup",
      `contrato ${contract ? `${Buffer.byteLength(contract, "utf8")} bytes desde ${contractSource}` : "AUSENTE (brief mínimo)"}, ${bundled.length} skills empaquetadas, ${storage ? "storage disponible" : "storage NO disponible"}, gate ${gateAvailable ? "armado" : "DESARMADO"}`,
    )
    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
})
