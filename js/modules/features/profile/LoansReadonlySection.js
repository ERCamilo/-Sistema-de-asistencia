/**
 * 💵 LoansReadonlySection.js (Unificación de préstamos)
 *
 * Vista de SOLO LECTURA de los préstamos del empleado, embebida en la
 * pestaña Nómina del perfil. Reemplaza el viejo editor inline
 * (`generateAdvancesHTML`) que permitía registrar/editar desde el
 * perfil — el lugar canónico ahora es Cuentas por Cobrar.
 *
 * Esta sección:
 *   - Muestra los préstamos del empleado leyendo de emp.loans[]
 *     (modelo nuevo, no del legacy emp.advances[]).
 *   - Para cada préstamo: concepto, principal, estado, abonado, saldo.
 *   - Empty-state amigable cuando no hay préstamos.
 *   - Botón CTA "📊 Gestionar en Cuentas por Cobrar" — siempre visible.
 *     Disparara openLoansLedgerFor(empId) que cierra el perfil y
 *     navega al ledger con el empleado preseleccionado.
 */

import { formatTimeSince } from '../../utils/RelativeTime.js';

function fmt(n) {
    const v = Number(n) || 0;
    return v.toLocaleString('es-DO', { style: 'currency', currency: 'DOP', maximumFractionDigits: 2 });
}

function statusBadge(status) {
    const map = {
        active:     { label: 'Activo',   color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
        saldado:    { label: 'Saldado',  color: '#06b6d4', bg: 'rgba(6, 182, 212, 0.1)' },
        'written-off': { label: 'Castigado', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)' },
        anulado:    { label: 'Anulado',  color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' }
    };
    const info = map[status] || { label: status || '—', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.1)' };
    return `<span style="padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; background: ${info.bg}; color: ${info.color}; border: 1px solid ${info.color};">${info.label}</span>`;
}

function loanRow(loan) {
    const principal = Number(loan?.principal) || 0;
    const paid = (loan?.payments || [])
        .filter(p => !p.voided)
        .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const balance = Math.max(0, principal - paid);
    const lastChange = formatTimeSince(loan?.updatedAt);

    return `
        <div style="background: rgba(15, 23, 42, 0.6); padding: 12px 14px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; margin-bottom: 6px;">
                <div style="flex: 1; min-width: 0;">
                    <div style="color: #f1f5f9; font-weight: 700; font-size: 0.9rem; margin-bottom: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${loan.concept || 'Préstamo'}
                    </div>
                    <div style="color: #64748b; font-size: 0.7rem;">
                        ${loan.startDate || ''}
                    </div>
                </div>
                ${statusBadge(loan.status)}
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 0.8rem;">
                <div>
                    <span style="color: #64748b;">Principal:</span>
                    <strong style="color: #f1f5f9; margin-left: 4px;">${fmt(principal)}</strong>
                </div>
                <div>
                    <span style="color: #64748b;">Abonado:</span>
                    <strong style="color: #10b981; margin-left: 4px;">${fmt(paid)}</strong>
                </div>
                <div>
                    <span style="color: #64748b;">Saldo:</span>
                    <strong style="color: #f59e0b; margin-left: 4px;">${fmt(balance)}</strong>
                </div>
            </div>
            ${loan?.updatedAt ? `
                <div style="margin-top: 6px; color: #64748b; font-size: 0.68rem; text-align: right;">
                    ⏱️ Último cambio: ${lastChange}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * @param {object} emp Empleado con .id y opcionalmente .loans
 * @returns {string} HTML de la sección
 */
export function generateLoansReadonlySection(emp) {
    const empId = emp?.id || '';
    const loans = Array.isArray(emp?.loans) ? emp.loans : [];

    const list = loans.length > 0
        ? loans.map(loanRow).join('')
        : `
            <div style="text-align: center; padding: 32px 16px; background: rgba(15, 23, 42, 0.3); border: 1px dashed #334155; border-radius: 12px;">
                <div style="font-size: 2rem; margin-bottom: 10px; opacity: 0.5;">💵</div>
                <div style="color: #64748b; font-size: 0.9rem; font-weight: 500;">Sin préstamos registrados</div>
                <div style="color: #475569; font-size: 0.75rem; margin-top: 4px;">
                    Usa el botón de Cuentas por Cobrar para registrar el primero
                </div>
            </div>
        `;

    const empLastChange = formatTimeSince(emp?.updatedAt);

    return `
        <div style="background: #1e293b; padding: 20px; border-radius: 14px; border: 1px solid #334155;">
            <!-- Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                    <div style="font-size: 0.9rem; font-weight: 950; color: #f1f5f9; text-transform: uppercase; letter-spacing: 0.05em;">
                        Adelantos y Préstamos
                    </div>
                    <div style="font-size: 0.7rem; color: #64748b; font-weight: 500;">
                        ${loans.length === 0 ? 'Sin registros' : `${loans.length} ${loans.length === 1 ? 'préstamo' : 'préstamos'}`}
                        ${emp?.updatedAt ? ` · ⏱️ Último cambio del empleado: ${empLastChange}` : ''}
                    </div>
                </div>
                <button type="button" data-app-fn="openLoansLedgerFor" data-arg="${empId}"
                        style="background: #f59e0b; color: #0f172a; border: none; padding: 10px 16px; border-radius: 10px; font-weight: 900; font-size: 0.8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px;">
                    📊 Gestionar en Cuentas por Cobrar →
                </button>
            </div>

            <!-- Lista (read-only) o empty-state -->
            ${list}

            <!-- Aviso de read-only -->
            <div style="margin-top: 12px; padding: 8px 12px; background: rgba(6, 182, 212, 0.08); border-left: 3px solid #06b6d4; border-radius: 4px; font-size: 0.72rem; color: #94a3b8; line-height: 1.5;">
                ℹ️ Vista de solo lectura. Para registrar, editar o abonar préstamos usa <strong>Cuentas por Cobrar</strong>.
            </div>
        </div>
    `;
}

export default generateLoansReadonlySection;
