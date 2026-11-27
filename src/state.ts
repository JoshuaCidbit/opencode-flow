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
  slugProvisional?: boolean
  active: boolean
  /**
   * Gate B: rutas relativas que existían al ejecutar `/flow start` (`CONTEXT.md`, `docs/adr`).
   * Sólo cuentan en fases 2-3; se guardan para que el gate no se abra a posteriori.
   */
  allow?: string[]
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
  // Gate B: `allow` es una lista de rutas relativas; cualquier otra forma se descarta.
  if (typed.allow !== undefined && (!Array.isArray(typed.allow) || !typed.allow.every((item) => typeof item === "string"))) {
    return false
  }
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
  return {
    ...state,
    fase: next,
    active: true,
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
