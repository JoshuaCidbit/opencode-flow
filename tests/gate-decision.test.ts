import { test } from "node:test"
import assert from "node:assert/strict"
import { decide, WRITING_TOOLS } from "../src/gate-decision.ts"

test("A5: WRITING_TOOLS contiene las herramientas que escriben", () => {
  for (const tool of ["write", "edit", "multiedit", "patch"]) {
    assert.ok(WRITING_TOOLS.has(tool), `falta ${tool}`)
  }
})

test("A5: una herramienta de LECTURA es libre y no consulta el estado", () => {
  // Se pasa internalError para demostrar que NI siquiera se mira: si se consultara estado,
  // el error interno activaría fail-open. Al ser lectura, la decisión es "free".
  const decision = decide({ tool: "read", internalError: new Error("boom") })
  assert.equal(decision.kind, "free")
})

test("A5: lectura 'free' también sin estado alguno", () => {
  assert.equal(decide({ tool: "grep" }).kind, "free")
  assert.equal(decide({ tool: "bash" }).kind, "free")
})

test("regla 4: error interno -> falla abierta (permite) y avisa", () => {
  const decision = decide({ tool: "write", internalError: "disco roto" })
  assert.equal(decision.kind, "fail-open")
  assert.match((decision as { error: string }).error, /disco roto/)
})

test("regla 4: la falla abierta NUNCA bloquea", () => {
  const decision = decide({
    tool: "write",
    internalError: "cualquier cosa",
    state: { fase: 9, active: true },
  })
  assert.notEqual(decision.kind, "block")
  assert.equal(decision.kind, "fail-open")
})

// A5: apply_patch también escribe; si falta en el conjunto, se cuela una escritura.
test("A5: apply_patch está en WRITING_TOOLS", () => {
  assert.ok(WRITING_TOOLS.has("apply_patch"))
  assert.ok(WRITING_TOOLS.has("multiedit"))
})

test("escritura sin flow activo: permitida", () => {
  assert.equal(decide({ tool: "write", state: { fase: 1, active: false } }).kind, "allow")
  assert.equal(decide({ tool: "write" }).kind, "allow")
})

// La criba sólo clasifica; la política de rutas vive en verdictFor (Gate B). Incluso las
// fases 1-4 delegan: el bloqueo real lo decide gate.ts con el whitelist.
test("B: escritura en fases 1-4 delega en verdictFor (no bloquea en la criba)", () => {
  for (const fase of [1, 2, 3, 4]) {
    const decision = decide({ tool: "write", state: { fase, active: true } })
    assert.notEqual(decision.kind, "free", "no es lectura: sí consulta el estado")
    assert.equal(decision.kind, "evaluate", `fase ${fase}: delega en verdictFor`)
  }
})

test("B: escritura en fase 5+ también delega en verdictFor", () => {
  const decision = decide({ tool: "write", state: { fase: 9, active: true } })
  assert.equal(decision.kind, "evaluate")
})

test("A5: el nombre de herramienta es insensible a mayúsculas", () => {
  assert.equal(decide({ tool: "WRITE", state: { fase: 5, active: true } }).kind, "evaluate")
  assert.equal(decide({ tool: "READ" }).kind, "free")
})
