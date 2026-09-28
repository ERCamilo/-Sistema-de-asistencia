/**
 * M2 — guardián de restauración desconectada: bloqueo de subidas, borrado local
 * y diálogo de decisión (design.md: tarjetas, footer con motivo, sin emoji).
 */
import fs from 'fs';
import path from 'path';
import { LOCAL_TRACE_KEYS } from '../modules/services/LocalWipeService.js';
import { DETACHED_RESTORE_LS_KEY, markDetachedRestore, clearDetachedRestore } from '../modules/services/DetachedRestoreGuard.js';
import { askDetachedRestoreChoice, buildDetachedRestoreOptions } from '../modules/ui/DetachedRestoreChoiceModal.js';

const read = file => fs.readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('M2: la marca bloquea toda subida y se borra con los datos locales', () => {
    test('PersistenceService no sube (guardado ni cola) con la marca activa', () => {
        const src = read('modules/services/PersistenceService.js');
        expect(src).toMatch(/hasSession: \(\) => !!globalThis\.currentUser && !isDetachedRestoreSyncBlocked\(\)/);
        expect(src).toMatch(/const _detachedRestorePending = isDetachedRestoreSyncBlocked\(\);/);
        expect(src).toMatch(/&& !options\.localOnly\s+&& !_detachedRestorePending;/);
    });

    test('PettyCashStore.flush y flushMirror esperan la decisión', () => {
        const src = read('modules/features/pettycash/PettyCashStore.js');
        expect(src.match(/if \(isDetachedRestoreSyncBlocked\(\)\) return;/g)).toHaveLength(2);
    });

    test('FULL sin sesión marca y no encola Caja Chica; con sesión encola en fusión como antes', () => {
        const src = read('modules/features/export/ExportController.js');
        const fn = src.match(/async function finalizeFullImportPettyCash\(data, preparedPettyCash\) \{[\s\S]*?\n\}/)[0];
        expect(fn).toMatch(/const detached = !globalThis\.currentUser;/);
        expect(fn).toMatch(/if \(detached && !markDetachedRestore\(\{ hasPettyCash: Boolean\(preparedPettyCash\) \}\)\)/);
        expect(fn.indexOf('if (!preparedPettyCash || detached) return;'))
            .toBeLessThan(fn.indexOf("PettyCashStore.enqueueRestored(preparedPettyCash.pettyCash, { mode: 'merge' })"));
    });

    test('«Borrar datos locales» también borra la marca', () => {
        expect(LOCAL_TRACE_KEYS).toContain(DETACHED_RESTORE_LS_KEY);
    });
});

describe('M2: diálogo de decisión', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        clearDetachedRestore();
    });

    test('tres opciones claras, sin emoji; Caja Chica solo se menciona si el respaldo la trae', () => {
        const withCash = buildDetachedRestoreOptions({ hasPettyCash: true });
        expect(withCash.map(o => o.title)).toEqual([
            'Subir lo restaurado a esta cuenta', 'Usar los datos de la nube', 'Cerrar sesión'
        ]);
        expect(withCash[0].detail).toMatch(/Caja Chica/);
        expect(buildDetachedRestoreOptions({ hasPettyCash: false })[0].detail).not.toMatch(/Caja Chica/);
        const text = JSON.stringify(withCash);
        expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    });

    test('Continuar está deshabilitado con motivo hasta elegir; luego devuelve la elección', async () => {
        markDetachedRestore({ previousUid: 'u', hasPettyCash: true });
        const pending = askDetachedRestoreChoice({ email: '<b>x</b>@example.invalid', marker: { hasPettyCash: true } });
        const overlay = document.getElementById('detached-restore-choice');
        expect(overlay.getAttribute('role')).toBe('dialog');
        expect(overlay.innerHTML).toContain('&lt;b&gt;x&lt;/b&gt;@example.invalid');
        expect(overlay.querySelectorAll('[role="radio"]')).toHaveLength(3);
        const confirm = overlay.querySelector('[data-confirm]');
        expect(confirm.disabled).toBe(true);
        expect(overlay.querySelector('[data-hint]').textContent).toMatch(/Elige una opción/);
        expect(overlay.textContent).not.toMatch(/\p{Extended_Pictographic}/u);

        overlay.querySelector('[data-choice="upload"]').click();
        expect(overlay.querySelector('[data-choice="upload"]').getAttribute('aria-checked')).toBe('true');
        overlay.querySelector('[data-confirm]').click();
        await expect(pending).resolves.toBe('upload');
        expect(document.getElementById('detached-restore-choice')).toBeNull();
    });

    test('Escape cierra sin elegir (equivale a cerrar sesión)', async () => {
        const pending = askDetachedRestoreChoice({ email: 'a@example.invalid' });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await expect(pending).resolves.toBeNull();
    });
});
