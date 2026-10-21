# Revisión de Mini unificada

La preferencia existente `miniConnectedReviewMode` conserva su clave y valores
para respetar lo guardado en General. `daily` usa la revisión guiada existente;
`compare` usa la misma lista de comparación con SA para P2P y texto pegado.

El texto sigue usando su borrador y plan canónicos: no crea envíos P2P ni cambia
estados de la bandeja. Un adaptador de presentación expone ese borrador a la
lista compartida. Identidades, duplicados, reactivación y distribuciones por
varios cargos se resuelven con el editor detallado existente. La fecha y la
distribución de horas elegidas al pegar se conservan.

Las acciones de crear/recibir personal ocupan una fila propia. El vínculo usa
áreas explícitas y responde al ancho del panel, incluso en escritorio.

Verificación: ambos métodos y preferencias, aplicación explícita sin efectos
en bandeja para texto, decisiones y casos complejos, errores/reintento y vuelta
a validación. Chromium mide controles con las dos acciones de personal, en
escritorio y móvil; Jest, build y guardas de versión completan la validación.
