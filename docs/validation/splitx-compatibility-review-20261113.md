# Revisión SA → SplitX con el importador real

Revisión sobre PR SA #370 y `ERCamilo/SplitX` main `cf25627`. Se consultaron el contrato de SA, sus tres vías de exportación, `SplitXImport.js`, `SplitXSheetFields.js` y `SplitXBridge.js` actuales. La comprobación previa del bridge por sí solo no cubría la normalización monetaria ni la conservación de todos los campos nuevos.

| Requisito | Resultado |
| --- | --- |
| Mismas filas e importes al copiar, descargar y enviar | Verificado; se usa la misma proyección y hay regresión de las tres vías con `577.125`. |
| Obra, período, empresa, ficha textual, identidad estable | El receptor conserva los campos básicos y la ficha `00113`. |
| Pagador, exclusiones, personal pausado con trabajo | Verificado en la proyección y la UI de SA. No se incorporan ajustes entre líderes a pagos individuales. |
| Centavos compatibles | Corregido en SA: `577.125` → `577.13`; originales conservados y sin modificar nómina. |
| Días trabajados sin extras | Pendiente en SplitX: descarta `worked` y su campo «Días trabajados» usa `total`. En la prueba, SA muestra 1 día + 0.25 extra y SplitX presenta 1.25 como días trabajados. |
| Contexto del filtro y trazabilidad | Pendiente en SplitX: descarta `payrollFilter`, `positions[].leaderId`, bases/refs de cuotas y los nuevos metadatos monetarios. Los importes básicos sí se importan; no implica perder registros de SA. |
| Envío directo desde la vista previa | Pendiente en SplitX: rechaza el origen exacto `https://feat-payroll-in-payroll-filt.sistema-de-asistencia.pages.dev` con `origin_not_allowed`. La lista actual permite `https://asistencia.erlin.do`; importar el JSON manualmente no depende de esa lista. |

## Error reproducido y corregido

El normalizador de SplitX solo acepta dinero con dos decimales. Un cálculo válido con tarifa 112.50/h, 8 horas y 1 hora extra con factor 1.35 produce 1051.875 en SA; el receptor lo rechazaba con «Monto JSON inválido o ambiguo». El caso comunicado por el usuario, 577.125, presenta el mismo problema.

La corrección proyecta los campos monetarios compatibles a los centavos visibles en SA, conserva los valores originales como metadatos del JSON y suma los pagos proyectados. Si redondear cada pago difiere de redondear el total bruto del listado, SA lo muestra explícitamente. Se rechazan importes no finitos y netos negativos antes de que una conversión pueda ocultarlos como cero. No se registra ningún pago al exportar.

## Comprobaciones y límites

- Suite completa de SA tras la corrección: **724 suites / 7456 pruebas pasan**. Las regresiones cubren centavos, originales, diferencias de sumas y la igualdad de portapapeles/archivo/bridge. También pasan el recorrido de nómina en tres anchuras con el normalizador real actual y los controles existentes en cuatro anchuras.
- Suite actual de SplitX: 260 pruebas / 67 suites pasan. Esto no cubre automáticamente los nuevos campos de SA.
- Siete comprobaciones cruzadas con el exportador de SA y el normalizador/bridge reales de SplitX: confirman la aceptación del formato corregido y reproducen las incompatibilidades restantes. Que pasen estas comprobaciones de caracterización no significa que esos requisitos pendientes estén implementados.
- Chromium cargó la aplicación SplitX sin modificar, con datos ficticios y peticiones externas bloqueadas. Su importación JSON rechazó el original con tres decimales y aceptó el corregido `577.13`. El caso centesimal existente de `1237.50` también se importó, conservando ficha y neto. El bridge con normalizador real se ejercitó por separado y forma parte de la comprobación opcional del script de SA.
- Evidencia local de esta sesión: `/tmp/sa-splitx-review/` (logs, payloads ficticios, pruebas de caracterización y capturas). No se importaron nóminas privadas en un servicio externo. No se validó un envío entre los dominios desplegados.

## Siguientes pasos y responsables

La corrección se publica como **1.7.135**: reutilizar 1.7.134 impedía el aviso automático a sesiones que ya tenían esa versión. Pasan las 30 comprobaciones de versión, manifiesto e importes y el recorrido de actualización en navegador, incluida la conservación de IndexedDB y medios locales. Tras actualizar hay que generar de nuevo cualquier JSON exportado con el formato anterior; los archivos ya descargados no se actualizan.

1. **SA:** publicar la corrección de centavos del PR #370 y regenerar los JSON anteriores; no modificar las fórmulas de nómina.
2. **SplitX:** conservar `worked`, contexto del filtro y referencias de cálculo; preferir `worked` para «Días trabajados» sin cambiar el significado de `total`. Conservar los originales monetarios si se requiere auditoría tras importar.
3. **SplitX:** decidir y permitir el origen exacto de pruebas cuando corresponda; no abrir la lista a todos los dominios.
4. **Usuario:** validar un cuadre real, importando nuevamente el JSON generado por la versión corregida y comparando el total de pagos a centavos.
