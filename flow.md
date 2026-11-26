# FLOW — contrato de trabajo

Reglas no negociables, activas en cada petición. Si una petición del usuario las contradice, decilo antes de continuar.

## Mapa de fases (orden prescriptivo)

| # | Fase | Skill | Cierra con |
|---|---|---|---|
| 1 | Entender | `grilling` | checkpoint de entendimiento aprobado |
| 2 | Vocabulario | `domain-modeling` | términos y ADR acordados |
| 3 | Diseño del módulo | `codebase-design` | costuras y tests definidos |
| 4 | Sondear | `prototype` | respuesta a una pregunta de diseño |
| 5 | Especificar | `to-spec` | `.scratch/<feature>/spec.md` |
| 6 | Trocear | `to-tickets` | tickets verticales con bloqueos |
| 7 | Implementar | `implement-spec` (con tickets) o `tdd` (sin tickets; siempre en proyectos sin git) | tests en verde |
| 8 | Revisar | `code-review` contra el spec | hallazgos resueltos |
| 9 | Publicar | `pr` | PR con evidencia |
| 10 | Cerrar | `retro` | lecciones registradas |

En fondo: `research` (fuentes primarias). `wait-what` cuando algo no cierra. `handoff` para escalar.
Saltar una fase exige decir qué riesgo se asume y obtener aceptación explícita del usuario.

## Tres gates

1. **Sin spec no hay código.** Salvo fase 4 (`prototype`, desechable). Cambio trivial: excepción declarada y aceptada.
2. **Sin evidencia no hay afirmación.** Nunca digas "funciona", "listo", "arreglado" ni "tests pasan" sin haber corrido el comando en esta sesión y leído la salida completa.
3. **Sin decisión de integración no hay cierre.** Antes de cerrar: cómo se integra (commit, PR, merge) y qué queda pendiente.

## Checkpoint (entregable de Plan)

Antes de editar código, entregá exactamente:
- **Entendí**: qué se pide, con citas `path:line`.
- **Asumo**: lo no dicho que estoy completando.
- **Necesito que confirmes**: preguntas abiertas reales.

Pasar a build es la aprobación. No repitas el checkpoint después.

## Narración obligatoria

En cada transición de fase y antes de cualquier afirmación de avance o de terminado, escribí una línea:
`[flow] fase N · gate pendiente: X`

Sin esa línea el estado no sobrevive a la compactación.

## Verificación (escalera)

1. Detectá el manifest (`package.json`, `requirements.txt`, etc.) del directorio que vas a tocar.
2. Localizá el script real en ese manifest; no inventes comandos.
3. Corré desde el directorio correcto (la raíz de un monorepo puede no tener manifest).
4. Leé la salida completa, incluido el código de salida.
5. Sólo entonces afirmá. Si falló, pegá el error real.

Si el manifest no declara suite: dilo en vez de inventar un comando, y verifica con lo que sí se pueda ejecutar.

## Prototipos (fase 4)

Escribí sólo en `/tmp/opencode-proto-<slug>`. Nunca dentro del árbol del proyecto. Es desechable: no se commitea.

## Escaladas

- `handoff`: cuando el problema excede el modelo actual; llevá evidencia (comandos, salidas, archivos).
- `research`: en segundo plano cuando falta un dato externo verificable.
- `wait-what`: cuando la premisa o el pedido no cierra; parar y preguntar.
