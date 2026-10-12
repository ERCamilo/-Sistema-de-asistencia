# Modal de audio y diagnóstico del webhook

El modal posterior a la captura usa los mismos tonos celestes de la navegación
central y del micrófono: fondo azul oscuro, forma de onda cian, duración y botón
Enviar celeste. Conserva el reproductor, el audio local y el requestId.

Opciones de audio tiene dos accesos:

- **Webhook activo**: restaura la URL predeterminada del workflow.
- **Webhook de prueba**: selecciona
  `https://n8n.erlin.do/webhook-test/sa-voice-v1-dev`.

La preferencia continúa siendo local por cuenta. No se modifica ni registra
una grabación por cambiar de endpoint. En n8n se debe activar «Escuchar evento
de prueba» para usar su ruta temporal. La configuración de CORS/proxy también
debe permitir esa ruta; esta entrega configura el cliente, no modifica n8n.

Los errores muestran el estado HTTP, el código y el mensaje recibido, tanto
con el envelope `error` como con las respuestas directas de n8n y los errores
de texto plano del proxy. Una respuesta HTTP 200 con `ok:false` también se
muestra como error. No se vuelcan páginas HTML ni se conservan tokens/audio
que el servidor pudiera devolver en el mensaje. Continúan la renovación de
sesión en 401, Retry-After en 429 y la conservación del borrador.

La transcripción del préstamo aparece fuera de Más opciones, en un panel
oscuro con texto claro y editable. La pronunciación también conserva contraste.
Las reglas, cálculos y confirmación de préstamos no cambian.

Validación:

- 75 pruebas en cuatro suites: transporte, errores, presets, almacenamiento y
  flujo de voz. Incluye identidad de grabación al cambiar de webhook.
- Chromium: paleta azul real, selección de ambos endpoints, transcripción
  visible y editable con texto RGB(246,247,248) sobre RGB(16,23,32), y layouts de
  320/360/390 px sin desbordamiento horizontal. Datos e identidad simulados.
- Build de producción, guard de estado, precache y diff aprobados.

Queda probar el endpoint temporal con una sesión real y su escucha activa en
n8n. El responsable de n8n habilita escucha/CORS; el usuario envía la grabación
desde SA y el agente SA revisa cualquier error recibido.
