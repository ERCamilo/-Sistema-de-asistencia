# Líder individual y préstamo de personal — #313

Implementación basada en el diseño aprobado y fusionado en #354. Base: `0f3230b6` (SA 1.7.128); versión propuesta: **1.7.129**. Datos de QA ficticios; sin operaciones sobre cuentas de producción.

## Comportamiento

- La tarjeta de cada posición propone el líder del catálogo y permite cambiarlo para ese empleado, incluida su posición principal. El catálogo y los compañeros conservan su configuración; las asignaciones normales sin líder siguen admitidas.
- Sin préstamo, el líder del equipo es el pagador efectivo. El switch muestra la etiqueta Préstamo y despliega solo el pagador alternativo. En un borrador nuevo se sugiere desde la posición principal hasta una elección manual; las elecciones guardadas se conservan.
- El switch ocupa una fila y, al activarlo, equipo y pagador quedan lado a lado. Las ayudas son breves; la explicación completa sigue en `?`. En 320/390/1280 px la sección abierta pasa de 246 px a 150/136/136 px, con controles táctiles de al menos 44 px y sin desbordamiento.
- La ayuda `?` usa el modal existente de SA, con los dos roles y recorridos separados. Mantiene el editor y sus selecciones. La expansión de la tarjeta usa altura real y respeta movimiento reducido.
- `positionAssignments` conserva la configuración por puesto y versiones previas. Las escrituras de asistencia de la app, del servicio y del importador Mini capturan condiciones de los puestos configurados. Las ediciones de horas/notas, la restauración y el merge conservan las condiciones históricas. Las asignaciones sin esta configuración mantienen el cálculo legacy.
- PayrollService reutiliza las fórmulas vigentes. Separa tramos por condiciones históricas, sin atribuir un salario completo a cada líder. Los préstamos y ajustes personales fijos tienen un único pagador; los porcentajes conservan su alcance.
- El ajuste del líder es una colección separada de filas pagables: no tiene empleados seleccionables ni comandos de descuentos, bonos o préstamos. Se calcula sobre salario de trabajo, separado del neto de empleados. Desactivar el checkbox elimina solo ese ajuste; desplegar el detalle no cambia importes.
- El checkbox se conserva por cuenta, obra, líder y período. El cierre completo captura el grupo, el detalle y el estado del checkbox en su identidad; admite saldo negativo de líder sin crear salarios negativos ni otro asiento financiero. Las vistas parciales no pueden confirmar el cierre completo.
- El historial, PDF y Excel muestran el ajuste separado de salarios y días. El Excel usa las atribuciones al pagador; SplitX conserva el salario individual y las referencias de sus pagadores efectivos. El ajuste entre líderes pertenece a SA y no se convierte en un préstamo monetario ni en otro empleado de SplitX.
- Los datos adicionales se conservan en el modelo de empleado, merge y respaldos completos. El auto respaldo reducido de sesión excluye los snapshots que contienen tarifas.

## Verificación automatizada

Comandos:

```sh
npm test -- --runInBand --silent
CHROMIUM_PATH=/usr/bin/chromium npm run test:employee-position-leaders
npm run lint:state
npm run build
```

También se comprueba el visor de fotos con su prueba original de Chromium, para verificar el arranque independiente de los servicios de imagen.

La prueba de navegador usa el editor y la nómina reales, con Firebase sustituido y solicitudes externas bloqueadas. Comprueba 320/390/1280 px, líder predeterminado y cambio individual, sugerencia y elección manual del pagador, guardado real del formulario, ayuda y retorno, grupo único, checkbox/detalle independientes y WCAG A/AA en el grupo.

Casos financieros cubiertos: $900 pagados una vez; $500 − $900 = −$400; grupo desactivado → $500; Juan + Pedro → descuento agrupado de $1,300 y saldo −$800; medio día; feriado; horas extra; mismo líder; cambio de pagador dentro del período; preservación de datos históricos, restore y sync; cobro único de ajustes personales; huellas de cierre con checkbox y saldos separados; hojas de líderes en Excel; pagador efectivo en SplitX.

## Validación manual antes de integrar

1. **Usuario:** en la vista previa, abrir un empleado, comprobar el líder predeterminado, elegir otro sin préstamo y verificar su nómina.
2. **Usuario:** activar préstamo, elegir pagador, registrar asistencia de prueba y comprobar ambas nóminas, checkbox, detalle, PDF y Excel.
3. **Agente SA:** resolver observaciones y verificar los checks del PR antes de integrar. No usar la vista previa para registrar pagos reales durante esta validación.

El historial de cierres es la referencia de pagos confirmados; el reporte de personal presenta la proyección actual del rango seleccionado con la elegibilidad habitual de nómina. La función no registra regalos externos, fracciona el salario entre pagadores ni liquida/arrastra automáticamente saldos negativos de líderes.


## Cifras del período en la tarjeta del puesto

Corrección de la revisión del MVP: con obras habilitadas el editor devolvía un mapa vacío para evitar la API de nómina legacy y renderizaba esos valores ausentes como 0 días / 0h. También dependía exclusivamente de la asistencia que ya estuviera en memoria.

Ahora usa la configuración cargada de la obra activa, el contexto canónico limitado al empleado/período y la API de cálculo con contexto. Al abrir el formulario solicita las asistencias de todo ese rango mediante el cargador existente. Los días cuentan fechas distintas por puesto y las horas incluyen las extras; las horas fraccionadas conservan dos decimales de presentación. No cambia fórmulas ni registra operaciones.

Durante la carga, la tarjeta muestra «—». Si falla, informa que las cifras no están disponibles y ofrece Reintentar. Al terminar solo actualiza el bloque de estadísticas: conserva nodos, foco, tarifas y líderes editados. Cambiar de obra/sesión, cerrar el formulario o cambiar de período durante la consulta impide publicar datos tardíos como si fueran actuales.

Regresión automatizada: obra activa frente a configuración global distinta, exclusión de otra obra/rango, multiposición, extras, fechas únicas, cero real tras cargar, falta de configuración, error/reintento y preservación de borradores. La prueba Chromium también abre el editor real con obras activas, hidrata el período pendiente y verifica 1 día / 8h sin borrar una tarifa escrita durante la espera.
