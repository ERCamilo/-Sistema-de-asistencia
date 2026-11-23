# Cierre técnico de regresión — Voz #308

Revisión actualizada: 2026-11-16. La dependencia PR #335 se integró el 2026-11-12. La rama se actualiza con main 1.7.147 y esta entrega usa 1.7.148; se conserva el historial de versiones publicado. El PR pasa a tener main como base.

## Problema reproducido en main v1.7.128

El menú Voz → Pronunciaciones ya permitía revisar y editar variantes, y el almacén local tenía protecciones de cuenta/obra. Sin embargo, la ficha solo mostraba la palabra Compartida, y el aviso de edición daba nombres sin números. La confirmación de aprendizaje solo comprobaba otras variantes guardadas y podía omitir coincidencias con nombres actuales de empleados.

Se crearon cinco pruebas nuevas independientes. La ejecución anterior al arreglo dio 3 fallos y 2 pases; después del arreglo, 5/5 pasaron.

## Solución

- La lista de una persona muestra cada pronunciación compartida junto a los nombres y números de los demás empleados que coinciden.
- El aviso de edición muestra nombre y número del competidor sin impedir guardar una pronunciación legítimamente compartida.
- El modal de aprendizaje detecta además coincidencias con el nombre completo y los componentes del nombre de otros empleados y pide confirmación humana. No guarda automáticamente por coincidencia.
- Los textos se insertan con escape de HTML; el badge es legible y permite salto de línea en móvil.
- Se mantienen transacciones locales, ámbitos de cuenta, obra y navegador, límites de alias y la independencia de los datos de asistencia, empleados y préstamos.

## Comprobaciones

- Test rojo→verde: js/tests/VoiceAlias308Independent.test.js.
- Pruebas focales relacionadas: VoiceSettingsUI, VoiceSettingsStore, VoiceMatching y VoiceAliasPrompt.
- Recorrido de Chrome: scripts/check-voice-settings.cjs en 320, 390 y 1440 px; fixture con pronunciación compartida, texto con nombre y número, accesibilidad Axe y borrador conservado.
- No usar empleados ni datos reales en QA; se emplean personas sintéticas en almacenamiento IndexedDB de navegador de pruebas.

## Revisión del 16 de noviembre

Se reprodujo otra diferencia: el buscador aceptaba «Gómez Ana» como el nombre real «Ana Gómez», pero el aviso de pronunciaciones compartidas lo omitía. La misma diferencia afectaba a componentes de nombres con guion, como «Jean» en «Jean-Pierre». La advertencia ahora usa la normalización, el límite de longitud y las formas exactas (nombre completo sin espacios, palabras y orden alterno) del buscador, sin ejecutar comparaciones aproximadas por cada variante mostrada.

Las pruebas adicionales comprueban esos nombres, selección manual en todos los niveles de precisión y prioridad de un número explícito. También se comprueba eliminar una asociación compartida sin borrar la de otra persona, cuenta u obra. No cambian los algoritmos ni las puntuaciones del buscador, el almacenamiento o las reglas de negocio.

La vista previa de voz que debe actualizarse es https://test-sa-voice-mvp.sistema-de-asistencia.pages.dev. Publicar una rama de prueba en ese alias evita cambiar CORS, Firebase o el origen del almacenamiento. La producción de Cloudflare sigue siendo main. Las pruebas de interfaz usan datos ficticios y transporte simulado; no acreditan una nueva prueba con Gemini y sesión real.

## Estado de entrega

Cerrar #308 únicamente después de que CI y release gate pasen en el SHA final y la funcionalidad esté integrada. Mantener como referencia los resultados rojo→verde y los hallazgos de la auditoría.

Siguientes pasos: agente SA termina pruebas y actualiza la vista previa habitual; usuario revisa pronunciaciones compartidas en su teléfono; agente SA atiende resultados e integra tras la revisión.
