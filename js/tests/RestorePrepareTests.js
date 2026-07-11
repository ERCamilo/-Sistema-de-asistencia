/**
 * 🧪 RestorePrepareTests — la restauración debe GANAR el LWW.
 *
 * Incidente de campo 2026-07-11: window.restoreSnapshot aplicaba el snapshot
 * con sus estampas VIEJAS. El dato restaurado perdía el LWW contra la nube
 * (más nueva), el watermark de subida lo filtraba ("nada cambió") y nunca
 * subía, y el limpiador de integridad remataba borrando las posiciones de
 * todos los empleados y propagando el borrado. Restaurar significa "quiero
 * ESTE estado": debe re-estamparse todo con `now` para ganar el merge, y
 * resetear los watermarks para que el roster completo re-suba.
 *
 * - Behavioral: prepareRestoredState() (módulo puro).
 * - Contrato de fuente: el wiring de window.restoreSnapshot en app.js y el
 *   reset de trackers en FirebaseService.
 */

import fs from 'fs';
import path from 'path';
import { prepareRestoredState } from '../modules/services/RestorePrepare.js';
import { drainMainSyncOutboxUntilEmpty } from '../modules/services/PersistenceService.js';
import { MainSyncStore } from '../modules/services/MainSyncStore.js';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const FB_SRC = read('../modules/services/FirebaseService.js');
const PS_SRC = read('../modules/services/PersistenceService.js');

const NOW = 1_800_000_000_000;

function buildSnapshotState() {
    return {
        employees: [
            { id: 'e1', name: 'Ada', positions: ['p1'], updatedAt: 1000, positionsUpdatedAt: 900 },
            { id: 'e2', name: 'Bob', positions: [], updatedAt: 2000 }
        ],
        positions: [{ id: 'p1', name: 'Ayudante', active: true, updatedAt: 500 }],
        leaders: [{ id: 'l1', name: 'Juan', updatedAt: 700 }],
        attendance: {
            'e1-2026-06-01': { employeeId: 'e1', date: '2026-06-01', present: true, hoursWorked: 8, updatedAt: 1100 },
            'e1-2026-06-02': { employeeId: 'e1', date: '2026-06-02', present: false, deletedAt: 1200, updatedAt: 1200 },
            'e2-2026-06-01': { employeeId: 'e2', date: '2026-06-01', present: true, hoursWorked: 4, updatedAt: 1300 }
        }
    };
}

testRunner.addSuite('RestorePrepare — re-estampado para que la restauración gane', {

    'estampa updatedAt y positionsUpdatedAt = now en TODOS los empleados'() {
        const out = prepareRestoredState(buildSnapshotState(), { now: NOW });
        out.employees.forEach(emp => {
            testRunner.assertEquals(emp.updatedAt, NOW, `updatedAt de ${emp.id} debe ser now`);
            testRunner.assertEquals(emp.positionsUpdatedAt, NOW,
                `positionsUpdatedAt de ${emp.id} debe ser now (gana el LWW fino de puestos)`);
        });
        testRunner.assertEquals(out.employees[0].positions[0], 'p1', 'los datos se conservan');
    },

    'estampa updatedAt = now en puestos y líderes (catálogos)'() {
        const out = prepareRestoredState(buildSnapshotState(), { now: NOW });
        testRunner.assertEquals(out.positions[0].updatedAt, NOW, 'puesto re-estampado');
        testRunner.assertEquals(out.leaders[0].updatedAt, NOW, 'líder re-estampado');
    },

    'estampa la asistencia con la semántica de stampAttendanceWrite'() {
        const out = prepareRestoredState(buildSnapshotState(), { now: NOW });
        const alive = out.attendance['e1-2026-06-01'];
        const dead = out.attendance['e1-2026-06-02'];
        testRunner.assertEquals(alive.updatedAt, NOW, 'registro vivo re-estampado');
        testRunner.assertEquals(alive.deletedAt, null, 'presente ⇒ revive (sin tombstone)');
        testRunner.assertEquals(dead.updatedAt, NOW, 'tombstone re-estampado (el borrado también gana)');
        testRunner.assertEquals(dead.deletedAt, 1200, 'el tombstone del backup se conserva');
    },

    'devuelve dateKeys únicos de toda la asistencia restaurada'() {
        const out = prepareRestoredState(buildSnapshotState(), { now: NOW });
        testRunner.assertEquals(JSON.stringify([...out.dateKeys].sort()),
            JSON.stringify(['2026-06-01', '2026-06-02']),
            'una entrada por fecha, sin duplicados');
    },

    'registro sin .date: deriva la fecha de la CLAVE (fallback de la casa)'() {
        // Judgment Day (jueces A+B): un registro legacy sin `date` quedaba
        // fuera de dateKeys y ese día jamás subía (el espejo excluye
        // asistencia). El resto del código ya deriva la fecha del sufijo de
        // la clave (AttendanceCleanup, syncHistory) — acá faltaba.
        const src = {
            attendance: {
                'e9-2026-05-05': { employeeId: 'e9', present: true, hoursWorked: 8, updatedAt: 100 },
                'e9_2026-05-06': { employeeId: 'e9', present: true, hoursWorked: 8, updatedAt: 100 },
                'rota-sin-fecha': { employeeId: 'e9', present: true, updatedAt: 100 }
            }
        };
        const out = prepareRestoredState(src, { now: NOW });
        testRunner.assert(out.dateKeys.includes('2026-05-05'),
            'clave con sufijo -YYYY-MM-DD debe aportar su fecha');
        testRunner.assert(out.dateKeys.includes('2026-05-06'),
            'clave con sufijo _YYYY-MM-DD (simetría de guiones) también');
        testRunner.assertEquals(out.dateKeys.length, 2,
            'una clave sin fecha derivable no aporta dateKey (pero el registro se conserva)');
        testRunner.assert(out.attendance['rota-sin-fecha'] !== undefined,
            'el registro sin fecha igual se restaura localmente');
    },

    'no muta el snapshot de entrada'() {
        const src = buildSnapshotState();
        const before = JSON.stringify(src);
        prepareRestoredState(src, { now: NOW });
        testRunner.assertEquals(JSON.stringify(src), before, 'el snapshot original queda intacto');
    },

    'snapshot vacío o incompleto no explota'() {
        const out = prepareRestoredState({}, { now: NOW });
        testRunner.assertEquals(out.employees.length, 0, 'sin empleados');
        testRunner.assertEquals(out.dateKeys.length, 0, 'sin fechas');
        const out2 = prepareRestoredState(null, { now: NOW });
        testRunner.assertEquals(out2.positions.length, 0, 'null tolerado');
    }

});

// ─── Contrato de fuente: wiring de la restauración ───────────────────────────

function getRestoreBody() {
    const start = APP_SRC.indexOf('window.restoreSnapshot');
    if (start === -1) return null;
    const end = APP_SRC.indexOf('window.changeDate', start);
    return APP_SRC.slice(start, end === -1 ? start + 9000 : end);
}

testRunner.addSuite('Restore — wiring: la restauración gana y se sube entera', {

    'window.restoreSnapshot usa prepareRestoredState (re-estampado)'() {
        const body = getRestoreBody();
        testRunner.assert(body !== null, 'window.restoreSnapshot debe existir');
        testRunner.assert(body.includes('prepareRestoredState('),
            'debe preparar el snapshot con prepareRestoredState (estampas nuevas)');
    },

    'resetea los watermarks de subida para que el roster completo re-suba'() {
        const body = getRestoreBody();
        testRunner.assert(/resetEntityUploadTrackers\(\)/.test(body),
            'debe resetear los trackers de subida de entidades');
        testRunner.assert(/resetEntityUploadTrackers\s*\(\)\s*\{/.test(FB_SRC) &&
            FB_SRC.includes('_employeeUploadTracker.reset()') &&
            FB_SRC.includes('_positionUploadTracker.reset()') &&
            FB_SRC.includes('_leaderUploadTracker.reset()'),
            'FirebaseService.resetEntityUploadTrackers debe resetear los tres trackers');
    },

    'pausa la descarga de la nube durante la restauración y la reanuda al final'() {
        const body = getRestoreBody();
        testRunner.assert(body.includes('pauseCloudDownload('),
            'debe pausar la descarga antes de aplicar (LiveSync reemplaza catálogos enteros)');
        testRunner.assert(body.includes('resumeCloudDownload('),
            'debe reanudar la descarga al terminar');
        testRunner.assert(body.includes('isDownloadPaused('),
            'debe respetar una pausa manual previa del usuario (no re-activarla)');
    },

    'si la red de seguridad falla, PREGUNTA antes de seguir (y abortar es posible)'() {
        // El snapshot pre-restore fallaba en silencio (console.warn) mientras
        // la UI afirmaba "Creando red de seguridad...": el usuario restauraba
        // creyendo que tenía un punto de retorno que NUNCA existió (los
        // estados >800KB van a Storage, que puede fallar por CORS/bucket).
        const body = getRestoreBody();
        const catchIdx = body.indexOf('catch (snapErr)');
        testRunner.assert(catchIdx !== -1, 'debe existir el catch del snapshot pre-restore');
        const catchBlock = body.slice(catchIdx, catchIdx + 1600);
        testRunner.assert(catchBlock.includes('Modal.confirm'),
            'el fallo de la red de seguridad debe preguntar al usuario, no seguir en silencio');
        testRunner.assert(/return;/.test(catchBlock),
            'si el usuario no acepta, la restauración debe abortarse');
    },

    'sube la asistencia restaurada por el canal dateKeys y drena el outbox HASTA VACIARLO antes de reanudar'() {
        // Judgment Day (jueces A+B): un flush() suelto puede ser un no-op
        // silencioso (mutex _flushing en vuelo) y las encoladas del guardado
        // son fire-and-forget — el drenado debe (1) esperar el ENCOLADO y
        // (2) sondear pendingCount hasta 0, no confiar en una sola llamada.
        const body = getRestoreBody();
        testRunner.assert(/saveApplicationData\(\s*\{[^}]*dateKeys/.test(body),
            'debe pasar dateKeys al guardado (el espejo EXCLUYE asistencia; sin esto no sube)');
        testRunner.assert(/saveApplicationData\(\s*\{[^}]*awaitOutboxEnqueue:\s*true/.test(body),
            'debe esperar el ENCOLADO al outbox (si no, el sondeo puede ver 0 antes de que se escriba)');
        testRunner.assert(body.includes('drainMainSyncOutboxUntilEmpty('),
            'debe drenar HASTA VACIAR, no un flush suelto (mutex = no-op silencioso)');
        const drainIdx = body.indexOf('drainMainSyncOutboxUntilEmpty(');
        const resumeIdx = body.lastIndexOf('resumeCloudDownload(');
        testRunner.assert(drainIdx !== -1 && resumeIdx !== -1 && drainIdx < resumeIdx,
            'orden: drenar la subida primero, reanudar la descarga después');
    },

    '_executeSave espera las encoladas del outbox cuando se lo piden (awaitOutboxEnqueue)'() {
        testRunner.assert(/if \(options\.awaitOutboxEnqueue\) await _outboxReady/.test(PS_SRC),
            'el canal awaitOutboxEnqueue debe existir en _executeSave (encolar es LOCAL, no espera nube)');
    },

    'el merge de settings restaurados no DEGRADA schemaVersion'() {
        // Judgment Day (juez B): un backup viejo con schemaVersion < 3 apaga
        // la escritura per-doc de puestos/líderes (isMigratedGranular) y
        // vuelca los catálogos inline al doc espejo, desincronizando a los
        // dispositivos ya migrados.
        const body = getRestoreBody();
        testRunner.assert(/schemaVersion\s*=\s*Math\.max\(/.test(body) ||
            /Math\.max\([^)]*[Ss]chema/.test(body),
            'la versión de esquema debe quedarse con el MAYOR entre viva y restaurada');
    },

    'si la subida está pausada, el resultado lo dice (no un éxito pleno)'() {
        const body = getRestoreBody();
        testRunner.assert(body.includes('isSyncPaused()'),
            'con la subida pausada, el flush no corre: el aviso debe explicar POR QUÉ quedó pendiente');
    }

});

// ─── Drenado hasta vacío (behavioral) ────────────────────────────────────────

testRunner.addSuite('drainMainSyncOutboxUntilEmpty — la nube antes que la descarga', {

    async 'sondea pendingCount hasta 0 aunque un flush ajeno tenga el mutex'() {
        let pending = 2;
        const flushSpy = jest.spyOn(MainSyncStore, 'flush')
            .mockImplementation(async () => { pending = Math.max(0, pending - 1); });
        const countSpy = jest.spyOn(MainSyncStore, 'pendingCount')
            .mockImplementation(async () => pending);
        try {
            const ok = await drainMainSyncOutboxUntilEmpty({ maxAttempts: 5, delayMs: 1 });
            testRunner.assertEquals(ok, true, 'debe reportar drenado completo');
            testRunner.assert(flushSpy.mock.calls.length >= 2, 'reintenta flush hasta vaciar');
        } finally { flushSpy.mockRestore(); countSpy.mockRestore(); }
    },

    async 'si no logra vaciar en maxAttempts devuelve false (el caller avisa, no miente)'() {
        const flushSpy = jest.spyOn(MainSyncStore, 'flush').mockResolvedValue(undefined);
        const countSpy = jest.spyOn(MainSyncStore, 'pendingCount').mockResolvedValue(7);
        try {
            const ok = await drainMainSyncOutboxUntilEmpty({ maxAttempts: 3, delayMs: 1 });
            testRunner.assertEquals(ok, false, 'pendientes sin drenar ⇒ false');
            testRunner.assertEquals(flushSpy.mock.calls.length, 3, 'agota los intentos y corta');
        } finally { flushSpy.mockRestore(); countSpy.mockRestore(); }
    }

});
