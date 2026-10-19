/**
 * Trazar, mover y redimensionar el recuadro de un dato sobre la foto con el dedo
 * o el ratón. Solo se guarda al soltar; mientras se arrastra solo se mueve en pantalla.
 */
import { attachBoxEditor } from '../modules/features/pettycash/PettyCashBoxEditor.js';
import { receiptEditorHTML } from '../modules/features/pettycash/PettyCashReceiptEditor.js';

const mov = { id: 'g1', type: 'gasto', hasReceipt: true, receiptStatus: 'uploaded', paidTo: 'X', ocrBoxes: {}, total: 10, amount: 10, date: '2026-10-10' };
const source = { url: 'blob:abc', mime: 'image/jpeg' };
const ev = (type, target, x, y) => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    target.dispatchEvent(e);
    return e;
};
const mount = (movement, ui = {}) => {
    document.body.innerHTML = receiptEditorHTML(movement, { source, ui: { field: 'total', zoom: false, size: 1, more: null, itemsOpen: false, secOpen: null, draft: {}, mark: true, ...ui } });
    const stage = document.querySelector('[data-pcn-stage]');
    stage.getBoundingClientRect = () => ({ left: 100, top: 50, width: 400, height: 800 });
    return stage;
};
let detach;
afterEach(() => { detach?.(); document.body.innerHTML = ''; });

describe('trazar un recuadro nuevo', () => {
    test('arrastrar sobre la foto guarda el recuadro al soltar, con la clave del dato activo', () => {
        const stage = mount(mov);
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', stage, 200, 250);
        ev('pointermove', stage, 300, 450);
        expect(onCommit).not.toHaveBeenCalled();                       // mientras arrastra, no guarda
        expect(document.querySelector('[data-pcn-draft]')).not.toBeNull();   // pero se ve el trazo
        ev('pointerup', stage, 300, 450);
        expect(onCommit).toHaveBeenCalledWith('total', [250, 250, 500, 500]);
        expect(document.querySelector('[data-pcn-draft]')).toBeNull();
    });
    test('un toque sin arrastrar no crea nada', () => {
        const stage = mount(mov);
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', stage, 200, 250);
        ev('pointerup', stage, 201, 251);
        expect(onCommit).not.toHaveBeenCalled();
    });
    test('fuera del modo marcar no hace nada', () => {
        const stage = mount(mov, { mark: false });
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', stage, 200, 250); ev('pointermove', stage, 300, 450); ev('pointerup', stage, 300, 450);
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('mover y cambiar de tamaño', () => {
    const withBox = { ...mov, ocrBoxes: { total: [250, 250, 500, 500] } };
    test('arrastrar el recuadro lo mueve y guarda al soltar', () => {
        const stage = mount(withBox);
        const box = stage.querySelector('[data-pcn-box]');
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', box, 250, 450);
        ev('pointermove', box, 290, 530);       // +40 px, +80 px = +10 %, +10 %
        expect(box.style.left).toBe('35%');      // en pantalla ya se movió
        expect(onCommit).not.toHaveBeenCalled();
        ev('pointerup', box, 290, 530);
        expect(onCommit).toHaveBeenCalledWith('total', [350, 350, 600, 600]);
    });
    test('arrastrar la esquina cambia el tamaño', () => {
        const stage = mount(withBox);
        const handle = stage.querySelector('[data-pcn-handle]');
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', handle, 300, 450);
        ev('pointermove', handle, 340, 530);
        ev('pointerup', handle, 340, 530);
        expect(onCommit).toHaveBeenCalledWith('total', [250, 250, 600, 600]);
    });
    test('soltar sin mover no guarda', () => {
        const stage = mount(withBox);
        const box = stage.querySelector('[data-pcn-box]');
        const onCommit = jest.fn();
        detach = attachBoxEditor({ doc: document, onCommit });
        ev('pointerdown', box, 250, 450);
        ev('pointerup', box, 250, 450);
        expect(onCommit).not.toHaveBeenCalled();
    });
});

describe('limpieza', () => {
    test('al desconectar ya no escucha', () => {
        const stage = mount(mov);
        const onCommit = jest.fn();
        attachBoxEditor({ doc: document, onCommit })();
        ev('pointerdown', stage, 200, 250); ev('pointermove', stage, 300, 450); ev('pointerup', stage, 300, 450);
        expect(onCommit).not.toHaveBeenCalled();
    });
});
