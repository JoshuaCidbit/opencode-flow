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
    assert.ok(parsed.kind === "help" && parsed.reason, `"${typo}" sin motivo`)
  }
})

test("P3: la sugerencia sale por distancia de edición <= 2", () => {
  const s1 = parseCommand("stauts", { active: true })
  assert.equal(s1.kind === "help" && s1.suggestion, "status")
  const s2 = parseCommand("nxt", { active: true })
  assert.equal(s2.kind === "help" && s2.suggestion, "next")
  const s3 = parseCommand("of", { active: true })
  assert.equal(s3.kind === "help" && s3.suggestion, "off")
  const s4 = parseCommand("hepl", { active: true })
  assert.equal(s4.kind === "help" && s4.suggestion, "help")
  const s5 = parseCommand("bakc", { active: true })
  assert.equal(s5.kind === "help" && s5.suggestion, "back")
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
  const back3 = parseCommand("BACK 3", { active: true })
  assert.equal(back3.kind === "back" && back3.steps, 3)
  // Y el parecido también se mide ya normalizado.
  const sug = parseCommand("STÁTUSX", { active: true })
  assert.equal(sug.kind === "help" && sug.suggestion, "status")
})

test("P3: sin nada parecido no se sugiere (la ayuda no es ruido)", () => {
  const parsed = parseCommand("zzzzzzzz", { active: true })
  assert.equal(parsed.kind, "help")
  assert.equal(parsed.kind === "help" && parsed.suggestion, undefined, "no debe sugerir cualquier cosa")
})

test("P3: con flow INACTIVO, una sola palabra desconocida da ayuda", () => {
  const parsed = parseCommand("stauts")
  assert.equal(parsed.kind, "help", "una palabra suelta no es descripción")
})

test("P3: con flow INACTIVO, una descripción de 2+ palabras sigue arrancando", () => {
  const parsed = parseCommand("auth con tokens")
  assert.equal(parsed.kind, "start", "una descripción libre sigue siendo un arranque")
  assert.equal(parsed.kind === "start" && parsed.feature, "auth-con-tokens")
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
  assert.equal(back3.kind === "back" && back3.steps, 3)

  const gate = parseCommand("gate tickets", { active: true })
  assert.equal(gate.kind, "gate")
  assert.equal(gate.kind === "gate" && gate.gate, "tickets")

  const resume = parseCommand("resume auth-core", { active: true })
  assert.equal(resume.kind, "resume")
  assert.equal(resume.kind === "resume" && resume.feature, "auth-core")

  const rename = parseCommand("rename auth-core", { active: true })
  assert.equal(rename.kind, "rename")
  assert.equal(rename.kind === "rename" && rename.feature, "auth-core")

  const start = parseCommand("start 5 slug-valido", { active: true })
  assert.equal(start.kind, "start")
  assert.equal(start.kind === "start" && start.fase, 5)
  assert.equal(start.kind === "start" && start.feature, "slug-valido")

  // `miSlug` (con mayúsculas) NO es un slug válido: el slug va en minúsculas. Lo que no puede
  // romperse es el PARSEADO (se reconoce `start N`), no la validación del slug.
  const badSlug = parseCommand("start 5 miSlug", { active: true })
  assert.equal(badSlug.kind, "help", "un slug con mayúsculas no se acepta")
  assert.match((badSlug.kind === "help" && badSlug.reason) || "", /slug "miSlug" inválido/, "y el motivo dice qué pasó")
})

// --- P4: el tema inicial del usuario ------------------------------------------------------
// El slug nombra archivos, pero NO conserva el tema: se recorta y pierde acentos. Un flow bien
// sluggeado puede ser ilegible ("autenticacion-con-tokens-de-sesion-y-rotacion"). El texto
// original viaja aparte para que quien retoma lea qué se pidió.

test("P4: /flow <descripción> guarda el tema original recortado a 500", () => {
  const short = parseCommand("auth con tokens")
  assert.equal(short.kind, "start")
  assert.equal(short.kind === "start" && short.topic, "auth con tokens", "el tema es el texto tal cual")

  const long = parseCommand("x ".repeat(400))
  assert.equal(long.kind, "start")
  const longTopic = long.kind === "start" ? long.topic : undefined
  assert.equal(longTopic?.length, 501, "500 de texto + la elipsis")
  assert.ok(longTopic?.endsWith("…"), "el recorte se marca con elipsis")
  assert.ok(longTopic?.startsWith("x x x"), "se conserva el principio, no el final")
})

test("P4: el tema conserva acentos y mayúsculas (el slug no)", () => {
  const topic = "Autenticación con tokens de sesión y rotación automática"
  const parsed = parseCommand(topic)
  assert.equal(parsed.kind, "start")
  assert.equal(parsed.kind === "start" && parsed.topic, topic, "el tema va tal cual, con acentos")
  const feature = parsed.kind === "start" ? parsed.feature : undefined
  assert.equal(feature, "autenticacion-con-tokens-de-sesion-y-rotacion-automatica")
  assert.ok(feature && !/[áéíóú]/.test(feature), "el slug sigue sin acentos")
})
