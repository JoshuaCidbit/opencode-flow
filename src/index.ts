import { readFile } from "node:fs/promises"
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import {
  FIRST_PHASE,
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
import { adoptsTickets, nextTicketsOpted, resumeTicketsOpted, satisfied, gateRequirement, verdictFor, writeTarget } from "./gate.ts"
import {
  advance,
  buildState,
  commitAdvance,
  noticeAdvance,
  resolveState,
  stateKey,
  type FlowState,
  type StateSeed,
  type StorageLike,
} from "./state.ts"
import { makeLogger, OnceLog } from "./log.ts"
import { decide, WRITING_TOOLS } from "./gate-decision.ts"
import { renderFor } from "./contract.ts"
import { provisionalSlug } from "./slug.ts"
import { reply, syncStateEntry, offMessage } from "./visibility.ts"
import { deducePhaseInfo, readFeatureMarker, writeFeatureMarker } from "./feature.ts"

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

// Skills ship with the plugin (like Superpowers): categories/<id>/SKILL.md.
//
// A9: admite frontmatter multilínea (`description: >-`, bloques `|` y listas). Un YAML
// real no cabe en una sola línea; el parser anterior partía descripciones en cuanto
// había un salto de línea. Sigue siendo deliberadamente mínimo: sólo lee `name` y
// `description`, y prefiere no devolver nada antes que devolver basura.
function frontmatter(text: string): { name?: string; description?: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
  if (!match) return {}
  const block = match[1]

  let name: string | undefined
  let description: string | undefined

  for (const raw of block.split(/\r?\n/)) {
    // Sólo claves en la columna 1: dentro de un bloque multilínea la sangría manda.
    if (/^\s/.test(raw)) continue
    const separator = raw.indexOf(":")
    if (separator === -1) continue
    const key = raw.slice(0, separator).trim()
    const value = raw.slice(separator + 1).trim()
    if (key !== "name" && key !== "description") continue

    const unquoted = unquote(value)
    // Indicador de bloque (>, >-, |, |-): el contenido son las líneas siguientes.
    if (/^[>|][-+]?$/.test(unquoted)) {
      const body = collectBlock(block, raw)
      if (body) {
        if (key === "name") name = body
        else description = body
      }
      continue
    }
    if (unquoted && key === "name" && name === undefined) name = unquoted
    if (unquoted && key === "description" && description === undefined) description = unquoted
  }

  return {
    ...(name ? { name } : {}),
    ...(description ? { description } : {}),
  }
}

/** Junta las líneas sangradas que siguen a un indicador de bloque. */
function collectBlock(block: string, header: string): string | undefined {
  const lines = block.split(/\r?\n/)
  const start = lines.indexOf(header)
  if (start === -1) return undefined
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") break
    if (!/^\s/.test(line)) break
    body.push(line.trim())
  }
  const joined = body.join(" ").replace(/\s+/g, " ").trim()
  return joined || undefined
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
// Devuelve los ids añadidos; `ceded` son los que ya existían (no se tocan).
export function addMissingSkills(
  editor: SkillEditorLike,
  bundled: BundledSkill[],
): { added: string[]; ceded: string[] } {
  const existing = new Set(editor.list().map((skill) => String(skill.id)))
  const added: string[] = []
  const ceded: string[] = []
  for (const skill of bundled) {
    if (existing.has(skill.id)) {
      ceded.push(skill.id)
      continue
    }
    editor.add(skill)
    // A9: se añade al conjunto EN EL BUCLE. Si dos empaquetados compartieran id, el
    // segundo se cedería en vez de registrar un duplicado.
    existing.add(skill.id)
    added.push(skill.id)
  }
  return { added, ceded }
}

export { loadContract, readBundledSkills }

/** Gate B: rutas escribibles en fases 2-3 SÓLO si existían al tomar la foto. */
const ALLOWABLE_PATHS = ["CONTEXT.md", "docs/adr"]

/**
 * Gate B: foto de las rutas heredables que EXISTEN ahora.
 * Se toma en cada punto de partida — `/flow start`, `/flow resume` y `/flow back` — para que
 * la lista refleje la realidad de ESE momento. Dentro de una misma ejecución queda
 * congelada en `state.allow`: crear `CONTEXT.md` más tarde no abre el gate.
 */
export function snapshotAllow(projectRoot: string): string[] {
  return ALLOWABLE_PATHS.filter((name) => existsSync(join(projectRoot, name)))
}

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
      // Punto (b): el entry visible se refresca en CADA cambio de estado, incluido el
      // auto-avance. Si el runtime no lo expone, syncStateEntry devuelve false y seguimos.
      if (committed.wrote) {
        await syncStateEntry(ctx.session as never, resolved.ownerID, committed.state)
        // Punto (g): si la fase subió sola (escribió el artefacto), hay que decirlo.
        const notice = noticeAdvance(resolved.state, committed.state)
        if (notice) log.once(`advance:${resolved.ownerID}`, notice)
      }
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
        // Gate B: lo que existía al hacer `/flow start`; se arrastra en cada transición.
        const inheritedAllow = previous?.allow ? { allow: previous.allow } : {}

        /**
         * Único camino de escritura de un cambio de estado: persiste y sincroniza el entry
         * de instructions (punto 1b: "en cada cambio de estado", no sólo en start/off).
         */
        const commit = async (seed: StateSeed): Promise<FlowState> => {
          const state = buildState(seed)
          await writeState(owner, state)
          await syncStateEntry(ctx.session as never, input.sessionID, state)
          return state
        }

        switch (parsed.kind) {
          case "help":
            await reply(ctx.session as never, input.sessionID, parsed.reason ? `${parsed.reason}\n\n${help()}` : help())
            return
          case "bad-gate":
            await reply(ctx.session as never, input.sessionID, badGateMessage(parsed.name))
            return
          case "off": {
            // No usa `commit`: apagar significa BORRAR el entry, no escribir otro.
            await writeState(owner, buildState({ fase: previous?.fase ?? 1, ...(previous?.gate ? { gate: previous.gate } : {}), ...(previous?.feature ? { feature: previous.feature } : {}), ...inheritedAllow, active: false }))
            // Punto (b): el entry desaparece al apagar. Si el runtime no expone la API,
            // seguimos: el silencio del flow ya es la señal.
            await syncStateEntry(ctx.session as never, input.sessionID, undefined)
            await reply(
              ctx.session as never,
              input.sessionID,
              offMessage(previous),
            )
            return
          }
          case "status": {
            if (!previous || !previous.active) {
              await reply(ctx.session as never, input.sessionID, reminder())
              return
            }
            const requirement = gateRequirement(previous.fase, previous.feature, projectRoot, previous.ticketsOpted)
            await reply(
              ctx.session as never,
              input.sessionID,
              [
                contextSummary(previous),
                requirement ?? "gate: declarativo",
                ...(lastGateError ? [`AVISO: ${lastGateError}`] : []),
              ].join(" · "),
            )
            return
          }
          case "gate": {
            const target = phaseByGate(parsed.gate)
            if (!target) {
              await reply(ctx.session as never, input.sessionID, badGateMessage(parsed.gate))
              return
            }
            const next = target.n >= LAST_PHASE ? target.n : target.n + 1
            const nextPhase = phase(next)
            const gate = nextPhase?.gate
            await commit({
              fase: next,
              ...(gate ? { gate } : {}),
              ...(previous?.feature ? { feature: previous.feature } : {}),
              // Cerrar la puerta de tickets ES comprometerse con ellos, aunque un resume
              // previo hubiera fijado `ticketsOpted:false`.
              ...(target.n === 6 ? { ticketsOpted: true } : previous?.ticketsOpted === undefined ? {} : { ticketsOpted: previous.ticketsOpted }),
              ...inheritedAllow,
              active: true,
            })
            await reply(ctx.session as never, input.sessionID, phaseBrief(next, previous?.feature))
            return
          }
          case "start": {
            const entry = phase(parsed.fase)
            const gate = entry?.gate
            // Gate B: se congela lo que EXISTÍA ahora. Si se crea CONTEXT.md después,
            // no se cuela: el gate no se abre a posteriori.
            const allow = snapshotAllow(projectRoot)
            // C1: sin slug explícito se usa el provisional del sessionID. Así el gate
            // funciona desde el primer turno sin obligar a bautizar la feature.
            const explicit = parsed.feature
            // Punto (e): si no hay estado ni slug explícito pero hay UN marcador en disco,
            // se OFRECE retomarlo (adoptando el slug) en vez de arrancar una feature nueva
            // inventada. Es la única huella de un flow anterior en este proyecto.
            const marker = !explicit && !previous ? readFeatureMarker(projectRoot) : undefined
            const feature = explicit ?? previous?.feature ?? marker?.slug ?? provisionalSlug(input.sessionID)
            const provisional = !explicit && !previous?.feature && !marker
            // Uniforme con resume: si ya hay tickets en disco, se adoptan (lo escrito manda).
            const ticketsOpted = previous?.ticketsOpted ?? (adoptsTickets({ feature }, projectRoot) ? true : undefined)
            await commit({
              fase: parsed.fase,
              ...(gate ? { gate } : {}),
              feature,
              ...(provisional ? { slugProvisional: true } : {}),
              ...(ticketsOpted === undefined ? {} : { ticketsOpted }),
              ...(allow.length > 0 ? { allow } : {}),
              active: true,
            })
            // Punto (e): el marcador en la raíz deja huella en disco para retomar sin storage.
            writeFeatureMarker(projectRoot, feature)
            const offer = marker ? `[flow] he encontrado .flow-feature: retomo "${marker.slug}" (creado ${marker.createdAt}).\n` : ""
            await reply(
              ctx.session as never,
              input.sessionID,
              // Regla 3: es el ÚNICO fallo que se comunica al usuario, y sólo tras su
              // acto explícito (/flow start). Si el runtime no permite el hook, el flow
              // sólo guía: no debe fingir que bloquea.
              `${offer}${gateAvailable
                ? phaseBrief(parsed.fase, feature)
                : `${phaseBrief(parsed.fase, feature)}\n\nAVISO: gate de escritura no disponible en este runtime: el flow solo guía, no bloquea.`}`,
            )
            return
          }
          case "next": {
            if (!previous || !previous.active) {
              await reply(ctx.session as never, input.sessionID, reminder())
              return
            }
            const next = Math.min(previous.fase + 1, LAST_PHASE)
            const entry = phase(next)
            // Puerta 7: si se pasa por la 6 (o se llega a la 7 viniendo de ella), los
            // tickets SÍ son requisito: el usuario eligió el camino con tickets. Pero un
            // `false` explícito (resume en 6/7 sin tickets) se conserva: camino tdd.
            // El tri-estado evita que un resume/start posterior convierta tdd en compromiso.
            const opted = nextTicketsOpted(previous, projectRoot)
            await commit({
              fase: next,
              ...(entry?.gate ? { gate: entry.gate } : {}),
              ...(previous.feature ? { feature: previous.feature } : {}),
              ...(previous.slugProvisional ? { slugProvisional: true } : {}),
              ...(opted === undefined ? {} : { ticketsOpted: opted }),
              ...inheritedAllow,
              active: true,
            })
            await reply(
              ctx.session as never,
              input.sessionID,
              next === previous.fase
                ? `${narration(next, entry?.gate ?? "ninguno")}\nYa estás en la fase ${LAST_PHASE}; no hay siguiente.`
                : phaseBrief(next, previous.feature),
            )
            return
          }
          case "back": {
            if (!previous || !previous.active) {
              await reply(ctx.session as never, input.sessionID, reminder())
              return
            }
            const target = Math.max(FIRST_PHASE, previous.fase - parsed.steps)
            const entry = phase(target)
            // Punto 4: retroceder también es un nuevo punto de partida: se recalcula la foto.
            const allow = snapshotAllow(projectRoot)
            await commit({
              fase: target,
              ...(entry?.gate ? { gate: entry.gate } : {}),
              ...(previous.feature ? { feature: previous.feature } : {}),
              ...(previous.slugProvisional ? { slugProvisional: true } : {}),
              allow,
              active: true,
            })
            await reply(
              ctx.session as never,
              input.sessionID,
              `${narration(target, entry?.gate ?? "ninguno")}\n${phaseBrief(target, previous.feature)}\n\nAVISO: retroceder reabre el gate y sus artefactos. No borra lo escrito.`,
            )
            return
          }
          case "rename": {
            if (!previous || !previous.active) {
              await reply(ctx.session as never, input.sessionID, reminder())
              return
            }
            const oldFeature = previous.feature
            const newFeature = parsed.feature
            // C1: si el slug era provisional, mover los artefactos ya escritos. Nunca
            // pisa un destino existente: avisa y deja las cosas donde están.
            let moved = false
            let conflict = false
            if (oldFeature && oldFeature !== newFeature) {
              const from = join(projectRoot, ".scratch", oldFeature)
              const to = join(projectRoot, ".scratch", newFeature)
              if (existsSync(from)) {
                if (existsSync(to)) conflict = true
                else {
                  try {
                    renameSync(from, to)
                    moved = true
                  } catch (error) {
                    log.once("rename", `no pude mover .scratch/${oldFeature}: ${String(error)}`)
                  }
                }
              }
            }
            await commit({
              fase: previous.fase,
              ...(previous.gate ? { gate: previous.gate } : {}),
              feature: newFeature,
              ...(previous.slugProvisional ? { slugProvisional: true } : {}),
              ...(previous.ticketsOpted === undefined ? {} : { ticketsOpted: previous.ticketsOpted }),
              ...inheritedAllow,
              active: true,
            })
            await reply(
              ctx.session as never,
              input.sessionID,
              `[flow] feature renombrada: ${oldFeature ?? "(ninguna)"} → ${newFeature}` +
                (moved ? ` · movido .scratch/${oldFeature}/` : "") +
                (conflict ? ` · AVISO: .scratch/${newFeature}/ ya existía, no he movido nada` : ""),
            )
            return
          }
          case "resume": {
            // Punto (e): sin sesión previa, se mira el marcador `.flow-feature` del proyecto
            // y la fase se DEDUCE de los artefactos en disco en vez de adivinarse.
            const marker = parsed.feature ? undefined : readFeatureMarker(projectRoot)
            const feature = parsed.feature ?? previous?.feature ?? marker?.slug ?? provisionalSlug(input.sessionID)
            const provisional = !parsed.feature && !previous?.feature && !marker
            // Estado en storage MANDA sobre la deducción: si hay estado, su fase es la última
            // decisión explícita del usuario (next/back/gate), no una conjetura por artefactos.
            // Sólo sin estado se deduce, y entonces se dice qué se dedujo y por qué.
            const deduction = deducePhaseInfo(projectRoot, feature)
            const fromState = previous?.fase !== undefined
            const fase = previous?.fase ?? (feature ? deduction.fase : FIRST_PHASE)
            const why = fromState
              ? `fase ${fase} del estado guardado en la sesión (el disco no la reemplaza); si no era la esperada, corrige con /flow back`
              : `fase ${fase} deducida de ${deduction.reason}; si ese artefacto era un borrador aún no aprobado, corrige con /flow back`
            const entry = phase(fase)
            // Punto 4: el resume es un NUEVO punto de partida, así que la foto se recalcula.
            // Si se reutilizara `previous.allow`, un flow retomado tras crear CONTEXT.md
            // arrastraría una foto vieja y el gate quedaría cerrado sin motivo.
            const allow = snapshotAllow(projectRoot)
            // Puerta 7: `false` explícito significa "retomé ya en 6/7 sin tickets: camino tdd".
            // Así un `/flow next` posterior desde la 6 deducida no promete tickets inexistentes.
            // Retomar por debajo de la 6 no fija nada: dejar 6→7 sigue siendo el camino con tickets.
            const ticketsOpted = resumeTicketsOpted(
              { fase, feature, ...(previous?.ticketsOpted === undefined ? {} : { ticketsOpted: previous.ticketsOpted }) },
              projectRoot,
              Boolean(previous),
            )
            await commit({
              fase,
              ...(entry?.gate ? { gate: entry.gate } : {}),
              feature,
              ...(provisional || previous?.slugProvisional ? { slugProvisional: true } : {}),
              ...(ticketsOpted === undefined ? {} : { ticketsOpted }),
              allow,
              active: true,
            })
            writeFeatureMarker(projectRoot, feature)
            await reply(
              ctx.session as never,
              input.sessionID,
              `${marker && !parsed.feature && !previous?.feature ? `[flow] retomo la feature marcada: ${feature} (fase ${fase} deducida de los artefactos)\n` : ""}` +
                `[flow] reactivado en fase ${fase} · feature ${feature}\n` +
                `[flow] por qué: ${why}` +
                `\n` +
                `${phaseBrief(fase, feature)}`,
            )
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
    // A6 (verificado en runtime 2.4.2 contra sus tipos): `context` y `generate` NO co-disparan
    // en la misma petición; cada uno corresponde a un tipo de petición distinto, y
    // `compaction` sólo se dispara al compactar. Por eso no hay doble inyección por turno.
    // Aun así, si un runtime futuro los disparara ambos, el daño sería texto repetido, no
    // estado corrupto: el hook es de sólo lectura de estado. No hay dedup por marcador: se
    // considera LIMITACIÓN CONOCIDA (ver CHANGELOG) mientras no se observe el co-disparo.
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
            {
              projectRoot,
              fase: state.fase,
              ...(state.feature ? { feature: state.feature } : {}),
              ...(state.allow ? { allow: state.allow } : {}),
              ...(state.ticketsOpted === true ? { ticketsOpted: true } : {}),
            },
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
          const { added, ceded } = addMissingSkills(editor as unknown as SkillEditorLike, bundled)
          // A9: registrar los ids cedidos hace visible por qué NO se instaló una skill
          // empaquetada. Silenciarlo haría creer que el bundle está roto.
          if (added.length > 0) {
            log.debug("skills-added", `skills empaquetadas registradas (${added.length}): ${added.join(", ")}`)
          }
          if (ceded.length > 0) {
            log.debug(
              "skills-ceded",
              `skills NO registradas porque ya existían (${ceded.length}): ${ceded.join(", ")}. Ganó la copia del usuario.`,
            )
          }
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
