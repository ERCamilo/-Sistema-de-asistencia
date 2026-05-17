import { state } from '../../core/AppState.js';
import { payrollService } from '../../services/index.js';
import { formatCurrency } from '../../utils/Formatters.js';
import icons from '../IconSystem.js';
import { CalendarView } from '../components/CalendarView.js';

// ============================================
// 🎯 EVENT DELEGATION (data-profile-action)
// ============================================
const _PROFILE_ACTION_MAP = {
    'close-employee-profile': () => window.closeEmployeeProfile?.(),
    'open-employee-form': (id) => window.openEmployeeForm?.(id),
    'change-profile-tab': (tab) => window.changeProfileTab?.(tab),
    'toggle-profile-start-picker': () => window.toggleProfileStartPicker?.(),
    'toggle-profile-end-picker': () => window.toggleProfileEndPicker?.(),
    'set-profile-period': (p) => window.setProfilePeriod?.(p),
    'toggle-position-breakdown': () => window.togglePositionBreakdown?.(),
    'mark-as-paid': (_, el) => window.markAsPaid?.(el.dataset.empId, parseFloat(el.dataset.neto)),
    'change-profile-start-month': (delta, _el, e) => { e?.stopPropagation(); window.changeProfileStartMonth?.(parseInt(delta, 10)); },
    'change-profile-end-month': (delta, _el, e) => { e?.stopPropagation(); window.changeProfileEndMonth?.(parseInt(delta, 10)); },
    'select-profile-start-date': (dateKey, _el, e) => { e?.stopPropagation(); window.selectProfileStartDate?.(dateKey); },
    'select-profile-end-date': (dateKey, _el, e) => { e?.stopPropagation(); window.selectProfileEndDate?.(dateKey); },
    'close-start-picker': (_, _el, e) => { e?.stopPropagation(); if (state.employeeProfile) state.employeeProfile.showStartPicker = false; window.render?.(); },
    'close-end-picker': (_, _el, e) => { e?.stopPropagation(); if (state.employeeProfile) state.employeeProfile.showEndPicker = false; window.render?.(); },
    'change-profile-hire-date-month': (delta) => window.changeProfileHireDateMonth?.(parseInt(delta, 10)),
    'select-profile-hire-date': (_, el) => window.selectProfileHireDate?.(el.dataset.empId, el.dataset.date),
    'toggle-profile-hire-date-picker': () => { state.showProfileHireDatePicker = !state.showProfileHireDatePicker; window.render?.(); },
    'close-overlay': (_, el, e) => { if (e.target === el) window.closeEmployeeProfile?.(); }
};

function _handleProfileClick(e) {
    const target = e.target.closest('[data-profile-action]');
    if (!target) return;
    const action = target.dataset.profileAction;
    const handler = _PROFILE_ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handleProfileKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-profile-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleProfileClick(e);
}

let _profileDelegationAttached = false;
function _attachProfileDelegation() {
    if (_profileDelegationAttached) return;
    document.addEventListener('click', _handleProfileClick);
    document.addEventListener('keydown', _handleProfileKeydown);
    _profileDelegationAttached = true;
}
_attachProfileDelegation();

/**
 * 👤 MODAL PRINCIPAL: Perfil de Empleado
 */
export function EmployeeProfileModal() {
    const emp = state.selectedEmployee;
    if (!emp) return '';

    const tabs = [
        { id: 'resumen', label: '📊 Resumen', icon: 'zap' },
        { id: 'asistencia', label: '📅 Asistencia', icon: 'calendar' },
        { id: 'nomina', label: '💰 Nómina', icon: 'credit-card' },
        { id: 'documentos', label: '📁 Doctos', icon: 'file-text' }
    ];

    return `<div class="modal-overlay" data-profile-action="close-overlay">
                <div class="modal-content profile-modal" style="max-width: 700px; padding: 0; overflow: hidden; border-radius: 16px;">
                    <!-- Cabecera Premium: Jerarquía Visual Refinada -->
                    <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 32px 24px; position: relative; border-bottom: 1px solid #334155;">
                        <button class="modal-close" type="button" data-profile-action="close-employee-profile" aria-label="Cerrar perfil" style="top: 20px; right: 20px; color: #94a3b8; font-size: 1.2rem; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.color='#f1f5f9'" onmouseout="this.style.color='#94a3b8'">✕</button>
                        
                        <div style="display: flex; align-items: center; gap: 24px;">
                            <!-- Avatar Dinámico -->
                            <div style="width: 90px; height: 90px; background: ${emp.positions?.length > 0 ? (state.positions.find(p => p.id === emp.positions[0])?.color || '#06b6d4') : '#06b6d4'}; border-radius: 24px; display: flex; align-items: center; justify-content: center; font-size: 2.2rem; font-weight: 800; color: white; box-shadow: 0 10px 20px rgba(0,0,0,0.4); border: 2px solid rgba(255,255,255,0.1); flex-shrink: 0;">
                                ${emp.name.charAt(0)}
                            </div>
                            
                            <div style="flex-grow: 1;">
                                <!-- Jerarquía de Títulos Reforzada -->
                                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                                    <span style="font-size: 0.75rem; color: #06b6d4; font-weight: 900; text-transform: uppercase; letter-spacing: 0.12em; background: rgba(6, 182, 212, 0.2); padding: 5px 12px; border-radius: 6px; border: 1px solid rgba(6, 182, 212, 0.4); display: inline-block;">
                                        Perfil de Empleado
                                    </span>
                                    <span style="background: rgba(148, 163, 184, 0.2); color: #f1f5f9; padding: 5px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 800; border: 1px solid rgba(148, 163, 184, 0.4);">
                                        #${emp.number}
                                    </span>
                                </div>
                                <h2 style="font-size: 1.8rem; font-weight: 900; color: #f1f5f9; margin: 0; line-height: 1.2; letter-spacing: -0.02em; display: flex; align-items: center; gap: 10px;">
                                    <span style="font-size: 1.6rem;">👤</span> ${emp.name}
                                </h2>
                                
                                <div style="display: flex; align-items: center; gap: 15px; margin-top: 10px;">
                                    <span style="color: ${emp.active ? '#10b981' : '#ef4444'}; font-size: 0.85rem; font-weight: 600; display: flex; align-items: center; gap: 6px;">
                                        <span style="width: 8px; height: 8px; background: currentColor; border-radius: 50%; display: inline-block;"></span>
                                        ${emp.active ? 'Activo' : 'Inactivo'}
                                    </span>
                                    <span style="color: #64748b; font-size: 0.85rem; font-weight: 500; display: flex; align-items: center; gap: 6px;">
                                        ${icons.get('layers', { size: 14 })}
                                        ${emp.positions?.length || 0} Posiciones
                                    </span>
                                </div>
                            </div>

                            <button class="btn btn-secondary" type="button" data-profile-action="open-employee-form" data-id="${emp.id}" style="align-self: center; padding: 10px 18px; font-size: 0.85rem; background: #1e293b; border: 1px solid #334155; border-radius: 10px; color: #f1f5f9; font-weight: 600; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 8px;" onmouseover="this.style.background='#334155'" onmouseout="this.style.background='#1e293b'">
                                ${icons.get('edit', { size: 16 })} Editar
                            </button>
                        </div>
                    </div>

                    <!-- Navegación de Tabs -->
                    <div class="profile-tabs-container">
                        ${tabs.map(tab => `
                            <div role="button" tabindex="0" data-profile-action="change-profile-tab" data-value="${tab.id}"
                                 class="profile-tab"
                                 style="color: ${state.employeeProfile.activeTab === tab.id ? '#06b6d4' : '#64748b'}; border-bottom: 3px solid ${state.employeeProfile.activeTab === tab.id ? '#06b6d4' : 'transparent'};">
                                ${icons.get(tab.icon, { size: 16 })}
                                ${tab.label}
                            </div>
                        `).join('')}
                    </div>

                    <!-- Contenido de Tab -->
                    <div class="modal-body profile-body" style="background: #0f172a; max-height: 500px; overflow-y: auto; padding: 24px;">
                        ${renderProfileTab(state.employeeProfile.activeTab, emp)}
                    </div>
                </div>
            </div>`;
}

function renderProfileTab(tabId, emp) {
    switch (tabId) {
        case 'resumen': return ProfileTabResumen(emp);
        case 'asistencia': return ProfileTabAsistencia(emp);
        case 'nomina': return ProfileTabNomina(emp);
        case 'documentos': return ProfileTabDocumentos(emp);
        default: return ProfileTabResumen(emp);
    }
}

/**
 * 💰 TAB: Nómina y Pagos
 */
function ProfileTabNomina(emp) {
    const payData = payrollService.calculateEmployeePayroll(
        emp.id, 
        state.employeeProfile.periodStart, 
        state.employeeProfile.periodEnd
    );
        
    const byPosition = payData.breakdown || [];
    
    let totalRegHours = 0;
    let totalExtHours = 0;
    
    byPosition.forEach(pos => {
        totalRegHours += pos.regularHours || 0;
        totalExtHours += pos.overtimeHours || 0;
    });
    
    const totalDays = byPosition.reduce((sum, pos) => sum + (pos.days || 0), 0);

    return `<div style="display: flex; flex-direction: column; gap: 24px;">
                <!-- 🛠️ CONFIGURACIÓN DE AJUSTES (Deducciones, Bonos, Adelantos) -->
                <div class="payroll-config-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                    <div id="deductions-section">
                        <!-- Renderizado por app.js -->
                    </div>
                    <div id="bonuses-section">
                        <!-- Renderizado por app.js -->
                    </div>
                </div>

                <!-- SECCIÓN DE ADELANTOS (Ancho completo) -->
                <div id="advances-section">
                    <!-- Renderizado por app.js -->
                </div>

                <div style="border-top: 1px solid #334155; margin: 10px 0;"></div>

                <!-- 📅 SELECTOR DE PERÍODO -->
                <div style="background: #1e293b; padding: 20px; border-radius: 12px; border: 1px solid #334155;">
                    <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 700; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 8px;">
                        ${icons.get('calendar', { size: 14 })} PERÍODO DE CÁLCULO
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 12px;">
                        <div style="position: relative;">
                            <button type="button" data-profile-action="toggle-profile-start-picker" class="date-selector-btn" style="width: 100%;">
                                ${formatDateShort(state.employeeProfile.periodStart)}
                            </button>
                            ${state.employeeProfile.showStartPicker ? ProfileStartDatePicker() : ''}
                        </div>
                        <div style="color: #475569;">➜</div>
                        <div style="position: relative;">
                            <button type="button" data-profile-action="toggle-profile-end-picker" class="date-selector-btn" style="width: 100%;">
                                ${formatDateShort(state.employeeProfile.periodEnd)}
                            </button>
                            ${state.employeeProfile.showEndPicker ? ProfileEndDatePicker() : ''}
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                        <button type="button" data-profile-action="set-profile-period" data-value="payPeriod" class="period-chip" style="background: rgba(6, 182, 212, 0.1); border-color: rgba(6, 182, 212, 0.4); color: #06b6d4; font-weight: 700;">Período Actual</button>
                        <button type="button" data-profile-action="set-profile-period" data-value="thisMonth" class="period-chip">Este Mes</button>
                        <button type="button" data-profile-action="set-profile-period" data-value="lastMonth" class="period-chip">Mes Anterior</button>
                    </div>
                </div>

                <!-- 📊 RESUMEN DE CRONOS -->
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px;">
                    <div style="background: #1e293b; padding: 16px; border-radius: 12px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">Días</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">${totalDays}</div>
                    </div>
                    <div style="background: #1e293b; padding: 16px; border-radius: 12px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">Hrs Reg</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">${totalRegHours}h</div>
                    </div>
                    <div style="background: #1e293b; padding: 16px; border-radius: 12px; border: 1px solid #334155; text-align: center;">
                        <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 600; text-transform: uppercase;">Hrs Ext</div>
                        <div style="font-size: 1.25rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">${totalExtHours}h</div>
                    </div>
                </div>

                <!-- 💰 RESUMEN FINANCIERO (TARJETAS) -->
                <div class="earnings-summary-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px;">
                    <div class="earnings-summary-card profile-gross-card" style="background: rgba(241, 245, 249, 0.05); border-left: 4px solid #f1f5f9; padding: 16px; border-radius: 10px;">
                        <div style="font-size: 0.7rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Bruto</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">${formatCurrency(payData.brutoOriginal || 0)}</div>
                    </div>
                    <div class="earnings-summary-card profile-bonus-card" style="background: rgba(16, 185, 129, 0.05); border-left: 4px solid #10b981; padding: 16px; border-radius: 10px;">
                        <div style="font-size: 0.7rem; color: #10b981; font-weight: 700; text-transform: uppercase;">Bonos (+)</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">+${formatCurrency(payData.bonuses || 0)}</div>
                    </div>
                    <div class="earnings-summary-card profile-deduction-card" style="background: rgba(244, 63, 94, 0.05); border-left: 4px solid #f43f5e; padding: 16px; border-radius: 10px;">
                        <div style="font-size: 0.7rem; color: #f43f5e; font-weight: 700; text-transform: uppercase;">Deducc (-)</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">-${formatCurrency(payData.deductions || 0)}</div>
                    </div>
                    <div class="earnings-summary-card profile-advance-card" style="background: rgba(245, 158, 11, 0.05); border-left: 4px solid #f59e0b; padding: 16px; border-radius: 10px;">
                        <div style="font-size: 0.7rem; color: #f59e0b; font-weight: 700; text-transform: uppercase;">Adelantos (-)</div>
                        <div style="font-size: 1.1rem; font-weight: 800; color: #f1f5f9; margin-top: 4px;">-${formatCurrency(payData.advances || 0)}</div>
                    </div>
                </div>

                <!-- 💎 NETO A PAGAR -->
                <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px; border-radius: 16px; border: 1px solid #334155; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.3);">
                    <div style="font-size: 0.8rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 8px;">NETO A PAGAR</div>
                    <div style="font-size: 2.2rem; font-weight: 950; color: #10b981;">${formatCurrency(payData.neto)}</div>
                    <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">Bruto: ${formatCurrency(payData.brutoOriginal)} + Bonos: ${formatCurrency(payData.bonuses)}</div>
                </div>

                <!-- 📜 DESGLOSE POR POSICIÓN -->
                <div style="background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden;">
                    <div role="button" tabindex="0" data-profile-action="toggle-position-breakdown" style="padding: 16px 20px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: rgba(255,255,255,0.02);">
                        <div style="font-size: 0.8rem; font-weight: 800; color: #06b6d4; display: flex; align-items: center; gap: 10px; text-transform: uppercase;">
                            ${icons.get('layers', { size: 16 })} Desglose por Posición
                        </div>
                        <span style="color: #475569;">${state.employeeProfile.showPositionBreakdown ? '▲' : '▼'}</span>
                    </div>
                    
                    ${state.employeeProfile.showPositionBreakdown ? `
                        <div style="padding: 20px; border-top: 1px solid #334155; display: flex; flex-direction: column; gap: 16px;">
                            ${byPosition.map(pos => `
                                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                    <div>
                                        <div style="font-weight: 700; color: #f1f5f9; font-size: 0.9rem;">${pos.name || pos.positionName}</div>
                                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 4px; display: flex; gap: 10px;">
                                            <span>⏱️ ${pos.regularHours || 0}h</span>
                                            <span>⚡ ${pos.overtimeHours || 0}h</span>
                                            ${pos.holidayHours > 0 ? `<span>☀️ ${pos.holidayHours}h Fest</span>` : ''}
                                        </div>
                                    </div>
                                    <div style="text-align: right;">
                                        <div style="font-weight: 800; color: #f1f5f9; font-size: 1rem;">${formatCurrency(pos.subtotal)}</div>
                                        <div style="font-size: 0.7rem; color: #06b6d4;">${formatCurrency(pos.hourlyRate)}/h</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>

                <!-- 🛠️ AJUSTES DE PAGO -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                    <div id="deductions-section" style="background: rgba(244, 63, 94, 0.03); padding: 20px; border-radius: 12px; border: 1px dashed rgba(244, 63, 94, 0.2);"></div>
                    <div id="bonuses-section" style="background: rgba(16, 185, 129, 0.03); padding: 20px; border-radius: 12px; border: 1px dashed rgba(16, 185, 129, 0.2);"></div>
                </div>

                <!-- 🏦 ADELANTOS Y PRÉSTAMOS -->
                <div id="advances-section"></div>

                <button type="button" data-profile-action="mark-as-paid" data-emp-id="${emp.id}" data-neto="${payData.neto}"
                        style="background: #06b6d4; color: #0f172a; border: none; border-radius: 14px; padding: 18px; font-weight: 900; font-size: 1rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 15px rgba(6,182,212,0.3); display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 10px; width: 100%;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 25px rgba(6,182,212,0.4)'"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 15px rgba(6,182,212,0.3)'">
                    ${icons.get('check-circle', { size: 20 })} REGISTRAR PAGO Y CERRAR PERÍODO
                </button>
            </div>`;
}
function ProfileStartDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.startPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodStart;
    const payPeriod = state.settings?.payPeriod;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-profile-action="change-profile-start-month" data-value="-1" aria-label="Mes anterior">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.startPickerMonth)}</div>
                    <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-profile-action="change-profile-start-month" data-value="1" aria-label="Mes siguiente">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
                        const dKey = getDateKey(date);
                        const isInPayPeriod = isDateInPayPeriod(dKey, payPeriod);
                        const isWorkPayday = isPayday(dKey, payPeriod);
                        
                        let cls = ['date-picker-day'];
                        if (!currentMonth) cls.push('other-month');
                        if (dKey === today) cls.push('today');
                        if (dKey === selected) cls.push('selected');
                        if (isInPayPeriod) cls.push('date-picker-day-pay-period');
                        if (isWorkPayday) cls.push('date-picker-day-payday');

                        const paydayIconHTML = isWorkPayday ? `<span class="payday-icon" title="Día de Pago" style="position: absolute; top: -2px; right: -2px; font-size: 0.55rem;">💰</span>` : '';
                        const inlineStyle = isInPayPeriod ? `background: rgba(6, 182, 212, 0.25) !important; border-color: #06b6d4 !important;` : '';

                        return `<div role="button" tabindex="0" class="${cls.join(' ')}" data-profile-action="select-profile-start-date" data-value="${dKey}">
                                    ${date.getDate()}
                                    ${isWorkPayday ? `<span class="payday-icon">💰</span>` : ''}
                                </div>`;
                    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button type="button" data-profile-action="close-start-picker"
                            style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                        Cerrar
                    </button>
                </div>
            </div>`;
}

function ProfileEndDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.endPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodEnd;
    const payPeriod = state.settings?.payPeriod;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-profile-action="change-profile-end-month" data-value="-1" aria-label="Mes anterior">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.endPickerMonth)}</div>
                    <button type="button" class="date-btn" style="width:32px;height:32px;font-size:1rem;" data-profile-action="change-profile-end-month" data-value="1" aria-label="Mes siguiente">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
                        const dKey = getDateKey(date);
                        const isInPayPeriod = isDateInPayPeriod(dKey, payPeriod);
                        const isWorkPayday = isPayday(dKey, payPeriod);
                
                        let cls = ['date-picker-day'];
                        if (!currentMonth) cls.push('other-month');
                        if (dKey === today) cls.push('today');
                        if (dKey === selected) cls.push('selected');
                        if (isInPayPeriod) cls.push('date-picker-day-pay-period');
                        if (isWorkPayday) cls.push('date-picker-day-payday');

                        const paydayIconHTML = isWorkPayday ? `<span class="payday-icon" title="Día de Pago" style="position: absolute; top: -2px; right: -2px; font-size: 0.55rem;">💰</span>` : '';
                        const inlineStyle = isInPayPeriod ? `background: rgba(6, 182, 212, 0.25) !important; border-color: #06b6d4 !important;` : '';

                        return `<div role="button" tabindex="0" class="${cls.join(' ')}" data-profile-action="select-profile-end-date" data-value="${dKey}">
                                    ${date.getDate()}
                                    ${isWorkPayday ? `<span class="payday-icon">💰</span>` : ''}
                                </div>`;
                    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button type="button" data-profile-action="close-end-picker"
                            style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                        Cerrar
                    </button>
                </div>
            </div>`;
}

// 💰 Se delega a PayrollService.calculateMonthlyEstimate

function ProfileHireDatePicker(emp) {
    if (!state.profileHireDatePickerMonth) {
        state.profileHireDatePickerMonth = new Date(emp.hireDate + 'T00:00:00');
    }

    const days = getDaysInMonth(state.profileHireDatePickerMonth);
    const monthName = state.profileHireDatePickerMonth.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

    return `<div style="position:relative; margin-top:8px;">
                <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; position:absolute; z-index:100; width:280px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <button type="button" data-profile-action="change-profile-hire-date-month" data-value="-1" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;" aria-label="Mes anterior">◀</button>
                        <span style="font-size:0.75rem; color:#f1f5f9; font-weight:600; text-transform:capitalize;">${monthName}</span>
                        <button type="button" data-profile-action="change-profile-hire-date-month" data-value="1" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;" aria-label="Mes siguiente">▶</button>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px;">
                        ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const isSelected = dKey === emp.hireDate;
        return `<div role="button" tabindex="0" data-profile-action="select-profile-hire-date" data-emp-id="${emp.id}" data-date="${dKey}"
                                         style="padding:6px; text-align:center; cursor:pointer; border-radius:4px; font-size:0.7rem; transition:all 0.15s; ${isSelected ? 'background:#06b6d4; color:#000; font-weight:700;' : currentMonth ? 'color:#94a3b8; hover:background:rgba(6,182,212,0.1);' : 'color:#4b5563; opacity:0.4;'}">
                                ${date.getDate()}
                            </div>`;
    }).join('')}
                    </div>
                </div>
            </div>`;
}

function ProfileTabResumen(emp) {
    const positions = emp.positions.map(posId => {
        const pos = state.positions.find(p => p.id === posId);
        return pos ? pos.name : posId;
    }).join(', ');

    const hireDate = emp.hireDate ? new Date(emp.hireDate + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'No registrada';
    const lastPayment = emp.lastPaymentDate ? new Date(emp.lastPaymentDate + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'long', day: 'numeric' }) : 'Ninguno';
    
    // ⚡ NUEVO: Usar servicio central con alta resolución (52/12)
    const monthlyEst = payrollService.calculateMonthlyEstimate(emp);

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        🎯 POSICIONES ACTUALES
                    </div>
                    <div style="font-size: 1rem; color: #f1f5f9; font-weight: 600;">
                        ${positions}
                    </div>
                </div>

                <div style="background: linear-gradient(135deg, rgba(16,185,129,0.1), rgba(6,182,212,0.1)); padding: 18px; border-radius: 8px; border: 1px solid rgba(16,185,129,0.3);">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #10b981; margin-bottom: 10px;">
                        💰 SALARIO MENSUAL ESTIMADO
                    </div>
                    <div style="font-size: 1.8rem; font-weight: 900; color: #10b981; margin-bottom: 10px;">
                        ${formatCurrency(monthlyEst.total)}
                    </div>
                    <div style="font-size: 0.72rem; color: #8fa3c3; line-height: 1.6;">
                        ${monthlyEst.breakdown.map(b =>
        `<div style="margin-bottom:3px;">• ${b.position}: ${b.daysPerWeek} días/sem → ${formatCurrency(b.monthly)}</div>`
    ).join('')}
                    </div>
                    <div style="font-size: 0.68rem; color: #64748b; margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(100,116,139,0.2);">
                        📊 Basado en ${state.settings.regularHoursPerDay}h/día × (52/12) semanas/mes
                    </div>
                </div>
                
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📋 INFORMACIÓN BÁSICA
                    </div>
                    <div style="display: grid; gap: 10px; font-size: 0.875rem;">
                        <div><span style="color: #94a3b8;">Número:</span> <span style="color: #f1f5f9; font-weight: 600;">#${emp.number}</span></div>
                        <div style="display:flex; align-items:center; justify-content:space-between;">
                            <span style="color: #94a3b8;">Contratado:</span> 
                            <span style="color: #f1f5f9; font-weight: 600; cursor:pointer; padding:4px 10px; border-radius:6px; background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.2); transition:all 0.2s;" 
                                  role="button" tabindex="0" data-profile-action="toggle-profile-hire-date-picker"
                                  onmouseover="this.style.background='rgba(6,182,212,0.15)'; this.style.borderColor='rgba(6,182,212,0.3)';"
                                  onmouseout="this.style.background='rgba(6,182,212,0.1)'; this.style.borderColor='rgba(6,182,212,0.2)';">
                                ${hireDate} 📅
                            </span>
                        </div>
                        ${state.showProfileHireDatePicker ? ProfileHireDatePicker(emp) : ''}
                        ${emp.phone ? `<div><span style="color: #94a3b8;">Teléfono:</span> <span style="color: #f1f5f9; font-weight: 600;">${emp.phone}</span></div>` : ''}
                        ${emp.email ? `<div><span style="color: #94a3b8;">Email:</span> <span style="color: #f1f5f9; font-weight: 600;">${emp.email}</span></div>` : ''}
                        <div><span style="color: #94a3b8;">Último pago:</span> <span style="color: #f1f5f9; font-weight: 600;">${lastPayment}</span></div>
                    </div>
                </div>
                
                ${emp.notes ? `<div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📝 NOTAS
                    </div>
                    <div style="font-size: 0.875rem; color: #f1f5f9; white-space: pre-wrap;">
                        ${emp.notes}
                    </div>
                </div>` : ''}
            </div>`;
}

/**
 * 📅 PESTAÑA: Asistencia (Calendario)
 */
function ProfileTabAsistencia(emp) {
    return `
        <div class="profile-tab-content">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
                <h3 style="margin: 0; color: #f1f5f9; font-size: 1.1rem; display: flex; align-items: center; gap: 10px;">
                    ${icons.get('calendar', { size: 20, color: '#06b6d4' })}
                    Historial de Asistencia
                </h3>
            </div>

            <div class="profile-calendar-wrapper" style="background: rgba(15, 23, 42, 0.4); padding: 24px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.05);">
                ${CalendarView({ 
                    employee: emp, 
                    month: state.employeeProfile.assistanceMonth || new Date(), 
                    navAction: 'window.changeProfileAsistenciaMonth',
                    showLegend: true 
                })}
            </div>
        </div>
    `;
}

function ProfileTabDocumentos(emp) {
    const paymentHistory = emp.paymentHistory || [];

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                ${emp.notes ? `<div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📝 NOTAS Y OBSERVACIONES
                    </div>
                    <div style="font-size: 0.875rem; color: #f1f5f9; white-space: pre-wrap;">
                        ${emp.notes}
                    </div>
                </div>` : ''}
                
                <div style="background: #1e293b; padding: 16px; border-radius: 8px; border: 1px solid #334155;">
                    <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; margin-bottom: 12px;">
                        📜 HISTORIAL DE PAGOS
                    </div>
                    ${paymentHistory.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${paymentHistory.slice().reverse().slice(0, 10).map(p => {
        const date = new Date(p.date + 'T00:00:00').toLocaleDateString('es-DO', { year: 'numeric', month: 'short', day: 'numeric' });
        return `<div style="background: #0f172a; padding: 10px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                                    <div>
                                        <div style="font-size: 0.875rem; color: #f1f5f9; font-weight: 600;">${formatCurrency(p.amount)}</div>
                                        <div style="font-size: 0.7rem; color: #94a3b8;">${date}</div>
                                    </div>
                                    <div style="font-size: 0.7rem; color: #64748b;">${p.period}</div>
                                </div>`;
    }).join('')}
                        </div>
                    ` : `<div style="text-align: center; padding: 20px; color: #64748b; font-size: 0.875rem;">
                        No hay pagos registrados
                    </div>`}
                </div>
            </div>`;
}
