import { test } from "node:test"
import assert from "node:assert/strict"
import { isState, resolveState, stateKey, type FlowState, type StorageLike } from "../src/state.ts"

function storage(initial: Record<string, unknown> = {}): StorageLike & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    async get(key: string) {
      return data.get(key)
    },
    async set(key: string, value: unknown) {
      data.set(key, value)
    },
  }
}

const state = (over: Partial<FlowState> = {}): FlowState => ({ fase: 3, active: true, ...over })

test("isState: reconoce estado válido y rechaza basura", () => {
  assert.ok(isState({ fase: 1, active: true }))
  assert.ok(!isState({ fase: 1 }))
  assert.ok(!isState({ active: true }))
  assert.ok(!isState(null))
  assert.ok(!isState("x"))
  // Puerta 7: el compromiso es booleano; `false` explícito es válido (camino tdd).
  assert.ok(isState({ fase: 7, active: true, ticketsOpted: false }))
  assert.ok(!isState({ fase: 7, active: true, ticketsOpted: "si" }))
  assert.ok(!isState({ fase: 7, active: true, slugProvisional: "si" }))
})

test("stateKey: prefijo por sesión", () => {
  assert.equal(stateKey("abc"), "flow:abc")
})

test("A3: estado en la propia sesión -> owner es esa sesión", async () => {
  const store = storage({ [stateKey("root")]: state({ fase: 5 }) })
  const resolved = await resolveState(store, async () => undefined, "root")
  assert.equal(resolved?.ownerID, "root")
  assert.equal(resolved?.state.fase, 5)
})

test("A3: el hijo hereda el estado del padre y el owner es el PADRE", async () => {
  const store = storage({ [stateKey("root")]: state({ fase: 6 }) })
  const parents: Record<string, string | null> = { child: "root", root: null }
  const resolved = await resolveState(store, async (id) => ({ parentID: parents[id] ?? null }), "child")
  assert.equal(resolved?.ownerID, "root", "la escritura debe ir al padre")
  assert.equal(resolved?.state.fase, 6)
})

test("A3: nieto sube dos niveles hasta el dueño", async () => {
  const store = storage({ [stateKey("root")]: state({ fase: 7 }) })
  const parents: Record<string, string | null> = { grandchild: "child", child: "root", root: null }
  const resolved = await resolveState(store, async (id) => ({ parentID: parents[id] ?? null }), "grandchild")
  assert.equal(resolved?.ownerID, "root")
})

test("A3: el estado del propio hijo gana al del padre (el hijo puede estar más avanzado)", async () => {
  const store = storage({
    [stateKey("root")]: state({ fase: 2 }),
    [stateKey("child")]: state({ fase: 8 }),
  })
  const parents: Record<string, string | null> = { child: "root" }
  const resolved = await resolveState(store, async (id) => ({ parentID: parents[id] ?? null }), "child")
  assert.equal(resolved?.ownerID, "child")
  assert.equal(resolved?.state.fase, 8)
})

test("A3: sin estado en ningún ancestro -> undefined", async () => {
  const store = storage()
  const parents: Record<string, string | null> = { child: "root", root: null }
  const resolved = await resolveState(store, async (id) => ({ parentID: parents[id] ?? null }), "child")
  assert.equal(resolved, undefined)
})

test("A3: 'off' en el padre (active:false) se hereda; el hijo no lo resucita", async () => {
  const store = storage({ [stateKey("root")]: state({ fase: 4, active: false }) })
  const parents: Record<string, string | null> = { child: "root" }
  const resolved = await resolveState(store, async (id) => ({ parentID: parents[id] ?? null }), "child")
  assert.equal(resolved?.ownerID, "root")
  assert.equal(resolved?.state.active, false)
})

test("A3: cadena circular no bloquea", async () => {
  const parents: Record<string, string | null> = { a: "b", b: "a" }
  const resolved = await resolveState(storage(), async (id) => ({ parentID: parents[id] ?? null }), "a")
  assert.equal(resolved, undefined)
})

test("A3: rotura de storage.get devuelve undefined sin lanzar", async () => {
  const broken: StorageLike = {
    async get() {
      throw new Error("boom")
    },
    async set() {},
  }
  const resolved = await resolveState(broken, async () => undefined, "x")
  assert.equal(resolved, undefined)
})

test("A3: rotura de getSession devuelve undefined sin lanzar", async () => {
  const resolved = await resolveState(
    storage(),
    async () => {
      throw new Error("boom")
    },
    "x",
  )
  assert.equal(resolved, undefined)
})
