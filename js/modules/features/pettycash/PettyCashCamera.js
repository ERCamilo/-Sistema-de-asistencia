/**
 * Cámara de facturas a pantalla completa (prueba: Configuración → Tests →
 * "Cámara de facturas nueva").
 *
 * Visor en vivo (getUserMedia, cámara trasera) en una ventana que muestra la
 * imagen completa de la cámara (lo que se ve es lo que se guarda), linterna
 * si el teléfono la tiene, disparador, y las fotos de la tanda en una pila
 * pequeña junto al disparador con una línea de estado ("2 leídas · 1
 * leyendo"). Tocar la pila abre una bandeja compacta; cada miniatura abre su
 * vista previa con zoom y el resultado de la lectura:
 *
 *   leyendo (línea de escaneo) → recibido (una pasada y un brillo) →
 *   ✓ leída · ! por revisar · ✕ sin datos (sello animado + vibración)
 *
 * Por revisar muestra lo leído frente a lo calculado (PettyCashReceiptChecks)
 * y, si el lector envió la posición del dato, tocar el aviso enfoca la foto.
 *
 * Factura larga: se toma por partes; arriba del visor se ve el final de la
 * parte anterior para alinear, y al tocar "Unir" las partes se juntan en una
 * sola foto (PettyCashStitch) que entra a la cola como cualquier otra.
 *
 * Vive fuera del ciclo render() de la app (como Voz): es un overlay propio que
 * se crea al abrir y se elimina al cerrar. Las fotos entran a la misma cola de
 * caja chica a través de `capture(file)`; el estado de cada una se consulta
 * con `getItemsState(ids)` cada CAMERA_POLL_MS. Solo se vuelve a dibujar lo
 * que cambió, para no reiniciar las animaciones en cada consulta.
 *
 * Probado en js/tests/PettyCashCamera.test.js.
 */
import { parseReceiptDate, fixesFor, validateFixInput } from './PettyCashReceiptChecks.js';
import { stitchParts, bottomBand, liveAlignment, OVERLAP_FRACTION } from './PettyCashStitch.js';
import { takeShot, renderShot, encodeImage, extensionFor } from './PettyCashCapture.js';

export const CAMERA_POLL_MS = 1500;
/** Cuánto dura "Recibido" antes de mostrar el resultado. */
export const RECEIVED_MS = 450;
/** Cada cuánto se revisa en vivo si la franja de la parte anterior ya coincide. */
export const ALIGN_POLL_MS = 500;
/** En "pendientes", cuánto se deja ver el ✓ antes de pasar a la siguiente. */
export const RESOLVED_ADVANCE_MS = 1700;
const FLASH_MS = 350;
const TIP_MS = 5000;
const MAX_PARTS = 4;
const MAX_ZOOM = 4;
const DOUBLE_TAP_MS = 300;
const DONE = new Set(['ok', 'review', 'failed']);
const RESULT_VIBRATION = { ok: 20, review: [15, 60, 15], failed: [40, 40, 40] };

const WAITING_TEXT = {
    network: 'Se leerá cuando vuelva la conexión.',
    session: 'Se leerá cuando inicies sesión.',
    paused: 'La lectura está pausada. Reanúdala desde Caja chica.'
};
const TIP = {
    start: 'Lo que ves en el recuadro es exactamente lo que se guarda.',
    long: 'Factura larga: empieza por arriba, con el nombre del comercio.',
    next: (n) => `Baja el teléfono hasta que el final de la parte ${n} coincida con la franja de arriba.`,
    full: 'Llegaste al máximo de partes. Toca Unir.'
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ico = (d, w = 22) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const ICON = {
    close: 'M6 6l12 12M18 6 6 18',
    back: 'M15 6l-6 6 6 6',
    next: 'M9 6l6 6-6 6',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    torch: 'M13 2 4 14h7l-1 8 9-12h-7z',
    long: 'M7 2h10v20H7zM7 9h10M7 15h10',
    fit: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4'
};
// Sello: anillo + glifo (se dibujan con stroke-dashoffset).
const SEAL_GLYPH = {
    ok: '<path class="pcam-seal-glyph" d="M14.5 25l6.5 6.5L34 17.5"/>',
    review: '<path class="pcam-seal-glyph" d="M24 12.5v14"/><circle class="pcam-seal-dot" cx="24" cy="34.5" r="2.2" fill="currentColor" stroke="none"/>',
    failed: '<path class="pcam-seal-glyph" d="M16 16l16 16M32 16L16 32"/>'
};

/** Texto y color por estado de lectura. */
export const STATE_UI = Object.freeze({
    reading: { label: 'Leyendo', chip: 'Leyendo…', tone: 'reading' },
    waiting: { label: 'En cola', chip: 'En cola', tone: 'reading' },
    ok: { label: 'Leída', chip: 'Leída · todo cuadra', tone: 'ok' },
    review: { label: 'Por revisar', chip: 'Por revisar', tone: 'review' },
    failed: { label: 'No se pudo leer', chip: 'No se pudo leer', tone: 'failed' }
});

/** "2 leídas · 1 por revisar · 1 sin datos · 1 leyendo" */
export function summarizeCameraItems(items = []) {
    if (!items.length) return 'Toma la primera foto';
    const count = (s) => items.filter(i => i.state === s).length;
    const parts = [];
    const ok = count('ok');
    const review = count('review');
    const failed = count('failed');
    const reading = count('reading');
    const waiting = count('waiting');
    if (ok) parts.push(`${ok} ${ok === 1 ? 'leída' : 'leídas'}`);
    if (review) parts.push(`${review} por revisar`);
    if (failed) parts.push(`${failed} sin datos`);
    if (reading) parts.push(`${reading} leyendo`);
    if (waiting) parts.push(`${waiting} en cola`);
    return parts.join(' · ');
}

const money = (n) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return esc(n);
    const [int, dec] = Math.abs(v).toFixed(2).split('.');
    return `${v < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`;
};
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const shortDate = (iso) => {
    if (!iso) return '';
    const [, m, d] = iso.split('-').map(Number);
    return `${d} ${MONTHS[m - 1]}`;
};
const tag = (text, kind = '') => `<span class="pcam-tag${kind ? ` is-${kind}` : ''}">${text}</span>`;

/** Cuerpo de un aviso: lo leído frente a lo calculado o lo que falta. */
function issueBody(issue) {
    const d = issue.detail || {};
    switch (issue.code) {
        case 'total-mismatch':
            return `<span class="pcam-cmp"><span>Leído ${tag(money(d.read), 'bad')}</span><span>Subtotal + ITBIS ${tag(money(d.calc), 'calc')}</span></span>`;
        case 'itbis-rate':
            return `<span class="pcam-cmp"><span>Leído ${tag(money(d.read), 'bad')}</span><span>Calculado ${tag(money(d.calc), 'calc')}</span></span>
                <span class="pcam-note">18% de ${money(d.base)}.${issue.hint ? ` ${esc(issue.hint)}` : ''}</span>`;
        case 'ncf-format':
        case 'rnc-invalid': {
            const slots = '<span class="pcam-slot"></span>'.repeat(Math.min(4, d.missing || 0));
            return `<span class="pcam-cmp"><span>Detectado ${tag(`${esc(d.read)}${slots}`, 'bad')}</span>${d.missing ? `<span class="pcam-note">faltan ${d.missing} ${d.missing === 1 ? 'dígito' : 'dígitos'}</span>` : ''}</span>`;
        }
        case 'date-outside-period': {
            const read = parseReceiptDate(d.read);
            return `<span class="pcam-cmp"><span>Leída ${tag(`${esc(d.read)}${read ? ` · ${shortDate(read)}` : ''}`, 'bad')}</span>${d.suggestion ? `<span>¿Era ${tag(shortDate(d.suggestion), 'calc')}?</span>` : ''}</span>
                ${d.suggestion ? '<span class="pcam-note">Leída como día/mes queda dentro del periodo.</span>' : ''}`;
        }
        default:
            return issue.hint ? `<span class="pcam-note">${esc(issue.hint)}</span>` : '';
    }
}

/** Ancho máximo de cada parte de una factura larga en memoria (la unión sale a 1600 px). */
const PART_MAX_WIDTH = 1600;

/** Texto de cada botón para resolver un aviso (ver fixesFor). */
function fixLabel(issue, fix) {
    if (fix.kind === 'accept') {
        return {
            'total-mismatch': 'El total está bien',
            'itbis-rate': 'Lo leído está bien',
            'date-outside-period': 'La fecha está bien',
            'ncf-duplicate': 'Es otra factura'
        }[issue.code] || 'Dejar así';
    }
    if (fix.kind === 'apply') return issue.code === 'date-outside-period' ? `Cambiar a ${shortDate(fix.value)}` : `Usar ${money(fix.value)}`;
    return 'Guardar';
}
const FIX_PLACEHOLDER = { ncf: 'B0100000000', rnc: 'RNC o cédula', amount: '0.00', date: 'dd/mm/aaaa' };

async function defaultToBitmap(blob, doc) {
    if (typeof globalThis.createImageBitmap === 'function') {
        // Las partes se guardan en memoria hasta unirlas: se reducen para no gastar de más.
        const bitmap = await globalThis.createImageBitmap(blob);
        if (bitmap.width <= PART_MAX_WIDTH) return bitmap;
        const resized = await globalThis.createImageBitmap(bitmap, {
            resizeWidth: PART_MAX_WIDTH,
            resizeHeight: Math.round(bitmap.height * (PART_MAX_WIDTH / bitmap.width)),
            resizeQuality: 'high'
        });
        bitmap.close?.();
        return resized;
    }
    const url = URL.createObjectURL(blob);
    try {
        const img = doc.createElement('img');
        img.src = url;
        await img.decode();
        return img;
    } finally {
        URL.revokeObjectURL(url);
    }
}

/**
 * Lo que había justo arriba de la franja en la parte anterior, para mostrarlo
 * por encima del recuadro (fuera de la foto): `rows` filas de la foto.
 */
function defaultDrawGhostContext(canvas, bitmap, rows) {
    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !w || !h || rows <= 0) return;
    const band = Math.round(h * OVERLAP_FRACTION);
    const take = Math.min(rows, h - band);
    canvas.width = w;
    canvas.height = Math.max(1, Math.round(rows));
    ctx.clearRect(0, 0, w, canvas.height);
    // Pegado abajo: la última fila queda justo encima del recuadro.
    ctx.drawImage(bitmap, 0, h - band - take, w, take, 0, canvas.height - take, w, take);
}

/** Dibuja arriba del lienzo (mismo tamaño que la foto) la franja final de la parte anterior. */
function defaultDrawGhost(canvas, bitmap) {
    const w = bitmap.width || bitmap.naturalWidth;
    const h = bitmap.height || bitmap.naturalHeight;
    const ctx = canvas.getContext?.('2d');
    if (!ctx || !w || !h) return;
    canvas.width = w;
    canvas.height = h;
    const band = Math.round(h * OVERLAP_FRACTION);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, h - band, w, band, 0, 0, w, band);
}

/**
 * @param {object} deps
 * @param {(file: File) => Promise<{id: string, previewUrl: string}>} deps.capture
 * @param {(ids: string[]) => Promise<Map<string, {state, reason, issues, data}>>} deps.getItemsState
 * @param {(id: string) => void} deps.onReview   abre el gasto para revisarlo (la cámara ya cerró)
 * @param {(id: string) => Promise<boolean>} deps.onDelete
 * @param {(ids: string[]) => void} deps.onFinish
 * @param {() => void} deps.fallbackPick  cámara del sistema cuando no hay visor
 */
export function createReceiptCamera({
    doc = document,
    mediaDevices = globalThis.navigator?.mediaDevices,
    grabFrame = (video, track) => takeShot({ video, track, doc }),
    capture,
    getItemsState = async () => new Map(),
    onReview = () => {},
    onDelete = async () => true,
    onFix = async () => false,
    diag = { record() {} },
    clock = () => (globalThis.performance?.now?.() ?? Date.now()),
    onFinish = () => {},
    notify = () => {},
    vibrate = (p) => { try { globalThis.navigator?.vibrate?.(p); } catch (_) { /* opcional */ } },
    fallbackPick = () => {},
    periodLabel = () => '',
    toBitmap = (shot) => (shot instanceof Blob ? defaultToBitmap(shot, doc) : renderShot(shot, { doc, maxWidth: PART_MAX_WIDTH })),
    toPhoto = (shot) => (shot instanceof Blob ? shot : encodeImage(renderShot(shot, { doc }))),
    stitch = (bitmaps, options) => stitchParts(doc, bitmaps, options),
    makeBand = (bitmap) => bottomBand(doc, bitmap),
    checkAlignment = (video, band) => liveAlignment(doc, video, band),
    drawGhost = defaultDrawGhost,
    drawGhostContext = defaultDrawGhostContext
} = {}) {
    let root = null;
    let stream = null;
    let track = null;
    let torchOn = false;
    let items = [];          // { id, preview, state, reason, issues, data }
    let busy = false;       // uniendo una factura larga
    let pending = false;    // recorriendo solo las facturas pendientes (al tocar "Listo")
    let advanceTimer = null;
    let grabbing = false;   // tomando la foto (paso rápido)
    let saving = 0;         // fotos tomadas que aún se están guardando
    let saveChain = Promise.resolve();
    let sessionId = 0;
    let trayOpen = false;
    let previewIndex = -1;
    let pollTimer = null;
    let lastFocus = null;
    let barSig = '';
    let traySig = '';
    // Vista previa: qué se muestra y en qué fase va.
    let shown = { id: null, sig: '', phase: '' };
    let receivedTimer = null;
    let view = { s: 1, px: 0, py: 0, focus: -1, fit: false };
    let resizeObserver = null;
    let viewObserver = null;
    const pointers = new Map();
    let gesture = null;
    let lastTap = 0;
    let lastTouchToggle = 0;
    // Factura larga.
    let long = { on: false, parts: [], band: null, aligned: false, status: null, yFrac: null };
    let alignTimer = null;

    const q = (sel) => root?.querySelector(sel);
    const note = (type, data) => { try { diag.record(type, data); } catch (_) { /* el diagnóstico nunca rompe la cámara */ } };

    const shell = () => `
        <div class="pcam-view" data-pcam-view>
            <div class="pcam-frame" data-pcam-frame>
                <video data-pcam-video class="pcam-video" autoplay playsinline muted></video>
                <canvas class="pcam-ghost" data-pcam-ghost hidden aria-hidden="true"></canvas>
                <span class="pcam-ghost-edge" data-pcam-ghost-edge hidden aria-hidden="true"></span>
                <span class="pcam-match" data-pcam-match hidden aria-hidden="true"><i>aquí termina la parte anterior</i></span>
                <div class="pcam-flash" data-pcam-flash hidden></div>
            </div>
        </div>
        <canvas class="pcam-ghost-context" data-pcam-ghost-context hidden aria-hidden="true"></canvas>
        <header class="pcam-top">
            <button type="button" class="pcam-icon" data-pcam-close aria-label="Cerrar cámara">${ico(ICON.close)}</button>
            <span class="pcam-period" data-pcam-period>${esc(periodLabel())}</span>
            <span class="pcam-ghost-tag" data-pcam-ghost-tag role="status" hidden></span>
            <button type="button" class="pcam-icon pcam-torch" data-pcam-torch aria-label="Linterna" aria-pressed="false" hidden>${ico(ICON.torch, 20)}</button>
            <span class="pcam-top-spacer" data-pcam-torch-spacer></span>
        </header>
        <p class="pcam-tip" data-pcam-tip role="status"></p>
        <section class="pcam-tray" data-pcam-tray hidden aria-label="Facturas de esta tanda"></section>
        <footer class="pcam-bottom">
            <div class="pcam-modes">
                <button type="button" class="pcam-mode" data-pcam-long aria-pressed="false">${ico(ICON.long, 16)}<span>Factura larga</span></button>
            </div>
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

    // ── Barra inferior, pila y bandeja ────────────────────────────────────

    const restart = (el, cls) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

    let tipTimer = null;
    const showTip = (text) => {
        const tip = q('[data-pcam-tip]');
        if (!tip) return;
        tip.textContent = text;
        tip.classList.toggle('is-low', long.on && long.parts.length > 0);
        restart(tip, 'is-on');
        clearTimeout(tipTimer);
        tipTimer = setTimeout(() => tip.classList.remove('is-on'), TIP_MS);
    };

    const paintBar = () => {
        if (!root) return;
        const summary = q('[data-pcam-summary]');
        const reading = items.some(i => i.state === 'reading');
        const text = long.on
            ? (long.parts.length ? `${long.parts.length} ${long.parts.length === 1 ? 'parte' : 'partes'} · al unir se recorta lo repetido` : 'Parte 1 · desde arriba')
            : summarizeCameraItems(items);
        const withSaving = saving ? `${saving} guardando${text && items.length ? ` · ${text}` : ''}` : text;
        summary.innerHTML = `${(reading || saving) && !long.on ? '<span class="pcam-spin" aria-hidden="true"></span>' : ''}${esc(long.on ? text : withSaving)}`;
        q('[data-pcam-count]').textContent = String(items.length);
        const stack = q('[data-pcam-stack]');
        stack.classList.toggle('is-empty', items.length === 0);
        stack.setAttribute('aria-expanded', String(trayOpen));
        const sig = items.slice(-3).map(i => `${i.id}:${i.preview}`).join('|');
        if (sig !== barSig) {
            barSig = sig;
            q('[data-pcam-cards]').innerHTML = items.slice(-3).map((item, i, arr) =>
                `<span class="pcam-card${i === arr.length - 1 ? ' is-top' : ''}" style="background-image:url('${esc(item.preview)}')"></span>`).join('');
        }
        const done = q('[data-pcam-done]');
        done.textContent = long.on ? `Unir (${long.parts.length})` : 'Listo';
        done.disabled = long.on && long.parts.length < 2;
        const mode = q('[data-pcam-long]');
        mode.setAttribute('aria-pressed', String(long.on));
        const tray = q('[data-pcam-tray]');
        tray.hidden = !trayOpen || !items.length;
        if (tray.hidden) { traySig = ''; return; }
        const tsig = items.map(i => `${i.id}:${i.state}`).join('|');
        if (tsig === traySig) return;
        traySig = tsig;
        tray.innerHTML = `<div class="pcam-tray-head"><b>Esta tanda · ${items.length}</b><span>La más reciente primero</span></div>
            <div class="pcam-tray-row">${items.map((item, i) => [item, i]).reverse().map(([item, i]) => `
                <button type="button" class="pcam-thumb" data-pcam-thumb="${i}" aria-label="Factura ${i + 1}: ${esc(STATE_UI[item.state]?.label || '')}" style="background-image:url('${esc(item.preview)}')">
                    <span class="pcam-dot pcam-tone-${STATE_UI[item.state]?.tone || 'reading'}"></span>
                </button>`).join('')}</div>`;
    };

    // ── Vista previa ──────────────────────────────────────────────────────

    const itemSig = (item) => JSON.stringify([item.state, item.reason, item.issues, item.data]);

    const dataRows = (data = {}) => {
        const rows = [
            ['Comercio', data.paidTo], ['NCF', data.ncf],
            ['Total', data.total ?? data.amount], ['Categoría', data.category]
        ].filter(([, v]) => v !== undefined && v !== null && v !== '');
        return rows.length
            ? `<dl class="pcam-rows">${rows.map(([k, v]) => `<div class="pcam-in"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
            : '';
    };

    /** Botones para resolver el aviso aquí mismo (usar lo calculado, escribir el dato, darlo por bueno). */
    const fixRow = (issue, i) => {
        const fixes = fixesFor(issue);
        if (!fixes.length) return '';
        return `<div class="pcam-fixes">${fixes.map((fix, j) => {
            const key = `${i}:${j}`;
            if (fix.kind === 'input') {
                return `<span class="pcam-fixinput"><input data-pcam-fix-input="${key}" data-validate="${fix.validate}" value="${esc(fix.value)}" placeholder="${FIX_PLACEHOLDER[fix.validate] || ''}" ${fix.validate === 'amount' ? 'inputmode="decimal"' : 'autocapitalize="characters"'} aria-label="Corregir ${esc(issue.message)}"><button type="button" class="pcam-fix is-primary" data-pcam-fix="${key}" disabled>${fixLabel(issue, fix)}</button></span>`;
            }
            return `<button type="button" class="pcam-fix${fix.kind === 'apply' ? ' is-primary' : ''}" data-pcam-fix="${key}">${esc(fixLabel(issue, fix))}</button>`;
        }).join('')}</div>`;
    };

    const issueList = (issues) => issues.map((issue, i) => {
        const body = `<b>${esc(issue.message)}</b>${issueBody(issue)}`;
        const locate = issue.box
            ? `<button type="button" class="pcam-loc" data-pcam-issue="${i}" aria-pressed="${view.focus === i}">⌖ Ver en la foto</button>` : '';
        return `<div class="pcam-issue pcam-in" data-pcam-issue-card="${i}">${body}${locate}${fixRow(issue, i)}</div>`;
    }).join('');

    const sheetHtml = (item) => {
        if (item.state === 'reading' || item.state === 'waiting') {
            return `<div class="pcam-wait" data-pcam-wait>
                    <p class="pcam-muted">${item.state === 'waiting' ? (WAITING_TEXT[item.reason] || WAITING_TEXT.network) : 'Leyendo comercio, RNC, NCF y total…'}</p>
                    <div class="pcam-skeleton"><i></i><i></i><i></i></div>
                </div>
                <div class="pcam-actions"><button type="button" class="pcam-btn" data-pcam-action="delete">Eliminar</button><button type="button" class="pcam-btn is-primary" data-pcam-action="back">Seguir tomando</button></div>`;
        }
        if (item.state === 'ok') {
            return `${dataRows(item.data)}
                <div class="pcam-actions pcam-in"><button type="button" class="pcam-btn" data-pcam-action="review">Editar</button><button type="button" class="pcam-btn is-ok" data-pcam-action="back">${ico(ICON.check, 18)} Se ve bien</button></div>`;
        }
        if (item.state === 'failed') {
            return `<p class="pcam-fail pcam-in">No se obtuvo ningún dato de esta foto.</p>
                <ul class="pcam-tips pcam-in"><li>Busca más luz o enciende la linterna.</li><li>Que se vea la factura completa, sin cortar el total.</li></ul>
                <div class="pcam-actions pcam-in"><button type="button" class="pcam-btn" data-pcam-action="review">Llenar a mano</button><button type="button" class="pcam-btn is-primary" data-pcam-action="retake">Retomar foto</button></div>`;
        }
        return `<div class="pcam-issues">${issueList(item.issues || [])}</div>
            ${dataRows(item.data)}
            <div class="pcam-actions pcam-in"><button type="button" class="pcam-btn" data-pcam-action="delete">Eliminar</button><button type="button" class="pcam-btn is-primary" data-pcam-action="review">Revisar ahora</button></div>`;
    };

    const chipFor = (item, phase) => (phase === 'received'
        ? { text: 'Recibido', tone: 'reading' }
        : { text: STATE_UI[item.state]?.chip || STATE_UI.reading.chip, tone: STATE_UI[item.state]?.tone || 'reading' });

    const paintChip = (item, phase) => {
        const chip = q('[data-pcam-chip]');
        const { text, tone } = chipFor(item, phase);
        const label = item.state === 'review' && phase === 'done' && item.issues?.length
            ? `Por revisar · ${item.issues.length} ${item.issues.length === 1 ? 'dato' : 'datos'}` : text;
        chip.className = `pcam-chip pcam-tone-${tone}`;
        chip.innerHTML = `${phase === 'reading' ? '<span class="pcam-spin" aria-hidden="true"></span>' : ''}${esc(label)}`;
        restart(chip, 'is-in');
    };

    const paintDots = () => {
        const dots = q('[data-pcam-dots]');
        if (!dots) return;
        dots.innerHTML = items.map((it, i) => `<span class="pcam-pip${i === previewIndex ? ' is-on' : ''} pcam-tone-${DONE.has(it.state) ? STATE_UI[it.state].tone : 'reading'}"></span>`).join('');
    };

    const paintSeal = (state, animate) => {
        const host = q('[data-pcam-seal-host]');
        if (!host) return;
        if (!DONE.has(state)) { host.innerHTML = ''; return; }
        host.innerHTML = `<span class="pcam-seal is-${state}${animate ? '' : ' is-static'}" data-pcam-seal="${state}" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="60" height="60" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">
                <circle class="pcam-seal-ring" cx="24" cy="24" r="23" transform="rotate(-90 24 24)" stroke-width="2.4"/>${SEAL_GLYPH[state]}
            </svg></span>`;
    };

    const phaseOf = (item) => (DONE.has(item.state) ? 'done' : item.state === 'waiting' ? 'waiting' : 'reading');

    /** Contenido de la vista previa para el estado actual de la foto. */
    const paintResult = (item, { animate }) => {
        const phase = phaseOf(item);
        shown = { id: item.id, sig: itemSig(item), phase, state: item.state };
        q('[data-pcam-photo]').dataset.phase = phase;
        paintChip(item, phase);
        paintSeal(item.state, animate);
        const sheet = q('[data-pcam-sheet]');
        sheet.classList.toggle('is-animated', animate);
        sheet.innerHTML = sheetHtml(item);
        sheet.querySelectorAll('.pcam-in').forEach((el, i) => el.style.setProperty('--i', i));
        paintDots();
        if (animate && DONE.has(item.state)) vibrate(RESULT_VIBRATION[item.state]);
    };

    /** Llegó la respuesta mientras se mira esta foto: "Recibido" y luego el resultado. */
    const playReceived = (item) => {
        clearTimeout(receivedTimer);
        shown = { id: item.id, sig: itemSig(item), phase: 'received' };
        q('[data-pcam-photo]').dataset.phase = 'received';
        restart(q('[data-pcam-sweep]'), 'is-on');
        paintChip(item, 'received');
        q('[data-pcam-wait]')?.classList.add('is-leaving');
        receivedTimer = setTimeout(() => {
            receivedTimer = null;
            const current = items[previewIndex];
            if (current && current.id === item.id) paintResult(current, { animate: true });
        }, RECEIVED_MS);
    };

    const updatePreview = () => {
        const item = items[previewIndex];
        if (!item || !q('[data-pcam-preview]')) return;
        q('[data-pcam-counter]').textContent = counterText();
        paintDots();
        if (shown.phase === 'received') return; // el resultado ya viene en camino
        const sig = itemSig(item);
        if (sig === shown.sig) return;
        const arrived = (shown.phase === 'reading' || shown.phase === 'waiting') && DONE.has(item.state);
        // Se resolvió lo que faltaba desde aquí: el sello pasa a ✓ con su animación.
        const resolved = shown.state === 'review' && item.state === 'ok';
        if (arrived) playReceived(item);
        else paintResult(item, { animate: resolved });
        if (resolved && pending) scheduleNextPending(item.id);
    };

    // Zoom y desplazamiento de la foto.
    const photoBox = () => {
        const photo = q('[data-pcam-photo]');
        const zoom = q('[data-pcam-zoom]');
        return { pw: photo?.clientWidth || 0, ph: photo?.clientHeight || 0, w: zoom?.offsetWidth || 0, h: zoom?.offsetHeight || 0 };
    };
    const clampView = (s, px, py) => {
        const { pw, ph, w, h } = photoBox();
        const mx = Math.max(0, (w * s - pw) / 2);
        const my = Math.max(0, (h * s - ph) / 2);
        return { s, px: Math.max(-mx, Math.min(mx, px)), py: Math.max(-my, Math.min(my, py)) };
    };
    const applyView = ({ keepFocus = false } = {}) => {
        const zoom = q('[data-pcam-zoom]');
        if (!zoom) return;
        zoom.style.setProperty('--s', String(view.s));
        zoom.style.setProperty('--px', `${view.px}px`);
        zoom.style.setProperty('--py', `${view.py}px`);
        zoom.dataset.zoom = String(Math.round(view.s * 100) / 100);
        q('[data-pcam-photo]')?.classList.toggle('is-zoomed', view.s > 1);
        q('[data-pcam-zoom-fit]')?.setAttribute('aria-pressed', String(view.fit));
        const hint = q('[data-pcam-zoomhint]');
        if (hint) hint.textContent = view.s > 1 ? `${Math.round(view.s * 100)}% · arrastra para mover` : 'Toca dos veces para acercar';
        if (!keepFocus && view.focus >= 0) {
            view.focus = -1;
            const hl = q('[data-pcam-hl]');
            if (hl) hl.hidden = true;
            root?.querySelectorAll('[data-pcam-issue]').forEach(b => b.setAttribute('aria-pressed', 'false'));
        }
    };
    const setZoom = (s, px = view.px, py = view.py) => {
        const next = clampView(Math.max(1, Math.min(MAX_ZOOM, s)), s <= 1 ? 0 : px, s <= 1 ? 0 : py);
        view = { ...view, ...next, fit: false };
        applyView();
    };
    /** Factura larga: ajustar al ancho y empezar arriba; otra vez, volver a la foto completa. */
    const fitWidth = () => {
        if (view.fit) { setZoom(1); return; }
        const { pw, w } = photoBox();
        const s = w ? Math.min(MAX_ZOOM, (pw - 24) / w) : 2;
        const next = clampView(Math.max(1.01, s), 0, Number.MAX_SAFE_INTEGER);
        view = { ...view, ...next, fit: true };
        applyView();
    };
    const toggleZoomAt = (clientX, clientY) => {
        if (view.s > 1) { setZoom(1); return; }
        const photo = q('[data-pcam-photo]');
        const r = photo?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
        const s = 2.5;
        const dx = (clientX ?? r.left + r.width / 2) - (r.left + r.width / 2);
        const dy = (clientY ?? r.top + r.height / 2) - (r.top + r.height / 2);
        setZoom(s, -dx * (s - 1), -dy * (s - 1));
    };
    /** Enfoca el recuadro [y0, x0, y1, x1] (0–1000) del aviso `index`. */
    const focusIssue = (index) => {
        const issue = items[previewIndex]?.issues?.[index];
        if (!issue?.box) return;
        const [y0, x0, y1, x1] = issue.box;
        const { pw, ph, w, h } = photoBox();
        const bw = ((x1 - x0) / 1000) * w;
        const bh = ((y1 - y0) / 1000) * h;
        const s = Math.max(1.6, Math.min(MAX_ZOOM, bw && bh ? Math.min((pw * 0.75) / bw, (ph * 0.35) / bh) : MAX_ZOOM));
        const cx = (((x0 + x1) / 2000) - 0.5) * w;
        const cy = (((y0 + y1) / 2000) - 0.5) * h;
        view = { ...view, ...clampView(s, -cx * s, -cy * s), focus: index };
        applyView({ keepFocus: true });
        const hl = q('[data-pcam-hl]');
        Object.assign(hl.style, { top: `${y0 / 10}%`, left: `${x0 / 10}%`, height: `${(y1 - y0) / 10}%`, width: `${(x1 - x0) / 10}%` });
        hl.hidden = false;
        restart(hl, 'is-on');
        root.querySelectorAll('[data-pcam-issue]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.pcamIssue) === index)));
        vibrate(8);
    };

    const onPhotoDown = (event) => {
        if (event.target?.closest?.('button')) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget?.setPointerCapture?.(event.pointerId);
        const pts = [...pointers.values()];
        if (pts.length === 2) {
            gesture = { type: 'pinch', d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, s: view.s };
        } else {
            gesture = { type: 'pan', x: event.clientX, y: event.clientY, px: view.px, py: view.py, t: Date.now(), moved: false };
        }
        q('[data-pcam-zoom]')?.classList.add('is-dragging');
    };
    const onPhotoMove = (event) => {
        if (!pointers.has(event.pointerId) || !gesture) return;
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const pts = [...pointers.values()];
        if (gesture.type === 'pinch' && pts.length === 2) {
            const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
            const s = Math.max(1, Math.min(MAX_ZOOM, gesture.s * (d / gesture.d)));
            view = { ...view, ...clampView(s, view.px, view.py), fit: false };
            applyView();
        } else if (gesture.type === 'pan') {
            const dx = event.clientX - gesture.x;
            const dy = event.clientY - gesture.y;
            if (Math.abs(dx) + Math.abs(dy) > 8) gesture.moved = true;
            if (view.s > 1) {
                view = { ...view, ...clampView(view.s, gesture.px + dx, gesture.py + dy), fit: view.fit };
                applyView({ keepFocus: !gesture.moved });
            }
        }
    };
    const onPhotoUp = (event) => {
        pointers.delete(event.pointerId);
        q('[data-pcam-zoom]')?.classList.remove('is-dragging');
        if (gesture?.type === 'pan' && !gesture.moved && Date.now() - gesture.t < 250) {
            const now = Date.now();
            if (now - lastTap < DOUBLE_TAP_MS) { lastTap = 0; lastTouchToggle = now; toggleZoomAt(event.clientX, event.clientY); } else lastTap = now;
        }
        gesture = pointers.size ? gesture : null;
    };

    const layoutPhoto = () => {
        const img = q('[data-pcam-preview] img');
        const zoom = q('[data-pcam-zoom]');
        const photo = q('[data-pcam-photo]');
        if (!img || !zoom || !photo) return;
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        const tall = nw > 0 && nh / nw > 1.8;
        q('[data-pcam-zoom-fit]').hidden = !tall;
        q('[data-pcam-photo]').classList.toggle('is-tall', tall);
        const pw = photo.clientWidth - 24;
        const ph = photo.clientHeight - 24;
        if (!nw || !nh || pw <= 0 || ph <= 0) return;
        const fit = Math.min(pw / nw, ph / nh);
        zoom.style.width = `${Math.round(nw * fit)}px`;
        zoom.style.height = `${Math.round(nh * fit)}px`;
    };

    /** Arma la vista previa una sola vez por foto; luego solo se actualiza lo que cambia. */
    const buildPreview = () => {
        const host = q('[data-pcam-preview-host]');
        clearTimeout(receivedTimer); receivedTimer = null;
        const item = items[previewIndex];
        if (!item) { resizeObserver?.disconnect(); resizeObserver = null; host.innerHTML = ''; shown = { id: null, sig: '', phase: '' }; return; }
        view = { s: 1, px: 0, py: 0, focus: -1, fit: false };
        resizeObserver?.disconnect(); resizeObserver = null;
        host.innerHTML = `<div class="pcam-preview" data-pcam-preview role="dialog" aria-modal="true" aria-label="Vista previa de la factura ${previewIndex + 1}">
            <header class="pcam-top">
                <button type="button" class="pcam-icon" data-pcam-action="back" aria-label="Volver a la cámara">${ico(ICON.back)}</button>
                <span class="pcam-counter" data-pcam-counter>${counterText()}</span>
                ${pending ? '<button type="button" class="pcam-finish" data-pcam-action="finish">Terminar</button>' : '<span class="pcam-top-spacer"></span>'}
            </header>
            <div class="pcam-photo" data-pcam-photo data-phase="reading">
                <div class="pcam-zoom" data-pcam-zoom data-zoom="1">
                    <img src="${esc(item.full || item.preview)}" alt="Factura ${previewIndex + 1}" draggable="false">
                    <span class="pcam-scan" aria-hidden="true"></span>
                    <span class="pcam-sweep" data-pcam-sweep aria-hidden="true"></span>
                    <span class="pcam-hl" data-pcam-hl hidden aria-hidden="true"></span>
                </div>
                <div class="pcam-seal-host" data-pcam-seal-host></div>
                <button type="button" class="pcam-nav is-prev" data-pcam-prev aria-label="Foto anterior"${stepIndex(-1) < 0 ? ' disabled' : ''}>${ico(ICON.back)}</button>
                <button type="button" class="pcam-nav is-next" data-pcam-next aria-label="Foto siguiente"${stepIndex(1) < 0 || stepIndex(1) >= items.length ? ' disabled' : ''}>${ico(ICON.next)}</button>
                <span class="pcam-zoomhint" data-pcam-zoomhint>Toca dos veces para acercar</span>
                <div class="pcam-zoombar" role="group" aria-label="Zoom de la foto">
                    <button type="button" class="pcam-zb" data-pcam-zoom-in aria-label="Acercar">+</button>
                    <button type="button" class="pcam-zb" data-pcam-zoom-out aria-label="Alejar">−</button>
                    <button type="button" class="pcam-zb" data-pcam-zoom-fit aria-label="Ajustar al ancho para leerla completa" hidden>${ico(ICON.fit, 18)}</button>
                </div>
            </div>
            <div class="pcam-meta">
                <span class="pcam-chip" data-pcam-chip role="status"></span>
                <div class="pcam-dots" data-pcam-dots></div>
            </div>
            <section class="pcam-sheet" data-pcam-sheet></section>
        </div>`;
        const photo = q('[data-pcam-photo]');
        photo.addEventListener('pointerdown', onPhotoDown);
        photo.addEventListener('pointermove', onPhotoMove);
        photo.addEventListener('pointerup', onPhotoUp);
        photo.addEventListener('pointercancel', onPhotoUp);
        // Con mouse; en el teléfono el doble toque ya lo atendió pointerup (no repetirlo).
        photo.addEventListener('dblclick', (e) => {
            if (e.target?.closest?.('button') || Date.now() - lastTouchToggle < 600) return;
            toggleZoomAt(e.clientX, e.clientY);
        });
        q('[data-pcam-preview] img').addEventListener('load', layoutPhoto);
        // El panel de abajo cambia de alto al llegar el resultado: la foto se reajusta.
        if (typeof ResizeObserver === 'function') {
            resizeObserver = new ResizeObserver(() => { layoutPhoto(); view = { ...view, ...clampView(view.s, view.px, view.py) }; applyView({ keepFocus: true }); });
            resizeObserver.observe(photo);
        }
        applyView();
        // Ya leída al abrirla: el sello aparece quieto en la esquina, sin repetir la animación.
        paintResult(item, { animate: false });
    };

    const paint = () => {
        if (!root) return;
        paintBar();
        const item = items[previewIndex];
        const open = q('[data-pcam-preview]');
        if (!item) { if (open) buildPreview(); return; }
        if (!open || shown.id !== item.id) buildPreview();
        else updatePreview();
    };

    const refresh = async () => {
        if (!items.length) return;
        try {
            const states = await getItemsState(items.map(i => i.id));
            for (const item of items) {
                const next = states?.get?.(item.id);
                if (next) Object.assign(item, { state: next.state || item.state, reason: next.reason || null, issues: next.issues || [], data: next.data || {} });
                if (DONE.has(item.state) && !item.noted) {
                    item.noted = true;
                    note('result', { state: item.state, codes: (item.issues || []).map(i => i.code) });
                }
            }
        } catch (_) { /* se reintenta en el siguiente ciclo */ }
        paint();
    };

    // ── Disparo, linterna y factura larga ─────────────────────────────────

    const flash = () => {
        const el = q('[data-pcam-flash]');
        if (!el) return;
        el.hidden = false;
        restart(el, 'is-on');
        setTimeout(() => { if (el) el.hidden = true; }, FLASH_MS);
    };

    // La vista previa muestra la foto que se acaba de tomar a resolución completa
    // (la miniatura guardada mide 480 px y no sirve para acercar); se libera al
    // eliminarla o al cerrar la cámara.
    const fullUrlFor = (file) => {
        try { return file && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : ''; } catch (_) { return ''; }
    };
    const releaseFull = (item) => { if (item?.full) { try { URL.revokeObjectURL(item.full); } catch (_) { /* ya liberada */ } } };

    const addItem = (saved, file) => {
        items.push({ id: saved.id, preview: saved.previewUrl || '', full: fullUrlFor(file), state: 'reading', reason: null, issues: [], data: {} });
        paint();
        restart(q('[data-pcam-stack]'), 'is-drop');
    };

    const paintLong = () => {
        const ghost = q('[data-pcam-ghost]');
        const tagEl = q('[data-pcam-ghost-tag]');
        const edge = q('[data-pcam-ghost-edge]');
        const context = q('[data-pcam-ghost-context]');
        const showGhost = long.on && long.parts.length > 0 && long.parts.length < MAX_PARTS;
        ghost.hidden = !showGhost;
        tagEl.hidden = !showGhost;
        edge.hidden = !showGhost;
        context.hidden = !showGhost;
        q('[data-pcam-period]').hidden = showGhost;
        const match = q('[data-pcam-match]');
        // Línea verde donde se ve en vivo el final de la parte anterior (lo nuevo empieza ahí).
        const seen = showGhost && (long.status === 'ok' || long.status === 'below') && Number.isFinite(long.yFrac);
        match.hidden = !seen;
        if (seen) match.style.top = `${Math.round((long.yFrac + OVERLAP_FRACTION) * 100)}%`;
        [ghost, tagEl, edge, match].forEach(el => el.classList.toggle('is-aligned', showGhost && long.aligned));
        q('[data-pcam-shutter]').classList.toggle('is-ready', showGhost && long.aligned);
        q('[data-pcam-shutter]').setAttribute('aria-label', long.on ? `Tomar parte ${long.parts.length + 1}` : 'Tomar foto');
        if (showGhost) {
            const n = long.parts.length;
            tagEl.textContent = {
                ok: `✓ Listo · toma la parte ${n + 1}`,
                below: 'Sigue bajando ↓',
                lost: `No encuentro el final de la parte ${n} · misma distancia`,
                unsure: 'Baja despacio…',
                flat: 'Sin texto para guiar · deja un poco repetido'
            }[long.status] || `Ya tomada la parte ${n} · baja el teléfono`;
        }
        paintBar();
    };

    /**
     * El recuadro toma la forma de la foto (como object-fit: contain): se ve
     * la imagen completa de la cámara, y lo que se ve es lo que se guarda.
     */
    const layoutFrame = () => {
        const view = q('[data-pcam-view]');
        const frame = q('[data-pcam-frame]');
        const video = q('[data-pcam-video]');
        const vw = video?.videoWidth;
        const vh = video?.videoHeight;
        const aw = view?.clientWidth;
        const ah = view?.clientHeight;
        if (!frame || !vw || !vh || !aw || !ah) return;
        const fit = Math.min(aw / vw, ah / vh);
        frame.style.width = `${Math.round(vw * fit)}px`;
        frame.style.height = `${Math.round(vh * fit)}px`;
        layoutGhostContext();
    };

    /**
     * Encima del recuadro (de la parte de arriba de la pantalla hasta el borde
     * del recuadro) se ve lo que había antes de la franja en la parte anterior,
     * a la misma escala: la factura "continúa" hacia arriba.
     */
    const layoutGhostContext = () => {
        const context = q('[data-pcam-ghost-context]');
        const frame = q('[data-pcam-frame]');
        const part = long.parts[long.parts.length - 1];
        if (!context || !frame || !part || !root) return;
        const rootRect = root.getBoundingClientRect();
        const rect = frame.getBoundingClientRect();
        const above = rect.top - rootRect.top;
        const photoW = part.bitmap?.width || part.bitmap?.naturalWidth;
        if (above <= 0 || !rect.width || !photoW) return;
        Object.assign(context.style, { left: `${rect.left - rootRect.left}px`, top: '0px', width: `${rect.width}px`, height: `${above}px` });
        try { drawGhostContext(context, part.bitmap, above * (photoW / rect.width)); } catch (_) { /* sin contexto */ }
    };

    const stopAlign = () => { clearInterval(alignTimer); alignTimer = null; };
    // Estadística de la guía para la parte que se está buscando (diagnóstico).
    let partStats = null;
    const resetPartStats = () => { partStats = { start: clock(), checks: 0, totalMs: 0, counts: {}, bestNcc: null, msToOk: null }; };
    /** Al tomar una parte con la guía activa: qué decía en ese momento. */
    function notePart() {
        if (!long.parts.length || !partStats) return;
        note('part', {
            status: long.status || null,
            ncc: Number.isFinite(long.ncc) ? Math.round(long.ncc * 100) / 100 : null,
            yFrac: Number.isFinite(long.yFrac) ? Math.round(long.yFrac * 100) / 100 : null,
            checks: partStats.checks,
            checkMs: partStats.checks ? Math.round(partStats.totalMs / partStats.checks) : 0,
            bestNcc: partStats.bestNcc,
            msToOk: partStats.msToOk,
            counts: partStats.counts
        });
    }
    const startAlign = () => {
        stopAlign();
        alignTimer = setInterval(() => {
            if (!long.on || !long.band || long.parts.length >= MAX_PARTS) return;
            let r = null;
            const checkStart = clock();
            try { r = checkAlignment(q('[data-pcam-video]'), long.band); } catch (_) { r = null; }
            if (partStats) {
                partStats.checks += 1;
                partStats.totalMs += clock() - checkStart;
                const key = r?.status || (r?.aligned ? 'ok' : 'lost');
                partStats.counts[key] = (partStats.counts[key] || 0) + 1;
                if (Number.isFinite(r?.ncc)) partStats.bestNcc = Math.max(partStats.bestNcc ?? -1, Math.round(r.ncc * 100) / 100);
                if (r?.aligned && partStats.msToOk === null) partStats.msToOk = Math.round(clock() - partStats.start);
            }
            long.ncc = Number.isFinite(r?.ncc) ? r.ncc : null;
            const aligned = !!r?.aligned;
            const status = r?.status || (aligned ? 'ok' : 'lost');
            const yFrac = Number.isFinite(r?.yFrac) ? r.yFrac : null;
            if (aligned === long.aligned && status === long.status && yFrac === long.yFrac) return;
            if (aligned && !long.aligned) vibrate(10);
            Object.assign(long, { aligned, status, yFrac });
            paintLong();
        }, ALIGN_POLL_MS);
    };

    const releaseParts = () => { long.parts.forEach(p => { try { p.bitmap?.close?.(); } catch (_) { /* ya liberada */ } }); };

    const setLong = (on) => {
        if (!on && long.parts.length) {
            const n = long.parts.length;
            notify(`Se ${n === 1 ? 'descartó 1 parte' : `descartaron ${n} partes`} de la factura larga.`, 'info');
        }
        releaseParts();
        long = { on, parts: [], band: null, aligned: false, status: null, yFrac: null };
        stopAlign();
        if (on) showTip(TIP.long);
        paintLong();
    };

    const shootPart = async (shot, videoBand) => {
        if (long.parts.length >= MAX_PARTS) { notify(TIP.full, 'info'); return; }
        const bitmap = await toBitmap(shot);
        long.parts.push({ bitmap });
        Object.assign(long, { aligned: false, status: null, yFrac: null });
        long.band = videoBand;
        try { drawGhost(q('[data-pcam-ghost]'), bitmap); } catch (_) { /* sin franja guía */ }
        layoutGhostContext();
        resetPartStats();
        showTip(long.parts.length >= MAX_PARTS ? TIP.full : TIP.next(long.parts.length));
        paintLong();
        startAlign();
    };

    const mergeParts = async () => {
        if (busy || long.parts.length < 2) return;
        busy = true;
        q('[data-pcam-done]').setAttribute('aria-busy', 'true');
        try {
            await saveChain; // la última parte puede estar procesándose todavía
            const stitchStart = clock();
            let info = {};
            const parts = long.parts.length;
            const blob = await stitch(long.parts.map(p => p.bitmap), { onInfo: (i) => { info = i || {}; } });
            note('stitch', { parts, found: info.found ?? null, total: info.total ?? null, ms: Math.round(clock() - stitchStart) });
            const type = blob.type || 'image/jpeg';
            const file = new File([blob], `factura-larga-${Date.now()}.${extensionFor(type)}`, { type });
            const saved = await capture(file);
            releaseParts();
            long = { on: false, parts: [], band: null, aligned: false, status: null, yFrac: null };
            stopAlign();
            vibrate([12, 50, 12]);
            paintLong();
            addItem(saved, file);
        } catch (error) {
            notify(`No se pudo unir la factura (${error?.message || 'error'}). Las partes siguen aquí.`, 'warning');
        } finally {
            busy = false;
            q('[data-pcam-done]')?.removeAttribute('aria-busy');
        }
    };

    /**
     * Dos pasos: tomar es rápido (la foto del sensor o el cuadro del video) y
     * el botón queda libre enseguida; recortar, codificar y guardar va después,
     * en orden, sin hacer esperar la siguiente foto.
     */
    const runSaving = (task) => {
        const session = sessionId;
        saving += 1;
        paintBar();
        saveChain = saveChain
            .then(() => task(session))
            .catch((error) => { if (session === sessionId) notify(`No se guardó la foto (${error?.message || 'error'}). Puedes tomarla de nuevo.`, 'warning'); })
            .finally(() => { if (session === sessionId) { saving = Math.max(0, saving - 1); paintBar(); } });
    };

    const shoot = async () => {
        if (grabbing || !root) return;
        grabbing = true;
        q('[data-pcam-shutter]')?.setAttribute('aria-busy', 'true');
        vibrate(12);
        flash();
        // Factura larga: la franja para alinear en vivo sale del mismo video que
        // se compara después (la foto del sensor se procesa distinto).
        let videoBand = null;
        if (long.on) { try { videoBand = makeBand(q('[data-pcam-video]')); } catch (_) { videoBand = null; } }
        let shot;
        const grabStart = clock();
        let grabMs = 0;
        try {
            shot = await grabFrame(q('[data-pcam-video]'), track);
            grabMs = Math.round(clock() - grabStart);
        } catch (error) {
            notify(`No se pudo tomar la foto (${error?.message || 'error'}). Inténtalo de nuevo.`, 'warning');
            return;
        } finally {
            grabbing = false;
            q('[data-pcam-shutter]')?.removeAttribute('aria-busy');
        }
        const origin = shot?.origin || 'other';
        if (long.on) {
            notePart();
            runSaving(async (session) => { if (session === sessionId) await shootPart(shot, videoBand); });
            note('shot', { origin, grabMs, saveMs: 0, kb: 0, mime: null, long: true });
            return;
        }
        runSaving(async (session) => {
            const saveStart = clock();
            const blob = await toPhoto(shot);
            const type = blob.type || 'image/jpeg';
            const file = new File([blob], `factura-${Date.now()}.${extensionFor(type)}`, { type });
            const saved = await capture(file); // entra a la cola aunque ya se haya cerrado la cámara
            note('shot', { origin, grabMs, saveMs: Math.round(clock() - saveStart), kb: Math.round(blob.size / 1024), mime: type, long: false });
            if (session === sessionId) addItem(saved, file);
        });
    };

    const setupTorch = () => {
        const button = q('[data-pcam-torch]');
        let supported = false;
        try { supported = !!track?.getCapabilities?.()?.torch; } catch (_) { supported = false; }
        button.hidden = !supported;
        q('[data-pcam-torch-spacer]').hidden = supported;
    };
    const toggleTorch = async () => {
        const next = !torchOn;
        try {
            await track.applyConstraints({ advanced: [{ torch: next }] });
            torchOn = next;
            q('[data-pcam-torch]')?.setAttribute('aria-pressed', String(torchOn));
        } catch (_) {
            notify('No se pudo usar la linterna en este teléfono.', 'warning');
        }
    };

    // ── Navegación ────────────────────────────────────────────────────────

    // ── Corregir desde la vista previa ────────────────────────────────────

    const isPending = (item) => item.state === 'review' || item.state === 'failed';
    const pendingIndexes = () => items.map((it, i) => (isPending(it) ? i : -1)).filter(i => i >= 0);
    // Orden y total con que empezó "pendientes": la cuenta no cambia al ir resolviendo.
    let pendingOrder = [];
    function counterText() {
        if (!pending) return `${previewIndex + 1} de ${items.length}`;
        const pos = pendingOrder.indexOf(items[previewIndex]?.id);
        return `Pendiente ${pos + 1} de ${pendingOrder.length}`;
    }

    const finish = (message) => {
        const ids = items.map(i => i.id);
        close();
        onFinish(ids);
        if (message) notify(message, 'success');
    };

    /** "Listo": si hay facturas por revisar o sin datos, se recorren solo esas. */
    const startPending = () => {
        const list = pendingIndexes();
        if (!list.length) { finish(); return; }
        pending = true;
        pendingOrder = list.map(i => items[i].id);
        shown = { id: null, sig: '', phase: '' };
        openPreview(list[0]);
    };

    function scheduleNextPending(resolvedId) {
        clearTimeout(advanceTimer);
        advanceTimer = setTimeout(() => {
            advanceTimer = null;
            if (!pending || items[previewIndex]?.id !== resolvedId) return;
            const next = pendingIndexes();
            if (!next.length) { finish('Todo listo ✓ Las facturas quedaron revisadas.'); return; }
            openPreview(next.find(i => i > previewIndex) ?? next[0]);
        }, RESOLVED_ADVANCE_MS);
    }

    const applyFix = async (button) => {
        const item = items[previewIndex];
        const [i, j] = button.dataset.pcamFix.split(':').map(Number);
        const issue = item?.issues?.[i];
        const fix = issue && fixesFor(issue)[j];
        if (!fix) return;
        let change = null;
        if (fix.kind === 'apply') change = { patch: fix.patch };
        else if (fix.kind === 'accept') change = { accept: fix.code };
        else {
            const result = validateFixInput(fix.validate, q(`[data-pcam-fix-input="${i}:${j}"]`)?.value);
            if (!result.ok) return;
            change = { patch: result.patch };
        }
        const card = button.closest('[data-pcam-issue-card]');
        card?.classList.add('is-resolving');
        button.disabled = true;
        let ok = false;
        try { ok = await onFix(item.id, change); } catch (_) { ok = false; }
        if (!ok) {
            card?.classList.remove('is-resolving');
            button.disabled = false;
            notify('No se pudo guardar la corrección. Inténtalo de nuevo.', 'warning');
            return;
        }
        vibrate(8);
        note('fix', { code: issue.code, kind: fix.kind });
        await refresh();
    };

    const onInput = (event) => {
        const input = event.target;
        if (!input?.matches?.('[data-pcam-fix-input]')) return;
        const { ok } = validateFixInput(input.dataset.validate, input.value);
        input.classList.toggle('is-valid', ok);
        const save = q(`[data-pcam-fix="${input.dataset.pcamFixInput}"]`);
        if (save) save.disabled = !ok;
    };

    const openPreview = (index) => {
        if (!items[index]) return;
        previewIndex = index;
        trayOpen = false;
        paint();
        q('[data-pcam-preview] [data-pcam-action="back"]')?.focus?.();
    };
    const closePreview = () => { previewIndex = -1; pending = false; clearTimeout(advanceTimer); paint(); };

    const removeItem = async (index) => {
        const item = items[index];
        if (!item) return false;
        let ok = false;
        try { ok = await onDelete(item.id); } catch (_) { ok = false; }
        if (!ok) return false;
        releaseFull(item);
        items.splice(index, 1);
        previewIndex = items.length ? Math.min(index, items.length - 1) : -1;
        shown = { id: null, sig: '', phase: '' };
        paint();
        return true;
    };

    const onClick = (event) => {
        const t = event.target?.closest?.('button');
        if (!t || !root?.contains(t)) return;
        if (t.matches('[data-pcam-close]')) { close(); return; }
        if (t.matches('[data-pcam-shutter]')) { shoot(); return; }
        if (t.matches('[data-pcam-torch]')) { toggleTorch(); return; }
        if (t.matches('[data-pcam-long]')) { setLong(!long.on); return; }
        if (t.matches('[data-pcam-done]')) {
            if (long.on) { mergeParts(); return; }
            startPending(); return;
        }
        if (t.matches('[data-pcam-fix]')) { applyFix(t); return; }
        if (t.matches('[data-pcam-stack]')) { if (items.length) { trayOpen = !trayOpen; paint(); } return; }
        if (t.matches('[data-pcam-thumb]')) { openPreview(Number(t.dataset.pcamThumb)); return; }
        if (t.matches('[data-pcam-prev]')) { openPreview(stepIndex(-1)); return; }
        if (t.matches('[data-pcam-next]')) { openPreview(stepIndex(1)); return; }
        if (t.matches('[data-pcam-zoom-in]')) { setZoom(Math.floor(view.s) + 1); return; }
        if (t.matches('[data-pcam-zoom-out]')) { setZoom(Math.ceil(view.s) - 1); return; }
        if (t.matches('[data-pcam-zoom-fit]')) { fitWidth(); return; }
        if (t.matches('[data-pcam-issue]')) { focusIssue(Number(t.dataset.pcamIssue)); return; }
        const action = t.dataset.pcamAction;
        if (action === 'back') closePreview();
        else if (action === 'finish') finish();
        else if (action === 'delete') removeItem(previewIndex);
        else if (action === 'retake') removeItem(previewIndex).then((ok) => { if (ok) closePreview(); });
        else if (action === 'review') { const id = items[previewIndex]?.id; close(); if (id) onReview(id); }
    };

    /** Anterior/siguiente: en "pendientes", solo entre las que faltan. */
    function stepIndex(step) {
        if (!pending) return previewIndex + step;
        const list = pendingIndexes();
        const pos = list.indexOf(previewIndex);
        return list[(pos < 0 ? 0 : pos) + step] ?? -1;
    }

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
            // 4:3 como el sensor: así la foto completa (takePhoto) coincide con lo que se ve.
            stream = await mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } }, audio: false });
        } catch (error) {
            stream = null;
            notify('No se pudo abrir la cámara dentro de la app. Se abrirá la cámara del teléfono.', 'warning');
            fallbackPick();
            return;
        }
        track = stream.getVideoTracks?.()[0] || null;
        sessionId += 1;
        saving = 0;
        torchOn = false;
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
        video.addEventListener('loadedmetadata', layoutFrame);
        video.addEventListener('resize', layoutFrame); // la cámara cambia de tamaño al girar el teléfono
        if (typeof ResizeObserver === 'function') {
            viewObserver = new ResizeObserver(layoutFrame);
            viewObserver.observe(q('[data-pcam-view]'));
        }
        video.srcObject = stream;
        try { await video.play?.(); } catch (_) { /* autoplay ya lo inicia */ }
        layoutFrame();
        setupTorch();
        root.addEventListener('click', onClick);
        root.addEventListener('input', onInput);
        doc.addEventListener('keydown', onKey);
        pollTimer = setInterval(refresh, CAMERA_POLL_MS);
        paint();
        showTip(TIP.start);
        q('[data-pcam-shutter]')?.focus?.();
    }

    function close() {
        clearInterval(pollTimer); pollTimer = null;
        clearTimeout(receivedTimer); receivedTimer = null;
        clearTimeout(tipTimer); tipTimer = null;
        clearTimeout(advanceTimer); advanceTimer = null;
        pending = false;
        stopAlign();
        releaseParts();
        resizeObserver?.disconnect(); resizeObserver = null;
        viewObserver?.disconnect(); viewObserver = null;
        long = { on: false, parts: [], band: null, aligned: false, status: null, yFrac: null };
        stream?.getTracks?.().forEach(t => { try { t.stop(); } catch (_) { /* ya detenida */ } });
        stream = null; track = null; torchOn = false;
        if (root) {
            root.removeEventListener('click', onClick);
            root.removeEventListener('input', onInput);
            root.remove();
            root = null;
        }
        doc.removeEventListener('keydown', onKey);
        doc.body.classList.remove('pcam-open');
        items.forEach(releaseFull);
        sessionId += 1; // lo que aún se esté guardando entra a la cola, pero ya no a esta tanda
        items = []; trayOpen = false; previewIndex = -1; busy = false; grabbing = false; saving = 0;
        barSig = ''; traySig = ''; shown = { id: null, sig: '', phase: '' };
        pointers.clear(); gesture = null;
        lastFocus?.focus?.();
    }

    return { open, close, refresh, openPreview, isOpen: () => !!root, items: () => items.slice() };
}
