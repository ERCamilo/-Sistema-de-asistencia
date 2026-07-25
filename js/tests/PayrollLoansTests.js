import fs from 'fs';
import path from 'path';
import {
    applyPayrollLoanDeductions,
    buildPayrollLoanSelection,
    calculatePayrollBeforeLoans,
    getInvalidPayrollLoanRows,
    getEligiblePayrollLoans,
    removeEmployeePayrollLoans,
    resolvePayrollLoanSelection,
    setEmployeePayrollLoans,
    summarizePayrollLoans,
    togglePayrollLoan,
    toSplitXRows
} from '../modules/features/payroll/PayrollLoans.js';

const PAYROLL_UI_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollUI.js'), 'utf8'
);
const PAYROLL_LOANS_RESPONSIVE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/payroll/PayrollLoansDesktop.js'), 'utf8'
);
const PAYROLL_REDESIGN_CSS = fs.readFileSync(
    path.resolve(__dirname, '../../css/payroll-redesign.css'), 'utf8'
);

function buildEmployee() {
    return {
        id: 'e1',
        number: '7',
        name: 'Ada',
        loans: [
            {
                id: 'loan-active',
                principal: 100,
                interestRate: 0,
                interestIncluded: false,
                status: 'active',
                payments: [{ id: 'p1', amount: 25, voided: false }],
                refinancings: [],
                concept: 'Adelanto'
            },
            {
                id: 'loan-closed',
                principal: 500,
                interestRate: 0,
                status: 'paid',
                payments: [],
                refinancings: [],
                concept: 'Saldado'
            }
        ]
    };
}

function baseRow(amount = 200) {
    return {
        id: 7,
        nombre: 'Ada (Ref #7)',
        monto: amount,
        _employeeId: 'e1'
    };
}

testRunner.addSuite('PayrollLoans — selección temporal y exportación', {
    'la nómina base excluye avances legacy para evitar doble descuento'() {
        let capturedArgs = null;
        const service = {
            calculateEmployeePayroll(...args) {
                capturedArgs = args;
                return { neto: 100 };
            }
        };

        calculatePayrollBeforeLoans(service, 'e1', '2026-07-01', '2026-07-15', [], []);
        testRunner.assert(Array.isArray(capturedArgs[5]), 'Debe pasar una lista explícita de avances');
        testRunner.assertEquals(capturedArgs[5].length, 0, 'Los avances legacy no se descuentan en la base');
    },

    'descuenta solo préstamos activos con saldo exactamente una vez'() {
        const employee = buildEmployee();
        const selection = buildPayrollLoanSelection([employee]);
        const first = applyPayrollLoanDeductions([baseRow()], [employee], selection);
        const second = applyPayrollLoanDeductions(first, [employee], selection);

        testRunner.assertEquals(first[0]._loans, 75, 'Debe usar el saldo, no el capital original');
        testRunner.assertEquals(first[0].monto, 125, 'Debe descontar el saldo una vez');
        testRunner.assertEquals(second[0].monto, 125, 'Reaplicar no debe duplicar el descuento');
    },

    'marca como inválido y conserva el trabajador cuando el neto queda en cero o negativo'() {
        const employee = buildEmployee();
        const selection = buildPayrollLoanSelection([employee]);
        const zero = applyPayrollLoanDeductions([baseRow(75)], [employee], selection);
        const negative = applyPayrollLoanDeductions([baseRow(50)], [employee], selection);

        testRunner.assertEquals(zero.length, 1, 'El trabajador no debe omitirse');
        testRunner.assertEquals(zero[0].monto, 0, 'El neto cero debe conservarse para mostrar el error');
        testRunner.assert(zero[0]._invalidLoanNet, 'Neto cero debe ser inválido');
        testRunner.assert(negative[0]._invalidLoanNet, 'Neto negativo debe ser inválido');
    },

    'incluye préstamos cuyo saldo vigente es exactamente 0.01'() {
        const employee = {
            id: 'cent',
            loans: [{
                id: 'loan-cent', principal: 0.01, interestRate: 0,
                interestIncluded: false, status: 'active', payments: [], refinancings: []
            }]
        };

        const eligible = getEligiblePayrollLoans(employee);
        testRunner.assertEquals(eligible.length, 1, 'Un centavo sigue siendo saldo vigente');
        testRunner.assertEquals(eligible[0].balance, 0.01, 'Debe conservar el centavo exacto');
    },

    'detecta filas inválidas para notificar inmediatamente al importar'() {
        const invalid = getInvalidPayrollLoanRows([
            { id: 1, _invalidLoanNet: false },
            { id: 2, _invalidLoanNet: true }
        ]);
        testRunner.assertEquals(invalid.length, 1, 'Debe identificar la fila que bloquea exportación');
        testRunner.assertEquals(invalid[0].id, 2, 'Debe devolver la fila inválida');
    },

    'elimina temporalmente todos los préstamos de un trabajador sin tocar la selección original'() {
        const employee = buildEmployee();
        const selection = buildPayrollLoanSelection([employee]);
        const cleaned = removeEmployeePayrollLoans(selection, employee.id);

        testRunner.assertEquals(cleaned.length, 0, 'Debe quitar al trabajador del listado temporal');
        testRunner.assertEquals(selection.length, 1, 'La función debe ser pura');
        const rows = applyPayrollLoanDeductions([baseRow()], [employee], cleaned);
        testRunner.assertEquals(rows[0].monto, 200, 'Al quitar préstamos se restaura el neto base');
    },

    'elimina una selección con employeeId numérico aunque la UI entregue string'() {
        const selection = [{ employeeId: 42, loanIds: ['loan-1'] }];
        const cleaned = removeEmployeePayrollLoans(selection, '42');
        testRunner.assertEquals(cleaned.length, 0, 'La frontera DOM string debe coincidir con el id numérico');
    },

    'actualiza una selección parcial por préstamo sin mutar la original'() {
        const selection = [{ employeeId: 'e1', loanIds: ['loan-1', 'loan-2'] }];
        const partial = togglePayrollLoan(selection, 'e1', 'loan-2', false);
        const restored = togglePayrollLoan(partial, 'e1', 'loan-2', true);

        testRunner.assertEquals(selection[0].loanIds.length, 2, 'La selección original no se muta');
        testRunner.assertEquals(partial[0].loanIds.length, 1, 'Permite excluir un préstamo individual');
        testRunner.assertEquals(restored[0].loanIds.length, 2, 'Permite volver a incluirlo');
    },

    'el estado vacío elimina al empleado y el estado total conserva IDs únicos'() {
        const selection = [{ employeeId: 'e1', loanIds: ['loan-1'] }];
        const empty = setEmployeePayrollLoans(selection, 'e1', []);
        const all = setEmployeePayrollLoans(empty, 'e1', ['loan-1', 'loan-1', 'loan-2']);

        testRunner.assertEquals(empty.length, 0, 'Sin préstamos no deja una selección vacía');
        testRunner.assertEquals(all[0].loanIds.length, 2, 'La selección total deduplica préstamos');
    },

    'calcular, resolver y exportar no muta préstamos ni pagos persistidos'() {
        const employee = buildEmployee();
        const before = JSON.stringify(employee);
        const selection = buildPayrollLoanSelection([employee]);
        resolvePayrollLoanSelection([employee], selection);
        const rows = applyPayrollLoanDeductions([baseRow()], [employee], selection);
        toSplitXRows(rows);

        testRunner.assertEquals(JSON.stringify(employee), before, 'El modelo persistido debe permanecer idéntico');
    },

    'el contrato SplitX conserva las claves en orden y desglosa el cálculo'() {
        const employee = buildEmployee();
        const selection = buildPayrollLoanSelection([employee]);
        const rows = applyPayrollLoanDeductions([{ ...baseRow(), _brutoOriginal: 210, _bonuses: 20, _deductions: 30 }], [employee], selection);
        const splitX = toSplitXRows(rows);

        testRunner.assertEquals(JSON.stringify(Object.keys(splitX[0])), JSON.stringify(['id', 'nombre', 'monto', 'bruto', 'bonificaciones', 'descuentos', 'prestamos']), 'Claves exactas y ordenadas');
        testRunner.assertEquals(splitX[0].monto, 125, 'SplitX recibe el neto después de préstamos');
        testRunner.assertEquals(splitX[0].bruto + splitX[0].bonificaciones - splitX[0].descuentos - splitX[0].prestamos, splitX[0].monto, 'El desglose reconstruye el neto');
    },

    'resume selección, interés total y saldo total sin mutar préstamos'() {
        const employee = buildEmployee();
        employee.loans[0].interestRate = 10;
        employee.loans[0].refinancings = [
            { interestAmount: 5, voided: false },
            { interestAmount: 50, voided: true }
        ];
        const before = JSON.stringify(employee);
        const selection = buildPayrollLoanSelection([employee]);
        const summary = summarizePayrollLoans([employee], selection);

        testRunner.assertEquals(summary.eligibleCount, 1, 'Solo cuenta préstamos activos con saldo');
        testRunner.assertEquals(summary.selectedCount, 1, 'Cuenta préstamos seleccionados');
        testRunner.assertEquals(summary.selectedInterest, 15, 'Interés seleccionado incluye original y refinanciación vigente');
        testRunner.assertEquals(summary.selectedBalance, 90, 'Saldo seleccionado descuenta pagos y suma refinanciación vigente');
        testRunner.assertEquals(summary.eligibleInterest, 15, 'Interés elegible usa la misma fuente contractual');
        testRunner.assertEquals(summary.eligibleTotalDue, 115, 'Valor contractual elegible incluye intereses');
        testRunner.assertEquals(summary.eligibleBalance, 90, 'Saldo activo elegible descuenta pagos');
        testRunner.assertEquals(JSON.stringify(employee), before, 'El resumen debe ser puro');
    },

    'separa métricas seleccionadas de elegibles con selección parcial y deduplica'() {
        const employee = buildEmployee();
        employee.loans.push({
            id: 'loan-second', principal: 50, interestRate: 20,
            interestIncluded: false, status: 'active', payments: [], refinancings: []
        });
        const selection = [
            { employeeId: 'e1', loanIds: ['loan-active', 'loan-active'] },
            { employeeId: 'e1', loanIds: ['loan-active'] }
        ];
        const summary = summarizePayrollLoans([employee, employee], selection);

        testRunner.assertEquals(summary.eligibleCount, 2, 'Deduplica elegibles por empleado y préstamo');
        testRunner.assertEquals(summary.selectedCount, 1, 'Deduplica también la selección');
        testRunner.assertEquals(summary.selectedBalance, 75, 'Solo suma el saldo seleccionado');
        testRunner.assertEquals(summary.eligibleBalance, 135, 'Conserva el saldo de todos los elegibles');
        testRunner.assertEquals(summary.eligibleTotalDue, 160, 'Conserva el valor contractual total elegible');
    },

    'sin selección mantiene visibles los denominadores y totales elegibles'() {
        const employee = buildEmployee();
        employee.loans[0].interestRate = 10;
        const summary = summarizePayrollLoans([employee], []);

        testRunner.assertEquals(summary.selectedCount, 0, 'No hay préstamos seleccionados');
        testRunner.assertEquals(summary.selectedInterest, 0, 'Interés seleccionado inicia en cero');
        testRunner.assertEquals(summary.selectedBalance, 0, 'Saldo seleccionado inicia en cero');
        testRunner.assertEquals(summary.eligibleCount, 1, 'El denominador elegible permanece visible');
        testRunner.assertEquals(summary.eligibleInterest, 10, 'El interés elegible permanece visible');
        testRunner.assertEquals(summary.eligibleTotalDue, 110, 'El valor total elegible permanece visible');
        testRunner.assertEquals(summary.eligibleBalance, 85, 'El saldo activo elegible permanece visible');
    }
});

testRunner.addSuite('Paso 4 — workspace responsive de préstamos', {

    'usa un único componente y elimina el bloque móvil legado'() {
        testRunner.assert(
            PAYROLL_UI_SRC.includes('${renderPayrollLoansDesktop({'),
            'la etapa debe renderizar el workspace responsive'
        );
        testRunner.assert(
            !PAYROLL_UI_SRC.includes('payroll-loans-legacy'),
            'el diseño móvil legado ya no debe renderizarse'
        );
        testRunner.assert(
            !PAYROLL_UI_SRC.includes('export-loans-section'),
            'el bloque colapsable antiguo debe eliminarse'
        );
    },

    'mantiene el contador compacto y habilita la composición móvil'() {
        testRunner.assert(
            PAYROLL_LOANS_RESPONSIVE_SRC.includes(
                '${summary.selectedCount}/${summary.eligibleCount}'
            ),
            'el contador general debe usar el formato compacto N/N'
        );
        testRunner.assert(
            PAYROLL_LOANS_RESPONSIVE_SRC.includes('data-label="A descontar"')
                && PAYROLL_LOANS_RESPONSIVE_SRC.includes('data-label="Neto a pagar"'),
            'las métricas deben conservar etiquetas responsive'
        );
        testRunner.assert(
            PAYROLL_LOANS_RESPONSIVE_SRC.includes(
                'de ${formatCurrency(group.eligibleBalance)}'
            ),
            'el descuento debe mostrar debajo el total de préstamos elegibles'
        );
        testRunner.assert(
            /@media \(max-width: 900px\)[\s\S]*?\.payroll-loans-desktop\s*\{\s*display:\s*block;/.test(
                PAYROLL_REDESIGN_CSS
            ),
            'el workspace nuevo debe permanecer visible bajo 900 px'
        );
        testRunner.assert(
            /\.payroll-loan-group__count\s*\{[^}]*padding-left:\s*8px;[^}]*text-align:\s*center\s*!important;/.test(
                PAYROLL_REDESIGN_CSS
            ),
            'el contador de préstamos móvil debe quedar centrado y separado del borde'
        );
        testRunner.assert(
            /\.payroll-loans-table\s*\{[^}]*display:\s*grid;[^}]*gap:\s*8px;[^}]*background:\s*#080d12;/.test(
                PAYROLL_REDESIGN_CSS
            ),
            'las tarjetas móviles deben quedar separadas por un canal oscuro'
        );
    },

    'compacta las columnas internas en escritorios de baja resolución'() {
        testRunner.assert(
            /\.payroll-loan-child__interest\s*\{\s*grid-column:\s*3;/.test(
                PAYROLL_REDESIGN_CSS
            )
                && /\.payroll-loan-child__balance\s*\{\s*grid-column:\s*4;/.test(
                    PAYROLL_REDESIGN_CSS
                ),
            'interés y saldo deben comenzar inmediatamente después del nombre del préstamo'
        );
        testRunner.assert(
            /\.payroll-loans-table__columns,[\s\S]*?min-width:\s*700px;/.test(
                PAYROLL_REDESIGN_CSS
            ),
            'la tabla de escritorio debe caber desde 700 px sin reducir la escala del navegador'
        );
    }

});
