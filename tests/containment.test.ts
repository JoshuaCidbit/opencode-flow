// Punto 3: contención de rutas. `canonical()` resuelve el realpath del ancestro
// existente más cercano cuando el destino aún no existe; sin eso, la PRIMERA escritura
// de `.scratch/<slug>/x.md` (con `.scratch/` sin crear) se bloquearía por no poder
// resolver el destino, y eso es exactamente el caso más común.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { verdictFor } from "../src/gate.ts"

const feature = "auth"

function project(): string {
  return mkdtempSync(join(tmpdir(), "flow-containment-"))
}

function write(file: string) {
  return { kind: "file" as const, file, tool: "write" }
}

// (a) primera escritura con .scratch/ inexistente → permitida
test("3a: primera escritura de .scratch/<slug>/x.md con .scratch/ inexistente se permite", () => {
  const root = project()
  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "notas.md")),
  )
  assert.equal(verdict.allow, true, verdict.reason)
})

test("3a: la misma escritura en fase 1-6 se permite en todas", () => {
  const root = project()
  for (const fase of [1, 2, 3, 4, 5, 6]) {
    const verdict = verdictFor(
      { projectRoot: root, fase, feature },
      write(join(root, ".scratch", feature, "notas.md")),
    )
    assert.equal(verdict.allow, true, `fase ${fase}: ${verdict.reason}`)
  }
})

// (b) symlink dentro de un ancestro existente apuntando fuera → bloqueada
test("3b: symlink dentro de un ancestro existente que apunta fuera del proyecto se bloquea", () => {
  const root = project()
  const outside = mkdtempSync(join(tmpdir(), "flow-outside-"))
  mkdirSync(join(root, ".scratch"), { recursive: true })
  // .scratch/<feature> es un symlink a un directorio externo: parece dentro, no lo está.
  symlinkSync(outside, join(root, ".scratch", feature))

  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "escape.md")),
  )
  assert.equal(verdict.allow, false)
  assert.match(verdict.reason, /fuera del proyecto|seguridad/)
})

test("3b: symlink del propio proyecto hacia fuera se bloquea aunque la ruta parezca interna", () => {
  const root = project()
  const outside = mkdtempSync(join(tmpdir(), "flow-outside-"))
  writeFileSync(join(outside, "objetivo.md"), "x")
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  symlinkSync(join(outside, "objetivo.md"), join(root, ".scratch", feature, "puerta.md"))

  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "puerta.md")),
  )
  assert.equal(verdict.allow, false)
})

// (c) ".." → bloqueada
test("3c: .. escapando del proyecto se bloquea", () => {
  const root = project()
  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "..", "..", "..", "etc", "passwd")),
  )
  assert.equal(verdict.allow, false)
})

test("3c: .. fuera del whitelist (.scratch) se bloquea en fases 1-6", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "..", "src", "app.ts")),
  )
  assert.equal(verdict.allow, false)
})

test("3c: .. que se queda DENTRO de .scratch/<feature>/ se permite", () => {
  const root = project()
  mkdirSync(join(root, ".scratch", feature, "sub"), { recursive: true })
  const verdict = verdictFor(
    { projectRoot: root, fase: 3, feature },
    write(join(root, ".scratch", feature, "sub", "..", "ok.md")),
  )
  assert.equal(verdict.allow, true, verdict.reason)
})
