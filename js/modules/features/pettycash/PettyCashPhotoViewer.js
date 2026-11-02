/**
 * Visor de la foto de la factura (pellizco, arrastre, rueda, doble toque) y
 * divisor entre la foto y el formulario.
 *
 * - Un solo grupo de escuchas en el documento: el editor se vuelve a pintar muchas
 *   veces y los elementos cambian. Cada vez que aparece una foto nueva
 *   (`[data-pcn-stage]` sin `data-vready`) se le aplica la vista guardada.
 * - La vista (`{s, x, y}`) vive en el estado de pantalla del editor: sobrevive a
 *   los repintados. Durante un gesto solo se mueve lo que se ve; se guarda al soltar.
 * - Al cambiar de dato (`data-key`) acerca al recuadro del nuevo; si el dato no
 *   tiene recuadro, deja la foto como está.
 * - Con el modo de marcar activo (`data-edit`) un dedo traza el recuadro (lo
 *   atiende PettyCashBoxEditor); dos dedos siempre hacen zoom.
 *
 * Probado en js/tests/PettyCashPhotoViewer.test.js.
 */
import {
    minScale, maxScale, clampView, zoomAt, pinchView, viewForBox, fitWidthView, fitAllView, zoomStep
} from './PettyCashViewerMath.js';

const TAP_MS = 320;
const TAP_SLOP = 28;
const MOVE_SLOP = 6;
const DOUBLE_TAP_SCALE = 2.6;
const SPLIT_MIN = 20;
const SPLIT_MAX = 75;
const IGNORE = 'button, a, input, label, select, textarea, [data-pcn-fbar], [data-pcn-zbar]';

const parseBox = (text) => {
    const box = String(text || '').split(',').map(Number);
    return box.length === 4 && box.every((n) => Number.isFinite(n) && n >= 0 && n <= 1000) && box[0] < box[2] && box[1] < box[3] ? box : null;
};

export function attachPhotoViewer({ doc = document, win = (typeof window !== 'undefined' ? window : {}), getUi, setUi } = {}) {
    const pointers = new Map();       // id → {x, y} (los que empezaron dentro de la ventana)
    let gesture = null;               // {kind:'pan'|'pinch', stage, winEl, ...}
    let lastTap = null;
    let splitDrag = null;
    let observer = null;

    // ── geometría ──────────────────────────────────────────────────────────
    const geometry = (stage) => {
        const winEl = stage?.closest?.('[data-pcn-win]');
        const img = stage?.querySelector?.('img');
        if (!winEl || !img) return null;
        const rect = winEl.getBoundingClientRect();
        const naturalW = img.naturalWidth;
        const naturalH = img.naturalHeight;
        if (!(rect.width > 0) || !(rect.height > 0) || !(naturalW > 0) || !(naturalH > 0)) return null;
        const size = { w: rect.width, h: rect.height };
        const content = { w: rect.width, h: rect.width * (naturalH / naturalW) };
        const limits = { min: minScale(size, content), max: maxScale({ winW: rect.width, naturalW, dpr: win.devicePixelRatio || 1 }) };
        return { winEl, rect, size, content, limits };
    };

    const apply = (stage, view, geo) => {
        stage.__pcnView = view;
        stage.style.transform = `translate(${+view.x.toFixed(2)}px, ${+view.y.toFixed(2)}px) scale(${+view.s.toFixed(4)})`;
        stage.style.setProperty('--inv', String(+(1 / view.s).toFixed(4)));
        const label = stage.closest('.pcn-winwrap')?.querySelector('[data-pcn-zoom-pct]');
        if (label) label.textContent = `${Math.round(view.s * 100)} %`;
        return geo;
    };

    const animateTo = (stage, from, to, geo) => {
        if (from) {
            apply(stage, from, geo);
            void stage.offsetWidth;   // fija el punto de partida antes de animar
        }
        stage.classList.add('is-anim');
        apply(stage, to, geo);
        setTimeout(() => stage.classList.remove('is-anim'), 280);
    };

    const persist = (stage, view) => {
        setUi?.({ view: { s: view.s, x: view.x, y: view.y }, viewKey: stage.dataset.key || null });
    };

    const currentView = (stage, geo) => {
        const ui = getUi?.() || {};
        return stage.__pcnView || (ui.view ? clampView(ui.view, geo.size, geo.content, geo.limits) : fitWidthView());
    };

    // ── sincronizar una foto recién pintada ───────────────────────────────
    const sync = (stage) => {
        if (!stage) return;
        if (!stage.hasAttribute('data-vready')) stage.setAttribute('data-vready', '');
        const geo = geometry(stage);
        if (!geo) return;   // la imagen aún no cargó: se vuelve a intentar en `load`
        const ui = getUi?.() || {};
        const key = stage.dataset.key || null;
        const box = parseBox(stage.dataset.box);
        const stored = ui.view ? clampView(ui.view, geo.size, geo.content, geo.limits) : null;
        if (stored && ui.viewKey === key) { apply(stage, stored, geo); return; }
        if (box) {
            const target = viewForBox(box, geo.size, geo.content, geo.limits);
            if (stored) animateTo(stage, stored, target, geo); else apply(stage, target, geo);
            persist(stage, target);
            return;
        }
        const view = stored || fitWidthView();
        apply(stage, view, geo);
        persist(stage, view);
    };

    const syncAll = () => {
        doc.querySelectorAll('[data-pcn-stage]').forEach((stage) => sync(stage));
    };

    // ── comandos de los botones ───────────────────────────────────────────
    const command = (name) => {
        const stage = doc.querySelector('[data-pcn-stage]');
        const geo = geometry(stage);
        if (!stage || !geo) return;
        const from = currentView(stage, geo);
        const centre = { x: geo.size.w / 2, y: geo.size.h / 2 };
        let to = from;
        if (name === 'in') to = zoomStep(from, 1, centre, geo.size, geo.content, geo.limits);
        else if (name === 'out') to = zoomStep(from, -1, centre, geo.size, geo.content, geo.limits);
        else if (name === 'all') to = fitAllView(geo.size, geo.content, geo.limits);
        else if (name === 'fit') to = fitWidthView();
        else if (name === 'box') {
            const box = parseBox(stage.dataset.box);
            to = box ? viewForBox(box, geo.size, geo.content, geo.limits) : fitWidthView();
        } else return;
        to = clampView(to, geo.size, geo.content, geo.limits);
        animateTo(stage, null, to, geo);
        persist(stage, to);
    };

    // ── gestos ────────────────────────────────────────────────────────────
    const point = (e) => ({ x: e.clientX, y: e.clientY });
    const local = (geo, p) => ({ x: p.x - geo.rect.left, y: p.y - geo.rect.top });

    const beginPan = (stage, geo, id) => {
        const p = pointers.get(id);
        gesture = { kind: 'pan', stage, geo, id, from: p, start: currentView(stage, geo), moved: false };
    };
    const beginPinch = (stage, geo) => {
        const [a, b] = [...pointers.values()];
        gesture = { kind: 'pinch', stage, geo, from: [{ ...a }, { ...b }], start: currentView(stage, geo), moved: true };
    };

    const onDown = (e) => {
        const split = e.target.closest?.('[data-pcn-split]');
        if (split) { startSplit(e, split); return; }
        const winEl = e.target.closest?.('[data-pcn-win]');
        if (!winEl || e.target.closest?.(IGNORE)) return;
        const stage = winEl.querySelector('[data-pcn-stage]');
        const geo = geometry(stage);
        if (!stage || !geo) return;
        pointers.set(e.pointerId, point(e));
        try { winEl.setPointerCapture?.(e.pointerId); } catch { /* sin captura: sigue por el documento */ }
        if (pointers.size >= 2) { beginPinch(stage, geo); lastTap = null; return; }
        if (stage.dataset.edit) { gesture = { kind: 'edit', stage, geo, id: e.pointerId, from: point(e), moved: false }; return; }
        beginPan(stage, geo, e.pointerId);
    };

    const onMove = (e) => {
        if (splitDrag) { moveSplit(e); return; }
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, point(e));
        if (!gesture) return;
        const { stage, geo } = gesture;
        if (gesture.kind === 'pinch' && pointers.size >= 2) {
            const [a, b] = [...pointers.values()];
            const from = gesture.from.map((p) => local(geo, p));
            const view = pinchView(gesture.start, from, [local(geo, a), local(geo, b)], geo.size, geo.content, geo.limits);
            apply(stage, view, geo);
            return;
        }
        if (gesture.kind === 'pan' && e.pointerId === gesture.id) {
            const dx = e.clientX - gesture.from.x;
            const dy = e.clientY - gesture.from.y;
            if (!gesture.moved && Math.hypot(dx, dy) < MOVE_SLOP) return;
            gesture.moved = true;
            apply(stage, clampView({ s: gesture.start.s, x: gesture.start.x + dx, y: gesture.start.y + dy }, geo.size, geo.content, geo.limits), geo);
        } else if (gesture.kind === 'edit' && Math.hypot(e.clientX - gesture.from.x, e.clientY - gesture.from.y) >= MOVE_SLOP) {
            gesture.moved = true;
        }
    };

    const onUp = (e) => {
        if (splitDrag) { endSplit(); return; }
        if (!pointers.has(e.pointerId)) return;
        const wasGesture = gesture;
        pointers.delete(e.pointerId);
        if (!wasGesture) return;
        const { stage, geo } = wasGesture;
        const view = stage.__pcnView;
        if (wasGesture.kind === 'pinch') {
            if (view) persist(stage, view);
            // Si queda un dedo, sigue arrastrando desde donde está.
            if (pointers.size === 1 && !stage.dataset.edit) beginPan(stage, geo, [...pointers.keys()][0]);
            else gesture = null;
            return;
        }
        gesture = null;
        if (wasGesture.moved) { if (view && wasGesture.kind === 'pan') persist(stage, view); return; }
        if (wasGesture.kind !== 'pan') return;
        // Toque sin arrastrar: ¿doble toque?
        const now = Date.now();
        const here = point(e);
        if (lastTap && now - lastTap.t <= TAP_MS && Math.hypot(here.x - lastTap.x, here.y - lastTap.y) <= TAP_SLOP) {
            lastTap = null;
            const from = currentView(stage, geo);
            const to = from.s > 1.5 ? fitWidthView() : zoomAt(from, DOUBLE_TAP_SCALE / from.s, local(geo, here), geo.size, geo.content, geo.limits);
            animateTo(stage, null, clampView(to, geo.size, geo.content, geo.limits), geo);
            persist(stage, stage.__pcnView);
        } else {
            lastTap = { t: now, x: here.x, y: here.y };
        }
    };

    const onCancel = (e) => {
        if (splitDrag) { endSplit(); return; }
        pointers.delete(e.pointerId);
        if (gesture && pointers.size === 0) {
            const { stage } = gesture;
            if (stage.__pcnView) persist(stage, stage.__pcnView);
            gesture = null;
        }
    };

    const onWheel = (e) => {
        const winEl = e.target.closest?.('[data-pcn-win]');
        const stage = winEl?.querySelector('[data-pcn-stage]');
        const geo = geometry(stage);
        if (!stage || !geo) return;
        if (e.cancelable) e.preventDefault();
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
        const view = zoomAt(currentView(stage, geo), factor, local(geo, point(e)), geo.size, geo.content, geo.limits);
        apply(stage, view, geo);
        persist(stage, view);
    };

    const onClick = (e) => {
        const button = e.target.closest?.('[data-pcn-zoom]');
        if (!button) return;
        command(button.getAttribute('data-pcn-zoom'));
    };

    const onLoad = (e) => {
        const img = e.target;
        if (!img?.matches?.('.pcn-img')) return;
        const stage = img.closest('[data-pcn-stage]');
        if (stage) sync(stage);
    };

    // ── divisor foto / formulario ─────────────────────────────────────────
    const startSplit = (e, handle) => {
        const body = handle.closest('.pcn-body');
        if (!body) return;
        if (e.cancelable) e.preventDefault();
        try { handle.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
        splitDrag = { body, rect: body.getBoundingClientRect(), pct: null };
    };
    const moveSplit = (e) => {
        const { body, rect } = splitDrag;
        if (!(rect.height > 0)) return;
        const pct = Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, ((e.clientY - rect.top) / rect.height) * 100)));
        splitDrag.pct = pct;
        body.style.setProperty('--pcn-split', `${pct}%`);
    };
    const endSplit = () => {
        const { pct } = splitDrag;
        splitDrag = null;
        if (pct !== null) setUi?.({ split: pct });
        // La ventana cambió de tamaño: la foto se acomoda a sus nuevos límites.
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(syncAll); else syncAll();
    };

    // ── conexión ──────────────────────────────────────────────────────────
    doc.addEventListener('pointerdown', onDown);
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onCancel);
    doc.addEventListener('wheel', onWheel, { passive: false });
    doc.addEventListener('click', onClick);
    doc.addEventListener('load', onLoad, true);
    win.addEventListener?.('resize', syncAll);

    // El motor de pintado parchea el DOM en sitio y borra los atributos que no vienen
    // en el HTML nuevo (`style`, `data-vready`): se vuelve a aplicar la vista guardada.
    // No hay ciclo: sync solo escribe un atributo si falta o si hay una vista que poner.
    const needsSync = (stage) => !stage.hasAttribute('data-vready') || !stage.style.transform;
    const syncPending = () => {
        doc.querySelectorAll('[data-pcn-stage]').forEach((stage) => { if (needsSync(stage)) sync(stage); });
    };
    if (typeof MutationObserver === 'function' && doc.body) {
        observer = new MutationObserver(syncPending);
        observer.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'data-vready', 'data-key', 'data-box'] });
    }
    syncPending();

    return {
        sync, command,
        detach() {
            doc.removeEventListener('pointerdown', onDown);
            doc.removeEventListener('pointermove', onMove);
            doc.removeEventListener('pointerup', onUp);
            doc.removeEventListener('pointercancel', onCancel);
            doc.removeEventListener('wheel', onWheel, { passive: false });
            doc.removeEventListener('click', onClick);
            doc.removeEventListener('load', onLoad, true);
            win.removeEventListener?.('resize', syncAll);
            observer?.disconnect();
            pointers.clear();
            gesture = null;
        }
    };
}
