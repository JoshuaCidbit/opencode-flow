# Publicación pendiente — v0.3.0

**No etiquetar v0.3.0 hasta que el usuario confirme la prueba manual en OpenCode real.**

El paquete pasa typecheck y 173 tests automáticos. Lo verificable por API ya está **medido** en un
servidor 2.4.2 aislado (ver `README.md`, "Verificación"): el entry de estado aparece/actualiza/desaparece y
las respuestas no cuestan tokens. Lo que sigue **sin verificar en pantalla** es que la TUI pinte ese entry.

## Checklist de prueba manual (una sesión real, OpenCode ≥ 2.4.2)

1. `/flow` → brief de fase 1 y, si la TUI lo muestra, la línea `[flow] fase 1 · activo · feature …`.
2. Escribir fuera de `.scratch/` en fase 1-6 → bloqueado con motivo claro.
3. Escribir `.scratch/<slug>/spec.md` vacío → NO avanza. Con contenido → auto-avance a 6 **y aviso**.
4. `/flow back` → vuelve a 5 y reabre el gate.
5. `/flow off` → desaparece la línea de estado; el mensaje dice `/flow resume`.
6. Nueva sesión sobre el mismo proyecto → ofrece retomar la feature de `.flow-feature`.
7. `/flow resume` → fase deducida de los artefactos, no adivinada.
8. Estado refrescado sin reiniciar: `/flow next`, `/flow back`, `/flow rename` y `/flow gate spec`
   cambian la línea de estado en la TUI (no sólo en el servidor).
9. Deducción 1-4: con `understanding.md` retoma en 2; con `GLOSSARY.md`/`CONTEXT.md` en 3; con
   `design.md` en 4; con `spec.md` en 6; con tickets fuera adoptados en 7.
10. Fase 7 sin tickets: el gate exige sólo `spec.md` ("abierto (spec presente)"). Tras retomar en 7 con
    tickets en disco, pasa a exigir ambos ("abierto (spec presente + tickets)").
11. Una respuesta de comando (`/flow status`) no debe arrancar un turno ni producir texto del asistente:
    debe aparecer como mensaje avisado/inbox.

Cuando los 11 pasen, borra este archivo, sube la versión si hace falta y etiqueta.

## Cómo se publica (después de la confirmación)

```
npm test && npm run typecheck
git tag -a v0.3.0 -m "opencode-flow v0.3.0"
git push origin v0.3.0
```
