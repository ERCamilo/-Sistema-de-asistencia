# Personal recibido de Mini

Contrato y flujo: `.sdd-review/send-employees-to-sa/spec.md` en Mini. SA recibe `mini-roster-proposal/v1` por el canal autenticado, mantiene una revisión por obra/dueño y exige decisiones antes de modificar el personal. La asistencia mantiene su revisión separada; el vínculo confirmado por SA identifica al empleado en envíos posteriores.

Se reutilizan transporte fragmentado, normalización de fichas/nombres y conversión salarial. Empleados, puestos y vínculos se guardan localmente juntos antes de devolver `mini-roster-result/v1`. Los campos de contacto son opcionales; el salario tiene unidad diaria explícita. Se conserva un registro de propuestas resueltas para reintentos tras una desconexión. Verificar reenvíos, datos obsoletos, conflictos concurrentes y fallos locales; publicar ambos PR sin fusionar.

## Uso

Con ambos clientes actualizados, abiertos y vinculados, Mini ofrece **Enviar personal** junto al SA. SA ofrece **Recibir personal** junto al Mini. Mini confirma el nombre de la obra de destino y los empleados; transmite nombre, ficha, puesto principal, salario por día en DOP y contacto opcional.

En **Personal recibido para revisar**, SA permite corregir ficha/contacto, elegir o crear puesto, revisar fecha de ingreso, crear o vincular, aceptar algunas filas o dejarlas pendientes. Las coincidencias por ficha o nombre se sugieren sin fusionar. Vincular conserva los datos de SA salvo actualización explícita; un empleado pausado exige confirmar reactivación. **Resolver duplicados en SA** abre la herramienta existente de mantenimiento. La ficha ocupada debe resolverse antes de crear; dos fichas Mini no se vinculan al mismo SA en una misma aceptación.

El salario diario se convierte usando la jornada de la obra; queda como salario individual. Reutilizar un puesto no cambia su tarifa general. La fecha de ingreso y el historial de activación siguen las reglas de las altas directas. Desde una asistencia desconocida, **Registrar empleado desde Mini** abre este flujo; el vínculo confirmado permite identificar esa fila, pero no aprueba sus horas.

## Persistencia y recuperación

- La propuesta está ligada al par, obra y dueño local. Los empleados, puestos y vínculos se confirman en una sola transacción de IndexedDB. Fallar cualquiera de esas escrituras aborta todas.
- La bandeja y sus decisiones se conservan en el dispositivo SA receptor, separadas de los empleados canónicos. Son hasta 12 propuestas pendientes y 60 resueltas/descartadas. Los datos aceptados se publican por la sincronización normal; enviar una respuesta no confirma sincronización con la nube ni recepción final en Mini.
- Reenviar conserva la propuesta cuando no cambiaron los datos Mini. La resolución se recupera tras perder la respuesta, incluso con un nuevo requestId. Los vínculos durables previenen repetir altas en propuestas posteriores. Un descarte libera la propuesta, conserva altas previas y permite preparar un nuevo envío.
- Mini aplica vínculos a registros existentes, sin sustituir su lista ni cambiar IDs locales. Rechaza cambios locales posteriores al envío, fichas ocupadas y vínculos SA compartidos con otra ficha local. Conserva asistencia, obra/cuadrilla y puestos adicionales; sólo se transmite el puesto principal en esta versión.
- Cambios de cuenta, obra, jornada o catálogo invalidan la revisión. Se vuelve a abrir antes de aceptar; una fila aceptada no se vuelve a editar en esa propuesta.

## Publicación

PRs separados hacia main, sin fusionarlos. Publicar primero la recepción SA y luego Mini, y actualizar ambas PWAs. Los flujos anteriores de SA→Mini, asistencia y respaldos mantienen sus contratos. Validación reproducible en `../validation/mini-employee-intake-2026-10-14.md`.
