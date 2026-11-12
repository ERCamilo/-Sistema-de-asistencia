# Prueba de lectura NFC desde SA

El lector comenzó en `test/nfc-web-reader` y se incorpora a main junto al MVP de asociaciones. La prueba de lectura sigue disponible de forma independiente en Ajustes → Pruebas; el [flujo de asociación](../integrations/nfc-webhook.md) se activa por separado.

## Cómo probar en el Samsung

1. Abrir SA por HTTPS directamente en Chrome para Android, sin un navegador incrustado ni iframe. Se puede probar tanto la vista previa como el sitio principal que incluya esta versión.
2. Activar NFC en el teléfono y mantener la pantalla desbloqueada.
3. Entrar en Ajustes. Si no aparece Pruebas, tocar siete veces seguidas la versión al pie de Ajustes para activar el modo desarrollador.
4. En Pruebas → Lectura NFC, pulsar **Probar lectura NFC** y después **Leer tarjeta**. Autorizar NFC cuando Chrome lo pida.
5. Acercar la tarjeta a la antena NFC del teléfono y mantenerla quieta. Se detiene después de una lectura o tras 30 segundos sin resultado.
6. Usar **Copiar resultado** o una captura y comparar el UID con el registrado por el ESP32. Ignorar espacios/dos puntos, conservar ceros iniciales y comprobar que coinciden todos los bytes.
7. Repetir con otra tarjeta y, si es posible, con una etiqueta NDEF conocida. Este control ayuda a distinguir un problema del navegador/teléfono de uno de las tarjetas.

## Cómo interpretar los resultados

- **Web NFC disponible:** existe la API; todavía no demuestra que la tarjeta pueda leerse.
- **UID leído:** la web obtuvo un serial hexadecimal. La prueba de compatibilidad con el sistema actual solo se completa cuando ese UID coincide con el del RC522 para la misma tarjeta.
- **Tarjeta detectada sin UID:** no usar contenido NDEF como sustituto del UID del RC522.
- **Sin lectura en 30 segundos:** no prueba por sí solo incompatibilidad. Revisar NFC, antena, autorización y una etiqueta de control.
- **API no disponible:** comprobar Chrome en Android y HTTPS. No se implementa lectura nativa Android ni acceso de bajo nivel a MIFARE Classic en esta prueba.

La prueba no escribe en la tarjeta, no guarda lecturas en localStorage/IndexedDB, no asocia empleados, no registra asistencia y no hace llamadas a webhooks. Solo muestra el UID, serial original y tipos de registros NDEF; no extrae el contenido de esos registros. Al cerrar/reintentar/detener o salir a segundo plano se libera el lector. Copiar el resultado es una acción explícita del usuario.

## Validación automática y límites

- Jest ejecuta el controlador real con un adaptador Web NFC simulado: UID, ausencia de UID, errores, timeout, reintentos, permisos tardíos, cierre y segundo plano.
- Chromium comprueba el editor y el modal reales a 320, 390, 768 y 1440 px con eventos NFC simulados: nombres con comillas, borradores conservados, reintentos de registro con la misma solicitud, consultas nuevas después de un conflicto y avisos de tarjeta ocupada/empleado con otra tarjeta.
- La lectura física y la igualdad del UID con el ESP32 requieren el teléfono y las tarjetas reales; ninguna prueba automática aquí sustituye esa verificación.

El usuario ya confirmó que su Samsung y el ESP32 entregan el mismo UID salvo separadores. El siguiente paso al entrar desde el sitio principal es activar las asociaciones en ese dominio y comprobar la consulta con el registro existente, siguiendo el contrato y la guía vinculados arriba. Otras combinaciones de teléfono/tarjeta siguen necesitando una prueba física.

Siguiente paso: si la misma tarjeta entrega el mismo UID en ambos dispositivos, diseñar el contrato de asociación SA → webhook. Si no, evaluar tarjetas NDEF compatibles, Android nativo o registro desde el ESP32 antes de implementar asociaciones.

## Evidencia visual de la issue #328 (28 de octubre de 2026)

La mejora de la issue #328 incorpora bloques de estado persistentes en el modal compartido. La prueba automatizada `npm run test:nfc-read` utiliza el editor real y respuestas **simuladas y correlacionadas** del webhook; no contacta a n8n ni lee tarjetas físicas.

- Se generan capturas `nfc-confirmed-<ancho>.png`, `nfc-same-owner-<ancho>.png` y `nfc-other-owner-<ancho>.png`, así como `nfc-enrollment-<ancho>.png` para la tarjeta disponible. Anchos: 320, 390, 768 y 1440 px.
- Se comprueban texto, SVG decorativo, región de estado accesible, ausencia de desbordamiento, visibilidad de los controles y ausencia de guardados cuando la tarjeta ya pertenece al mismo empleado o a otro.
- La asociación solo aparece como confirmada tras una respuesta válida del webhook simulado. Un error HTTP o una respuesta sin confirmar no genera éxito visual; los reintentos conservan el identificador y los datos de solicitud.
- La comprobación Axe de WCAG 2 A/AA y 2.1 AA se ejecuta para los cuatro estados y todos los anchos mencionados. Se corrigió el contraste del texto secundario en el aviso ámbar.
- Las comprobaciones reales de consulta, registro y conflictos se documentan separadamente en la issue #326 y en el PR #315. Esta evidencia de Chromium **no constituye por sí sola** una nueva prueba física ni de persistencia del webhook.

Comando de reproducción en un entorno con dependencias instaladas:
```bash
CHROMIUM_PATH=/ruta/a/chromium NFC_TEST_ARTIFACT_DIR=/tmp/sa-nfc-328-review npm run test:nfc-read
```

## Iconografía NFC (issue #328)

El botón de lectura en Ajustes → Pruebas, el botón de asociación del editor de empleados y el encabezado del diálogo reutilizan el mismo icono NFC regular SVG de Lucide, sin fuentes ni descargas de iconos en tiempo de ejecución. El icono es decorativo y conserva texto visible que describe cada acción. Chromium verifica su presencia en las tres ubicaciones y los tamaños de 320, 390, 768 y 1440 px.
