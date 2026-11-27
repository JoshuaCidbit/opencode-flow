import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseSections, renderFor } from "../src/contract.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACT = readFileSync(join(HERE, "..", "flow.md"), "utf8")

// El contrato real del repo: si esto falla, flow.md dejó de ser parseable.
test("A2: el contrato real tiene bloque común y 10 secciones de fase", () => {
  const s = parseSections(CONTRACT)
  assert.equal(s.hasPhaseSections, true)
  assert.equal(s.phases.size, 10)
  for (let n = 1; n <= 10; n++) assert.ok(s.phases.has(n), `falta fase ${n}`)
})

test("A2: el bloque común NO contiene ninguna sección de fase", () => {
  const s = parseSections(CONTRACT)
  assert.ok(s.common.includes("## Tres gates"))
  assert.ok(s.common.includes("## Narración obligatoria"))
  assert.ok(s.common.includes("## Verificación (escalera)"))
  assert.ok(!s.common.includes("## Fase 5"))
})

test("A2: cada sección de fase empieza por su encabezado", () => {
  const s = parseSections(CONTRACT)
  for (let n = 1; n <= 10; n++) {
    assert.match(s.phases.get(n) ?? "", new RegExp(`^## Fase ${n} — `))
  }
})

test("A2: la sección de fase 5 menciona su artefacto", () => {
  const s = parseSections(CONTRACT)
  assert.match(s.phases.get(5) ?? "", /\.scratch\/<feature>\/spec\.md/)
})

test("A2: renderFor une bloque común + sección de la fase", () => {
  const { text, degraded } = renderFor(CONTRACT, 5)
  assert.equal(degraded, false)
  assert.match(text, /## Tres gates/)
  assert.match(text, /## Fase 5 — Especificar/)
  assert.ok(!text.includes("## Fase 6"), "no debe colar fases vecinas")
})

test("A2: renderFor para fase 1 no incluye otras fases", () => {
  const { text } = renderFor(CONTRACT, 1)
  assert.match(text, /## Fase 1 — Entender/)
  assert.ok(!text.includes("## Fase 7"))
})

test("A2: contrato SIN secciones -> degradación a archivo completo", () => {
  const custom = "# Mi contrato\n\nReglas propias.\n\nSin encabezados de fase."
  const { text, degraded } = renderFor(custom, 3)
  assert.equal(degraded, true)
  assert.equal(text, custom.trim())
})

test("A2: fase fuera del mapa -> degradación con aviso y sin inventar fase", () => {
  const { text, degraded } = renderFor(CONTRACT, 99)
  assert.equal(degraded, true)
  assert.match(text, /fuera del mapa de secciones/)
  assert.ok(!text.includes("## Fase 99"))
})

test("A2: parseSections tolera contrato vacío sin lanzar", () => {
  const s = parseSections("")
  assert.equal(s.hasPhaseSections, false)
  assert.equal(s.common, "")
})

test("A2: parseSections tolera texto sin encabezados", () => {
  const s = parseSections("solo texto\nsin nada")
  assert.equal(s.phases.size, 0)
  assert.equal(s.common, "solo texto\nsin nada")
})
