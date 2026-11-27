// Single source of truth for the phase map. `flow.md` stays prose and is updated by hand.
import { MAX_SLUG, isValidSlug, slugify } from "./slug.ts"
import { scopeToFeature } from "./contract.ts"
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
  { n: 1, name: "Entender", skill: "grilling", closes: ".scratch/<feature>/understanding.md aprobado por el usuario", blocks: false },
  { n: 2, name: "Vocabulario", skill: "domain-modeling", closes: ".scratch/<feature>/glossary.md aprobado por el usuario", blocks: false },
  { n: 3, name: "Diseño de módulos", skill: "codebase-design", closes: ".scratch/<feature>/design.md aprobado por el usuario", blocks: false },
  {
    n: 4,
    name: "Sondear",
    skill: "prototype",
    closes: "respuesta a una pregunta de diseño anotada en design.md",
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

/**
 * Línea única de estado, compartida por el entry de instructions y por los resúmenes.
 * UNA definición de "cómo se ve el estado": si cambia el formato, cambia aquí.
 */
export function stateLine(state: { fase: number; active: boolean; feature?: string; gate?: string }): string {
  const parts = [`fase ${state.fase}`, state.active ? "activo" : "inactivo"]
  if (state.feature) parts.push(`feature ${state.feature}`)
  if (state.gate) parts.push(`gate ${state.gate}`)
  return `[flow] ${parts.join(" · ")}`
}

// ---- subcommand parsing ----------------------------------------------------
// Tolerant by design: anything unrecognised degrades to help. It never throws.

// Subcomandos conocidos. De aquí salen la ayuda y las sugerencias por parecido, así que
// añadir un subcomando obliga a tocar este único sitio.
const SUBCOMMANDS: readonly string[] = [
  "help", "off", "status", "gate", "start", "next", "back", "rename", "resume",
]

/** Normaliza para comparar: minúsculas, sin acentos y sin guiones ni barras.
 *  `státus`, `STATUS` y `status` son el mismo subcomando para quien teclea rápido. */
export function foldCommand(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[-_/\\]/g, "")
}

/** Distancia de edición (Levenshtein) acotada: si supera `max`, devuelve `max + 1`.
 *  El corte evita rellenar la matriz completa para palabras que no se parecen en nada. */
function editDistance(a: string, b: string, max: number): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    let bestInRow = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      row.push(value)
      if (value < bestInRow) bestInRow = value
    }
    if (bestInRow > max) return max + 1
    prev = row
  }
  return prev[b.length]
}

/** Subcomando más parecido, si está a distancia <= 2. `undefined` si no hay ninguno cercano:
 *  sugerir cualquier cosa convierte la ayuda en ruido. */
export function suggestSubcommand(raw: string): string | undefined {
  const target = foldCommand(raw)
  if (!target) return undefined
  let best: string | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const candidate of SUBCOMMANDS) {
    const distance = editDistance(target, foldCommand(candidate), 2)
    if (distance <= 2 && distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best
}

export type Parsed =
  | { kind: "help"; reason?: string; suggestion?: string }
  | { kind: "start"; fase: PhaseNumber; feature?: string }
  | { kind: "status" }
  | { kind: "gate"; gate: GateName }
  | { kind: "bad-gate"; name: string }
  | { kind: "off" }
  | { kind: "next" }
  | { kind: "back"; steps: number }
  | { kind: "rename"; feature: string }
  | { kind: "resume"; feature?: string }

function toPhase(raw: string): PhaseNumber | undefined {
  if (!/^\d+$/.test(raw)) return undefined
  const n = Number(raw)
  return n >= FIRST_PHASE && n <= LAST_PHASE ? (n as PhaseNumber) : undefined
}

/**
 * Parse what the user typed after `/flow` (or `/workflow`).
 * A bare invocation means "start at 1", so the trigger stays a user act, not a model decision.
 *
 * `active` distingue dos situaciones que antes compartían rama: con el flow YA activo, cualquier
 * texto raro es un subcomando mal escrito (ayuda); con el flow inactivo puede que el usuario esté
 * describiendo la feature que quiere empezar, así que una sola palabra desconocida es ayuda y una
 * descripción libre exige al menos dos.
 */
export function parseCommand(text: string, options: { active?: boolean } = {}): Parsed {
  const parts = text.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { kind: "start", fase: FIRST_PHASE }

  const [head, ...rest] = parts
  const sub = foldCommand(head)

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
    if (slug === undefined) return { kind: "start", fase: n }
    if (!isValidSlug(slug)) return { kind: "help", reason: `slug "${slug}" inválido: usa minúsculas, dígitos y guiones (1-${MAX_SLUG}), sin . / \\` }
    return { kind: "start", fase: n, feature: slug }
  }

  if (sub === "next") return { kind: "next" }

  if (sub === "back") {
    if (rest.length === 0) return { kind: "back", steps: 1 }
    if (!/^\d+$/.test(rest[0])) return { kind: "help", reason: `"${rest[0]}" no es un número de fases` }
    const steps = Number(rest[0])
    if (steps < 1 || steps > LAST_PHASE - FIRST_PHASE) return { kind: "help", reason: `no puedo retroceder ${steps} fases` }
    return { kind: "back", steps }
  }

  if (sub === "rename") {
    const slug = rest[0]
    if (!slug) return { kind: "help", reason: "falta el slug nuevo: /flow rename <slug>" }
    if (!isValidSlug(slug)) return { kind: "help", reason: `slug "${slug}" inválido: usa minúsculas, dígitos y guiones (1-${MAX_SLUG}), sin . / \\` }
    return { kind: "rename", feature: slug }
  }

  if (sub === "resume") {
    const slug = rest[0]
    if (slug === undefined) return { kind: "resume" }
    if (!isValidSlug(slug)) return { kind: "help", reason: `slug "${slug}" inválido: usa minúsculas, dígitos y guiones (1-${MAX_SLUG}), sin . / \\` }
    return { kind: "resume", feature: slug }
  }

  // C1: `/flow <descripción>` arranca con un slug derivado del texto. Sin argumentos
  // (`/flow`), index.ts usa el slug provisional del sessionID.
  //
  // Con el flow YA activo, un texto que empieza por una palabra desconocida NO es una
  // descripción: es un subcomando mal escrito. Se ayuda y se sugiere el parecido.
  if (options.active) {
    return {
      kind: "help",
      reason: helpReason(head),
      suggestion: suggestSubcommand(head),
    }
  }
  // Con el flow inactivo, una sola palabra desconocida tampoco es descripción (es casi
  // siempre un subcomando mal tecleado). Hacen falta dos palabras para describir.
  if (parts.length < 2) {
    return { kind: "help", reason: helpReason(head), suggestion: suggestSubcommand(head) }
  }
  const feature = slugify(text)
  if (!feature) {
    return { kind: "help", reason: `no pude derivar un slug de "${text}"`, suggestion: suggestSubcommand(head) }
  }
  return { kind: "start", fase: FIRST_PHASE, feature }
}

/** Motivo de ayuda para un texto no reconocido, con la sugerencia si la hay. */
function helpReason(head: string): string {
  const suggestion = suggestSubcommand(head)
  return suggestion
    ? `"${head}" no es un subcomando. ¿Querías decir "/flow ${suggestion}"?`
    : `"${head}" no es un subcomando`
}

// ---- rendered output -------------------------------------------------------

function summaryLine(entry: Phase): string {
  return `${entry.n} ${entry.name} — ${entry.skill} → cierra con: ${entry.closes}`
}

export function help(options: { active?: boolean } = {}): string {
  return [
    "Uso: /flow <subcomando>",
    "  (sin argumentos)      arranca en fase 1 con slug provisional (`flow-<sesión>`)",
    "  <descripción>         arranca en fase 1 con el slug derivado del texto",
    "  start [N] [slug]      arranca/continúa en fase N; `slug` nombra la feature (activa el gate)",
    "  next                  avanza a la fase siguiente",
    "  back [N]              retrocede N fases (por defecto 1); reabre artefactos",
    "  rename <slug>         renombra la feature (mueve .scratch/<slug>/ si existe)",
    "  resume [slug]         reactiva el flow parado; opcionalmente adopta otro slug",
    "  status                fase, gate pendiente, si hay spec y si está activo",
    "  gate <nombre>         cierra el gate y avanza de fase",
    "  off                   desactiva el flow para esta sesión",
    "  help                  esta ayuda",
    "",
    `Gates válidos: ${VALID_GATES.join(", ")}`,
    "Alias: /workflow …",
    // P3: con el flow ya en marcha, describir una feature NUEVA necesita `start`; quien acaba
    // de leer la ayuda por un subcomando mal escrito es justo quien lo va a intentar.
    ...(options.active ? ["", "Para empezar OTRA feature: /flow start <descripción>", "El flow ya está activo: una descripción suelta no arranca otra."] : []),
  ].join("\n")
}

export function badGateMessage(name: string): string {
  return `Gate desconocido "${name}". Gates válidos: ${VALID_GATES.join(", ")}. No avanzo de fase.`
}

export function phaseMap(): string {
  return PHASES.map(summaryLine).join("\n")
}

/**
 * Resolve the artifact the active gate demands. Vive aquí (y no en `gate.ts`) porque no toca
 * disco y produce TEXTO para el modelo; `gate.ts` la importa para decidir. Si viviera en
 * `gate.ts`, `phases.ts` tendría que importarlo y cerraríamos un ciclo.
 * `undefined` means "no artifact to check": either there is no phase, or no feature was declared.
 */
export function artifactPaths(feature: string | undefined, entry: Phase | undefined): string[] | undefined {
  const spec = entry?.artifact?.(feature ?? "")
  if (!feature || !spec) return undefined
  const names: string[] = []
  if (spec.file) names.push(spec.file)
  if (spec.dir) names.push(spec.dir)
  return names.length > 0 ? names : undefined
}

/**
 * Brief MÍNIMO derivado de los datos estructurales cuando NO hay contrato.
 *
 * Toda la prosa por fase vive en `flow.md` (sección `## Fase N`); aquí sólo queda lo
 * que se puede deducir de los datos: número, nombre, skill, gate y artefacto. El gate
 * y las skills siguen funcionando sin contrato: sólo se pierde la guía en prosa.
 */
export function phaseBrief(fase: number, feature?: string): string {
  const entry = phase(fase)
  if (!entry) return `${narration(fase, "gate desconocido")}\nFase ${fase} fuera del mapa (1-${LAST_PHASE}).`
  const lines = [
    narration(entry.n, entry.gate ?? "checkpoint aprobado por el usuario"),
    "",
    `Fase ${entry.n} · ${entry.name}`,
    `Skill a cargar: ${entry.skill}`,
    `Cierra con: ${scopeToFeature(entry.closes, feature)}`,
  ]
  if (feature) lines.push(`Feature declarada: ${feature} (raíz de artefactos: .scratch/${feature}/)`)
  else if (entry.blocks) lines.push(`Artefacto exigido: falta declarar feature con /flow start ${entry.n} <slug>.`)
  if (entry.gate) lines.push(`Gate de esta fase: ${entry.gate} — ciérralo con /flow gate ${entry.gate}.`)
  if (entry.blocks) {
    const names = artifactPaths(feature, entry)
    if (names) lines.push(`Escribe hoy: ${scopeToFeature(names.join(" "), feature)}`)
  }
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
