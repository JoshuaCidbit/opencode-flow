import { test } from "node:test"
import assert from "node:assert/strict"
import { noticeAdvance } from "../src/state.ts"
import type { FlowState } from "../src/state.ts"

const base: FlowState = { fase: 5, feature: "auth", gate: "spec", active: true }

// Punto (g): el auto-avance debe anunciarse. No es un acto pedido por el usuario.
test("g: noticeAdvance avisa cuando la fase sube", () => {
  const notice = noticeAdvance(base, { ...base, fase: 6, gate: "tickets" })
  assert.ok(notice)
  assert.match(notice, /auto-avance/)
  assert.match(notice, /fase 5 → 6/)
})

test("g: noticeAdvance menciona /flow back para deshacer", () => {
  const notice = noticeAdvance(base, { ...base, fase: 6 })
  assert.match(notice ?? "", /\/flow back/)
})

test("g: noticeAdvance calla si no hubo avance", () => {
  assert.equal(noticeAdvance(base, base), undefined)
  assert.equal(noticeAdvance(base, { ...base, fase: 4 }), undefined, "retroceso no es auto-avance")
})
