# Obras repetidas

Dos dispositivos de la misma cuenta pueden crear «la misma obra» sin conexión:
ids distintos (`PRJ-…`) y, a veces, nombres distintos, así que el aviso de
nombre repetido no salta y las dos obras quedan en el catálogo (`projectsV1`,
unión por id). Esta función detecta esos pares y los muestra para revisarlos.

## Estado

| Pieza | Estado |
|---|---|
| Detección por personal y asistencia (`ProjectSimilarity`) | Hecha |
| «No son la misma» persistente y sincronizado (`notSameAs`) | Hecho |
| Resumen y diferencias por par (`ProjectDuplicateReview`) | Hecho |
| Pantalla «Obras repetidas» (`ui/ProjectDuplicatesScreen`) | Hecha, tras bandera |
| Plan de fusión puro y que falla cerrado (`ProjectMergePlan`) | Hecho |
| Acción `MERGE_PROJECT` en el motor de reparación (una transacción) | Hecha |
| Servicio (copia de seguridad, obra activa, aviso) y comprobación previa | Hechos |
| Lápida `mergedIntoId` y adopción en dispositivos atrasados (`ProjectCatalogSync`) | Hechas |
| Paso «Unir en una sola obra» en la pantalla | Hecho, tras bandera |
| Caja chica: las cajas de la obra retirada pasan a la obra destino | Hecho |
| Dirección consciente de bloqueos (conserva la obra con cierres) | Hecho |
| Blindaje al crear: revisar el catálogo de otros dispositivos antes de crear | Hecho (visible, sin bandera) |
| Probado con dos dispositivos reales y datos reales | **Pendiente** |

La entrada (Ajustes → Proyectos) está detrás de la bandera
`asistencia_feature_project_duplicates` (apagada por defecto) y solo avisa si hay
pares sospechosos. Para probarla en un dispositivo:

```js
localStorage.setItem('asistencia_feature_project_duplicates', 'true');
```

## Cómo se decide que dos obras parecen la misma

- Se compara el **personal** de cada obra. Una persona es «la misma» si coincide el
  nombre (sin acentos, mayúsculas ni orden) y, con un solo nombre, también la
  ficha. Una misma ficha con otro nombre son personas distintas. Se empareja
  primero nombre y ficha iguales y después solo el nombre.
- Parecido = coincidentes / unión: **idéntica** desde 0,9, **parecida** desde 0,6,
  con al menos 2 personas en común (o todo el personal de la obra más pequeña con
  un nombre de obra parecido).
- La **asistencia** es evidencia, no veredicto: mismos días en las dos obras
  (`shared`), fechas intercaladas, fechas seguidas (lo normal con un dispositivo
  atrasado) o separadas por más de 30 días (`separated`: etapas distintas de una
  misma cuadrilla; baja un nivel la sugerencia).
- Se ignoran obras vacías, cerradas, archivadas o borradas y empleados borrados.

## «No son la misma»

Se guarda en el documento de la obra de id menor (`notSameAs`), viaja con el
catálogo y se **une** entre dispositivos (un descarte hecho en un dispositivo
atrasado no se pierde). `Project` conserva el campo al editar la obra.
Limitación conocida: no hay «volver a sugerir»; con unión de listas, quitar un
descarte reaparecería desde otro dispositivo (haría falta registrar revocaciones).

## Cómo funciona la fusión

Fusionar B (se retira) en A (se conserva) es un **cambio de dueño**, no una copia:
los ids de empleados, puestos, líderes y asistencia no cambian, solo su obra.

1. **Comprobación previa** (`checkProjectMerge`): el mismo plan que usa el motor,
   sin escribir. La pantalla muestra los bloqueos antes de dejar confirmar.
2. **Copia de seguridad** (`createFirebaseSnapshot('pre-restore', 'pre-fusion-obras')`).
   Si falla, no se fusiona nada.
3. **Motor** (`applyOwnershipRepair`, acción `MERGE_PROJECT`): una sola transacción de
   IndexedDB con aislamiento de guardados, memoria de la app actualizada solo en los
   campos que cambian (no pisa ediciones sin guardar) y cola hacia la nube.
   Cambia `projectId` de empleados, puestos, líderes y asistencia, y de los préstamos,
   adelantos, bonos, deducciones, acuerdos y pagos manuales de esas personas. Retira B
   con lápida (`deletedAt` + `mergedIntoId`), renombra A si se pidió, y deja constancia
   en el historial de reparaciones (`fromProject`/`intoProject`: no usar
   `sourceProjectId`/`targetProjectId`, porque ProjectUsage los contaría como referencias
   vivas y dejaría las obras «en uso» para siempre).
4. Si B era la obra activa, se cambia a A. Se avisa al catálogo (`projects:setup-changed`)
   para que publique la lápida.
5. Las personas que están en las dos obras quedan repetidas dentro de A: se unen con la
   pantalla «Duplicados» existente (`mergeDuplicateEmployees`), a la que lleva el resumen.

### Caja chica

Una caja solo guarda un vínculo opcional a la obra (`officialProjectId`); sus períodos y
movimientos no guardan la obra de forma canónica (contrato F1.7). La fusión repunta el
vínculo de las cajas de B a A y lo encola hacia la nube (`pettyCashOutbox`, mismo
mecanismo que la reasignación manual); no toca períodos ni movimientos. Las cajas de B
aparecen bajo A junto a las de A. Un cambio de caja pendiente de sincronizar que mencione
a B bloquea la fusión hasta que se envíe.

### Cierres de nómina: la dirección importa

Un cierre es una foto del dinero y su id incluye la obra, así que no se reetiqueta. Una obra
duplicada por un dispositivo atrasado casi nunca tiene cierres (cerrar nómina es deliberado
y se hace en la principal), así que la pantalla comprueba las dos direcciones: si la
sugerida está bloqueada y la inversa no, **invierte sola** (conserva la obra con cierres) y
lo explica. Solo queda bloqueada si **las dos** tienen cierres. Para ese caso, la opción
estudiada es recuperar los cierres en la obra destino con la recuperación financiera
existente (copia con `recovery.sourceId`, original conservado, cerrojo en la nube
`payrollClosureClaims`); se hará cuando aparezca un caso real. Archivar la obra retirada
en lugar de borrarla no sirve: las cuentas de préstamos se filtran por obra y quedarían
escondidas para la persona.

### Falla cerrado

El plan solo reescribe la clave `projectId`. Después comprueba que B queda **vacía** con
la misma contabilidad que usa el borrado de obras (`summarizeProjectUsage`). Si no,
no cambia nada y explica por qué. Se bloquea con: cierres de nómina (su id incluye la
obra), caja chica, cambios sin sincronizar que mencionan B (outbox), pagos enlazados a
un cierre de nómina, referencias que no sabe mover (`sourceProjectId`, `payrollProjectId`,
anidadas en puestos/líderes/asistencia), otros registros que apuntan a B, cambios sin
guardar en memoria, B activa fuera de lugar (inicial) o nombre repetido. La obra inicial
nunca se retira: se conserva como destino.

### Dispositivos atrasados

La lápida de B lleva `mergedIntoId`. Al recibirla, un dispositivo que aún tenga datos
bajo B ejecuta la misma acción en modo `adopt` (sin tocar el catálogo) y la lápida
queda en su sitio. Si no se puede (cierres, cambios sin guardar…), la protección de
borrados deja B visible y señalada y no se pierde nada. Las cadenas nunca pasan de un
salto: al fusionar A en C, las lápidas que apuntaban a A pasan a apuntar a C. Dos
dispositivos que fusionan en sentidos opuestos a la vez dejan ambas obras visibles y
señaladas (protección de borrados) en lugar de perder datos.

## Límites conocidos

- **Puestos repetidos**: se mueven tal cual. Si las dos obras tenían un puesto con el
  mismo nombre, A queda con dos. No se fusionan por nombre todavía.
- **Cierres de nómina** en las dos obras bloquean la fusión (ver arriba).
- **Configuración de nómina de B**: A conserva la suya; la de B queda huérfana.
- **Mini**: si Mini estaba vinculado a B (`saProjectId`), hay que desvincularlo y
  volver a vincularlo; las bandejas y consolidaciones de Mini guardadas por `saProjectId`
  de B no se reasignan. Decisión: aceptable, SA es la fuente de verdad.
- **«Volver a sugerir»** no existe: con unión de listas, quitar un descarte
  reaparecería desde otro dispositivo (haría falta registrar revocaciones).
- La asistencia no se fusiona día a día: cada registro conserva su clave
  `empleado-fecha`, y la unión de personas repetidas (con su asistencia) la hace
  «Duplicados».

## Blindaje: que no se generen copias

Resolver duplicados es la red de seguridad; lo mejor es que no nazcan. Se refuerza por capas:

1. **Hecho — revisar antes de crear.** `createEmptyProject` pone al día el catálogo (hasta
   4 s) antes de comprobar el nombre. Una obra del mismo nombre creada en otro dispositivo se
   rechaza al crear. Sin conexión se crea igual y se avisa («No se pudieron revisar tus otras
   obras… te avisaremos al sincronizar»).
2. **Hecho (tras bandera) — aviso en el encabezado.** Un botón con insignia numérica junto al
   de empleados duplicados (`SystemAlertsManager`) cuenta los pares sospechosos y abre la
   pantalla «Obras repetidas». Se recalcula cuando cambia el catálogo (`projects:setup-changed`,
   `projects:created`, `app:ready`; con 400 ms de agrupación) y, como mucho cada 30 s, en los
   repintados. Al cerrar la pantalla se vuelve a calcular. Solo con la bandera encendida.
3. **Hecho — «¿ya existe?» al crear.** El formulario lista las obras que ya tienes (hasta 6 y
   «y N más») y avisa, al escribir, si el nombre ya está en uso (sin importar mayúsculas ni
   espacios). No bloquea: decide `createEmptyProject`.
4. **Idea — pre-detección por personal.** Cuando una obra nueva reciba empleados que ya
   existen en otra obra, sugerir unir antes de que se acumulen datos.
5. **Idea — ids deterministas por nombre.** Dos dispositivos que crean «Torre Norte» sin
   conexión generarían el mismo id y el catálogo (unión por id) los uniría solo. A evaluar:
   colisión con lápidas de obras borradas con ese nombre, renombres y el formato `PRJ-…`.
