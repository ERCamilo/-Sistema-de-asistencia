/**
 * 🧪 LoanSeqTests (Fase 2, U4)
 *
 * El préstamo mantiene UUID como PK; `seq` es el número que el dispositivo
 * creía al crear — una SEÑAL de detección de creaciones concurrentes, NO una
 * identidad. Dos dispositivos offline que crean "el 4to préstamo" del mismo
 * empleado generan dos UUIDs distintos (no hay colisión silenciosa) pero el
 * MISMO seq=4 — y esa coincidencia es la primera señal del detector de
 * duplicados (ver LoanDuplicateDetectorTests).
 *
 * Regla de asignación: max(seq existentes finitos) + 1; si ningún préstamo
 * tiene seq (datos legacy), cantidad de préstamos + 1. max() y no count():
 * con préstamos borrados (hard-delete de anulados, deleteLoan) el conteo
 * retrocede y reciclaría un seq ya usado por un préstamo vivo.
 */

import { createLoan, migrateAdvancesToLoans, nextLoanSeq } from '../modules/features/loans/LoansService.js';

function makeEmp(loans = []) {
    return { id: 'e1', name: 'Test', loans, updatedAt: 0 };
}

function loanParams(overrides = {}) {
    return { principal: 1000, startDate: '2026-07-01', concept: 'Test', ...overrides };
}

testRunner.addSuite("LoanSeq — nextLoanSeq (regla pura)", {

    "sin préstamos → 1"() {
        testRunner.assertEquals(nextLoanSeq([]), 1);
        testRunner.assertEquals(nextLoanSeq(null), 1);
        testRunner.assertEquals(nextLoanSeq(undefined), 1);
    },

    "con seqs existentes → max + 1 (no count + 1)"() {
        // 2 préstamos pero seqs 1 y 5 (hubo borrados en el medio):
        // el próximo debe ser 6, no 3 — count+1 reciclaría un seq vivo.
        const loans = [{ id: 'a', seq: 1 }, { id: 'b', seq: 5 }];
        testRunner.assertEquals(nextLoanSeq(loans), 6);
    },

    "préstamos legacy SIN seq → cantidad + 1"() {
        const loans = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
        testRunner.assertEquals(nextLoanSeq(loans), 4);
    },

    "mezcla: algunos con seq, otros legacy → gana el max de los que tienen"() {
        const loans = [{ id: 'a' }, { id: 'b', seq: 7 }, { id: 'c' }];
        testRunner.assertEquals(nextLoanSeq(loans), 8);
    },

    "seq corrupto (NaN, string) se ignora como si no existiera"() {
        const loans = [{ id: 'a', seq: Number.NaN }, { id: 'b', seq: '9' }];
        testRunner.assertEquals(nextLoanSeq(loans), 3,
            'ningún seq FINITO numérico → fallback a cantidad + 1');
    }

});

testRunner.addSuite("LoanSeq — createLoan estampa seq", {

    "el primer préstamo nace con seq 1"() {
        const emp = makeEmp();
        const loan = createLoan(emp, loanParams());
        testRunner.assertEquals(loan.seq, 1);
    },

    "el segundo préstamo nace con seq 2"() {
        const emp = makeEmp();
        createLoan(emp, loanParams());
        const second = createLoan(emp, loanParams({ concept: 'Otro' }));
        testRunner.assertEquals(second.seq, 2);
    },

    "escenario de colisión que el detector necesita: dos 'dispositivos' con la misma foto crean el mismo seq"() {
        // Ambos dispositivos ven 3 préstamos con seq 1-3 y crean el 4to offline.
        const fotoBase = [{ id: 'a', seq: 1 }, { id: 'b', seq: 2 }, { id: 'c', seq: 3 }];
        const deviceA = makeEmp(JSON.parse(JSON.stringify(fotoBase)));
        const deviceB = makeEmp(JSON.parse(JSON.stringify(fotoBase)));
        const loanA = createLoan(deviceA, loanParams());
        const loanB = createLoan(deviceB, loanParams());
        testRunner.assertEquals(loanA.seq, 4);
        testRunner.assertEquals(loanB.seq, 4);
        testRunner.assert(loanA.id !== loanB.id,
            'los UUIDs deben ser DISTINTOS — seq es señal de detección, no identidad');
    },

    "tras un hard-delete, el seq nuevo NO recicla el de un préstamo vivo"() {
        const emp = makeEmp([{ id: 'a', seq: 1 }, { id: 'c', seq: 3 }]); // seq 2 fue borrado
        const loan = createLoan(emp, loanParams());
        testRunner.assertEquals(loan.seq, 4, 'max(1,3)+1 = 4 — no 3 (count+1), que colisiona con el vivo');
    }

});

testRunner.addSuite("LoanSeq — migrateAdvancesToLoans estampa seq", {

    "los préstamos migrados desde advances reciben seqs consecutivos"() {
        const emp = {
            id: 'e1', loans: [],
            advances: [
                { id: 'ADV-1', amount: 100, interest: 0, date: '2026-01-01' },
                { id: 'ADV-2', amount: 200, interest: 0, date: '2026-02-01' }
            ]
        };
        migrateAdvancesToLoans(emp);
        const seqs = emp.loans.map(l => l.seq);
        testRunner.assertEquals(seqs.join(','), '1,2');
    },

    "la migración respeta seqs ya existentes (no reinicia la numeración)"() {
        const emp = {
            id: 'e1',
            loans: [{ id: 'L-pre', seq: 5, _migratedFromAdvanceId: null }],
            advances: [{ id: 'ADV-1', amount: 100, interest: 0, date: '2026-01-01' }]
        };
        migrateAdvancesToLoans(emp);
        const migrated = emp.loans.find(l => l._migratedFromAdvanceId === 'ADV-1');
        testRunner.assertEquals(migrated.seq, 6);
    }

});

console.log('🧪 LoanSeq tests cargados.');
