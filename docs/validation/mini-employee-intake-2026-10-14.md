# Validación de personal Mini → SA — 14 de octubre de 2026

## Pruebas automatizadas

SA: 5.988 pruebas en 624 suites Jest con Node 20 y dos workers, guard de escrituras de estado y build de producción aprobados. Los fixtures Chromium existentes de Ajustes y visor de fotos también pasan; Ajustes conserva dos hallazgos de contraste previos en metadatos de su pie, fuera de las superficies nuevas. Los casos nuevos verifican conversión diaria, duplicados, obra/cuenta, fecha de ingreso, reactivación, recepción sin altas, concurrencia de fichas, transacción abortada sin escrituras parciales, aceptación parcial, descarte, puesto pausado y recuperación de respuesta. La revisión de asistencia reconoce el vínculo sólo para el par/empleado de origen y conserva las horas pendientes.

Mini: TypeScript estricto, 612 pruebas de `npm test` y build aprobados. Se verifica también la suite de 33 pruebas E2E de almacenamiento, temas, WhatsApp, puestos, hoja de asistencia y tutoriales. Los casos nuevos cubren selección explícita, confirmación de obra, aislamiento de canales no autenticados, reenvío, cierre durante selección y preservación de IDs/metadatos. Los archivos generados del contrato son idénticos en ambos repositorios. La prueba de vuelta a almacenamiento anterior esperaba sólo un contenedor estático y 800 ms; ahora espera la recarga y el indicador de arranque completo, manteniendo sus aserciones de modo, asistencia y limpieza.

## Comprobación entre clientes

Con los dos checkouts de esta función:

```sh
MINI_REPO_ROOT=/ruta/Mini_Sistema_de_Asistencia \
CHROMIUM_PATH=/usr/bin/chromium INTAKE_SIMULATED_CHANNELS=1 \
node scripts/check-mini-employee-intake.cjs
```

El fixture utiliza los módulos reales de contrato, transporte fragmentado/SHA-256, sender, repositorio Mini, revisión y store SA. IndexedDB es el del navegador; las cuentas y la sincronización externas son sustituidas por límites sintéticos. Los canales de ese comando son simulados, expresamente. Comprueba consentimiento, alta editada (ficha/contacto), conversión de 1500/día a 187,5/h con jornada de 8 horas, respuesta perdida y recuperada, envío iniciado desde Mini, vínculo estable, una sola alta y conservación de la asistencia local.

En 320, 390 y 480 px comprueba desbordes y objetivos táctiles. Axe WCAG A/AA no encontró violaciones en las superficies nuevas; Mini se comprobó en dark, light, contrast, ocean y sol. No hubo errores JavaScript. Esto no sustituye una revisión manual de accesibilidad.

Sin `INTAKE_SIMULATED_CHANNELS`, el mismo fixture intenta canales WebRTC nativos locales. En este entorno Chromium terminó la búsqueda ICE con cero candidatos en ambos pares y no abrió el canal. Esa comprobación no pasó y no se contabiliza como validación de WebRTC. El protocolo y la persistencia sí pasaron con canales simulados; falta la prueba en dispositivos reales.

## Prueba en dispositivos al publicar ambas versiones

1. Vincular Mini y SA, abrirlos y seleccionar la obra SA. Crear un empleado Mini con ficha, puesto y salario por día; marcarle asistencia.
2. Enviar personal, comprobar la obra mostrada en Mini y confirmar selección. Antes de aceptar, verificar que SA no incorporó al empleado.
3. Corregir contacto/ficha y fecha de ingreso, aceptar y comprobar que Mini conserva empleado y asistencia con el vínculo SA. Aprobar la asistencia por separado.
4. Repetir envío: no debe crear otra persona. Probar una ficha ocupada, un homónimo, vincular a un SA existente y una aceptación parcial.
5. Cortar la conexión antes de recibir el resultado; reconectar y reenviar. Comprobar una sola alta, recuperación del vínculo y horas conservadas.
