// Punto (e): oferta de retomar cuando hay UNA sola feature marcada.
// Punto (d): el `resume` de las respuestas, medido contra un servidor real.
// Punto 2: retomar en 7 con tickets ya en disco adopta `ticketsOpted`.

import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { deducePhase, readFeatureMarker, writeFeatureMarker } from "../src/feature.ts"
import { satisfied, verdictFor } from "../src/gate.ts"
import { buildState } from "../src/state.ts"
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

// (d) resume: medido en un servidor 2.4.2 aislado. `delivery:"steer"` arranca un turno
// (37-1359 tokens de entrada y 3-4 mensajes de asistente para help/status/off);
// `resume:false` cuesta 0 tokens y no crea mensajes. Por eso reply() usa resume:false.
test("d: reply usa resume:false — una respuesta informativa no arranca un turno", async () => {
  const calls: Array<{ resume?: boolean; delivery?: string }> = []
  const session = { synthetic: async (input: { resume?: boolean; delivery?: string }) => { calls.push(input) } }
  const result = await reply(session as never, "ses_1", "hola")
  assert.equal(result.via, "synthetic")
  assert.equal(calls[0]?.resume, false)
  assert.equal(calls[0]?.delivery, undefined, "no debe usar delivery:steer")
})

test("d: reply puede pedir resume:true si la respuesta debe iniciar trabajo", async () => {
  const calls: Array<{ resume?: boolean }> = []
  const session = { synthetic: async (input: { resume?: boolean }) => { calls.push(input) } }
  await reply(session as never, "ses_1", "hola", { resume: true })
  assert.equal(calls[0]?.resume, true)
})

test("d: si el runtime rechaza synthetic, reply cae a prompt con resume:false", async () => {
  let prompted: Array<{ resume?: boolean }> = []
  const session = {
    synthetic: async () => { throw new Error("synthetic no soportado") },
    prompt: async (input: { resume?: boolean }) => { prompted.push(input) },
  }
  const result = await reply(session as never, "ses_1", "hola")
  assert.equal(result.via, "prompt")
  assert.equal(prompted[0]?.resume, false)
})


// Punto 2: retomar en la 7 con tickets YA escritos exige tickets. Si no existen, la 7
// va por tdd y exigir spec basta: prometer tickets que no hay es inventar una fase 6.
function writeRoot(): string {
  return project()
}

test("2: fase 7 con tickets en disco -> exige tickets; sin tickets -> sólo spec", () => {
  const root = writeRoot()
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature), { recursive: true })

  // Sin tickets: gate por spec.
  assert.equal(satisfied(6, feature, root), false)
  assert.equal(verdictFor(
    { projectRoot: root, fase: 7, feature, ticketsOpted: false },
    { kind: "file", file: join(root, "src", "a.ts"), tool: "write" },
  ).allow, false)

  // Con spec: la 7 sin tickets queda abierta.
  writeFileSync(join(root, ".scratch", feature, "spec.md"), "# Spec\n\nDe verdad.\n")
  const open = verdictFor(
    { projectRoot: root, fase: 7, feature, ticketsOpted: false },
    { kind: "file", file: join(root, "src", "a.ts"), tool: "write" },
  )
  assert.equal(open.allow, true, `sin tickets debe bastar el spec: ${JSON.stringify(open)}`)

  // Con tickets en disco, la adopción los convierte en requisito: falta spec? no, está.
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "001.md"), "# Ticket\n")
  assert.equal(satisfied(6, feature, root), true, "tickets presentes -> adopción")
})

test("2: tickets vacíos no cuentan como compromiso adoptado", () => {
  const root = writeRoot()
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "README.md"), "no soy un ticket\n")
  assert.equal(satisfied(6, feature, root), false)
})

// Punto 4: una sola definición de cómo se construye el estado.
test("4: buildState omite las claves vacías y normaliza allow", () => {
  const bare = buildState({ fase: 3, active: true })
  assert.deepEqual(Object.keys(bare).sort(), ["active", "fase"])
  const full = buildState({ fase: 7, active: true, gate: "spec", feature: "auth", slugProvisional: true, ticketsOpted: true, allow: [] })
  assert.equal(full.allow, undefined, "allow vacío no se persiste como []")
  assert.equal(full.fase, 7)
  assert.equal(full.gate, "spec")
  // `false` explícito se conserva: significa "camino tdd", no "sin dato".
  assert.equal(buildState({ fase: 7, active: true, ticketsOpted: false }).ticketsOpted, false)
})

test("2: gateRequirement nombra tickets sólo cuando el compromiso se adoptó", async () => {
  const { gateRequirement } = await import("../src/gate.ts")
  const root = writeRoot()
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "spec.md"), "# Spec\n\nDe verdad.\n")

  const tdd = gateRequirement(7, feature, root, false)
  assert.match(tdd ?? "", /abierto \(spec presente\)/, "sin compromiso: sólo spec")

  const optedNoTickets = gateRequirement(7, feature, root, true)
  assert.match(optedNoTickets ?? "", /cerrado \(falta tickets\)/, "con compromiso y sin tickets: cerrado")

  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "001.md"), "# Ticket\n")
  const opted = gateRequirement(7, feature, root, true)
  assert.match(opted ?? "", /abierto \(spec presente \+ tickets\)/)
})

test("2: adoptsTickets no inventa compromiso al retomar sin tickets, y lo adopta si están", async () => {
  const { adoptsTickets } = await import("../src/gate.ts")
  const root = writeRoot()
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "spec.md"), "# Spec\n\nDe verdad.\n")
  assert.equal(adoptsTickets({ feature }, root), false)
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "001.md"), "# Ticket\n")
  assert.equal(adoptsTickets({ feature }, root), true)
  assert.equal(adoptsTickets({ feature, ticketsOpted: false }, root), true, "lo escrito manda sobre el false")
  assert.equal(adoptsTickets({ feature: "otra", ticketsOpted: false }, root), false, "false se respeta sin tickets")
})

test("2: nextTicketsOpted respeta el tri-estado y los tickets en disco", async () => {
  const { nextTicketsOpted } = await import("../src/gate.ts")
  const root = writeRoot()
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature), { recursive: true })

  // Desde la 5 sin opinión: no se promete nada (la 6 aún no se recorrió).
  assert.equal(nextTicketsOpted({ fase: 5, feature }, root), undefined)
  // Desde la 6 recorrida: compromiso.
  assert.equal(nextTicketsOpted({ fase: 6, feature }, root), true)
  // Retomado por tdd (`false`): se conserva aunque se esté en la 6.
  assert.equal(nextTicketsOpted({ fase: 6, feature, ticketsOpted: false }, root), false)
  // Pero si hay tickets en disco, lo escrito manda sobre el `false`.
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "001.md"), "# Ticket\n")
  assert.equal(nextTicketsOpted({ fase: 6, feature, ticketsOpted: false }, root), true)
})

test("2: resumeTicketsOpted fija tdd sólo al deducir 6+ sin tickets", async () => {
  const { resumeTicketsOpted } = await import("../src/gate.ts")
  const root = writeRoot()
  assert.equal(resumeTicketsOpted({ fase: 1, feature: "auth" }, root, false), undefined)
  assert.equal(resumeTicketsOpted({ fase: 6, feature: "auth" }, root, false), false)
  assert.equal(resumeTicketsOpted({ fase: 7, feature: "auth" }, root, false), false)
  // Con estado previo se hereda, no se inventa un `false`.
  assert.equal(resumeTicketsOpted({ fase: 7, feature: "auth" }, root, true), undefined)
})
