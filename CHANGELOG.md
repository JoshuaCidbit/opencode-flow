# Changelog

## 0.3.0

Reescritura del contrato en secciones y del gate por rutas (A2 + A10 + Gate B + C1/C2/C7).

### Contrato (A2)
- `flow.md` ahora tiene un **bloque común** y una sección `## Fase N` por fase. En cada petición activa se
  inyectan el bloque común y **sólo** la sección de la fase actual, reconstruidos en cada request (lo inyectado
  en `event.system` no persiste en el historial).
- Presupuesto medido: máximo real 6330 bytes (fase 5); presupuesto **7000** bytes con test que falla si se supera.
- `options.path` manda: si el archivo no tiene secciones `## Fase N`, se inyecta completo como degradación y se
  avisa una vez. Si el contrato falta o está vacío, el plugin sigue funcionando con un brief mínimo derivado de
  `src/phases.ts`; el gate y las skills permanecen armados.
- Test de coherencia `flow.md` ↔ `src/phases.ts` (fases, nombre, skill, gate, cierre, tabla, artefactos).

### Gate (A10 + Gate B)
- **Gate B**, política por rutas:
  - fases 1-6: sólo `.scratch/<feature>/**`; fase 4 también `/tmp/opencode-proto-<feature>/**`.
  - fases 2-3: también `CONTEXT.md` y `docs/adr/**`, **sólo si existían al `/flow start`** (congelado en
    `state.allow`; no se abre a posteriori).
  - fase 7+: código del proyecto exige `spec.md`. Los tickets se exigen **sólo si el usuario pasó por la fase 6**
    o los declaró (`ticketsOpted`): `flow.md` admite implementar con `tdd` sin tickets, y exigirlos inventaría una
    fase que nunca se recorrió.
- Endurecido:
  - `spec.md` vacío no cierra el gate.
  - tickets vacíos, ocultos, `README.md` o que no sean `.md` no cierran el gate.
  - contención real de rutas (`resolve` + `realpath` del ancestro): bloquea `..` y symlinks que escapan.
  - `apply_patch` es todo-o-nada sobre el whitelist.
  - `parseCommand` valida slug `[a-z0-9-]{1,40}` con error claro; rechaza `.` `/` `\` y fases fuera de 1-10.
  - `isState` valida `allow` como `string[]`.
- `gateVersion` sube a 2.

### Comandos y fases (C1, C2, C7)
- C1: `/flow <descripción>` deriva el slug con `slugify`; `/flow` sin argumentos usa `provisionalSlug(sessionID)`
  y marca `slugProvisional`, dejando el gate activo desde el primer turno.
- C2: `/flow next`, `/flow back [N]`, `/flow rename <slug>` (mueve `.scratch/<slug>/` si existe y no pisa),
  `/flow resume [slug]`.
- `flow.md` incluye la prosa de las fases 1-4: checkpoint de `grilling`, vocabulario/ADRs, diseño como deep module
  y prototipo desechable en `/tmp`.

### Visibilidad y reanudación (nuevo en esta revisión)
- `opencode-flow.state` publicado en `session.instructions.entry` en cada cambio de estado y eliminado en
  `/flow off`. Las respuestas de comando usan `session.synthetic` con `delivery:"steer"`, con caída a
  `session.prompt`. Las APIs se verificaron contra los tipos de `@opencode/plugin` 2.4.2; **el efecto en la
  TUI sigue sin confirmar** (ver `PUBLISHING.md`).
- `.flow-feature` (`{ slug, createdAt }`) en la raíz: huella en disco para retomar sin storage. `deducePhase`
  delega en `satisfied()` (una sola definición de "artefacto presente").
- `state.allow` se recalcula en `/flow start`, `/flow resume` y `/flow back`; queda fijo dentro de una
  ejecución.
- C7: el auto-avance por artefacto se anuncia con la fase anterior, la nueva y `/flow back`.

### Empaquetado (A9)
- `existing` se actualiza dentro del bucle de skills: ids repetidos no se registran dos veces.
- Frontmatter multilínea (`description: >-`, bloques `|`) en `SKILL.md`.
- Ids cedidos (skills del usuario que ganan sobre las empaquetadas) se registran en `skills-ceded`.
- `THIRD_PARTY_NOTICES.md` con la atribución MIT de `mattpocock/skills`.

### Limitaciones conocidas
- **Visibilidad en la TUI sin verificar.** `session.instructions.entry` y el efecto de `delivery:"steer"` sólo
  están contrastados con los tipos del runtime, no en pantalla.
- **Sin dedup por marcador** entre `context` y `generate`: en 2.4.2 no co-disparan en la misma petición (verificado
  contra sus tipos); si un runtime futuro los disparara ambos, habría texto repetido, nunca estado corrupto.
  No hay marcador de deduplicación; se deja como limitación conocida.

## 0.2.0

- Estado por sesión con resolución de dueño para subagentes (A3): lectura sube por `parentID`, escritura al
  `ownerID`.
- Auto-avance monótono e idempotente por artefacto (A5).
- Log silencioso: un fallo se registra una vez, nunca por turno (A0/A4).
- Contrato de compactación con fase, gate y permiso de escritura (A1/A7/A8).
- Skills empaquetadas registradas en memoria, sólo si faltan (ver README).
- Gate declarativo para fases sin artefacto verificable.

## 0.1.0

- Mapa de fases, tres gates y checkpoint inyectados en `context`/`generate`.
- `/flow`, `/flow start`, `/flow status`, `/flow gate`, `/flow off`.
