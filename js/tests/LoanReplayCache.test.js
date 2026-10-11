/**
 * replayLoan se calcula una sola vez por préstamo dentro de un render.
 *
 * En un render de Préstamos el mismo préstamo se reproducía 8–10 veces (riesgo
 * por cada periodo, saldo por cuenta, línea de tiempo…): ~150 ms con 900
 * préstamos en escritorio. withReplayCache comparte el resultado SOLO mientras
 * dura un cálculo síncrono —los datos no pueden cambiar en medio— y lo descarta
 * al terminar, así que nunca devuelve una reproducción vieja.
 */
import { createLoan, recordPayment } from '../modules/features/loans/LoansService.js';
import { replayLoan, withReplayCache } from '../modules/features/loans/LoanTimeline.js';

function seedLoan() {
    const emp = { id: 'e1', number: '001', name: 'Ana', active: true, loans: [] };
    const loan = createLoan(emp, { principal: 1000, interestRate: 10, startDate: '2026-09-01' });
    recordPayment(emp, loan.id, { amount: 300, date: '2026-09-10' });
    return { emp, loan };
}

describe('withReplayCache', () => {
    test('dentro del cálculo, el mismo préstamo devuelve la misma reproducción', () => {
        const { loan } = seedLoan();
        withReplayCache(() => {
            const a = replayLoan(loan);
            const b = replayLoan(loan);
            expect(b).toBe(a);
            expect(a.balance).toBe(800);
        });
    });

    test('fuera del cálculo no hay caché: refleja cambios al instante', () => {
        const { emp, loan } = seedLoan();
        const before = replayLoan(loan);
        expect(replayLoan(loan)).not.toBe(before);
        recordPayment(emp, loan.id, { amount: 100, date: '2026-09-12' });
        expect(replayLoan(loan).balance).toBe(700);
    });

    test('el caché se descarta al terminar (también si el cálculo falla)', () => {
        const { emp, loan } = seedLoan();
        let inside;
        withReplayCache(() => { inside = replayLoan(loan); });
        recordPayment(emp, loan.id, { amount: 100, date: '2026-09-12' });
        expect(replayLoan(loan)).not.toBe(inside);
        expect(replayLoan(loan).balance).toBe(700);

        expect(() => withReplayCache(() => { replayLoan(loan); throw new Error('boom'); })).toThrow('boom');
        const a = replayLoan(loan);
        expect(replayLoan(loan)).not.toBe(a);
    });

    test('anidado reutiliza el caché externo y devuelve el valor del cálculo', () => {
        const { loan } = seedLoan();
        const result = withReplayCache(() => {
            const outer = replayLoan(loan);
            const inner = withReplayCache(() => replayLoan(loan));
            expect(inner).toBe(outer);
            return 42;
        });
        expect(result).toBe(42);
    });
});
