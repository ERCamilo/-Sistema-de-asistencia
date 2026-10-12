/**
 * Mantener pulsado el micrófono no debe disparar los gestos del sistema:
 * seleccionar texto vecino, menú de copiar, ni arrastrar "fantasmas".
 */
import { createHoldGuard, preventTouchDefaults, HOLD_CLASS } from '../modules/ui/HoldGuard.js';

const fire = (target, type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
};

afterEach(() => { document.body.innerHTML = ''; document.documentElement.classList.remove(HOLD_CLASS); });

describe('createHoldGuard', () => {
    test('mientras se mantiene: sin selección, menú ni arrastre en toda la página', () => {
        document.body.innerHTML = '<span id="txt">ASISTENCIA</span>';
        const removeAllRanges = jest.fn();
        const doc = Object.assign(document, {});
        const spy = jest.spyOn(document, 'getSelection').mockReturnValue({ removeAllRanges });
        const guard = createHoldGuard({ doc });
        const txt = document.getElementById('txt');
        expect(fire(txt, 'selectstart').defaultPrevented).toBe(false);

        guard.start();
        expect(document.documentElement.classList.contains(HOLD_CLASS)).toBe(true);
        expect(removeAllRanges).toHaveBeenCalled();
        expect(fire(txt, 'selectstart').defaultPrevented).toBe(true);
        expect(fire(txt, 'dragstart').defaultPrevented).toBe(true);
        expect(fire(txt, 'contextmenu').defaultPrevented).toBe(true);

        guard.end();
        expect(document.documentElement.classList.contains(HOLD_CLASS)).toBe(false);
        expect(fire(txt, 'selectstart').defaultPrevented).toBe(false);
        expect(fire(txt, 'dragstart').defaultPrevented).toBe(false);
        spy.mockRestore();
    });

    test('start/end repetidos no se acumulan', () => {
        const guard = createHoldGuard({ doc: document });
        guard.start(); guard.start(); guard.end();
        expect(guard.isActive()).toBe(false);
        expect(fire(document.body, 'selectstart').defaultPrevented).toBe(false);
    });
});

describe('preventTouchDefaults', () => {
    test('solo sobre el botón: cancela la pulsación larga del sistema (los pointer events siguen)', () => {
        document.body.innerHTML = '<button data-mic><svg><path></path></svg></button><span id="other">x</span>';
        const off = preventTouchDefaults(document, '[data-mic]');
        expect(fire(document.querySelector('path'), 'touchstart').defaultPrevented).toBe(true);
        expect(fire(document.getElementById('other'), 'touchstart').defaultPrevented).toBe(false);
        off();
        expect(fire(document.querySelector('path'), 'touchstart').defaultPrevented).toBe(false);
    });
});
