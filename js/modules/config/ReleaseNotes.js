/**
 * Novedades de cada actualización, escritas a mano para la persona que usa la
 * app (no son los mensajes de commit). Van de la más nueva a la más vieja.
 *
 * Al abrir la app después de actualizar, se muestran las que salieron desde la
 * última vez que se vio una (ver services/WhatsNew.js). Para anunciar algo:
 * agrega una entrada AL INICIO con un `id` nuevo, la fecha, un título corto y
 * de 1 a 8 líneas de máximo 160 caracteres. Etiquetas: Nuevo, Mejora, Arreglo.
 */
export const RELEASE_TAGS = Object.freeze(['Nuevo', 'Mejora', 'Arreglo']);

export const RELEASE_NOTES = Object.freeze([
    Object.freeze({
        id: '2026-10-19-caja-chica-renovada',
        date: '2026-10-19',
        title: 'Caja chica renovada',
        items: Object.freeze([
            Object.freeze({ tag: 'Nuevo', text: 'Pantalla nueva de Caja chica: saldo y botón de foto arriba, gastos en tarjetas con su estado. Actívala en Configuración → Tests.' }),
            Object.freeze({ tag: 'Nuevo', text: 'Editor de factura: ves la foto con el dato marcado y puedes marcar tú mismo dónde está cada dato.' }),
            Object.freeze({ tag: 'Nuevo', text: 'Descargar o compartir la foto de la factura desde el editor.' }),
            Object.freeze({ tag: 'Mejora', text: 'Los avisos dicen qué falla en la factura y lo corriges con un toque («Usar el calculado», «Dar por bueno»).' }),
            Object.freeze({ tag: 'Mejora', text: 'Descuento, propina, exento e ITBIS incluido ya se pueden editar.' })
        ])
    })
]);

export default RELEASE_NOTES;
