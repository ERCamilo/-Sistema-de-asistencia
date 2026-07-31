import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashUI.js'),
    'utf8'
);
const startIndex = source.indexOf('export async function startPettyCashSync()');
const endIndex = source.indexOf('\n// ══', startIndex + 1);
const startSyncSource = source.slice(startIndex, endIndex > startIndex ? endIndex : undefined);

describe('Caja Chica — presupuesto de lecturas al iniciar', () => {
    test('usa el primer snapshot de los listeners y no carga las colecciones por duplicado', () => {
        expect(startIndex).toBeGreaterThanOrEqual(0);
        expect(startSyncSource).toContain('loadPettyCashLocal()');
        expect(startSyncSource).toContain('PettyCashLiveSyncCoordinator.start(');
        expect(startSyncSource).not.toContain('.loadAll(');
    });

    test('conserva el arranque local-first antes de abrir listeners', () => {
        expect(startSyncSource.indexOf('loadPettyCashLocal()'))
            .toBeLessThan(startSyncSource.indexOf('PettyCashLiveSyncCoordinator.start('));
    });
});
