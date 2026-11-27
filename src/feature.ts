// Marcador `.flow-feature` en la raíz del proyecto: `{ slug, createdAt }`.
//
// Para qué sirve: al retomar una sesión, el estado puede no estar en storage
// (sesión nueva, compactación, otro arranque). El marcador es la única huella en
// disco de que YA había un flow en marcha, y permite:
//   - deducir la fase por artefactos (spec -> 7, tickets -> 7),
//   - ofrecer retomar esa feature concreta.
//
// Reglas: nunca lanza. Un marcador corrupto es lo mismo que no tener marcador.

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { satisfied } from "./gate.ts"

export const FEATURE_MARKER = ".flow-feature"

export type FeatureMarker = {
  readonly slug: string
  readonly createdAt: string
}

export function readFeatureMarker(projectRoot: string): FeatureMarker | undefined {
  try {
    const raw = readFileSync(join(projectRoot, FEATURE_MARKER), "utf8")
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return undefined
    const record = parsed as Record<string, unknown>
    const slug = record.slug
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 40) return undefined
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

/**
 * Fase más alta ya ganada por los artefactos en disco, o 1 si no hay nada.
 * Sólo sube por evidencia real: delega en `satisfied()`, la MISMA función que usa el
 * gate, para no tener dos definiciones distintas de "artefacto presente".
 */
export function deducePhase(projectRoot: string, feature: string): number {
  let deduced = 1
  for (let n = 1; n <= 10; n++) {
    if (!satisfied(n, feature, projectRoot)) continue
    deduced = Math.max(deduced, n + 1)
  }
  return Math.min(deduced, 10)
}
