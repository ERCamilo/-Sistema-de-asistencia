/**
 * Trazar, mover y redimensionar el recuadro de un dato sobre la foto con el
 * dedo o el ratón. Un solo escucha en el documento: el editor se vuelve a
 * pintar muchas veces y los elementos cambian. Mientras se arrastra solo se
 * mueve lo que se ve; el guardado ocurre al soltar (`onCommit(clave, recuadro)`).
 * Probado en js/tests/PettyCashBoxEditor.test.js.
 */
import { boxFromDrag, moveBox, resizeBox } from './PettyCashBoxMath.js';

const pct = (n) => `${+Number(n).toFixed(2)}%`;
const place = (el, [y0, x0, y1, x1]) => {
    el.style.left = pct(x0 / 10); el.style.top = pct(y0 / 10);
    el.style.width = pct((x1 - x0) / 10); el.style.height = pct((y1 - y0) / 10);
};
const readBox = (el) => {
    const n = (v) => Math.round(parseFloat(v) * 10);
    return [n(el.style.top), n(el.style.left), n(el.style.top) + n(el.style.height), n(el.style.left) + n(el.style.width)];
};

export function attachBoxEditor({ doc = document, onCommit } = {}) {
    let drag = null;

    const down = (e) => {
        const stage = e.target.closest?.('[data-pcn-stage]');
        if (!stage || !stage.dataset.edit) return;
        const key = stage.dataset.key;
        const rect = stage.getBoundingClientRect();
        const handle = e.target.closest('[data-pcn-handle]');
        const box = e.target.closest('[data-pcn-box]');
        if (stage.dataset.edit === 'draw' && !box) {
            const draft = doc.createElement('div');
            draft.className = 'pcn-box pcn-box--draft';
            draft.setAttribute('data-pcn-draft', '');
            stage.appendChild(draft);
            drag = { mode: 'draw', stage, key, rect, start: { x: e.clientX, y: e.clientY }, draft, result: null };
        } else if (stage.dataset.edit === 'adjust' && box) {
            drag = { mode: handle ? 'resize' : 'move', stage, key, rect, start: { x: e.clientX, y: e.clientY }, box, from: readBox(box), result: null };
        } else return;
        if (e.cancelable) e.preventDefault();
        try { e.target.setPointerCapture?.(e.pointerId); } catch { /* sin captura: sigue por el documento */ }
    };

    const move = (e) => {
        if (!drag) return;
        const end = { x: e.clientX, y: e.clientY };
        if (drag.mode === 'draw') {
            const box = boxFromDrag(drag.start, end, drag.rect);
            drag.result = box;
            if (box) place(drag.draft, box);
        } else {
            const dx = end.x - drag.start.x;
            const dy = end.y - drag.start.y;
            const next = drag.mode === 'move' ? moveBox(drag.from, dx, dy, drag.rect) : resizeBox(drag.from, dx, dy, drag.rect);
            drag.result = next.every((v, i) => v === drag.from[i]) ? null : next;
            place(drag.box, next);
        }
    };

    const up = () => {
        if (!drag) return;
        const { mode, key, draft, result } = drag;
        drag = null;
        if (mode === 'draw') draft.remove();
        if (result) onCommit?.(key, result);
    };

    doc.addEventListener('pointerdown', down);
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
    doc.addEventListener('pointercancel', up);
    return () => {
        doc.removeEventListener('pointerdown', down);
        doc.removeEventListener('pointermove', move);
        doc.removeEventListener('pointerup', up);
        doc.removeEventListener('pointercancel', up);
    };
}
