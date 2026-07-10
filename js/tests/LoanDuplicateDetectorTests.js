/**
 * 🧪 LoanDuplicateDetectorTests (Fase 2, U4)
 *
 * Detector post-merge de posibles préstamos duplicados por creación
 * concurrente (dos dispositivos offline anotan "el mismo" préstamo y el
 * merge por unión conserva los dos, porque tienen UUIDs distintos).
 *
 * DOBLE SEÑAL — un par (a, b) es candidato SOLO si:
 *   1. mismo `seq` (ambos finitos — legacy sin seq no genera señal), Y
 *   2. mismo monto (principal, igualdad tras round2) Y fechas de inicio
 *      cercanas (|a.startDate - b.startDate| <= maxDaysApart, default 7).
 *
 * La doble señal existe porque el costo de un falso positivo es alto
 * (plata real): mismo seq solo = pudo ser coincidencia legítima ("son
 * distintos, quedan los dos" — U5 renumera); monto+fecha solos = préstamos
 * legítimamente parecidos. Juntas, la probabilidad de accidente es mínima.
 *
 * U4 solo DETECTA y avisa; la resolución (eliminar uno / son distintos) es
 * el wizard de U5.
 */

import { detectLoanDuplicateCandidates } from '../modules/features/loans/LoanDuplicateDetector.js';
import { LOAN_STATUS } from '../modules/features/loans/LoansService.js';

function loan(id, seq, principal, startDate, overrides = {}) {
    return {
        id, seq, principal, startDate,
        status: LOAN_STATUS.ACTIVE,
        payments: [], installments: [],
        ...overrides
    };
}

testRunner.addSuite("LoanDuplicateDetector — doble señal", {

    "mismo seq + mismo monto + misma fecha → candidato"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 500, '2026-07-01')
        ]};
        const found = detectLoanDuplicateCandidates(emp);
        testRunner.assertEquals(found.length, 1);
        const ids = [found[0].a.id, found[0].b.id].sort().join(',');
        testRunner.assertEquals(ids, 'A,B');
    },

    "mismo seq + mismo monto + fechas a 3 días → candidato (dentro de la ventana default de 7)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 2, 1000, '2026-07-01'),
            loan('B', 2, 1000, '2026-07-04')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 1);
    },

    "mismo seq pero MONTO DISTINTO → NO es candidato (señal 2 incompleta)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 2000, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0,
            'mismo seq con montos distintos = creación concurrente LEGÍTIMA (dos préstamos reales) — eso lo renumera U5, no es un duplicado');
    },

    "mismo seq + mismo monto pero fechas a 10 días → NO es candidato (fuera de ventana)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 500, '2026-07-11')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0);
    },

    "mismo monto + misma fecha pero SEQ DISTINTO → NO es candidato (señal 1 ausente)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 1, 500, '2026-07-01'),
            loan('B', 2, 500, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0,
            'dos préstamos iguales creados en SECUENCIA (seq distinto) es un caso legítimo común');
    },

    "préstamos legacy SIN seq no generan señal (ni entre sí ni contra otros)"() {
        const emp = { id: 'e1', loans: [
            loan('A', undefined, 500, '2026-07-01'),
            loan('B', undefined, 500, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0);
    },

    "un préstamo ANULADO (written-off) no participa — ese conflicto ya está resuelto"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 500, '2026-07-01', { status: LOAN_STATUS.WRITTEN_OFF })
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0);
    },

    "ventana de días configurable via opts.maxDaysApart"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 500, '2026-07-03')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp, { maxDaysApart: 1 }).length, 0);
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp, { maxDaysApart: 2 }).length, 1);
    },

    "tres préstamos con el mismo seq/monto/fecha → 3 pares candidatos (A-B, A-C, B-C)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, '2026-07-01'),
            loan('B', 4, 500, '2026-07-01'),
            loan('C', 4, 500, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 3);
    },

    "defensivo: emp null / sin loans / loans no-array → []"() {
        testRunner.assert(Array.isArray(detectLoanDuplicateCandidates(null)));
        testRunner.assert(Array.isArray(detectLoanDuplicateCandidates({ id: 'e1' })));
        testRunner.assert(Array.isArray(detectLoanDuplicateCandidates({ id: 'e1', loans: 'x' })));
    },

    "fechas inválidas/faltantes no rompen (ese par simplemente no es candidato)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 500, 'no-es-fecha'),
            loan('B', 4, 500, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 0);
    },

    "montos con drift de float se comparan tras round2 (100.004999 ≈ 100.00)"() {
        const emp = { id: 'e1', loans: [
            loan('A', 4, 100.004, '2026-07-01'),
            loan('B', 4, 100.0041, '2026-07-01')
        ]};
        testRunner.assertEquals(detectLoanDuplicateCandidates(emp).length, 1,
            'ambos redondean a 100.00 — deben tratarse como el mismo monto');
    }

});

console.log('🧪 LoanDuplicateDetector tests cargados.');
