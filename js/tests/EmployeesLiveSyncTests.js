/**
 * 🧪 EmployeesLiveSyncTests (Fase 2.1)
 *
 * Gestiona el ciclo de vida del onSnapshot listener sobre la colección
 * users/{uid}/employees. Garantiza que:
 *   - start() crea una única suscripción aunque se llame N veces.
 *   - stop() cancela la suscripción y libera el slot para futuras starts.
 *   - El callback applyEmployees recibe la lista cada vez que algo cambia
 *     en la nube.
 *   - Si window._isApplyingRemoteData ya está true, el helper respeta
 *     el flag (no lo cambia).
 *   - Sin usuario autenticado, start() es noop seguro y retorna false.
 *
 * Diseño con inyección: la dependencia 'subscribe' representa
 * EmployeeRepository.subscribe (devuelve un unsubscribe).
 */

import { EmployeesLiveSync } from '../modules/services/EmployeesLiveSync.js';

function makeFakeSubscribe() {
    const subscribers = [];
    const fn = jest.fn().mockImplementation((cb) => {
        const unsub = jest.fn();
        subscribers.push({ cb, unsub });
        return unsub;
    });
    fn._subscribers = subscribers;
    fn._fireWith = (employees) => {
        subscribers.forEach(s => s.cb(employees));
    };
    return fn;
}

testRunner.addSuite("EmployeesLiveSync — start/stop (Fase 2.1)", {

    "start() sin onApply válido retorna false"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop(); // clean slate
        const ok = EmployeesLiveSync.start({ subscribe: sub, onApply: null });
        testRunner.assertEquals(ok, false);
        testRunner.assertEquals(sub.mock.calls.length, 0);
    },

    "start() crea exactamente UNA suscripción aunque se llame 3 veces"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop();

        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });
        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });
        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });

        testRunner.assertEquals(sub.mock.calls.length, 1,
            "Idempotente: una sola subscribe activa");
        EmployeesLiveSync.stop();
    },

    "stop() invoca la función unsubscribe devuelta por subscribe"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop();
        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });
        const unsub = sub._subscribers[0].unsub;
        EmployeesLiveSync.stop();
        testRunner.assertEquals(unsub.mock.calls.length, 1);
    },

    "tras stop(), un nuevo start() crea una suscripción fresca"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop();

        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });
        EmployeesLiveSync.stop();
        EmployeesLiveSync.start({ subscribe: sub, onApply: () => {} });

        testRunner.assertEquals(sub.mock.calls.length, 2,
            "Después de stop, start debe poder volver a suscribir");
        EmployeesLiveSync.stop();
    },

    "el callback applyEmployees se invoca con la lista cuando la subscribe dispara"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop();

        const applied = [];
        EmployeesLiveSync.start({
            subscribe: sub,
            onApply: (emps) => applied.push(emps)
        });

        const emps1 = [{ id: 'e1', name: 'Ana' }];
        const emps2 = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }];
        sub._fireWith(emps1);
        sub._fireWith(emps2);

        testRunner.assertEquals(applied.length, 2);
        testRunner.assertEquals(applied[0][0].name, 'Ana');
        testRunner.assertEquals(applied[1].length, 2);

        EmployeesLiveSync.stop();
    },

    "el callback envuelve _isApplyingRemoteData mientras aplica"() {
        const sub = makeFakeSubscribe();
        EmployeesLiveSync.stop();

        // Estado inicial: flag en false.
        delete window._isApplyingRemoteData;

        let flagSeen = null;
        EmployeesLiveSync.start({
            subscribe: sub,
            onApply: () => {
                // Durante la aplicación, el flag debe estar en true
                flagSeen = window._isApplyingRemoteData;
            }
        });
        sub._fireWith([{ id: 'e1', name: 'Ana' }]);

        testRunner.assertEquals(flagSeen, true,
            "Durante onApply, _isApplyingRemoteData debe estar true para que el save no rebote");

        EmployeesLiveSync.stop();
    },

    "_isApplyingRemoteData vuelve a false tras un tick"() {
        return new Promise((resolve) => {
            const sub = makeFakeSubscribe();
            EmployeesLiveSync.stop();
            window._isApplyingRemoteData = false;

            EmployeesLiveSync.start({
                subscribe: sub,
                onApply: () => {}
            });
            sub._fireWith([{ id: 'e1' }]);

            // Inmediatamente tras applicación debe seguir true por la ventana de protección
            setTimeout(() => {
                try {
                    testRunner.assertEquals(window._isApplyingRemoteData, false,
                        "Después del tick, el flag debe volver a false");
                    EmployeesLiveSync.stop();
                    resolve();
                } catch (e) {
                    EmployeesLiveSync.stop();
                    resolve(Promise.reject(e));
                }
            }, 600);
        });
    }

});

console.log('🧪 EmployeesLiveSync tests cargados.');
