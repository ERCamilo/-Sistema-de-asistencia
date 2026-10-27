# Prueba de lectura NFC desde SA

Rama de prueba: `test/nfc-web-reader`. No fusionar en main como parte de esta prueba.

## Cómo probar en el Samsung

1. Abrir la vista previa HTTPS de Cloudflare directamente en Chrome para Android, sin un navegador incrustado ni iframe.
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
- Chromium comprueba el modal real, controles y tamaños móviles con eventos NFC simulados.
- La lectura física y la igualdad del UID con el ESP32 requieren el teléfono y las tarjetas reales; ninguna prueba automática aquí sustituye esa verificación.

Siguiente paso: si la misma tarjeta entrega el mismo UID en ambos dispositivos, diseñar el contrato de asociación SA → webhook. Si no, evaluar tarjetas NDEF compatibles, Android nativo o registro desde el ESP32 antes de implementar asociaciones.
