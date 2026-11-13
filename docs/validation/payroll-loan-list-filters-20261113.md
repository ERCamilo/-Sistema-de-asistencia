# Nómina: orden y filtros del paso 4

## Comportamiento

El listado de préstamos del paso 4 antes seguía el orden del array de empleados, que depende de la carga/sincronización. Ahora ordena por ficha con comparación numérica: 002 antes de 010. Las fichas ausentes quedan al final; el nombre y el ID resuelven empates sin mutar los datos de origen.

El buscador admite nombre, apellidos y número, sin distinguir acentos o mayúsculas. Los filtros adicionales son líder que paga, posición y cobros seleccionados/sin seleccionar. Al combinar líder y posición deben coincidir en el mismo tramo de trabajo. Se toma el pagador del desglose del período; sin trabajo disponible se consulta la asignación del empleado. Se representan posiciones y líderes ausentes del catálogo sin retirar empleados del listado.

Estos filtros son solo del listado de préstamos: no modifican el filtro de nómina, sueldos, selección temporal, totales ni exportación a SplitX. El contador informa cuántos empleados se ven y cuántos empleados con cobros seleccionados quedan ocultos. Las acciones masivas se deshabilitan mientras hay filtros locales, con explicación y acceso a «Quitar filtros», para no modificar cobros ocultos. Las selecciones individuales siguen disponibles mediante las operaciones existentes.

Los controles actualizan la visibilidad sin regenerar la nómina ni escribir ajustes. Así se conservan foco, detalles abiertos y borradores de importe/porcentaje. Los filtros sobreviven al rerender de una selección en el mismo contexto y se reinician al cambiar de obra, período o filtro principal de líder. No se sincronizan ni se añaden al backup.

La integración cubre el generador por obra y el generador legacy. El modo especial de registrar un período ya pagado conserva su propio listado de abonos, que ya ordena por número; no se reemplaza por este selector de cobros pendientes.

## Verificación

Las regresiones incluyen orden numérico y fichas ausentes; pagador histórico frente al catálogo; asignaciones individuales; combinación de filtros por el mismo tramo; registros sin catálogo; búsqueda por acentos/número; selección oculta; conservación de totales/borradores/foco; reinicio por contexto; controles masivos previamente deshabilitados y nombres tratados como texto. La delegación real de PayrollUI también se comprueba sin renderizar ni escribir estado.

El recorrido Chromium del filtro de nómina se amplía con el paso 4 en 320, 390 y 1280 px: orden, pagador, posición, resultados vacíos, igualdad de exportación antes/después de filtrar, selección individual con filtros persistentes y limpieza. Incluye auditoría WCAG A/AA de los nuevos controles y capturas locales con datos ficticios.

## Barra móvil de pasos

Atrás/Continuar usaba `position: sticky`, ligado al contenedor. En móvil pasa a `fixed`, con espacio de desplazamiento al final del contenido. Respeta el área segura y queda sobre la navegación principal, incluido su botón central y la barra secundaria de Finanzas cuando está visible. En una vista sin navegación principal queda a 8 px del borde inferior. Escritorio conserva el flujo normal.

Un listener compartido de `visualViewport` ajusta solo la barra de nómina cuando el teclado reduce el área visible sin reducir el layout. Agrupa eventos en un frame y no compensa el zoom por pellizco. Las pruebas verifican anclaje al desplazar, variantes de navegación, último empleado accesible y teclado simulado; la comprobación con un teclado físico de iOS/Android sigue correspondiendo a la prueba manual del usuario.

Los resultados finales de ejecución se consignan en el PR. La versión es 1.7.137; no se han registrado préstamos ni pagos reales durante estas comprobaciones.

## Estado separado del nombre

Las advertencias de cada empleado (fuera de nómina, sueldo no disponible/restante y saldo insuficiente) se presentan en una columna Estado propia, entre Empleado y Préstamos. El nombre no contiene avisos. En móvil, el estado ocupa una fila independiente, con su etiqueta y SVG, antes de las métricas; los empleados sin avisos no añaden una fila vacía. En escritorio, una raya indica que no hay advertencia. No cambia la clasificación de estados ni los importes.

## Siguientes pasos

- Agente SA: completar las pruebas y publicar un PR con vista previa.
- Usuario: revisar el paso 4 con una nómina de prueba, comprobando el número de ficha y el pagador esperado. No necesita confirmar pagos para probar los filtros.
- Agente SA: atender la revisión e integrar cuando corresponda. El trabajo de voz continúa por separado.
