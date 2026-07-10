/**
 * 💵 LoansLedger — Template for the Cuentas-por-Cobrar view.
 *
 * Two modes:
 *  - LIST: top stats + filter + table of employees with active loans
 *  - DETAIL: drilldown for one employee showing every loan + payments
 *
 * Mode switches via state.loansLedger.selectedEmployeeId (null = list).
 *
 * All buttons go through data-app-fn; handlers live in LoansController.js
 * and are bound to window.* at boot via registerLegacyGlobals().
 */

import { state } from '../../core/AppState.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import { formatTimeSince } from '../../utils/RelativeTime.js';
import icons from '../../ui/IconSystem.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import {
    getEmployeesWithDebt,
    getTotalExposure,
    getTotalPaidActive,
    getEmployeesWithOnlyInactiveLoans,
    getTotalActiveInterest,
    getTotalHistoricalInterest,
    getTotalHistoricalDue,
    getTotalHistoricalPaid,
    getClosedLoansCount,
    getBalance,
    getTotalDue,
    getPaidAmount,
    getRefinanceCount,
    getTotalInterestAccrued,
    LOAN_STATUS,
    INSTALLMENT_MODE,
    VALIDATION,
    generateInstallmentSchedule
} from './LoansService.js';
import { detectLoanDuplicateCandidates } from './LoanDuplicateDetector.js';
import { isPendingUpload } from '../../services/EntitiesSyncStamp.js';

export function LoansLedger() {
    const ledger = state.loansLedger || {};
    const body = ledger.selectedEmployeeId
        ? EmployeeLoansDetail(ledger.selectedEmployeeId)
        : LedgerOverview();
    // The picker is an overlay that can appear over either mode.
    return body + (ledger.showEmployeePicker ? EmployeePickerOverlay() : '');
}

// ─── LIST VIEW ───────────────────────────────────────────────────────────────

function LedgerOverview() {
    const ledger = state.loansLedger || {};
    const search = (ledger.search || '').toLowerCase().trim();

    const allWithDebt = getEmployeesWithDebt(state);
    const filtered = search
        ? allWithDebt.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : allWithDebt;

    const allInactive = getEmployeesWithOnlyInactiveLoans(state);
    const filteredInactive = search
        ? allInactive.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : allInactive;

    const totalExposure = getTotalExposure(state);
    const totalPaid = getTotalPaidActive(state);
    const totalLoans = allWithDebt.reduce((s, e) => s + e.loanCount, 0);

    const totalActiveInterest = getTotalActiveInterest(state);
    const totalHistoricalInterest = getTotalHistoricalInterest(state);
    const totalHistoricalDue = getTotalHistoricalDue(state);
    const totalHistoricalPaid = getTotalHistoricalPaid(state);
    const closedLoansCount = getClosedLoansCount(state);

    return `
        <div style="max-width: 1000px; margin: 0 auto;">
            <!-- KPI cards: 2 cols on narrow screens (auto-fit grows on wide) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 20px;">
                ${kpiCard('Saldo pendiente', formatCurrency(totalExposure), '#f59e0b', 'payroll', 'Total facturado', formatCurrency(totalHistoricalDue))}
                ${kpiCard('Total pagado', formatCurrency(totalPaid), '#10b981', 'check', 'Total histórico', formatCurrency(totalHistoricalPaid))}
                ${kpiCard('Interés total', formatCurrency(totalActiveInterest), '#f43f5e', 'analytics', 'Total histórico', formatCurrency(totalHistoricalInterest))}
                ${kpiCard('Empleados con deuda', allWithDebt.length.toString(), '#06b6d4', 'personnel', 'Saldados', allInactive.length.toString())}
                ${kpiCard('Préstamos activos', totalLoans.toString(), '#a855f7', 'briefcase', 'Cerrados', closedLoansCount.toString())}
            </div>

            <!-- Search + actions -->
            <div style="background: #1e293b; border-radius: 12px; padding: 16px; margin-bottom: 20px; border: 1px solid #334155; display: flex; gap: 12px; flex-wrap: wrap; align-items: center;">
                <div style="flex: 1; min-width: 220px;">
                    <input type="text" autocomplete="off"
                           placeholder="🔍 Buscar empleado por nombre o número..."
                           value="${escapeAttr(ledger.search || '')}"
                           oninput="setLoansSearch(this.value)"
                           style="width: 100%; padding: 10px 14px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <button type="button" data-app-fn="openLoansEmployeePicker"
                        style="padding: 10px 16px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer; display: inline-flex; align-items: center; gap: 8px;">
                    ${icons.get('add', { size: 16 })} Agregar nuevo
                </button>
                <div style="font-size: 0.8rem; color: #94a3b8;">
                    Mostrando ${filtered.length} de ${allWithDebt.length}
                </div>
            </div>

            <!-- Employee list -->
            ${filtered.length === 0 ? `
                <div style="text-align: center; padding: 60px 20px; background: #1e293b; border-radius: 12px; border: 1px solid #334155;">
                    <div style="font-size: 3rem; margin-bottom: 12px; opacity: 0.4;">${icons.get('payroll')}</div>
                    <div style="color: #94a3b8; font-size: 0.95rem;">
                        ${search ? 'No se encontraron empleados que coincidan con la búsqueda' : 'No hay empleados con préstamos activos'}
                    </div>
                </div>
            ` : filtered.map(emp => `
                <div role="button" tabindex="0"
                     data-app-fn="selectLoansEmployee" data-arg="${emp.employeeId}"
                     style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px;"
                     onmouseover="this.style.borderColor='#06b6d4'"
                     onmouseout="this.style.borderColor='#334155'">
                    <!-- Number avatar -->
                    <div style="width: 36px; height: 36px; background: rgba(245,158,11,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #f59e0b; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">
                        ${emp.number || '?'}
                    </div>
                    <!-- Name + sub-line, takes whatever space is left -->
                    <div style="flex: 1; min-width: 0;">
                        <div style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</div>
                        <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${emp.loanCount} préstamo${emp.loanCount === 1 ? '' : 's'} · Pagado ${formatCurrency(emp.totalPaid)}
                        </div>
                    </div>
                    <!-- Balance pinned to the right -->
                    <div style="text-align: right; flex-shrink: 0;">
                        <div style="font-size: 1.05rem; font-weight: 900; color: #f59e0b; line-height: 1.1;">${formatCurrency(emp.totalBalance)}</div>
                        <div style="font-size: 0.65rem; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em;">de ${formatCurrency(emp.totalDue)}</div>
                    </div>
                </div>
            `).join('')}

            <!-- Apartado colapsable: Cuentas Saldadas (Inactivas) -->
            ${allInactive.length > 0 ? `
                <div style="margin-top: 30px; margin-bottom: 20px;">
                    <button type="button" data-app-fn="toggleInactiveHistory"
                            style="width: 100%; display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color: #e2e8f0; font-weight: 700; font-size: 0.85rem; cursor: pointer; text-align: left; outline: none; transition: border-color 0.15s;"
                            onmouseover="this.style.borderColor='#94a3b8'"
                            onmouseout="this.style.borderColor='#334155'">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="color: #10b981; display: inline-flex; align-items: center;">${icons.get('check', { size: 16 })}</span>
                            <span>Historial de cuentas saldadas (${allInactive.length})</span>
                        </div>
                        <span style="font-size: 0.75rem; color: #64748b;">
                            ${ledger.showInactiveHistory ? 'Ocultar ▲' : 'Mostrar ▼'}
                        </span>
                    </button>
                    
                    ${ledger.showInactiveHistory ? `
                        <div style="margin-top: 8px;">
                            ${filteredInactive.length === 0 ? `
                                <div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.85rem;">
                                    No se encontraron cuentas saldadas que coincidan
                                </div>
                            ` : filteredInactive.map(emp => `
                                <div role="button" tabindex="0"
                                     data-app-fn="selectLoansEmployee" data-arg="${emp.employeeId}"
                                     style="background: #1e293b; border: 1px solid #334155; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; display: flex; align-items: center; gap: 10px; opacity: 0.8;"
                                     onmouseover="this.style.borderColor='#10b981'; this.style.opacity='1'"
                                     onmouseout="this.style.borderColor='#334155'; this.style.opacity='0.8'">
                                    <!-- Number avatar -->
                                    <div style="width: 36px; height: 36px; background: rgba(16,185,129,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #10b981; font-weight: 800; font-size: 0.8rem; flex-shrink: 0;">
                                        ${emp.number || '?'}
                                    </div>
                                    <!-- Name + sub-line -->
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="color: #e2e8f0; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</div>
                                        <div style="color: #94a3b8; font-size: 0.7rem; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                                            ${emp.loanCount} préstamo${emp.loanCount === 1 ? '' : 's'} · Totalmente pagado
                                        </div>
                                    </div>
                                    <!-- Total paid/due pinned to the right -->
                                    <div style="text-align: right; flex-shrink: 0;">
                                        <div style="font-size: 0.95rem; font-weight: 800; color: #10b981; line-height: 1.1;">${formatCurrency(emp.totalPaid)}</div>
                                        <div style="font-size: 0.6rem; color: #64748b; text-transform: uppercase;">recuperado</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : ''}
        </div>
    `;
}

function kpiCard(label, value, color, iconName, subLabel = '', subValue = '') {
    const subHTML = (subLabel && subValue)
        ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 6px; border-top: 1px dashed #334155; padding-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeAttr(`${subLabel}: ${subValue}`)}">${subLabel}: <span style="font-weight: 700;">${subValue}</span></div>`
        : '';
    return `
        <div style="background: #1e293b; border-radius: 10px; padding: 12px; border: 1px solid #334155; border-left: 4px solid ${color}; min-width: 0; display: flex; flex-direction: column; justify-content: space-between;">
            <div>
                <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                    <div style="color: ${color}; flex-shrink: 0;">${icons.get(iconName, { size: 16 })}</div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.03em; line-height: 1.2;">${label}</div>
                </div>
                <div style="font-size: 1.15rem; font-weight: 900; color: #f1f5f9; word-break: break-word; line-height: 1.1;">${value}</div>
            </div>
            ${subHTML}
        </div>
    `;
}

// ─── DETAIL VIEW (one employee) ──────────────────────────────────────────────

function EmployeeLoansDetail(empId) {
    const emp = state.employees.find(e => e.id === empId);
    if (!emp) {
        return `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="color: #94a3b8;">Empleado no encontrado</div>
                <button data-app-fn="clearLoansEmployee" style="margin-top: 12px; padding: 8px 16px; background: #06b6d4; color: #000; border: none; border-radius: 8px; font-weight: 700; cursor: pointer;">← Volver</button>
            </div>
        `;
    }

    const allLoans = emp.loans || [];
    const active = allLoans.filter(l => l.status === LOAN_STATUS.ACTIVE);
    const paid = allLoans.filter(l => l.status === LOAN_STATUS.PAID);
    const writtenOff = allLoans.filter(l => l.status === LOAN_STATUS.WRITTEN_OFF);
    const totalBalance = active.reduce((s, l) => s + getBalance(l), 0);

    const ledger = state.loansLedger || {};
    const showAddForm = !!ledger.showAddForm;

    // Fase 2 U4: detector post-merge de posibles duplicados por creación
    // concurrente (doble señal: mismo seq + monto igual + fechas cercanas).
    // U4 solo avisa; el wizard de resolución es U5.
    const duplicateCandidates = detectLoanDuplicateCandidates(emp);

    return `
        <div style="max-width: 1000px; margin: 0 auto;">
            <!-- Header with back button -->
            <div style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <button type="button" data-app-fn="clearLoansEmployee" aria-label="Volver"
                            style="width: 36px; height: 36px; background: transparent; border: 1px solid #334155; border-radius: 8px; color: #e2e8f0; cursor: pointer; font-size: 1.1rem;">←</button>
                    <div>
                        <div style="color: #f1f5f9; font-weight: 800; font-size: 1.1rem;">${escapeHTML(emp.name)}</div>
                        <div style="color: #94a3b8; font-size: 0.8rem;">#${emp.number}</div>
                    </div>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo pendiente</div>
                    <div style="font-size: 1.5rem; font-weight: 900; color: #f59e0b;">${formatCurrency(totalBalance)}</div>
                </div>
            </div>

            ${duplicateCandidates.length > 0 ? `
                <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.5); border-radius: 12px; padding: 14px 16px; margin-bottom: 16px;">
                    <div style="color: #fca5a5; font-weight: 800; font-size: 0.85rem; margin-bottom: 6px;">⚠️ Posibles préstamos duplicados</div>
                    <div style="color: #cbd5e1; font-size: 0.78rem; line-height: 1.5; margin-bottom: 4px;">
                        Estos pares tienen el mismo monto, fecha cercana y el mismo número de secuencia — pueden ser el MISMO préstamo anotado desde dos dispositivos.
                    </div>
                    ${duplicateCandidates.map(c => `
                        <div style="background: rgba(15,23,42,0.6); border-radius: 8px; padding: 10px 12px; margin-top: 8px;">
                            <div style="display: flex; flex-direction: column; gap: 6px;">
                                ${[c.a, c.b].map(l => `
                                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
                                        <span style="color: #e2e8f0; font-size: 0.78rem;">
                                            "${escapeHTML(l.concept || 'Préstamo')}" · ${formatDateShort(l.startDate)} · ${formatCurrency(l.principal)}
                                            ${getPaidAmount(l) > 0 ? ` · <span style="color:#6ee7b7;">abonado ${formatCurrency(getPaidAmount(l))}</span>` : ''}
                                        </span>
                                        <button type="button" data-app-fn="resolveDupDeleteLoan" data-arg="${escapeAttr(l.id)}"
                                                style="padding: 4px 10px; background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.6); color: #fca5a5; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer; white-space: nowrap;">
                                            🗑️ Eliminar este
                                        </button>
                                    </div>
                                `).join('')}
                            </div>
                            <button type="button" data-app-fn="resolveDupKeepBoth" data-arg="${escapeAttr(c.a.id)}" data-arg2="${escapeAttr(c.b.id)}"
                                    style="margin-top: 8px; width: 100%; padding: 6px 10px; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.5); color: #6ee7b7; border-radius: 6px; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                                ✓ Son préstamos distintos — conservar ambos
                            </button>
                        </div>
                    `).join('')}
                    <div style="margin-top: 8px; color: #94a3b8; font-size: 0.72rem;">Si abonaron cuotas sobre uno de los dos, conservá ese — el monto abonado se muestra en verde.</div>
                </div>
            ` : ''}

            <!-- New loan button / form -->
            ${showAddForm ? NewLoanForm() : `
                <button type="button" data-app-fn="toggleAddLoanForm"
                        style="width: 100%; padding: 14px; margin-bottom: 16px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 10px; font-weight: 800; font-size: 0.95rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px;">
                    ${icons.get('add')} Nuevo préstamo / adelanto
                </button>
            `}

            <!-- Active loans -->
            ${active.length > 0 ? `
                <div style="font-size: 0.8rem; font-weight: 700; color: #f59e0b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px;">Activos (${active.length})</div>
                ${active.map(loan => LoanCard(loan)).join('')}
            ` : ''}

            <!-- Paid loans -->
            ${paid.length > 0 ? `
                <details style="margin-top: 20px;">
                    <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #10b981; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;">
                        Saldados (${paid.length}) ▾
                    </summary>
                    ${paid.map(loan => LoanCard(loan)).join('')}
                </details>
            ` : ''}

            <!-- Written-off loans -->
            ${writtenOff.length > 0 ? `
                <details style="margin-top: 12px;">
                    <summary style="cursor: pointer; font-size: 0.8rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 0;">
                        Anulados (${writtenOff.length}) ▾
                    </summary>
                    ${writtenOff.map(loan => LoanCard(loan)).join('')}
                </details>
            ` : ''}

            ${allLoans.length === 0 ? `
                <div style="text-align: center; padding: 40px 20px; color: #64748b; background: #1e293b; border-radius: 12px; border: 1px dashed #334155;">
                    Este empleado no tiene préstamos registrados. Usa el botón arriba para crear el primero.
                </div>
            ` : ''}
        </div>
    `;
}

// ─── ONE LOAN CARD ───────────────────────────────────────────────────────────

function LoanCard(loan) {
    const balance = getBalance(loan);
    const totalDue = getTotalDue(loan);
    const paid = getPaidAmount(loan);
    const isActive = loan.status === LOAN_STATUS.ACTIVE;
    const isPaid = loan.status === LOAN_STATUS.PAID;
    const isWrittenOff = loan.status === LOAN_STATUS.WRITTEN_OFF;
    const ledger = state.loansLedger || {};
    const showPay = ledger.showPaymentFormForLoan === loan.id;
    const showRefin = ledger.showRefinanceFormForLoan === loan.id;
    const visiblePayments = (loan.payments || []).filter(p => !p.voided);
    const refinancings = (loan.refinancings || []).filter(r => !r.voided);
    const refinCount = getRefinanceCount(loan);
    const totalInterest = getTotalInterestAccrued(loan);

    const refinBadge = refinCount > 0
        ? `<span title="${refinancings.map(r => `${formatDateShort(r.date)}: +${formatCurrency(r.interestAmount)}`).join(' | ')}" style="background: rgba(168,85,247,0.18); border: 1px solid rgba(168,85,247,0.6); color: #d8b4fe; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; white-space: nowrap;">♻️ Refinanciado ${refinCount}×</span>`
        : '';

    // Fase 2 U4: badge "pendiente de subir" — el préstamo tiene cambios con
    // updatedAt POSTERIOR a la última subida de entidades confirmada
    // (EntitiesSyncStamp). Solo con sesión: sin cuenta conectada, "pendiente
    // de subir" no significa nada y sería ruido.
    const hasSession = typeof window !== 'undefined' && !!window.currentUser;
    const pendingUploadBadge = (hasSession && isPendingUpload(loan.updatedAt))
        ? `<span title="Los últimos cambios de este préstamo todavía no se confirmaron en la nube. Se suben solos al sincronizar." style="background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.55); color: #fcd34d; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800; white-space: nowrap;">☁️ Pendiente de subir</span>`
        : '';

    const statusBadge = isActive
        ? `<span style="background: #f59e0b; color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ACTIVO</span>`
        : loan.status === LOAN_STATUS.PAID
            ? `<span style="background: #10b981; color: #000; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">SALDADO</span>`
            : `<span style="background: #64748b; color: #fff; padding: 3px 10px; border-radius: 6px; font-size: 0.7rem; font-weight: 800;">ANULADO</span>`;

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 16px 18px; border: 1px solid #334155; margin-bottom: 12px; ${isWrittenOff ? 'opacity: 0.6;' : ''}">
            <!-- Top line: concept + status -->
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 200px;">
                    <div style="font-size: 0.95rem; font-weight: 700; color: #f1f5f9; margin-bottom: 4px;">${escapeHTML(loan.concept || 'Préstamo')}</div>
                    <div style="font-size: 0.75rem; color: #94a3b8;">
                        ${formatDateShort(loan.startDate)} ·
                        ${loan.installmentMode === INSTALLMENT_MODE.INSTALLMENTS ? `${(loan.installments || []).length} cuotas` : 'Pago único'}
                    </div>
                    ${loan.updatedAt ? `
                        <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px;">
                            ⏱️ Último cambio: ${formatTimeSince(loan.updatedAt)}
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; align-items: flex-end;">
                    ${statusBadge}
                    ${refinBadge}
                    ${pendingUploadBadge}
                </div>
            </div>

            <!-- Numbers row -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; padding: 12px; background: #0f172a; border-radius: 8px; margin-bottom: 12px;">
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Capital</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${formatCurrency(loan.principal)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Interés</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${loan.interestRate}%${loan.interestIncluded ? ' (incl.)' : ''}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Int. acumulado</div>
                    <div style="font-size: 0.95rem; color: ${refinCount > 0 ? '#d8b4fe' : '#f1f5f9'}; font-weight: 700;" title="Interés total acumulado (original + refinanciamientos)">${formatCurrency(totalInterest)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Total</div>
                    <div style="font-size: 0.95rem; color: #f1f5f9; font-weight: 700;">${formatCurrency(totalDue)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Pagado</div>
                    <div style="font-size: 0.95rem; color: #10b981; font-weight: 700;">${formatCurrency(paid)}</div>
                </div>
                <div>
                    <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Saldo</div>
                    <div style="font-size: 0.95rem; color: ${balance > 0 ? '#f59e0b' : '#10b981'}; font-weight: 800;">${formatCurrency(balance)}</div>
                </div>
            </div>

            <!-- Payments history -->
            ${visiblePayments.length > 0 ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Abonos</div>
                    ${visiblePayments.slice().reverse().map(p => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #0f172a; border-radius: 6px; margin-bottom: 4px; font-size: 0.8rem;">
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <span style="color: #10b981; font-weight: 700;">+${formatCurrency(p.amount)}</span>
                                <span style="color: #94a3b8;">${formatDateShort(p.date)}</span>
                                ${p.note ? `<span style="color: #64748b; font-style: italic;">"${escapeHTML(p.note)}"</span>` : ''}
                            </div>
                            ${(isActive || isPaid) ? `<button type="button" data-app-fn="voidPaymentHandler" data-arg="${loan.id}" data-arg2="${p.id}"
                                                  style="background: transparent; border: 1px solid #334155; color: #94a3b8; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;"
                                                  title="${isPaid ? 'Anular este abono (reabre el préstamo)' : 'Anular este abono'}">✕</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Refinancing history -->
            ${refinancings.length > 0 ? `
                <div style="margin-bottom: 12px;">
                    <div style="font-size: 0.7rem; color: #d8b4fe; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">♻️ Refinanciamientos</div>
                    ${refinancings.slice().reverse().map(r => `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #0f172a; border-radius: 6px; margin-bottom: 4px; font-size: 0.8rem; border-left: 3px solid #a855f7;">
                            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                                <span style="color: #d8b4fe; font-weight: 700;">+${formatCurrency(r.interestAmount)}</span>
                                <span style="color: #94a3b8;">${formatDateShort(r.date)}</span>
                                <span style="color: #64748b; font-size: 0.72rem;">${r.interestRate}% sobre ${r.basis === 'balance' ? 'saldo' : 'capital'} (${formatCurrency(r.baseAmount)})</span>
                                ${r.note ? `<span style="color: #64748b; font-style: italic;">"${escapeHTML(r.note)}"</span>` : ''}
                            </div>
                            ${isActive ? `<button type="button" data-app-fn="voidRefinanceHandler" data-arg="${loan.id}" data-arg2="${r.id}"
                                                  style="background: transparent; border: 1px solid #334155; color: #94a3b8; padding: 3px 8px; border-radius: 4px; font-size: 0.7rem; cursor: pointer;"
                                                  title="Anular este refinanciamiento">✕</button>` : ''}
                        </div>
                    `).join('')}
                </div>
            ` : ''}

            <!-- Payment form -->
            ${isActive && showPay ? PaymentForm(loan, balance) : ''}

            <!-- Refinance form -->
            ${isActive && showRefin ? RefinanceForm(loan, balance) : ''}

            <!-- Actions -->
            ${isActive ? `
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    ${!showPay ? `
                        <button type="button" data-app-fn="togglePaymentForm" data-arg="${loan.id}"
                                style="flex: 1; min-width: 130px; padding: 10px 14px; background: #06b6d4; color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                            ${icons.get('add', { size: 14 })} Registrar abono
                        </button>
                    ` : ''}
                    ${!showRefin ? `
                        <button type="button" data-app-fn="toggleRefinanceForm" data-arg="${loan.id}"
                                style="padding: 10px 14px; background: transparent; color: #d8b4fe; border: 1px solid #a855f7; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer;"
                                title="Agregar interés porque no pudo pagar">
                            ♻️ Refinanciar
                        </button>
                    ` : ''}
                    <button type="button" data-app-fn="settleLoanByFullPayment" data-arg="${loan.id}"
                            style="padding: 10px 14px; background: #10b981; color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                        ${icons.get('check', { size: 14 })} Saldar
                    </button>
                    <button type="button" data-app-fn="writeOffLoanWithConfirm" data-arg="${loan.id}"
                            style="padding: 10px 14px; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                        ${icons.get('delete', { size: 14 })}
                    </button>
                </div>
            ` : isWrittenOff ? `
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button type="button" data-app-fn="reopenLoanHandler" data-arg="${loan.id}"
                            style="padding: 8px 14px; background: transparent; color: #06b6d4; border: 1px solid #06b6d4; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                        Reactivar
                    </button>
                    <button type="button" data-app-fn="deleteLoanWithConfirm" data-arg="${loan.id}"
                            style="padding: 8px 14px; background: transparent; color: #ef4444; border: 1px solid #ef4444; border-radius: 8px; font-weight: 700; font-size: 0.8rem; cursor: pointer;"
                            title="Eliminar este préstamo de forma permanente">
                        ${icons.get('delete', { size: 14 })} Eliminar
                    </button>
                </div>
            ` : ''}
        </div>
    `;
}

// ─── PAYMENT (abono) FORM ────────────────────────────────────────────────────

function PaymentForm(loan, balance) {
    const draft = (state.loansLedger || {}).paymentDraft || { amount: 0, date: '', note: '' };
    return `
        <div style="background: rgba(6,182,212,0.08); border: 1px solid rgba(6,182,212,0.3); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 0.75rem; color: #06b6d4; font-weight: 800; text-transform: uppercase; margin-bottom: 10px;">Nuevo abono</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Monto (saldo: ${formatCurrency(balance)})</label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.amount || ''}" max="${balance}" min="0" step="0.01"
                           oninput="setPaymentDraftField('amount', this.value)"
                           placeholder="0.00"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Fecha</label>
                    <input type="date" value="${draft.date}"
                           onchange="setPaymentDraftField('date', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Concepto</label>
                    <input type="text" value="${escapeAttr(draft.note || '')}"
                           oninput="setPaymentDraftField('note', this.value)"
                           placeholder="opcional"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>
            <div style="display: flex; gap: 8px;">
                <button type="button" data-app-fn="submitPayment" data-arg="${loan.id}"
                        style="flex: 1; padding: 10px; background: #06b6d4; color: #000; border: none; border-radius: 6px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                    Guardar abono
                </button>
                <button type="button" data-app-fn="togglePaymentForm" data-arg="${loan.id}"
                        style="padding: 10px 14px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// ─── REFINANCE (refinanciamiento) FORM ────────────────────────────────────────

function RefinanceForm(loan, balance) {
    const draft = (state.loansLedger || {}).refinanceDraft || { basis: 'balance', interestRate: 0, note: '' };
    const base = draft.basis === 'balance' ? balance : Number(loan.principal || 0);
    const rate = Number(draft.interestRate || 0);
    const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const interestToAdd = r2(base * rate / 100);
    const newBalance = r2(balance + interestToAdd);

    const radio = (val, label, desc) => `
        <label style="display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; background: #0f172a; border: 1px solid ${draft.basis === val ? '#a855f7' : '#334155'}; border-radius: 8px; cursor: pointer; flex: 1; min-width: 160px;">
            <input type="radio" name="refin-basis-${loan.id}" ${draft.basis === val ? 'checked' : ''}
                   onchange="setRefinanceDraftField('basis', '${val}')" style="margin-top: 2px;">
            <span><span style="color: #f1f5f9; font-weight: 700; font-size: 0.85rem;">${label}</span><br>
            <span style="color: #64748b; font-size: 0.72rem;">${desc}</span></span>
        </label>`;

    return `
        <div style="background: rgba(168,85,247,0.08); border: 1px solid rgba(168,85,247,0.35); border-radius: 10px; padding: 12px; margin-bottom: 12px;">
            <div style="font-size: 0.75rem; color: #d8b4fe; font-weight: 800; text-transform: uppercase; margin-bottom: 10px;">♻️ Refinanciar (no pudo pagar)</div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;">
                ${radio('balance', 'Sobre saldo restante', `Interés sobre ${formatCurrency(balance)}`)}
                ${radio('principal', 'Sobre capital original', `Interés sobre ${formatCurrency(loan.principal)}`)}
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin-bottom: 10px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Tasa de interés (%)</label>
                    <input type="number" inputmode="decimal" autocomplete="off" value="${draft.interestRate || ''}"
                           min="0" max="${VALIDATION.MAX_INTEREST_PERCENT}" step="0.1"
                           oninput="setRefinanceDraftField('interestRate', this.value)" placeholder="0"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Nota (opcional)</label>
                    <input type="text" value="${escapeAttr(draft.note || '')}"
                           oninput="setRefinanceDraftField('note', this.value)" placeholder="motivo"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>
            <div style="display: flex; justify-content: space-between; gap: 10px; padding: 8px 10px; background: #0f172a; border-radius: 8px; margin-bottom: 10px; font-size: 0.82rem;">
                <span style="color: #94a3b8;">Interés a agregar: <strong style="color: #d8b4fe;">+${formatCurrency(interestToAdd)}</strong></span>
                <span style="color: #94a3b8;">Nuevo saldo: <strong style="color: #f59e0b;">${formatCurrency(newBalance)}</strong></span>
            </div>
            <div style="display: flex; gap: 8px;">
                <button type="button" data-app-fn="submitRefinance" data-arg="${loan.id}"
                        style="flex: 1; padding: 10px; background: #a855f7; color: #fff; border: none; border-radius: 6px; font-weight: 800; font-size: 0.85rem; cursor: pointer;">
                    Aplicar refinanciamiento
                </button>
                <button type="button" data-app-fn="toggleRefinanceForm" data-arg="${loan.id}"
                        style="padding: 10px 14px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 6px; font-weight: 700; font-size: 0.85rem; cursor: pointer;">
                    Cancelar
                </button>
            </div>
        </div>
    `;
}

// ─── NEW LOAN FORM ───────────────────────────────────────────────────────────

// ─── EMPLOYEE PICKER OVERLAY ─────────────────────────────────────────────────
//
// Shown when the user taps "+ Agregar nuevo" on the overview. Lists every
// active employee with a quick filter; tapping a row closes the picker and
// opens that employee's profile on the Nómina tab so the loan can be
// registered through the in-profile editor.

function EmployeePickerOverlay() {
    const ledger = state.loansLedger || {};
    const search = (ledger.pickerSearch || '').toLowerCase().trim();
    const all = (state.employees || []).filter(e => e.active !== false);
    const filtered = search
        ? all.filter(e =>
            (e.name || '').toLowerCase().includes(search) ||
            (e.number || '').toLowerCase().includes(search))
        : all;

    return `
        <div role="dialog" aria-modal="true"
             style="position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 9000; display: flex; align-items: center; justify-content: center; padding: 16px;"
             onclick="if(event.target===this) closeLoansEmployeePicker()">
            <div style="background: #1e293b; border: 1px solid #334155; border-radius: 14px; width: 100%; max-width: 520px; max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;">
                <div style="padding: 16px 18px; border-bottom: 1px solid #334155; display: flex; justify-content: space-between; align-items: center; gap: 12px;">
                    <div>
                        <div style="color: #f1f5f9; font-weight: 800; font-size: 1rem;">Selecciona un empleado</div>
                        <div style="color: #94a3b8; font-size: 0.78rem; margin-top: 2px;">Te llevaremos a su perfil para registrar el préstamo</div>
                    </div>
                    <button type="button" data-app-fn="closeLoansEmployeePicker" aria-label="Cerrar"
                            style="width: 32px; height: 32px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 8px; cursor: pointer; font-size: 1rem;">✕</button>
                </div>
                <div style="padding: 12px 16px; border-bottom: 1px solid #334155;">
                    <input type="text" autocomplete="off"
                           placeholder="🔍 Buscar empleado..."
                           value="${escapeAttr(ledger.pickerSearch || '')}"
                           oninput="setLoansPickerSearch(this.value)"
                           style="width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #334155; border-radius: 8px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div style="overflow-y: auto; padding: 8px;">
                    ${filtered.length === 0 ? `
                        <div style="text-align: center; padding: 40px 20px; color: #64748b; font-size: 0.9rem;">
                            ${search ? 'No se encontraron empleados' : 'No hay empleados activos'}
                        </div>
                    ` : filtered.map(emp => `
                        <div role="button" tabindex="0"
                             data-app-fn="pickEmployeeForNewLoan" data-arg="${emp.id}"
                             style="display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 8px; cursor: pointer; transition: background 0.12s;"
                             onmouseover="this.style.background='#0f172a'"
                             onmouseout="this.style.background='transparent'">
                            <div style="width: 36px; height: 36px; background: rgba(6,182,212,0.12); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #06b6d4; font-weight: 800; font-size: 0.85rem;">
                                ${emp.number || '?'}
                            </div>
                            <div style="flex: 1; min-width: 0;">
                                <div style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(emp.name)}</div>
                                <div style="color: #94a3b8; font-size: 0.72rem;">${(emp.loans || []).filter(l => l.status === LOAN_STATUS.ACTIVE).length} préstamo(s) activo(s)</div>
                            </div>
                            <div style="color: #64748b; font-size: 1.1rem;">›</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    `;
}

function NewLoanForm() {
    const draft = (state.loansLedger || {}).newLoanDraft || {};
    const isInstallments = draft.installmentMode === INSTALLMENT_MODE.INSTALLMENTS;

    // Preview installment schedule live as the user types
    let schedulePreview = '';
    if (isInstallments && draft.principal > 0 && draft.installmentCount >= 2 && draft.startDate) {
        try {
            const schedule = generateInstallmentSchedule({
                principal: Number(draft.principal),
                interestRate: Number(draft.interestRate || 0),
                interestIncluded: !!draft.interestIncluded,
                startDate: draft.startDate,
                count: Number(draft.installmentCount),
                frequencyWeeks: Number(draft.installmentFrequencyWeeks)
            });
            schedulePreview = `
                <div style="background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px 12px; margin-top: 10px;">
                    <div style="font-size: 0.7rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Plan de cuotas (vista previa)</div>
                    ${schedule.map(inst => `
                        <div style="display: flex; justify-content: space-between; padding: 4px 0; font-size: 0.8rem; border-bottom: 1px solid rgba(255,255,255,0.05);">
                            <span style="color: #94a3b8;">Cuota ${inst.seq} · ${formatDateShort(inst.dueDate)}</span>
                            <span style="color: #f1f5f9; font-weight: 700;">${formatCurrency(inst.scheduledAmount)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch { /* draft invalid, no preview */ }
    }

    return `
        <div style="background: #1e293b; border: 1px solid #06b6d4; border-radius: 12px; padding: 18px; margin-bottom: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                <div style="font-size: 0.9rem; font-weight: 800; color: #06b6d4; text-transform: uppercase; letter-spacing: 0.05em;">Nuevo Préstamo</div>
                <button type="button" data-app-fn="toggleAddLoanForm"
                        style="background: transparent; color: #94a3b8; border: 1px solid #334155; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">✕ Cerrar</button>
            </div>

            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 12px;">
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Monto del capital</label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.principal || ''}" min="0" step="0.01"
                           oninput="setLoanDraftField('principal', this.value)"
                           placeholder="0.00"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Interés (%) <small style="color:#64748b;">max ${VALIDATION.MAX_INTEREST_PERCENT}</small></label>
                    <input type="number" inputmode="decimal" autocomplete="off"
                           value="${draft.interestRate || 0}" min="0" max="${VALIDATION.MAX_INTEREST_PERCENT}" step="0.1"
                           oninput="setLoanDraftField('interestRate', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div>
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Fecha</label>
                    <input type="date" value="${draft.startDate}"
                           onchange="setLoanDraftField('startDate', this.value)"
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
                <div style="grid-column: 1 / -1;">
                    <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Concepto</label>
                    <input type="text" autocomplete="off"
                           value="${escapeAttr(draft.concept || '')}"
                           oninput="setLoanDraftField('concept', this.value)"
                           placeholder="Ej: Adelanto de quincena, préstamo médico, etc."
                           style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                </div>
            </div>

            <!-- Mode toggle -->
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <button type="button" onclick="setLoanDraftField('installmentMode', 'lump'); document.dispatchEvent(new Event('click'))"
                        style="flex: 1; padding: 8px; background: ${!isInstallments ? '#06b6d4' : '#0f172a'}; color: ${!isInstallments ? '#000' : '#94a3b8'}; border: 1px solid ${!isInstallments ? '#06b6d4' : '#334155'}; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Pago único
                </button>
                <button type="button" onclick="setLoanDraftField('installmentMode', 'installments'); document.dispatchEvent(new Event('click'))"
                        style="flex: 1; padding: 8px; background: ${isInstallments ? '#06b6d4' : '#0f172a'}; color: ${isInstallments ? '#000' : '#94a3b8'}; border: 1px solid ${isInstallments ? '#06b6d4' : '#334155'}; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer;">
                    Cuotas
                </button>
            </div>

            ${isInstallments ? `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                    <div>
                        <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Número de cuotas</label>
                        <input type="number" inputmode="numeric" autocomplete="off"
                               value="${draft.installmentCount || 4}" min="2" max="${VALIDATION.MAX_INSTALLMENTS}" step="1"
                               oninput="setLoanDraftField('installmentCount', this.value)"
                               style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                    </div>
                    <div>
                        <label style="font-size: 0.7rem; color: #94a3b8; display: block; margin-bottom: 4px;">Cada cuántas semanas</label>
                        <select onchange="setLoanDraftField('installmentFrequencyWeeks', this.value)"
                                style="width: 100%; padding: 8px; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #f1f5f9; font-size: 0.9rem;">
                            ${VALIDATION.ALLOWED_FREQUENCY_WEEKS.map(w =>
                                `<option value="${w}" ${Number(draft.installmentFrequencyWeeks) === w ? 'selected' : ''}>${w} semana${w === 1 ? '' : 's'}</option>`
                            ).join('')}
                        </select>
                    </div>
                </div>
                ${schedulePreview}
            ` : ''}

            <button type="button" data-app-fn="submitNewLoan"
                    style="width: 100%; margin-top: 12px; padding: 12px; background: linear-gradient(135deg, #f59e0b, #fbbf24); color: #000; border: none; border-radius: 8px; font-weight: 800; font-size: 0.95rem; cursor: pointer;">
                ${icons.get('save', { size: 16 })} Registrar préstamo
            </button>
        </div>
    `;
}
