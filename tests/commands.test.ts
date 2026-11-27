import { test } from "node:test"
import assert from "node:assert/strict"
import { parseCommand } from "../src/phases.ts"
import { isValidSlug, slugify, provisionalSlug } from "../src/slug.ts"

test("C1: /flow sin argumentos arranca en fase 1 sin feature (index usa provisional)", () => {
  const parsed = parseCommand("")
  assert.equal(parsed.kind, "start")
  assert.equal(parsed.kind === "start" && parsed.fase, 1)
  assert.equal(parsed.kind === "start" && parsed.feature, undefined)
})

test("C1: /flow <descripción> deriva el slug del texto", () => {
  const parsed = parseCommand("Auth con tokens de sesión")
  assert.equal(parsed.kind, "start")
  assert.equal(parsed.kind === "start" && parsed.feature, "auth-con-tokens-de-sesion")
})

test("C1: /flow <descripción sin caracteres válidos> degrada a help con motivo", () => {
  const parsed = parseCommand("🎉🚀")
  assert.equal(parsed.kind, "help")
  assert.ok(parsed.kind === "help" && parsed.reason)
})

test("C1: slugify prefija nombres reservados de Windows", () => {
  assert.equal(slugify("con"), "x-con")
  assert.equal(isValidSlug("x-con"), true)
})

test("C1: provisionalSlug usa la cola del sessionID", () => {
  assert.equal(provisionalSlug("ses_abc123def456"), "flow-def456")
})

test("C2: /flow next", () => {
  assert.equal(parseCommand("next").kind, "next")
})

test("C2: /flow back por defecto retrocede 1; /flow back 3 retrocede 3", () => {
  const one = parseCommand("back")
  const three = parseCommand("back 3")
  assert.equal(one.kind, "back")
  assert.equal(one.kind === "back" && one.steps, 1)
  assert.equal(three.kind, "back")
  assert.equal(three.kind === "back" && three.steps, 3)
})

test("C2: /flow back 0 o no numérico degrada a help", () => {
  assert.equal(parseCommand("back 0").kind, "help")
  assert.equal(parseCommand("back abc").kind, "help")
})

test("C2: /flow rename exige slug válido", () => {
  assert.equal(parseCommand("rename auth-core").kind, "rename")
  assert.equal(parseCommand("rename").kind, "help")
  assert.equal(parseCommand("rename ../x").kind, "help")
})

test("C2: /flow resume sin slug y con slug", () => {
  const bare = parseCommand("resume")
  const named = parseCommand("resume auth-core")
  assert.equal(bare.kind, "resume")
  assert.equal(bare.kind === "resume" && bare.feature, undefined)
  assert.equal(named.kind, "resume")
  assert.equal(named.kind === "resume" && named.feature, "auth-core")
})
