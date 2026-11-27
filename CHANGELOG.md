# Changelog

- Las secciones 1-4 nombran el artefacto que cierra cada una (`understanding.md`, `glossary.md`,
  `design.md`) con su ruta bajo `.scratch/<feature>/`: antes no lo decían, así que el modelo no
  escribía nada y `resume` siempre caía a la fase 1 repitiendo el grilling. La fase 1 fija ahora
  sus seis reglas (explorar antes de preguntar, una pregunta por turno con recomendación, sin
  código, artefacto con ruta, slug descriptivo si es provisional, esperar `/flow next` del usuario)
  en vez de delegarlas en la skill `grilling`, que puede no existir en el host.
- El contrato se inyecta con `<feature>` YA RESUELTO al slug concreto (`scopeToFeature`): las rutas
  son ejecutables por el modelo. `<slug>` sigue siendo sintaxis de comando y no se toca.
- Presupuesto re-medido: máximo 6689 bytes en fase 1 (antes 6330 en la 5); el test nombra la fase
  más cara y exige un margen de 300-700 B bajo el límite de 7000.
### Limitación conocida
- El bloque común se inyecta en TODA petición activa, así que la escalera de verificación y las
  escaladas (que aplican sobre todo desde la fase 7) se pagan también en las fases 1-4. Se acepta
  a cambio de reglas críticas presentes siempre; no se ha optimizado por fase.

Reescritura del contrato por secciones, gate por rutas, comandos de reanudación y puerta 7 con
tickets (A2 + A10 + Gate B + C1/C2/C7). Etiqueta pendiente de la prueba manual en la TUI.

### Visibilidad del estado (medida, no inferida)
- Las respuestas de comando usan `synthetic` con `resume:false`: **0 tokens, 0 coste y 0 mensajes de
  asistente** medidos en un servidor 2.4.2 aislado (antes, con `delivery:"steer"`, 37-1359 tokens de
  entrada y 3-4 mensajes por `help`/`status`/`off`). El texto queda en la bandeja como `type:"synthetic"`.
- `instructions.entry` verificado de punta a punta: el entry `opencode-flow.state` aparece en
  `/flow start`, se refresca en cada cambio de estado (`next`/`back`/`rename`/`gate`/`resume`/
  auto-avance) y se borra en `/flow off`.

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
  - fase 7+: código del proyecto exige `spec.md`. Los tickets se exigen **sólo si hubo compromiso**
    (`ticketsOpted`): recorrer la 6, cerrar `/flow gate tickets` o tener tickets en disco; `flow.md`
    admite implementar con `tdd`, y exigirlos sin compromiso inventaría una fase que nunca se recorrió.
- Endurecido:
  - `spec.md` vacío no cierra el gate.
  - tickets vacíos, ocultos, `README.md` o que no sean `.md` no cierran el gate.
  - contención real de rutas (`resolve` + `realpath` del ancestro): bloquea `..` y symlinks que escapan.
  - `apply_patch` es todo-o-nada sobre el whitelist.
  - `parseCommand` valida slug `[a-z0-9-]{1,40}` con error claro; rechaza `.` `/` `\` y fases fuera de 1-10.
  - `isState` valida `allow` como `string[]`.
- Versión del gate endurecida (antes 1, ahora 2) sin cambiar la forma del estado.

### Comandos y fases (C1, C2, C7)
- C1: `/flow <descripción>` deriva el slug con `slugify`; `/flow` sin argumentos usa `provisionalSlug(sessionID)`
  y marca `slugProvisional`, dejando el gate activo desde el primer turno.
- C2: `/flow next`, `/flow back [N]`, `/flow rename <slug>` (mueve `.scratch/<slug>/` si existe y no pisa),
  `/flow resume [slug]`.
- `flow.md` incluye la prosa de las fases 1-4: checkpoint de `grilling`, vocabulario/ADRs, diseño como deep module
  y prototipo desechable en `/tmp`.

### Visibilidad y reanudación (nuevo en esta revisión)
- `opencode-flow.state` publicado en `session.instructions.entry` en cada cambio de estado y eliminado en
  `/flow off`. Las respuestas de comando usan `session.synthetic` con `resume:false` (0 tokens, 0 coste,
  ver arriba), con caída a `session.prompt`. El render del entry en la TUI **sigue sin confirmar**
  (ver `PUBLISHING.md`).
- `.flow-feature` (`{ slug, createdAt }`) en la raíz: huella en disco para retomar sin storage.
  `deducePhase` deduce también las fases 1-4 por sus artefactos (`understanding.md` → 2,
  `glossary.md`/`GLOSSARY.md`/`CONTEXT.md` → 3, `design.md` → 4) y delega las 5-6 en `satisfied()`
  (una sola definición de "artefacto presente", incluye "no vacío").
- `/flow resume` explica la fase que deduce **y por qué** (`spec de .scratch/<feature>/`, etc.) y avisa
  de `/flow back` para corregir un borrador no aprobado. Si hay estado en storage, MANDA: la fase guardada
  no se sustituye por la deducida, y el mensaje lo dice.
- Puerta 7 con tickets: `ticketsOpted` (tri-estado) se activa al avanzar desde una 6 recorrida, al
  cerrar `/flow gate tickets` o al encontrar tickets en disco; al retomar ya en 6/7 sin tickets queda
  `false` (camino `tdd`) para que `/flow next` no exija lo que nunca se prometió. El gate de escritura
  y `/flow status` ahora CONSIDERAN el flag (antes el hook no lo pasaba y adoptarlo no endurecía nada).
- Tests de integración que ejercitan los **hooks registrados** (`execute.before`, comandos) contra un
  `ctx` falso: compromiso sin tickets bloquea `src/`, el auto-avance 6→7 por ticket persiste
  `ticketsOpted:true`, y `/flow status` coincide con el hook en ambos caminos. Al montarlo apareció el
  bug del mensaje `exige ; escríbelo` cuando faltaban sólo tickets: ahora nombra `spec` y/o `tickets`.
- `state.allow` se recalcula en `/flow start`, `/flow resume` y `/flow back`; queda fijo dentro de una
  ejecución.
- C7: el auto-avance por artefacto se anuncia con la fase anterior, la nueva y `/flow back`.

### Empaquetado (A9)
- `existing` se actualiza dentro del bucle de skills: ids repetidos no se registran dos veces.
- Frontmatter multilínea (`description: >-`, bloques `|`) en `SKILL.md`.
- Ids cedidos (skills del usuario que ganan sobre las empaquetadas) se registran en `skills-ceded`.
- `THIRD_PARTY_NOTICES.md` con la atribución MIT de `mattpocock/skills`.

### Limitaciones conocidas
- **Render del entry en la TUI sin verificar.** `session.instructions.entry` está verificado por API
  (aparece, se refresca, se borra) pero falta confirmar que la interfaz lo pinte. `resume:false` está
  medido: 0 tokens y 0 mensajes de asistente.
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
