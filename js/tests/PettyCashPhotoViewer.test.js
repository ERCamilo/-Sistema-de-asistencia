/**
 * Visor de la foto de la factura: pellizco, arrastre, rueda, doble toque,
 * botones de zoom, enfoque al dato activo, y que la vista sobreviva a que el
 * editor se vuelva a pintar. (La disposición real se prueba en el navegador.)
 */
import { attachPhotoViewer } from '../modules/features/pettycash/PettyCashPhotoViewer.js';

const WIN = { left: 0, top: 0, width: 390, height: 300 };
const NATURAL = { w: 3000, h: 7500 };            // factura alta: a 390 px de ancho mide 975 de alto
const BOX = '790,300,850,700';                    // [y0,x0,y1,x1]

const markup = ({ key = 'total', box = BOX, edit = '' } = {}) => `
  <div class="pcn-body">
    <div class="pcn-view">
      <div class="pcn-winwrap">
        <div class="pcn-win" data-pcn-win>
          <div class="pcn-stage" data-pcn-stage data-key="${key}" ${box ? `data-box="${box}"` : ''} ${edit ? `data-edit="${edit}"` : ''}>
            <img class="pcn-img" alt="">
          </div>
        </div>
        <div data-pcn-zbar>
          <button type="button" data-pcn-zoom="in">+</button>
          <button type="button" data-pcn-zoom="out">−</button>
          <button type="button" data-pcn-zoom="all">todo</button>
          <button type="button" data-pcn-zoom="box">dato</button>
          <span data-pcn-zoom-pct></span>
        </div>
      </div>
      <div class="pcn-split" data-pcn-split></div>
    </div>
    <div class="pcn-form"></div>
  </div>`;

const stub = () => {
    const win = document.querySelector('[data-pcn-win]');
    win.getBoundingClientRect = () => ({ ...WIN, right: WIN.width, bottom: WIN.height });
    const body = document.querySelector('.pcn-body');
    body.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 800, right: 390, bottom: 800 });
    const img = document.querySelector('.pcn-img');
    Object.defineProperty(img, 'naturalWidth', { value: NATURAL.w, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: NATURAL.h, configurable: true });
};
const mount = (opts) => { document.body.innerHTML = markup(opts); stub(); return document.querySelector('[data-pcn-stage]'); };

const parse = (stage) => {
    const m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)\s*scale\(([\d.]+)\)/.exec(stage.style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]), s: Number(m[3]) } : null;
};
const fire = (type, target, init = {}) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0, ctrlKey: !!init.ctrlKey });
    Object.defineProperty(e, 'pointerId', { value: init.id ?? 1 });
    if (init.deltaY !== undefined) Object.defineProperty(e, 'deltaY', { value: init.deltaY });
    target.dispatchEvent(e);
    return e;
};

let ui;
let viewer;
const setup = (opts) => {
    const stage = mount(opts);
    viewer = attachPhotoViewer({ doc: document, win: { devicePixelRatio: 3, addEventListener() {}, removeEventListener() {} }, getUi: () => ui, setUi: jest.fn((patch) => { ui = { ...ui, ...patch }; }) });
    viewer.sync(stage);
    return stage;
};
beforeEach(() => { ui = { view: null, viewKey: null, split: null }; });
afterEach(() => { viewer?.detach(); viewer = null; document.body.innerHTML = ''; });

describe('enfocar el dato activo', () => {
    test('la primera vez acerca al recuadro del dato y guarda la vista', () => {
        const stage = setup();
        const v = parse(stage);
        expect(v.s).toBeGreaterThan(1);
        expect(ui.viewKey).toBe('total');
        expect(ui.view).toMatchObject({ s: v.s });
        expect(stage.hasAttribute('data-vready')).toBe(true);
    });

    test('al repintarse el editor la vista se conserva (no vuelve a empezar)', async () => {
        const stage = setup();
        // el usuario se aleja a mano
        viewer.command('out');
        viewer.command('out');
        const kept = { ...ui.view };
        // el editor se vuelve a pintar: nodos nuevos, mismo dato activo
        document.body.innerHTML = markup();
        stub();
        await Promise.resolve();
        const again = parse(document.querySelector('[data-pcn-stage]'));
        expect(again.s).toBeCloseTo(kept.s, 3);
        expect(again.x).toBeCloseTo(kept.x, 1);
    });

    test('el motor de pintado parchea en sitio y borra los atributos que no conoce: la vista se restablece', async () => {
        const stage = setup();
        viewer.command('out');
        const kept = parse(stage);
        // DOMDiff: mismo nodo, pero sin `style` ni `data-vready` (no vienen en el HTML nuevo)
        stage.removeAttribute('style');
        stage.removeAttribute('data-vready');
        await Promise.resolve();
        const again = parse(stage);
        expect(again).not.toBeNull();
        expect(again.s).toBeCloseTo(kept.s, 3);
        expect(stage.hasAttribute('data-vready')).toBe(true);
    });

    test('si solo se borra el estilo (el atributo de listo queda), también se restablece', async () => {
        const stage = setup();
        const kept = parse(stage);
        stage.removeAttribute('style');
        await Promise.resolve();
        expect(parse(stage).s).toBeCloseTo(kept.s, 3);
    });

    test('parchear en sitio con otro dato activo enfoca su recuadro', async () => {
        const stage = setup();
        const before = { ...ui.view };
        stage.removeAttribute('style');
        stage.removeAttribute('data-vready');
        stage.setAttribute('data-key', 'ncf');
        stage.setAttribute('data-box', '40,100,80,500');
        await Promise.resolve();
        expect(ui.viewKey).toBe('ncf');
        expect(ui.view).not.toEqual(before);
    });

    test('sin imagen cargada no entra en un ciclo infinito de repintados', async () => {
        const stage = mount();
        Object.defineProperty(document.querySelector('.pcn-img'), 'naturalWidth', { value: 0, configurable: true });
        viewer = attachPhotoViewer({ doc: document, win: { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} }, getUi: () => ui, setUi: jest.fn() });
        await Promise.resolve();
        await Promise.resolve();
        expect(stage.hasAttribute('data-vready')).toBe(true);
        expect(stage.style.transform).toBe('');
    });

    test('al cambiar de dato se enfoca el recuadro nuevo', async () => {
        setup();
        const before = { ...ui.view };
        document.body.innerHTML = markup({ key: 'ncf', box: '40,100,80,500' });
        stub();
        await Promise.resolve();
        expect(ui.viewKey).toBe('ncf');
        expect(ui.view).not.toEqual(before);
    });

    test('un dato sin recuadro no mueve la foto', async () => {
        setup();
        const before = { ...ui.view };
        document.body.innerHTML = markup({ key: 'cliente', box: '' });
        stub();
        await Promise.resolve();
        expect(ui.viewKey).toBe('cliente');
        expect(ui.view).toEqual(before);
    });
});

describe('gestos', () => {
    test('un dedo arrastra la foto, y el estado se guarda solo al soltar', () => {
        const stage = setup();
        const win = document.querySelector('[data-pcn-win]');
        const start = parse(stage);
        const setUi = jest.fn((patch) => { ui = { ...ui, ...patch }; });
        viewer.detach();
        viewer = attachPhotoViewer({ doc: document, win: { devicePixelRatio: 3, addEventListener() {}, removeEventListener() {} }, getUi: () => ui, setUi });
        fire('pointerdown', win, { x: 200, y: 200, id: 1 });
        fire('pointermove', win, { x: 200, y: 150, id: 1 });
        fire('pointermove', win, { x: 200, y: 100, id: 1 });
        expect(setUi).not.toHaveBeenCalled();
        expect(parse(stage).y).toBeLessThan(start.y);
        fire('pointerup', win, { x: 200, y: 100, id: 1 });
        expect(setUi).toHaveBeenCalledTimes(1);
    });

    test('con el modo de marcar activo, un dedo no arrastra la foto', () => {
        const stage = setup({ edit: 'draw' });
        const win = document.querySelector('[data-pcn-win]');
        const start = parse(stage);
        fire('pointerdown', win, { x: 200, y: 200, id: 1 });
        fire('pointermove', win, { x: 200, y: 100, id: 1 });
        fire('pointerup', win, { x: 200, y: 100, id: 1 });
        expect(parse(stage)).toEqual(start);
    });

    test('dos dedos separándose acercan; juntándose alejan', () => {
        const stage = setup();
        const win = document.querySelector('[data-pcn-win]');
        const start = parse(stage).s;
        fire('pointerdown', win, { x: 150, y: 150, id: 1 });
        fire('pointerdown', win, { x: 250, y: 150, id: 2 });
        fire('pointermove', win, { x: 100, y: 150, id: 1 });
        fire('pointermove', win, { x: 300, y: 150, id: 2 });
        const apart = parse(stage).s;
        expect(apart).toBeGreaterThan(start);
        fire('pointermove', win, { x: 140, y: 150, id: 1 });
        fire('pointermove', win, { x: 160, y: 150, id: 2 });
        expect(parse(stage).s).toBeLessThan(apart);
        fire('pointerup', win, { id: 2 });
        fire('pointerup', win, { id: 1 });
        expect(ui.view.s).toBeCloseTo(parse(stage).s, 3);
    });

    test('con dos dedos también se puede alejar hasta ver la factura entera', () => {
        const stage = setup();
        const win = document.querySelector('[data-pcn-win]');
        fire('pointerdown', win, { x: 100, y: 150, id: 1 });
        fire('pointerdown', win, { x: 300, y: 150, id: 2 });
        fire('pointermove', win, { x: 195, y: 150, id: 1 });
        fire('pointermove', win, { x: 196, y: 150, id: 2 });
        fire('pointerup', win, { id: 2 });
        fire('pointerup', win, { id: 1 });
        expect(parse(stage).s).toBeCloseTo(300 / 975, 3);   // la altura de la ventana entre la de la foto
    });

    test('la rueda acerca y alejar con ctrl+rueda también funciona', () => {
        const stage = setup();
        const win = document.querySelector('[data-pcn-win]');
        const s0 = parse(stage).s;
        const e = fire('wheel', win, { x: 200, y: 150, deltaY: -120 });
        expect(e.defaultPrevented).toBe(true);
        expect(parse(stage).s).toBeGreaterThan(s0);
        const s1 = parse(stage).s;
        fire('wheel', win, { x: 200, y: 150, deltaY: 120, ctrlKey: true });
        expect(parse(stage).s).toBeLessThan(s1);
        expect(ui.view.s).toBeCloseTo(parse(stage).s, 3);
    });

    test('doble toque acerca y otro doble toque vuelve a ajustar', () => {
        const stage = setup({ box: '' });           // sin recuadro: parte ajustada al ancho
        const win = document.querySelector('[data-pcn-win]');
        expect(parse(stage).s).toBe(1);
        const tap = () => { fire('pointerdown', win, { x: 200, y: 150, id: 1 }); fire('pointerup', win, { x: 200, y: 150, id: 1 }); };
        tap(); tap();
        expect(parse(stage).s).toBeGreaterThan(1.5);
        tap(); tap();
        expect(parse(stage).s).toBe(1);
    });

    test('tocar un botón no mueve la foto', () => {
        const stage = setup();
        const start = parse(stage);
        const button = document.querySelector('[data-pcn-zoom="in"]');
        fire('pointerdown', button, { x: 10, y: 10, id: 1 });
        fire('pointermove', button, { x: 10, y: 200, id: 1 });
        fire('pointerup', button, { x: 10, y: 200, id: 1 });
        expect(parse(stage)).toEqual(start);
    });
});

describe('botones de zoom', () => {
    test('+ y − acercan y alejan; «todo» muestra la factura entera; «dato» vuelve al recuadro', () => {
        const stage = setup();
        const s0 = parse(stage).s;
        viewer.command('in');
        expect(parse(stage).s).toBeGreaterThan(s0);
        viewer.command('out'); viewer.command('out');
        expect(parse(stage).s).toBeLessThan(s0);
        viewer.command('all');
        expect(parse(stage).s).toBeCloseTo(300 / 975, 3);
        viewer.command('box');
        expect(parse(stage).s).toBeCloseTo(s0, 3);
    });

    test('el botón muestra el porcentaje de zoom', () => {
        setup();
        const label = document.querySelector('[data-pcn-zoom-pct]').textContent;
        expect(label).toMatch(/^\d+\s?%$/);
    });

    test('un clic en un botón del documento ejecuta su comando', () => {
        const stage = setup();
        const s0 = parse(stage).s;
        document.querySelector('[data-pcn-zoom="in"]').click();
        expect(parse(stage).s).toBeGreaterThan(s0);
    });
});

describe('divisor foto / formulario', () => {
    test('arrastrar el divisor cambia el reparto y lo guarda', () => {
        setup();
        const split = document.querySelector('[data-pcn-split]');
        fire('pointerdown', split, { x: 100, y: 330, id: 1 });
        fire('pointermove', split, { x: 100, y: 400, id: 1 });
        expect(document.querySelector('.pcn-body').style.getPropertyValue('--pcn-split')).toBe('50%');
        fire('pointerup', split, { x: 100, y: 400, id: 1 });
        expect(ui.split).toBe(50);
    });
    test('el reparto se mantiene entre 20 % y 75 %', () => {
        setup();
        const split = document.querySelector('[data-pcn-split]');
        fire('pointerdown', split, { x: 100, y: 330, id: 1 });
        fire('pointermove', split, { x: 100, y: 5, id: 1 });
        fire('pointerup', split, { x: 100, y: 5, id: 1 });
        expect(ui.split).toBe(20);
        fire('pointerdown', split, { x: 100, y: 330, id: 1 });
        fire('pointermove', split, { x: 100, y: 790, id: 1 });
        fire('pointerup', split, { x: 100, y: 790, id: 1 });
        expect(ui.split).toBe(75);
    });
});
