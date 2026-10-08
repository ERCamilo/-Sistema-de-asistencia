/**
 * Reading nested state must not allocate on every property access.
 *
 * The recursive proxy used to rebuild a `[...path, prop]` array on EVERY read
 * of an object-valued property — even when the child proxy was already
 * cached — and that `path` was never used. With ~900 loans / 5,400 payments
 * the Préstamos screen spent ~400 ms in the get trap plus ~500 ms of garbage
 * collection per render. Spreading an array goes through
 * Array.prototype[Symbol.iterator], so counting its calls detects the
 * regression deterministically (no timing involved).
 */
import { state, stateManager } from 'actual/core/AppState.js';

function countArrayIterations(fn) {
    const original = Array.prototype[Symbol.iterator];
    let calls = 0;
    // eslint-disable-next-line no-extend-native
    Array.prototype[Symbol.iterator] = function countingIterator() {
        calls += 1;
        return original.call(this);
    };
    try {
        fn();
    } finally {
        // eslint-disable-next-line no-extend-native
        Array.prototype[Symbol.iterator] = original;
    }
    return calls;
}

describe('AppState proxy — lecturas anidadas sin asignaciones', () => {
    beforeEach(() => {
        state.employees = [{
            id: 'EMP-read-0001',
            name: 'Ana',
            loans: [{ id: 'L1', payments: [{ id: 'P1', amount: 100 }, { id: 'P2', amount: 50 }] }]
        }];
    });

    afterEach(() => {
        state.employees = [];
    });

    test('leer datos anidados no recorre arreglos con el iterador', () => {
        let total = 0;
        const calls = countArrayIterations(() => {
            for (let i = 0; i < 200; i++) {
                const emp = state.employees[0];
                const loan = emp.loans[0];
                total += loan.payments[0].amount + loan.payments[1].amount;
            }
        });
        expect(total).toBe(200 * 150);
        expect(calls).toBe(0);
    });

    test('la misma ruta devuelve el mismo proxy (identidad estable) y lee el dato real', () => {
        const a = state.employees[0].loans[0];
        const b = state.employees[0].loans[0];
        expect(a).toBe(b);
        expect(a._isProxy).toBe(true);
        expect(a._rawTarget).toBe(stateManager.getState().employees[0].loans[0]);
        expect(a.payments[1].amount).toBe(50);
    });
});
