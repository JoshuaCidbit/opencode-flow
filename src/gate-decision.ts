// Decisión del gate de escritura, separada del hook (A5 + regla 4).
//
// Es una función pura sobre (herramienta, estado) para poder testear las reglas
// de orden "filtro antes de leer estado" y "falla abierta" sin montar el runtime.

/** Herramientas que escriben en disco. Todo lo demás es lectura y queda libre. */
export const WRITING_TOOLS = new Set(["write", "edit", "multiedit", "patch", "apply_patch"])

export type GateInput = {
  tool: string
  /** undefined si no se pudo leer el estado (sesión sin flow, o error interno). */
  state?: { fase: number; active: boolean; feature?: string }
  /** Error interno al resolver el estado; activa la falla abierta. */
  internalError?: unknown
}

export type GateDecision =
  | { kind: "free" } // herramienta de lectura: ni se consulta el estado
  | { kind: "allow" } // escritura permitida
  | { kind: "block"; reason: string }
  | { kind: "fail-open"; error: string } // regla 4: error interno -> permitir y avisar

/**
 * Orden (A5): el filtro de herramienta va PRIMERO. Si no escribe, no hay nada que
 * consultar: ni storage ni disco. Después, falla abierta ante error interno.
 */
export function decide(input: GateInput): GateDecision {
  // 1. Filtro: lectura es libre y no toca estado.
  if (!WRITING_TOOLS.has(input.tool.toLowerCase())) return { kind: "free" }

  // 2. Regla 4: error interno -> permitir. El gate no debe ser denegación de servicio.
  if (input.internalError !== undefined) {
    return { kind: "fail-open", error: String(input.internalError) }
  }

  // 3. Sin estado (o inactivo): no hay gate que aplicar.
  if (!input.state || !input.state.active) return { kind: "allow" }

  // 4. Con estado activo, la fase decide. Las fases 1-4 no cierran escritura.
  if (input.state.fase >= 5) {
    return { kind: "block", reason: `fase ${input.state.fase}: escritura cerrada sin gate aprobado` }
  }
  return { kind: "allow" }
}
