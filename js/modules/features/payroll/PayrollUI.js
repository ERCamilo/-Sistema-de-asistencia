import icons from '../../ui/IconSystem.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { getDateKey, formatDateShort } from '../../utils/DateUtils.js';

let context = null;
let payrollService = null;

export function init(ctx) {
    context = ctx;
    payrollService = ctx.services.payroll;
}

function getState() {
    return context.state;
}

function getEmployeesWithDeductions() {
    const state = getState();
    return state.employees.filter(e => Array.isArray(e.deductions) && e.deductions.length > 0);
}

function getEmployeesWithBonuses() {
    const state = getState();
    return state.employees.filter(e => Array.isArray(e.bonuses) && e.bonuses.length > 0);
}

function getLeaderFilteredEmployees(state) {
    const leaderFilter = state.exportConfig.leaderFilter || 'all';
    const activeEmployees = state.employees.filter(emp => emp.active !== false);
    if (leaderFilter === 'all') return activeEmployees;

    const leaderPositions = new Set(
        state.positions.filter(p => p.leaderId === leaderFilter).map(p => p.id)
    );
    return activeEmployees.filter(emp => (emp.positions || []).some(pid => leaderPositions.has(pid)));
}

export function PayrollTab() {
    const state = getState();
    
    // Inicializar secciones colapsadas por defecto
    if (state.exportConfig.collapsedSteps === undefined) {
        state.exportConfig.collapsedSteps = ['step1', 'step2', 'step2b', 'step3'];
    }
    const isStepCollapsed = (id) => (state.exportConfig.collapsedSteps || []).includes(id);

    if (!state.exportConfig.periodStart || !state.exportConfig.periodEnd) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        state.exportConfig.periodStart = getDateKey(start);
        state.exportConfig.periodEnd = getDateKey(today);
        state.exportConfig.activePreset = 'thisMonth';
    }

    if (!state.exportConfig.leaderFilter) state.exportConfig.leaderFilter = 'all';

    const exportData = generateExportData();
    const totalAmount = exportData.reduce((sum, item) => sum + item.monto, 0);
    const employeesWithDeductions = getEmployeesWithDeductions();
    const hasEmployeeDeductions = employeesWithDeductions.length > 0;
    const employeeDeductionsAdded = !!state.exportConfig.employeeDeductionsAdded;

    const employeesWithBonuses = getEmployeesWithBonuses();
    const hasEmployeeBonuses = employeesWithBonuses.length > 0;
    const employeeBonusesAdded = !!state.exportConfig.employeeBonusesAdded;
    
    const employeeOptions = state.employees
        .filter(e => e.active !== false)
        .map(e => `<option value="${e.id}">${e.name}</option>`)
        .join('');
        
    const leaderFilter = state.exportConfig.leaderFilter || 'all';
    const leaders = state.leaders.filter(l => l.active);

    return `
        <div style="max-width: 1000px; margin: 0 auto; padding: 20px; padding-bottom: 120px;">
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
            <div style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step1') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div onclick="PayrollUI.toggleStep('step1')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step1') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        Paso 1: Período de Pago
                    </h3>
                    ${isStepCollapsed('step1') ? `<span style="font-size: 0.75rem; color: #64748b; font-weight: 600;">${formatDateShort(state.exportConfig.periodStart)} - ${formatDateShort(state.exportConfig.periodEnd)}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step1') ? 'none' : 'block'}; margin-top: 20px;">
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
                        Este mes
                    </button>
                    <button onclick="PayrollUI.setExportPreset('lastMonth')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'lastMonth' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'lastMonth' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        Mes anterior
                    </button>
                    <button onclick="PayrollUI.setExportPreset('last15')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'last15' ? '#06b6d4' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'last15' ? '#06b6d4' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'last15' ? '#000' : '#94a3b8'}; cursor: pointer; font-size: 0.75rem; font-weight: 600;">
                        Últimos 15 días
                    </button>
                    <button onclick="PayrollUI.setExportPreset('payPeriod')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'payPeriod' ? '#8b5cf6' : '#0f172a'}; border: 1px solid ${state.exportConfig.activePreset === 'payPeriod' ? '#8b5cf6' : '#334155'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'payPeriod' ? '#fff' : '#a78bfa'}; cursor: pointer; font-size: 0.75rem; font-weight: 700;">
                        🗓️ Período Actual
                    </button>
                    <button onclick="PayrollUI.setExportPreset('sinceLastPay')" 
                            style="padding: 6px 12px; background: ${state.exportConfig.activePreset === 'sinceLastPay' ? 'linear-gradient(135deg, #f59e0b, #fbbf24)' : 'transparent'}; border: 1px solid ${state.exportConfig.activePreset === 'sinceLastPay' ? 'transparent' : '#f59e0b'}; border-radius: 6px; color: ${state.exportConfig.activePreset === 'sinceLastPay' ? '#000' : '#f59e0b'}; cursor: pointer; font-size: 0.75rem; font-weight: 700;">
                        Desde Último Pago + 1
                    </button>
                </div>
                </div>
            </div>
            
            <!-- Paso 2: Deducciones Globales -->
            <div id="export-deductions-section" style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step2') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div onclick="PayrollUI.toggleStep('step2')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step2') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        ${icons.get('payroll')} Paso 2: Deducciones Globales
                    </h3>
                </div>
                
                <div style="display: ${isStepCollapsed('step2') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button onclick="PayrollUI.addExportDeduction()" 
                                style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            +
                        </button>
                    </div>
                
                <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    Estas deducciones se aplicarán a todos los empleados de forma encadenada
                </p>

                ${hasEmployeeDeductions ? `
                    <div style="margin-bottom: 16px; padding: 10px 12px; border: 1px solid ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; border-radius: 8px; background: ${employeeDeductionsAdded ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)'};">
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 8px; color: ${employeeDeductionsAdded ? '#86efac' : '#fecaca'}; font-size: 0.875rem;">
                                <span style="width: 8px; height: 8px; border-radius: 999px; background: ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; display: inline-block; ${employeeDeductionsAdded ? '' : 'animation: pulse 1.5s infinite;'}"></span>
                                <span>${employeeDeductionsAdded ? `${icons.get('check')} Descuentos individuales agregados` : `${icons.get('alert')} Hay ${employeesWithDeductions.length} empleados con descuentos programados`}</span>
                            </div>
                            <button onclick="PayrollUI.addEmployeeDeductionsToExport()"
                                    style="padding: 6px 12px; background: ${employeeDeductionsAdded ? '#10b981' : '#ef4444'}; border: none; border-radius: 6px; color: #fff; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                ${employeeDeductionsAdded ? 'Actualizar lista' : 'Agregar a nómina'}
                            </button>
                        </div>
                    </div>
                ` : ''}

                <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
                    <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">Cargo individual por empleado</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px;">
                        <select id="payroll-emp-deduction-employee" class="form-input">
                            <option value="">Seleccionar empleado</option>
                            ${employeeOptions}
                        </select>
                        <select id="payroll-emp-deduction-type" class="form-input">
                            <option value="fixed">Monto</option>
                            <option value="percentage">Porcentaje</option>
                        </select>
                        <input id="payroll-emp-deduction-value" type="number" class="form-input" placeholder="0.00" min="0" step="0.01">
                        <input id="payroll-emp-deduction-name" type="text" class="form-input" placeholder="Nombre del cargo">
                        <button onclick="PayrollUI.addEmployeeDeductionFromForm()"
                                style="padding: 8px 12px; background: #06b6d4; border: none; border-radius: 6px; color: #000; font-weight: 700; cursor: pointer;">
                            Agregar cargo
                        </button>
                    </div>
                </div>
                
                ${generateExportDeductionsHTML()}
            </div>
            </div>
            
            <!-- Paso 2B: Bonificaciones Globales -->
            <div id="export-bonuses-section" style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step2b') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div onclick="PayrollUI.toggleStep('step2b')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step2b') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        🎁 Paso 2B: Bonificaciones Globales
                    </h3>
                </div>
                
                <div style="display: ${isStepCollapsed('step2b') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                        <button onclick="PayrollUI.addExportBonus()" 
                                style="background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; padding: 6px 14px; border-radius: 6px; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s;"
                                onmouseover="this.style.transform='scale(1.05)'"
                                onmouseout="this.style.transform='scale(1)'">
                            +
                        </button>
                    </div>
                
                <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 16px;">
                    Estos bonos se sumarán a todos los empleados de forma general o por empleado
                </p>

                ${hasEmployeeBonuses ? `
                    <div style="margin-bottom: 16px; padding: 10px 12px; border: 1px solid ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; border-radius: 8px; background: ${employeeBonusesAdded ? 'rgba(16, 185, 129, 0.08)' : 'rgba(245, 158, 11, 0.08)'};">
                        <div style="display: flex; align-items: center; gap: 8px; justify-content: space-between;">
                            <div style="display: flex; align-items: center; gap: 8px; color: ${employeeBonusesAdded ? '#86efac' : '#fcd34d'}; font-size: 0.875rem;">
                                <span style="width: 8px; height: 8px; border-radius: 999px; background: ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; display: inline-block; ${employeeBonusesAdded ? '' : 'animation: pulse 1.5s infinite;'}"></span>
                                <span>${employeeBonusesAdded ? `${icons.get('check')} Bonos individuales agregados` : `🎁 Hay ${employeesWithBonuses.length} empleados con bonos programados`}</span>
                            </div>
                            <button onclick="PayrollUI.addEmployeeBonusesToExport()"
                                    style="padding: 6px 12px; background: ${employeeBonusesAdded ? '#10b981' : '#f59e0b'}; border: none; border-radius: 6px; color: #fff; font-size: 0.75rem; font-weight: 700; cursor: pointer;">
                                ${employeeBonusesAdded ? 'Actualizar lista' : 'Agregar a nómina'}
                            </button>
                        </div>
                    </div>
                ` : ''}

                <div style="margin-bottom: 16px; padding: 12px; border: 1px solid #334155; border-radius: 8px; background: #0f172a;">
                    <p style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px;">Abonar bono individual por empleado</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px;">
                        <select id="payroll-emp-bonus-employee" class="form-input">
                            <option value="">Seleccionar empleado</option>
                            ${employeeOptions}
                        </select>
                        <select id="payroll-emp-bonus-type" class="form-input">
                            <option value="fixed">Monto</option>
                            <option value="percentage">Porcentaje</option>
                        </select>
                        <input id="payroll-emp-bonus-value" type="number" class="form-input" placeholder="0.00" min="0" step="0.01">
                        <input id="payroll-emp-bonus-name" type="text" class="form-input" placeholder="Nombre del bono">
                        <button onclick="PayrollUI.addEmployeeBonusFromForm()"
                                style="padding: 8px 12px; background: #10b981; border: none; border-radius: 6px; color: #fff; font-weight: 700; cursor: pointer;">
                            Agregar bono
                        </button>
                    </div>
                </div>
                
                ${generateExportBonusesHTML()}
            </div>
            </div>
            
            <!-- Paso 3: Vista Previa -->
            <div style="background: #1e293b; border-radius: 12px; padding: ${isStepCollapsed('step3') ? '14px 20px' : '20px'}; margin-bottom: 20px; border: 1px solid #334155; transition: all 0.2s;">
                <div onclick="PayrollUI.toggleStep('step3')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
                    <h3 style="margin: 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.8rem; transform: rotate(${isStepCollapsed('step3') ? '0deg' : '90deg'}); transition: transform 0.2s; display: inline-block;">▶</span>
                        Paso 3: Vista Previa (${exportData.length} empleados)
                    </h3>
                    ${isStepCollapsed('step3') ? `<span style="font-size: 1rem; color: #10b981; font-weight: 700;">${formatCurrency(totalAmount)}</span>` : ''}
                </div>
                
                <div style="display: ${isStepCollapsed('step3') ? 'none' : 'block'}; margin-top: 20px;">
                    <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 16px;">
                    <div style="display: flex; gap: 8px; align-items: center; max-width: 60%;">
                        <span style="font-size: 0.75rem; color: #94a3b8; margin-right: 4px;">Líder:</span>
                        <select onchange="PayrollUI.setLeaderFilter(this.value)" class="form-input" style="padding: 6px 12px; font-size: 0.875rem; border-color: #334155; background: #0f172a; color: #f1f5f9; border-radius: 6px; cursor: pointer; outline: none;">
                            <option value="all" ${leaderFilter === 'all' ? 'selected' : ''}>Todos</option>
                            ${leaders.map(ldr => `
                                <option value="${ldr.id}" ${leaderFilter === ldr.id ? 'selected' : ''}>${ldr.name}</option>
                            `).join('')}
                        </select>
                    </div>
                </div>

                <div style="overflow-x: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #0f172a; border-bottom: 2px solid #334155;">
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">REF</th>
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">NOMBRE</th>
                                <th style="padding: 12px; text-align: left; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">POSICIÓN</th>
                                <th style="padding: 12px; text-align: right; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">BRUTO</th>
                                <th style="padding: 12px; text-align: right; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">BONIFIC.</th>
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
                                     <td style="padding: 12px; text-align: right; color: #10b981;">${formatCurrency(emp._brutoOriginal)}</td>
                                    <td style="padding: 12px; text-align: right; color: #3b82f6;">+${formatCurrency(emp._bonuses)}</td>
                                    <td style="padding: 12px; text-align: right; color: #ec4899;">-${formatCurrency(emp._deductions)}</td>
                                    <td style="padding: 12px; text-align: right; color: #06b6d4; font-weight: 700; font-size: 1rem;">${formatCurrency(emp.monto)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                        <tfoot>
                            <tr style="background: linear-gradient(135deg, #10b981, #06b6d4); border-top: 2px solid #06b6d4;">
                                <td colspan="6" style="padding: 16px; color: #000; font-weight: 700; font-size: 1.125rem;">TOTAL NÓMINA:</td>
                                <td style="padding: 16px; text-align: right; color: #000; font-weight: 900; font-size: 1.25rem;">${formatCurrency(totalAmount)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            </div>
            
            <!-- Paso 4: Exportar -->
            <div style="display: flex; gap: 12px; flex-wrap: wrap;">
                <button onclick="PayrollUI.copyExportJSON()" 
                        style="flex: 1; min-width: 200px; padding: 16px; background: linear-gradient(135deg, #06b6d4, #10b981); border: none; border-radius: 8px; color: #000; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 8px 16px rgba(6, 182, 212, 0.3)'"
                        onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none'">
                    Copiar JSON al Portapapeles
                </button>
                <button onclick="PayrollUI.downloadExportJSON()" 
                        style="flex: 1; min-width: 200px; padding: 16px; background: #1e293b; border: 2px solid #06b6d4; border-radius: 8px; color: #06b6d4; font-weight: 700; font-size: 1rem; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(6, 182, 212, 0.1)'"
                        onmouseout="this.style.background='#1e293b'">
                    Descargar Archivo .json
                </button>
            </div>
        </div>
    `;
}

function generateExportData() {
    const state = getState();
    const { periodStart, periodEnd, deductions } = state.exportConfig;
    if (!periodStart || !periodEnd) return [];

    const filteredEmployees = getLeaderFilteredEmployees(state);

    return filteredEmployees.map(emp => {
        const applicableDeductions = (deductions || []).filter(d => !d.employeeId || d.employeeId === emp.id);
        const applicableBonuses = (state.exportConfig.bonuses || []).filter(b => !b.employeeId || b.employeeId === emp.id);
        const payroll = payrollService.calculateEmployeePayroll(emp.id, periodStart, periodEnd, applicableDeductions, applicableBonuses);
        
        const positionIds = (emp.positions && emp.positions.length > 0)
            ? emp.positions
            : (emp.position ? [emp.position] : []);
            
        const positionNames = positionIds
            .map(posId => state.positions.find(p => p.id === posId)?.name)
            .filter(Boolean);
            
        return {
            id: parseInt(emp.number) || 0,
            nombre: `${emp.name} (Ref #${emp.number})`,
            monto: payroll.neto, // <--- PRECISIÓN TOTAL: No redondear aquí (Permitir estilo Excel)
            _brutoOriginal: payroll.brutoOriginal,
            _bruto: payroll.bruto,
            _bonuses: payroll.bonuses,
            _deductions: payroll.deductions,
            _employeeName: emp.name,
            _employeePosition: positionNames.length > 0 ? positionNames.join(', ') : 'Sin posicion'
        };
    }).filter(emp => emp.monto > 0.001) // Filtro de seguridad para montos casi cero
      .sort((a, b) => a.id - b.id);
}

function generateExportDeductionsHTML() {
    const state = getState();
    const deductions = state.exportConfig.deductions || [];
    if (deductions.length === 0) return '<div style="text-align: center; color: #64748b; padding: 20px;">No hay deducciones configuradas</div>';

    // 🛡️ REFACTOR INDUSTRIAL: Preservar índices originales antes de filtrar
    // El sistema de Proxy de AppState genera nuevas instancias en cada acceso,
    // por lo que indexOf(ded) fallaría devolviendo -1.
    const mappedDeductions = deductions.map((ded, originalIndex) => ({ 
        data: ded, 
        index: originalIndex 
    }));

    const globalDeductions = mappedDeductions.filter(item => !item.data.employeeId);
    const employeeDeductions = mappedDeductions.filter(item => item.data.employeeId);

    const groupedByEmployee = employeeDeductions.reduce((acc, item) => {
        const key = item.data.employeeId || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const renderDeductionRow = (item, allItems) => {
        const ded = item.data;
        const index = item.index;
        return `
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
                    <input type="number" class="form-input" 
                        value="${ded.value || 0}" 
                        oninput="PayrollUI.updateExportDeductionValue(${index}, this.value)" 
                        placeholder="0.00" min="0" step="${ded.type === 'fixed' ? '0.01' : '0.1'}" 
                        style="width: 100%; font-size: 0.875rem; padding: 8px; margin-bottom: 8px;">
                    <input type="text" class="form-input" 
                        value="${ded.name || ''}" 
                        oninput="PayrollUI.updateExportDeductionName(${index}, this.value)" 
                        placeholder="Nombre (ej: AFP, SFS...)" 
                        style="width: 100%; font-size: 0.75rem; padding: 6px;">
                    ${ded.employeeId ? `<div style="font-size: 0.7rem; color: #94a3b8; margin-top: 6px;">Empleado: ${ded.employeeName || (state.employees.find(e => e.id === ded.employeeId)?.name || 'N/A')}</div>` : ''}
                </div>
                ${allItems.length > 0 ? `<button onclick="PayrollUI.removeExportDeduction(${index})" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">${icons.get('delete')}</button>` : ''}
            </div>
        </div>
    `;
    };

    const globalHTML = globalDeductions.length > 0
        ? `<div style="margin-bottom: 12px; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">${icons.get('info')} Deducciones generales</div>
           ${globalDeductions.map(item => renderDeductionRow(item, globalDeductions)).join('')}`
        : '';

    const employeeHTML = Object.entries(groupedByEmployee).map(([id, items]) => `
        <div style="margin-top: 16px; margin-bottom: 12px; color: #94a3b8; font-size: 0.75rem; font-weight: 700;">
            ${icons.get('personnel')} ${items[0].data.employeeName || (state.employees.find(e => e.id === id)?.name || 'Empleado')}
        </div>
        ${items.map(item => renderDeductionRow(item, items)).join('')}
    `).join('');

    return `${globalHTML}${employeeHTML}`;
}

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
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        deductions[index].type = type;
        context.render();
    }
}

export function updateExportDeductionValue(index, value) {
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        // Guardar el número directamente en el estado
        deductions[index].value = parseFloat(value) || 0;
        
        // No llamamos a render aquí para evitar perder el foco mientras se escribe (oninput)
        // El proxy de AppState se encargará de cualquier efecto secundario si es necesario, 
        // pero preferimos re-renderizar solo cuando el usuario termine o cambie de sección.
        // ACTUALIZACIÓN: Para ver los cambios en la tabla de vista previa, necesitamos un render debounced.
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function updateExportDeductionName(index, value) {
    const state = getState();
    const deductions = state.exportConfig.deductions;
    if (deductions && deductions[index]) {
        deductions[index].name = value;
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function addEmployeeDeductionsToExport() {
    const state = getState();
    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];

    const employeesWithDeductions = getEmployeesWithDeductions();
    const existingKeys = new Set(
        state.exportConfig.deductions
            .filter(d => d.employeeId)
            .map(d => `${d.employeeId}:${d.type}:${d.value}:${d.name || ''}`)
    );

    employeesWithDeductions.forEach(emp => {
        (emp.deductions || []).forEach(ded => {
            const newDed = {
                id: ded.id || `DED-${Date.now()}`,
                type: ded.type,
                value: ded.value,
                name: ded.name || `Deducción ${emp.name}`,
                employeeId: emp.id,
                employeeName: emp.name,
                source: 'employee'
            };
            const key = `${newDed.employeeId}:${newDed.type}:${newDed.value}:${newDed.name || ''}`;
            if (!existingKeys.has(key)) {
                state.exportConfig.deductions.push(newDed);
                existingKeys.add(key);
            }
        });
    });

    state.exportConfig.employeeDeductionsAdded = true;
    if (window.showNotification) window.showNotification('✅ Deducciones individuales agregadas', 'success');
    context.render();
}

export function addEmployeeDeductionFromForm() {
    const state = getState();
    const employeeId = document.getElementById('payroll-emp-deduction-employee')?.value;
    const type = document.getElementById('payroll-emp-deduction-type')?.value || 'fixed';
    const value = parseFloat(document.getElementById('payroll-emp-deduction-value')?.value) || 0;
    const name = document.getElementById('payroll-emp-deduction-name')?.value?.trim() || 'Cargo individual';

    if (!employeeId) {
        if (window.showNotification) window.showNotification('❌ Selecciona un empleado', 'error');
        return;
    }
    if (value <= 0) {
        if (window.showNotification) window.showNotification('❌ El valor debe ser mayor a 0', 'error');
        return;
    }

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    if (!state.exportConfig.deductions) state.exportConfig.deductions = [];
    state.exportConfig.deductions.push({
        id: `DED-${Date.now()}`,
        type,
        value,
        name,
        employeeId: emp.id,
        employeeName: emp.name,
        source: 'manual'
    });

    if (window.showNotification) window.showNotification('✅ Cargo individual agregado', 'success');
    context.render();
}

// ---------------------- BONIFICACIONES GLOBALES E INDIVIDUALES ----------------------

function generateExportBonusesHTML() {
    const state = getState();
    const bonuses = state.exportConfig.bonuses || [];
    if (bonuses.length === 0) return '<div style="text-align: center; color: #64748b; padding: 20px;">No hay bonificaciones configuradas</div>';

    const mappedBonuses = bonuses.map((bon, originalIndex) => ({ 
        data: bon, 
        index: originalIndex 
    }));

    const globalBonuses = mappedBonuses.filter(item => !item.data.employeeId);
    const employeeBonuses = mappedBonuses.filter(item => item.data.employeeId);

    const groupedByEmployee = employeeBonuses.reduce((acc, item) => {
        const key = item.data.employeeId || 'unknown';
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
    }, {});

    const renderBonusRow = (item, allItems) => {
        const bon = item.data;
        const index = item.index;
        return `
        <div style="background: rgba(16, 185, 129, 0.05); padding: 12px; border-radius: 8px; border: 1px solid #10b981; margin-bottom: 12px;">
            <div style="display: flex; gap: 12px; align-items: start;">
                <div style="flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportBonusType_${index}" value="fixed" ${bon.type === 'fixed' ? 'checked' : ''} onchange="PayrollUI.updateExportBonusType(${index}, 'fixed')" style="accent-color: #10b981;">
                        <span style="color: #f1f5f9;">Monto</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 0.75rem;">
                        <input type="radio" name="exportBonusType_${index}" value="percentage" ${bon.type === 'percentage' ? 'checked' : ''} onchange="PayrollUI.updateExportBonusType(${index}, 'percentage')" style="accent-color: #10b981;">
                        <span style="color: #f1f5f9;">Porcentaje%</span>
                    </label>
                </div>
                <div style="flex: 1;">
                    <input type="number" class="form-input" 
                        value="${bon.value || 0}" 
                        oninput="PayrollUI.updateExportBonusValue(${index}, this.value)" 
                        placeholder="0.00" min="0" step="${bon.type === 'fixed' ? '0.01' : '0.1'}" 
                        style="width: 100%; font-size: 0.875rem; padding: 8px; margin-bottom: 8px; border-color: rgba(16, 185, 129, 0.3);">
                    <input type="text" class="form-input" 
                        value="${bon.name || ''}" 
                        oninput="PayrollUI.updateExportBonusName(${index}, this.value)" 
                        placeholder="Nombre (ej: Bono mensual...)" 
                        style="width: 100%; font-size: 0.75rem; padding: 6px; border-color: rgba(16, 185, 129, 0.3);">
                    ${bon.employeeId ? `<div style="font-size: 0.7rem; color: #10b981; margin-top: 6px;">Empleado: ${bon.employeeName || (state.employees.find(e => e.id === bon.employeeId)?.name || 'N/A')}</div>` : ''}
                </div>
                ${allItems.length > 0 ? `<button onclick="PayrollUI.removeExportBonus(${index})" style="background: #ef4444; color: white; border: none; padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; transition: all 0.2s;">${icons.get('delete')}</button>` : ''}
            </div>
        </div>
    `;
    };

    const globalHTML = globalBonuses.length > 0
        ? `<div style="margin-bottom: 12px; color: #10b981; font-size: 0.75rem; font-weight: 700;">🎁 Bonos generales</div>
           ${globalBonuses.map(item => renderBonusRow(item, globalBonuses)).join('')}`
        : '';

    const employeeHTML = Object.entries(groupedByEmployee).map(([id, items]) => `
        <div style="margin-top: 16px; margin-bottom: 12px; color: #10b981; font-size: 0.75rem; font-weight: 700;">
            ${icons.get('personnel')} ${items[0].data.employeeName || (state.employees.find(e => e.id === id)?.name || 'Empleado')}
        </div>
        ${items.map(item => renderBonusRow(item, items)).join('')}
    `).join('');

    return `${globalHTML}${employeeHTML}`;
}

export function addExportBonus() {
    const state = getState();
    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];
    state.exportConfig.bonuses.push({ type: 'fixed', value: 0, name: '' });
    context.render();
}

export function removeExportBonus(index) {
    const state = getState();
    state.exportConfig.bonuses.splice(index, 1);
    context.render();
}

export function updateExportBonusType(index, type) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].type = type;
        context.render();
    }
}

export function updateExportBonusValue(index, value) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].value = parseFloat(value) || 0;
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function updateExportBonusName(index, value) {
    const state = getState();
    const bonuses = state.exportConfig.bonuses;
    if (bonuses && bonuses[index]) {
        bonuses[index].name = value;
        window.renderOptimizer.scheduleRender(() => context.render());
    }
}

export function addEmployeeBonusesToExport() {
    const state = getState();
    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];

    const employeesWithBonuses = getEmployeesWithBonuses();
    const existingKeys = new Set(
        state.exportConfig.bonuses
            .filter(b => b.employeeId)
            .map(b => `${b.employeeId}:${b.type}:${b.value}:${b.name || ''}`)
    );

    employeesWithBonuses.forEach(emp => {
        (emp.bonuses || []).forEach(bon => {
            const newBon = {
                id: bon.id || `BON-${Date.now()}`,
                type: bon.type,
                value: bon.value,
                name: bon.name || `Bono ${emp.name}`,
                employeeId: emp.id,
                employeeName: emp.name,
                source: 'employee'
            };
            const key = `${newBon.employeeId}:${newBon.type}:${newBon.value}:${newBon.name || ''}`;
            if (!existingKeys.has(key)) {
                state.exportConfig.bonuses.push(newBon);
                existingKeys.add(key);
            }
        });
    });

    state.exportConfig.employeeBonusesAdded = true;
    if (window.showNotification) window.showNotification('✅ Bonos individuales agregados', 'success');
    context.render();
}

export function addEmployeeBonusFromForm() {
    const state = getState();
    const employeeId = document.getElementById('payroll-emp-bonus-employee')?.value;
    const type = document.getElementById('payroll-emp-bonus-type')?.value || 'fixed';
    const value = parseFloat(document.getElementById('payroll-emp-bonus-value')?.value) || 0;
    const name = document.getElementById('payroll-emp-bonus-name')?.value?.trim() || 'Abono individual';

    if (!employeeId) {
        if (window.showNotification) window.showNotification('❌ Selecciona un empleado', 'error');
        return;
    }
    if (value <= 0) {
        if (window.showNotification) window.showNotification('❌ El valor debe ser mayor a 0', 'error');
        return;
    }

    const emp = state.employees.find(e => e.id === employeeId);
    if (!emp) return;

    if (!state.exportConfig.bonuses) state.exportConfig.bonuses = [];
    state.exportConfig.bonuses.push({
        id: `BON-${Date.now()}`,
        type,
        value,
        name,
        employeeId: emp.id,
        employeeName: emp.name,
        source: 'manual'
    });

    if (window.showNotification) window.showNotification('✅ Bono individual agregado', 'success');
    context.render();
}

// ---------------------- PERIODOS DE EXPORTACIÓN ----------------------

export function updateExportPeriod(type, value) {
    const state = getState();
    if (type === 'start') state.exportConfig.periodStart = value;
    if (type === 'end') state.exportConfig.periodEnd = value;
    state.exportConfig.activePreset = null;
    context.render();
}

export function setLeaderFilter(leaderId) {
    const state = getState();
    state.exportConfig.leaderFilter = leaderId;
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
        const lastPay = state.settings.globalLastPaymentDate ? new Date(state.settings.globalLastPaymentDate) : null;
        if (lastPay) {
            start = new Date(lastPay);
            start.setDate(start.getDate() + 1);
        } else {
            start = new Date(today.getFullYear(), today.getMonth(), 1);
        }
    } else if (preset === 'payPeriod') {
        const pp = state.settings.payPeriod;
        if (pp?.periodStart) {
            start = new Date(pp.periodStart + 'T00:00:00');
            const len = pp.periodLength || 15;
            end = new Date(start);
            end.setDate(end.getDate() + len - 1);
        } else {
            if (window.showNotification) window.showNotification('❌ No hay período configurado. Ve a Ajustes.', 'warning');
            return;
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
        if (window.showNotification) window.showNotification('✅ JSON copiado al portapapeles', 'success');
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
    if (window.showNotification) window.showNotification('✅ Archivo JSON descargado', 'success');
}

export function toggleStep(stepId) {
    const state = getState();
    if (!state.exportConfig.collapsedSteps) state.exportConfig.collapsedSteps = [];
    
    if (state.exportConfig.collapsedSteps.includes(stepId)) {
        state.exportConfig.collapsedSteps = state.exportConfig.collapsedSteps.filter(id => id !== stepId);
    } else {
        state.exportConfig.collapsedSteps.push(stepId);
    }
    context.render();
}
