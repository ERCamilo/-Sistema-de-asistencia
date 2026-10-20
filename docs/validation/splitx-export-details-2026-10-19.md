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
