// A9: empaquetado de skills. three exigencias verificables:
//   - `existing` se actualiza EN EL BUCLE (dos empaquetados con el mismo id no duplican);
//   - se registran los ids CEDIDOS, para que un bundle "que no instala" tenga explicación;
//   - el frontmatter admite descripciones multilínea.

import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { addMissingSkills } from "../src/index.ts"

type Bundled = { id: string; name: string; description?: string; path: string; content: string }

function bundled(id: string, name = id): Bundled {
  return { id, name, path: `/x/${id}/SKILL.md`, content: "x" }
}

function editor(existingIds: string[]): { list: () => readonly { id: string }[]; add: (s: unknown) => void; seen: string[] } {
  const seen: string[] = []
  return {
    list: () => existingIds.map((id) => ({ id })),
    add: (skill) => seen.push(String((skill as { id: string }).id)),
    seen,
  }
}

test("A9: cede ante skills del usuario y lo registra", () => {
  const edit = editor(["to-spec"])
  const result = addMissingSkills(edit, [bundled("to-spec"), bundled("tdd")])
  assert.deepEqual(result.added, ["tdd"])
  assert.deepEqual(result.ceded, ["to-spec"], "el id cedido debe ser visible")
  assert.deepEqual(edit.seen, ["tdd"], "la copia del usuario gana")
})

test("A9: existing se actualiza en el bucle — ids repetidos no duplican", () => {
  const edit = editor([])
  // Dos entradas empaquetadas con el MISMO id (p.ej. dos categorías que colisionan).
  const result = addMissingSkills(edit, [bundled("tdd"), bundled("tdd"), bundled("grilling")])
  assert.deepEqual(result.added, ["tdd", "grilling"], "el segundo tdd no se registra dos veces")
  assert.deepEqual(edit.seen, ["tdd", "grilling"])
})

test("A9: bundle vacío no añade ni cede nada", () => {
  const edit = editor([])
  const result = addMissingSkills(edit, [])
  assert.deepEqual(result, { added: [], ceded: [] })
})

test("A9: THIRD_PARTY_NOTICES.md existe y nombra a Matt Pocock y MIT", () => {
  const root = new URL("../", import.meta.url).pathname
  const notices = readFileSync(join(root, "THIRD_PARTY_NOTICES.md"), "utf8")
  assert.match(notices, /Matt Pocock/i)
  assert.match(notices, /MIT/i)
  assert.match(notices, /mattpocock\/skills/i)
})

test("A9: las skills empaquetadas siguen presentes y con frontmatter válido", () => {
  const root = new URL("../", import.meta.url).pathname
  const skillsRoot = join(root, "skills")
  const one = readFileSync(join(skillsRoot, "engineering", "to-spec", "SKILL.md"), "utf8")
  assert.match(one, /^---\r?\n/, "frontmatter presente")
  assert.match(one, /^name:/m)
})
