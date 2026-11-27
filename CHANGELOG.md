# Changelog

## 0.3.0

Reescritura del contrato en secciones y del gate por rutas (A2 + A10 + Gate B + C1/C2/C7).

### Contrato (A2)
- `flow.md` ahora tiene un **bloque común** y una sección `## Fase N` por fase. En cada petición activa se
  inyectan el bloque común y **sólo** la sección de la fase actual, reconstruidos en cada request (lo inyectado
  en `event.system` no persiste en el historial).
- Presupuesto medido: máximo real 6040 bytes (fase 5) tras añadir Gate B; presupuesto 9000 bytes con test que
  falla si se supera.
- `options.path` manda: si el archivo no tiene secciones `## Fase N`, se inyecta completo como degradación y se
  avisa una vez. Si el contrato falta o está vacío, el plugin sigue funcionando con un brief mínimo derivado de
  `src/phases.ts`; el gate y las skills permanecen armados.
- Test de coherencia `flow.md` ↔ `src/phases.ts` (fases, nombre, skill, gate, cierre, tabla, artefactos).

### Gate (A10 + Gate B)
- **Gate B**, política por rutas:
  - fases 1-6: sólo `.scratch/<feature>/**`; fase 4 también `/tmp/opencode-proto-<feature>/**`.
  - fases 2-3: también `CONTEXT.md` y `docs/adr/**`, **sólo si existían al `/flow start`** (congelado en
    `state.allow`; no se abre a posteriori).
  - fase 7+: código del proyecto exige `spec.md`; fase 7 exige también tickets.
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
