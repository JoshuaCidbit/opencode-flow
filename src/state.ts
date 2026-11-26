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
  return typeof typed.fase === "number" && typeof typed.active === "boolean"
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
