/**
 * Editor de esquinas: la foto de la factura con cuatro esquinas que se arrastran hasta las del
 * papel, para enderezarla (como en las apps de escaneo). Es una capa propia sobre la pantalla,
 * fuera del árbol que se repinta, con su propio ciclo de vida: `openCornerEditor` la crea y
 * `close()` la quita. Mientras se arrastra se ve una lupa (el dedo tapa la esquina) y un
 * segundo dedo cancela el arrastre. No sabe nada de guardar: entrega las esquinas con
 * `onApply(corners)` y el dueño decide (devuelve true para cerrar, false o un error para seguir).
 *
 * Probado en js/tests/PettyCashCornerEditor.test.js.
 */
import { isValidQuad, moveCorner } from './PettyCashCorners.js';

const NAMES = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];
const KEY_STEP = 0.005;
const LOUPE_SIZE = 104;
const LOUPE_VIEW = 0.1;            // la lupa muestra este tramo (fracción de la foto) alrededor de la esquina

const pct = (v) => +(v * 100).toFixed(2);
let current = null;

export function openCornerEditor({ doc = document, canvas, corners, onApply, onCancel, onAuto = null, title = 'Ajusta las esquinas', hint = 'Arrastra cada punto hasta una esquina de la factura.' } = {}) {
    current?.close();
    let quad = corners.map((p) => p.slice());
    let busy = false;
    let drag = null;
    let closed = false;
    const touches = new Set();
    const returnFocus = doc.activeElement;

    const root = doc.createElement('div');
    root.className = 'pcc';
    root.setAttribute('data-pcc', '');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Ajustar las esquinas de la factura');
    root.innerHTML = `
        <div class="pcc-head"><strong>${title}</strong><span>${hint}</span></div>
        <div class="pcc-stage">
            <div class="pcc-frame" data-pcc-frame>
                <svg class="pcc-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path class="pcc-dim" data-pcc-dim fill-rule="evenodd"></path>
                    <polygon class="pcc-poly" data-pcc-poly vector-effect="non-scaling-stroke"></polygon>
                </svg>
                ${NAMES.map((name, i) => `<button type="button" class="pcc-handle" data-pcc-handle="${i}" aria-label="Esquina ${name}"></button>`).join('')}
                <canvas class="pcc-loupe" data-pcc-loupe width="${LOUPE_SIZE}" height="${LOUPE_SIZE}" hidden></canvas>
            </div>
        </div>
        <p class="pcc-error" data-pcc-error role="alert" hidden></p>
        <div class="pcc-actions">
            <button type="button" class="pcc-btn" data-pcc-cancel>Cancelar</button>
            ${onAuto ? '<button type="button" class="pcc-btn" data-pcc-auto>Automático</button>' : ''}
            <button type="button" class="pcc-btn pcc-btn--primary" data-pcc-apply>Enderezar</button>
        </div>`;

    const frame = root.querySelector('[data-pcc-frame]');
    const handles = [...root.querySelectorAll('[data-pcc-handle]')];
    const poly = root.querySelector('[data-pcc-poly]');
    const dim = root.querySelector('[data-pcc-dim]');
    const loupe = root.querySelector('[data-pcc-loupe]');
    const applyBtn = root.querySelector('[data-pcc-apply]');
    const cancelBtn = root.querySelector('[data-pcc-cancel]');
    const autoBtn = root.querySelector('[data-pcc-auto]');
    const errorEl = root.querySelector('[data-pcc-error]');

    canvas.classList.add('pcc-canvas');
    frame.insertBefore(canvas, frame.firstChild);

    const valid = () => isValidQuad(quad);
    const render = () => {
        const points = quad.map(([x, y]) => `${pct(x)},${pct(y)}`);
        poly.setAttribute('points', points.join(' '));
        dim.setAttribute('d', `M0 0H100V100H0Z M${points.join(' L')} Z`);
        handles.forEach((h, i) => { h.style.left = `${pct(quad[i][0])}%`; h.style.top = `${pct(quad[i][1])}%`; });
        const ok = valid();
        root.setAttribute('data-invalid', String(!ok));
        applyBtn.disabled = busy || !ok;
        cancelBtn.disabled = busy;
        if (autoBtn) autoBtn.disabled = busy;
    };

    const showLoupe = (index) => {
        loupe.hidden = false;
        loupe.setAttribute('data-side', quad[index][0] < 0.5 ? 'right' : 'left');
        const ctx = loupe.getContext?.('2d');
        if (!ctx || !canvas.width) return;
        const [x, y] = quad[index];
        const sw = canvas.width * LOUPE_VIEW; const sh = sw;
        try { ctx.drawImage(canvas, x * canvas.width - sw / 2, y * canvas.height - sh / 2, sw, sh, 0, 0, LOUPE_SIZE, LOUPE_SIZE); } catch (_) { /* sin lupa */ }
    };
    const hideLoupe = () => { loupe.hidden = true; };

    const endDrag = (restore) => {
        if (!drag) return;
        if (restore) quad = quad.map((p, i) => (i === drag.index ? drag.from.slice() : p));
        drag = null;
        hideLoupe();
        render();
    };

    const onDown = (e) => {
        touches.add(e.pointerId);
        if (touches.size > 1) { endDrag(true); return; }
        const handle = e.target.closest?.('[data-pcc-handle]');
        if (!handle || busy) return;
        const index = Number(handle.getAttribute('data-pcc-handle'));
        drag = { index, from: quad[index].slice(), id: e.pointerId };
        if (e.cancelable) e.preventDefault();
        try { handle.setPointerCapture?.(e.pointerId); } catch (_) { /* sigue por la capa */ }
        showLoupe(index);
    };
    const onMove = (e) => {
        if (!drag || touches.size > 1 || e.pointerId !== drag.id) return;
        const rect = frame.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return;
        quad = moveCorner(quad, drag.index, { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height });
        render();
        showLoupe(drag.index);
    };
    const onUp = (e) => {
        touches.delete(e.pointerId);
        if (drag && e.pointerId === drag.id) endDrag(false);
    };
    const onKey = (e) => {
        const handle = e.target.closest?.('[data-pcc-handle]');
        if (!handle || busy) return;
        const step = (e.shiftKey ? 4 : 1) * KEY_STEP;
        const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (!delta) return;
        e.preventDefault();
        const index = Number(handle.getAttribute('data-pcc-handle'));
        quad = moveCorner(quad, index, { x: quad[index][0] + delta[0], y: quad[index][1] + delta[1] });
        render();
    };

    const close = () => {
        if (closed) return;
        closed = true;
        doc.removeEventListener('keydown', onEscape);
        canvas.classList.remove('pcc-canvas');
        canvas.remove();
        root.remove();
        if (current === api) current = null;
        try { returnFocus?.focus?.(); } catch (_) { /* sin foco previo */ }
    };
    const cancel = () => { if (busy) return; close(); onCancel?.(); };
    function onEscape(e) { if (e.key === 'Escape') cancel(); }

    const apply = async () => {
        if (busy || !valid()) return;
        busy = true;
        root.setAttribute('aria-busy', 'true');
        applyBtn.textContent = 'Enderezando…';
        errorEl.hidden = true;
        render();
        try {
            const ok = await onApply?.(quad.map((p) => p.slice()));
            if (ok === false) throw new Error('');
            close();
            return;
        } catch (error) {
            if (error?.message) { errorEl.textContent = `No se pudo enderezar: ${error.message}`; errorEl.hidden = false; }
        }
        busy = false;
        root.removeAttribute('aria-busy');
        applyBtn.textContent = 'Enderezar';
        render();
    };

    root.addEventListener('pointerdown', onDown);
    root.addEventListener('pointermove', onMove);
    root.addEventListener('pointerup', onUp);
    root.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); endDrag(true); });
    root.addEventListener('keydown', onKey);
    cancelBtn.addEventListener('click', cancel);
    applyBtn.addEventListener('click', apply);
    autoBtn?.addEventListener('click', () => {
        const next = onAuto?.();
        if (Array.isArray(next) && isValidQuad(next)) { quad = next.map((p) => p.slice()); render(); }
    });
    doc.addEventListener('keydown', onEscape);

    render();
    doc.body.appendChild(root);
    try { applyBtn.focus?.(); } catch (_) { /* sin foco */ }
    const api = { close, getCorners: () => quad.map((p) => p.slice()) };
    current = api;
    return api;
}
