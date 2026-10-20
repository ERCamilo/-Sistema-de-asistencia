# Exportación SplitX: validación

- Base: `origin/main` 0b00c0c4.
- Suite Jest completa con Node 20 y dos workers: **6.139 pruebas / 634 suites**, todas aprobadas, cero omitidas. Incluye conceptos porcentuales/fijos, cuotas, precisión monetaria, no mutación, días proporcionales y varios puestos, filtros/categorías, jornada de obra distinta de la global, aislamiento entre obras y equivalencia entre portapapeles/descarga/puente.
- Las pruebas del contrato fallaron antes de existir el exportador; las de integración fallaron antes de conectarlo a los tres puntos de salida.
- Se eliminó el condicional que permitía omitir silenciosamente las aserciones del payload SplitX en `PayrollScopedAdjustmentsFocal.test.js`. Ahora se despacha READY y se comprueba el mensaje real emitido por SA.
- Guard de escrituras: sin deuda nueva.
- Build de producción: 418 módulos empaquetados, 3.023.654 bytes, 25 assets de precache del build. Precache fuente actualizado: 440 assets, incluido PayrollSplitXExport.
- Chromium de sistema: se cargó el exportador empaquetado en una página local vacía con los módulos reales; el ejemplo ficticio produjo 10 jornadas, neto 9700 y dos descuentos separados (ley -300 / reparación -500). Cuatro horas con jornada de ocho produjo 0.5 días. Esa ejecución generó el JSON de ejemplo publicado con el contrato.

Registros locales: `/workspace/.cloud-setup/splitx-export-{red,wiring-red,focused,full,build,state-guard}.log`, `splitx-export-jest.json`, `splitx-export-chromium.json`.

## Límites

La comprobación Chromium ejecuta el exportador, no el flujo completo del sitio SplitX. Las pruebas del puente simulan ventanas y respuestas; no se enviaron datos a un receptor externo. Falta adaptar/verificar SplitX y hacer una prueba real entre ambas aplicaciones. Se conserva el protocolo de transporte y sus limitaciones para una entrega posterior. El nombre de obra puede quedar vacío si la vista no lo proporciona; el ID y el período sí se exportan en modo por obra. Los líderes reflejan el catálogo al exportar, sin reconstruir un historial separado.

No cambian pagos, cierres, cálculos salariales, datos persistidos, ni esquema de empleados/asistencia. Los importes originales siguen intactos. No se incorpora un ID de nómina; el período no basta por sí solo para resolver duplicados.

## Ampliación de empresa y etiqueta del período

Base `origin/main` c9c7518e, después de integrar #273. Se añadieron `companyName` desde Ajustes/General y `payrollName` con el formato «Nómina período DD/MM/YYYY - DD/MM/YYYY». Las comprobaciones de portapapeles/archivo/puente y modo por obra fallaron antes de conectarlos y pasaron después. También se verificó un período que cruza de año y una empresa sin configurar.

Suite completa: **6.140 pruebas / 634 suites**, todas aprobadas, cero omitidas. Build de producción: 418 módulos, 3.023.846 bytes y 26 assets de precache. Guard de escrituras y precache fuente aprobados. Registros locales: `/workspace/.cloud-setup/splitx-company-{red,focused,full,build,state-guard}.log` y `splitx-company-jest.json`. La presentación de los nuevos campos en el receptor SplitX sigue pendiente de integración.

## Ampliación del 20/10: tarifa diaria y préstamos

- `positions[].dailyRate` procede de la tarifa aplicada en el desglose y la jornada de la obra. Pruebas: sueldo individual real de la obra, jornada distinta de la global, dos medias jornadas con distintas tarifas, posición histórica frente al catálogo actual y tarifa no disponible (`null`).
- Se ejercitaron «todo», «solo interés», «otro monto», cero, límite de abono, cuotas y varios préstamos con pagos previos. Préstamos no seleccionados solo participan en la deuda total informativa. Las categorías desmarcadas no se descuentan. Abonos de períodos ya pagados se marcan `recorded`, conservan referencia y saldo actual y no generan una segunda proyección del pago.
- El test del archivo descargado incluye un abono de 500 sobre 3.000; el de portapapeles/puente comprueba tarifa aplicada y los mismos datos de abono y saldo. Se mantiene el contrato base de `toSplitXRows` y se verifica que exportar no crea pagos ni modifica el registro de préstamos.
- Pruebas nuevas antes de implementar: 13 fallos en los campos faltantes. Suite focal final: **52 pruebas**, aprobadas. Suite completa Node 20, dos workers: **6.156 pruebas / 635 suites**, aprobadas, cero omitidas.
- Build: 418 módulos, 3.025.572 bytes y 26 assets. Guard de escrituras y precache fuente aprobados.
- Chromium ejecutó el exportador real y generó el ejemplo actualizado: tarifa diaria 1.000, 10 jornadas, bruto 10.000, bonificación 500, descuentos 800, abono de préstamo 500, neto 9.200; deuda previa 3.000 → saldo proyectado 2.500. Se comprobó la igualdad de los datos canónicos antes/después. No se enviaron datos a SplitX.

Registros locales: `/workspace/.cloud-setup/splitx-rates-loans-{red,focused,wiring,full,build,state-guard}.log`, `splitx-rates-loans-jest.json` y `splitx-rates-loans-chromium.json`. Sigue pendiente adaptar y probar el receptor SplitX. El reparto histórico y saldo anterior de abonos ya registrados no se reconstruye: se exportan como `null` cuando la vista no los proporciona, con proyección deshabilitada.
