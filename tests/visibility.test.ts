import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { STATE_ENTRY_KEY, reply, stateSummary, syncStateEntry, type VisibilitySession } from "../src/visibility.ts"
import type { FlowState } from "../src/state.ts"

const S = "ses_1"

type Capture = { entries: Map<string, unknown>; synthetics: unknown[]; prompts: unknown[] }

function session(over: Partial<VisibilitySession> = {}, capture?: Capture): VisibilitySession {
  return {
    instructions: {
      entry: {
        put: async (input) => {
          capture?.entries.set(input.key, input.value)
          return undefined
        },
        remove: async (input) => {
          capture?.entries.delete(input.key)
          return undefined
        },
      },
    },
    synthetic: async (input) => {
      capture?.synthetics.push(input)
      return undefined
    },
    prompt: async (input) => {
      capture?.prompts.push(input)
      return undefined
    },
    ...over,
  }
}

// (a) synthetic + caída a prompt -------------------------------------------------

test("(a) reply usa synthetic con resume:false cuando existe", async () => {
  const capture: Capture = { entries: new Map(), synthetics: [], prompts: [] }
  const result = await reply(session({}, capture), S, "hola")
  assert.equal(result.via, "synthetic")
  assert.equal(capture.synthetics.length, 1)
  assert.equal((capture.synthetics[0] as { resume: boolean }).resume, false)
  assert.equal(capture.prompts.length, 0)
})

test("(a) reply cae a prompt con resume:false si synthetic falta", async () => {
  const capture: Capture = { entries: new Map(), synthetics: [], prompts: [] }
  const result = await reply(session({ synthetic: undefined }, capture), S, "hola")
  assert.equal(result.via, "prompt")
  assert.equal(capture.prompts.length, 1)
  assert.equal((capture.prompts[0] as { resume: boolean }).resume, false)
})

test("(a) reply cae a prompt si synthetic lanza", async () => {
  const capture: Capture = { entries: new Map(), synthetics: [], prompts: [] }
  const result = await reply(
    session({ synthetic: async () => { throw new Error("boom") } }, capture),
    S,
    "hola",
  )
  assert.equal(result.via, "prompt")
  assert.equal(capture.prompts.length, 1)
})

test("(a) reply devuelve none si no hay nada y nunca lanza", async () => {
  const result = await reply(undefined, S, "hola")
  assert.equal(result.via, "none")
  const empty = await reply({} as VisibilitySession, S, "hola")
  assert.equal(empty.via, "none")
})

// (b) instructions entry ----------------------------------------------------------

test("(b) syncStateEntry publica la key estable con el estado", async () => {
  const capture: Capture = { entries: new Map(), synthetics: [], prompts: [] }
  const state: FlowState = { fase: 5, feature: "auth", gate: "spec", active: true }
  const ok = await syncStateEntry(session({}, capture), S, state)
  assert.equal(ok, true)
  assert.ok(capture.entries.has(STATE_ENTRY_KEY))
  const value = capture.entries.get(STATE_ENTRY_KEY) as { fase: number; text: string }
  assert.equal(value.fase, 5)
  assert.match(value.text, /^\[flow\] fase 5/)
})

test("(b) /flow off elimina el entry (state undefined)", async () => {
  const capture: Capture = { entries: new Map(), synthetics: [], prompts: [] }
  await syncStateEntry(session({}, capture), S, { fase: 5, active: true })
  assert.ok(capture.entries.has(STATE_ENTRY_KEY))
  await syncStateEntry(session({}, capture), S, undefined)
  assert.equal(capture.entries.has(STATE_ENTRY_KEY), false)
})

test("(b) syncStateEntry devuelve false y no lanza si la API no existe", async () => {
  assert.equal(await syncStateEntry({} as VisibilitySession, S, { fase: 1, active: true }), false)
  assert.equal(await syncStateEntry(undefined, S, { fase: 1, active: true }), false)
})

test("(b) stateSummary es corto, estable y reflecta activo/feature/gate", () => {
  assert.equal(stateSummary({ fase: 1, active: true }), "[flow] fase 1 · activo")
  assert.equal(
    stateSummary({ fase: 6, active: true, feature: "auth", gate: "tickets" }),
    "[flow] fase 6 · activo · feature auth · gate tickets",
  )
  assert.equal(stateSummary({ fase: 3, active: false }), "[flow] fase 3 · inactivo")
})

// (e) .flow-feature ----------------------------------------------------------------

test("(e) .flow-feature guarda slug y createdAt y se lee de vuelta", async () => {
  const { readFeatureMarker, writeFeatureMarker } = await import("../src/feature.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-marker-"))
  assert.equal(readFeatureMarker(root), undefined)
  const marker = writeFeatureMarker(root, "auth-core")
  assert.equal(marker.slug, "auth-core")
  assert.ok(Date.parse(marker.createdAt) > 0)
  assert.deepEqual(readFeatureMarker(root)?.slug, "auth-core")
})

test("(e) .flow-feature corrupto no lanza: devuelve undefined", async () => {
  const { readFeatureMarker } = await import("../src/feature.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-marker-"))
  writeFileSync(join(root, ".flow-feature"), "no es json {{{")
  assert.equal(readFeatureMarker(root), undefined)
})

// (e) deducción de fase por artefactos ----------------------------------------------

test("(e) deduce la fase por artefactos presentes en disco", async () => {
  const { deducePhase } = await import("../src/feature.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-deduce-"))
  const feature = "auth"
  const spec = join(root, ".scratch", feature, "spec.md")
  // Sin artefactos: fase 1.
  assert.equal(deducePhase(root, feature), 1)

  // Con spec: la fase 5 está ganada, así que se retoma en la 6.
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  writeFileSync(spec, "# spec\n\nContenido real.\n")
  assert.equal(deducePhase(root, feature), 6)

  // Con tickets además: la 6 también está ganada, se retoma en la 7.
  mkdirSync(join(root, ".scratch", feature, "issues"), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "issues", "001.md"), "# Ticket\n")
  assert.equal(deducePhase(root, feature), 7)
})

test("(e) spec vacío NO deduce ninguna fase ganada", async () => {
  const { deducePhase } = await import("../src/feature.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-deduce-"))
  const feature = "auth"
  mkdirSync(join(root, ".scratch", feature), { recursive: true })
  writeFileSync(join(root, ".scratch", feature, "spec.md"), "   \n")
  assert.equal(deducePhase(root, feature), 1)
})

// Punto 2: la fase 7 no debe exigir tickets si no se pasó por la 6.
test("(2) fase 7 escribe código con spec y SIN tickets (camino tdd)", async () => {
  const { verdictFor } = await import("../src/gate.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-tdd-"))
  mkdirSync(join(root, ".scratch", "auth"), { recursive: true })
  writeFileSync(join(root, ".scratch", "auth", "spec.md"), "# spec\n\nReal.\n")
  const options = { projectRoot: root, fase: 7, feature: "auth" }
  const verdict = verdictFor(options, { kind: "file", file: join(root, "src", "app.ts"), tool: "write" })
  assert.equal(verdict.allow, true, verdict.reason)
})

test("(2) fase 7 SIN spec sigue bloqueando código", async () => {
  const { verdictFor } = await import("../src/gate.ts")
  const root = mkdtempSync(join(tmpdir(), "flow-nospec-"))
  const options = { projectRoot: root, fase: 7, feature: "auth" }
  const verdict = verdictFor(options, { kind: "file", file: join(root, "src", "app.ts"), tool: "write" })
  assert.equal(verdict.allow, false)
})

// Punto 5: /flow off debe indicar el comando REAL de reactivación, y coincidir con lo que
// hace el handler (off conserva fase/feature; resume las retoma).
test("5: offMessage nombra /flow resume, nunca /flow start", async () => {
  const { offMessage } = await import("../src/visibility.ts")
  const notice = offMessage({ fase: 5, feature: "auth", gate: "spec", active: true })
  assert.match(notice, /\/flow resume auth/)
  assert.doesNotMatch(notice, /\/flow start/)
  assert.match(notice, /desactivado/)
})

test("5: offMessage sin feature sugiere /flow resume a secas", async () => {
  const { offMessage } = await import("../src/visibility.ts")
  const notice = offMessage({ fase: 3, active: true, slugProvisional: true })
  assert.match(notice, /Reactiva con \/flow resume\./)
})

test("5: offMessage no lanza sin estado previo", async () => {
  const { offMessage } = await import("../src/visibility.ts")
  assert.match(offMessage(undefined), /\/flow resume/)
})
