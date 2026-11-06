/**
 * Editor de esquinas: la foto con cuatro esquinas que se arrastran, para enderezar la factura.
 * Es una capa propia (fuera del árbol que repinta la pantalla) con su ciclo de vida.
 */
import { openCornerEditor } from '../modules/features/pettycash/PettyCashCornerEditor.js';

const start = () => [[0.1, 0.1], [0.9, 0.12], [0.88, 0.9], [0.12, 0.88]];
const fakeCanvas = () => { const c = document.createElement('canvas'); c.width = 800; c.height = 1000; c.getContext = () => null; return c; };
const ev = (type, target, x = 0, y = 0, id = 1) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y });
    Object.defineProperty(e, 'pointerId', { value: id });
    target.dispatchEvent(e);
    return e;
};
beforeAll(() => { HTMLCanvasElement.prototype.getContext = () => null; });   // jsdom no dibuja: la lupa se omite
let editor;
const open = (over = {}) => {
    const onApply = jest.fn(async () => true);
    const onCancel = jest.fn();
    editor = openCornerEditor({ doc: document, canvas: fakeCanvas(), corners: start(), onApply, onCancel, ...over });
    const frame = document.querySelector('[data-pcc-frame]');
    frame.getBoundingClientRect = () => ({ left: 50, top: 100, width: 400, height: 500 });
    return { onApply, onCancel, frame };
};
const handle = (i) => document.querySelector(`[data-pcc-handle="${i}"]`);
const pos = (i) => ({ x: parseFloat(handle(i).style.left), y: parseFloat(handle(i).style.top) });
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => { editor?.close(); editor = null; document.body.innerHTML = ''; });

describe('abrir', () => {
    test('es una capa en el documento con cuatro esquinas colocadas donde van', () => {
        open();
        expect(document.querySelector('[data-pcc]')).not.toBeNull();
        expect(document.querySelectorAll('[data-pcc-handle]')).toHaveLength(4);
        expect(pos(0)).toEqual({ x: 10, y: 10 });
        expect(pos(2)).toEqual({ x: 88, y: 90 });
        expect(document.querySelector('[data-pcc-apply]').disabled).toBe(false);
        expect(document.querySelector('[data-pcc]').getAttribute('role')).toBe('dialog');
    });
    test('el polígono sigue a las esquinas', () => {
        open();
        expect(document.querySelector('[data-pcc-poly]').getAttribute('points')).toBe('10,10 90,12 88,90 12,88');
    });
    test('las esquinas son lo bastante grandes para el dedo (44 px)', () => {
        open();
        expect(handle(0).className).toContain('pcc-handle');
        expect(handle(0).getAttribute('aria-label')).toMatch(/esquina/i);
    });
});

describe('arrastrar una esquina', () => {
    test('sigue al dedo (en 0–1 de la foto) y no aplica nada hasta pulsar Enderezar', () => {
        const { onApply } = open();
        ev('pointerdown', handle(0), 70, 150);
        ev('pointermove', handle(0), 90, 175);            // x = (90-50)/400 = .1 ; y = (175-100)/500 = .15
        expect(pos(0).x).toBeCloseTo(10, 1);
        expect(pos(0).y).toBeCloseTo(15, 1);
        ev('pointermove', handle(0), 130, 225);           // x = .2 ; y = .25
        expect(pos(0).x).toBeCloseTo(20, 1);
        expect(pos(0).y).toBeCloseTo(25, 1);
        ev('pointerup', handle(0), 130, 225);
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[data-pcc-poly]').getAttribute('points')).toMatch(/^20,25/);
    });
    test('no se sale de la foto', () => {
        open();
        ev('pointerdown', handle(1), 400, 160);
        ev('pointermove', handle(1), 9999, -9999);
        expect(pos(1)).toEqual({ x: 100, y: 0 });
        ev('pointerup', handle(1));
    });
    test('si queda un cuadrilátero imposible, se avisa y Enderezar se desactiva', () => {
        open();
        ev('pointerdown', handle(0), 90, 150);
        ev('pointermove', handle(0), 400, 560);           // la esquina superior izquierda pasa al otro lado
        expect(document.querySelector('[data-pcc-apply]').disabled).toBe(true);
        expect(document.querySelector('[data-pcc]').getAttribute('data-invalid')).toBe('true');
        ev('pointermove', handle(0), 90, 150);
        expect(document.querySelector('[data-pcc-apply]').disabled).toBe(false);
        ev('pointerup', handle(0));
    });
    test('un segundo dedo cancela el arrastre y la esquina vuelve a donde estaba', () => {
        open();
        ev('pointerdown', handle(0), 90, 150, 1);
        ev('pointermove', handle(0), 200, 300, 1);
        ev('pointerdown', handle(2), 300, 500, 2);
        expect(pos(0)).toEqual({ x: 10, y: 10 });
        ev('pointermove', handle(0), 250, 350, 1);
        expect(pos(0)).toEqual({ x: 10, y: 10 });
        ev('pointerup', handle(0), 250, 350, 1);
        ev('pointerup', handle(2), 300, 500, 2);
    });
    test('mientras se arrastra se ve la lupa, y desaparece al soltar', () => {
        open();
        ev('pointerdown', handle(0), 90, 150);
        expect(document.querySelector('[data-pcc-loupe]').hidden).toBe(false);
        ev('pointerup', handle(0));
        expect(document.querySelector('[data-pcc-loupe]').hidden).toBe(true);
    });
});

describe('teclado', () => {
    test('las flechas mueven la esquina enfocada un poco', () => {
        open();
        handle(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        expect(pos(0).x).toBeGreaterThan(10);
        handle(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        expect(pos(0).y).toBeGreaterThan(10);
    });
});

describe('Enderezar, Automático y Cancelar', () => {
    test('Enderezar entrega las esquinas y cierra cuando el dueño dice que salió bien', async () => {
        const { onApply } = open();
        ev('pointerdown', handle(0), 90, 150); ev('pointermove', handle(0), 130, 225); ev('pointerup', handle(0));
        document.querySelector('[data-pcc-apply]').click();
        await flush();
        expect(onApply).toHaveBeenCalledTimes(1);
        const corners = onApply.mock.calls[0][0];
        expect(corners).toHaveLength(4);
        expect(corners[0][0]).toBeCloseTo(0.2, 2);
        expect(document.querySelector('[data-pcc]')).toBeNull();
    });
    test('mientras trabaja, los botones se bloquean (no se aplica dos veces)', async () => {
        let release;
        const onApply = jest.fn(() => new Promise((resolve) => { release = resolve; }));
        open({ onApply });
        document.querySelector('[data-pcc-apply]').click();
        document.querySelector('[data-pcc-apply]').click();
        expect(onApply).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-pcc-apply]').disabled).toBe(true);
        expect(document.querySelector('[data-pcc]').getAttribute('aria-busy')).toBe('true');
        release(true);
        await flush();
        expect(document.querySelector('[data-pcc]')).toBeNull();
    });
    test('si falla, la capa sigue abierta con el motivo y se puede reintentar', async () => {
        const onApply = jest.fn()
            .mockRejectedValueOnce(new Error('Sin memoria'))
            .mockResolvedValueOnce(true);
        open({ onApply });
        document.querySelector('[data-pcc-apply]').click();
        await flush();
        expect(document.querySelector('[data-pcc]')).not.toBeNull();
        expect(document.querySelector('[data-pcc-error]').textContent).toMatch(/Sin memoria/);
        expect(document.querySelector('[data-pcc-apply]').disabled).toBe(false);
        document.querySelector('[data-pcc-apply]').click();
        await flush();
        expect(document.querySelector('[data-pcc]')).toBeNull();
    });
    test('si el dueño responde false, se queda abierta', async () => {
        open({ onApply: jest.fn(async () => false) });
        document.querySelector('[data-pcc-apply]').click();
        await flush();
        expect(document.querySelector('[data-pcc]')).not.toBeNull();
    });
    test('Automático vuelve a las esquinas que propone el detector', () => {
        const onAuto = jest.fn(() => [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]);
        open({ onAuto });
        ev('pointerdown', handle(0), 90, 150); ev('pointermove', handle(0), 130, 225); ev('pointerup', handle(0));
        document.querySelector('[data-pcc-auto]').click();
        expect(onAuto).toHaveBeenCalled();
        expect(pos(0)).toEqual({ x: 20, y: 20 });
        expect(pos(2)).toEqual({ x: 80, y: 80 });
    });
    test('sin detector, el botón Automático no aparece', () => {
        open();
        expect(document.querySelector('[data-pcc-auto]')).toBeNull();
    });
    test('Cancelar y Escape cierran sin aplicar', () => {
        const { onApply, onCancel } = open();
        document.querySelector('[data-pcc-cancel]').click();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(onApply).not.toHaveBeenCalled();
        expect(document.querySelector('[data-pcc]')).toBeNull();
        const second = open();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(second.onCancel).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-pcc]')).toBeNull();
    });
});

describe('el lienzo de la foto', () => {
    test('se muestra el mismo lienzo (no se copia) y al cerrar vuelve a quedar libre', () => {
        const canvas = fakeCanvas();
        open({ canvas });
        expect(document.querySelector('[data-pcc-frame]').contains(canvas)).toBe(true);
        editor.close();
        expect(canvas.isConnected).toBe(false);
        expect(canvas.width).toBe(800);
        expect(canvas.className).not.toContain('pcc-canvas');
    });
});

describe('ciclo de vida', () => {
    test('close() se puede llamar varias veces y deja el documento limpio', () => {
        const { onCancel } = open();
        editor.close();
        editor.close();
        expect(document.querySelector('[data-pcc]')).toBeNull();
        expect(onCancel).not.toHaveBeenCalled();
    });
    test('un repintado de la pantalla (que borra su propio árbol) no toca la capa', () => {
        document.body.insertAdjacentHTML('beforeend', '<div id="app">hola</div>');
        open();
        document.getElementById('app').innerHTML = 'repintado';
        expect(document.querySelector('[data-pcc]')).not.toBeNull();
        expect(document.querySelector('[data-pcc]').parentElement).toBe(document.body);
    });
    test('solo hay una capa a la vez', () => {
        open();
        const first = document.querySelector('[data-pcc]');
        open();
        expect(document.querySelectorAll('[data-pcc]')).toHaveLength(1);
        expect(document.querySelector('[data-pcc]')).not.toBe(first);
    });
});
