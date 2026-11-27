// Punto 3: deducción de la fase de retomar por artefactos en disco (fases 1-4 por nombres,
// 5-6 delegando en `satisfied()`), más el caso de archivo vacío.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deducePhase, deducePhaseInfo } from "../src/feature.ts"

function project(): string {
  return mkdtempSync(join(tmpdir(), "flow-deduce-"))
}

// Punto 3: las fases 1-4 no tienen gate ni artefacto verificable en escritura, pero SÍ
// dejan huella en disco. Sin esta deducción, un usuario que cerró la 1 (understanding.md)
// retomaba en la fase 1 otra vez: el flow le pedía repetir trabajo ya hecho.

test("3: understanding.md deduce fase 2 (la fase 1 ya está cerrada)", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  assert.equal(deducePhase(root, "auth"), 1, "sin artefactos: 1")
  writeFileSync(join(root, ".scratch", "auth", "understanding.md"), "# Entendimiento\n\nEntiendo.\n")
  assert.equal(deducePhase(root, "auth"), 2)
})

test("3: GLOSSARY.md y CONTEXT.md deducen fase 3 (la fase 2 ya está cerrada)", () => {
  const root = project()
  writeFileSync(join(root, "GLOSSARY.md"), "# Glosario\n\nTérmino: algo.\n")
  assert.equal(deducePhase(root, "auth"), 3)

  const other = project()
  writeFileSync(join(other, "CONTEXT.md"), "# Contexto\n\nAlgo.\n")
  assert.equal(deducePhase(other, "auth"), 3)
})

test("3: design.md deduce fase 4, y nunca por encima de lo que el spec dice", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "design.md"), "# Diseño\n\nCosturas.\n")
  assert.equal(deducePhase(root, "auth"), 4, "diseño cerrado -> retomar en sondeo")

  // Si ADEMÁS hay spec, la 5 está cerrada y sube a 6: gana la evidencia mayor.
  writeFileSync(join(root, ".scratch", "auth", "spec.md"), "# Spec\n\nDe verdad.\n")
  assert.equal(deducePhase(root, "auth"), 6)
})

test("3: deducePhase nunca supera la última fase ni baja de 1", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "understanding.md"), "ok\n")
  writeFileSync(join(root, ".scratch", "auth", "spec.md"), "# Spec\n\nDe verdad.\n")
  mkdirSync(join(root, ".scratch", "auth", "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "issues", "001.md"), "# Ticket\n")
  const fase = deducePhase(root, "auth")
  assert.ok(fase >= 1 && fase <= 10, `fuera de rango: ${fase}`)
})

test("3: un artefacto 1-4 vacío no deduce fase (misma regla que el gate)", () => {
  const root = project()
  writeFileSync(join(root, "understanding.md"), "   \n")
  assert.equal(deducePhase(root, "auth"), 1)
  writeFileSync(join(root, "understanding.md"), "# Entendimiento\n\nDe verdad.\n")
  assert.equal(deducePhase(root, "auth"), 2)
})
