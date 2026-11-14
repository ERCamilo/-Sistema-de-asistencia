# Exportación desde el resumen móvil de nómina

En el generador por obra faltaba el control móvil para desplegar el resumen, aunque sus detalles se ocultaban por CSS. Además, las acciones de exportación del resumen se ocultaban fuera del paso final en ambos generadores.

La versión 1.7.138 comparte el control «Resumen y exportar» entre el generador por obra y el legacy. Al desplegarlo se muestran los totales y cuatro acciones: SplitX, PDF, copiar JSON y descargar JSON, en cualquiera de los pasos. El resumen móvil sigue el desplazamiento del contenido para no tapar controles; la barra inferior Atrás/Continuar mantiene su anclaje. Los botones tienen superficies sólidas y un mínimo de 44 px. Los importes en cero del resumen por obra conservan contraste suficiente.

Las acciones mantienen su delegación a las funciones originales y los bloqueos de nómina inválida. No cambian cálculos, filtros, selección, contrato de SplitX ni operaciones de negocio. El resumen se inicia contraído y conserva el comportamiento de reinicio que ya tenía al cambiar de contexto.

Validación: suites de nómina por obra/runtime, versión, cierre, abonos y centavos; Chromium comprueba las cuatro acciones en los cinco pasos de la obra, copia y descarga JSON, envío con el bridge de prueba, y copia desde el generador legacy. Se compara con el JSON filtrado original. También se comprueban áreas táctiles, anchuras, WCAG A/AA y los bloqueos por neto negativo. Se usan datos ficticios y se bloquean peticiones externas; no se registra ningún pago ni se envía una nómina real a SplitX. El botón PDF conserva su generador original; en este recorrido se comprueba su acceso y bloqueo, sin descargar librerías externas.

Siguientes pasos: agente SA publica PR/vista previa y verifica CI; usuario prueba «Resumen y exportar» en su teléfono; agente SA atiende los resultados e integra según el flujo de revisión habitual.

## Revisión del fallo de CI

La primera ejecución completa detectó una aserción heredada que exigía literalmente `min-width: 560px`. La columna Estado introducida en la entrega anterior necesita más ancho; el tamaño literal ya no representaba el contrato visual. Se reprodujo localmente el mismo fallo antes de corregir la comprobación.

Se conserva el test del detalle compacto y se comprueba que la tabla permita desplazar sus columnas dentro del panel. Chromium verifica a 1024 y 1440 px el contenedor, las nueve columnas alineadas entre encabezado y filas, la ausencia de desbordamiento de página y el acceso mediante scroll al control de la última columna. Se mantiene el tamaño de lectura y el ancho de la columna Estado. La suite completa se ejecuta antes de publicar esta corrección.
