import {
    defaultState, canAdvance, navNext, navBack, goGuideStep,
    pick, toggleDay, hPlus, hMinus, setPosColor, setField,
    addEmployee, removeEmployee, saveProgress, restoreProgress,
    STEPS, SETUP_TOTAL
} from '../modules/ui/onboarding/OnboardingCore.js';
const KEY = 'onboarding-pos';
// Completa los datos que validan los pasos de configuración 1, 4 y 5.
function fillSetup(s) {
    s.company = 'Contrutek';
    s.posName = 'Ayudante';
    setField(s, 'newEmpName', 'Franklin');
    addEmployee(s);
    return s;
}
const toChoice = s => { while (s.phase === 'guide') navNext(s); return s; };
const driveToReady = s => { pick(s, 'scratch'); while (s.phase !== 'ready') { fillSetup(s); navNext(s); } return s; };
testRunner.addSuite('Onboarding v2 — núcleo (fase 1)', {
    'estado inicial con la forma del prototipo'() {
        const s = defaultState();
        testRunner.assertEquals([s.phase, s.step, s.setupStep, s.source, s.hours].join('|'), 'guide|1|1||8', 'arranca en guía paso 1 sin origen');
        testRunner.assertEquals(s.days.join(','), 'true,true,true,true,true,true,false', 'semana laboral por defecto L-V');
        testRunner.assertEquals([s.company, s.posName, s.posRate, s.newEmpName, s.newEmpCode].join('|'), '||||', 'campos de texto vacíos');
        testRunner.assert(Array.isArray(s.employees) && s.employees.length === 0 && s.posColorIdx === 0 && !s.googleConnected, 'colecciones y flags por defecto');
        testRunner.assertEquals(STEPS.length + ':' + SETUP_TOTAL, '6:6', 'seis pasos de guía y de configuración');
    },
    'canAdvance: guía siempre, elección exige source y cada paso valida'() {
        const base = defaultState();
        testRunner.assertEquals(canAdvance(base), true, 'guía siempre avanza');
        testRunner.assertEquals(canAdvance({ ...base, phase: 'choice' }), false, 'elección sin source no avanza');
        testRunner.assertEquals(canAdvance(pick({ ...base, phase: 'choice' }, 'scratch')), true, 'elección con source avanza');
        const su = (n, patch = {}) => ({ ...base, phase: 'setup', setupStep: n, employees: [], days: [...base.days], hours: 8, company: '', posName: '', ...patch });
        for (const [n, patch, ok] of [
            [1, {}, false], [1, { company: '   ' }, false], [1, { company: 'ACME' }, true],
            [2, { days: [false, false, false, false, false, false] }, false], [2, {}, true],
            [3, { hours: 0 }, false], [3, {}, true],
            [4, {}, false], [4, { posName: 'Op' }, true],
            [5, {}, false], [5, { employees: [{ code: '001', name: 'X' }] }, true],
            [6, {}, true]
        ]) testRunner.assertEquals(canAdvance(su(n, patch)), ok, `paso ${n} con ${JSON.stringify(patch)}`);
    },
    'navNext: camino feliz completo y saltos de backup/google'() {
        const s = defaultState();
        for (let i = 1; i < STEPS.length; i++) {
            navNext(s);
            testRunner.assertEquals(s.phase + ':' + s.step, 'guide:' + (i + 1), 'avanza por la guía');
        }
        navNext(s);
        testRunner.assertEquals(s.phase, 'choice', 'último paso de guía → elección');
        navNext(s); // sin source no avanza
        testRunner.assertEquals(s.phase, 'choice', 'elección bloqueada sin source');
        navNext(pick(s, 'scratch'));
        testRunner.assertEquals(s.phase + ':' + s.setupStep, 'setup:1', 'scratch → configuración 1');
        for (let n = 1; n <= SETUP_TOTAL; n++) { fillSetup(s); navNext(s); if (n < SETUP_TOTAL) testRunner.assertEquals(s.setupStep, n + 1, 'avanza configuración'); }
        testRunner.assertEquals(s.phase, 'ready', 'configuración completa → listo');
        for (const src of ['backup', 'google']) {
            const j = toChoice(pick(defaultState(), src));
            navNext(j);
            testRunner.assertEquals(j.phase, 'ready', src + ' salta directo a listo');
        }
    },
    'navBack: bordes de guía, elección, configuración y listo'() {
        const s = defaultState();
        navBack(s);
        testRunner.assertEquals(s.step, 1, 'paso 1 de guía es no-op');
        goGuideStep(s, 3);
        navBack(s);
        testRunner.assertEquals(s.step, 2, 'retrocede dentro de la guía');
        toChoice(s);
        navBack(s);
        testRunner.assertEquals(s.phase + ':' + s.step, 'guide:' + STEPS.length, 'elección → último paso de guía');
        navNext(pick(s, 'scratch'));
        navNext(s); // elección (scratch) → configuración 1
        navBack(s);
        testRunner.assertEquals(s.phase + ':' + s.step, 'choice:' + STEPS.length, 'configuración 1 → elección');
        s.phase = 'setup';
        s.setupStep = 1;
        navBack(s);
        testRunner.assertEquals(s.phase, 'choice', 'configuración 1 cae a elección');
        s.phase = 'ready';
        navBack(s);
        testRunner.assertEquals(s.phase, 'ready', 'listo es no-op');
        const w = toggleDay(defaultState(), 6);
        setPosColor(w, 3);
        testRunner.assertEquals([w.days[6], w.posColorIdx].join('|'), 'true|3', 'toggle día y color');
        w.hours = 16;
        hPlus(w);
        testRunner.assertEquals(w.hours, 16, 'clamp superior 16');
        w.hours = 1;
        hMinus(w);
        testRunner.assertEquals(w.hours, 1, 'clamp inferior 1');
    },
    'persistencia: ida y vuelta, JSON corrupto y fuera de rango caen seguro, listo limpia la clave'() {
        const storage = localStorage;
        try { storage.removeItem(KEY); } catch (e) { /* sin storage */ }
        const s = fillSetup(defaultState());
        s.phase = 'setup';
        s.setupStep = 4;
        saveProgress(storage, s);
        testRunner.assertEquals(storage.getItem(KEY), '{"phase":"setup","step":1,"setupStep":4}', 'guarda fase/paso');
        const restored = restoreProgress(storage, defaultState());
        testRunner.assertEquals(restored.phase + ':' + restored.setupStep, 'setup:4', 'restaura posición');
        storage.setItem(KEY, '{no-es-json');
        const safe = restoreProgress(storage, defaultState());
        testRunner.assertEquals(safe.phase + ':' + safe.step, 'guide:1', 'JSON corrupto → estado por defecto');
        storage.setItem(KEY, JSON.stringify({ phase: 'setup', setupStep: 99 }));
        testRunner.assertEquals(restoreProgress(storage, defaultState()).phase, 'guide', 'fuera de rango → sin cambio');
        storage.setItem(KEY, JSON.stringify({ phase: 'choice' }));
        testRunner.assertEquals(restoreProgress(storage, defaultState()).phase, 'choice', 'elección se restaura');
        saveProgress(storage, driveToReady(defaultState()));
        testRunner.assertEquals(storage.getItem(KEY), null, 'llegar a listo limpia la clave');
    },
    'empleado: código automático máximo numérico + 1 sin colisión, manual respetado'() {
        const s = defaultState();
        addEmployee(s);
        testRunner.assertEquals(s.employees.length, 0, 'sin nombre no agrega');
        setField(s, 'newEmpName', 'Ana');
        addEmployee(s);
        testRunner.assertEquals(s.employees[0].code + '|' + s.employees[0].pos, '001|Sin posición', 'primer empleado 001');
        removeEmployee(s, '001');
        s.employees.push({ code: '001', name: 'X' }, { code: '003', name: 'Y' });
        setField(s, 'newEmpName', 'Beto');
        addEmployee(s);
        testRunner.assertEquals(s.employees[2].code, '004', 'máximo numérico existente + 1');
        setField(s, 'newEmpName', 'Cleo');
        setField(s, 'newEmpCode', '010');
        addEmployee(s);
        testRunner.assertEquals(s.employees[3].code + '|' + s.newEmpName + s.newEmpCode, '010|', 'código manual respetado e inputs limpios');
        setField(s, 'employees', 'inyección'); // campos no string protegidos
        testRunner.assert(Array.isArray(s.employees), 'colecciones intocables vía data-field');
    }
});
