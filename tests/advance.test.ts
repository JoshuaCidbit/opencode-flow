import { test } from "node:test"
import assert from "node:assert/strict"
import { advance, commitAdvance, type FlowState, type StorageLike } from "../src/state.ts"

function storage(initial: Record<string, unknown> = {}): StorageLike & { data: Map<string, unknown>; calls: string[] } {
  const data = new Map(Object.entries(initial))
  const calls: string[] = []
  return {
    data,
    calls,
    async get(key: string) {
      calls.push(`get:${key}`)
      return data.get(key)
    },
    async set(key: string, value: unknown) {
      calls.push(`set:${key}`)
      data.set(key, value)
    },
  }
}

const state = (over: Partial<FlowState> = {}): FlowState => ({ fase: 4, active: true, feature: "auth", ...over })

// A5: advance es PURO y monotónico.
test("A5: advance sube la fase si el artefacto está en disco", () => {
  const next = advance(state({ fase: 4 }), () => true, 10)
  assert.equal(next?.fase, 5)
})

test("A5: advance no escribe: es puro", () => {
  const before = state({ fase: 4 })
  const next = advance(before, () => true, 10)
  assert.equal(before.fase, 4, "el estado original no se muta")
  assert.notEqual(next, before)
})

test("A5: advance es idempotente: sin artefacto no avanza", () => {
  const s = state({ fase: 4 })
  assert.equal(advance(s, () => false, 10), undefined)
})

test("A5: advance es MONOTÓNICO: nunca reduce la fase", () => {
  const next = advance(state({ fase: 9 }), () => true, 10)
  assert.ok(next === undefined || next.fase >= 9)
  const atTop = advance(state({ fase: 10 }), () => true, 10)
  assert.equal(atTop, undefined, "en la última fase no avanza")
})

test("A5: advance respeta inactivo (active:false no avanza)", () => {
  assert.equal(advance(state({ active: false }), () => true, 10), undefined)
})

test("A5: advance sin feature no avanza", () => {
  assert.equal(advance({ fase: 4, active: true }, () => true, 10), undefined)
})

// A5: commitAdvance escribe sólo si hubo cambio.
test("A5: commitAdvance escribe sólo si hubo cambio y reporta wrote", async () => {
  const store = storage()
  const result = await commitAdvance(store, "owner", state({ fase: 4 }), state({ fase: 5 }))
  assert.equal(result.wrote, true)
  assert.equal(result.state.fase, 5)
  assert.deepEqual(store.calls, ["set:flow:owner"])
})

test("A5: commitAdvance sin cambio no escribe", async () => {
  const store = storage()
  const result = await commitAdvance(store, "owner", state({ fase: 4 }), undefined)
  assert.equal(result.wrote, false)
  assert.equal(result.state.fase, 4)
  assert.deepEqual(store.calls, [], "no debe tocar storage sin cambio")
})

test("A5: commitAdvance escribe en el DUEÑO, no en el hijo", async () => {
  const store = storage()
  await commitAdvance(store, "owner", state(), state({ fase: 5 }))
  assert.ok(store.calls.includes("set:flow:owner"))
})

// Regla 4: falla abierta.
test("regla 4: error de storage al persistir no lanza y no bloquea", async () => {
  const broken: StorageLike = {
    async get() {
      return undefined
    },
    async set() {
      throw new Error("disco lleno")
    },
  }
  const result = await commitAdvance(broken, "owner", state({ fase: 4 }), state({ fase: 5 }))
  assert.equal(result.state.fase, 5, "sigue con el estado avanzado aunque no persista")
  assert.equal(result.wrote, false)
})

test("regla 4: commitAdvance nunca lanza", async () => {
  const broken: StorageLike = {
    async get() {
      throw new Error("x")
    },
    async set() {
      throw new Error("y")
    },
  }
  await assert.doesNotReject(() => commitAdvance(broken, "o", state(), state({ fase: 5 })))
})

// Punto 2: el auto-avance que entra en la 7 con tickets adopta el compromiso,
// igual que `/flow next` desde la 6. Si no, el gate no sabría que hay tickets.
test("2: auto-avance a la 7 adopta ticketsOpted cuando la 6 está satisfecha", () => {
  const next = advance(state({ fase: 6 }), (fase) => fase === 6, 10)
  assert.equal(next?.fase, 7)
  assert.equal(next?.ticketsOpted, true)
})

test("2: si el artefacto que avanzó no es la 6, no inventa compromiso", () => {
  const next = advance(state({ fase: 4 }), (fase) => fase === 4, 10)
  assert.equal(next?.fase, 5)
  assert.equal(next?.ticketsOpted, undefined)
})
