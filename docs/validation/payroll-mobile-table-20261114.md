# Revisión compacta de nómina

La ficha y el nombre estaban fijados a la izquierda. En un teléfono ocupaban casi todo el ancho visible y podían cubrir el neto aunque la tabla se desplazara. Se reprodujo en Chromium a 320 px.

La versión 1.7.143 mantiene fija una ficha compacta de 44 px con las iniciales del empleado en móvil/tablet (hasta 900 px). El nombre completo y los demás campos se desplazan dentro de la tabla. Se reducen los márgenes del panel de revisión. En móvil se elimina el mínimo genérico de 600 px, se limita la columna de empleado a 132–164 px y se ajusta el relleno: las filas simples miden 53 px, con área táctil de 44 px. Los nombres largos pueden crecer en varias líneas. Escritorio conserva las dos columnas de identidad fijas. La tabla se recorre con el desplazamiento horizontal nativo, sin botones auxiliares Empleados/Importes.

Líder e Incluir permanecen juntos. Incluir conserva sus tres modos y el valor predeterminado En nómina. Filtros muestra u oculta el contador y la selección de empleados; el botón señala si hay selección o exclusiones activas. Plegar los controles no borra la selección. Los selectores y botones forman una cuadrícula alineada: dos filas en móvil, una en escritorio. El contador y el interruptor de selección quedan en un panel compacto; el botón Filtros señala visualmente si hay filtros activos y expone aria-expanded/aria-controls. Ambos flujos (con obras y sin ellas) usan la misma barra.

Compartir abre un modal que llama a las funciones originales: Abrir en SplitX, Copiar JSON, Exportar PDF y Descargar JSON. Antes de ejecutar compara la obra, período, líder, modo, filas y ajustes de líder con lo que estaba vigente al abrir el modal. Si cambia, muestra un error y pide abrirlo de nuevo. Se conservan los bloqueos de importes inválidos. Si un líder solo tiene descuentos por personal pagado en otra nómina, sigue disponible el PDF original, sin habilitar transferencias de empleados vacías. Ninguna acción registra pagos.

La columna Días de pago muestra equivalencias con los factores aplicados a cada tramo del cálculo existente: 8 horas normales y 2 extra a 1.5, en jornada de 8 horas, muestran 1.375; 8 festivas a factor 2 muestran 2. Las tarifas calculadas de cada tramo tienen prioridad sobre la configuración general. El resumen de días trabajados y los campos workDays exportados mantienen su significado previo. No se recalculan salarios ni se reescriben asistencias.

El monto neto ofrece un chevrón y un contador de tramos. Despliega una tarjeta mediante el mecanismo existente de detalles de la fila y elimina la columna DESGLOSE. La tarjeta conserva el cálculo por puesto en días y muestra los importes ya calculados de bruto, bonificaciones, deducciones, préstamos y neto. Funciona incluso en pagos de ajustes sin trabajo registrado (contador 0). Abrir/cerrar conserva el foco y la posición de la celda; al estar en el extremo derecho se mantiene ese extremo si la tarjeta cambia la distribución de columnas.

En móvil se oculta la barra inferior Atrás/Continuar del asistente. Los cinco pasos superiores continúan disponibles; la navegación de escritorio y los botones propios de otros modales se conservan.

## Verificación reproducible

- `npm test -- --runInBand`: suite completa, incluidas las pruebas independientes de equivalencias de pago y las expectativas monetarias anteriores.
- `PAYROLL_FILTER_ARTIFACT_DIR=/tmp/sa-payroll-compact-browser npm run test:payroll-filter`: Chromium a 320/390/1280 px, neto visible y con hit test tras desplazar, ficha/iniciales compactas, filtros adyacentes, modos de inclusión, tarjeta dentro del ancho visible, foco/teclado y JSON idéntico. Verifica las cuatro acciones de Compartir (PDF con documento simulado), rechazo del modal desactualizado, PDF para un líder sin empleados propios, paridad con el flujo sin obras y datos conservados. También comprueba días de pago 1.375 y total 2.375, manteniendo workDays.worked=1 y overtime=0.25 para el primer empleado. Genera capturas reales con empleados ficticios, sin autenticación ni operaciones remotas.
- `CHROMIUM_PATH=/usr/bin/chromium npm run test:payroll-controls`: selección de personal, filtros, préstamos, columnas alineadas y alcanzables a cinco anchuras (320/390/768/1024/1440); conserva los controles de pagos y los footers de sus modales.
- Las comprobaciones en navegador incluyen WCAG A/AA mediante axe sobre las secciones modificadas, una vez terminada la animación del modal.
- `npm run build`, `npm run sw:precache`, `npm run lint:state`, `npm run test:release`.

Las pruebas de navegador usan Chromium y datos ficticios. Queda verificar el gesto de desplazamiento en Safari/iOS y en el teléfono del usuario.

Siguientes pasos: agente SA completa PR/CI y mantiene la misma vista previa; usuario evalúa tabla, Filtros y Compartir en su teléfono; agente SA atiende los resultados antes de integrar en main.
