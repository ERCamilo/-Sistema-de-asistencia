/**
 * Estado de pantalla del editor de factura (no se guarda): tamaño y zoom de la
 * imagen, secciones plegables, dato activo y lo escrito sin guardar.
 * Probado en js/tests/PettyCashEditorUi.test.js.
 */
import { EDITOR_FIELDS } from './PettyCashReceiptEditor.js';

export function defaultEditorUi() {
    return { field: 'total', zoom: true, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {} };
}

/**
 * @param {object} ui estado actual (no se muta)
 * @param {'size'|'zoom'|'more'|'items'|'security'|'field'|'mark'} name
 * @param {*} [arg] dato activo para 'field'
 * @param {{more?:boolean, secOpen?:boolean}} [shown] lo que se está viendo ahora (las secciones en automático no guardan true/false)
 */
export function editorUiAction(ui, name, arg, shown = {}) {
    const next = { ...ui };
    switch (name) {
        case 'size': next.size = ((Number(ui.size) || 0) + 1) % 3; break;
        case 'zoom': next.zoom = !ui.zoom; break;
        case 'items': next.itemsOpen = !ui.itemsOpen; break;
        case 'more': next.more = !shown.more; break;
        case 'security': next.secOpen = !shown.secOpen; break;
        case 'field': next.field = arg; next.mark = false; break;
        case 'mark': next.mark = !ui.mark; break;
        default: break;
    }
    return next;
}

/** Lo que hay escrito en el formulario, con las claves del gasto (sin hasReceipt). */
export function readEditorDraft(root = document) {
    const draft = {};
    for (const [id, def] of Object.entries(EDITOR_FIELDS)) {
        if (id === 'pce-receipt') continue;
        const el = root.getElementById ? root.getElementById(id) : root.querySelector(`#${id}`);
        if (!el) continue;
        if (def.type === 'checkbox') draft[def.key] = !!el.checked;
        else if (def.type === 'number') {
            const raw = String(el.value ?? '').trim();
            const n = Number(raw);
            draft[def.key] = raw === '' || !Number.isFinite(n) ? null : n;
        } else draft[def.key] = el.value;
    }
    return draft;
}

/** Huella de los avisos: el editor solo se vuelve a pintar si cambia el conjunto. */
export function draftSignature(issues = []) {
    return issues.map((i) => i.code).sort().join(',');
}

/** Con la imagen ampliada, deja el recuadro del dato activo en el centro de la ventana. */
export function centerEditorBox(root = document) {
    const win = root.querySelector('[data-pcn-win][data-zoom="true"]');
    const box = win?.querySelector('[data-pcn-box]');
    if (!win || !box) return false;
    const w = win.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    win.scrollLeft += (b.left + b.width / 2) - (w.left + w.width / 2);
    win.scrollTop += (b.top + b.height / 2) - (w.top + w.height / 2);
    return true;
}

/**
 * En pantalla ancha y con el editor abierto, la pantalla ocupa lo que queda de
 * la ventana: así la lista y el detalle se desplazan cada uno por su lado.
 * En teléfono el editor es una hoja inferior y no hace falta altura fija.
 */
export function fitEditorScreen({ doc = document, win = window } = {}) {
    const el = doc.querySelector('[data-pcn-screen]');
    if (!el) return false;
    const wide = typeof win.matchMedia === 'function' && win.matchMedia('(min-width: 960px)').matches;
    if (!wide || el.dataset.editing !== 'true') { el.style.height = ''; return false; }
    // Distancia al borde superior de la ventana cuando la página está arriba del todo.
    const top = el.getBoundingClientRect().top + (win.scrollY || 0);
    el.style.height = `${Math.max(420, Math.round(win.innerHeight - top - 12))}px`;
    return true;
}
