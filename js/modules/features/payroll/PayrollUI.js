import { icons } from '../../ui/IconSystem.js';

import { formatCurrency } from '../../utils/Formatters.js';
import { getDateKey, formatDateShort } from '../../utils/DateUtils.js';

let context = null;
let payrollService = null;

export function init(ctx) {
    context = ctx;
    // Fix: Access payrollService from ctx.services.payroll
    payrollService = ctx.services.payroll;
}

function getState() {
    return context.state;
}

export function PayrollTab() {
    const state = getState();
    // Initialize if empty (logic from ExportTab)
    if (!state.exportConfig.periodStart || !state.exportConfig.periodEnd) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        state.exportConfig.periodStart = getDateKey(start);
        state.exportConfig.periodEnd = getDateKey(today);
        state.exportConfig.activePreset = 'thisMonth';
    }

    const exportData = generateExportData();
    const totalAmount = exportData.reduce((sum, item) => sum + item.monto, 0);

    return `
        <div style="max-width: 1000px; margin: 0 auto; padding: 20px;">
            <!-- Header -->
            <div style="margin-bottom: 32px;">
                <h2 style="margin: 0 0 8px 0; font-size: 1.75rem; display: flex; align-items: center; gap: 12px;">
                    <span>${icons.get('edit')}</span>
                    <span class="gradient-text">Nómina</span>
                </h2>
                <p style="margin: 0; color: #94a3b8; font-size: 0.875rem;">
                    Genera archivo JSON con la nómina de empleados para importar en tu sistema de pagos
                </p>
            </div>
            
            <!-- Paso 1: Período -->
            <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                    \ Paso 1: Período de Pago
                </h3>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 16px;">
                    <div class="form-group">
                        <label class="form-label">Desde:</label>
                        <input type="date" 
                               value="${state.exportConfig.periodStart}" 
                               onchange="PayrollUI.updateExportPeriod('start', this.value)"
                               class="form-input">
                    </div>
                    <div class="form-group">
                        <label class="form-label">Hasta:</label>
                        <input type="date" 
                               value="${state.exportConfig.periodEnd}" 
                               onchange="PayrollUI.updateExportPeriod('end', this.value)"
                               class="form-input">
                    </div>
                </div>
                
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <button onclick="PayrollUI.setExportPreset('thisMonth')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'thisMonth' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'thisMonth' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'thisMonth' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        \ Este mes
                    </button>
                    <button onclick="PayrollUI.setExportPreset('lastMonth')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'lastMonth' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        \ Mes anterior
                    </button>
                    <button onclick="PayrollUI.setExportPreset('last15')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'last15' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'last15' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'last15' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        \ Últimos 15 días
                    </button>
                    <button onclick="PayrollUI.setExportPreset('sinceLastPay')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'sinceLastPay' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : 'transparent'}; border: 1px solid ${state.exportConfig.activePreset === 'sinceLastPay' ? 'transparent' : '#f59e0b'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'sinceLastPay' ? '#000' : '#f59e0b'}; cursor: pointer; font-size: 0.75rem; font-weight: 700;">
                        \ Desde Último Pago + 1
                    </button>
                </div>
            </div>
            
            <!-- Paso 2: Deducciones Globales -->
            <div id="export-deductions-section" style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ${icons.get('payroll')} Paso 2: Deducciones Globales
                    </h3>
                    <button onclick="PayrollUI.addExportDeduction()" 
                            style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.transform='scale(1.05)'"
                            onmouseout="this.style.transform='scale(1)'">
                        +
                    </button>
                </div>
                
                <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    \ Estas deducciones se aplicarán a todos los empleados de forma encadenada
                </div>
                
                ${generateExportDeductionsHTML()}
            </div>
            
            <!-- Paso 3: Vista Previa -->
            <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                    \ Paso 3: Vista Previa (${exportData.length} empleados)
                </h3>
                
                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #0f172a; border-bottom: 2px solid #334155;">
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">REF</th>
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">NOMBRE</th>
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">POSICIÓN</th>
                                <th style="padding: 12px; text-align: right; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">BRUTO</th>
                                <th style="padding: 12px; text-align: right; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">DEDUCC.</th>
                                <th style="padding: 12px; text-align: right; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">NETO</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${exportData.map((emp, idx) => `
                                <tr style="border-bottom: 1px solid #334155; ${idx % 2 === 0 ? 'background: #0f172a;' : ''}">
                                    <td style="padding: 12px; color: #06b6d4; font-weight: 600; font-family: monospace;">#${emp.id}</td>
                                    <td style="padding: 12px; color: #f1f5f9; font-weight: 600;">${emp._employeeName}</td>
                                    <td style="padding: 12px; color: #94a3b8; font-size: 0.875rem;">${emp._employeePosition}</td>
                                    <td style="padding: 12px; text-align: right; color: #10b981;">${formatCurrency(emp._bruto)}</td>
                                    <td style="padding: 12px; text-align: right; color: #ec4899;">-${formatCurrency(emp._deductions)}</td>
                                    <td style="padding: 12px; text-align: right; color: #06b6d4; font-weight: 700; font-size: 1rem;">${formatCurrency(emp.monto)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="background: linear-gradient(135deg, #10b981, #06b6d4); border-top: 2px solid #06b6d4;">
                                <td colspan="5" style="padding: 16px; color: #000; font-weight: 700; font-size: 1.125rem;">TOTAL NÓMINA:</td>
                                <td style="padding: 16px; text-align: right; color: #000; font-weight: 900; font-size: 1.25rem;">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            
            <!-- Paso 4: Exportar -->
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button onclick="PayrollUI.copyExportJSON()" 
                        style="flex: 1; min-width: 200px; padding: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 8px; color: #000; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 16px rgba(6, 182, 212, 0.3)'"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                    \ Copiar JSON al Portapapeles
                </button>
                <button onclick="PayrollUI.downloadExportJSON()" 
                        style="flex: 1; min-width: 200px; padding: 16px; background: #1e293b; border: 2px solid #06b6d4; border-radius: 8px; color: #06b6d4; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(6, 182, 212, 0.1)'"
                        onmouseout="this.style.background='#1e293b'">
                    \ Descargar Archivo .json
                </button>
            </div>
        </div>
    `;
}

function generateExportData() {
    const state = getState();
    const { periodStart, periodEnd, deductions } = state.exportConfig;
    if (!periodStart || !periodEnd) return [];

    // We need state.employees and state.positions, assumed in context.state
    const activeEmployees = state.employees.filter(emp => emp.active !== false);

    return activeEmployees.map(emp => {
        const payroll = payrollService.calculateEmployeePayroll(emp.id, periodStart, periodEnd, deductions);
        const positionIds = (emp.positions && emp.positions.length > 0)
            ? emp.positions
            : (emp.position ? [emp.position] : []);
        const positionNames = positionIds
            .map(posId => state.positions.find(p => p.id === posId)?.name)
            .filter(Boolean);
        return {
            id: parseInt(emp.number) || 0,
            nombre: `${emp.name} (Ref #${emp.number})`,
            monto: parseFloat(payroll.neto.toFixed(2)),
            _bruto: payroll.bruto,
            _deductions: payroll.deductions,
            _employeeName: emp.name,
            _employeePosition: positionNames.length > 0 ? positionNames.join(', ') : 'Sin posicion'
        };
    }).filter(emp => emp.monto > 0);
}

function generateExportDeductionsHTML() {
    const state = getState();
    const deductions = state.exportConfig.deductions || [];
    if (deductions.length === 0) return '<div style="text-align: center; color: #64748b; padding: 20px;">No hay deducciones configuradas</div>';

    return deductions.map((ded, index) => `
        <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 12px;">
            <div style="display: flex; gap: 12px; align-items: start;">
                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportDeductionType_${index}" value="fixed" ${ded.type === 'fixed' ? 'checked' : ''} onchange="PayrollUI.updateExportDeductionType(${index}, 'fixed')" style="accent-color: #06b6d4;">
                        <span style="color: #f1f5f9;">Monto</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportDeductionType_${index}" value="percentage" ${ded.type === 'percentage' ? 'checked' : ''} onchange="PayrollUI.updateExportDeductionType(${index}, 'percentage')" style="accent-color: #06b6d4;">
                        <span style="color: #f1f5f9;">Porcentaje%</span>
                    </label>
                </div>
                <div style="flex: 1;">
                    <input type="number" class="form-input" value="${ded.value.toFixed(2)}" onchange="PayrollUI.updateExportDeductionValue(${index}, this.value)" placeholder="0.00" min="0" step="${ded.type === 'fixed' ? '0.01' : '0.1'}" style="width: 100%; font-size: 0.875rem; padding: 8px; margin-bottom: 8px;">
                    <input type="text" class="form-input" value="${ded.name || ''}" onchange="PayrollUI.updateExportDeductionName(${index}, this.value)" placeholder="Nombre (ej: AFP, SFS...)" style="width: 100%; font-size: 0.75rem; padding: 6px;">
                </div>
                ${deductions.length > 1 ? `<button onclick="PayrollUI.removeExportDeduction(${index})" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">${icons.get('edit')}</button>` : ''}
            </div>
        </div>
    `).join('');
}

// ============================================
// EXPORTED GLOBAL HANDLERS
// ============================================

export function addExportDeduction() {
    const state = getState();
    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];
    state.exportConfig.deductions.push({ type: 'percentage', value: 0, name: '' });
    context.render();
}

export function removeExportDeduction(index) {
    const state = getState();
    state.exportConfig.deductions.splice(index, 1);
    context.render();
}

export function updateExportDeductionType(index, type) {
    getState().exportConfig.deductions[index].type = type;
    context.render();
}

export function updateExportDeductionValue(index, value) {
    getState().exportConfig.deductions[index].value = parseFloat(value) || 0;
    context.render(); // Re-render to update preview
}

export function updateExportDeductionName(index, value) {
    getState().exportConfig.deductions[index].name = value;
    // No explicit render needed if just updating name text input, but to be safe and consistent:
    // Actually input loses focus on render, so maybe we shouldn't render?
    // In app.js it was `onchange`, so it's fine.
    // context.render(); 
}

export function updateExportPeriod(type, value) {
    const state = getState();
    if (type === 'start') state.exportConfig.periodStart = value;
    if (type === 'end') state.exportConfig.periodEnd = value;
    state.exportConfig.activePreset = null; // Clear preset
    context.render();
}

export function setExportPreset(preset) {
    const state = getState();
    const today = new Date();
    let start, end = today;

    if (preset === 'thisMonth') {
        start = new Date(today.getFullYear(), today.getMonth(), 1);
    } else if (preset === 'lastMonth') {
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0);
    } else if (preset === 'last15') {
        start = new Date();
        start.setDate(today.getDate() - 15);
    } else if (preset === 'sinceLastPay') {
        // Logic for last payment date + 1
        const lastPay = state.settings.globalLastPaymentDate ? new Date(state.settings.globalLastPaymentDate) : null;
        if (lastPay) {
            start = new Date(lastPay);
            start.setDate(start.getDate() + 1);
        } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1); // Fallback
        }
    }

    state.exportConfig.periodStart = getDateKey(start);
    state.exportConfig.periodEnd = getDateKey(end);
    state.exportConfig.activePreset = preset;
    context.render();
}

export function copyExportJSON() {
    const data = generateExportData();
    const json = JSON.stringify(data, null, 2);
    navigator.clipboard.writeText(json).then(() => {
        if (window.showNotification) window.showNotification(`${icons.get('info')} JSON copiado al portapapeles`, 'success');
    });
}

export function downloadExportJSON() {
    const data = generateExportData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `nomina_${getDateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
    if (window.showNotification) window.showNotification(`${icons.get('info')} Archivo JSON descargado`, 'success');
}
