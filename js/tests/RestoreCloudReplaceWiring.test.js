/**
 * Contrato de app.js para las tres opciones de restauración FILE.
 * Las funciones viven dentro del cierre de loadBackupFromFile (no exportadas),
 * así que se valida el fuente, igual que LocalBackupCompletenessTests.
 */
import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

function callbackBody(name) {
    const start = SRC.indexOf(`${name}: async () => {`);
    expect(start).toBeGreaterThan(-1);
    const next = SRC.slice(start + name.length).search(/\n\s+on[A-Z]\w+: async \(\) => \{|\n\s+\}, \{ projectDiagnostics \}\);/);
    return SRC.slice(start, start + name.length + next);
}

describe('restauración FILE: caja chica y reemplazo de nube', () => {
    test('restaurar local con sesión encola la caja chica en fusión; sin sesión no encola y marca (M2)', () => {
        const body = callbackBody('onLocalRestore');
        expect(body).toMatch(/const detached = !window\.currentUser;/);
        expect(body).toMatch(/applyBackupData\(importedData, detached \? \{\} : \{ pettyCashCloud: 'merge' \}\)/);
        expect(body).toMatch(/if \(detached\) markDetachedRestoreAfterApply\(importedData, null\);/);
    });

    test('desconectar y restaurar no encola nada y deja la marca para el próximo inicio de sesión (M2)', () => {
        const body = callbackBody('onDisconnectRestore');
        expect(body).toMatch(/applyBackupData\(importedData\)/);
        expect(body).not.toMatch(/pettyCashCloud/);
        expect(body.indexOf('markDetachedRestoreAfterApply(importedData, previousUid)'))
            .toBeGreaterThan(body.indexOf('applyBackupData(importedData)'));
    });

    test('reemplazar nube usa DataOps y ya no borra Caja Chica sin volver a subirla', () => {
        const body = callbackBody('onReplaceCloudRestore');
        expect(body).toMatch(/applyBackupData\(importedData, \{ pettyCashCloud: 'replace' \}\)/);
        expect(body).toMatch(/replaceCloudWithLocal\(\)/);
        // El flujo viejo: deleteCloudData() sin acotar (borraba projects/cashPeriods/pettyCash)
        // y subía el state vivo, que los listeners podían vaciar tras el borrado.
        expect(body).not.toMatch(/deleteCloudData\(/);
        expect(body).not.toMatch(/saveFullState\(state\)/);
        expect(body).toMatch(/result\?\.ok/);
    });

    test('applyBackupData encola solo tras aplicar la caja chica en local', () => {
        const block = SRC.match(/async function applyBackupData[\s\S]*?\n\}/)[0];
        const applied = block.indexOf("applyRemote('movements'");
        const queued = block.indexOf('PettyCashStore.enqueueRestored(');
        expect(applied).toBeGreaterThan(-1);
        expect(queued).toBeGreaterThan(applied);
    });

    test('M2: la puerta de inicio de sesión corre tras el guardián de dueño y antes de toda sincronización', () => {
        const auth = SRC.slice(SRC.indexOf('FirebaseService.onAuthStateChanged(async (user) => {'));
        const mismatch = auth.indexOf("if (_ownership === 'mismatch')");
        const gate = auth.indexOf('const _restoreGate = await passDetachedRestoreGate(user, _isCurrentAuthCallback);');
        expect(auth).toMatch(/if \(!_restoreGate\.proceed\) return;\n\s+if \(!_restoreGate\.prepared\) \{ claimLocalOwnership\(user\.uid\);/);
        const prepare = auth.indexOf('claimLocalOwnership(user.uid);try{await initProjectsInfrastructure', gate);
        const startup = auth.indexOf('await runAuthStartupAfterDrain(');
        const pettyCash = auth.indexOf('window.startPettyCashSync?.()');
        const mirror = auth.indexOf('_mirrorUnsub = FirebaseService.subscribeToChanges(');
        expect(mismatch).toBeGreaterThan(-1);
        expect(gate).toBeGreaterThan(mismatch);
        expect(prepare).toBeGreaterThan(gate);
        for (const later of [startup, pettyCash, mirror]) expect(later).toBeGreaterThan(prepare);
        const helper = SRC.match(/async function passDetachedRestoreGate\(user, isCurrent\) \{[\s\S]*?\n\}/)[0];
        expect(helper).toMatch(/askDetachedRestoreChoice\(/);
        expect(helper).toMatch(/upload: async \(\) => \{[\s\S]*claimLocalOwnership\(user\.uid\);[\s\S]*initProjectsInfrastructure\(\{ uid: user\.uid \}\)[\s\S]*prepared = true;[\s\S]*uploadDetachedRestoreToAccount\(\)/);
        expect(helper).toMatch(/useCloud: \(\) => replaceLocalWithCloud\(\)/);
        expect(helper).toMatch(/return \{ proceed: gate\.proceed && isCurrent\(\), prepared \};/);
    });

    test('M2: subir lo restaurado re-estampa, olvida watermarks, sube asistencia por fechas y Caja Chica en reemplazo', () => {
        const block = SRC.match(/async function uploadDetachedRestoreToAccount\(\) \{[\s\S]*?\n\}/)[0];
        const order = ['prepareRestoredState(', 'FirebaseService.resetEntityUploadTrackers()',
            'saveApplicationData({ immediate: true, force: true, dateKeys: prepared.dateKeys, awaitOutboxEnqueue: true })',
            'PettyCashStore.loadLocal()', "PettyCashStore.enqueueRestored(pettyCash, { mode: 'replace', awaitFlush: true })"];
        const positions = order.map(text => block.indexOf(text));
        positions.forEach(position => expect(position).toBeGreaterThan(-1));
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });
});
