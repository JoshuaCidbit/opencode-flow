import { test } from "node:test"
import assert from "node:assert/strict"
import { parseCommand, help } from "../src/phases.ts"
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

// --- P3: subcomandos mal escritos ---------------------------------------------------------
// Con el flow activo, un texto no reconocido es casi siempre un subcomando mal tecleado
// (`stauts` por `status`). Antes caía en la rama de "descripción" y, si el texto daba slug,
// ARRANCABA OTRA FEATURE encima de la que estaba en curso. P3 lo corta: ayuda y nada más.

test("P3: con flow activo, un subcomando mal escrito da ayuda (no arranca otra feature)", () => {
  for (const typo of ["stauts", "nxt", "of", "statuss", "hepl", "bakc", "startt", "gatee"]) {
    const parsed = parseCommand(typo, { active: true })
    assert.equal(parsed.kind, "help", `"${typo}" no dio ayuda`)
    assert.ok(parsed.reason, `"${typo}" sin motivo`)
  }
})

test("P3: la sugerencia sale por distancia de edición <= 2", () => {
  assert.equal(parseCommand("stauts", { active: true }).suggestion, "status")
  assert.equal(parseCommand("nxt", { active: true }).suggestion, "next")
  assert.equal(parseCommand("of", { active: true }).suggestion, "off")
  assert.equal(parseCommand("hepl", { active: true }).suggestion, "help")
  assert.equal(parseCommand("bakc", { active: true }).suggestion, "back")
})

test("P3: normaliza mayúsculas y acentos antes de comparar", () => {
  // `foldCommand` quita acentos, guiones y mayúsculas, así que estas cinco escriben `status`
  // y se reconocen como tal en vez de caer en ayuda.
  for (const spelling of ["status", "STATUS", "StAtUs", "státus", "STÁTUS"]) {
    assert.equal(parseCommand(spelling, { active: true }).kind, "status", `"${spelling}" no se reconoció`)
  }
  // Lo mismo para el resto de subcomandos, que no admiten acentos escritos "a mano".
  assert.equal(parseCommand("NEXT", { active: true }).kind, "next")
  assert.equal(parseCommand("Néxt", { active: true }).kind, "next")
  assert.equal(parseCommand("Óff", { active: false }).kind, "off")
  assert.equal(parseCommand("ÓFF", { active: false }).kind, "off")
  assert.equal(parseCommand("BACK 3", { active: true }).steps, 3)
  // Y el parecido también se mide ya normalizado.
  assert.equal(parseCommand("STÁTUSX", { active: true }).suggestion, "status")
})

test("P3: sin nada parecido no se sugiere (la ayuda no es ruido)", () => {
  const parsed = parseCommand("zzzzzzzz", { active: true })
  assert.equal(parsed.kind, "help")
  assert.equal(parsed.suggestion, undefined, "no debe sugerir cualquier cosa")
})

test("P3: con flow INACTIVO, una sola palabra desconocida da ayuda", () => {
  const parsed = parseCommand("stauts")
  assert.equal(parsed.kind, "help", "una palabra suelta no es descripción")
})

test("P3: con flow INACTIVO, una descripción de 2+ palabras sigue arrancando", () => {
  const parsed = parseCommand("auth con tokens")
  assert.equal(parsed.kind, "start", "una descripción libre sigue siendo un arranque")
  assert.equal(parsed.feature, "auth-con-tokens")
})

test("P3: la ayuda con flow activo dice cómo empezar otra feature", () => {
  const text = help({ active: true })
  assert.match(text, /\/flow start <descripción>/, "falta la salida para otra feature")
  const inactive = help()
  assert.ok(!inactive.includes("/flow start <descripción>"), "inactivo no necesita el aviso")
})

// Estos se ROMPEN si P3 clasifica mal: son los comandos válidos con argumentos.
test("P3: no se rompen back 3, gate tickets, resume, rename ni start con slug", () => {
  const back3 = parseCommand("back 3", { active: true })
  assert.equal(back3.kind, "back")
  assert.equal(back3.steps, 3)

  const gate = parseCommand("gate tickets", { active: true })
  assert.equal(gate.kind, "gate")
  assert.equal(gate.gate, "tickets")

  const resume = parseCommand("resume auth-core", { active: true })
  assert.equal(resume.kind, "resume")
  assert.equal(resume.feature, "auth-core")

  const rename = parseCommand("rename auth-core", { active: true })
  assert.equal(rename.kind, "rename")
  assert.equal(rename.feature, "auth-core")

  const start = parseCommand("start 5 slug-valido", { active: true })
  assert.equal(start.kind, "start")
  assert.equal(start.fase, 5)
  assert.equal(start.feature, "slug-valido")

  // `miSlug` (con mayúsculas) NO es un slug válido: el slug va en minúsculas. Lo que no puede
  // romperse es el PARSEADO (se reconoce `start N`), no la validación del slug.
  const badSlug = parseCommand("start 5 miSlug", { active: true })
  assert.equal(badSlug.kind, "help", "un slug con mayúsculas no se acepta")
  assert.match(badSlug.reason ?? "", /slug "miSlug" inválido/, "y el motivo dice qué pasó")
})
