# Tabla de nómina móvil: columnas accesibles

La ficha y el nombre estaban fijados a la izquierda. En un teléfono ocupaban casi todo el ancho visible y podían cubrir el neto aunque la tabla se desplazara. Se reprodujo en Chromium a 320 px: el neto quedaba tapado al llegar al extremo derecho.

La versión 1.7.139 mantiene fija solo una ficha compacta de 44 px en móvil/tablet (hasta 900 px). El nombre y los demás campos se desplazan dentro de la tabla. La ayuda «Desliza para ver días e importes» y los accesos Empleados/Importes permiten volver al inicio o llegar al neto. Escritorio conserva las dos columnas de identidad fijas. Se usa el HTML y las operaciones originales; no se duplican filas ni se reducen los textos para encajar toda la tabla.

Las acciones únicamente desplazan el contenedor, conservando foco, casillas, detalles, filtros y datos. Respetan la preferencia de movimiento reducido. No modifican cálculos ni la exportación.

La regresión en navegador comprueba que el neto sea visible y reciba el hit test después de desplazar, una ficha fija menor al 25 % del área visible, los accesos con teclado y ratón, movimiento reducido y vuelta a empleados. También verifica la identidad del nodo de tabla, JSON exportado idéntico y datos de empleados/asistencia conservados. Se usan datos ficticios; no se registra ninguna operación.

Siguientes pasos: agente SA completa pruebas, PR y CI; usuario prueba el desplazamiento y los accesos en su teléfono; agente SA atiende resultados e integra según la revisión habitual.
