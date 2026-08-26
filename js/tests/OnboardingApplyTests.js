import { applySetup, uniqueNumber } from '../modules/ui/onboarding/OnboardingApply.js';
import { COLOR_PALETTE } from '../modules/utils/Constants.js';

function fakeStorage() {
    const m = {};
    return {
        getItem: k => (k in m ? m[k] : null),
        setItem: (k, v) => { m[k] = String(v); },
        removeItem: k => { delete m[k]; }
    };
}

/* Deps con contadores y registro de orden; ninguna toca estado global real. */
function stubDeps(over = {}) {
    const calls = { events: [], settings: null, positionData: null, employeesData: [] };
    const deps = {
        updateSettings: patch => { calls.settings = patch; calls.events.push('settings'); },
        createPosition: data => { calls.positionData = data; calls.events.push('position'); return { id: 'pos-1', ...data }; },
        createEmployee: data => { calls.employeesData.push(data); calls.events.push('emp'); return { id: 'emp-' + data.number, ...data }; },
        saveAll: async () => { calls.events.push('save'); },
        storage: fakeStorage(),
        ...over
    };
    deps.__calls = calls;
    return deps;
}

function v2state(over = {}) {
    return {
        company: '  Constructora Horizon  ',
        days: [true, true, true, true, true, true, false],
        hours: 8,
        posName: ' Ayudante ',
        posRate: '112.5',
        posColorIdx: 2,
        employees: [
            { code: '001', name: 'Franklin Henrriquez', pos: 'Ayudante' },
            { code: '002', name: 'María Pérez', pos: 'Ayudante' },
            { code: '003', name: 'Juan López', pos: 'Ayudante' }
        ],
        ...over
    };
}

testRunner.addSuite('Onboarding v2 — aplicar setup al estado real', {
    'camino feliz: ajustes recortados y posición con mapeo completo'() {
        const deps = stubDeps();
        return applySetup(v2state(), deps).then(res => {
            testRunner.assertEquals(res.applied, true, 'resultado aplicado');
            testRunner.assertEquals(deps.__calls.settings.companyName, 'Constructora Horizon', 'nombre de empresa recortado');
            testRunner.assertEquals(deps.__calls.settings.regularHoursPerDay, 8, 'horas por día en ajustes');
            const p = deps.__calls.positionData;
            testRunner.assertEquals(p.name, 'Ayudante', 'nombre de posición recortado');
            testRunner.assert(JSON.stringify(p.workingDays) === JSON.stringify([1, 2, 3, 4, 5, 6]), 'días L-S mapeados a 1-6 (por defecto)');
            testRunner.assertEquals(p.color, COLOR_PALETTE[2], 'color según índice elegido');
            testRunner.assertEquals(p.hourlyRate, 112.5, 'tarifa numérica por hora');
            testRunner.assertEquals(p.salaryInputMode, 'hourly', 'modo de carga por hora');
        });
    },
    'domingo activado: workingDays incluye 0'() {
        const deps = stubDeps();
        const st = v2state();
        st.days[6] = true;
        return applySetup(st, deps).then(() => {
            const wd = deps.__calls.positionData.workingDays;
            testRunner.assert(wd.includes(0), 'domingo mapeado a 0');
            testRunner.assert(JSON.stringify(wd) === JSON.stringify([1, 2, 3, 4, 5, 6, 0]), 'orden lunes→domingo');
        });
    },
    'tarifa vacía: hourlyRate cae a 0'() {
        const deps = stubDeps();
        return applySetup(v2state({ posRate: '' }), deps).then(() => {
            testRunner.assertEquals(deps.__calls.positionData.hourlyRate, 0, 'tarifa 0 cuando el campo viene vacío');
        });
    },
    'tres empleados v2: números propios y ligados a la posición creada'() {
        const deps = stubDeps();
        return applySetup(v2state(), deps).then(() => {
            const data = deps.__calls.employeesData;
            testRunner.assertEquals(data.length, 3, 'tres empleados creados');
            testRunner.assert(data.every((e, i) => e.number === String(i + 1).padStart(3, '0')), 'códigos v2 pasan como número');
            testRunner.assert(data.every(e => JSON.stringify(e.positions) === JSON.stringify(['pos-1'])), 'ligados a la posición creada');
            testRunner.assert(data.every((e, i) => e.name === v2state().employees[i].name), 'nombres intactos');
        });
    },
    'saveAll corre UNA sola vez y DESPUÉS de todas las creaciones'() {
        const deps = stubDeps();
        return applySetup(v2state(), deps).then(() => {
            const ev = deps.__calls.events;
            testRunner.assertEquals(ev.filter(x => x === 'save').length, 1, 'un único saveAll');
            testRunner.assertEquals(ev[ev.length - 1], 'save', 'saveAll es el último paso');
            testRunner.assert(ev.indexOf('position') < ev.indexOf('save') && ev.lastIndexOf('emp') < ev.indexOf('save'), 'creaciones antes del guardado');
        });
    },
    'éxito marca la clave de finalización del onboarding'() {
        const deps = stubDeps();
        return applySetup(v2state(), deps).then(() => {
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), 'true', 'flag marcada en el storage inyectado');
        });
    },
    'fallo a mitad de creaciones: error, sin saveAll y sin flag'() {
        const deps = stubDeps();
        deps.createEmployee = data => {
            if (data.number === '002') throw new Error('ficha duplicada');
            deps.__calls.employeesData.push(data);
            deps.__calls.events.push('emp');
            return { id: 'emp-' + data.number, ...data };
        };
        return applySetup(v2state(), deps).then(res => {
            testRunner.assertEquals(res.applied, false, 'no aplicado ante fallo');
            testRunner.assert(!!res.error, 'error reportado');
            testRunner.assert(!deps.__calls.events.includes('save'), 'saveAll NO invocado');
            testRunner.assertEquals(deps.storage.getItem('onboardingCompleted'), null, 'flag sin marcar');
        });
    },
    'uniqueNumber: número libre se respeta y la colisión hace bump'() {
        testRunner.assertEquals(uniqueNumber('007', [{ number: '003' }]), '007', 'libre pasa igual');
        testRunner.assertEquals(uniqueNumber('003', [{ number: '001' }, { number: '003' }, { number: '004' }]), '005', 'bump al primer número libre');
    }
});
