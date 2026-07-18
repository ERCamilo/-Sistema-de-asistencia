/**
 * 🧪 SyncCenterTests — el Centro de Sincronización simplificado y usable.
 *
 * Motivos (feedback de campo del usuario):
 *  1. En pantallas chicas el modal se salía de la pantalla y no se podía
 *     cerrar: .sync-center-modal no tenía max-height ni scroll, y el overlay
 *     lo centra → la × quedaba fuera de vista. + faltaba cerrar con Escape.
 *  2. Estaba sobredimensionado (3 datos + 2 toggles + 7 acciones). Se
 *     colapsa: estado en una línea, 2 toggles compactos a la vista, 1 acción
 *     primaria + 1 secundaria, y el resto bajo "Opciones avanzadas".
 *  3. El badge dejaba de tener efectos ocultos (pausar al presionar); ahora
 *     solo informa y ABRE el centro. Una pausa activa se ve en el badge.
 */

import fs from 'fs';
import path from 'path';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const HEADER_CSS = read('../../css/header.css');

// Bloque CSS de una regla `.selector { ... }`.
function cssRule(src, selector) {
    const start = src.indexOf(selector + ' {');
    if (start === -1) return '';
    const open = src.indexOf('{', start);
    const close = src.indexOf('}', open);
    return src.slice(open, close);
}

testRunner.addSuite('SyncCenter — se puede cerrar en pantallas chicas (bug de salida)', {

    '.sync-center-modal tiene max-height y scroll interno (no se sale de la pantalla)'() {
        const rule = cssRule(HEADER_CSS, '.sync-center-modal');
        testRunner.assert(/max-height:/.test(rule),
            'sin max-height el modal alto se sale del viewport y la × queda inalcanzable');
        testRunner.assert(/overflow-y:\s*auto/.test(rule),
            'necesita scroll interno cuando el contenido no entra');
    },

    'el header queda pegajoso para que la × sea siempre alcanzable al hacer scroll'() {
        const rule = cssRule(HEADER_CSS, '.sync-center-header');
        testRunner.assert(/position:\s*sticky/.test(rule), 'header sticky');
    },

    'el botón cerrar tiene tamaño de dedo (≥40px)'() {
        const rule = cssRule(HEADER_CSS, '.sync-center-close');
        const m = /width:\s*(\d+)px/.exec(rule);
        testRunner.assert(m && Number(m[1]) >= 40, `la × debe medir ≥40px (mide ${m ? m[1] : '?'})`);
    },

    'Escape cierra el modal (contrato en el keydown de la app)'() {
        const idx = APP_SRC.indexOf('function _handleAppKeydown');
        const body = APP_SRC.slice(idx, idx + 700);
        testRunner.assert(/['"]Escape['"]/.test(body), 'el keydown debe contemplar Escape');
        testRunner.assert(/closeModal/.test(body), 'Escape debe cerrar el modal abierto');
    }

});

testRunner.addSuite('SyncCenter — simplificado con los 2 toggles a la vista', {

    'los 2 toggles de pausa siguen visibles (no van a "avanzado")'() {
        const idx = APP_SRC.indexOf('function SyncCenterModal');
        const body = APP_SRC.slice(idx, idx + 7000);
        testRunner.assert(body.includes('syncCenterTogglePause'), 'toggle de subida visible');
        testRunner.assert(body.includes('syncCenterToggleDownloadPause'), 'toggle de descarga visible');
        // Compactos: en una fila de 2 columnas.
        testRunner.assert(/sync-pause-switches\s+compact|sync-pause-switches compact/.test(body) ||
            /class="sync-pause-switches compact"/.test(body),
            'los toggles deben usar el layout compacto de 2 tarjetas');
    },

    'lo peligroso/raro va bajo "Opciones avanzadas" (fold nativo <details>)'() {
        const idx = APP_SRC.indexOf('function SyncCenterModal');
        const body = APP_SRC.slice(idx, idx + 7000);
        testRunner.assert(/<details/.test(body) && /Opciones avanzadas/.test(body),
            'debe existir el fold de opciones avanzadas');
        // Subir/Descargar (reemplazos de dirección, peligrosos) van adentro del fold.
        const detailsIdx = body.indexOf('<details');
        const uploadIdx = body.indexOf('syncCenterUploadToCloud');
        testRunner.assert(detailsIdx !== -1 && uploadIdx > detailsIdx,
            '"Subir a la nube" (peligroso) debe quedar dentro de Opciones avanzadas');
    },

    'la acción primaria es Sincronizar ahora'() {
        const idx = APP_SRC.indexOf('function SyncCenterModal');
        const body = APP_SRC.slice(idx, idx + 7000);
        const syncNowIdx = body.indexOf('syncCenterSyncNow');
        const detailsIdx = body.indexOf('<details');
        testRunner.assert(syncNowIdx !== -1 && (detailsIdx === -1 || syncNowIdx < detailsIdx),
            'Sincronizar ahora debe estar a la vista, fuera del fold');
    }

});
