// Punto 4: `state.allow` es una FOTO de lo que existía al `/flow start`. Debe recalcularse
// en `/flow resume` y `/flow back` (son nuevos puntos de partida), y quedar fijo sólo
// durante una misma ejecución: crear CONTEXT.md a mitad de camino no abre el gate.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { snapshotAllow } from "../src/index.ts"
import { verdictFor } from "../src/gate.ts"

function project(): string {
  return mkdtempSync(join(tmpdir(), "flow-allow-"))
}

test("4: snapshotAllow congela sólo lo que existe en ese momento", () => {
  const root = project()
  assert.deepEqual(snapshotAllow(root), [])

  // Crea CONTEXT.md y docs/adr DESPUÉS del primer snapshot: no se cuelan.
  writeFileSync(join(root, "CONTEXT.md"), "# contexto\n")
  mkdirSync(join(root, "docs", "adr"), { recursive: true })
  assert.deepEqual(snapshotAllow(root).sort(), ["CONTEXT.md", "docs/adr"])
})

test("4: CONTEXT.md creado a posteriori NO abre el gate si no estaba en la foto", () => {
  const root = project()
  const allow: string[] = [] // foto tomada antes de que existiera CONTEXT.md
  writeFileSync(join(root, "CONTEXT.md"), "# contexto\n")

  const verdict = verdictFor(
    { projectRoot: root, fase: 2, feature: "auth", allow },
    { kind: "file", file: join(root, "CONTEXT.md"), tool: "write" },
  )
  assert.equal(verdict.allow, false, "crearlo después no abre el gate")
})

test("4: CONTEXT.md sí se permite si estaba en la foto del start", () => {
  const root = project()
  writeFileSync(join(root, "CONTEXT.md"), "# contexto\n")
  const allow = snapshotAllow(root)

  const verdict = verdictFor(
    { projectRoot: root, fase: 2, feature: "auth", allow },
    { kind: "file", file: join(root, "CONTEXT.md"), tool: "write" },
  )
  assert.equal(verdict.allow, true, verdict.reason)
})

test("4: el allow recalculado en resume/back sí abre el gate (nuevo punto de partida)", () => {
  const root = project()
  // Primer start: no existía. Se crea durante la ejecución.
  writeFileSync(join(root, "CONTEXT.md"), "# contexto\n")
  // Resume: se vuelve a hacer la foto; ahora sí entra.
  const allow = snapshotAllow(root)
  assert.deepEqual(allow, ["CONTEXT.md"])

  const verdict = verdictFor(
    { projectRoot: root, fase: 2, feature: "auth", allow },
    { kind: "file", file: join(root, "CONTEXT.md"), tool: "write" },
  )
  assert.equal(verdict.allow, true, verdict.reason)
})

test("4: docs/adr/heredado.md se permite si docs/adr estaba en la foto", () => {
  const root = project()
  mkdirSync(join(root, "docs", "adr"), { recursive: true })
  const allow = snapshotAllow(root)
  assert.deepEqual(allow, ["docs/adr"])

  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature: "auth", allow },
    { kind: "file", file: join(root, "docs", "adr", "0001-x.md"), tool: "write" },
  )
  assert.equal(verdict.allow, true, verdict.reason)
})

test("4: el allow sólo cuenta en fases 2-3", () => {
  const root = project()
  writeFileSync(join(root, "CONTEXT.md"), "# contexto\n")
  const allow = snapshotAllow(root)

  for (const fase of [1, 4, 5, 6]) {
    const verdict = verdictFor(
      { projectRoot: root, fase, feature: "auth", allow },
      { kind: "file", file: join(root, "CONTEXT.md"), tool: "write" },
    )
    assert.equal(verdict.allow, false, `fase ${fase}: el allow no debe contar`)
  }
})
