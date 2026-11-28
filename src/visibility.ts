// Visibilidad del estado del flow hacia el usuario (TUI).
//
// Dos mecanismos del runtime 2.4.2, ambos verificados contra sus tipos en
// node_modules/@opencode (ver tests/visibility.test.ts y el README):
//
//   1. `ctx.session.instructions.entry.put/remove` — entries persistentes
//      (`sessionID`, `key`, `value`). Es la vía documentada para exponer texto por
//      sesión. Se usa como fuente de verdad del estado visible.
//   2. `ctx.session.synthetic({ sessionID, text, resume })` — mensaje que el modelo lee
//      como entrada del usuario, sin que este comando despierte un turno (`resume:false`).
//
// Verificado por API en un servidor 2.4.2 aislado (el entry aparece, se refresca y se borra;
// `resume:false` cuesta 0 tokens). Lo único NO verificado es que el TUI pinte el entry.
// Por eso todo cae a `ctx.session.prompt` sin lanzar, y cada fallo se registra una vez
// (regla 1 de silencio). Ver README, sección "Verificación".

import type { FlowState } from "./state.ts"
import { narration, stateLine } from "./phases.ts"

/** Key estable del entry: si otro plugin usa otra key, no colisionamos. */
export const STATE_ENTRY_KEY = "opencode-flow.state"

export type FeedbackVariant = "info" | "success" | "warning" | "error"
export type FeedbackDisplay = "toast" | "dialog"

export type FeedbackPayload = {
  readonly id: string
  readonly kind: string
  readonly title: string
  readonly message: string
  readonly variant: FeedbackVariant
  readonly display: FeedbackDisplay
}


export type InstructionsEntry = {
  readonly instructions?: {
    readonly entry?: {
      readonly put?: (input: { sessionID: string; key: string; value: unknown }) => Promise<unknown>
      readonly remove?: (input: { sessionID: string; key: string }) => Promise<unknown>
    }
  }
}

export type SyntheticCapable = {
  readonly synthetic?: (input: { sessionID: string; text?: string; delivery?: string; [k: string]: unknown }) => Promise<unknown>
}

export type PromptCapable = {
  readonly prompt?: (input: { sessionID: string; text: string; delivery?: string; [k: string]: unknown }) => Promise<unknown>
}

export type VisibilitySession = InstructionsEntry & SyntheticCapable & PromptCapable

export type VisibilityResult = {
  /** Mecanismo que finalmente emitió el mensaje. */
  readonly via: "synthetic" | "prompt" | "none"
  /** Entrada de instructions actualizada (omitida => false). */
  readonly entryUpdated: boolean
}

/** Texto corto y estable del estado, pensado para una línea de TUI. */
export function stateSummary(state: FlowState): string {
  return stateLine(state)
}

/**
 * Refresca (o elimina) el entry `opencode-flow.state`. `state === undefined` lo elimina,
 * que es lo que debe pasar en `/flow off`.
 * Devuelve false cuando el runtime no expone la API: el llamador sigue con prompt().
 */
export async function syncStateEntry(
  session: VisibilitySession | undefined,
  sessionID: string,
  state: FlowState | undefined,
): Promise<boolean> {
  const entry = session?.instructions?.entry
  // Sin la API no hay entry que sincronizar: `false` para que el llamador lo sepa y caiga
  // a prompt(). Distinguir "no existe" de "existe y falló" es lo que evita fingir éxito.
  if (!entry || typeof entry.put !== "function" || typeof entry.remove !== "function") return false
  try {
    if (!state) {
      await entry.remove({ sessionID, key: STATE_ENTRY_KEY })
      return true
    }
    await entry.put({
      sessionID,
      key: STATE_ENTRY_KEY,
      value: { text: stateSummary(state), fase: state.fase, active: state.active, feature: state.feature ?? null, gate: state.gate ?? null },
    })
    return true
  } catch {
    return false
  }
}

/**
 * Emite la respuesta al usuario sin arrancar un turno del agente.
 *
 * Medido en un servidor 2.4.2 aislado (ver PUBLISHING.md y el CHANGELOG): `synthetic` con
 * `delivery:"steer"` (lo que hacíamos antes) DESPIERTA la ejecución y gasta un turno real —
 * 37/1359/408 tokens de entrada y 129/96/164 de salida para help/status/off, más 3-4
 * mensajes de asistente con herramientas. `resume:false` deja el mensaje en la bandeja y
 * cuesta 0 tokens, sin crear ningún mensaje de asistente. Es la opción correcta para una
 * respuesta informativa: el texto lo verá el usuario y el modelo lo leerá en su próximo
 * turno, sin que este comando lo despierte.
 *
 * `resume:true` queda disponible para el raro caso en que la respuesta DEBA iniciar trabajo.
 * Nunca lanza: un comando que revienta en la cara del usuario es peor que uno que no responde.
 */
export async function reply(
  session: VisibilitySession | undefined,
  sessionID: string,
  text: string,
  options: { resume?: boolean } = {},
): Promise<VisibilityResult> {
  const resume = options.resume ?? false
  const synthetic = session?.synthetic
  if (typeof synthetic === "function") {
    try {
      await synthetic.call(session, { sessionID, text, resume })
      return { via: "synthetic", entryUpdated: false }
    } catch {
      // Cae a prompt() más abajo: la respuesta es más importante que el mecanismo.
    }
  }
  const prompt = session?.prompt
  if (typeof prompt === "function") {
    try {
      await prompt.call(session, { sessionID, text, resume })
      return { via: "prompt", entryUpdated: false }
    } catch {
      return { via: "none", entryUpdated: false }
    }
  }
  return { via: "none", entryUpdated: false }
}

/**
 * Mensaje de `/flow off`. Debe nombrar el comando REAL de reactivación (`/flow resume`),
 * no `/flow start`: `off` conserva fase y feature, y `resume` las retoma sin perderlas.
 * Si el mensaje y el comportamiento divergen, el usuario aprende un camino que no existe.
 */
export function offMessage(state: FlowState | undefined): string {
  const fase = state?.fase ?? 1
  const hint = state?.feature
    ? `/flow resume ${state.feature}`
    : "/flow resume"
  return `${narration(fase, "flow desactivado")}\nFlow desactivado para esta sesión. Reactiva con ${hint}.`
}

export type FeedbackListener = (sessionID: string, payload: FeedbackPayload) => void

const feedbackListeners = new Set<FeedbackListener>()

export function feedbackFilePath(sessionID: string): string {
  const safe = sessionID.replace(/[^a-zA-Z0-9._-]/g, "_") || "default"
  return `${process.env.TMPDIR ?? "/tmp"}/opencode-flow-fb-${safe}.json`
}

/** Suscribe un consumidor TUI al canal efímero de feedback visual (memoria + archivo IPC en tmpdir). */
export function onFeedback(listener: FeedbackListener): () => void {
  feedbackListeners.add(listener)
  return () => {
    feedbackListeners.delete(listener)
  }
}

/**
 * Emite un aviso visual inmediato para que la TUI lo pinte en pantalla (toast o dialog)
 * desde el primer comando, incluso cuando `resume: false` (0 tokens).
 * No escribe en `storage` ni en `instructions.entry` (respeta la invariante P3 sin efectos).
 */
export async function publishFeedback(
  _session: VisibilitySession | undefined,
  sessionID: string,
  payload: Omit<FeedbackPayload, "id">,
): Promise<boolean> {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const full: FeedbackPayload = { id, ...payload }
  let delivered = false
  for (const listener of feedbackListeners) {
    try {
      listener(sessionID, full)
      delivered = true
    } catch {
      // Un fallo visual nunca rompe la ejecución del comando.
    }
  }
  if (!process.env.NODE_TEST_CONTEXT) {
    try {
      const { writeFileSync } = await import("node:fs")
      writeFileSync(feedbackFilePath(sessionID), JSON.stringify({ sessionID, payload: full }), "utf8")
      delivered = true
    } catch {
      // Degradación silenciosa si tmpdir no es escribible.
    }
  }
  return delivered
}
