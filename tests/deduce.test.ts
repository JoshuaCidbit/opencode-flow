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

// P2: la deducción mira SÓLO `.scratch/<feature>/`. `GLOSSARY.md` y `CONTEXT.md` en la raíz
// son del proyecto, no del flow: antes deducían la fase 3 en una feature NUEVA sin artefactos.
test("3: glossary.md en .scratch/ deduce fase 3 (la fase 2 ya está cerrada)", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "glossary.md"), "# Glosario\n\nTérmino: algo.\n")
  assert.equal(deducePhase(root, "auth"), 3)
})

test("P2: CONTEXT.md ni GLOSSARY.md en la raíz deducen: no son del flow", () => {
  // El caso que motivó P2: un repo que ya traía documentación hacía retomar en la fase 3
  // una feature recién creada, pidiendo dar por hecho un vocabulario que nadie aprobó.
  const withContext = project()
  writeFileSync(join(withContext, "CONTEXT.md"), "# Contexto\n\nAlgo.\n")
  assert.equal(deducePhase(withContext, "auth"), 1, "CONTEXT.md en la raíz no deduce")

  const withGlossary = project()
  writeFileSync(join(withGlossary, "GLOSSARY.md"), "# Glosario\n\nTérmino: algo.\n")
  assert.equal(deducePhase(withGlossary, "auth"), 1, "GLOSSARY.md en la raíz no deduce")

  // Y el artefacto correcto, en su sitio, sí deduce.
  const right = project()
  mkdirSync(join(right, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(right, ".scratch", "auth", "glossary.md"), "# Glosario\n\nTérmino: algo.\n")
  assert.equal(deducePhase(right, "auth"), 3, "glossary.md en .scratch/ sí deduce 3")
})

test("P2: CONTEXT.md preexistente + feature nueva sin artefactos -> fase 1", () => {
  const root = project()
  writeFileSync(join(root, "CONTEXT.md"), "# Contexto\n\nPreexistente.\n")
  writeFileSync(join(root, "GLOSSARY.md"), "# Glosario\n\nPreexistente.\n")
  mkdirSync(join(root, "docs", "adr"), { recursive: true })
  writeFileSync(join(root, "docs", "adr", "0001.md"), "# ADR\n\nAlgo.\n")
  // La feature `nueva` no ha escrito nada todavía.
  assert.equal(deducePhase(root, "nueva"), 1)
  // Y entendiendo.md en .scratch/ de OTRA feature no se le cuenta.
  mkdirSync(join(root, ".scratch", "vieja"), { recursive: true })
  writeFileSync(join(root, ".scratch", "vieja", "understanding.md"), "# Entendí\n\nOtra.\n")
  assert.equal(deducePhase(root, "nueva"), 1, "los artefactos de otra feature no cuentan")
  assert.equal(deducePhase(root, "vieja"), 2, "la que sí escribió deduce 2")
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
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  const file = join(root, ".scratch", "auth", "understanding.md")
  writeFileSync(file, "   \n")
  assert.equal(deducePhase(root, "auth"), 1)
  writeFileSync(file, "# Entendimiento\n\nDe verdad.\n")
  assert.equal(deducePhase(root, "auth"), 2)
})

// P2: dentro de `issues/` sólo cuentan tickets reales. Un directorio con basura no es
// evidencia de haber troceado la feature, y sin este filtro la fase 6 se daba por cerrada
// con un `.gitkeep` o con el `README.md` que algunas plantillas traen.
test("P2: en issues/ no cuenta un archivo vacío", () => {
  const root = project()
  const issues = join(root, ".scratch", "auth", "issues")
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "understanding.md"), "# Entendí\n")
  writeFileSync(join(issues, "vacio.md"), "   \n")
  assert.equal(deducePhase(root, "auth"), 2, "sólo el understanding.md: el ticket vacío no sube a 7")
  writeFileSync(join(issues, "real.md"), "# Ticket\n\nHacer algo.\n")
  assert.equal(deducePhase(root, "auth"), 7, "con un ticket real sí llega a 7")
})

test("P2: en issues/ no cuenta un dotfile (oculto)", () => {
  const root = project()
  const issues = join(root, ".scratch", "auth", "issues")
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(issues, ".gitkeep"), "x\n")
  writeFileSync(join(issues, ".oculto.md"), "# Ticket\n\nOculto.\n")
  assert.equal(deducePhase(root, "auth"), 1, "un issues/ con sólo dotfiles no deduce nada")
})

test("P2: en issues/ no cuenta README.md", () => {
  const root = project()
  const issues = join(root, ".scratch", "auth", "issues")
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(issues, "README.md"), "# Índice\n\nLista de tickets.\n")
  assert.equal(deducePhase(root, "auth"), 1, "README.md es índice, no ticket")
})
