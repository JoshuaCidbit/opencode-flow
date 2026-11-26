import { test } from "node:test"
import assert from "node:assert/strict"
import { PROVISIONAL_SUFFIX_LENGTH, provisionalSlug, slugify } from "../src/slug.ts"

// ID con el formato real observado en 2.4.2.
const REAL_SESSION_ID = "ses_de5eb36c3ffeVWceT42N0nD2FG"

test("provisionalSlug: toma la COLA del ID, no la cabeza", () => {
  const slug = provisionalSlug(REAL_SESSION_ID)
  // "ses_" fuera -> "de5eb36c3ffeVWceT42N0nD2FG" -> alnum en minúsculas -> cola: "0nd2fg"
  assert.equal(slug, "flow-0nd2fg")
})

test("provisionalSlug: dos sesiones reales producen slugs distintos", () => {
  const a = provisionalSlug("ses_de5eb36c3ffeVWceT42N0nD2FG")
  const b = provisionalSlug("ses_de69a5911ffeMCQjxLLbI0u1zq")
  assert.equal(a, "flow-0nd2fg")
  assert.equal(b, "flow-i0u1zq")
  assert.notEqual(a, b)
  // Si se hubiera usado la cabeza, ambas darían "flow-ses_de": colisión total.
  const head = (id: string) => "flow-" + id.slice(0, 6).replace("_", "-")
  assert.equal(head("ses_de5eb36c3ffeVWceT42N0nD2FG"), head("ses_de69a5911ffeMCQjxLLbI0u1zq"))
})

test("provisionalSlug: longitud del sufijo respetada y determinista", () => {
  const slug = provisionalSlug(REAL_SESSION_ID)
  assert.equal(slug.length, PROVISIONAL_SUFFIX_LENGTH + "flow-".length)
  assert.equal(slug, provisionalSlug(REAL_SESSION_ID))
})

test("provisionalSlug: tolera un ID sin prefijo ses_ y uno vacío", () => {
  // Sin prefijo: "abc123zzz9" -> alnum -> últimos 6 -> "23zzz9"
  assert.equal(provisionalSlug("abc123zzz9"), "flow-23zzz9")
  // Sin caracteres válidos: cae a "local" en vez de devolver "flow-"
  assert.equal(provisionalSlug(""), "flow-local")
  assert.equal(provisionalSlug("ses_"), "flow-local")
})

test("slugify: entrada que se vacía tras normalizar devuelve undefined", () => {
  assert.equal(slugify("***"), undefined)
  assert.equal(slugify(""), undefined)
  assert.equal(slugify("🎉🚀"), undefined) // emojis
  assert.equal(slugify("日本語"), undefined) // alfabeto no latino
  assert.equal(slugify("!!! ??? ---"), undefined)
})

test("slugify: nunca devuelve cadena vacía", () => {
  for (const input of ["", "***", "🎉", "日本語", "   "]) {
    const slug = slugify(input)
    assert.ok(slug === undefined || slug.length > 0, `esperado undefined o no vacío para ${JSON.stringify(input)}`)
  }
})

test("slugify: nombres reservados de Windows se prefijan", () => {
  assert.equal(slugify("con"), "x-con")
  assert.equal(slugify("NUL"), "x-nul")
  assert.equal(slugify("prn"), "x-prn")
  assert.equal(slugify("aux"), "x-aux")
  assert.equal(slugify("COM1"), "x-com1")
  assert.equal(slugify("lpt9"), "x-lpt9")
})

test("slugify: idempotente", () => {
  const once = slugify("Autenticación por email")
  assert.equal(once, "autenticacion-por-email")
  assert.equal(slugify(once!), once)
})

test("slugify: trunca a 60 sin dejar guión final", () => {
  const slug = slugify("a".repeat(200))
  assert.equal(slug, "a".repeat(60))
  assert.equal(slug!.length, 60)
  assert.ok(!slug!.endsWith("-"))

  const withDash = slugify(`${"b".repeat(59)} z`)
  assert.ok(withDash!.length <= 60)
  assert.ok(!withDash!.endsWith("-"))
})

test("slugify: kebab-case básico, acentos y dígitos", () => {
  assert.equal(slugify("Diseño del módulo"), "diseno-del-modulo")
  assert.equal(slugify("Fase 3 gate"), "fase-3-gate")
  assert.equal(slugify("  ---hola   mundo!!--  "), "hola-mundo")
})
