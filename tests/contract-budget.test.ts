import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { renderFor, phaseSections, parseSections, scopeToFeature } from "../src/contract.ts"
import { PHASES, LAST_PHASE, FIRST_PHASE, phase } from "../src/phases.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACT = readFileSync(join(HERE, "..", "flow.md"), "utf8")

// Presupuesto (punto 3 de 4d): lo inyectado se reconstruye en CADA petición, así que
// su coste se paga por turno. Si se supera, el test falla: o se recorta el contrato,
// o se sube el número a sabiendas.
//
// Medido al fijarlo (v0.3.0 + P1): máximo 6689 bytes en fase 1; el archivo completo ronda 10,3 KB.
// El margen hasta 7 KB es deliberado: cabe prose nueva sin renegociar el límite.
const BUDGET_BYTES = 7000
const MEASURED_MAX_BYTES = 6689

// Medición real por fase. `worst` identifica la fase más cara: el mensaje de fallo la nombra
// para que recortar no sea a ciegas. Buffer.byteLength (no `.length`): las tildes y los «»
// cuentan 2 bytes en UTF-8 y eso es lo que paga el contexto, no los caracteres.
function measureAll(contract: string): { bytes: number[]; worst: number; worstPhase: number } {
  const bytes: number[] = []
  let worst = 0
  let worstPhase = 0
  for (let n = FIRST_PHASE; n <= LAST_PHASE; n++) {
    const size = Buffer.byteLength(renderFor(contract, n).text, "utf8")
    bytes.push(size)
    if (size > worst) {
      worst = size
      worstPhase = n
    }
  }
  return { bytes, worst, worstPhase }
}

const { bytes: PER_PHASE, worst, worstPhase } = measureAll(CONTRACT)

test("A2: presupuesto de tamaño de lo inyectado por petición", () => {
  assert.ok(
    worst <= BUDGET_BYTES,
    `la fase ${worstPhase} inyecta ${worst} bytes, presupuesto ${BUDGET_BYTES}. ` +
      `Recorta el contrato o sube el presupuesto a sabiendas. Por fase: ${PER_PHASE.map((b, i) => `${i + 1}=${b}`).join(", ")}`,
  )
  // Registro de la medida al fijar el presupuesto: sirve para ver la deriva del contrato.
  assert.equal(worst, MEASURED_MAX_BYTES, `el máximo medido cambió (fase ${worstPhase}); actualiza MEASURED_MAX_BYTES y el CHANGELOG`)
  assert.ok(MEASURED_MAX_BYTES <= BUDGET_BYTES)
})

test("A2: el margen deja sitio para prose nueva", () => {
  // El techo es el presupuesto duro (7000). El suelo es bajo a propósito: recortar el
  // contrato es una mejora y NO debe romper el test, así que sólo se exige que quede aire.
  // Si el margen llegara a 0, cualquier añadido futuro exigiría renegociar el límite.
  const margin = BUDGET_BYTES - worst
  assert.ok(
    margin >= 150,
    `margen de ${margin} bytes (fase ${worstPhase}): por debajo del suelo de 150 B; ` +
      `recorta el contrato. Por fase: ${PER_PHASE.map((b, i) => `${i + 1}=${b}`).join(", ")}`,
  )
  assert.ok(worst <= BUDGET_BYTES, `la fase ${worstPhase} inyecta ${worst} bytes, techo ${BUDGET_BYTES}`)
})

test("A2: todas las fases inyectan algo medible y ninguna supera a la peor", () => {
  assert.equal(PER_PHASE.length, 10)
  for (const size of PER_PHASE) assert.ok(size > 0 && size <= worst)
})

// P1: cada fase 1-4 nombra el artefacto que la cierra y su ruta EXACTA bajo .scratch/<feature>/.
// Sin esto el modelo no escribe nada y `resume` siempre cae a la fase 1 repitiendo el grilling.
test("P1: las fases 1-4 nombran su artefacto de cierre con la ruta exacta", () => {
  const expected: Record<number, string> = {
    1: ".scratch/<feature>/understanding.md",
    2: ".scratch/<feature>/glossary.md",
    3: ".scratch/<feature>/design.md",
    4: "/tmp/opencode-proto-<feature>/",
  }
  for (const n of [1, 2, 3, 4]) {
    const body = parseSections(CONTRACT).phases.get(n) ?? ""
    assert.ok(body.includes(expected[n]), `la fase ${n} no menciona ${expected[n]}`)
    // `<feature>` para rutas, `<slug>` sólo para sintaxis de comando (`/flow rename <slug>`).
    assert.ok(!/[\w./-]*<slug>/.test(body.replace(/\/flow \w+ <slug>/g, "")), `la fase ${n} usa <slug> como ruta; las rutas van con <feature>`)
  }
})

test("P1: la fase 1 fija las seis reglas que la definen", () => {
  const body = parseSections(CONTRACT).phases.get(1) ?? ""
  assert.match(body, /Explora antes de preguntar/, "regla 1")
  assert.match(body, /Una pregunta por turno/, "regla 2")
  assert.match(body, /Sin código/, "regla 3")
  assert.match(body, /understanding\.md/, "regla 4: artefacto")
  assert.match(body, /\/flow rename/, "regla 5: slug provisional")
  assert.match(body, /Espera.*\/flow next/s, "regla 6: esperar /flow next")
  // (e): la regla crítica no puede depender de que la skill `grilling` exista en el host.
  assert.match(body, /nunca lo ejecutes tú/, "regla 6 debe decir que el modelo no avanza")
})

test("P1: el bloque común conserva checkpoint, narración, Gate B, /flow next del usuario y /flow off", () => {
  const { common } = parseSections(CONTRACT)
  assert.match(common, /\*\*Entendí\*\*: qué se pide, con citas `path:line`/, "formato del checkpoint")
  assert.match(common, /\[flow\] fase N · gate pendiente: X/, "instrucción de narrar")
  assert.match(common, /Fases 1-6:\*\* sólo en `\.scratch\/<feature>\/\*\*`/, "Gate B")
  assert.match(common, /\/tmp\/opencode-proto-<feature>\/\*\*/, "Gate B incluye el proto de la fase 4")
  assert.match(common, /`\/flow next` y `\/flow back` los ejecuta sólo el usuario/, "/flow next es del usuario")
  assert.match(common, /`\/flow rename <slug>`/, "rename para el slug provisional")
  assert.match(common, /`\/flow off` — escapatoria/, "escapatoria")
})

test("P1: `scopeToFeature` resuelve las rutas y deja el placeholder de comando intacto", () => {
  const text = "escribe .scratch/<feature>/spec.md y renombra con /flow rename <slug>"
  assert.equal(scopeToFeature(text, "auth"), "escribe .scratch/auth/spec.md y renombra con /flow rename <slug>")
  // Sin feature declarada, mejor el placeholder que una ruta inventada.
  assert.equal(scopeToFeature(text, undefined), text)
})

test("P1: el contrato inyectado en fase 1 lleva las rutas ya resueltas a la feature", () => {
  const injected = scopeToFeature(renderFor(CONTRACT, 1).text, "abc")
  assert.ok(injected.includes(".scratch/abc/understanding.md"), "la ruta del artefacto lleva el slug concreto")
  assert.ok(!injected.includes("<feature>"), "no debe quedar ningún placeholder de ruta sin resolver")
  assert.match(injected, /una pregunta por turno/i)
})

test("A2: el presupuesto se mide en todas las fases, no sólo en una", () => {
  // Regla anti-trampas: si una fase se dispara, que se vea.
  for (let n = FIRST_PHASE; n <= LAST_PHASE; n++) {
    const { degraded } = renderFor(CONTRACT, n)
    assert.equal(degraded, false, `la fase ${n} no debe degradar`)
  }
})

// Las fases 1-4 declaran `Gate: ninguno` en prosa. Sin normalización, `phaseSections`
// devolvería "ninguno" y chocaría con `phases.ts`, que sencillamente no tiene el campo.
// Este test fija el vocabulario aceptado para "sin gate" y evita que alguien escriba
// `Gate: ninguna` y rompa la coherencia en silencio.
test("P1: `Gate: ninguno` en las fases 1-4 se normaliza a ausencia de gate", () => {
  for (const n of [1, 2, 3, 4]) {
    const section = phaseSections(CONTRACT).find((s) => s.n === n)
    assert.ok(section, `falta la fase ${n}`)
    assert.equal(section.gate, undefined, `fase ${n}: "ninguno" debe normalizarse a undefined`)
    assert.equal(phase(n)?.gate, undefined, `fase ${n}: phases.ts tampoco declara gate`)
    assert.match(section.body, /^-\s*Gate:\s*ninguno$/im, `fase ${n}: usa exactamente "ninguno"`)
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
