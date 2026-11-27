import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadContract } from "../src/index.ts"
import { renderFor } from "../src/contract.ts"

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "opencode-flow-"))
  const file = join(dir, name)
  writeFileSync(file, content, "utf8")
  return file
}

test("A2: options.path manda: se lee ESE archivo, no el empaquetado", async () => {
  const custom = tempFile("mi-flow.md", "## Fase 9 — Publicar\n\n- Gate: `integration`\n")
  const loaded = await loadContract({ path: custom })
  assert.ok(loaded)
  assert.equal(loaded.source, custom)
  assert.match(loaded.text, /mi-flow|Fase 9/)
})

test("A2: options.path sin secciones de fase -> lo inyectado degrada al archivo completo", async () => {
  const custom = tempFile("propio.md", "# Contrato propio\n\nSin secciones de fase.\n")
  const loaded = await loadContract({ path: custom })
  assert.ok(loaded)
  const rendered = renderFor(loaded.text, 3)
  assert.equal(rendered.degraded, true)
  assert.equal(rendered.text, "# Contrato propio\n\nSin secciones de fase.")
})

test("A2: options.path con secciones -> inyecta la sección de esa fase", async () => {
  const custom = tempFile(
    "secc.md",
    "## Común\n\nregla común\n\n## Fase 1 — Uno\n\ncontenido uno\n\n## Fase 2 — Dos\n\ncontenido dos\n",
  )
  const loaded = await loadContract({ path: custom })
  assert.ok(loaded)
  const rendered = renderFor(loaded.text, 2)
  assert.equal(rendered.degraded, false)
  assert.match(rendered.text, /regla común/)
  assert.match(rendered.text, /contenido dos/)
  assert.ok(!rendered.text.includes("contenido uno"), "no colar la fase vecina")
})

test("A2: options.path inexistente -> undefined (y el setup cae al brief mínimo)", async () => {
  const loaded = await loadContract({ path: join(tmpdir(), "no-existe-opencode-flow.md") })
  assert.equal(loaded, undefined)
})

test("A2: options.path vacío -> undefined", async () => {
  const custom = tempFile("vacio.md", "   \n\n")
  const loaded = await loadContract({ path: custom })
  assert.equal(loaded, undefined)
})
