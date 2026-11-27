# Third-party notices

Este paquete (`opencode-flow`) incluye código y documentación de terceros.

## Skills empaquetadas (`skills/`)

Las 14 skills bajo `skills/` provienen de [mattpocock/skills](https://github.com/mattpocock/skills).

- **Licencia:** MIT
- **Copyright:** © 2026 Matt Pocock
- **Licencia completa:** [`skills/LICENSE`](./skills/LICENSE)

Se registran **en memoria** al cargar el plugin y sólo si el usuario no tiene ya una skill con
el mismo id: una copia propia en `~/.agents/skills` o instalada con `npx skills` siempre gana.
Nada se copia a disco; al quitar el plugin desaparecen con él.

Ids incluidos: `codebase-design`, `code-review`, `domain-modeling`, `grilling`, `handoff`,
`implement-spec`, `pr`, `prototype`, `research`, `retro`, `tdd`, `to-spec`, `to-tickets`,
`wait-what`.

Cuando una de estas skills **no** se registra porque ya existía, el plugin lo anota en su log
(`skills-ceded`) para que el silencio no parezca un bundle roto.

## Dependencias

`@opencode/plugin` — MIT — © SST (opencode). Usado sólo como tipos y contrato de plugin.

## Código propio

Todo lo demás (`src/`, `tests/`, `flow.md`) es **MIT © JoshuaCidbit** — ver [`LICENSE`](./LICENSE).
