/**
 * 🧪 LegacyMergeEmployeesTests
 *
 * The legacy `mergeEmployees` (PersistenceService.js) is what runs when
 * the wizard absorbs a duplicate that exists in state.employees (the
 * common case for migrated accounts). Historically it only merged
 * attendance, advances, bonuses, deductions — silently dropping the
 * duplicate's loans, positions, and positionSalaries.
 *
 * User's worked example to validate end-to-end:
 *   master    → 5 attendance, 0 loans, positions [a,b]
 *   duplicate → 0 attendance, 3 loans, positions [a,c]
 *   result    → 5 attendance, 3 loans, positions [a,b,c]
 */

import { state, stateManager } from '../modules/core/AppState.js';
import { mergeEmployees, beginLocalDataWipe, endLocalDataWipe } from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

function resetState(employees, attendance = {}) {
    state.employees.splice(0, state.employees.length, ...employees);
    if (state.attendance) {
        Object.keys(state.attendance).forEach(k => delete state.attendance[k]);
        Object.entries(attendance).forEach(([k, v]) => { state.attendance[k] = v; });
    }
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

testRunner.addSuite("Legacy mergeEmployees — préstamos, posiciones y positionSalaries", {

    "préstamos del duplicate se preservan en el master"() {
        // Bug histórico: loans se descartaban silenciosamente.
        resetState([
            { id: 'A', name: 'Erlin', loans: [] },
            { id: 'B', name: 'Erlin', loans: [
                { id: 'L1', principal: 1000 },
                { id: 'L2', principal: 2000 },
                { id: 'L3', principal: 3000 }
            ]}
        ]);
        const ok = mergeEmployees('A', 'B');
        testRunner.assertEquals(ok, true);
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 3,
            'Los 3 préstamos del duplicate deben quedar en el master');
        const ids = master.loans.map(l => l.id).sort();
        testRunner.assertEquals(ids.join(','), 'L1,L2,L3');
    },

    "préstamos con mismo id en master y duplicate: gana el de mayor updatedAt"() {
        resetState([
            { id: 'A', loans: [{ id: 'L1', principal: 1000, updatedAt: 100 }] },
            { id: 'B', loans: [{ id: 'L1', principal: 2000, updatedAt: 200 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 1);
        testRunner.assertEquals(master.loans[0].principal, 2000,
            'El loan con updatedAt mayor debe ganar');
    },

    "préstamos sin id reciben uno sintético y se preservan"() {
        // Defensa adicional sobre lo que ya hace unionById durante save.
        resetState([
            { id: 'A', loans: [{ principal: 100 }] },
            { id: 'B', loans: [{ principal: 200 }, { principal: 300 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 3,
            'Los 3 loans sin id deben preservarse');
        const allHaveIds = master.loans.every(l => typeof l.id === 'string' && l.id.length > 0);
        testRunner.assert(allHaveIds,
            'Todos los loans terminan con id (backfill)');
    },

    "positions: unión deduplicada"() {
        // User's example: [a,b] + [a,c] = [a,b,c]
        resetState([
            { id: 'A', positions: ['a', 'b'] },
            { id: 'B', positions: ['a', 'c'] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.positions.length, 3);
        const sorted = [...master.positions].sort().join(',');
        testRunner.assertEquals(sorted, 'a,b,c');
    },

    "positionSalaries: unión por positionId, master gana en colisión"() {
        // Master es local "ganador" (el usuario lo eligió explícitamente);
        // sus valores prevalecen en empate, los del duplicate solo entran
        // si no existen.
        resetState([
            { id: 'A', positionSalaries: { pos1: 100, pos2: 200 } },
            { id: 'B', positionSalaries: { pos2: 999, pos3: 300 } }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.positionSalaries.pos1, 100);
        testRunner.assertEquals(master.positionSalaries.pos2, 200,
            'En empate, gana el del master');
        testRunner.assertEquals(master.positionSalaries.pos3, 300);
    },

    // 🐛 Judgment Day Fase 2A Ronda 3 (Juez A): el merge de duplicados une
    // positions/positionSalaries y estampa updatedAt, pero NO estampaba
    // positionsUpdatedAt — con el LWW asimétrico de puestos, la unión podía
    // perder contra un sello stale del otro dispositivo en el próximo merge.
    "el merge estampa positionsUpdatedAt en el master (la unión debe ganar el LWW de puestos)"() {
        resetState([
            { id: 'A', positions: ['a'], positionsUpdatedAt: 1000, updatedAt: 1000 },
            { id: 'B', positions: ['a', 'c'] }
        ]);
        const before = Date.now() - 1;
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assert(master.positionsUpdatedAt > before,
            'el master absorbe puestos del duplicado → positionsUpdatedAt debe estamparse junto con updatedAt');
    },

    "advances/bonuses/deductions: ahora dedup por id (antes concatenaba ciegamente)"() {
        // Antes la concatenación creaba duplicados si el mismo advance
        // estaba en ambos lados (caso real cuando se importaba mal).
        resetState([
            { id: 'A', advances: [{ id: 'ADV-1', amount: 100 }] },
            { id: 'B', advances: [{ id: 'ADV-1', amount: 100 }, { id: 'ADV-2', amount: 200 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.advances.length, 2,
            'ADV-1 no debe duplicarse, ADV-2 debe entrar');
    },

    "escenario completo del usuario: 5 asistencias + 0 préstamos + [a,b] absorbe 0 + 3 + [a,c]"() {
        const attendance = {
            'A-2026-05-01': { employeeId: 'A', present: true },
            'A-2026-05-02': { employeeId: 'A', present: true },
            'A-2026-05-03': { employeeId: 'A', present: true },
            'A-2026-05-04': { employeeId: 'A', present: true },
            'A-2026-05-05': { employeeId: 'A', present: true }
        };
        resetState([
            { id: 'A', loans: [], positions: ['a', 'b'] },
            { id: 'B', loans: [
                { id: 'L1', principal: 1000 },
                { id: 'L2', principal: 2000 },
                { id: 'L3', principal: 3000 }
            ], positions: ['a', 'c'] }
        ], attendance);

        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');

        const attendanceCount = Object.keys(state.attendance)
            .filter(k => k.startsWith('A-')).length;
        testRunner.assertEquals(attendanceCount, 5, '5 asistencias');
        testRunner.assertEquals(master.loans.length, 3, '3 préstamos');
        testRunner.assertEquals(master.positions.length, 3, '3 posiciones');
        const posSorted = [...master.positions].sort().join(',');
        testRunner.assertEquals(posSorted, 'a,b,c', 'posiciones [a,b,c]');
    },

    "actualiza updatedAt del master al fusionar"() {
        resetState([
            { id: 'A', updatedAt: 100, loans: [] },
            { id: 'B', updatedAt: 50, loans: [{ id: 'L1' }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assert(master.updatedAt > 100,
            'master.updatedAt debe avanzar para que cloud reciba el cambio');
    },

    "asistencia del duplicate: la clave vieja se tombstonea, no se borra (Fase 1, U2b)"() {
        // setDoc({merge:true}) nunca borra claves de un mapa — un `delete` local
        // no se propaga a la nube y el registro resucita al hacer eco. El remap
        // de asistencia debe dejar la clave vieja como tombstone viajando como dato.
        const attendance = {
            'B-2026-06-01': { employeeId: 'B', date: '2026-06-01', present: true, hoursWorked: 8 }
        };
        resetState([
            { id: 'A', loans: [] },
            { id: 'B', loans: [] }
        ], attendance);

        mergeEmployees('A', 'B');

        const oldRecord = state.attendance['B-2026-06-01'];
        testRunner.assert(!!oldRecord, 'la clave vieja B-2026-06-01 NO debe borrarse — debe seguir existiendo como tombstone');
        testRunner.assert(oldRecord.deletedAt !== null && oldRecord.deletedAt !== undefined,
            'la clave vieja debe quedar tombstoneada (deletedAt seteado)');
        testRunner.assertEquals(oldRecord.present, false, 'el tombstone marca present=false');

        const movedRecord = state.attendance['A-2026-06-01'];
        testRunner.assert(!!movedRecord, 'el registro debe existir bajo la clave nueva A-2026-06-01');
        testRunner.assertEquals(movedRecord.present, true, 'el registro movido conserva sus datos (present=true)');
        testRunner.assert(movedRecord.deletedAt === null || movedRecord.deletedAt === undefined,
            'el registro movido NO debe quedar con un deletedAt residual del tombstone');
    },

    "fusión inteligente (mismo día en ambos lados): pasa por el choke point — revive un tombstone del master y refresca updatedAt (Judgment Day Fase 1 R1)"() {
        // Ambos lados tienen registro el MISMO día → dispara la rama 'else'
        // ("Fusionar inteligentemente"). El master está tombstoneado
        // (present:false, deletedAt seteado) y el duplicate está vivo
        // (present:true). Antes del fix: el merge hacía
        // `existingRecord.present = existingRecord.present || oldRecord.present`
        // (queda true) PERO nunca limpiaba deletedAt ni refrescaba updatedAt —
        // el registro resultante quedaba present:true + deletedAt seteado
        // (contradictorio) y con updatedAt viejo (podía perder un LWW futuro).
        const masterUpdatedAtBefore = 1000;
        const dupUpdatedAtBefore = 1000;
        const attendance = {
            'A-2026-06-10': {
                employeeId: 'A', date: '2026-06-10',
                present: false, deletedAt: 5000, updatedAt: masterUpdatedAtBefore
            },
            'B-2026-06-10': {
                employeeId: 'B', date: '2026-06-10',
                present: true, hoursWorked: 8, updatedAt: dupUpdatedAtBefore
            }
        };
        resetState([
            { id: 'A', loans: [] },
            { id: 'B', loans: [] }
        ], attendance);

        mergeEmployees('A', 'B');

        const merged = state.attendance['A-2026-06-10'];
        testRunner.assert(!!merged, 'el registro fusionado debe existir bajo la clave del master');
        testRunner.assertEquals(merged.present, true, 'el registro revivido debe quedar present:true');
        testRunner.assert(merged.deletedAt === null || merged.deletedAt === undefined,
            'revivir (present:true) debe limpiar el deletedAt viejo del master — si no, queda present:true + deletedAt seteado (nómina lo paga, todo el resto lo ghostea)');
        testRunner.assert(merged.updatedAt > masterUpdatedAtBefore && merged.updatedAt > dupUpdatedAtBefore,
            'updatedAt debe refrescarse (choke point) para no perder un LWW futuro con contenido recién cambiado');
    }

});

testRunner.addSuite("Legacy mergeEmployees — reencola en el outbox las fechas tocadas (Judgment Day Fase 1 R1)", {

    "cada fecha de asistencia tocada por el merge se reencola vía saveApplicationData → MainSyncStore.enqueueDaily"() {
        // Antes del fix: ningún caller de mergeEmployees (EmployeeModal, MaintenanceUI,
        // el auto-repair de acá mismo) pasa dateKey a saveApplicationData después de
        // fusionar — sólo hacen un save wholesale, y el mirror excluye `attendance` del
        // upload. Las fechas tocadas por el merge quedaban solo-local hasta que el
        // usuario tocara esa fecha de nuevo por casualidad.
        const prevUser = globalThis.currentUser;
        const prevIsDataLoaded = state.isDataLoaded;
        const prevUseIndexedDB = state.useIndexedDB;
        const enqueueSpy = jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined);
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'test-user' };

            const attendance = {
                'B-2026-06-11': { employeeId: 'B', date: '2026-06-11', present: true, hoursWorked: 8 },
                'B-2026-06-12': { employeeId: 'B', date: '2026-06-12', present: true, hoursWorked: 8 }
            };
            resetState([
                { id: 'A', loans: [] },
                { id: 'B', loans: [] }
            ], attendance);

            mergeEmployees('A', 'B');

            testRunner.assertEquals(enqueueSpy.mock.calls.length, 2,
                'debe reencolar la subida diaria UNA vez por cada fecha tocada por el merge (2 fechas)');
            const enqueuedDateKeys = enqueueSpy.mock.calls.map(c => c[0]).sort();
            testRunner.assertEquals(enqueuedDateKeys.join(','), '2026-06-11,2026-06-12',
                'ambas fechas tocadas deben reencolarse — ninguna debe perderse (p.ej. por el colapso del debounce de saveApplicationData, que sólo trackea UN dateKey a la vez)');
        } finally {
            enqueueSpy.mockRestore();
            flushSpy.mockRestore();
            globalThis.currentUser = prevUser;
            state.isDataLoaded = prevIsDataLoaded;
            state.useIndexedDB = prevUseIndexedDB;
        }
    }

});

testRunner.addSuite("Legacy mergeEmployees — orden de operaciones del snapshot mirror (Judgment Day Fase 1 R2)", {

    "el mirror subido a la nube refleja el merge YA completo, no a mitad de camino"() {
        // Antes del fix R2-1: el bloque que reencola touchedDateKeys corría
        // ANTES de fusionar loans/positions/positionSalaries y de eliminar
        // el duplicate de state.employees (pasos 2-7). Como
        // saveApplicationData({ immediate: true }) ejecuta _executeSave()
        // SÍNCRONAMENTE hasta capturar el snapshot completo del mirror
        // (MainSyncStore.enqueueMirror), ese snapshot subía a mitad de la
        // fusión: el duplicate seguía en state.employees y master.loans
        // todavía no tenía la unión.
        const prevUser = globalThis.currentUser;
        const prevIsDataLoaded = state.isDataLoaded;
        const prevUseIndexedDB = state.useIndexedDB;
        let capturedSnapshot = null;
        const enqueueDailySpy = jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined);
        const enqueueMirrorSpy = jest.spyOn(MainSyncStore, 'enqueueMirror').mockImplementation((snapshot) => {
            if (!capturedSnapshot) capturedSnapshot = snapshot;
            return Promise.resolve();
        });
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'test-user' };

            const attendance = {
                'B-2026-06-20': { employeeId: 'B', date: '2026-06-20', present: true, hoursWorked: 8 }
            };
            resetState([
                { id: 'A', loans: [], positions: ['a'] },
                { id: 'B', loans: [{ id: 'L1', principal: 1000 }], positions: ['c'] }
            ], attendance);

            mergeEmployees('A', 'B');

            testRunner.assert(!!capturedSnapshot,
                'el mirror debe haberse encolado al menos una vez durante el merge');
            const dupStillPresent = capturedSnapshot.employees.some(e => e.id === 'B');
            testRunner.assert(!dupStillPresent,
                'el duplicate ya debe estar eliminado de state.employees en el momento en que se sube el mirror (paso 7 ya corrió)');
            const masterInSnapshot = capturedSnapshot.employees.find(e => e.id === 'A');
            testRunner.assert(!!masterInSnapshot, 'el master debe existir en el snapshot');
            testRunner.assertEquals(masterInSnapshot.loans.length, 1,
                'los loans del duplicate ya deben estar fusionados en el master en el momento del mirror (paso 2 ya corrió)');
        } finally {
            enqueueDailySpy.mockRestore();
            enqueueMirrorSpy.mockRestore();
            flushSpy.mockRestore();
            globalThis.currentUser = prevUser;
            state.isDataLoaded = prevIsDataLoaded;
            state.useIndexedDB = prevUseIndexedDB;
        }
    },

    "saveApplicationData() puede retornar undefined (borrado local en curso) sin que mergeEmployees explote"() {
        // saveApplicationData()'s primera línea es `if (_localDataWipeInProgress) return;`
        // — retorna undefined sin importar `immediate`. Sin el guard, el forEach
        // encadenaba `.catch()` directo sobre ese undefined y tiraba un
        // TypeError síncrono que abortaba mergeEmployees entero (ningún caller
        // lo envuelve en try/catch) — dejando un estado a medio fusionar
        // (peor que antes de intentar el merge).
        const attendance = {
            'B-2026-06-21': { employeeId: 'B', date: '2026-06-21', present: true, hoursWorked: 8 }
        };
        resetState([
            { id: 'A', loans: [] },
            { id: 'B', loans: [{ id: 'L1', principal: 1000 }] }
        ], attendance);

        let threw = false;
        let ok;
        beginLocalDataWipe();
        try {
            ok = mergeEmployees('A', 'B');
        } catch (e) {
            threw = true;
        } finally {
            endLocalDataWipe();
        }

        testRunner.assert(!threw,
            'mergeEmployees no debe throwear aunque saveApplicationData() retorne undefined');
        testRunner.assertEquals(ok, true, 'mergeEmployees debe completar y retornar true');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assert(!!master, 'el master debe seguir existiendo');
        testRunner.assertEquals(master.loans.length, 1,
            'los loans del duplicate deben quedar fusionados (los pasos 2-7 deben haber corrido)');
        const dup = state.employees.find(e => e.id === 'B');
        testRunner.assert(!dup, 'el duplicate debe estar eliminado (paso 7 debe haber corrido)');
    }

});

testRunner.addSuite("Legacy mergeEmployees — el reencolado sobrevive a un fallo en los pasos 2-7 (Judgment Day Fase 1 R3)", {

    "si un paso posterior al remap de asistencia lanza, las fechas tocadas se reencolan igual"() {
        // Hallazgo teórico del Juez A (R3): tras reubicar el reencolado al final
        // (fix R2-1), una excepción en los pasos 2-7 (loans/posiciones/campos/
        // eliminación del duplicate) abortaba la función ANTES del forEach — la
        // asistencia ya remapeada/tombstoneada en el paso 1 quedaba solo-local,
        // sin subida granular encolada jamás. La excepción debe seguir
        // propagándose (no se traga), pero el reencolado tiene que correr.
        const prevUser = globalThis.currentUser;
        const prevIsDataLoaded = state.isDataLoaded;
        const prevUseIndexedDB = state.useIndexedDB;
        const enqueueDailySpy = jest.spyOn(MainSyncStore, 'enqueueDaily').mockResolvedValue(undefined);
        const enqueueMirrorSpy = jest.spyOn(MainSyncStore, 'enqueueMirror').mockResolvedValue(undefined);
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        try {
            state.isDataLoaded = true;
            state.useIndexedDB = true;
            globalThis.currentUser = { uid: 'test-user' };

            const attendance = {
                'B-2026-06-22': { employeeId: 'B', date: '2026-06-22', present: true, hoursWorked: 8 }
            };
            resetState([{ id: 'A', loans: [] }, { id: 'B', loans: [] }], attendance);

            // Armar la trampa DESPUÉS del seed, sobre el objeto RAW ya
            // almacenado: el set-trap del proxy (toRaw) CLONA los objetos al
            // escribirlos, así que un getter definido antes del splice nunca
            // llega al state (y encima el clonado lo dispararía durante el
            // seed). Un getter que lanza al leer `loans` simula un fallo
            // inesperado en el paso 2 (unionById evalúa duplicate.loans).
            const rawDup = stateManager.getState().employees.find(e => e.id === 'B');
            Object.defineProperty(rawDup, 'loans', {
                get() { throw new Error('boom en paso 2'); },
                enumerable: true,
                configurable: true
            });

            let threw = false;
            try {
                mergeEmployees('A', 'B');
            } catch (e) {
                threw = true;
            }

            testRunner.assert(threw,
                'la excepción del paso 2 debe seguir propagándose (no se traga — el caller debe enterarse)');
            const enqueuedDateKeys = enqueueDailySpy.mock.calls.map(c => c[0]);
            testRunner.assert(enqueuedDateKeys.includes('2026-06-22'),
                'la fecha tocada por el remap debe reencolarse AUNQUE un paso posterior falle — si no, el tombstone queda solo-local y el borrado nunca llega a la nube');
        } finally {
            enqueueDailySpy.mockRestore();
            enqueueMirrorSpy.mockRestore();
            flushSpy.mockRestore();
            globalThis.currentUser = prevUser;
            state.isDataLoaded = prevIsDataLoaded;
            state.useIndexedDB = prevUseIndexedDB;
        }
    }

});

console.log('🧪 Legacy mergeEmployees tests cargados.');
