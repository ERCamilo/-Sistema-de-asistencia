import {
    auth, getDocs, onSnapshot, query, where
} from '../modules/data/firebase.js';
import { PettyCashRepository } from '../modules/services/PettyCashRepository.js';

describe('PettyCashRepository — sincronización acotada', () => {
    beforeEach(() => {
        auth.currentUser = { uid: 'scope-user' };
        getDocs.mockReset().mockResolvedValue({ forEach: () => {} });
        onSnapshot.mockReset().mockReturnValue(() => {});
        query.mockClear();
        where.mockClear();
    });

    afterEach(() => {
        auth.currentUser = null;
    });

    test('carga un período histórico con una consulta por periodId', async () => {
        await PettyCashRepository.movements.loadForPeriod('period-closed');

        expect(where).toHaveBeenCalledWith('periodId', '==', 'period-closed');
        expect(query).toHaveBeenCalledTimes(1);
        expect(getDocs).toHaveBeenCalledTimes(1);
    });

    test('escucha únicamente los períodos abiertos indicados', () => {
        PettyCashRepository.movements.subscribeForPeriods(
            ['period-a', 'period-b'],
            () => {}
        );

        expect(where).toHaveBeenCalledWith(
            'periodId',
            'in',
            ['period-a', 'period-b']
        );
        expect(onSnapshot).toHaveBeenCalledTimes(1);
    });

    test('divide más de 30 períodos y emite solo al completar todos los snapshots', () => {
        const callbacks = [];
        onSnapshot.mockImplementation((_ref, callback) => {
            callbacks.push(callback);
            return () => {};
        });
        const onChange = jest.fn();
        const ids = Array.from({ length: 31 }, (_, index) => `period-${index}`);

        PettyCashRepository.movements.subscribeForPeriods(ids, onChange);
        callbacks[0]({ forEach: (visit) => visit({ data: () => ({ id: 'm1' }) }) });
        expect(onChange).not.toHaveBeenCalled();

        callbacks[1]({ forEach: (visit) => visit({ data: () => ({ id: 'm2' }) }) });
        expect(onChange).toHaveBeenCalledWith([
            expect.objectContaining({ id: 'm1' }),
            expect.objectContaining({ id: 'm2' })
        ]);
    });
});
