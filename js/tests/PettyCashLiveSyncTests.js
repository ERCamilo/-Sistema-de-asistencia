/**
 * 🧪 PettyCashLiveSyncTests (Caja chica — Fase 1, Paso 2)
 *
 * Singleton que gestiona las suscripciones onSnapshot de las 3 colecciones
 * (projects, cashPeriods, pettyCash) y aplica los cambios remotos al state.
 * Mismo patrón que EmployeesLiveSync, pero multi-colección.
 *
 * Verifica:
 *   - start() con config válida abre una suscripción por colección.
 *   - start() es idempotente (no duplica listeners).
 *   - start() sin config válida retorna false.
 *   - Al recibir un cambio remoto, envuelve onApply con el guard
 *     window._isApplyingRemoteData = true.
 *   - stop() desuscribe todo y permite re-start.
 */

const Mod = jest.requireActual('../modules/services/PettyCashLiveSync.js');
const PettyCashLiveSync = Mod.PettyCashLiveSync || Mod.default;

/** Crea un par {subscribe, onApply} con jest mocks. El subscribe captura
 *  el callback para poder dispararlo manualmente. */
function makePair() {
    const unsub = jest.fn();
    let captured = null;
    const subscribe = jest.fn((cb) => { captured = cb; return unsub; });
    const onApply = jest.fn();
    return { subscribe, onApply, unsub, fire: (items) => captured && captured(items) };
}

function makeConfig() {
    return { projects: makePair(), periods: makePair(), movements: makePair() };
}

testRunner.addSuite("PettyCashLiveSync — start / stop", {

    "start con config válida suscribe a las 3 colecciones"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        const ok = PettyCashLiveSync.start(cfg);
        testRunner.assertEquals(ok, true);
        testRunner.assertEquals(cfg.projects.subscribe.mock.calls.length, 1);
        testRunner.assertEquals(cfg.periods.subscribe.mock.calls.length, 1);
        testRunner.assertEquals(cfg.movements.subscribe.mock.calls.length, 1);
        testRunner.assertEquals(PettyCashLiveSync.isActive(), true);
        PettyCashLiveSync.stop();
    },

    "start es idempotente (no duplica listeners)"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        PettyCashLiveSync.start(cfg);
        PettyCashLiveSync.start(cfg); // segundo start
        testRunner.assertEquals(cfg.projects.subscribe.mock.calls.length, 1,
            "no debe re-suscribir si ya está activo");
        PettyCashLiveSync.stop();
    },

    "start sin config válida retorna false"() {
        PettyCashLiveSync.stop();
        testRunner.assertEquals(PettyCashLiveSync.start({}), false);
        testRunner.assertEquals(PettyCashLiveSync.start(), false);
        testRunner.assertEquals(PettyCashLiveSync.isActive(), false);
    },

    "stop desuscribe todo y permite re-start"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        PettyCashLiveSync.start(cfg);
        PettyCashLiveSync.stop();
        testRunner.assertEquals(cfg.projects.unsub.mock.calls.length, 1);
        testRunner.assertEquals(cfg.periods.unsub.mock.calls.length, 1);
        testRunner.assertEquals(cfg.movements.unsub.mock.calls.length, 1);
        testRunner.assertEquals(PettyCashLiveSync.isActive(), false);
        // re-start funciona
        const cfg2 = makeConfig();
        testRunner.assertEquals(PettyCashLiveSync.start(cfg2), true);
        PettyCashLiveSync.stop();
    },

    "replace cambia solo la suscripción solicitada"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        PettyCashLiveSync.start(cfg);
        const nextMovements = makePair();

        const ok = PettyCashLiveSync.replace('movements', nextMovements);

        testRunner.assertEquals(ok, true);
        testRunner.assertEquals(cfg.movements.unsub.mock.calls.length, 1);
        testRunner.assertEquals(cfg.projects.unsub.mock.calls.length, 0);
        testRunner.assertEquals(nextMovements.subscribe.mock.calls.length, 1);
        PettyCashLiveSync.stop();
    }

});

testRunner.addSuite("PettyCashLiveSync — aplicación de cambios remotos", {

    "un cambio remoto invoca el onApply correspondiente con la lista"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        PettyCashLiveSync.start(cfg);
        const movs = [{ id: 'm1', amount: 100 }];
        cfg.movements.fire(movs);
        testRunner.assertEquals(cfg.movements.onApply.mock.calls.length, 1);
        testRunner.assertEquals(cfg.movements.onApply.mock.calls[0][0], movs);
        // no debe disparar los otros
        testRunner.assertEquals(cfg.projects.onApply.mock.calls.length, 0);
        PettyCashLiveSync.stop();
    },

    "envuelve onApply con el guard window._isApplyingRemoteData"() {
        PettyCashLiveSync.stop();
        const cfg = makeConfig();
        let flagDuringApply = null;
        cfg.movements.onApply.mockImplementation(() => {
            flagDuringApply = (typeof window !== 'undefined') ? window._isApplyingRemoteData : null;
        });
        PettyCashLiveSync.start(cfg);
        cfg.movements.fire([{ id: 'm1' }]);
        testRunner.assertEquals(flagDuringApply, true,
            "_isApplyingRemoteData debe estar activo durante onApply para no rebotar la escritura");
        PettyCashLiveSync.stop();
    }

});

console.log('🧪 PettyCashLiveSync tests cargados.');
