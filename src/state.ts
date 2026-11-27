// Estado persistente del flow, con resolución de dueño para sesiones hijas (A3).
//
// Un subagente tiene su propio sessionID. Si el estado se guardara sólo en el hijo,
// el hijo podría avanzar fases al margen del padre. Por eso:
//   - la LECTURA sube por `parentID` hasta encontrar estado (el gate se hereda);
//   - la ESCRITURA va siempre al dueño (ownerID), nunca al hijo.
// Así el padre mantiene la autoridad y el hijo no puede esquivar el gate.

export type FlowState = {
  fase: number
  gate?: string
  feature?: string
  /** P4: descripción original del usuario recortada (el slug pierde acentos y se trunca a 60). */
  topic?: string
  slugProvisional?: boolean
  active: boolean
  /**
   * Gate B: rutas relativas que existían al ejecutar `/flow start` (`CONTEXT.md`, `docs/adr`).
   * Sólo cuentan en fases 2-3; se guardan para que el gate no se abra a posteriori.
   */
  allow?: string[]
  /**
   * Puerta 7 sin tickets: la fase 7 acepta `tdd` sin pasar por la 6 (`flow.md`). Se marca
   * cuando el usuario elige ese camino o cuando la deducción de fase salta la 6, para que
   * el gate NO exija tickets que nunca prometió.
   */
  ticketsOpted?: boolean
}

export type ResolvedState = {
  state: FlowState
  /** sessionID de la sesión que posee el estado: el destino de TODA escritura. */
  ownerID: string
}

export type StorageLike = {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
}

export type SessionGetter = (id: string) => Promise<{ parentID?: string | null } | undefined>

export function stateKey(sessionID: string): string {
  return `flow:${sessionID}`
}

export function isState(value: unknown): value is FlowState {
  if (!value || typeof value !== "object") return false
  const typed = value as Record<string, unknown>
  if (typeof typed.fase !== "number" || typeof typed.active !== "boolean") return false
  if (typed.topic !== undefined && typeof typed.topic !== "string") return false
  // Gate B: `allow` es una lista de rutas relativas; cualquier otra forma se descarta.
  if (typed.allow !== undefined && (!Array.isArray(typed.allow) || !typed.allow.every((item) => typeof item === "string"))) {
    return false
  }
  // Puerta 7: el compromiso con tickets es booleano; cualquier otra forma se descarta.
  if (typed.ticketsOpted !== undefined && typeof typed.ticketsOpted !== "boolean") return false
  if (typed.slugProvisional !== undefined && typeof typed.slugProvisional !== "boolean") return false
  return true
}

/**
 * Auto-avance PURO: decide si la fase siguiente ya está ganada por el artefacto en disco.
 * No escribe, no toca storage: sólo calcula.
 *
 * - Monotónico: nunca reduce la fase.
 * - Idempotente: aplicado dos veces devuelve undefined la segunda.
 * - Sólo fases verificables por fichero (5, 6); 7-10 son declarativas y no se mueven solas.
 *
 * Devuelve undefined si no hay cambio (nada que escribir).
 */
export function advance(
  state: FlowState,
  isSatisfied: (fase: number, feature: string) => boolean,
  lastPhase: number,
): FlowState | undefined {
  if (!state.active || !state.feature) return undefined
  if (!isSatisfied(state.fase, state.feature)) return undefined
  const next = state.fase >= lastPhase ? state.fase : state.fase + 1
  // Monotonía: si el cálculo no sube, no hay nada que escribir.
  if (next <= state.fase) return undefined
  // Si el auto-avance entra en la 7 con tickets ya en disco, ese artefacto fue el que movió
  // la fase: el compromiso (`ticketsOpted`) se adopta, como en `/flow next` desde la 6.
  const adopted = next >= 7 && isSatisfied(6, state.feature)
  return {
    ...state,
    fase: next,
    active: true,
    ...(adopted ? { ticketsOpted: true } : {}),
  }
}

/**
 * Escribe el estado avanzado en el dueño sólo si hubo cambio.
 * Devuelve { state, wrote } para que el llamador decida si anunciar el avance (C7).
 */
export async function commitAdvance(
  storage: StorageLike,
  ownerID: string,
  before: FlowState,
  after: FlowState | undefined,
): Promise<{ state: FlowState; wrote: boolean }> {
  if (!after) return { state: before, wrote: false }
  try {
    await storage.set(stateKey(ownerID), after)
    return { state: after, wrote: true }
  } catch {
    // Falla abierta: sin persistir seguimos con el estado avanzado en memoria.
    return { state: after, wrote: false }
  }
}

/**
 * C7: aviso del auto-avance. El usuario no pidió este cambio —lo provocó escribir el
 * artefacto— así que hay que decírselo y NO callárselo. Devuelve undefined si no avanzó.
 */
export function noticeAdvance(before: FlowState, after: FlowState): string | undefined {
  if (after.fase <= before.fase) return undefined
  return `[flow] auto-avance: fase ${before.fase} → ${after.fase} (artefacto detectado en disco). Usa /flow back para retroceder.`
}

/**
 * Construye un `FlowState` a partir de campos opcionales. UNA sola definición de qué
 * claves se guardan y con qué forma; los comandos no repiten el mismo spread cada uno.
 * `gate`/`feature`/`topic`/`slugProvisional`/`ticketsOpted`/`allow` sólo aparecen si tienen valor.
 */
export type StateSeed = {
  fase: number
  active: boolean
  gate?: string
  feature?: string
  topic?: string
  slugProvisional?: boolean
  ticketsOpted?: boolean
  allow?: string[]
}

export function buildState(seed: StateSeed): FlowState {
  return {
    fase: seed.fase,
    active: seed.active,
    ...(seed.gate ? { gate: seed.gate } : {}),
    ...(seed.feature ? { feature: seed.feature } : {}),
    ...(seed.topic ? { topic: seed.topic } : {}),
    ...(seed.slugProvisional ? { slugProvisional: true } : {}),
    ...(seed.ticketsOpted === undefined ? {} : { ticketsOpted: seed.ticketsOpted }),
    ...(seed.allow && seed.allow.length > 0 ? { allow: seed.allow } : {}),
  }
}

/**
 * Busca el estado subiendo por la cadena de `parentID`.
 * Devuelve `{ state, ownerID }` para que el llamador escriba siempre en el dueño.
 * Devuelve undefined si ningún ancestro tiene estado.
 */
export async function resolveState(
  storage: StorageLike,
  getSession: SessionGetter,
  sessionID: string,
): Promise<ResolvedState | undefined> {
  const seen = new Set<string>()
  let current: string | undefined = sessionID

  while (current && !seen.has(current)) {
    seen.add(current)
    let raw: unknown
    try {
      raw = await storage.get(stateKey(current))
    } catch {
      return undefined
    }
    if (isState(raw)) return { state: raw, ownerID: current }

    let parent: string | undefined | null
    try {
      parent = (await getSession(current))?.parentID
    } catch {
      parent = undefined
    }
    current = parent ?? undefined
  }
  return undefined
}
