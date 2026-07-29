import {
    detectPettyCashDuplicates,
    normalizeDuplicateText
} from '../modules/features/pettycash/PettyCashDuplicateDetection.js';
import { PettyCashTab } from '../modules/features/pettycash/PettyCashUI.js';
import { state } from '../modules/core/AppState.js';

const periods = [
    { id: 'old', projectId: 'p1', label: 'Enero' },
    { id: 'current', projectId: 'p1', label: 'Febrero' }
];

function expense(overrides = {}) {
    return {
        id: 'm1',
        projectId: 'p1',
        periodId: 'old',
        recordNumber: 1,
        type: 'gasto',
        amount: 1500,
        date: '2026-01-15',
        fechaEmision: '2026-01-14',
        paidTo: 'Ferretería Peña',
        rncEmisor: '1-01-12345-6',
        ncf: 'B01-00000001',
        ...overrides
    };
}

describe('PettyCashDuplicateDetection', () => {
    test('marca como exacto el mismo NCF y RNC y referencia el registro anterior', () => {
        const findings = detectPettyCashDuplicates([
            expense(),
            expense({ id: 'm2', periodId: 'current', recordNumber: 2 })
        ], periods);

        expect(findings).toEqual([expect.objectContaining({
            movementId: 'm2',
            referenceId: 'm1',
            confidence: 'exact',
            referenceNumber: 1,
            referencePeriodId: 'old',
            referencePeriodLabel: 'Enero'
        })]);
    });

    test('normaliza acentos y usa el proveedor cuando ambos registros carecen de RNC', () => {
        const findings = detectPettyCashDuplicates([
            expense({ rncEmisor: '', paidTo: 'Ferretería Peña' }),
            expense({
                id: 'm2',
                recordNumber: 2,
                rncEmisor: '',
                paidTo: ' FERRETERIA   PENA '
            })
        ], periods);

        expect(normalizeDuplicateText(' Ferretería   Peña ')).toBe('ferreteria pena');
        expect(findings[0]?.confidence).toBe('exact');
    });

    test('no considera exacto un NCF de emisores distintos', () => {
        const findings = detectPettyCashDuplicates([
            expense(),
            expense({
                id: 'm2',
                recordNumber: 2,
                rncEmisor: '9-99-99999-9',
                paidTo: 'Otro comercio',
                fechaEmision: '2026-02-01',
                amount: 3000
            })
        ], periods);

        expect(findings).toEqual([]);
    });

    test('marca como posible la misma fecha, proveedor y monto aunque falte el NCF', () => {
        const findings = detectPettyCashDuplicates([
            expense({ ncf: '', rncEmisor: '' }),
            expense({
                id: 'm2',
                periodId: 'current',
                recordNumber: 2,
                ncf: '',
                rncEmisor: ''
            })
        ], periods);

        expect(findings[0]).toEqual(expect.objectContaining({
            movementId: 'm2',
            referenceId: 'm1',
            confidence: 'possible',
            reason: 'Misma fecha, proveedor y monto'
        }));
    });

    test('ignora reposiciones, otros proyectos y coincidencias incompletas', () => {
        const findings = detectPettyCashDuplicates([
            expense(),
            expense({ id: 'repo', recordNumber: 2, type: 'reposicion' }),
            expense({ id: 'other', projectId: 'p2', recordNumber: 2 }),
            expense({ id: 'different', recordNumber: 3, ncf: '', paidTo: 'Otra', amount: 99 })
        ], periods);

        expect(findings).toEqual([]);
    });

    test('una cadena de coincidencias siempre apunta al registro canónico más antiguo', () => {
        const findings = detectPettyCashDuplicates([
            expense(),
            expense({ id: 'm2', recordNumber: 2 }),
            expense({ id: 'm3', recordNumber: 3 })
        ], periods);

        expect(findings.map(({ movementId, referenceId }) => ({ movementId, referenceId })))
            .toEqual([
                { movementId: 'm2', referenceId: 'm1' },
                { movementId: 'm3', referenceId: 'm1' }
            ]);
    });

    test('no muta la lista recibida', () => {
        const movements = [
            expense({ id: 'm2', recordNumber: 2 }),
            expense()
        ];
        const snapshot = JSON.parse(JSON.stringify(movements));

        detectPettyCashDuplicates(movements, periods);

        expect(movements).toEqual(snapshot);
    });
});

describe('Caja Chica — advertencias de duplicados', () => {
    afterEach(() => {
        state.pettyCash = null;
    });

    test('muestra la advertencia y enlaza el registro de otro periodo', () => {
        state.pettyCash = {
            projects: [{ id: 'p1', name: 'Obra' }],
            periods: [
                { ...periods[0], status: 'cerrada', openingDate: '2026-01-01' },
                { ...periods[1], status: 'abierta', openingDate: '2026-02-01' }
            ],
            movements: [
                expense(),
                expense({ id: 'm2', periodId: 'current', recordNumber: 2 })
            ],
            selectedProjectId: 'p1',
            selectedPeriodId: 'current',
            movementSortBy: 'recordNumber',
            movementSortDirection: 'desc',
            receiptQueueHiddenIds: [],
            form: null,
            periodForm: null,
            editMov: null
        };

        const html = PettyCashTab();

        expect(html).toContain('1 registro requiere revisión por posible duplicado');
        expect(html).toContain('Coincide con #001 · Enero');
        expect(html).toContain('pcOpenDuplicateReference');
        expect(html).toContain('La app no elimina datos automáticamente');
    });
});
