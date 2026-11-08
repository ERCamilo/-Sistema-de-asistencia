# Cierre técnico de regresión — Voz #308

Fecha: 2026-11-08. Rama dependiente de PR #335, que incorpora el estado base de NFC 1.7.129; esta entrega sería SA 1.7.130 y no debe fusionarse antes de su dependencia.

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

## Estado de entrega

Este PR es apilado sobre PR #335: no fusionar directamente a main antes de integrar #335. Cerrar #308 únicamente después de que CI y release gate pasen en el SHA final y la funcionalidad esté integrada. Mantener como referencia los resultados rojo→verde y los hallazgos de la auditoría.
