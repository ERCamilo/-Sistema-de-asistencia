import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashUI.js'),
    'utf8'
);

describe('Caja Chica — cableado de alcance y paginación', () => {
    test('la escucha de movimientos se limita a períodos abiertos', () => {
        expect(source).toContain("period.status !== 'cerrada'");
        expect(source).toContain('PettyCashRepository.movements.subscribeForPeriods(scopeIds, cb)');
        expect(source).not.toContain('PettyCashRepository.movements.subscribe(cb)');
    });

    test('los períodos cerrados se actualizan bajo demanda', () => {
        expect(source).toContain('PettyCashRepository.movements.loadForPeriod(cleanId)');
        expect(source).toContain("period.status !== 'cerrada'");
    });

    test('la vista pagina registros sin recortar el arreglo de datos', () => {
        expect(source).toContain('paginatePettyCashMovements(sortedMovs, d.movementVisibleCount)');
        expect(source).toContain('window.pcLoadMoreMovements');
        expect(source).toContain('Mostrar 50 más');
    });
});
