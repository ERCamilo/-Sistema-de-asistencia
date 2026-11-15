# Tabla de nómina móvil: columnas accesibles

La ficha y el nombre estaban fijados a la izquierda. En un teléfono ocupaban casi todo el ancho visible y podían cubrir el neto aunque la tabla se desplazara. Se reprodujo en Chromium a 320 px: el neto quedaba tapado al llegar al extremo derecho.

La versión 1.7.140 mantiene fija una ficha compacta de 44 px con las iniciales del empleado en móvil/tablet (hasta 900 px). El nombre completo y los demás campos se desplazan dentro de la tabla. La ayuda «Desliza para ver días e importes» y los accesos Empleados/Importes permiten volver al inicio o llegar al neto. Escritorio conserva las dos columnas de identidad fijas. Se reducen los márgenes del panel de revisión en móvil.

Los accesos de navegación únicamente desplazan el contenedor, conservando foco, casillas, detalles, filtros y datos. Respetan la preferencia de movimiento reducido. Incluir aparece como desplegable junto a Líder, con los mismos modos y el mismo valor predeterminado En nómina.

El monto neto ofrece un chevrón y un contador de tramos de trabajo. Despliega una tarjeta mediante el mecanismo existente de detalles de la fila y elimina la columna DESGLOSE. La tarjeta conserva el cálculo por puesto en días y muestra los importes ya calculados de bruto, bonificaciones, deducciones, préstamos y neto. Funciona incluso en pagos de ajustes sin trabajo registrado (contador 0). Abrir/cerrar conserva el foco y la posición de la celda; al estar en el extremo derecho se mantiene ese extremo si la tarjeta cambia la distribución de columnas. No modifica cálculos ni exportación.

La regresión en navegador comprueba que el neto sea visible y reciba el hit test después de desplazar, una ficha con iniciales menor al 25 % del área visible, los accesos con teclado/ratón, movimiento reducido y vuelta a empleados. Comprueba que la tarjeta quepa, que el neto siga entero al abrirla y que ambos selectores compartan fila y mantengan los modos de exportación. Verifica identidad del nodo al navegar, JSON idéntico y datos conservados. Las pruebas de jornadas, líderes y tarifas abren ahora el cálculo desde el neto y conservan sus importes esperados. Se usan datos ficticios; no se registra ninguna operación.

Siguientes pasos: agente SA completa pruebas, PR y CI; usuario prueba el desplazamiento y los accesos en su teléfono; agente SA atiende resultados e integra según la revisión habitual.
