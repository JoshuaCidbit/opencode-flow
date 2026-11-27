// Marcador `.flow-feature` en la raíz del proyecto: `{ slug, createdAt }`.
//
// Para qué sirve: al retomar una sesión, el estado puede no estar en storage
// (sesión nueva, compactación, otro arranque). El marcador es la única huella en
// disco de que YA había un flow en marcha, y permite:
//   - deducir la fase por artefactos (ver DEDUCIBLE abajo),
//   - ofrecer retomar esa feature concreta.
//
// Reglas: nunca lanza. Un marcador corrupto es lo mismo que no tener marcador.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MAX_SLUG } from "./slug.ts"
import { isNonEmptyFile, satisfied } from "./gate.ts"

export const FEATURE_MARKER = ".flow-feature"

export type FeatureMarker = {
  readonly slug: string
  readonly createdAt: string
}

/**
 * Artefactos que CIERRAN las fases 1-4 y NO tienen gate (no hay nada que verificar en
 * escritura), así que no aparecen en `phases.ts`. Se usan SÓLO para deducir dónde retomar.
 *
 * `fase` es la fase en la que se retoma si el artefacto existe: cerrar la 1 deja en la 2.
 * - understanding.md → la 1 (Entender) está cerrada → 2.
 * - glossary.md → la 2 (Vocabulario) cerrada → 3.
 * - design.md → la 3 (Diseño) cerrada → 4 (Sondear). Si además hay spec.md, la 5 está
 *   cerrada y el cálculo sube a 6; por eso "design.md → 4/5" se resuelve por precedencia.
 *
 * Cada nombre se busca ÚNICAMENTE en `.scratch/<feature>/`. Antes se buscaban también en la
 * raíz (`CONTEXT.md`, `GLOSSARY.md`), y eso hacía deducir la fase 3 en una feature NUEVA por
 * un archivo del proyecto que no tiene nada que ver: lo de la raíz es del repo, no del flow.
 */
const DEDUCIBLE: ReadonlyArray<{ fase: number; names: readonly string[] }> = [
  { fase: 2, names: ["understanding.md"] },
  { fase: 3, names: ["glossary.md"] },
  { fase: 4, names: ["design.md"] },
]

export function readFeatureMarker(projectRoot: string): FeatureMarker | undefined {
  try {
    const raw = readFileSync(join(projectRoot, FEATURE_MARKER), "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return undefined
    const record = parsed as Record<string, unknown>
    const slug = record.slug
    // P5: el marcador lo puede escribir a mano quien quiera, así que se valida con el mismo
    // rasero que el resto: dentro de MAX_SLUG y con la forma canónica. Un slug fuera de rango
    // se ignora en vez de propagarse: si no, un marcador escrito a mano estiraría el contrato
    // inyectado por encima del presupuesto medido.
    if (typeof slug !== "string") return undefined
    if (slug.length === 0 || slug.length > MAX_SLUG) return undefined
    if (!/^[a-z0-9-]+$/.test(slug)) return undefined
    if (slug.startsWith("-") || slug.endsWith("-") || slug.includes("--")) return undefined
    return { slug, createdAt: typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString() }
  } catch {
    return undefined
  }
}

export function writeFeatureMarker(projectRoot: string, slug: string): FeatureMarker {
  const marker: FeatureMarker = { slug, createdAt: new Date().toISOString() }
  try {
    writeFileSync(join(projectRoot, FEATURE_MARKER), `${JSON.stringify(marker, null, 2)}\n`, "utf8")
  } catch {
    // Un marcador que no se pudo escribir no invalida el flow: sigue siendo opt-in.
  }
  return marker
}

export type Deduction = {
  /** Fase en la que retomar. */
  readonly fase: number
  /** Por qué: nombre del artefacto encontrado; si no hay ninguno, se dice que no hay. */
  readonly reason: string
}

/** Primer nombre presente de `names`, con su ruta relativa como razón. Nunca lanza.
 *  Sólo mira `.scratch/<feature>/`: lo que haya en la raíz del proyecto es del repo.
 *  Un archivo vacío no es evidencia de trabajo (misma regla que el gate). */
function presentName(projectRoot: string, feature: string, names: readonly string[]): string | undefined {
  for (const name of names) {
    const inFeature = join(".scratch", feature, name)
    if (isNonEmptyFile(join(projectRoot, inFeature))) return inFeature
  }
  return undefined
}

/**
 * Fase en la que retomar y POR QUÉ. Sin el por qué, una fase deducida parece adivinada:
 * quien retoma necesita saber qué artefacto la sostiene para juzgar si `/flow back` debe
 * corregirla (un borrador no aprobado sigue contando como artefacto en disco).
 */
export function deducePhaseInfo(projectRoot: string, feature: string): Deduction {
  let best: Deduction = { fase: 1, reason: "ningún artefacto en disco" }
  for (const mark of DEDUCIBLE) {
    const name = presentName(projectRoot, feature, mark.names)
    if (name && mark.fase > best.fase) best = { fase: mark.fase, reason: name }
  }
  for (let n = 5; n <= 6; n++) {
    if (satisfied(n, feature, projectRoot) && n + 1 > best.fase) {
      best = { fase: n + 1, reason: n === 5 ? `spec de .scratch/${feature}/` : `tickets en .scratch/${feature}/issues/` }
    }
  }
  return { fase: Math.min(best.fase, 10), reason: best.reason }
}

export function deducePhase(projectRoot: string, feature: string): number {
  return deducePhaseInfo(projectRoot, feature).fase
}
