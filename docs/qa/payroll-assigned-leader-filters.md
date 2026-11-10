# Nómina: filtros con líder y pagador por empleado

Base: SA 1.7.129 (`661377ad`). Corrección propuesta: 1.7.130.

## Causas verificadas

- `filterPayrollRowsByLeader` procesaba las filas configuradas antes de consultar `hoursScope`. Ambos botones devolvían siempre los tramos del pagador, sin aplicar el filtro de equipo.
- Separar filas nuevas y antiguas en dos listas alteraba el orden de empleados al filtrar.
- El selector de líderes usaba catálogo y asignaciones actuales, sin incluir responsables guardados en las asistencias del período. Un pagador anterior podía desaparecer y el filtro pasaba a Todos.

## Comportamiento corregido

- En posiciones configuradas, Todos sus puestos conserva todos los tramos a cargo del pagador elegido. Solo puestos de… restringe además al equipo histórico de ese líder. Un préstamo de personal no traslada su salario a la nómina del receptor.
- Se filtran tramos, no solo IDs de puesto: un mismo puesto puede tener líderes distintos dentro del período. Cambiar el catálogo no reescribe el trabajo guardado.
- Las posiciones anteriores sin configurar mantienen su comportamiento. El orden original de las filas se conserva.
- Los líderes históricos se obtienen de las filas del período de la obra activa; siguen disponibles aunque después se hayan archivado o eliminado, usando el nombre guardado cuando falta el catálogo.
- Solo empleados seleccionados se combina con líder y horas. Quitar filtros recupera la obra completa sin recalcular ni modificar las filas fuente.
- El grupo de descuento entre líderes conserva el período completo, como antes. En una vista parcial se identifica explícitamente como subtotal/saldo completo, también en PDF. El filtro no modifica salarios ni ajustes guardados.
- La tabla, PDF y JSON/SplitX usan la misma proyección. El cierre completo continúa bloqueado mientras se revisa solo un líder o una selección de empleados.

## Verificación

Pruebas de regresión: préstamo con sueldo propio y trabajo para otro equipo; mismo puesto con dos líderes históricos; líder individual diferente del catálogo; orden mixto; ausencia de horas; selección de personas; pagador histórico activo, archivado o eliminado; y aviso de saldo completo.

La prueba Chromium del editor/nómina reales comprueba 320/390/1280 px, botones de horas, cambio de líder, selección de empleados y JSON. Usa datos ficticios, bloquea solicitudes externas y fija el reloj antes de las asistencias de prueba para respetar la vigencia histórica de las asignaciones.

```sh
npm test -- --runInBand --silent
CHROMIUM_PATH=/usr/bin/chromium npm run test:employee-position-leaders
npm run build
```

## Aceptación en la vista previa

1. Usuario: revisar un empleado con dos puestos y un préstamo de personal; alternar líder y ambos modos de horas. Los puestos excluidos deben indicarse y coincidir en tabla y exportación.
2. Usuario: combinar Solo empleados seleccionados y luego quitar ambos filtros. La nómina completa debe recuperarse.
3. Agente SA: resolver observaciones y comprobar CI antes de integrar. No cambiar fórmulas ni registrar operaciones financieras durante esta validación.


## Incidente de catálogo parcial durante la sincronización

El registro aportado muestra que el estado arranca con 86 empleados, 27 puestos y 7 líderes y termina aplicando una lectura de 83, 5 y 4. La guardia de integridad evita retirar las referencias de empleados/asistencias, pero antes de ella el callback del documento general ya reemplazaba las listas locales con las del loader. Los listeners por registro llegaban demasiado tarde para conservar lo sobrescrito.

La entrada del espejo ahora fusiona contra el estado vigente después de la lectura asíncrona, respetando los cambios individuales y sin interpretar ausencias como borrados. Los repositorios transmiten si el snapshot proviene del servidor confirmado o de caché/escrituras pendientes; los LiveSync conservan esa procedencia. Solo una confirmación del servidor actualiza las líneas de base. Un puesto que todavía está asignado o usado en asistencia, o un líder todavía referenciado por el catálogo o una asignación, queda protegido ante ausencias en el catálogo entrante. Los borrados confirmados de elementos sin referencias siguen funcionando. Las líneas de base se reinician al cerrar sesión o cambiar de cuenta.

Regresión adicional: 86/27/7 frente a 83/5/4, fallos/listas vacías, versiones locales más nuevas, préstamos locales, escritura y recarga con IndexedDB real sobre fake-indexeddb, cadena repositorio → LiveSync, borrado confirmado sin referencias y conservación del líder 2 con un puesto cuyo catálogo indica líder 1 o ninguno. Se conserva el cálculo y la historia de las asistencias; no se reatribuyen horas pasadas automáticamente.

Los contadores de guardado indican cuántos registros se escribieron, no prueban por sí solos que los restantes hayan sido borrados de IndexedDB. El guardado normal hace upsert. Esta corrección preserva lo disponible localmente; no inventa los registros que ya falten en todos los respaldos/dispositivos. La recuperación real debe comenzar por un respaldo local y la comprobación del catálogo durable del mismo origen y cuenta, antes de restaurar o sobrescribir la nube.

## Servicio externo de fotos

`POST https://n8n.erlin.do/webhook/app-images` devuelve 404 en el registro aportado. Es independiente del merge de empleados/puestos: la ruta de lectura de fotos conserva la copia local cuando falla. El responsable de n8n debe comprobar la ruta productiva, activación/proxy y conexión con la función `app-images`, sin exponer credenciales en el navegador. La prueba del visor local usa mocks y no certifica la disponibilidad de ese servicio.
