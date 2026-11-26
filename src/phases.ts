// Single source of truth for the phase map. `flow.md` stays prose and is updated by hand.
//
// Rule: phase numbers here must match the table in `flow.md`. Nothing else reads the prose.

export type GateName = "spec" | "tickets" | "evidence" | "review" | "integration" | "retro"

export type PhaseNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export type Phase = {
  readonly n: PhaseNumber
  readonly name: string
  readonly skill: string
  readonly closes: string
  /** Gate that closes this phase. Absent for phases 1-4 (nothing to verify by hand off). */
  readonly gate?: GateName
  /**
   * Artifact the gate checks, relative to the project root.
   * - `file`: exact path that must exist.
   * - `dir`:  directory that must contain at least one `*.md`.
   */
  readonly artifact?: (feature: string) => { file?: string; dir?: string }
  /** Whether a missing artifact blocks edits. Only phases whose gate is file-verifiable. */
  readonly blocks: boolean
}

export const PHASES: readonly Phase[] = [
  { n: 1, name: "Entender", skill: "grilling", closes: "checkpoint de entendimiento aprobado", blocks: false },
  { n: 2, name: "Vocabulario", skill: "domain-modeling", closes: "términos y ADR acordados", blocks: false },
  { n: 3, name: "Diseño del módulo", skill: "codebase-design", closes: "costuras y tests definidos", blocks: false },
  {
    n: 4,
    name: "Sondear",
    skill: "prototype",
    closes: "respuesta a una pregunta de diseño (sólo /tmp/opencode-proto-<slug>)",
    blocks: false,
  },
  {
    n: 5,
    name: "Especificar",
    skill: "to-spec",
    closes: ".scratch/<feature>/spec.md",
    gate: "spec",
    artifact: (feature) => ({ file: `.scratch/${feature}/spec.md` }),
    blocks: true,
  },
  {
    n: 6,
    name: "Trocear",
    skill: "to-tickets",
    closes: "tickets verticales con bloqueos",
    gate: "tickets",
    artifact: (feature) => ({ dir: `.scratch/${feature}/issues` }),
    blocks: true,
  },
  {
    n: 7,
    name: "Implementar",
    skill: "implement-spec (con tickets) o tdd (sin tickets; siempre en proyectos sin git)",
    closes: "tests en verde",
    gate: "evidence",
    blocks: false,
  },
  { n: 8, name: "Revisar", skill: "code-review contra el spec", closes: "hallazgos resueltos", gate: "review", blocks: false },
  { n: 9, name: "Publicar", skill: "pr", closes: "PR con evidencia", gate: "integration", blocks: false },
  { n: 10, name: "Cerrar", skill: "retro", closes: "lecciones registradas", gate: "retro", blocks: false },
]

export const FIRST_PHASE: PhaseNumber = 1
export const LAST_PHASE: PhaseNumber = 10

export function phase(n: number): Phase | undefined {
  return PHASES.find((entry) => entry.n === n)
}

export const VALID_GATES: readonly GateName[] = PHASES.flatMap((entry) => (entry.gate ? [entry.gate] : []))

export function phaseByGate(gate: string): Phase | undefined {
  return PHASES.find((entry) => entry.gate === gate)
}

export function isGateName(value: string): value is GateName {
  return VALID_GATES.includes(value as GateName)
}

// The narration line every phase transition must print. Regex in index.ts parses it back.
export function narration(fase: number, gate: string): string {
  return `[flow] fase ${fase} · gate pendiente: ${gate}`
}

// ---- subcommand parsing ----------------------------------------------------
// Tolerant by design: anything unrecognised degrades to help. It never throws.

export type Parsed =
  | { kind: "help"; reason?: string }
  | { kind: "start"; fase: PhaseNumber; feature?: string }
  | { kind: "status" }
  | { kind: "gate"; gate: GateName }
  | { kind: "bad-gate"; name: string }
  | { kind: "off" }

const NARRATION_HELP = "Repite la primera línea de arriba en cada transición de fase y antes de afirmar avance."

function toPhase(raw: string): PhaseNumber | undefined {
  if (!/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return n >= FIRST_PHASE && n <= LAST_PHASE ? (n as PhaseNumber) : undefined
}

/**
 * Parse what the user typed after `/flow` (or `/workflow`).
 * A bare invocation means "start at 1", so the trigger stays a user act, not a model decision.
 */
export function parseCommand(text: string): Parsed {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { kind: "start", fase: FIRST_PHASE }

  const [head, ...rest] = parts
  const sub = head.toLowerCase()

  if (sub === "help") return { kind: "help" }
  if (sub === "off") return { kind: "off" }
  if (sub === "status") return { kind: "status" }

  if (sub === "gate") {
    const name = (rest[0] ?? "").toLowerCase()
    if (!name) return { kind: "help", reason: "falta el nombre del gate" }
    if (!isGateName(name)) return { kind: "bad-gate", name }
    return { kind: "gate", gate: name }
  }

  if (sub === "start") {
    // `/flow start`, `/flow start N`, `/flow start N <slug>`
    if (rest.length === 0) return { kind: "start", fase: FIRST_PHASE }
    const n = toPhase(rest[0])
    if (n === undefined) return { kind: "help", reason: `"${rest[0]}" no es una fase entre ${FIRST_PHASE} y ${LAST_PHASE}` }
    const slug = rest[1]
    const feature = slug && /^[A-Za-z0-9._-]+$/.test(slug) ? slug : undefined
    return { kind: "start", fase: n, ...(feature ? { feature } : {}) }
  }

  return { kind: "help", reason: `subcomando desconocido "${head}"` }
}

// ---- rendered output -------------------------------------------------------

function summaryLine(entry: Phase): string {
  return `${entry.n} ${entry.name} — ${entry.skill} → cierra con: ${entry.closes}`
}

export function help(): string {
  return [
    "Uso: /flow <subcomando>",
    "  (sin argumentos)      arranca en fase 1",
    "  start [N] [slug]      arranca/continúa en fase N; `slug` nombra la feature (activa el gate)",
    "  status                fase, gate pendiente, si hay spec y si está activo",
    "  gate <nombre>         cierra el gate y avanza de fase",
    "  off                   desactiva el flow para esta sesión",
    "  help                  esta ayuda",
    "",
    `Gates válidos: ${VALID_GATES.join(", ")}`,
    "Alias: /workflow …",
  ].join("\n")
}

export function badGateMessage(name: string): string {
  return `Gate desconocido "${name}". Gates válidos: ${VALID_GATES.join(", ")}. No avanzo de fase.`
}

export function phaseMap(): string {
  return PHASES.map(summaryLine).join("\n")
}

/** ~15 lines: what the model must do in this phase. Injected as a real message, not a hint. */
export function phaseBrief(fase: number, feature?: string): string {
  const entry = phase(fase)
  if (!entry) return `${narration(fase, "gate desconocido")}\nFase ${fase} fuera del mapa (1-${LAST_PHASE}).`
  const scratch = feature ? `.scratch/${feature}/` : ".scratch/<feature>/"
  const lines = [
    narration(entry.n, entry.gate ?? "checkpoint aprobado por el usuario"),
    "",
    `Fase ${entry.n} · ${entry.name}`,
    `Skill a cargar: ${entry.skill}`,
    `Cierra con: ${entry.closes}`,
  ]
  if (entry.n === 4) lines.push("Escribe sólo en /tmp/opencode-proto-<slug>; es desechable, no se commitea.")
  if (entry.n === 5) {
    lines.push(
      "No exijas las fases 1-4 para arrancar aquí: si la conversación ya trae el problema, sintetízalo ahora mismo.",
      `Escribe el spec ya en ${scratch}spec.md con lo que hayas entendido (problema, alcance, fuera de alcance, criterios de aceptación).`,
      "No te bloquees esperando datos que falten: escribe con lo que hay y marca los supuestos.",
      "Sigue en loop con el usuario hasta que apruebe; el gate se abre solo cuando el archivo exista.",
    )
  }
  if (feature) lines.push(`Feature declarada: ${feature} (raíz de artefactos: ${scratch})`)
  else if (entry.blocks) lines.push("Feature: no declarada. El gate queda inactivo hasta `/flow start N <slug>`.")
  if (entry.gate) {
    lines.push(`Gate de esta fase: ${entry.gate} — ciérralo con /flow gate ${entry.gate}.`)
    if (entry.blocks) lines.push(`Sin el artefacto, toda escritura fuera de él está bloqueada. Escapatoria: /flow off.`)
  }
  lines.push("", NARRATION_HELP)
  return lines.join("\n")
}

/** One line for an inactive flow: a reminder, never the whole contract. */
export function reminder(): string {
  return "flow inactivo · escribe /flow start [N] [slug] para activarlo (arranca en fase 1 sin argumentos)"
}

/** Short state pushed into `context`/`generate` when the flow is active. */
export function contextSummary(state: { fase: number; gate?: string; feature?: string }): string {
  const entry = phase(state.fase)
  const parts = [
    narration(state.fase, state.gate ?? "checkpoint aprobado por el usuario"),
    `skill: ${entry?.skill ?? "fuera del mapa"}`,
    `feature: ${state.feature ?? "no declarada"}`,
    `activo: sí`,
  ]
  if (entry?.blocks) parts.push(`gate activo: bloquea escritura fuera del artefacto`)
  return parts.join(" · ")
}

export const phasesVersion = 1
