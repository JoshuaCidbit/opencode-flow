// Punto (e): oferta de retomar cuando hay UNA sola feature marcada.
// Punto (d): el `delivery` de las respuestas, contrastado con el contrato real del runtime.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deducePhase, readFeatureMarker, writeFeatureMarker } from "../src/feature.ts"
import { reply } from "../src/visibility.ts"

function project(): string {
  return mkdtempSync(join(tmpdir(), "flow-resume-"))
}

test("e: si hay un marcador y artefactos, la fase deducida coincide con lo escrito", () => {
  const root = project()
  writeFeatureMarker(root, "auth")
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "spec.md"), "# Spec\n\nDe verdad.\n")

  const marker = readFeatureMarker(root)
  assert.equal(marker?.slug, "auth")
  assert.equal(deducePhase(root, "auth"), 6, "con spec se retoma en la 6")
})

test("e: sin marcador no hay nada que ofrecer (undefined, no una feature inventada)", () => {
  const root = project()
  assert.equal(readFeatureMarker(root), undefined)
})

test("e: el marcador guarda createdAt para distinguir flujos y ordenarlos", () => {
  const root = project()
  const a = writeFeatureMarker(root, "uno")
  const b = writeFeatureMarker(root, "dos")
  assert.equal(a.slug, "uno")
  assert.equal(b.slug, "dos")
  assert.ok(Date.parse(a.createdAt) > 0)
  assert.ok(Date.parse(b.createdAt) >= Date.parse(a.createdAt))
})

// (d) delivery: los únicos valores que acepta `Session.Inbox.Delivery` son steer|queue.
// Verificado leyendo node_modules/@opencode/schema (SessionInbox.Delivery = Literals).
// Nuestra decisión: `steer` para una respuesta de comando interactivo.
test("d: reply envía delivery steer (despierta la sesión), no queue", async () => {
  const calls: Array<{ delivery?: string }> = []
  const session = { synthetic: async (input: { delivery?: string }) => { calls.push(input) } }
  const result = await reply(session as never, "ses_1", "hola")
  assert.equal(result.via, "synthetic")
  assert.equal(calls[0]?.delivery, "steer")
})

test("d: si el runtime rechaza steer, reply cae a prompt y no lanza", async () => {
  let prompted = 0
  const session = {
    synthetic: async () => { throw new Error("delivery no soportado") },
    prompt: async () => { prompted += 1 },
  }
  const result = await reply(session as never, "ses_1", "hola")
  assert.equal(result.via, "prompt")
  assert.equal(prompted, 1)
})
