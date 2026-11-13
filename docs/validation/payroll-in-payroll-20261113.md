# «En nómina», días y exclusiones manuales

Al cambiar el líder en la revisión de nómina, se selecciona **En nómina**. Este modo conserva solo los tramos que paga ese líder, aunque el puesto pertenezca a otro equipo. Usa el pagador registrado en cada tramo; para datos antiguos sin asignación individual, el líder del catálogo. Los ajustes personales fijos y los cobros de préstamos se atribuyen a un solo pagador, también cuando no hay trabajo en el período.

Se conservan las vistas explícitas «Todos sus puestos» y «Solo puestos de…». La primera mantiene su alcance amplio anterior para registros antiguos; para preparar pagos por líder se usa «En nómina».

La casilla de cada empleado lo excluye únicamente del reporte/exportación actuales. Su fila queda visible y tachada, con «Excluido de esta nómina», y se puede reactivar individualmente o con «Restablecer». Las exclusiones tienen clave de obra, período y líder; no se borran fichas ni asistencias y no se cambia `employee.active`. La selección existente «Solo empleados seleccionados» continúa disponible y se combina con las exclusiones.

Los totales de pantalla, PDF, JSON y envío a SplitX parten de las mismas filas incluidas. El ajuste de personal pagado por otros líderes conserva su resumen completo, se identifica como tal en una vista parcial y no se convierte en un pago individual. Una vista con exclusiones no permite confirmar ni cerrar la nómina completa.

## Días y compatibilidad con SplitX

«Días» significa horas ordinarias + horas de feriado + horas de descanso, divididas por la jornada configurada de la obra. Por ejemplo, 4/8 = 0.5. Un feriado trabajado de 8 horas sigue siendo un día trabajado, aunque su tarifa se multiplique. Las horas extra se muestran aparte y siguen en el desglose; no aumentan los días trabajados.

SplitX conserva el contrato `sa-splitx-payroll/v1` y su array de empleados. Se añaden `workDays.worked` (mismo valor que la tabla) y `exportContext.payrollFilter` (líder, modo, indicador de reporte parcial y número de exclusiones). `workDays.total` conserva su significado previo, que incluye las horas extra convertidas a fracción de jornada; sus categorías y los importes no cambian. El receptor actual puede ignorar los campos adicionales. No se añaden empleados negativos ni ajustes entre líderes al dinero a repartir.

## Comprobaciones

Resultado local: **722 suites / 7433 pruebas Jest pasan**. Pasan los controles existentes de nómina en cuatro anchuras y el nuevo recorrido a 320/390/1280 px, incluida la comprobación WCAG A/AA y el bridge local de SplitX. El build de producción y el control de escrituras a estado pasan sin deuda nueva.

```sh
npm test -- --runInBand
CHROMIUM_PATH=/usr/bin/chromium npm run test:payroll-controls
CHROMIUM_PATH=/usr/bin/chromium npm run test:payroll-filter
npm run build
npm run lint:state
npm run test:release
```

`test:payroll-filter` usa la UI real, con empleados ficticios y Firebase sustituido. Bloquea las peticiones externas y comprueba 320/390/1280 px, casillas reales, foco, aislamiento por líder/período, restauración, salarios de puestos ajenos, horas extra, totales y paridad entre JSON copiado y `postMessage`. A 390 px ejecuta axe con WCAG A/AA. Sus capturas y un payload de ejemplo quedan en `/tmp/sa-payroll-in-payroll`.

Opcionalmente, `SPLITX_REPO_ROOT=/ruta/a/SplitX npm run test:payroll-filter` también entrega el payload al módulo real `js/SplitXBridge.js` del checkout indicado, con sus validaciones de protocolo. La comprobación local se ejecutó con esta opción; el receptor aceptó el array y devolvió `SPLITX_IMPORT_SUCCESS`. Esto comprueba el bridge, no una transferencia a la web de producción ni su interfaz de distribución de efectivo.

Para aceptación, comparar un líder pagador con un empleado prestado, excluirlo y restaurarlo; comprobar neto, días y empleados en la importación de SplitX. Repetir cambiando de líder y de período. Responsables: desarrollo mantiene las pruebas; el usuario valida el cuadre con sus datos antes de integrar/publicar.
