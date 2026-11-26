import { test } from "node:test"
import assert from "node:assert/strict"
import { PROVISIONAL_SUFFIX_LENGTH, provisionalSlug, slugify } from "../src/slug.ts"

test("slugify: kebab-case desde una descripción normal", () => {
  assert.equal(slugify("Autenticación por email"), "autenticacion-por-email")
})

test("slugify: quita acentos y eñes", () => {
  assert.equal(slugify("Diseño del módulo"), "diseno-del-modulo")
})

test("slugify: colapsa separadores repetidos y recorta guiones", () => {
  assert.equal(slugify("  ---hola   mundo!!--  "), "hola-mundo")
})

test("slugify: conserva dígitos", () => {
  assert.equal(slugify("Fase 3 gate"), "fase-3-gate")
})

test("slugify: undefined si no queda nada válido", () => {
  assert.equal(slugify("***"), undefined)
  assert.equal(slugify(""), undefined)
})

test("slugify: trunca descripciones largas sin dejar guión final", () => {
  const slug = slugify("a".repeat(200))
  assert.equal(slug, "a".repeat(60))
  assert.ok(!slug.endsWith("-"))
})

test("provisionalSlug: prefijo flow- más 6 caracteres del sessionID", () => {
  const sessionID = "ses_de69a5911ffeMCQjxLLbI0u1zq"
  const slug = provisionalSlug(sessionID)
  assert.equal(slug, "flow-ses_de")
  assert.equal(slug.length, PROVISIONAL_SUFFIX_LENGTH + "flow-".length)
})

test("provisionalSlug: determinista para el mismo sessionID", () => {
  assert.equal(provisionalSlug("abc123zzz"), provisionalSlug("abc123zzz"))
})
