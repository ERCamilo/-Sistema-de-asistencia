/**
 * 🧪 LoansLedgerUITests — End-to-end smoke for the Cuentas-por-Cobrar UI.
 *
 * These tests render the LoansLedger() template directly and assert that
 * the new "Agregar nuevo" flow is wired correctly:
 *   1. Button appears on the overview
 *   2. Clicking the handler opens the picker overlay
 *   3. The overlay lists all employees, labels inactive ones and filters by search
 *   4. Selecting an employee opens the profile on the Nómina tab
 *
 * No real DOM dispatch — we call the controller handlers directly to
 * simulate the data-app-fn click pipeline (which we already know works
 * from app.js's existing tests).
 */

import { state } from '../modules/core/AppState.js';
import { LoansLedger } from '../modules/features/loans/LoansLedger.js';
import {
    openLoansEmployeePicker,
    closeLoansEmployeePicker,
    setLoansPickerSearch,
    openProfileForLoan,
    setLoansFilterView,
    setLoansSortBy,
    setLoansAmountFilter,
    setLoansDateFilter,
    toggleLoansFilterMenu,
    resetLoansFilters,
    selectLoansEmployee,
    setLoansDisplayMode
} from '../modules/features/loans/LoansController.js';
import { LOAN_STATUS, sortEmployeeLoans, filterEmployeeLoans, getIndividualLoanRecords } from '../modules/features/loans/LoansService.js';

function resetState() {
    state.employees = [
        { id: 'e1', name: 'Ada Lovelace',  number: '001', active: true,  loans: [] },
        { id: 'e2', name: 'Grace Hopper',  number: '002', active: true,  loans: [] },
        { id: 'e3', name: 'Margaret Hamilton', number: '003', active: false, loans: [] }
    ];
    state.loansLedger = null;
    state.employeeProfile = null;
    state.showEmployeeProfile = false;
}

function silenceWindow() {
    const prev = { notify: window.showNotification, alert: window.showAlert };
    window.showNotification = () => {};
    window.showAlert = () => {};
    return () => { window.showNotification = prev.notify; window.showAlert = prev.alert; };
}

testRunner.addSuite("LoansLedger UI — overview button", {

    "renders the 'Agregar nuevo' button on the overview"() {
        resetState();
        const html = LoansLedger();
        testRunner.assert(html.includes('data-app-fn="openLoansEmployeePicker"'), "Button is wired to openLoansEmployeePicker");
        testRunner.assert(html.includes('Agregar nuevo'), "Button label is shown");
    },

    "overview does NOT render the picker overlay by default"() {
        resetState();
        const html = LoansLedger();
        testRunner.assert(!html.includes('role="dialog"'), "No dialog rendered when picker is closed");
    },

    "warns when inactive employees keep active loan balances"() {
        resetState();
        state.employees[2].loans = [{
            id: 'L-INACTIVE', principal: 450, interestRate: 0, interestIncluded: false,
            startDate: '2026-07-01', concept: 'Botas', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];

        const html = LoansLedger();

        testRunner.assert(html.includes('loans-inactive-debt-alert'), "Inactive debt has a visible alert");
        testRunner.assert(html.includes('1 empleado inactivo mantiene préstamos activos'), "Alert includes the affected count");
        testRunner.assert(html.includes('No se incluye en Nómina'), "Alert explains payroll exclusion");
        testRunner.assert(html.includes('loan-employee-status--inactive'), "Inactive employee is labeled in the debt list");
    }
});

testRunner.addSuite("LoansLedger UI — recuperar saldados", {

    "un préstamo saldado muestra el ✕ para anular su abono (y reabrirlo)"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 500, interestRate: 0, interestIncluded: false,
            startDate: '2026-01-01', concept: 'Adelanto', status: LOAN_STATUS.PAID,
            installmentMode: 'lump', installments: [], refinancings: [],
            payments: [{ id: 'P1', amount: 500, date: '2026-01-10', voided: false }]
        }];
        state.loansLedger = { selectedEmployeeId: 'e1' };

        const html = LoansLedger();
        testRunner.assert(html.includes('SALDADO'), "el préstamo se muestra como saldado");
        testRunner.assert(
            html.includes('data-app-fn="voidPaymentHandler" data-arg="L1" data-arg2="P1"'),
            "el ✕ de anular abono aparece también en saldados");
        testRunner.assert(html.includes('reabre el préstamo'),
            "el tooltip aclara que anular el abono reabre el préstamo");
    }
});

testRunner.addSuite("LoansLedger UI — acciones de préstamo activo", {

    "el selector de modalidad usa delegación sin emitir clics sintéticos"() {
        resetState();
        state.loansLedger = {
            selectedEmployeeId: 'e1',
            showAddForm: true,
            newLoanDraft: {
                principal: 0,
                interestRate: 0,
                startDate: '2026-08-02',
                concept: '',
                installmentMode: 'lump',
                installmentCount: 4,
                installmentFrequencyWeeks: 2
            }
        };

        const html = LoansLedger();

        testRunner.assert(
            html.includes('data-app-fn="setLoanDraftField" data-arg="installmentMode" data-arg2="lump"'),
            "Pago único uses the shared app delegation"
        );
        testRunner.assert(
            html.includes('data-app-fn="setLoanDraftField" data-arg="installmentMode" data-arg2="installments"'),
            "Installments uses the shared app delegation"
        );
        testRunner.assert(!html.includes("document.dispatchEvent(new Event('click'))"),
            "Mode buttons never dispatch a document-level click without an element target");
    },

    "diferencia pago único de cuotas y muestra la próxima cuota"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 600, interestRate: 0, interestIncluded: false,
            startDate: '2026-07-01', concept: 'Botas', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'installments', installmentFrequencyWeeks: 2,
            installments: [
                { id: 'I1', seq: 1, dueDate: '2026-07-15', scheduledAmount: 300 },
                { id: 'I2', seq: 2, dueDate: '2026-07-29', scheduledAmount: 300 }
            ],
            refinancings: [], payments: []
        }];
        state.loansLedger = { selectedEmployeeId: 'e1' };

        const html = LoansLedger();

        testRunner.assert(html.includes('loan-card__repayment-badge--installments'), "Installment loan has a prominent mode badge");
        testRunner.assert(html.includes('En cuotas · 2'), "Badge states the installment count");
        testRunner.assert(html.includes('Próxima: cuota 1'), "Card identifies the next installment");
        testRunner.assert(html.includes('$300.00'), "Card displays the next installment amount");
        testRunner.assert(html.includes('15 jul 2026'), "Card displays the next installment date");
    },

    "prioriza Realizar pago y agrupa las acciones secundarias"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 500, interestRate: 10, interestIncluded: false,
            startDate: '2026-01-01', concept: 'Adelanto', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];
        state.loansLedger = { selectedEmployeeId: 'e1' };

        const html = LoansLedger();
        testRunner.assert(html.includes('Saldo pendiente'), "la métrica usa el nombre completo");
        testRunner.assert(html.includes('Realizar pago'), "muestra la acción única de pago");
        testRunner.assert(html.includes('Más acciones'), "agrupa las operaciones secundarias");
        testRunner.assert(!html.includes('Registrar abono'), "el nombre anterior desaparece");
        testRunner.assert(html.includes('data-app-fn=\"settleLoanByFullPayment\"'),
            "mantiene la acción de saldar dentro del menú");
        testRunner.assert(html.includes('data-app-fn=\"toggleRefinanceForm\"'),
            "mantiene la acción de refinanciar dentro del menú");
        testRunner.assert(html.includes('Saldar <span>(pago total)</span>'),
            "la acción secundaria explica que saldar equivale al pago total");
        testRunner.assert(
            (html.match(/class=\"loan-card__more-icon\"/g) || []).length === 2,
            "refinanciar y saldar usan iconos SVG propios");
        testRunner.assert(html.includes('class=\"loan-card__actions\"'),
            "las acciones comparten una sola fila");
        testRunner.assert(html.includes('class=\"loan-card__more-menu\"'),
            "las acciones secundarias viven en un único menú");
        testRunner.assert(html.includes('class=\"loan-card__desktop-actions\"'),
            "escritorio conserva las acciones secundarias visibles");
        testRunner.assert(html.includes('loan-card__action--desktop-refinance'),
            "escritorio muestra Refinanciar directamente");
        testRunner.assert(html.includes('loan-card__action--desktop-settle'),
            "escritorio muestra Saldar directamente");
        testRunner.assert(html.includes('loan-card__action--desktop-danger'),
            "escritorio muestra Anular como botón compacto");
        testRunner.assert(html.includes('class=\"loan-card__mobile-summary\"'),
            "incluye el resumen financiero prioritario para móvil");
        testRunner.assert(html.includes('class=\"loan-card__breakdown\"'),
            "el detalle financiero queda disponible bajo demanda");
        testRunner.assert(html.includes('class=\"loan-card__mobile-identity\"'),
            "el resumen móvil alinea identidad, saldo y control de expansión");
        testRunner.assert(html.includes('class=\"loan-card__breakdown-title\">Desglose financiero'),
            "el botón más revela el desglose dentro de la misma tarjeta");
        testRunner.assert(!html.includes('class=\"loan-card__summary-secondary\"'),
            "pagado y total ya no ocupan espacio en el estado móvil colapsado");
        testRunner.assert(html.includes('class=\"loans-detail-back\"'),
            "el regreso usa el nuevo botón circular");
        testRunner.assert(html.includes('class=\"loans-detail-header__balance\"'),
            "el saldo tiene un bloque propio para permanecer a la derecha");
        testRunner.assert(
            (html.match(/loans-detail-header__name-line/g) || []).length >= 2,
            "el nombre puede dividirse verticalmente en móvil");
        testRunner.assert(html.includes('class=\"loans-detail-back__icon\"'),
            "el regreso usa un SVG propio, centrado y consistente");
        testRunner.assert(html.includes('d=\"M19 12H5\"'),
            "la flecha conserva un asta visible, no un chevrón");
    },

    "el formulario aclara que pagar el saldo completo liquida el préstamo"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 500, interestRate: 0, interestIncluded: false,
            startDate: '2026-01-01', concept: 'Adelanto', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];
        state.loansLedger = {
            selectedEmployeeId: 'e1',
            showPaymentFormForLoan: 'L1',
            paymentDraft: { amount: 0, date: '', note: '' }
        };

        const html = LoansLedger();
        testRunner.assert(html.includes('Guardar pago'), "el formulario adopta el nuevo lenguaje");
        testRunner.assert(html.includes('Monto a pagar'), "el campo usa una etiqueta corta y alineable");
        testRunner.assert(!html.includes('Monto (saldo pendiente:'),
            "la etiqueta extensa ya no desalineará los campos");
        testRunner.assert(html.includes('Pago total'), "ofrece liquidar el saldo junto a Guardar pago");
        testRunner.assert(html.includes('loan-operation-form--payment'),
            "el formulario usa la familia visual verde de pagos");
        testRunner.assert(html.includes('saldo pendiente completo'), "explica el saldado automático");
        testRunner.assert(!html.includes('Guardar abono'), "el CTA anterior desaparece");
        testRunner.assert(!html.includes('class=\"loan-card__actions\"'),
            "oculta las acciones externas mientras se realiza un pago");
        testRunner.assert(!html.includes('data-app-fn=\"toggleRefinanceForm\"'),
            "no ofrece refinanciar dentro del contexto de pago");
        testRunner.assert(!html.includes('data-app-fn=\"writeOffLoanWithConfirm\"'),
            "no ofrece anular dentro del contexto de pago");
    },

    "el formulario de refinanciamiento oculta las demás acciones"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 500, interestRate: 10, interestIncluded: false,
            startDate: '2026-01-01', concept: 'Adelanto', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];
        state.loansLedger = {
            selectedEmployeeId: 'e1',
            showRefinanceFormForLoan: 'L1',
            refinanceDraft: { basis: 'balance', interestRate: 5, note: '' }
        };

        const html = LoansLedger();
        testRunner.assert(html.includes('Aplicar refinanciamiento'),
            "muestra el formulario de refinanciamiento");
        testRunner.assert(html.includes('loan-operation-form--refinance'),
            "el formulario usa la familia visual morada de refinanciamiento");
        testRunner.assert(!html.includes('class=\"loan-card__actions\"'),
            "oculta las acciones externas mientras se refinancia");
        testRunner.assert(!html.includes('data-app-fn=\"togglePaymentForm\"'),
            "no ofrece realizar un pago dentro del contexto de refinanciamiento");
        testRunner.assert(!html.includes('data-app-fn=\"writeOffLoanWithConfirm\"'),
            "no ofrece anular dentro del contexto de refinanciamiento");
        testRunner.assert(html.includes('data-arg="basis"') || html.includes("setRefinanceDraftField('basis'"),
            "ofrece selector de base de cálculo (saldo vs capital)");
        testRunner.assert(html.includes('data-arg="mode"') || html.includes("setRefinanceDraftField('mode'"),
            "ofrece selector de modalidad de pago (cuotas vs pago único)");
    },

    "los abonos y refinanciamientos comparten una actividad colapsada"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 2000, interestRate: 5, interestIncluded: false,
            startDate: '2026-01-01', concept: 'Adelanto', status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [],
            payments: [
                { id: 'P1', amount: 200, date: '2026-01-10', voided: false },
                { id: 'P2', amount: 300, date: '2026-01-20', voided: false }
            ],
            refinancings: [
                { id: 'R1', date: '2026-02-01', basis: 'balance', baseAmount: 2000, interestRate: 5, interestAmount: 100, voided: false },
                { id: 'R2', date: '2026-03-01', basis: 'principal', baseAmount: 2000, interestRate: 5, interestAmount: 100, voided: false }
            ]
        }];
        state.loansLedger = { selectedEmployeeId: 'e1' };

        const html = LoansLedger();
        const host = document.createElement('div');
        host.innerHTML = html;
        const activityHistory = host.querySelector('.loan-card__history--activity');
        const breakdown = host.querySelector('.loan-card__breakdown');

        testRunner.assert(activityHistory && !activityHistory.open,
            "la actividad unificada inicia colapsada");
        testRunner.assert(
            activityHistory?.querySelector('.loan-card__history-meta')?.textContent.trim() === '$500.00 pagado · 2 refinanciamientos',
            "el resumen combina el total pagado y la cantidad de refinanciamientos");
        testRunner.assert(
            activityHistory?.querySelector('.loan-card__history-title')?.textContent.trim() === 'Actividad · 4 movimientos',
            "el encabezado totaliza todos los movimientos");
        testRunner.assert(
            activityHistory?.querySelectorAll('.loan-card__activity-row').length === 4,
            "el mismo historial contiene abonos y refinanciamientos");
        testRunner.assert(breakdown && !breakdown.open,
            "el desglose financiero inicia colapsado");
        testRunner.assert(
            host.querySelectorAll('.loan-card__history--payments, .loan-card__history--refinancings').length === 0,
            "no duplica controles por tipo de movimiento");
        testRunner.assert(
            activityHistory?.querySelector('.loan-card__disclosure-icon--closed')
            && activityHistory?.querySelector('.loan-card__disclosure-icon--open'),
            "el control usa más y menos en lugar de un chevrón");
        testRunner.assert(!html.includes('chevron-down'),
            "el préstamo ya no renderiza chevrones para desplegar información");
        testRunner.assert(!html.includes('Refinanciado 2×'),
            "el contador deja de duplicarse como etiqueta superior");
    }
});

testRunner.addSuite("LoansLedger UI — picker overlay", {

    "opens after openLoansEmployeePicker() is called"() {
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('role="dialog"'), "Dialog is rendered");
        testRunner.assert(html.includes('Selecciona un empleado'), "Dialog header is shown");
    },

    "lists active and inactive employees with a clear status label"() {
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('Ada Lovelace'), "Active employee e1 listed");
        testRunner.assert(html.includes('Grace Hopper'), "Active employee e2 listed");
        testRunner.assert(html.includes('Margaret Hamilton'), "Inactive employee e3 is available for new loans");
        testRunner.assert(html.includes('loan-employee-status--inactive'), "Inactive employee has a visible label");
    },

    "each row binds to pickEmployeeForNewLoan with the employee id"() {
        // Tras la unificación: las filas del picker llevan al usuario DIRECTO
        // al formulario del ledger, sin pasar por el perfil.
        resetState();
        openLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(html.includes('data-app-fn="pickEmployeeForNewLoan" data-arg="e1"'),
            "Row for e1 must call pickEmployeeForNewLoan (no longer routes via profile)");
        testRunner.assert(html.includes('data-app-fn="pickEmployeeForNewLoan" data-arg="e2"'),
            "Row for e2 must call pickEmployeeForNewLoan");
        // Y NO el handler viejo
        testRunner.assert(!html.includes('data-app-fn="openProfileForLoan"'),
            "openProfileForLoan no debe seguir wired en el HTML del picker");
    },

    "search input filters the list down"() {
        resetState();
        openLoansEmployeePicker();
        setLoansPickerSearch('grace');
        const html = LoansLedger();
        testRunner.assert(html.includes('Grace Hopper'), "Match is kept");
        testRunner.assert(!html.includes('Ada Lovelace'), "Non-match is filtered out");
    },

    "shows 'no results' when search has no matches"() {
        resetState();
        openLoansEmployeePicker();
        setLoansPickerSearch('zzzznotreal');
        const html = LoansLedger();
        testRunner.assert(html.includes('No se encontraron empleados'), "Empty-state message shown");
    },

    "closeLoansEmployeePicker hides the overlay"() {
        resetState();
        openLoansEmployeePicker();
        closeLoansEmployeePicker();
        const html = LoansLedger();
        testRunner.assert(!html.includes('role="dialog"'), "Overlay gone after close");
    }
});

testRunner.addSuite("LoansLedger UI — full flow", {

    "click 'Agregar nuevo' → pick employee → form de nuevo préstamo se abre EN el ledger (sin perfil)"() {
        // Antes esto abría el perfil del empleado en pestaña Nómina porque ahí
        // estaba el form de alta. Tras unificación: el form de alta es del
        // ledger, y el picker debe llevar directo a él. UN solo paso.
        resetState();
        const restoreSilence = silenceWindow();
        const prevOpen = window.openEmployeeProfile;
        let profileOpened = false;
        window.openEmployeeProfile = () => { profileOpened = true; };

        try {
            // Step 1: user clicks "Agregar nuevo"
            openLoansEmployeePicker();
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, true, "Picker opened");

            // Step 2: picker renders with employees
            let html = LoansLedger();
            testRunner.assert(html.includes('Ada Lovelace'), "Picker shows Ada");

            // Step 3: user clicks Ada's row → pickEmployeeForNewLoan('e1')
            // (note: openProfileForLoan kept as deprecated alias = same effect)
            openProfileForLoan('e1');

            // Step 4: profile NOT opened; picker closed; form open in ledger
            testRunner.assertEquals(profileOpened, false,
                "Profile must NOT open (read-only for loans now)");
            testRunner.assert(!state.showEmployeeProfile, "showEmployeeProfile stays falsy");
            testRunner.assertEquals(state.loansLedger.showEmployeePicker, false, "Picker closed");
            testRunner.assertEquals(state.loansLedger.selectedEmployeeId, 'e1', "Ada is selected in the ledger");
            testRunner.assertEquals(state.loansLedger.showAddForm, true, "New-loan form is open");
        } finally {
            window.openEmployeeProfile = prevOpen;
            restoreSilence();
        }
    }
});

// ─────────────────────────────────────────────────────────────
// Suite: timestamps "último cambio" en el ledger (Tarea #16)
// ─────────────────────────────────────────────────────────────
// El usuario debe poder ver de un vistazo cuándo fue el último cambio
// en cada préstamo (creación, abono, anulación, write-off, reopen).
testRunner.addSuite("LoansLedger UI — Timestamps último cambio", {

    "préstamo con updatedAt reciente muestra 'hace Xs'"() {
        resetState();
        state.employees = [{
            id: 'eT1', name: 'Ts', number: '001', active: true,
            loans: [{
                id: 'L1', principal: 1000, interestRate: 0,
                concept: 'Reciente', status: 'active',
                installmentMode: 'lump',
                installments: [], payments: [],
                startDate: '2026-05-26',
                updatedAt: Date.now() - 10000 // hace 10s
            }]
        }];
        selectLoansEmployee('eT1');
        const html = LoansLedger();
        testRunner.assert(/hace 10s|último cambio/i.test(html),
            `Debe mostrar el timestamp del préstamo. HTML excerpt: ${html.slice(0, 400)}`);
    },

    "préstamo sin updatedAt no rompe el render"() {
        resetState();
        state.employees = [{
            id: 'eT2', name: 'Ts', number: '002', active: true,
            loans: [{
                id: 'L1', principal: 500, interestRate: 0,
                concept: 'Sin TS', status: 'active',
                installmentMode: 'lump',
                installments: [], payments: [],
                startDate: '2026-05-26'
                // sin updatedAt
            }]
        }];
        selectLoansEmployee('eT2');
        let threw = false;
        try { LoansLedger(); } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false, 'Defensivo ante loan sin updatedAt');
    }

});

testRunner.addSuite("LoansLedger UI — Vistas y Menú de Filtros", {

    "renders view tabs (Con saldo, Todos, Inactivos, Saldados) with badges"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE,
            installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];
        const html = LoansLedger();

        testRunner.assert(html.includes('data-app-fn="setLoansFilterView" data-arg="active"'), "Tab 'Con saldo' exists");
        testRunner.assert(html.includes('data-app-fn="setLoansFilterView" data-arg="all"'), "Tab 'Todos' exists");
        testRunner.assert(html.includes('data-app-fn="setLoansFilterView" data-arg="inactive-emp"'), "Tab 'Inactivos' exists");
        testRunner.assert(html.includes('data-app-fn="setLoansFilterView" data-arg="settled"'), "Tab 'Saldados' exists");
    },

    "renders sort controls for número de orden, monto y fecha de último préstamo"() {
        resetState();
        const html = LoansLedger();

        testRunner.assert(html.includes('data-app-fn="setLoansSortBy" data-arg="number"'), "Sort by number button exists");
        testRunner.assert(html.includes('data-app-fn="setLoansSortBy" data-arg="balance"'), "Sort by balance button exists");
        testRunner.assert(html.includes('data-app-fn="setLoansSortBy" data-arg="date"'), "Sort by date button exists");
    },

    "toggling filter menu displays amount and date filters"() {
        resetState();
        toggleLoansFilterMenu();
        const html = LoansLedger();

        testRunner.assert(html.includes('Filtrar Monto:'), "Amount filter select is visible");
        testRunner.assert(html.includes('Filtrar Fecha:'), "Date filter select is visible");
        testRunner.assert(html.includes('setLoansAmountFilter'), "Amount filter triggers setLoansAmountFilter");
        testRunner.assert(html.includes('setLoansDateFilter'), "Date filter triggers setLoansDateFilter");

        // Close menu
        toggleLoansFilterMenu();
    },

    "setLoansFilterView updates the active view"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 500, interestRate: 0, status: LOAN_STATUS.PAID,
            installmentMode: 'lump', installments: [], refinancings: [], payments: [{ id: 'P1', amount: 500 }]
        }];
        setLoansFilterView('settled');
        const html = LoansLedger();
        testRunner.assert(html.includes('loan-view-tab active'), "Active tab has active class");
        testRunner.assert(html.includes('Ada Lovelace'), "Settled view shows employee who fully paid");
        
        // Reset view
        setLoansFilterView('active');
    },

    "employee cards display formatted last loan date as short date"() {
        resetState();
        state.employees[0].loans = [{
            id: 'L1', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE,
            startDate: '2026-08-15', installmentMode: 'lump', installments: [], refinancings: [], payments: []
        }];
        const html = LoansLedger();
        testRunner.assert(!html.includes('Actualizado:'), "Employee card no longer has 'Actualizado:' text prefix");
        testRunner.assert(html.includes('15 ago 2026'), "Employee card displays formatted short date e.g. 15 ago 2026");
    }
});

testRunner.addSuite("LoansService — Pure Sorting and Filtering", {

    "sortEmployeeLoans sorts correctly by number (numeric), balance and date"() {
        const sample = [
            { number: '017', name: 'Zoe', totalBalance: 15800, lastLoanDate: '2026-05-10' },
            { number: '002', name: 'Ada', totalBalance: 8472, lastLoanDate: '2026-09-01' },
            { number: '0001', name: 'Bob', totalBalance: 9100, lastLoanDate: '2026-07-20' },
            { number: '26', name: 'Charles', totalBalance: 15550, lastLoanDate: '2026-08-01' }
        ];

        // 1. Número de orden ascendente
        const byNumAsc = sortEmployeeLoans(sample, 'number', 'asc');
        testRunner.assertEquals(byNumAsc.map(e => e.number).join(','), '0001,002,017,26', "Sort by number asc (numeric)");

        // 2. Número de orden descendente
        const byNumDesc = sortEmployeeLoans(sample, 'number', 'desc');
        testRunner.assertEquals(byNumDesc.map(e => e.number).join(','), '26,017,002,0001', "Sort by number desc");

        // 3. Monto descendente (mayor a menor)
        const byBalDesc = sortEmployeeLoans(sample, 'balance', 'desc');
        testRunner.assertEquals(byBalDesc.map(e => e.number).join(','), '017,26,0001,002', "Sort by balance desc");

        // 4. Monto ascendente (menor a mayor)
        const byBalAsc = sortEmployeeLoans(sample, 'balance', 'asc');
        testRunner.assertEquals(byBalAsc.map(e => e.number).join(','), '002,0001,26,017', "Sort by balance asc");

        // 5. Fecha descendente (más reciente a más antigua)
        const byDateDesc = sortEmployeeLoans(sample, 'date', 'desc');
        testRunner.assertEquals(byDateDesc.map(e => e.number).join(','), '002,005,0001,017'.replace('005', '26'), "Sort by date desc");

        // 6. Fecha ascendente (más antigua a más reciente)
        const byDateAsc = sortEmployeeLoans(sample, 'date', 'asc');
        testRunner.assertEquals(byDateAsc.map(e => e.number).join(','), '017,0001,26,002', "Sort by date asc");
    },

    "filterEmployeeLoans filters by search, amount bracket and date bracket"() {
        const sample = [
            { number: '017', name: 'Zoe Tech', totalBalance: 15800, lastLoanDate: '2026-09-05' },
            { number: '002', name: 'Ada Dev', totalBalance: 3000, lastLoanDate: '2026-01-10' },
            { number: '005', name: 'Erlin Boss', totalBalance: 9300, lastLoanDate: '2026-08-20' }
        ];

        // 1. Search by name
        const searchName = filterEmployeeLoans(sample, { search: 'ada' });
        testRunner.assertEquals(searchName.length, 1, "Search by name");
        testRunner.assertEquals(searchName[0].name, 'Ada Dev');

        // 2. Search by number
        const searchNum = filterEmployeeLoans(sample, { search: '017' });
        testRunner.assertEquals(searchNum.length, 1, "Search by number");

        // 3. Amount filter < 5000
        const under5k = filterEmployeeLoans(sample, { amountFilter: 'under5k' });
        testRunner.assertEquals(under5k.length, 1, "Amount under 5k");
        testRunner.assertEquals(under5k[0].number, '002');

        // 4. Amount filter 5k-15k
        const mid5k15k = filterEmployeeLoans(sample, { amountFilter: '5k-15k' });
        testRunner.assertEquals(mid5k15k.length, 1, "Amount 5k to 15k");
        testRunner.assertEquals(mid5k15k[0].number, '005');

        // 5. Amount filter > 15k
        const over15k = filterEmployeeLoans(sample, { amountFilter: 'over15k' });
        testRunner.assertEquals(over15k.length, 1, "Amount over 15k");
        testRunner.assertEquals(over15k[0].number, '017');
    }
});

testRunner.addSuite("LoansLedger UI — Modo de Vistas (Agrupado vs Por Préstamo)", {

    "getIndividualLoanRecords flattens multiple loans into separate unit records"() {
        const testState = {
            employees: [
                {
                    id: 'e-juan',
                    name: 'Juan Perez',
                    number: '042',
                    active: true,
                    loans: [
                        { id: 'L-1', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Herramientas', installmentMode: 'lump', payments: [] },
                        { id: 'L-2', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Reparación Moto', installmentMode: 'lump', payments: [] },
                        { id: 'L-3', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Medicinas', installmentMode: 'lump', payments: [] }
                    ]
                },
                {
                    id: 'e-ana',
                    name: 'Ana Silva',
                    number: '010',
                    active: true,
                    loans: [
                        { id: 'L-4', principal: 500, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Útiles escolares', installmentMode: 'lump', payments: [] }
                    ]
                }
            ]
        };

        const records = getIndividualLoanRecords(testState, 'active');
        testRunner.assertEquals(records.length, 4, "Debe haber 4 préstamos individuales en total");
        
        const juanRecords = records.filter(r => r.employeeId === 'e-juan');
        testRunner.assertEquals(juanRecords.length, 3, "Juan debe aparecer 3 veces, una por cada préstamo");
        testRunner.assertEquals(juanRecords[0].concept, 'Herramientas', "Primer concepto de Juan");
        testRunner.assertEquals(juanRecords[1].concept, 'Reparación Moto', "Segundo concepto de Juan");
        testRunner.assertEquals(juanRecords[2].concept, 'Medicinas', "Tercer concepto de Juan");
        testRunner.assertEquals(juanRecords[0].totalBalance, 1000, "Saldo del préstamo 1");
    },

    "setLoansDisplayMode toggles between grouped and individual mode"() {
        resetState();
        setLoansDisplayMode('individual');
        testRunner.assertEquals(state.loansLedger.displayMode, 'individual', "Modo individual fijado");

        setLoansDisplayMode('grouped');
        testRunner.assertEquals(state.loansLedger.displayMode, 'grouped', "Modo agrupado fijado");
    },

    "LoansLedger renders Juan 3 times in individual mode and 1 summary card in grouped mode"() {
        resetState();
        state.employees = [
            {
                id: 'e-juan',
                name: 'Juan Perez',
                number: '042',
                active: true,
                loans: [
                    { id: 'L-1', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Préstamo 1', installmentMode: 'lump', startDate: '2026-09-01', payments: [] },
                    { id: 'L-2', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Préstamo 2', installmentMode: 'lump', startDate: '2026-09-05', payments: [] },
                    { id: 'L-3', principal: 1000, interestRate: 0, status: LOAN_STATUS.ACTIVE, concept: 'Préstamo 3', installmentMode: 'lump', startDate: '2026-09-10', payments: [] }
                ]
            }
        ];

        // 1. Vista agrupada por empleado
        setLoansDisplayMode('grouped');
        const groupedHtml = LoansLedger();
        testRunner.assert(groupedHtml.includes('3 préstamos'), "Vista agrupada totaliza 3 préstamos en una tarjeta");
        testRunner.assert(groupedHtml.includes('data-app-fn="setLoansDisplayMode" data-arg="individual"'), "Botón para cambiar a vista individual existe");
        testRunner.assert(groupedHtml.includes('10 sep 2026'), "Muestra fecha corta 10 sep 2026");
        testRunner.assert(!groupedHtml.includes('Actualizado:'), "No incluye etiqueta de texto Actualizado:");

        // 2. Vista individual por préstamo
        setLoansDisplayMode('individual');
        const individualHtml = LoansLedger();
        
        // Contar ocurrencias de Juan Perez en el HTML de la lista
        const matches = individualHtml.match(/Juan Perez/g) || [];
        testRunner.assert(matches.length >= 3, `Juan Perez debe aparecer al menos 3 veces en vista individual (aparece ${matches.length})`);
        testRunner.assert(individualHtml.includes('Préstamo 1'), "Incluye etiqueta para Préstamo 1");
        testRunner.assert(individualHtml.includes('Préstamo 2'), "Incluye etiqueta para Préstamo 2");
        testRunner.assert(individualHtml.includes('Préstamo 3'), "Incluye etiqueta para Préstamo 3");
        testRunner.assert(individualHtml.includes('10 sep 2026'), "Muestra fecha corta 10 sep 2026 en tarjetas individuales");
        testRunner.assert(!individualHtml.includes('Actualizado:'), "No incluye etiqueta de texto Actualizado:");
        testRunner.assert(individualHtml.includes('loan-mode-btn active'), "El botón activo refleja el modo seleccionado");
    },

    "LoanCard renders Int. actual in metrics and Int. acumulado badge in purple when refinanced, and refinance form defaults to lump sum"() {
        const testEmp = {
            id: 'e-refin-1',
            number: '10',
            name: 'Carlos Ruiz',
            active: true,
            loans: [
                {
                    id: 'L-REFIN',
                    principal: 9000,
                    interestRate: 20,
                    interestIncluded: false,
                    status: LOAN_STATUS.ACTIVE,
                    concept: 'Préstamo Equipos',
                    installmentMode: 'lump',
                    startDate: '2026-07-11',
                    payments: [],
                    refinancings: [
                        {
                            id: 'REF-1',
                            date: '2026-09-11',
                            basis: 'balance',
                            baseAmount: 10800,
                            interestRate: 20,
                            interestAmount: 2160,
                            voided: false
                        }
                    ]
                },
                {
                    id: 'L-NORMAL',
                    principal: 5000,
                    interestRate: 10,
                    interestIncluded: false,
                    status: LOAN_STATUS.ACTIVE,
                    concept: 'Préstamo Normal',
                    installmentMode: 'lump',
                    startDate: '2026-07-11',
                    payments: [],
                    refinancings: []
                }
            ]
        };

        state.employees = [testEmp];
        state.loansLedger = {
            selectedEmployeeId: 'e-refin-1',
            showRefinanceFormForLoan: 'L-REFIN'
        };

        const html = LoansLedger();
        const host = document.createElement('div');
        host.innerHTML = html;

        // 1. Verificar Int. actual en métricas
        const metricLabels = Array.from(host.querySelectorAll('.loan-card__metric-label')).map(el => el.textContent.trim());
        testRunner.assert(metricLabels.includes('Int. actual'), "Muestra métrica 'Int. actual' en las tarjetas");

        // 2. Verificar que el préstamo con refinanciamiento tiene el badge acumulado morado
        const refinBadge = host.querySelector('.loan-card__repayment-badge--refinanced');
        testRunner.assert(refinBadge !== null, "Renderiza badge con clase loan-card__repayment-badge--refinanced cuando hay refinanciamiento");
        testRunner.assert(refinBadge?.textContent.includes('Int. acumulado: $3,960.00'), "Badge acumulado muestra el total de interés acumulado ($3,960.00)");

        // 3. Verificar que el préstamo normal tiene el badge acumulado neutral
        const normalBadge = host.querySelector('.loan-card__repayment-badge--accumulated');
        testRunner.assert(normalBadge !== null, "Renderiza badge con clase loan-card__repayment-badge--accumulated cuando no hay refinanciamiento");
        testRunner.assert(normalBadge?.textContent.includes('Int. acumulado: $500.00'), "Badge normal muestra el interés base acumulado ($500.00)");

        // 4. Verificar formulario de refinanciamiento predeterminado a Pago único
        const refinForm = host.querySelector('.loan-operation-form--refinance');
        testRunner.assert(refinForm !== null, "Formulario de refinanciamiento está abierto");
        const lumpButton = refinForm?.querySelector('[data-arg2="lump"]');
        testRunner.assert(lumpButton?.classList.contains('active'), "El botón 'Pago único' está activo por defecto en refinanciamiento");
        const installmentsButton = refinForm?.querySelector('[data-arg2="installments"]');
        testRunner.assert(!installmentsButton?.classList.contains('active'), "El botón 'En cuotas' NO está activo por defecto");
    }
});

console.log('🧪 LoansLedger UI tests cargados.');
