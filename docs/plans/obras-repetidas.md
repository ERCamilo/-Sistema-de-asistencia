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
| **Fusión de dos obras** | **Pendiente** (siguiente entrega) |

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

## La fusión (pendiente) — decisiones ya tomadas

- **No reutilizar `MAP_TO_EXISTING`**: el motor de reparación conserva a propósito
  la asistencia con obra válida como historia de su obra de origen. La fusión
  debe reescribir `projectId` de empleados, puestos, líderes y asistencia
  (lo que hace `adoptProject`), dentro de la misma transacción, aislamiento y
  propagación a la nube que ya usa `applyOwnershipRepair` → acción nueva
  `MERGE_PROJECT` en ese motor.
- Después de mover, las personas repetidas se resuelven con la pantalla existente
  «Duplicados» (`mergeDuplicateEmployees`), que ya une préstamos, abonos y
  asistencia por id.
- La obra retirada queda como lápida con `mergedIntoId` (como los empleados), y un
  dispositivo atrasado la adopta al recibirla (`adoptProject`). Hoy el alias
  `projectAliasesV1` se escribe pero nadie lo lee.
- Se **bloquea** si la obra sobrante tiene cierres de nómina (su id incluye
  `projectId`) o caja chica.
- Antes de fusionar: copia de seguridad automática (colección `snapshots`).
- Una obra activa o la inicial no se puede retirar tal cual: hay que cambiar de
  obra o conservar la inicial como destino.
- Fusiones simultáneas A→B y B→A: el destino se decide de forma determinista
  (la más antigua, luego el id) y se evitan cadenas y ciclos.
- Mini: si se retira una obra a la que Mini está vinculado, hay que desvincular y
  volver a vincular (decisión: aceptable, el SA es la fuente de verdad).
