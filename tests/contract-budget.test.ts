import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { renderFor, phaseSections } from "../src/contract.ts"
import { PHASES, LAST_PHASE, FIRST_PHASE, phase } from "../src/phases.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACT = readFileSync(join(HERE, "..", "flow.md"), "utf8")

// Presupuesto (punto 3 de 4d): lo inyectado se reconstruye en CADA petición, así que
// su coste se paga por turno. Si se supera, el test falla: o se recorta el contrato,
// o se sube el número a sabiendas.
//
// Medido al fijarlo (v0.3.0, tras Gate B en el bloque común): máximo 6330 bytes en fase 5;
// el archivo completo ronda 8,4 KB. Se deja margen para 4f, que añadirá las fases 1-4.
const BUDGET_BYTES = 9000
const MEASURED_MAX_BYTES = 6330

test("A2: presupuesto de tamaño de lo inyectado por petición", () => {
  let worst = 0
  let worstPhase = 0
  for (let n = FIRST_PHASE; n <= LAST_PHASE; n++) {
    const bytes = Buffer.byteLength(renderFor(CONTRACT, n).text, "utf8")
    if (bytes > worst) {
      worst = bytes
      worstPhase = n
    }
  }
  assert.ok(
    worst <= BUDGET_BYTES,
    `la fase ${worstPhase} inyecta ${worst} bytes, presupuesto ${BUDGET_BYTES}. Recorta el contrato o sube el presupuesto a sabiendas.`,
  )
  // La medida registrada al fijar el presupuesto: si el contrato crece, se actualiza el comentario.
  assert.ok(worst > 0 && worst <= BUDGET_BYTES)
  assert.ok(MEASURED_MAX_BYTES <= BUDGET_BYTES)
})

test("A2: el presupuesto se mide en todas las fases, no sólo en una", () => {
  // Regla anti-trampas: si una fase se dispara, que se vea.
  for (let n = FIRST_PHASE; n <= LAST_PHASE; n++) {
    const { degraded } = renderFor(CONTRACT, n)
    assert.equal(degraded, false, `la fase ${n} no debe degradar`)
  }
})

// Punto 6: coherencia entre flow.md y phases.ts.
test("A2: las fases del contrato son exactamente las de phases.ts", () => {
  const fromContract = phaseSections(CONTRACT).map((s) => s.n)
  assert.deepEqual(fromContract, PHASES.map((p) => p.n))
})

test("A2: nombre, gate, skill y cierre de cada fase coinciden con phases.ts", () => {
  for (const section of phaseSections(CONTRACT)) {
    const entry = phase(section.n)
    assert.ok(entry, `la fase ${section.n} del contrato no existe en phases.ts`)

    assert.equal(section.heading.toLowerCase(), entry.name.toLowerCase(), `fase ${section.n}: nombre`)
    assert.equal(section.skill, entry.skill, `fase ${section.n}: skill`)
    assert.equal(section.gate, entry.gate, `fase ${section.n}: gate`)
    assert.equal(section.closes, entry.closes, `fase ${section.n}: cierra con`)
  }
})

test("A2: la tabla del contrato coincide con phases.ts (nº, fase, skill, cierre)", () => {
  // Se parte por `|`, no con un regex: la celda de skill no siempre está entre
  // backticks (fase 8 es "`code-review` contra el spec") y eso rompía el regex.
  const rows = CONTRACT.split(/\r?\n/)
    .filter((line) => /^\s*\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))

  assert.equal(rows.length, PHASES.length, "la tabla debe tener una fila por fase")

  const norm = (s: string) => s.trim().replace(/`/g, "")
  for (const cells of rows) {
    const n = Number(cells[0])
    const entry = phase(n)
    assert.ok(entry, `la fila ${n} de la tabla no existe en phases.ts`)
    assert.equal(norm(cells[1]), entry.name, `fase ${n}: nombre en tabla`)
    assert.equal(norm(cells[2]), entry.skill, `fase ${n}: skill en tabla`)
    assert.equal(norm(cells[3]), entry.closes, `fase ${n}: cierra con en tabla`)
  }
})

test("A2: fases con gate verificable declaran artefacto en el contrato", () => {
  for (const entry of PHASES) {
    const section = phaseSections(CONTRACT).find((s) => s.n === entry.n)
    assert.ok(section, `falta sección para fase ${entry.n}`)
    if (entry.blocks) {
      assert.ok(section.artifact, `la fase ${entry.n} bloquea: debe declarar su artefacto`)
      assert.match(section.artifact, /spec\.md|issues/, `fase ${entry.n}: artefacto reconocible`)
    }
  }
})
