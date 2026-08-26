import { executeChoiceAction } from '../modules/ui/onboarding/OnboardingActions.js';
import { stateManager } from '../modules/core/AppState.js';

function fakeStorage() {
    const m = {};
    return {
        getItem: k => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
    };
}

/* Deps inyectadas con contadores; ninguna toca localStorage ni estado global real. */
function baseDeps(over = {}) {
    const calls = { clearData: 0, loadDemoData: 0, confirm: 0 };
    const deps = {
        storage: fakeStorage(),
        hasAnyData: () => false,
        clearData: async () => { calls.clearData++; },
        loadDemoData: async () => { calls.loadDemoData++; },
        showConfirm: async () => { calls.confirm++; return true; },
        loginWithGoogle: async () => ({ uid: 'u1' }),
        onAuthStateChanged: cb => { cb({ uid: 'u1' }); return () => {}; },
        loadBackupFromFile: async () => {},
        ...over
    };
    deps.__calls = calls;
    return deps;
}

function dispatchFileChange(deps, file) {
    const input = document.querySelector('[data-onb-v2-file]');
    if (file) Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return deps.__hooks;
}

testRunner.addSuite('Onboarding v2 — acciones reales de elección', {
    'demo: carga datos de prueba y marca finalización'() {
        const deps = baseDeps();
        return executeChoiceAction('demo', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, true, 'resultado completado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), 'true', 'flag marcada');
            testRunner.assertEquals(deps.__calls.loadDemoData, 1, 'loadDemoData invocado una vez');
        });
    },
    'scratch con datos y confirmación rechazada: no borra nada'() {
        const deps = baseDeps({ hasAnyData: () => true });
        deps.showConfirm = async () => { deps.__calls.confirm++; return false; };
        return executeChoiceAction('scratch', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, false, 'sin completar');
            testRunner.assertEquals(deps.__calls.confirm, 1, 'confirmación pedida');
            testRunner.assertEquals(deps.__calls.clearData, 0, 'clearData NO invocado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), null, 'flag sin marcar');
        });
    },
    'scratch con datos y confirmación aceptada: borra y marca'() {
        const deps = baseDeps({ hasAnyData: () => true });
        return executeChoiceAction('scratch', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, true, 'completado tras aceptar');
            testRunner.assertEquals(deps.__calls.clearData, 1, 'clearData invocado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), 'true', 'flag marcada');
        });
    },
    'scratch sin datos: borra sin preguntar'() {
        const deps = baseDeps({ hasAnyData: () => false });
        return executeChoiceAction('scratch', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, true, 'completado sin confirmación');
            testRunner.assertEquals(deps.__calls.confirm, 0, 'confirm NO invocado');
            testRunner.assertEquals(deps.__calls.clearData, 1, 'clearData invocado');
        });
    },
    'backup cancelado por el usuario: sin marca'() {
        const deps = baseDeps();
        const p = executeChoiceAction('backup', {}, deps);
        dispatchFileChange(deps, null);
        return p.then(res => {
            testRunner.assertEquals(res.completed, false, 'cancelación no completa');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), null, 'flag sin marcar');
            testRunner.assert(!deps.__hooks, 'loadBackupFromFile nunca invocado');
            testRunner.assertEquals(document.querySelector('[data-onb-v2-file]'), null, 'input removido');
        });
    },
    'backup con error de restauración: reporta error sin marcar'() {
        const deps = baseDeps({ loadBackupFromFile: (f, h) => { deps.__hooks = h; } });
        const p = executeChoiceAction('backup', {}, deps);
        const hooks = dispatchFileChange(deps, new File(['{}'], 'b.json'));
        hooks.onError(new Error('json inválido'));
        return p.then(res => {
            testRunner.assertEquals(res.completed, false, 'error no completa');
            testRunner.assert(!!res.error, 'error reportado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), null, 'flag sin marcar');
        });
    },
    'backup restaurado con éxito: marca finalización'() {
        const deps = baseDeps({ loadBackupFromFile: (f, h) => { deps.__hooks = h; } });
        const p = executeChoiceAction('backup', {}, deps);
        const hooks = dispatchFileChange(deps, new File(['{}'], 'b.json'));
        hooks.onSuccess();
        return p.then(res => {
            testRunner.assertEquals(res.completed, true, 'éxito marca completado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), 'true', 'flag marcada');
        });
    },
    'google: sesión iniciada marca finalización'() {
        const deps = baseDeps();
        return executeChoiceAction('google', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, true, 'login exitoso completa');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), 'true', 'flag marcada');
        });
    },
    'google: fallo de login reporta error sin marcar'() {
        const deps = baseDeps({ loginWithGoogle: async () => { throw new Error('popup cerrado'); } });
        return executeChoiceAction('google', {}, deps).then(res => {
            testRunner.assertEquals(res.completed, false, 'fallo no completa');
            testRunner.assert(!!res.error, 'error reportado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), null, 'flag sin marcar');
        });
    },
    'scratch con deps por defecto resetea el dominio sin depender del wizard legacy'() {
        delete window.onboardingWizard;
        globalThis.resolveIconSet = () => 'emoji';
        const prevConfirm = window.showConfirm;
        window.showConfirm = opts => opts.onConfirm();
        const raw = stateManager.getState();
        raw.employees = [{ id: 'e1', name: 'A', positions: [], hireDate: '2020-01-01' }];
        raw.attendance = { 'e1-2026-06-18': { employeeId: 'e1', date: '2026-06-18', present: true, hoursWorked: 8 } };
        return executeChoiceAction('scratch', {}, {}).then(res => {
            window.showConfirm = prevConfirm;
            testRunner.assertEquals(res.completed, true, 'completa resolviendo deps por defecto');
            testRunner.assertEquals(raw.employees.length, 0, 'personal reseteado');
            testRunner.assertEquals(Object.keys(raw.attendance).length, 0, 'asistencia reseteada');
        });
    }
});
