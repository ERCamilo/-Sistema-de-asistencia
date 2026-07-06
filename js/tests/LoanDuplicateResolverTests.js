/**
 * 🧪 LoanDuplicateResolverTests (Fase 2, U5)
 *
 * Resolutor de duplicados detectados por LoanDuplicateDetector (U4). Dos
 * salidas, decididas por un humano:
 *
 *   1. "Son distintos, quedan los dos" → resolveDuplicateAsDistinct:
 *      el PERDEDOR del desempate se renumera a seq = siguiente disponible
 *      (el UUID no se toca — seq es cosmético/señal). Perdedor = el de
 *      createdAt MÁS NUEVO (el más viejo conserva su número); empate o sin
 *      createdAt → pierde el de id lexicográficamente mayor (determinista:
 *      ambos dispositivos, si resolvieran en paralelo, eligen el mismo).
 *
 *   2. "Eliminar uno" → resolveDuplicateByDeleting: anula (write-off) si
 *      hace falta y elimina con tombstone (deleteLoan de U3) — el borrado
 *      sobrevive al sync multi-dispositivo y no resucita por el merge.
 */

import {
    resolveDuplicateAsDistinct,
    resolveDuplicateByDeleting
} from '../modules/features/loans/LoanDuplicateResolver.js';
import { detectLoanDuplicateCandidates } from '../modules/features/loans/LoanDuplicateDetector.js';
import { LOAN_STATUS } from '../modules/features/loans/LoansService.js';

function dupPair({ createdA = 100, createdB = 200 } = {}) {
    return {
        id: 'e1', updatedAt: 0,
        loans: [
            { id: 'LOAN-a', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: createdA, updatedAt: 1 },
            { id: 'LOAN-b', seq: 4, principal: 500, startDate: '2026-07-01', status: LOAN_STATUS.ACTIVE, payments: [], installments: [], createdAt: createdB, updatedAt: 1 }
        ]
    };
}

testRunner.addSuite("LoanDuplicateResolver — son distintos, quedan los dos", {

    "renumera al de createdAt MÁS NUEVO; el más viejo conserva su seq"() {
        const emp = dupPair({ createdA: 100, createdB: 200 });
        const result = resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        const a = emp.loans.find(l => l.id === 'LOAN-a');
        const b = emp.loans.find(l => l.id === 'LOAN-b');
        testRunner.assertEquals(a.seq, 4, 'el más viejo conserva su número');
        testRunner.assertEquals(b.seq, 5, 'el más nuevo se renumera al siguiente disponible');
        testRunner.assertEquals(result.renumbered.id, 'LOAN-b');
        testRunner.assertEquals(result.kept.id, 'LOAN-a');
    },

    "los UUIDs no se tocan (seq es señal, no identidad)"() {
        const emp = dupPair();
        resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        const ids = emp.loans.map(l => l.id).sort().join(',');
        testRunner.assertEquals(ids, 'LOAN-a,LOAN-b');
    },

    "tras renumerar, el detector YA NO marca el par como duplicado"() {
        const emp = dupPair();
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 1, 'precondición: detectado');
        resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0,
            'seqs distintos → la señal desaparece');
    },

    "estampa updatedAt en el renumerado y en el empleado (el cambio debe ganar el merge)"() {
        const emp = dupPair();
        const before = Date.now() - 1;
        resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        const renumbered = emp.loans.find(l => l.id === 'LOAN-b');
        testRunner.assert(renumbered.updatedAt > before, 'loan.updatedAt debe refrescarse');
        testRunner.assert(emp.updatedAt > before, 'emp.updatedAt debe refrescarse');
    },

    "empate de createdAt → pierde el de id lexicográficamente mayor (determinista entre dispositivos)"() {
        const emp = dupPair({ createdA: 100, createdB: 100 });
        const result = resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        testRunner.assertEquals(result.renumbered.id, 'LOAN-b',
            "'LOAN-b' > 'LOAN-a' lexicográficamente → pierde b");
    },

    "sin createdAt en ninguno → mismo desempate determinista por id"() {
        const emp = dupPair();
        delete emp.loans[0].createdAt;
        delete emp.loans[1].createdAt;
        const result = resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-b');
        testRunner.assertEquals(result.renumbered.id, 'LOAN-b');
    },

    "el orden de los argumentos NO cambia el resultado (a,b) == (b,a)"() {
        const emp1 = dupPair({ createdA: 100, createdB: 200 });
        const emp2 = dupPair({ createdA: 100, createdB: 200 });
        const r1 = resolveDuplicateAsDistinct(emp1, 'LOAN-a', 'LOAN-b');
        const r2 = resolveDuplicateAsDistinct(emp2, 'LOAN-b', 'LOAN-a');
        testRunner.assertEquals(r1.renumbered.id, r2.renumbered.id,
            'el desempate depende de los préstamos, no del orden en que se pasaron');
    },

    "lanza si alguno de los dos ids no existe"() {
        const emp = dupPair();
        let threw = false;
        try { resolveDuplicateAsDistinct(emp, 'LOAN-a', 'LOAN-x'); } catch (_) { threw = true; }
        testRunner.assert(threw);
    }

});

testRunner.addSuite("LoanDuplicateResolver — eliminar uno", {

    "elimina un préstamo ACTIVO (lo anula primero y después lo borra con tombstone)"() {
        const emp = dupPair();
        resolveDuplicateByDeleting(emp, 'LOAN-b');
        testRunner.assertEquals(emp.loans.length, 1);
        testRunner.assertEquals(emp.loans[0].id, 'LOAN-a');
        testRunner.assert(
            Array.isArray(emp.deletedItemIds?.loans) && emp.deletedItemIds.loans.includes('LOAN-b'),
            'debe registrar el tombstone — sin él, el merge resucita el duplicado desde la copia remota'
        );
    },

    "también funciona sobre un préstamo YA anulado (no re-anula, borra directo)"() {
        const emp = dupPair();
        emp.loans[1].status = LOAN_STATUS.WRITTEN_OFF;
        resolveDuplicateByDeleting(emp, 'LOAN-b');
        testRunner.assertEquals(emp.loans.length, 1);
    },

    "estampa emp.updatedAt (el borrado debe ganar el merge)"() {
        const emp = dupPair();
        const before = Date.now() - 1;
        resolveDuplicateByDeleting(emp, 'LOAN-b');
        testRunner.assert(emp.updatedAt > before);
    },

    "devuelve el préstamo eliminado"() {
        const emp = dupPair();
        const out = resolveDuplicateByDeleting(emp, 'LOAN-b');
        testRunner.assertEquals(out.id, 'LOAN-b');
    },

    "lanza si el préstamo no existe"() {
        const emp = dupPair();
        let threw = false;
        try { resolveDuplicateByDeleting(emp, 'LOAN-x'); } catch (_) { threw = true; }
        testRunner.assert(threw);
    },

    "tras eliminar, el detector ya no marca nada"() {
        const emp = dupPair();
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 1, 'precondición');
        resolveDuplicateByDeleting(emp, 'LOAN-b');
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0);
    }

});

console.log('🧪 LoanDuplicateResolver tests cargados.');
