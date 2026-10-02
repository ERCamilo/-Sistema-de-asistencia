/**
 * 🧪 LoanTimelineCard.test.js
 *
 * Verifies rendering of the LoanTimelineCard component:
 *   - Correct HTML markup
 *   - Matching the user's reference: hero amount, vs delta, 3 columns Antes-Cambios-Después
 *   - Generating SVG chart markup when expanded
 */

import { renderLoanTimelineCard } from '../modules/features/loans/LoanTimelineCard.js';

describe('LoanTimelineCard — Componente Visual', () => {
    const sampleEmployee = {
        id: 'emp-juan',
        name: 'Juan Pérez',
        loans: [
            {
                id: 'L1',
                principal: 124000,
                interestRate: 0,
                startDate: '2024-04-05',
                payments: [
                    { id: 'p1', amount: 20000, date: '2024-04-12', note: 'Abono a préstamo' },
                    { id: 'p2', amount: 5600, date: '2024-04-12', note: 'Abono a préstamo' }
                ],
                refinancings: [
                    { id: 'r1', amount: 3000, interestAmount: 3000, date: '2024-04-12', note: 'Refinanciamiento' }
                ]
            }
        ]
    };

    test('renderiza correctamente el balance hero y la comparativa delta', () => {
        const html = renderLoanTimelineCard(sampleEmployee, { selectedDate: '2024-04-12' });

        expect(html).toContain('Deuda total');
        expect(html).toContain('🔄 Reconstruido');
        // Saldo después: 124,000 - 20,000 - 5,600 + 3,000 = 101,400.00
        expect(html).toContain('101,400.00');
        expect(html).toContain('vs. 5 abr 2024');
    });

    test('renderiza el grid trilateral con Antes, Cambios y Después', () => {
        const html = renderLoanTimelineCard(sampleEmployee, { selectedDate: '2024-04-12' });

        expect(html).toContain('loan-trilateral-grid');
        expect(html).toContain('Antes');
        expect(html).toContain('124,000.00');
        expect(html).toContain('Cambios hasta 12 abr 2024');
        expect(html).toContain('Abono a préstamo');
        expect(html).toContain('Refinanciamiento');
        expect(html).toContain('Después');
        expect(html).toContain('is-highlighted');
    });

    test('renderiza desglose estructurado con verdes para pagos, amarillos para préstamos y morados para refinanciamiento', () => {
        const sampleMixed = {
            id: 'emp-mix',
            loans: [
                {
                    id: 'L1',
                    seq: 1,
                    principal: 5000,
                    interestRate: 10,
                    startDate: '2024-05-01',
                    payments: [
                        { id: 'p1', amount: 1000, date: '2024-05-10', note: 'Abono 1' },
                        { id: 'p2', amount: 1500, date: '2024-05-10', note: 'Abono 2' }
                    ]
                },
                {
                    id: 'L2',
                    seq: 2,
                    principal: 3000,
                    interestRate: 20,
                    startDate: '2024-05-10',
                    concept: 'Materiales',
                    refinancings: [
                        { id: 'r1', amount: 600, baseAmount: 3000, interestRate: 20, date: '2024-05-10' }
                    ]
                }
            ]
        };

        const html = renderLoanTimelineCard(sampleMixed, { selectedDate: '2024-05-10' });

        // Sumas y restas en cabecera de cambios
        expect(html).toContain('Variación neta');
        expect(html).toContain('cargos');
        expect(html).toContain('pagos');

        // Verde: Pagos / Abonos (#2)
        expect(html).toContain('is-payment');
        expect(html).toContain('Abonos / Pagos');
        expect(html).toContain('#2'); // count badge
        expect(html).toContain('2,500.00'); // total pagos

        // Amarillo: Préstamos (#1) con separación capital e interés
        expect(html).toContain('is-loan');
        expect(html).toContain('Préstamos otorgados');
        expect(html).toContain('3,000.00 capital #2');
        expect(html).toContain('600.00 interés (20%)');

        // Morado: Refinanciamiento con etiqueta de base refinanciada
        expect(html).toContain('is-refinance');
        expect(html).toContain('Refinanciamiento');
        expect(html).toContain('Base refinanciada: $3,000.00');
    });

    test('renderiza la gráfica SVG cuando showChart es true', () => {
        const htmlCollapsed = renderLoanTimelineCard(sampleEmployee, { showChart: false });
        expect(htmlCollapsed).toContain('is-collapsed');
        expect(htmlCollapsed).not.toContain('<svg class="loan-svg-chart"');

        const htmlExpanded = renderLoanTimelineCard(sampleEmployee, { showChart: true });
        expect(htmlExpanded).toContain('is-expanded');
        expect(htmlExpanded).toContain('<svg class="loan-svg-chart"');
        expect(htmlExpanded).toContain('<linearGradient id="loanChartGrad"');
    });

    test('si no hay préstamos, retorna string vacío para no ensuciar la UI', () => {
        const emptyEmp = { id: 'empty', loans: [] };
        expect(renderLoanTimelineCard(emptyEmp)).toBe('');
    });
});
