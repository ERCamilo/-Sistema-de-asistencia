/**
 * Cámara de facturas a pantalla completa (prueba: Configuración → Tests →
 * "Cámara de facturas nueva").
 *
 * Visor en vivo (getUserMedia, cámara trasera), disparador, y las fotos de la
 * tanda en una pila pequeña junto al disparador con una línea de estado
 * ("2 leídas · 1 leyendo"). Tocar la pila abre una bandeja compacta; cada
 * miniatura abre su vista previa con el resultado de la lectura y, si algo no
 * cuadra, los motivos (PettyCashReceiptChecks).
 *
 * Vive fuera del ciclo render() de la app (como Voz): es un overlay propio que
 * se crea al abrir y se elimina al cerrar. Las fotos entran a la misma cola de
 * caja chica a través de `capture(file)`; el estado de cada una se consulta
 * con `getItemsState(ids)` cada CAMERA_POLL_MS.
 *
 * Probado en js/tests/PettyCashCamera.test.js.
 */

export const CAMERA_POLL_MS = 1500;
const FLASH_MS = 350;

const WAITING_TEXT = {
    network: 'Se leerá cuando vuelva la conexión.',
    session: 'Se leerá cuando inicies sesión.',
    paused: 'La lectura está pausada. Reanúdala desde Caja chica.'
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (d, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
    close: 'M6 6l12 12M18 6 6 18',
    back: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    alert: 'M12 3 2 20h20zM12 10v4M12 17h.01'
};

/** Texto y color por estado de lectura. */
export const STATE_UI = Object.freeze({
    reading: { label: 'Leyendo', chip: 'Leyendo…', tone: 'reading' },
    waiting: { label: 'En cola', chip: 'En cola', tone: 'reading' },
    ok: { label: 'Leída', chip: 'Leída', tone: 'ok' },
    review: { label: 'Por revisar', chip: 'Por revisar', tone: 'review' },
    failed: { label: 'No se pudo leer', chip: 'No se pudo leer', tone: 'failed' }
});

/** "2 leídas · 1 por revisar · 1 leyendo" */
export function summarizeCameraItems(items = []) {
    if (!items.length) return 'Toma la primera foto';
    const count = (s) => items.filter(i => i.state === s).length;
    const parts = [];
    const ok = count('ok');
    const review = count('review') + count('failed');
    const reading = count('reading');
    const waiting = count('waiting');
    if (ok) parts.push(`${ok} ${ok === 1 ? 'leída' : 'leídas'}`);
    if (review) parts.push(`${review} por revisar`);
    if (reading) parts.push(`${reading} leyendo`);
    if (waiting) parts.push(`${waiting} en cola`);
    return parts.join(' · ');
}

async function defaultGrabFrame(video, doc) {
    const canvas = doc.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 1706;
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve, reject) => canvas.toBlob(
        blob => (blob ? resolve(blob) : reject(new Error('No se pudo capturar la imagen'))),
        'image/jpeg', 0.92));
}

/**
 * @param {object} deps
 * @param {(file: File) => Promise<{id: string, previewUrl: string}>} deps.capture
 * @param {(ids: string[]) => Promise<Map<string, {state, issues, data}>>} deps.getItemsState
 * @param {(id: string) => void} deps.onReview   abre el gasto para revisarlo (la cámara ya cerró)
 * @param {(id: string) => Promise<boolean>} deps.onDelete
 * @param {(ids: string[]) => void} deps.onFinish
 * @param {() => void} deps.fallbackPick  cámara del sistema cuando no hay visor
 */
export function createReceiptCamera({
    doc = document,
    mediaDevices = globalThis.navigator?.mediaDevices,
    grabFrame = (video) => defaultGrabFrame(video, doc),
    capture,
    getItemsState = async () => new Map(),
    onReview = () => {},
    onDelete = async () => true,
    onFinish = () => {},
    notify = () => {},
    vibrate = (p) => { try { globalThis.navigator?.vibrate?.(p); } catch (_) { /* opcional */ } },
    fallbackPick = () => {},
    periodLabel = () => ''
} = {}) {
    let root = null;
    let stream = null;
    let items = [];          // { id, preview, state, issues, data }
    let busy = false;
    let trayOpen = false;
    let previewIndex = -1;
    let pollTimer = null;
    let lastFocus = null;

    const q = (sel) => root?.querySelector(sel);

    const shell = () => `
        <video data-pcam-video class="pcam-video" autoplay playsinline muted></video>
        <div class="pcam-guide" aria-hidden="true"></div>
        <div class="pcam-flash" data-pcam-flash hidden></div>
        <header class="pcam-top">
            <button type="button" class="pcam-icon" data-pcam-close aria-label="Cerrar cámara">${ico(ICON.close)}</button>
            <span class="pcam-period">${esc(periodLabel())}</span>
            <span class="pcam-top-spacer"></span>
        </header>
        <section class="pcam-tray" data-pcam-tray hidden aria-label="Facturas de esta tanda"></section>
        <footer class="pcam-bottom">
            <div class="pcam-status"><span class="pcam-summary" data-pcam-summary aria-live="polite"></span></div>
            <div class="pcam-controls">
                <button type="button" class="pcam-stack" data-pcam-stack aria-expanded="false" aria-label="Ver las facturas de esta tanda">
                    <span class="pcam-stack-cards" data-pcam-cards></span>
                    <span class="pcam-count" data-pcam-count>0</span>
                </button>
                <button type="button" class="pcam-shutter" data-pcam-shutter aria-label="Tomar foto"></button>
                <button type="button" class="pcam-done" data-pcam-done>Listo</button>
            </div>
        </footer>
        <div data-pcam-preview-host></div>`;

    const paint = () => {
        if (!root) return;
        const summary = q('[data-pcam-summary]');
        const reading = items.some(i => i.state === 'reading');
        summary.innerHTML = `${reading ? '<span class="pcam-spin" aria-hidden="true"></span>' : ''}${esc(summarizeCameraItems(items))}`;
        q('[data-pcam-count]').textContent = String(items.length);
        const stack = q('[data-pcam-stack]');
        stack.classList.toggle('is-empty', items.length === 0);
        stack.setAttribute('aria-expanded', String(trayOpen));
        q('[data-pcam-cards]').innerHTML = items.slice(-3).map((item, i, arr) =>
            `<span class="pcam-card${i === arr.length - 1 ? ' is-top' : ''}" style="background-image:url('${esc(item.preview)}')"></span>`).join('');
        const tray = q('[data-pcam-tray]');
        tray.hidden = !trayOpen || !items.length;
        tray.innerHTML = `<div class="pcam-tray-head"><b>Esta tanda · ${items.length}</b><span>La más reciente primero</span></div>
            <div class="pcam-tray-row">${items.map((item, i) => [item, i]).reverse().map(([item, i]) => `
                <button type="button" class="pcam-thumb" data-pcam-thumb="${i}" aria-label="Factura ${i + 1}: ${esc(STATE_UI[item.state]?.label || '')}" style="background-image:url('${esc(item.preview)}')">
                    <span class="pcam-dot pcam-tone-${STATE_UI[item.state]?.tone || 'reading'}"></span>
                </button>`).join('')}</div>`;
        paintPreview();
    };

    const dataRows = (data = {}) => {
        const rows = [
            ['Comercio', data.paidTo], ['NCF', data.ncf],
            ['Total', data.total ?? data.amount], ['Categoría', data.category]
        ].filter(([, v]) => v !== undefined && v !== null && v !== '');
        return rows.length
            ? `<dl class="pcam-rows">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
            : '';
    };

    const paintPreview = () => {
        const host = q('[data-pcam-preview-host]');
        if (!host) return;
        const item = items[previewIndex];
        if (!item) { host.innerHTML = ''; return; }
        const ui = STATE_UI[item.state] || STATE_UI.reading;
        const issues = (item.issues || []).map(i => `<li>${ico(ICON.alert, 16)}<span>${esc(i.message)}</span></li>`).join('');
        let sheet;
        if (item.state === 'reading' || item.state === 'waiting') {
            sheet = `<p class="pcam-muted">${item.state === 'waiting' ? (WAITING_TEXT[item.reason] || WAITING_TEXT.network) : 'Leyendo comercio, RNC, NCF y total…'}</p>
                <div class="pcam-skeleton"><i></i><i></i><i></i></div>
                <div class="pcam-actions"><button type="button" class="pcam-btn" data-pcam-action="delete">Eliminar</button><button type="button" class="pcam-btn is-primary" data-pcam-action="back">Seguir tomando</button></div>`;
        } else if (item.state === 'ok') {
            sheet = `${dataRows(item.data)}
                <div class="pcam-actions"><button type="button" class="pcam-btn" data-pcam-action="review">Editar</button><button type="button" class="pcam-btn is-ok" data-pcam-action="back">${ico(ICON.check, 18)} Se ve bien</button></div>`;
        } else {
            sheet = `${issues ? `<ul class="pcam-issues">${issues}</ul>` : '<p class="pcam-muted">No se pudo leer esta foto. Puedes revisarla a mano o eliminarla y tomarla de nuevo.</p>'}
                ${dataRows(item.data)}
                <div class="pcam-actions"><button type="button" class="pcam-btn" data-pcam-action="delete">Eliminar</button><button type="button" class="pcam-btn is-primary" data-pcam-action="review">Revisar ahora</button></div>`;
        }
        host.innerHTML = `<div class="pcam-preview" data-pcam-preview role="dialog" aria-modal="true" aria-label="Vista previa de la factura ${previewIndex + 1}">
            <header class="pcam-top">
                <button type="button" class="pcam-icon" data-pcam-action="back" aria-label="Volver a la cámara">${ico(ICON.back)}</button>
                <span class="pcam-counter">${previewIndex + 1} de ${items.length}</span>
                <span class="pcam-top-spacer"></span>
            </header>
            <div class="pcam-photo">
                <img src="${esc(item.preview)}" alt="Factura ${previewIndex + 1}">
                ${item.state === 'reading' ? '<span class="pcam-scan" aria-hidden="true"></span>' : ''}
                <button type="button" class="pcam-nav is-prev" data-pcam-prev aria-label="Foto anterior"${previewIndex === 0 ? ' disabled' : ''}>${ico(ICON.back)}</button>
                <button type="button" class="pcam-nav is-next" data-pcam-next aria-label="Foto siguiente"${previewIndex === items.length - 1 ? ' disabled' : ''}>${ico(ICON.next)}</button>
            </div>
            <div class="pcam-meta">
                <span class="pcam-chip pcam-tone-${ui.tone}" role="status">${esc(ui.chip)}</span>
                <div class="pcam-dots">${items.map((it, i) => `<span class="pcam-pip${i === previewIndex ? ' is-on' : ''} pcam-tone-${STATE_UI[it.state]?.tone || 'reading'}"></span>`).join('')}</div>
            </div>
            <section class="pcam-sheet">${sheet}</section>
        </div>`;
    };

    const refresh = async () => {
        if (!items.length) return;
        try {
            const states = await getItemsState(items.map(i => i.id));
            for (const item of items) {
                const next = states?.get?.(item.id);
                if (next) Object.assign(item, { state: next.state || item.state, reason: next.reason || null, issues: next.issues || [], data: next.data || {} });
            }
        } catch (_) { /* se reintenta en el siguiente ciclo */ }
        paint();
    };

    const flash = () => {
        const el = q('[data-pcam-flash]');
        if (!el) return;
        el.hidden = false;
        el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on');
        setTimeout(() => { if (el) el.hidden = true; }, FLASH_MS);
    };

    const shoot = async () => {
        if (busy || !root) return;
        busy = true;
        q('[data-pcam-shutter]')?.setAttribute('aria-busy', 'true');
        try {
            const blob = await grabFrame(q('[data-pcam-video]'));
            vibrate(12);
            flash();
            const file = new File([blob], `factura-${Date.now()}.jpg`, { type: 'image/jpeg' });
            const saved = await capture(file);
            items.push({ id: saved.id, preview: saved.previewUrl || '', state: 'reading', issues: [], data: {} });
            paint();
            q('[data-pcam-stack]')?.classList.remove('is-drop');
            void q('[data-pcam-stack]')?.offsetWidth;
            q('[data-pcam-stack]')?.classList.add('is-drop');
        } catch (error) {
            notify(`No se guardó la foto (${error?.message || 'error'}). Puedes tomarla de nuevo.`, 'warning');
        } finally {
            busy = false;
            q('[data-pcam-shutter]')?.removeAttribute('aria-busy');
        }
    };

    const openPreview = (index) => {
        if (!items[index]) return;
        previewIndex = index;
        trayOpen = false;
        paint();
        q('[data-pcam-preview] [data-pcam-action="back"]')?.focus?.();
    };
    const closePreview = () => { previewIndex = -1; paint(); };

    const removeItem = async (index) => {
        const item = items[index];
        if (!item) return;
        let ok = false;
        try { ok = await onDelete(item.id); } catch (_) { ok = false; }
        if (!ok) return;
        items.splice(index, 1);
        previewIndex = items.length ? Math.min(index, items.length - 1) : -1;
        paint();
    };

    const onClick = (event) => {
        const t = event.target?.closest?.('button');
        if (!t || !root?.contains(t)) return;
        if (t.matches('[data-pcam-close]')) { close(); return; }
        if (t.matches('[data-pcam-shutter]')) { shoot(); return; }
        if (t.matches('[data-pcam-done]')) { const ids = items.map(i => i.id); close(); onFinish(ids); return; }
        if (t.matches('[data-pcam-stack]')) { if (items.length) { trayOpen = !trayOpen; paint(); } return; }
        if (t.matches('[data-pcam-thumb]')) { openPreview(Number(t.dataset.pcamThumb)); return; }
        if (t.matches('[data-pcam-prev]')) { openPreview(previewIndex - 1); return; }
        if (t.matches('[data-pcam-next]')) { openPreview(previewIndex + 1); return; }
        const action = t.dataset.pcamAction;
        if (action === 'back') closePreview();
        else if (action === 'delete') removeItem(previewIndex);
        else if (action === 'review') { const id = items[previewIndex]?.id; close(); if (id) onReview(id); }
    };

    const onKey = (event) => {
        if (event.key !== 'Escape' || !root) return;
        if (previewIndex >= 0) closePreview(); else close();
    };

    async function open() {
        if (root) return;
        if (!mediaDevices?.getUserMedia) {
            notify('Este navegador no permite usar la cámara dentro de la app. Se abrirá la cámara del teléfono.', 'warning');
            fallbackPick();
            return;
        }
        try {
            stream = await mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        } catch (error) {
            stream = null;
            notify('No se pudo abrir la cámara dentro de la app. Se abrirá la cámara del teléfono.', 'warning');
            fallbackPick();
            return;
        }
        lastFocus = doc.activeElement;
        root = doc.createElement('div');
        root.className = 'pcam';
        root.dataset.pcam = '';
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', 'Cámara de facturas');
        root.innerHTML = shell();
        doc.body.appendChild(root);
        doc.body.classList.add('pcam-open');
        const video = q('[data-pcam-video]');
        video.srcObject = stream;
        try { await video.play?.(); } catch (_) { /* autoplay ya lo inicia */ }
        root.addEventListener('click', onClick);
        doc.addEventListener('keydown', onKey);
        pollTimer = setInterval(refresh, CAMERA_POLL_MS);
        paint();
        q('[data-pcam-shutter]')?.focus?.();
    }

    function close() {
        clearInterval(pollTimer); pollTimer = null;
        stream?.getTracks?.().forEach(track => { try { track.stop(); } catch (_) { /* ya detenida */ } });
        stream = null;
        if (root) {
            root.removeEventListener('click', onClick);
            root.remove();
            root = null;
        }
        doc.removeEventListener('keydown', onKey);
        doc.body.classList.remove('pcam-open');
        items = []; trayOpen = false; previewIndex = -1; busy = false;
        lastFocus?.focus?.();
    }

    return { open, close, refresh, openPreview, isOpen: () => !!root, items: () => items.slice() };
}
