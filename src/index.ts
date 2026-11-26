import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"

const LOG_PREFIX = "[opencode-flow]"

// Portable default: resolve `flow.md` next to this module, not an absolute home path.
const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CONTRACT = join(HERE, "..", "flow.md")

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
    "Además del contrato de compactación, preservá estos tres campos en el resumen:",
    `- Fase actual del mapa: ${phase}`,
    `- Gate pendiente: ${gate}`,
    '- Permiso de edición: si consta que el usuario habilitó editar código, decilo; si no consta, escribí "no consta".',
    "Si la fase figura como desconocida, no la infieras del contenido: decila tal cual.",
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

export { addendum, lastState }

export default Plugin.define({
  id: "opencode-flow",
  async setup(ctx) {
    const contract = await loadContract(ctx.options ?? {})
    if (!contract) return

    const registrations: Disposable[] = []

    // Full contract on every normal request and on explicit generation.
    for (const kind of ["context", "generate"] as const) {
      registrations.push(
        await ctx.session.hook(kind, (event) => {
          push(event, contract, kind)
        }),
      )
    }

    // Compaction: only the addendum, carrying the phase/gate rescued from the transcript.
    registrations.push(
      await ctx.session.hook("compaction", (event) => {
        push(event, addendum(event.messages), "compaction")
      }),
    )

    console.log(`${LOG_PREFIX} contrato cargado (${Buffer.byteLength(contract, "utf8")} bytes)`)
    return async () => {
      await Promise.all(registrations.map((registration) => registration.dispose()))
    }
  },
})
