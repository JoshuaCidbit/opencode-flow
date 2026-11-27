// Visibilidad del estado del flow hacia el usuario (TUI).
//
// Dos mecanismos del runtime 2.4.2, ambos verificados contra sus tipos en
// node_modules/@opencode (ver tests/visibility.test.ts y el README):
//
//   1. `ctx.session.instructions.entry.put/remove` — entries persistentes
//      (`sessionID`, `key`, `value`). Es la vía documentada para exponer texto por
//      sesión. Se usa como fuente de verdad del estado visible.
//   2. `ctx.session.synthetic({ sessionID, ..., delivery })` — respuesta inmediata
//      en la misma ejecución.
//
// Nada de esto está verificado EN PANTALLA: que el TUI muestre las instructions
// entries es una hipótesis. Por eso todo cae a `ctx.session.prompt` sin lanzar, y
// cada fallo se registra una vez (regla 1 de silencio). Ver README, sección
// "Verificación pendiente".

import type { FlowState } from "./state.ts"
import { narration } from "./phases.ts"

/** Key estable del entry: si otro plugin usa otra key, no colisionamos. */
export const STATE_ENTRY_KEY = "opencode-flow.state"

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
  const parts = [`fase ${state.fase}`, state.active ? "activo" : "inactivo"]
  if (state.feature) parts.push(`feature ${state.feature}`)
  if (state.gate) parts.push(`gate ${state.gate}`)
  return `[flow] ${parts.join(" · ")}`
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
 * Emite la respuesta al usuario: `synthetic` con `delivery:"steer"` si existe, si no
 * `prompt`. Nunca lanza: un comando que revienta en la cara del usuario es peor que
 * uno que no responde.
 *
 * Razón de `steer`: medido sobre los tipos de 2.4.2, `Session.Inbox.Delivery` es
 * `Literal(["steer","queue"])`. `steer` despierta la ejecución de la sesión; `queue`
 * deja el mensaje en la bandeja de entrada. Para la respuesta de un `/flow` queremos
 * lo primero. (Efecto observado, no medido en pantalla: ver README.)
 */
export async function reply(
  session: VisibilitySession | undefined,
  sessionID: string,
  text: string,
): Promise<VisibilityResult> {
  const synthetic = session?.synthetic
  if (typeof synthetic === "function") {
    try {
      await synthetic.call(session, { sessionID, text, delivery: "steer" })
      return { via: "synthetic", entryUpdated: false }
    } catch {
      // Cae a prompt() más abajo: la respuesta es más importante que el mecanismo.
    }
  }
  const prompt = session?.prompt
  if (typeof prompt === "function") {
    try {
      await prompt.call(session, { sessionID, text, delivery: "steer" })
      return { via: "prompt", entryUpdated: false }
    } catch {
      return { via: "none", entryUpdated: false }
    }
  }
  return { via: "none", entryUpdated: false }
}

/** Una línea de narración para transiciones, reutilizable por los comandos. */
export function transitionLine(state: FlowState): string {
  return narration(state.fase, state.gate ?? "ninguno")
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
