/**
 * 👤 EmployeeProfileModal.js - Modal de Perfil de Empleado
 * Parte de la Fase 4: Modularización y Componentización
 */

import { state } from '../../core/AppState.js';
import { payrollService } from '../../services/index.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { getDateKey, getDaysInMonth, formatMonthYear, formatDateShort } from '../../utils/DateUtils.js';
import icons from '../IconSystem.js';

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

    return `<div class="modal-overlay" onclick="if(event.target === this) closeEmployeeProfile()">
                <div class="modal-content profile-modal" style="max-width: 700px; padding: 0; overflow: hidden; border-radius: 16px;">
                    <!-- Cabecera Premium -->
                    <div style="background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px; position: relative; border-bottom: 1px solid #334155;">
                        <button class="modal-close" onclick="closeEmployeeProfile()" style="top: 16px; right: 16px; color: #94a3b8;">✕</button>
                        
                        <div style="display: flex; align-items: center; gap: 20px;">
                            <div style="width: 80px; height: 80px; background: ${emp.positions?.length > 0 ? (state.positions.find(p => p.id === emp.positions[0])?.color || '#06b6d4') : '#06b6d4'}; border-radius: 20px; display: flex; align-items: center; justify-content: center; font-size: 2rem; font-weight: 800; color: white; box-shadow: 0 8px 16px rgba(0,0,0,0.3);">
                                ${emp.name.charAt(0)}
                            </div>
                            <div>
                                <h2 style="font-size: 1.5rem; font-weight: 800; color: #f1f5f9; margin-bottom: 4px;">${emp.name}</h2>
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span style="background: rgba(34, 211, 238, 0.1); color: #22d3ee; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 700; border: 1px solid rgba(34, 211, 238, 0.2);">
                                        #${emp.number}
                                    </span>
                                    <span style="color: #94a3b8; font-size: 0.875rem; font-weight: 500;">
                                        ${emp.active ? '🟢 Activo' : '🔴 Inactivo'}
                                    </span>
                                </div>
                            </div>
                            <button class="btn btn-secondary" onclick="openEmployeeForm('${emp.id}')" style="margin-left: auto; padding: 8px 16px; font-size: 0.8rem; background: #334155; border: none;">
                                ✏️ Editar
                            </button>
                        </div>
                    </div>

                    <!-- Navegación de Tabs -->
                    <div style="display: flex; background: #0f172a; padding: 0 10px; border-bottom: 1px solid #334155;">
                        ${tabs.map(tab => `
                            <div onclick="changeProfileTab('${tab.id}')" 
                                 style="padding: 14px 20px; font-size: 0.85rem; font-weight: 600; color: ${state.employeeProfile.activeTab === tab.id ? '#06b6d4' : '#64748b'}; cursor: pointer; border-bottom: 3px solid ${state.employeeProfile.activeTab === tab.id ? '#06b6d4' : 'transparent'}; transition: all 0.2s; display: flex; align-items: center; gap: 8px;">
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
    const periodData = payrollService.calculatePeriod(emp.id, state.employeeProfile.periodStart, state.employeeProfile.periodEnd);
    const summary = periodData.summary;

    return `<div style="display: flex; flex-direction: column; gap: 20px;">
                <!-- Selector de Período Premium -->
                <div style="background: #1e293b; padding: 16px; border-radius: 12px; border: 1px solid #334155;">
                    <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 600; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                        📅 Período de Cálculo
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px;">
                        <div style="position: relative;">
                            <button onclick="toggleProfileStartPicker()" class="date-selector-btn">
                                ${formatDateShort(state.employeeProfile.periodStart)}
                            </button>
                            ${state.employeeProfile.showStartPicker ? ProfileStartDatePicker() : ''}
                        </div>
                        <div style="color: #475569;">➜</div>
                        <div style="position: relative;">
                            <button onclick="toggleProfileEndPicker()" class="date-selector-btn">
                                ${formatDateShort(state.employeeProfile.periodEnd)}
                            </button>
                            ${state.employeeProfile.showEndPicker ? ProfileEndDatePicker() : ''}
                        </div>
                    </div>
                    
                    <div style="display: flex; gap: 6px; margin-top: 12px;">
                        <button onclick="setProfilePeriod('thisMonth')" class="period-chip">Este Mes</button>
                        <button onclick="setProfilePeriod('lastMonth')" class="period-chip">Mes Anterior</button>
                        <button onclick="setProfilePeriod('last15')" class="period-chip">Últimos 15 días</button>
                    </div>
                </div>

                <!-- Resumen de Totales -->
                <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px;">
                    <div style="background: #1e293b; padding: 18px; border-radius: 12px; border: 1px solid #334155; position: relative; overflow: hidden;">
                         <div style="position: absolute; right: -10px; top: -10px; opacity: 0.05; font-size: 4rem;">💰</div>
                         <div style="font-size: 0.75rem; color: #94a3b8; font-weight: 600; margin-bottom: 10px;">TOTAL BRUTO</div>
                         <div style="font-size: 1.5rem; font-weight: 800; color: #f1f5f9;">${formatCurrency(summary.grossTotal)}</div>
                         <div style="font-size: 0.7rem; color: #64748b; margin-top: 4px;">${summary.totalDays} días registrados</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #10b981, #059669); padding: 18px; border-radius: 12px; border: none; color: white;">
                         <div style="font-size: 0.75rem; opacity: 0.8; font-weight: 600; margin-bottom: 10px;">NETO A PAGAR</div>
                         <div style="font-size: 1.5rem; font-weight: 900;">${formatCurrency(summary.netTotal)}</div>
                         <div style="font-size: 0.7rem; opacity: 0.7; margin-top: 4px;">Después de deducciones</div>
                    </div>
                </div>

                <!-- Desglose por Posición -->
                <div style="background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden;">
                    <div onclick="togglePositionBreakdown()" style="padding: 14px 18px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; background: rgba(255,255,255,0.02);">
                        <div style="font-size: 0.875rem; font-weight: 700; color: #06b6d4; display: flex; align-items: center; gap: 8px;">
                            ${icons.get('layers', { size: 16 })} DESGLOSE POR POSICIÓN
                        </div>
                        <span style="color: #64748b; font-size: 0.8rem;">${state.employeeProfile.showPositionBreakdown ? '▼' : '▲'}</span>
                    </div>
                    
                    ${state.employeeProfile.showPositionBreakdown ? `
                        <div style="padding: 18px; border-top: 1px solid #334155;">
                            ${periodData.byPosition.map(pos => `
                                <div style="margin-bottom: 16px; last-child: margin-bottom: 0;">
                                    <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
                                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.875rem;">${pos.name}</span>
                                        <span style="font-weight: 700; color: #f1f5f9; font-size: 0.875rem;">${formatCurrency(pos.subtotal)}</span>
                                    </div>
                                    <div style="display: flex; gap: 12px; font-size: 0.75rem; color: #94a3b8;">
                                        <span>⏱️ ${pos.totalHours}h Reg</span>
                                        <span>⚡ ${pos.totalOvertime}h Ext</span>
                                        <span>☀️ ${pos.totalHoliday}h Fest</span>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>

                <!-- Deducciones Manuales -->
                <div style="background: #1e293b; border-radius: 12px; border: 1px solid #334155; overflow: hidden;">
                    <div style="padding: 14px 18px; background: rgba(255,255,255,0.02); display: flex; justify-content: space-between; align-items: center;">
                        <div style="font-size: 0.875rem; font-weight: 700; color: #f87171; display: flex; align-items: center; gap: 8px;">
                            ${icons.get('minus-circle', { size: 16 })} DEDUCCIONES / PRÉSTAMOS
                        </div>
                        <button onclick="addDeduction()" style="padding: 4px 10px; border-radius: 6px; background: rgba(248,113,113,0.1); border: 1px solid rgba(248,113,113,0.3); color: #f87171; font-size: 0.7rem; font-weight: 700; cursor: pointer;">
                            + Agregar
                        </button>
                    </div>
                    
                    <div style="padding: 18px; border-top: 1px solid #334155;">
                        ${summary.deductions.length > 0 ? summary.deductions.map((ded, index) => `
                            <div style="display: grid; grid-template-columns: 1fr 100px 40px; gap: 10px; margin-bottom: 10px; align-items: center;">
                                <input type="text" value="${ded.type}" onchange="updateDeductionType(${index}, this.value)" 
                                       placeholder="Motivo (ej. Adelanto)" 
                                       style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem;">
                                <input type="number" value="${ded.amount}" onchange="updateDeductionValue(${index}, this.value)" 
                                       style="background: #0f172a; border: 1px solid #334155; color: #f87171; padding: 6px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 700;">
                                <button onclick="removeDeduction(${index})" style="background: none; border: none; color: #475569; cursor: pointer; font-size: 1.2rem;">✕</button>
                            </div>
                        `).join('') : `
                            <div style="text-align: center; color: #64748b; font-size: 0.8rem; padding: 10px;">
                                No hay deducciones registradas
                            </div>
                        `}
                    </div>
                </div>

                <!-- Botón de Pago (Cierre de Período) -->
                <button onclick="markAsPaid('${emp.id}', ${summary.netTotal})" 
                        style="background: #06b6d4; color: #0f172a; border: none; border-radius: 12px; padding: 16px; font-weight: 800; font-size: 1rem; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(6,182,212,0.3); display: flex; align-items: center; justify-content: center; gap: 10px;">
                    ${icons.get('check-circle', { size: 20 })} REGISTRAR PAGO Y CERRAR PERÍODO
                </button>
            </div>`;
}

function ProfileStartDatePicker() {
    const days = getDaysInMonth(state.employeeProfile.startPickerMonth);
    const today = getDateKey(new Date());
    const selected = state.employeeProfile.periodStart;

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileStartMonth(-1)">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.startPickerMonth)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileStartMonth(1)">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        let cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div class="${cls.join(' ')}" onclick="event.stopPropagation(); selectProfileStartDate('${dKey}')">${date.getDate()}</div>`;
    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button onclick="event.stopPropagation(); state.employeeProfile.showStartPicker = false; render();" 
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

    return `<div class="date-picker-popup" style="position: absolute; top: 100%; left: 0; right: 0; z-index: 100; margin-top: 4px;">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileEndMonth(-1)">◀</button>
                    <div class="date-picker-month">${formatMonthYear(state.employeeProfile.endPickerMonth)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); changeProfileEndMonth(1)">▶</button>
                </div>
                <div class="date-picker-grid">
                    ${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        let cls = ['date-picker-day'];
        if (!currentMonth) cls.push('other-month');
        if (dKey === today) cls.push('today');
        if (dKey === selected) cls.push('selected');
        return `<div class="${cls.join(' ')}" onclick="event.stopPropagation(); selectProfileEndDate('${dKey}')">${date.getDate()}</div>`;
    }).join('')}
                </div>
                <div style="padding: 8px; border-top: 1px solid #334155;">
                    <button onclick="event.stopPropagation(); state.employeeProfile.showEndPicker = false; render();" 
                            style="width: 100%; padding: 6px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; color: #94a3b8; font-size: 0.75rem; cursor: pointer;">
                        Cerrar
                    </button>
                </div>
            </div>`;
}

/**
 * 💰 CÁLCULO DE SALARIO MENSUAL ESTIMADO
 */
function calculateMonthlyEstimate(emp) {
    let totalMonthly = 0;
    const breakdown = [];

    emp.positions.forEach(posId => {
        const pos = state.positions.find(p => p.id === posId);
        if (!pos) return;

        // Obtener sueldo (personalizado o estándar)
        const hourlySalary = emp.positionSalaries?.[posId] || pos.baseSalary || 0;

        // Obtener días laborales (personalizados o estándar)
        const workingDays = emp.customWorkingDays?.[posId] || pos.workingDays || [1, 2, 3, 4, 5];

        // Calcular: días/semana * 4.33 semanas/mes * horas/día * $/hora
        const daysPerWeek = workingDays.length;
        const hoursPerDay = state.settings.regularHoursPerDay || 8;
        const monthlyForPosition = daysPerWeek * 4.33 * hoursPerDay * hourlySalary;

        totalMonthly += monthlyForPosition;
        breakdown.push({
            position: pos.name,
            daysPerWeek: daysPerWeek,
            monthly: monthlyForPosition
        });
    });

    return { total: totalMonthly, breakdown };
}

function ProfileHireDatePicker(emp) {
    if (!state.profileHireDatePickerMonth) {
        state.profileHireDatePickerMonth = new Date(emp.hireDate + 'T00:00:00');
    }

    const days = getDaysInMonth(state.profileHireDatePickerMonth);
    const monthName = state.profileHireDatePickerMonth.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' });

    return `<div style="position:relative; margin-top:8px;">
                <div style="background:#0f172a; border:1px solid #334155; border-radius:8px; padding:12px; position:absolute; z-index:100; width:280px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                        <button onclick="changeProfileHireDateMonth(-1)" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;">◀</button>
                        <span style="font-size:0.75rem; color:#f1f5f9; font-weight:600; text-transform:capitalize;">${monthName}</span>
                        <button onclick="changeProfileHireDateMonth(1)" style="background:none; border:none; color:#06b6d4; cursor:pointer; font-size:1rem; padding:4px 8px;">▶</button>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(7,1fr); gap:2px;">
                        ${days.map(({ date, currentMonth }) => {
        const dKey = getDateKey(date);
        const isSelected = dKey === emp.hireDate;
        return `<div onclick="selectProfileHireDate('${emp.id}', '${dKey}')" 
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

    // Calcular salario mensual estimado
    const monthlyEst = calculateMonthlyEstimate(emp);

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
                        📊 Basado en ${state.settings.regularHoursPerDay}h/día × 4.33 semanas/mes
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
                                  onclick="state.showProfileHireDatePicker = !state.showProfileHireDatePicker; render();"
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

function ProfileTabAsistencia(emp) {
    return `<div style="text-align: center; padding: 40px; color: #94a3b8;">
                <div style="font-size: 3rem; margin-bottom: 16px;">📅</div>
                <div style="font-size: 1.125rem; font-weight: 600; margin-bottom: 8px;">Calendario de Asistencia</div>
                <div style="font-size: 0.875rem;">Próximamente...</div>
            </div>`;
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
                                        <div style="font-size: 0.875rem; color: #f1f5f9; font-weight: 600;">$${Math.round(p.amount).toLocaleString()}</div>
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
