/**
 * 🧪 CloudPayloadExclusionTests (Auditoría 2026-06-09, hallazgo C3)
 *
 * state.pettyCash contiene, además de projects/periods/movements, estado de
 * UI: form (con photoDataUrl en base64), _editPhoto, editMov, batchStatus...
 * Si eso entra al doc espejo users/{uid}/data/current:
 *   1. Una foto base64 puede superar el límite de 1 MB de Firestore →
 *      TODO el mirror sync falla repetidamente.
 *   2. Los datos de caja chica se duplican (ya viven per-doc en sus
 *      subcolecciones projects/cashPeriods/pettyCash).
 *
 * Contratos:
 *   - saveFullState y replaceCloudFull EXCLUYEN pettyCash del payload.
 *   - createSnapshot incluye solo una copia SANEADA (datos puros) vía
 *     sanitizePettyCashForSnapshot.
 *
 * Suite behavioral: SnapshotSanitizer es un módulo puro (no mockeado),
 * así que su comportamiento se prueba de verdad.
 */

import fs from 'fs';
import path from 'path';
import { sanitizePettyCashForSnapshot } from '../modules/services/SnapshotSanitizer.js';

const FIREBASE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/services/FirebaseService.js'), 'utf8'
);

function methodBlock(name) {
    const m = FIREBASE_SRC.match(new RegExp(`async\\s+${name}\\s*\\([\\s\\S]*?\\n\\s{4}\\}`));
    return m ? m[0] : null;
}

testRunner.addSuite("FirebaseService — pettyCash fuera del mirror (C3)", {

    "saveFullState elimina pettyCash del payload del mirror"() {
        const block = methodBlock('saveFullState');
        testRunner.assert(!!block, 'saveFullState debe existir');
        testRunner.assert(
            /delete\s+snapshotContext\.pettyCash/.test(block),
            'saveFullState debe hacer delete snapshotContext.pettyCash — la caja chica vive per-doc en sus subcolecciones'
        );
    },

    "replaceCloudFull elimina pettyCash del payload"() {
        const block = methodBlock('replaceCloudFull');
        testRunner.assert(!!block, 'replaceCloudFull debe existir');
        testRunner.assert(
            /delete\s+snapshotContext\.pettyCash/.test(block),
            'replaceCloudFull debe hacer delete snapshotContext.pettyCash'
        );
    },

    "createSnapshot sanea pettyCash en lugar de copiarlo crudo"() {
        const block = methodBlock('createSnapshot');
        testRunner.assert(!!block, 'createSnapshot debe existir');
        testRunner.assert(
            /sanitizePettyCashForSnapshot/.test(block),
            'createSnapshot debe pasar pettyCash por sanitizePettyCashForSnapshot (sin form/fotos/estado de UI)'
        );
    }

});

testRunner.addSuite("SnapshotSanitizer — sanitizePettyCashForSnapshot (behavioral)", {

    "null/undefined → null (no inventa estructura)"() {
        testRunner.assertEquals(sanitizePettyCashForSnapshot(null), null);
        testRunner.assertEquals(sanitizePettyCashForSnapshot(undefined), null);
    },

    "conserva projects, periods y movements"() {
        const out = sanitizePettyCashForSnapshot({
            projects: [{ id: 'p1', name: 'Obra' }],
            periods: [{ id: 'per1', projectId: 'p1' }],
            movements: [{ id: 'm1', periodId: 'per1', amount: 100 }]
        });
        testRunner.assertEquals(out.projects.length, 1, 'projects');
        testRunner.assertEquals(out.periods.length, 1, 'periods');
        testRunner.assertEquals(out.movements.length, 1, 'movements');
        testRunner.assertEquals(out.movements[0].amount, 100, 'datos del movimiento intactos');
    },

    "descarta el estado de UI: form, periodForm, editMov, selección"() {
        const out = sanitizePettyCashForSnapshot({
            projects: [], periods: [], movements: [],
            form: { amount: 5, photoDataUrl: 'data:image/jpeg;base64,AAAA' },
            periodForm: { label: 'x' },
            editMov: { id: 'm1' },
            selectedProjectId: 'p1',
            selectedPeriodId: 'per1'
        });
        testRunner.assert(!('form' in out), 'form no debe ir al snapshot');
        testRunner.assert(!('periodForm' in out), 'periodForm no debe ir al snapshot');
        testRunner.assert(!('editMov' in out), 'editMov no debe ir al snapshot');
        testRunner.assert(!('selectedProjectId' in out), 'selección de UI no debe ir al snapshot');
    },

    "descarta campos transitorios con base64 (_editPhoto, batchStatus, _rescanStatus)"() {
        const out = sanitizePettyCashForSnapshot({
            projects: [], periods: [], movements: [],
            _editPhoto: 'data:image/jpeg;base64,BBBB',
            _rescanStatus: '⏳',
            batchStatus: 'Procesando 1 de 3...'
        });
        const serialized = JSON.stringify(out);
        testRunner.assert(!serialized.includes('base64'), 'ninguna foto base64 debe sobrevivir');
        testRunner.assert(!('_editPhoto' in out), '_editPhoto fuera');
        testRunner.assert(!('batchStatus' in out), 'batchStatus fuera');
    },

    "listas no-array se normalizan a []"() {
        const out = sanitizePettyCashForSnapshot({ projects: 'corrupto', periods: null });
        testRunner.assert(Array.isArray(out.projects) && out.projects.length === 0, 'projects → []');
        testRunner.assert(Array.isArray(out.periods) && out.periods.length === 0, 'periods → []');
        testRunner.assert(Array.isArray(out.movements) && out.movements.length === 0, 'movements → []');
    },

    "no muta el objeto de entrada"() {
        const input = {
            projects: [{ id: 'p1' }], periods: [], movements: [],
            form: { photoDataUrl: 'data:x' }
        };
        sanitizePettyCashForSnapshot(input);
        testRunner.assert('form' in input, 'el input no debe mutarse');
    }

});
