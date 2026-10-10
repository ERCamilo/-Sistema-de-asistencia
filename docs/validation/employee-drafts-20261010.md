# Borradores de empleados — 10 de octubre de 2026

Esta entrega protege el editor ante actualizaciones relevantes del empleado,
puestos, asistencia o nómina. Si el formulario está limpio, el panel se actualiza
como antes. Si tiene cambios, conserva el mismo formulario, foco, selección del
texto y valores incompletos; muestra un aviso de datos actualizados y permite
recargar con confirmación de descarte. Una desactivación o cambio de nombre
recibido puede excluir al empleado del filtro sin destruir su borrador.

Al guardar se comparan los valores originales, el formulario y el empleado
actual: los campos que no se editaron conservan los datos recibidos. Si ambos
cambiaron un mismo campo, se solicita confirmar los valores locales. Puestos y
sus tarifas se resuelven como un grupo para conservar asignaciones coherentes.
Una modificación de jornada no reinterpreta silenciosamente una tarifa diaria:
los importes del borrador se convierten con la jornada con la que se abrió el
formulario, previa confirmación cuando corresponde, también al crear empleados.

Si el empleado fue eliminado/fusionado o cambió el proyecto activo, se bloquea
el guardado. Un puesto eliminado del catálogo no puede guardarse como una nueva
asignación. Los diálogos de conflicto, intercambio/fusión de fichas e impacto de
asistencia vuelven a comprobar los datos antes de mutarlos. El intercambio usa
la ficha actual del empleado cuando la sincronización reemplazó su objeto.

## UX y revisión

Las confirmaciones del editor móvil mantienen el borrador debajo: Escape cierra
solo el diálogo superior y devuelve el foco al formulario; cerrar un diálogo o
recargar el editor mantiene bloqueado el scroll mientras haya otro modal abierto.
El manejador global de Escape deja esos overlays a su componente propietario.
Los listeners de editores desmontados se eliminan después de la emisión para
no omitir el aviso del editor móvil que viene a continuación.

Dos subagentes revisaron conservación/memoización/UX y combinación/guardado.
Sus reproducciones encontraron y ayudaron a corregir pérdida por filtros,
intercambio con ficha antigua y validaciones omitidas en altas nuevas. Las
reproducciones relevantes quedaron incorporadas a las pruebas del repositorio.

## Validación

- Pruebas de conservación, combinación, conflictos, altas, tarifas y guardas
  durante confirmaciones; pruebas existentes de guardado y de salario por día.
- Chromium real: borrador de escritorio ante nombre/estado/jornada remotos;
  cancelar y confirmar recarga; aviso móvil y Escape conservando borrador,
  foco y bloqueo de scroll. Sin errores JavaScript en esa ejecución. Datos
  sintéticos locales y SDK cargado mediante TLS verificado, sin cuenta de nube.
- `npm run lint:state`: sin deuda nueva (333 escrituras, baseline 336).
- `node scripts/sw-precache.cjs --check`: nuevo módulo incluido en precache.
- Jest completo en serie: **5.351 pruebas aprobadas en 571 suites** (88 s).
  La primera pasada detectó dos fallos de compatibilidad con selects de tarifa
  fuera de la tarjeta; se corrigió la lectura y la batería final pasó completa.

## Alcance y continuidad

El borrador se conserva en el formulario montado. Esta entrega no añade
almacenamiento persistente de borradores: recargar la página, cerrar/cancelar el
editor, cambiar explícitamente de empleado o abandonar la pestaña puede
reemplazarlo, como antes. Tampoco proporciona bloqueo transaccional entre
dispositivos: resuelve cambios ya recibidos; la persistencia sigue su contrato
existente de sincronización.

La rama parte de `060db0f6` (primera entrega, PR #232 aún abierto). Se propone
integrar primero #232 y después esta entrega. Queda pendiente la etapa 5 de
medición con carteras grandes y los pendientes de fotos documentados en la
revisión de la primera entrega.
