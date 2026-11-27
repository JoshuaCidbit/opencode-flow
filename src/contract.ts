// Extracción por secciones del contrato (A2, versión corregida).
//
// Lo inyectado en `event.system` se reconstruye en cada petición y NO persiste en el
// historial. Por eso no existe la bandera de "primer turno": cada petición con flow
// activo recibe el bloque común + la sección de la fase actual, y ya está.
//
// El contrato se divide así:
//   - bloque común: todo lo que NO sea un encabezado `## Fase N` (gates, checkpoint,
//     narración, verificación, escaladas).
//   - bloque de fase: la sección `## Fase N` de la fase en curso.
//
// Si el contrato no tiene las secciones esperadas (p. ej. un `options.path` propio),
// NO se adivina: se inyecta el archivo completo como degradación y se avisa una vez.

export type Sections = {
  /** Todo salvo las secciones `## Fase N`. */
  common: string
  /** Secciones indexadas por número de fase. */
  phases: Map<number, string>
  /** true si el contrato traía al menos una sección `## Fase N` parseable. */
  hasPhaseSections: boolean
}

// `m` es imprescindible: el cuerpo de una sección es multilínea, y sin él `$` sólo
// casa al final del texto, así que el encabezado dejaba de encontrarse.
const PHASE_HEADING = /^##\s+Fase\s+(\d+)\s*[-—–:.]?\s*(.*)$/im

export type PhaseSection = {
  n: number
  heading: string
  skill?: string
  gate?: string
  closes?: string
  artifact?: string
  body: string
}

/** Backticks: en el contrato envuelven términos; en `phases.ts` son datos limpios. */
function clean(value: string): string {
  return value.trim().replace(/^`+|`+$/g, "").replace(/`/g, "")
}

/** Campos `- Skill:` / `- Gate:` / `- Cierra con:` / `- Artefacto:` de una sección de fase. */
function field(section: string, name: string): string | undefined {
  const match = section.match(new RegExp(`^-\\s*${name}:\\s*(.+)$`, "im"))
  const value = match?.[1]
  return value ? clean(value) : undefined
}

/**
 * Secciones de fase con sus campos estructurales, para el test de coherencia con `phases.ts`.
 * Campos ausentes quedan undefined; "ninguno"/"—" se normalizan a undefined, porque en
 * `phases.ts` una fase sin gate sencillamente no tiene el campo `gate`.
 */
export function phaseSections(contract: string): PhaseSection[] {
  const { phases } = parseSections(contract)
  return [...phases.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, body]) => {
      const heading = body.match(PHASE_HEADING)?.[2]?.trim() ?? ""
      const value = (name: string): string | undefined => {
        const raw = field(body, name)
        if (!raw || /^(ninguno|ninguna|ningún|—|-|n\/a|no aplica)$/i.test(raw)) return undefined
        return raw
      }
      return {
        n,
        heading,
        ...(value("Skill") ? { skill: value("Skill") } : {}),
        ...(value("Gate") ? { gate: value("Gate") } : {}),
        ...(value("Cierra con") ? { closes: value("Cierra con") } : {}),
        ...(value("Artefacto") ? { artifact: value("Artefacto") } : {}),
        body,
      }
    })
}

/**
 * Parte el contrato en bloque común + secciones por fase.
 * Tolera cualquier número de fases y cualquier orden; nunca lanza.
 */
export function parseSections(contract: string): Sections {
  const phases = new Map<number, string>()
  const common: string[] = []

  let current: { n: number; lines: string[] } | undefined
  const flush = () => {
    if (current) phases.set(current.n, current.lines.join("\n").trim())
    current = undefined
  }

  for (const line of contract.split(/\r?\n/)) {
    const heading = line.match(PHASE_HEADING)
    if (heading) {
      flush()
      current = { n: Number(heading[1]), lines: [line] }
      continue
    }
    if (current) current.lines.push(line)
    else common.push(line)
  }
  flush()

  return {
    common: common.join("\n").trim(),
    phases,
    hasPhaseSections: phases.size > 0,
  }
}

/**
 * Lo que se inyecta en una petición: bloque común + sección de la fase.
 *
 * Con contrato sin secciones -> el archivo completo (degradación honesta).
 * Con fase fuera del mapa -> bloque común y aviso, sin inventar una fase.
 */
export function renderFor(contract: string, fase: number): { text: string; degraded: boolean } {
  const sections = parseSections(contract)
  if (!sections.hasPhaseSections) {
    return { text: contract.trim(), degraded: true }
  }

  const section = sections.phases.get(fase)
  if (section === undefined) {
    return {
      text: `${sections.common}\n\n> Fase ${fase}: fuera del mapa de secciones del contrato (1-${[...sections.phases.keys()].sort((a, b) => b - a)[0] ?? "?"}).`,
      degraded: true,
    }
  }

  return { text: `${sections.common}\n\n${section}`.trim(), degraded: false }
}

/**
 * El contrato escribe las rutas con el placeholder `<feature>`: si se inyectara tal cual, el
 * modelo no sabría qué slug usar y escribiría en un directorio literal `<feature>`. Aquí se
 * sustituye SÓLO ese token por la feature declarada; `<slug>` se queda, porque es sintaxis de
 * comando (`/flow rename <slug>`) y no una ruta.
 *
 * Sin feature declarada (slug vacío) el texto queda intacto: el gate ya avisa de que falta.
 */
export function scopeToFeature(text: string, feature: string | undefined): string {
  if (!feature) return text
  return text.split("<feature>").join(feature)
}
