/**
 * Enderezar una factura a mano desde el editor (botón «Enderezar»): se abre la foto ORIGINAL,
 * la persona ajusta las cuatro esquinas (PettyCashCornerEditor) y la foto enderezada queda
 * «en espera» como si hubiera elegido otra foto para el gasto: se guarda —y se respalda como
 * una versión nueva— solo al confirmar el gasto. Hasta entonces el gasto y los archivos del
 * teléfono no cambian, y «Volver a la original» o cancelar lo descartan.
 *
 * Lo que queda en espera, en el estado de la pantalla (`getState()`):
 *   _editPhotoCapture  la captura (original = la foto enderezada) que se guardará;
 *   _editPhoto         su vista previa (la que ya usa el cambio de foto);
 *   _editSource        la foto enderezada en alta resolución (`staged: true`) para el visor,
 *                      descargar y compartir (la vista previa es de 480 px);
 *   _editBoxes         los recuadros del lector y las marcas de la persona, ya pasados a la foto
 *                      nueva (PettyCashCorners). Se escriben en el gasto al guardar.
 *
 * Todo lo que toca el navegador o la pantalla se inyecta; probado en
 * js/tests/PettyCashStraightenFlow.test.js.
 */
import { openCornerEditor } from './PettyCashCornerEditor.js';
import { startingCorners, stagedBoxes, boxesForDisplay } from './PettyCashCorners.js';
import { analyzeQuad, straightenCanvas } from './PettyCashPaperStraighten.js';
import { detectPaper, PAPER_SIZE } from './PettyCashPaperCrop.js';
import { encodeImage, extensionFor, fitLongSide, MAX_PHOTO_LONG_SIDE } from './PettyCashCapture.js';

/** Nombre de la foto enderezada: el de la factura con «-recta» y la extensión del formato nuevo. */
export function straightenedName(name, type) {
    const base = String(name || 'factura').replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'factura';
    return `${base.endsWith('-recta') ? base : `${base}-recta`}.${extensionFor(type)}`;
}

/** Foto → lienzo con su orientación de cámara aplicada y sin pasar de `maxSide`. */
export async function decodeToCanvas(blob, {
    doc = globalThis.document,
    maxSide = MAX_PHOTO_LONG_SIDE,
    createBitmap = (b, options) => globalThis.createImageBitmap(b, options).catch(() => globalThis.createImageBitmap(b))
} = {}) {
    let bitmap;
    try { bitmap = await createBitmap(blob, { imageOrientation: 'from-image' }); } catch (_) { bitmap = null; }
    if (!bitmap || !(bitmap.width > 0) || !(bitmap.height > 0)) throw new Error('No se pudo abrir la foto.');
    const size = fitLongSide(bitmap.width, bitmap.height, maxSide);
    const canvas = doc.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, size.w, size.h);
    try { bitmap.close?.(); } catch (_) { /* ya liberada */ }
    return canvas;
}

/** Copia pequeña (RGBA) de la foto para buscar el papel. */
export function smallImageData(canvas, { doc = globalThis.document, size = PAPER_SIZE } = {}) {
    const w = Math.min(size, canvas.width);
    const h = Math.max(1, Math.round(canvas.height * (w / canvas.width)));
    const small = doc.createElement('canvas');
    small.width = w;
    small.height = h;
    const ctx = small.getContext('2d');
    ctx.drawImage(canvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
}

export function createStraightenFlow(deps = {}) {
    const doc = deps.doc || globalThis.document;
    const d = {
        getState: () => ({}),
        getMovement: () => null,
        isClosed: () => false,
        resolveOriginal: async () => ({ ok: false }),
        blobFromDataUrl: async (url) => (await fetch(url)).blob(),
        decode: (blob) => decodeToCanvas(blob, { doc }),
        suggest: (canvas) => {
            let small = null;
            const image = () => { small = small || smallImageData(canvas, { doc }); return small; };
            return startingCorners({ analyze: () => analyzeQuad(image()), detect: () => detectPaper(image()) });
        },
        straighten: (canvas, corners) => straightenCanvas(canvas, corners, { doc, maxSide: MAX_PHOTO_LONG_SIDE }),
        encode: encodeImage,
        prepareCapture: async () => { throw new Error('No hay cómo preparar la foto.'); },
        openEditor: openCornerEditor,
        notify: () => {},
        repaint: () => {},
        releaseSource: () => {},
        reloadSource: () => {},
        readDraft: () => ({}),
        createObjectUrl: (blob) => URL.createObjectURL(blob),
        ...deps,
        doc
    };
    let starting = false;

    const apply = async (mov, canvas, corners, found) => {
        const scr = d.getState();
        // La capa pudo quedar abierta mientras se cambiaba de gasto: la foto no se le deja a otro.
        if (d.getMovement()?.id !== mov.id) throw new Error('el gasto cambió mientras se enderezaba');
        const straight = await d.straighten(canvas, corners);
        if (!straight) throw new Error('la foto no se pudo procesar');
        const blob = await d.encode(straight);
        if (!blob) throw new Error('la foto no se pudo guardar');
        const base = boxesForDisplay(mov, scr._editBoxes);
        const file = new File([blob], straightenedName(found.name, blob.type), { type: blob.type, lastModified: Date.now() });
        const capture = await d.prepareCapture(file);
        // Desde aquí no hay nada que pueda fallar a medias: se deja todo en espera de una vez.
        const url = d.createObjectUrl(blob);
        const draft = d.readDraft();
        d.releaseSource();
        scr._editPhotoCapture = capture;
        scr._editPhotoFor = mov.id;
        scr._editPhoto = capture.previewDataUrl;
        scr._editSource = { url, mime: blob.type, preview: capture.previewDataUrl, objectUrl: true, staged: true };
        scr._editBoxes = stagedBoxes(base, corners);
        scr._editorUi = { ...(scr._editorUi || {}), view: null, viewKey: null, draft };
        d.repaint();
        d.notify('Foto enderezada. Se guardará cuando confirmes el gasto.', 'success');
        return true;
    };

    const start = async () => {
        const scr = d.getState();
        const mov = d.getMovement();
        if (!mov || mov.type !== 'gasto') return;
        if (!(mov.hasReceipt || mov.receiptStatus)) { d.notify('Este gasto no tiene foto de factura.', 'info'); return; }
        if (d.isClosed(mov)) { d.notify('Este periodo está cerrado: no se puede cambiar la foto.', 'info'); return; }
        const staged = scr._editPhotoCapture;
        if (staged) {
            // Hay una foto en espera (enderezada o elegida): se parte de ella, no de la guardada.
            if (staged.receiptKind === 'pdf' || /pdf/i.test(staged.originalType || '')) { d.notify('Los PDF no se pueden enderezar.', 'info'); return; }
        } else {
            const source = scr._editSource;
            if (source === undefined) { d.notify('La foto todavía se está cargando.', 'info'); return; }
            if (source?.mime === 'application/pdf' || mov.receiptKind === 'pdf') { d.notify('Los PDF no se pueden enderezar.', 'info'); return; }
            if (!source || source.reduced) { d.notify('Hace falta la foto original (no la miniatura) para enderezarla. Inténtalo de nuevo con conexión.', 'info'); return; }
        }
        if (starting) return;
        starting = true;
        try {
            d.notify('Preparando la foto…', 'info');
            const found = staged?.originalBlob
                ? { ok: true, blob: staged.originalBlob, name: staged.originalName }
                : await d.resolveOriginal(mov.id);
            if (!found?.ok) { d.notify('No se pudo obtener la foto original: hace falta conexión para bajarla del respaldo. La miniatura no sirve para enderezar.', 'info'); return; }
            const blob = found.blob || await d.blobFromDataUrl(found.dataUrl);
            const canvas = await d.decode(blob);
            const first = d.suggest(canvas);
            d.openEditor({
                doc,
                canvas,
                corners: first.corners,
                onAuto: () => d.suggest(canvas).corners,
                onApply: (corners) => apply(mov, canvas, corners, found),
                hint: first.source === 'default'
                    ? 'No se encontró el borde del papel: arrastra cada punto hasta una esquina de la factura.'
                    : 'Revisa que cada punto esté en una esquina de la factura y arrástralo si hace falta.'
            });
        } catch (error) {
            d.notify(`No se pudo abrir la foto para enderezarla${error?.message ? ` (${error.message})` : ''}.`, 'error');
        } finally {
            starting = false;
        }
    };

    /** Descarta la foto enderezada en espera y vuelve a la original. */
    const undo = () => {
        const scr = d.getState();
        scr._editPhoto = null;
        scr._editPhotoCapture = null;
        scr._editPhotoFor = null;
        scr._editBoxes = null;
        d.releaseSource();
        scr._editSource = undefined;
        scr._editorUi = { ...(scr._editorUi || {}), view: null, viewKey: null };
        d.repaint();
        d.reloadSource();
    };

    return { start, undo };
}
