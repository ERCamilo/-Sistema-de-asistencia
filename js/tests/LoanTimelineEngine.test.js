/**
 * 🧪 LoanTimelineEngine.test.js
 *
 * Tests for the pure historical loan timeline reconstruction engine:
 *  - Strict interest-first payment waterfall (interest must hit 0 before principal reduces)
 *  - Voided payments and refinancings skipped
 *  - Trilateral snapshots (Antes -> Cambios -> Después)
 *  - Multi-employee (Obra) aggregation
 *  - Snapshot retrieval by date
 */

import {
    round2,
    extractLoanEvents,
    buildLoanTimeline,
    getTimelineSnapshotAtDate
} from '../modules/features/loans/LoanTimelineEngine.js';

describe('LoanTimelineEngine — Extracción y ordenamiento', () => {
    test('extrae préstamos, abonos y refinanciamientos ignorando los anulados', () => {
        const emp = {
            id: 'e1',
            name: 'Juan Pérez',
            loans: [
                {
                    id: 'L1',
                    principal: 10000,
                    interestRate: 10,
                    startDate: '2026-01-10',
                    concept: 'Herramientas',
                    payments: [
                        { id: 'p1', amount: 2000, date: '2026-01-25', voided: false },
                        { id: 'p2', amount: 5000, date: '2026-02-10', voided: true } // anulado
                    ],
                    refinancings: [
                        { id: 'r1', interestAmount: 800, date: '2026-02-15', voided: false },
                        { id: 'r2', interestAmount: 500, date: '2026-02-20', voided: true } // anulado
                    ]
                }
            ]
        };

        const events = extractLoanEvents(emp);
        expect(events).toHaveLength(3); // 1 loan + 1 payment + 1 refinance
        expect(events.map(e => e.type)).toEqual(['loan', 'payment', 'refinance']);
        expect(events[0].amount).toBe(10000);
        expect(events[0].initialInterest).toBe(1000);
        expect(events[1].amount).toBe(2000);
        expect(events[2].amount).toBe(800);
    });

    test('ordena cronológicamente y por prioridad en la misma fecha (préstamo -> refinanciamiento -> pago)', () => {
        const emp = {
            id: 'e1',
            name: 'Juan',
            loans: [
                {
                    id: 'L1',
                    principal: 5000,
                    interestRate: 0,
                    startDate: '2026-03-01',
                    payments: [{ id: 'p1', amount: 1000, date: '2026-03-01' }],
                    refinancings: [{ id: 'r1', interestAmount: 200, date: '2026-03-01' }]
                }
            ]
        };

        const events = extractLoanEvents(emp);
        expect(events).toHaveLength(3);
        expect(events[0].type).toBe('loan');
        expect(events[1].type).toBe('refinance');
        expect(events[2].type).toBe('payment');
    });
});

describe('LoanTimelineEngine — Prelación Estricta de Intereses (Waterfall)', () => {
    test('el abono liquida primero el 100% del interés antes de amortizar capital', () => {
        // Préstamo: $10,000 capital + 20% interés ($2,000) = $12,000 deuda total
        const emp = {
            id: 'e1',
            loans: [
                {
                    id: 'L1',
                    principal: 10000,
                    interestRate: 20,
                    startDate: '2026-01-01',
                    payments: [
                        { id: 'p1', amount: 3000, date: '2026-01-15' }
                    ]
                }
            ]
        };

        const timeline = buildLoanTimeline(emp);
        expect(timeline.milestones).toHaveLength(2);

        // Hito 1: Desembolso
        const m1 = timeline.milestones[0];
        expect(m1.beforeBalance).toBe(0);
        expect(m1.afterBalance).toBe(12000);
        expect(m1.components.interest).toBe(2000);
        expect(m1.components.principal).toBe(10000);

        // Hito 2: Abono de $3,000
        const m2 = timeline.milestones[1];
        expect(m2.beforeBalance).toBe(12000);
        // Interés pendiente era $2,000 -> queda en $0.00
        // Restante de $1,000 va a capital ($10,000 - $1,000 = $9,000)
        expect(m2.afterBalance).toBe(9000);
        expect(m2.components.interest).toBe(0);
        expect(m2.components.principal).toBe(9000);

        const change = m2.changes[0];
        expect(change.interestCovered).toBe(2000);
        expect(change.principalCovered).toBe(1000);
        expect(change.sign).toBe('−');
    });

    test('abono parcial que NO cubre todo el interés: capital permanece intacto', () => {
        // Préstamo: $10,000 capital + 20% ($2,000) interés = $12,000
        // Abono de solo $800
        const emp = {
            id: 'e1',
            loans: [
                {
                    id: 'L1',
                    principal: 10000,
                    interestRate: 20,
                    startDate: '2026-01-01',
                    payments: [
                        { id: 'p1', amount: 800, date: '2026-01-15' }
                    ]
                }
            ]
        };

        const timeline = buildLoanTimeline(emp);
        const m2 = timeline.milestones[1];

        // Se reduce interés de $2,000 a $1,200
        expect(m2.components.interest).toBe(1200);
        // Capital no se toca
        expect(m2.components.principal).toBe(10000);
        expect(m2.afterBalance).toBe(11200);

        const change = m2.changes[0];
        expect(change.interestCovered).toBe(800);
        expect(change.principalCovered).toBe(0);
    });

    test('refinanciamiento aumenta la deuda y añade interés', () => {
        const emp = {
            id: 'e1',
            loans: [
                {
                    id: 'L1',
                    principal: 10000,
                    interestRate: 0,
                    startDate: '2026-01-01',
                    refinancancings: [],
                    refinancings: [
                        { id: 'r1', amount: 1500, interestAmount: 1500, date: '2026-02-01', interestRate: 15 }
                    ]
                }
            ]
        };

        const timeline = buildLoanTimeline(emp);
        const m2 = timeline.milestones[1];
        expect(m2.beforeBalance).toBe(10000);
        expect(m2.afterBalance).toBe(11500);
        expect(m2.components.interest).toBe(1500);
        expect(m2.components.principal).toBe(10000);
    });
});

describe('LoanTimelineEngine — Escenario Trilateral Exacto (Antes -> Cambios -> Después)', () => {
    test('reproduce fielmente la reconciliación de la referencia: 124,000 -> cambios -> 98,400', () => {
        // Estado antes del 12 abr 2026: deuda = 124,000
        // En 12 abr 2026:
        //  - Abono $20,000
        //  - Abono $5,600
        //  - Total abonos = -$25,600
        //  - Saldo resultante = 124,000 - 25,600 = 98,400 (-20.6% de reducción)
        const emp = {
            id: 'e1',
            name: 'Juan Pérez',
            loans: [
                {
                    id: 'L1',
                    principal: 124000,
                    interestRate: 0,
                    startDate: '2026-04-05',
                    payments: [
                        { id: 'p1', amount: 20000, date: '2026-04-12', note: 'Abono a préstamo' },
                        { id: 'p2', amount: 5600, date: '2026-04-12', note: 'Abono a préstamo' }
                    ]
                }
            ]
        };

        const timeline = buildLoanTimeline(emp);
        expect(timeline.milestones).toHaveLength(2);

        const snapshot = timeline.milestones[1]; // 2026-04-12
        expect(snapshot.date).toBe('2026-04-12');
        expect(snapshot.previousDate).toBe('2026-04-05');
        expect(snapshot.beforeBalance).toBe(124000);
        expect(snapshot.afterBalance).toBe(98400);
        expect(snapshot.delta).toBe(-25600);
        expect(snapshot.deltaPercent).toBeCloseTo(-20.65, 1);
        expect(snapshot.changes).toHaveLength(2);
        expect(snapshot.changes[0].amount).toBe(20000);
        expect(snapshot.changes[1].amount).toBe(5600);
    });
});

describe('LoanTimelineEngine — Agregación a Nivel Obra (Múltiples Empleados)', () => {
    test('consolida eventos de toda la obra en una sola línea de tiempo cronológica', () => {
        const obra = [
            {
                id: 'emp1',
                name: 'Pedro',
                loans: [
                    { id: 'L1', principal: 50000, interestRate: 0, startDate: '2026-01-01', payments: [] }
                ]
            },
            {
                id: 'emp2',
                name: 'Carlos',
                loans: [
                    {
                        id: 'L2',
                        principal: 30000,
                        interestRate: 0,
                        startDate: '2026-01-15',
                        payments: [{ id: 'p1', amount: 10000, date: '2026-01-20' }]
                    }
                ]
            }
        ];

        const timeline = buildLoanTimeline(obra);
        expect(timeline.milestones).toHaveLength(3); // 2026-01-01 (Pedro), 2026-01-15 (Carlos), 2026-01-20 (Abono Carlos)

        expect(timeline.milestones[0].afterBalance).toBe(50000);
        expect(timeline.milestones[1].afterBalance).toBe(80000);
        expect(timeline.milestones[2].afterBalance).toBe(70000);
        expect(timeline.totalCurrentBalance).toBe(70000);
        expect(timeline.cumulativePrincipal).toBe(80000);
        expect(timeline.cumulativePaid).toBe(10000);
    });
});

describe('LoanTimelineEngine — getTimelineSnapshotAtDate', () => {
    test('retorna el snapshot exacto o el hito anterior si cae en día intermedio', () => {
        const emp = {
            id: 'e1',
            loans: [
                {
                    id: 'L1',
                    principal: 10000,
                    interestRate: 0,
                    startDate: '2026-01-01',
                    payments: [
                        { id: 'p1', amount: 2000, date: '2026-01-15' },
                        { id: 'p2', amount: 3000, date: '2026-01-30' }
                    ]
                }
            ]
        };

        const timeline = buildLoanTimeline(emp);

        // Fecha intermedia: 2026-01-20 debe traer el estado del 2026-01-15 (saldo = 8000)
        const snap = getTimelineSnapshotAtDate(timeline, '2026-01-20');
        expect(snap.date).toBe('2026-01-15');
        expect(snap.afterBalance).toBe(8000);

        // Fecha futura: debe traer el último hito
        const snapFuture = getTimelineSnapshotAtDate(timeline, '2026-02-15');
        expect(snapFuture.date).toBe('2026-01-30');
        expect(snapFuture.afterBalance).toBe(5000);
    });
});
