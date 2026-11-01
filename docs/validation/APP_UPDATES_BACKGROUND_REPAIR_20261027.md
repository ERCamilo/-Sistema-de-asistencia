# Actualización preparada y reparación de interfaz — 2026-10-27

## Resultado
SA 1.7.114 prepara la nueva versión en segundo plano. Solo guarda, activa la copia preparada y recarga cuando la persona lo confirma. “Más tarde” conserva la sesión. El aviso automático espera a que la preparación termine; una búsqueda manual permite ver su progreso.

“Reparar interfaz” sustituye la limpieza destructiva desde Ajustes, incluida la acción antigua `clear-cache`. Guarda localmente, descarga una copia nueva aun cuando la versión sea la misma, verifica sus archivos y la activa antes de recargar. No desregistra el Service Worker ni borra IndexedDB, localStorage, fotos o comprobantes.

## Controles de integridad
- Consulta del catálogo: 8 s. Preparación completa en el cliente: 45 s, incluyendo getRegistration(), registration.update(), instalación y mensajes. Descarga del worker: 40 s.
- Guardado local previo: 15 s; activación y confirmación del worker: 10 s. Una respuesta tardía no inicia otra activación ni recarga.
- La preparación no guarda datos ni activa el worker. Usa una caché separada y comprueba catálogo, presencia de archivos y tipos JavaScript/CSS. Rechaza un fallback HTML recibido como código.
- Una descarga o escritura fallida elimina solo la candidata incompleta. Una instalación sin archivos críticos no sustituye al worker que funciona.
- Las ediciones pendientes y otros diálogos bloquean el guardado y se vuelven a comprobar antes de activar/recargar. Cerrar el diálogo cancela la operación.
- Las pestañas existentes conservan su copia de recursos mediante su identificador de cliente. La limpieza espera una confirmación de arranque y conserva las copias que todavía usan otras pestañas.
- La limpieza reconoce solamente recursos de interfaz del ámbito de SA; conserva medios desconocidos, incluso si un worker anterior los guardó dentro de una caché antigua de interfaz.
- “Recargar” permite volver a cargar después de guardar, sin prometer una versión nueva si la preparación falló. Sin conexión puede conservar la versión funcional actual.
- Las llamadas dinámicas a Firebase conservan su ruta de red. El guardado previo a recargar requiere éxito local y no depende de la nube.

El navegador puede terminar una descarga nativa de sw.js después del límite; no existe una API para abortar registration.update(). El cliente deja de esperarla y no activa por esa respuesta tardía.

## Validación en a2
- Jest completo en a2 (Node 24): **6.704 pruebas, 674 suites, cero fallos**. Después se añadió una prueba de regresión para el orden de mensajes que CI con Node 20 reveló; el resultado de la corrida completa actualizada queda en el PR.
- Chromium real con Service Worker: primera instalación, dos versiones, preparación sin recarga, aplazar/búsqueda manual, error y espera del guardado, descarga fallida, reintento con confirmación separada, sw.js retenido sin respuesta y recarga alternativa.
- Reparación real de la misma versión: CSS corrupto reemplazado, cantidad de registros del worker conservada, sentinelas de IndexedDB/localStorage, foto y comprobante intactos en cachés de medios y antigua de interfaz.
- Script de layout de Ajustes en Chromium: termina correctamente, sin desbordamiento y con guardado contextual. También informa avisos de contraste en otros controles de Ajustes; este resultado no certifica accesibilidad global de esa pantalla.
- Modo sin conexión, catálogo inválido, texto seguro, navegación Atrás y novedades en 320/390/820/1440 px con comprobaciones axe WCAG A/AA.
- Worker ejecutado en VM: otra pestaña conserva la copia anterior; la limpieza selectiva respeta sus archivos y medios hasta cerrar/confirmar.
- Pruebas de límites para consulta del registro, update(), mensajes, activación sin respuesta/cambio de estado y guardado bloqueado; cancelación y resultados tardíos.
- Regresión determinista del progreso tardío tras un error: falla sin la protección y pasa con ella. Las **38 pruebas del Service Worker (6 suites)** pasan con la protección. Los cuerpos de descarga pendientes ya no notifican progreso después de cancelar.
- `npm run build` y `npm run test:release`: correctos. Compilación de 452 módulos; manifiesto compilado de 26 entradas; los **40 recursos del shell de producción existen**.

Comandos reproducibles:
```sh
npm ci
npm test -- --runInBand
npm run build
npm run test:release
CHROMIUM_PATH=/snap/bin/chromium npm run test:app-updates
CHROMIUM_PATH=/snap/bin/chromium npm run test:settings-layout
```

Los registros de esta sesión están en `/tmp/sa-background-updates-complete-20261027.{json,log}` y `/tmp/sa-background-updates-browser-final-racefix-20261027.log` de a2.

## Alcance
La rama parte de main `c3d780ba`; el cambio concurrente del test de Voz se conserva.

Estas pruebas usan Chromium automatizado y datos sintéticos. No certifican dispositivos físicos, autenticación real ni una actualización ya desplegada. No se modifican reglas ni datos de Firebase/Supabase. Una pestaña que siga ejecutando el actualizador antiguo deberá cargar esta entrega una vez para disponer del nuevo flujo.
