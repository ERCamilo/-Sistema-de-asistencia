import icons from '../../ui/IconSystem.js';

import { memoCache } from '../../utils/MemoCache.js';
import { getDateKey, parseDate, formatDate, formatDateShort, isDayHoliday, formatMonthYear, formatDateRangeWithMonth, wasEmployeeActiveInRange } from '../../utils/DateUtils.js';
import { DashboardDateManagerV2, EmployeeReportDateManagerV2 } from '../../utils/DateManagers.js';

let context = null;
let dashboardDateManagerV2 = null;
let employeeReportDateManagerV2 = null;
let activeCharts = {};

export function init(ctx) {
    context = ctx;
    // Instantiate managers with context
    dashboardDateManagerV2 = new DashboardDateManagerV2(ctx.state, ctx.saveToLocalStorage);
    employeeReportDateManagerV2 = new EmployeeReportDateManagerV2(ctx.state, ctx.saveToLocalStorage);
}

function getState() {
    return context.state;
}

/**
 * Inicializa un gráfico de forma segura, destruyendo cualquier instancia previa
 * vinculada a la misma 'key' lógica para evitar errores de canvas en uso.
 */
function initChartSafely(canvasId, chartKey, config) {
    const ctx = document.getElementById(canvasId);
    if (!ctx || !window.Chart) return;

    // 1. Limpieza: Si ya existe un gráfico para esta función, destruirlo
    if (activeCharts[chartKey]) {
        try {
            activeCharts[chartKey].destroy();
        } catch (e) {
            console.warn(`Error al destruir gráfico previo (${chartKey}):`, e);
        }
        delete activeCharts[chartKey];
    }

    // 2. Doble verificación: Chart.js a veces deja rastro en el contexto
    // Buscamos si hay un gráfico huérfano en este canvas específico
    const existingChart = Chart.getChart(ctx);
    if (existingChart) {
        existingChart.destroy();
    }

    // 3. Creación de la nueva instancia
    try {
        activeCharts[chartKey] = new Chart(ctx, config);
    } catch (error) {
        console.error(`Error crítico al inicializar gráfico ${chartKey}:`, error);
    }
}

// ============================================
// DASHBOARD TAB
// ============================================

export function DashboardTab() {
    if (dashboardDateManagerV2) dashboardDateManagerV2.initializeDates();
    return `
        <div class="dashboard-container">
            ${DashboardControls()}
            ${DashboardContent()}
        </div>
    `;
}

function DashboardControls() {
    const state = getState();
    const startDate = state.dashboardStartDate;
    const endDate = state.dashboardEndDate;

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
            <!-- Selector de Gráfico -->
            <div style="margin-bottom: 20px;">
                <div style="font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                    TIPO DE VISUALIZACIÓN
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
                    <button onclick="AnalyticsUI.setDashboardChart('attendance')" class="dashboard-chart-btn ${state.dashboardChart === 'attendance' ? 'active' : ''}">${icons.get('reports')} Asistencia</button>
                    <button onclick="AnalyticsUI.setDashboardChart('hours')" class="dashboard-chart-btn ${state.dashboardChart === 'hours' ? 'active' : ''}">${icons.get('info')} Horas</button>
                    <button onclick="AnalyticsUI.setDashboardChart('positions')" class="dashboard-chart-btn ${state.dashboardChart === 'positions' ? 'active' : ''}">${icons.get('palette')} Posiciones</button>
                    <button onclick="AnalyticsUI.setDashboardChart('top10')" class="dashboard-chart-btn ${state.dashboardChart === 'top10' ? 'active' : ''}">${icons.get('rocket')} Top 10</button>
                    <button onclick="AnalyticsUI.setDashboardChart('heatmap')" class="dashboard-chart-btn ${state.dashboardChart === 'heatmap' ? 'active' : ''}">${icons.get('zap')} Mapa Calor</button>
                </div>
            </div>
            
            <!--Selector de Rango de Fechas-->
    <div style="margin-bottom: 20px;">
        <div style="font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
            PERÍODO DE ANÁLISIS
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 12px;">
            <div style="flex: 1; min-width: 140px; position: relative;">
                <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Desde:</label>
                <div class="date-display" onclick="AnalyticsUI.toggleStartDatePicker()"
                    style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; border-radius: 6px; cursor: pointer;">
                    ${formatDateShort(startDate)}
                </div>
                ${state.showStartDatePicker ? DashboardStartDatePicker() : ''}
            </div>
            <div style="flex: 1; min-width: 140px; position: relative;">
                <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Hasta:</label>
                <div class="date-display" onclick="AnalyticsUI.toggleEndDatePicker()"
                    style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; border-radius: 6px; cursor: pointer;">
                    ${formatDateShort(endDate)}
                </div>
                ${state.showEndDatePicker ? DashboardEndDatePicker() : ''}
            </div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px; width: 100%; margin-top: 4px;">
                <button onclick="AnalyticsUI.setDashboardThisWeek()" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #06b6d4; padding: 8px 12px; border-radius: 6px; font-size: 0.75rem; white-space: nowrap;">Esta Semana</button>
                <button onclick="AnalyticsUI.setDashboardThisMonth()" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #06b6d4; padding: 8px 12px; border-radius: 6px; font-size: 0.75rem; white-space: nowrap;">Este Mes</button>
                <button onclick="AnalyticsUI.setDashboardLast30Days()" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #06b6d4; padding: 8px 12px; border-radius: 6px; font-size: 0.75rem; white-space: nowrap;">Últimos 30</button>
            </div>
        </div>
    </div>
        </div>
        `;
}

function DashboardContent() {
    const state = getState();
    const chart = state.dashboardChart;

    if (chart === 'attendance') return AttendanceChart();
    if (chart === 'hours') return HoursChart();
    if (chart === 'positions') return PositionsChart();
    if (chart === 'top10') return Top10Chart();
    if (chart === 'heatmap') return HeatmapChart();

    return GeneratedReport();
}

// ... DatePickers for Dashboard ...
function DashboardStartDatePicker() {
    const state = getState();
    const month = state.startDatePickerMonth;
    return generateDatePicker(month, state.dashboardStartDate, 'AnalyticsUI.selectStartDate', 'AnalyticsUI.changeStartDatePickerMonth');
}

function DashboardEndDatePicker() {
    const state = getState();
    const month = state.endDatePickerMonth;
    return generateDatePicker(month, state.dashboardEndDate, 'AnalyticsUI.selectEndDate', 'AnalyticsUI.changeEndDatePickerMonth');
}

// ... Charts implementation ...
function AttendanceChart() {
    const chartId = 'attendanceChart-' + Date.now();
    setTimeout(() => {
        const data = getAttendanceChartData();
        initChartSafely(chartId, 'dashboardAttendance', {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: [
                    { label: 'Presentes', data: data.present, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 5 },
                    { label: 'Ausentes', data: data.absent, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', borderWidth: 3, tension: 0.4, fill: true, pointRadius: 5 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#f1f5f9' } } }, scales: { y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }, x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } } } }
        });
    }, 100);

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.25rem;">${icons.get('reports')} Tendencia de Asistencia</h3>
            <div style="height: 400px;"><canvas id="${chartId}"></canvas></div>
            ${ GeneratedReport() }
        </div>`;
}

function getAttendanceChartData() {
    const state = getState();
    const cacheKey = 'chart-attendance';
    const deps = [state.dashboardStartDate, state.dashboardEndDate, state.employees.length];

    return memoCache.get(cacheKey, () => {
        const startDate = parseDate(state.dashboardStartDate);
        const endDate = parseDate(state.dashboardEndDate);
        const activeEmployees = state.employees.filter(e => e.active);
        const totalEmployees = activeEmployees.length;
        const labels = [], present = [], absent = [];

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateKey = getDateKey(new Date(d));
            labels.push(formatDateShort(new Date(d)));
            let presentCount = 0;
            activeEmployees.forEach(emp => {
                const key = `${ emp.id }-${ dateKey }`;
                const att = state.attendance[key];
                if (att && att.present) presentCount++;
            });
            present.push(presentCount);
            absent.push(totalEmployees - presentCount);
        }
        return { labels, present, absent };
    }, deps);
}

function HoursChart() {
    const chartId = 'hoursChart-' + Date.now();
    setTimeout(() => {
        const data = getHoursChartData();
        initChartSafely(chartId, 'dashboardHours', {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    { label: 'Horas Regulares', data: data.regular, backgroundColor: '#10b981', borderRadius: 6 },
                    { label: 'Horas Extras', data: data.overtime, backgroundColor: '#3b82f6', borderRadius: 6 },
                    { label: 'Horas Festivas', data: data.holiday, backgroundColor: '#f59e0b', borderRadius: 6 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#94a3b8' } }, y: { stacked: true, beginAtZero: true, ticks: { color: '#94a3b8' } } }, plugins: { legend: { labels: { color: '#f1f5f9' } } } }
        });
    }, 100);

    return `
    <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
             <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.25rem;">${icons.get('info')} Horas Trabajadas por Período</h3>
             <div style="height: 400px;"><canvas id="${chartId}"></canvas></div>
             ${ GeneratedReport() }
        </div>`;
}

function getHoursChartData() {
    const state = getState();
    const cacheKey = 'chart-hours';
    const deps = [state.dashboardStartDate, state.dashboardEndDate, state.employees.length];

    return memoCache.get(cacheKey, () => {
        const startDate = parseDate(state.dashboardStartDate);
        const endDate = parseDate(state.dashboardEndDate);
        const weeks = {};

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const date = new Date(d);
            const weekStart = new Date(date);
            const day = weekStart.getDay();
            const diff = (day === 0 ? -6 : 1) - day;
            weekStart.setDate(weekStart.getDate() + diff);
            const weekKey = getDateKey(weekStart);

            if (!weeks[weekKey]) weeks[weekKey] = { label: 'Semana ' + formatDateShort(weekStart), regular: 0, overtime: 0, holiday: 0 };

            const dateKey = getDateKey(date);
            const isHoliday = isDayHoliday(date);

            state.employees.filter(e => e.active).forEach(emp => {
                const key = `${ emp.id }-${ dateKey }`;
                const att = state.attendance[key];
                if (att && att.present) {
                    const regularHours = Math.min(att.hoursWorked, state.settings.regularHoursPerDay);
                    if (isHoliday || att.isHoliday) weeks[weekKey].holiday += att.hoursWorked;
                    else {
                        weeks[weekKey].regular += regularHours;
                        if (att.hoursWorked > state.settings.regularHoursPerDay) weeks[weekKey].overtime += att.hoursWorked - state.settings.regularHoursPerDay;
                    }
                }
            });
        }
        const sortedWeeks = Object.keys(weeks).sort();
        return {
            labels: sortedWeeks.map(k => weeks[k].label),
            regular: sortedWeeks.map(k => weeks[k].regular),
            overtime: sortedWeeks.map(k => weeks[k].overtime),
            holiday: sortedWeeks.map(k => weeks[k].holiday)
        };
    }, deps);
}

function PositionsChart() {
    const chartId = 'positionsChart-' + Date.now();
    setTimeout(() => {
        const data = getPositionsChartData();
        initChartSafely(chartId, 'dashboardPositions', {
            type: 'doughnut',
            data: {
                labels: data.labels,
                datasets: [{ data: data.values, backgroundColor: data.colors, borderColor: '#1e293b', borderWidth: 3 }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#f1f5f9' } } } }
        });
    }, 100);
    return `
    <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.25rem;">${icons.get('palette')} Distribución por Posición</h3>
            <div style="height: 400px;"><canvas id="${chartId}"></canvas></div>
            ${ GeneratedReport() }
        </div>`;
}

function getPositionsChartData() {
    const state = getState();
    const activeEmployees = state.employees.filter(e => e.active);
    const positionCounts = {};
    const positionColors = {};

    activeEmployees.forEach(emp => {
        const posId = emp.positions?.[0];
        if (posId) {
            positionCounts[posId] = (positionCounts[posId] || 0) + 1;
            const pos = state.positions.find(p => p.id === posId);
            if (pos) positionColors[posId] = pos.color;
        }
    });

    return {
        labels: Object.keys(positionCounts).map(id => {
            const pos = state.positions.find(p => p.id === id);
            return pos ? pos.name : id;
        }),
        values: Object.values(positionCounts),
        colors: Object.keys(positionCounts).map(id => positionColors[id] || '#64748b')
    };
}

function Top10Chart() {
    const chartId = 'top10Chart-' + Date.now();
    setTimeout(() => {
        const data = getTop10ChartData();
        initChartSafely(chartId, 'dashboardTop10', {
            type: 'bar',
            data: {
                labels: data.labels,
                datasets: [
                    { label: 'Horas Regulares', data: data.regular, backgroundColor: '#10b981', borderRadius: 6 },
                    { label: 'Horas Extras', data: data.overtime, backgroundColor: '#3b82f6', borderRadius: 6 }
                ]
            },
            options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true, ticks: { color: '#94a3b8' } }, y: { stacked: true, ticks: { color: '#94a3b8' } } }, plugins: { legend: { labels: { color: '#f1f5f9' } } } }
        });
    }, 100);
    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.25rem;">${icons.get('rocket')} Top 10 Empleados</h3>
            <div style="height: 500px;"><canvas id="${chartId}"></canvas></div>
            ${ GeneratedReport() }
        </div>`;
}

function getTop10ChartData() {
    const state = getState();
    const startDate = parseDate(state.dashboardStartDate);
    const endDate = parseDate(state.dashboardEndDate);
    const activeEmployees = state.employees.filter(e => e.active);

    const employeeHours = activeEmployees.map(emp => {
        let regular = 0, overtime = 0;
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const key = `${ emp.id }-${ getDateKey(new Date(d))}`;
    const att = state.attendance[key];
    if (att && att.present) {
        const regHours = Math.min(att.hoursWorked, state.settings.regularHoursPerDay);
        regular += regHours;
        if (att.hoursWorked > state.settings.regularHoursPerDay) overtime += att.hoursWorked - state.settings.regularHoursPerDay;
    }
}
return { name: `[${emp.number}] ${emp.name}`, regular, overtime, total: regular + overtime };
    });

employeeHours.sort((a, b) => b.total - a.total);
const top10 = employeeHours.slice(0, 10);

return {
    labels: top10.map(e => e.name),
    regular: top10.map(e => e.regular),
    overtime: top10.map(e => e.overtime)
};
}

function HeatmapChart() {
    const data = getHeatmapData();
    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.25rem;">${icons.get('zap')} Mapa de Calor</h3>
            <div style="overflow-x: auto;">
                <table style="width: 100%; border-collapse: separate; border-spacing: 4px;">
                    <thead><tr><th style="color:#94a3b8">Semana</th>${['D', 'L', 'M', 'M', 'J', 'V', 'S'].map(d => `<th style="color:#94a3b8">${d}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${data.weeks.map((week, idx) => `<tr><td style="color:#f1f5f9">Sem ${idx + 1}</td>${week.days.map(d => {
        const bg = d.percentage >= 90 ? '#10b981' : d.percentage >= 75 ? '#f59e0b' : d.percentage >= 50 ? '#f97316' : '#ef4444';
        const opacity = Math.round((d.percentage / 100) * 255).toString(16).padStart(2, '0');
        return `<td style="padding:16px;text-align:center;background:${bg}${opacity};border-radius:8px;color:white" title="${d.date}: ${d.percentage}%">
                                <div style="font-weight:700">${d.percentage}%</div>
                            </td>`;
    }).join('')}</tr>`).join('')}
                    </tbody>
                </table>
            </div>
            ${GeneratedReport()}
        </div>`;
}

function getHeatmapData() {
    const state = getState();
    const startDate = parseDate(state.dashboardStartDate);
    const endDate = parseDate(state.dashboardEndDate);
    const activeEmployees = state.employees.filter(e => e.active);
    const totalEmployees = activeEmployees.length;

    const weeks = [];
    let currentWeek = [];
    const weekStart = new Date(startDate);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const date = new Date(d);
        const dateKey = getDateKey(date);
        let presentCount = 0;
        activeEmployees.forEach(emp => {
            const att = state.attendance[`${emp.id}-${dateKey}`];
            if (att && att.present) presentCount++;
        });
        const percentage = totalEmployees > 0 ? Math.round((presentCount / totalEmployees) * 100) : 0;

        currentWeek.push({ date: formatDateShort(date), present: presentCount, total: totalEmployees, percentage });

        if (date.getDay() === 6 || date.getTime() === parseDate(state.dashboardEndDate).getTime()) {
            while (currentWeek.length < 7 && currentWeek[0]) currentWeek.unshift({ date: '', percentage: 0 }); // Pad start
            while (currentWeek.length < 7) currentWeek.push({ date: '', percentage: 0 }); // Pad end
            weeks.push({ days: currentWeek });
            currentWeek = [];
        }
    }
    return { weeks };
}

function GeneratedReport() {
    const state = getState();
    const startDate = state.dashboardStartDate;
    const endDate = state.dashboardEndDate;
    const reportData = calculateReportData(startDate, endDate);
    return `
        <div style="background: #0f172a; border-radius: 12px; padding: 24px; margin-top: 20px; border: 1px solid #1e293b;">
            <h3 style="margin: 0 0 20px 0; color: #f1f5f9; font-size: 1.125rem;">${icons.get('reports')} Resumen General (${formatDateShort(startDate)} - ${formatDateShort(endDate)})</h3>
            <div style="color: #f1f5f9; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div><div style="color:#64748b;font-size:0.75rem">Total Empleados</div><div style="font-size:1.5rem;font-weight:700">${reportData.totalEmployees}</div></div>
                <div><div style="color:#64748b;font-size:0.75rem">Días Laborables</div><div style="font-size:1.5rem;font-weight:700">${reportData.workDays}</div></div>
            </div>
        </div>`;
}

function calculateReportData(startDate, endDate) {
    const state = getState();
    const start = parseDate(startDate);
    const end = parseDate(endDate);
    const activeEmployees = state.employees.filter(e => e.active);
    let workDays = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) workDays++;
    return { totalEmployees: activeEmployees.length, workDays };
}

// ----------------------------------------------------
// REPORTS TAB & EMPLOYEE REPORTS
// ----------------------------------------------------

export function ReportsTab() {
    const state = getState();
    const reportType = state.reportViewMode || 'employee-report';
    const isDashboard = reportType === 'dashboard';

    return `
        <div>
            <div class="date-controls">
                <div class="view-controls">
                    <button class="view-btn ${!isDashboard ? 'active' : ''}" onclick="AnalyticsUI.changeReportViewMode('employee-report')">${icons.get('info')} Reporte Personal</button>
                    <button class="view-btn ${isDashboard ? 'active' : ''}" onclick="AnalyticsUI.changeReportViewMode('dashboard')">${icons.get('chevron-right')} Gráficas</button>
                </div>
            </div>
            ${isDashboard ? DashboardTab() : EmployeeReportTab()}
        </div>
    `;
}

function EmployeeReportTab() {
    if (employeeReportDateManagerV2) employeeReportDateManagerV2.initializeDates();
    return `<div style="max-width: 100%; margin: 0 auto;">${ EmployeeReportControls() }${ EmployeeReportContent() }</div>`;
}

function EmployeeReportControls() {
    const state = getState();
    const startDate = state.employeeReportStartDate;
    const endDate = state.employeeReportEndDate;
    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
             <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 20px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="background: rgba(6, 182, 212, 0.1); padding: 8px; border-radius: 8px; color: #06b6d4;">
                        ${icons.get('reports', { size: 20 })}
                    </div>
                    <h2 style="color: #f1f5f9; margin: 0; font-size: 1.25rem; font-weight: 600;">Reporte de Empleados</h2>
                </div>
                <button onclick="AnalyticsUI.exportEmployeeReportExcel()" 
                    style="background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; padding: 10px 18px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 0.875rem; transition: transform 0.2s; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);">
                    ${icons.get('export', { size: 18 })} Exportar Excel
                </button>
             </div>

             <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end;">
                 <div style="flex: 1; min-width: 140px; position: relative;">
                    <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.025em;">Desde:</label>
                    <div class="date-display" onclick="AnalyticsUI.toggleEmployeeReportStartPicker()" 
                        style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        ${icons.get('calendar', { size: 14, class: 'text-cyan-500' })}
                        ${formatDateShort(startDate)}
                    </div>
                    ${state.showEmployeeReportStartPicker ? EmployeeReportStartDatePicker() : ''}
                 </div>

                 <div style="flex: 1; min-width: 140px; position: relative;">
                    <label style="font-size: 0.75rem; color: #94a3b8; display: block; margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.025em;">Hasta:</label>
                    <div class="date-display" onclick="AnalyticsUI.toggleEmployeeReportEndPicker()" 
                        style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; gap: 8px;">
                        ${icons.get('calendar', { size: 14, class: 'text-cyan-500' })}
                        ${formatDateShort(endDate)}
                    </div>
                    ${state.showEmployeeReportEndPicker ? EmployeeReportEndDatePicker() : ''}
                 </div>

                 <div style="display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 200px;">
                    <button onclick="AnalyticsUI.setEmployeeReportThisWeek()" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #38bdf8; padding: 10px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">Esta Semana</button>
                    <button onclick="AnalyticsUI.setEmployeeReportThisMonth()" style="flex: 1; background: #1e293b; border: 1px solid #334155; color: #38bdf8; padding: 10px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 600; cursor: pointer; white-space: nowrap;">Este Mes</button>
                 </div>
             </div>
        </div>`;
}

function EmployeeReportContent() {
    const reportData = calculateEmployeeReportData();
    if (reportData.positions.length === 0) {
        return `<div style="text-align: center; padding: 60px 20px; color: #64748b;">
                    <div style="font-size: 3rem; margin-bottom: 12px; opacity: 0.3;">${icons.get('edit')}</div>
                    <div style="font-size: 1.125rem; margin-bottom: 8px;">No hay datos para mostrar</div>
                </div>`;
    }
    return `<div>
        ${ EmployeeReportGeneralSection(reportData) }
                ${ reportData.positions.map(posData => EmployeeReportPositionSection(posData, reportData.days)).join('') }
            </div>`;
}

function EmployeeReportGeneralSection(reportData) {
    const state = getState();
    const collapses = state.collapsedPositions || {};
    const isCollapsed = collapses['general'];
    const allEmployeesMap = new Map();

    reportData.positions.forEach(posData => {
        posData.employees.forEach(empData => {
            if (!allEmployeesMap.has(empData.id)) {
                allEmployeesMap.set(empData.id, { ...empData, daysWorked: 0, totalHours: 0, totalDays: 0, dayValues: {} });
            }
            const employee = allEmployeesMap.get(empData.id);
            Object.keys(empData.dayValues).forEach(dateKey => {
                if (!employee.dayValues[dateKey]) { employee.dayValues[dateKey] = 0; employee.daysWorked++; }
                employee.dayValues[dateKey] += empData.dayValues[dateKey];
            });
        });
    });

    const allEmployees = Array.from(allEmployeesMap.values()).map(emp => {
        emp.totalDays = Object.values(emp.dayValues).reduce((sum, val) => sum + val, 0);
        reportData.days.forEach(day => {
            const att = state.attendance[`${ emp.id }-${ getDateKey(day.date)}`];
    if (att && att.present) emp.totalHours += (att.hoursWorked || 0);
});
return emp;
    });
allEmployees.sort((a, b) => a.number.localeCompare(b.number));

return `<div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #334155;">
                <div onclick="AnalyticsUI.togglePositionCollapse('general')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; border-bottom: ${isCollapsed ? 'none' : '1px solid #334155'}; padding-bottom: ${isCollapsed ? '0' : '16px'};">
                    <h3 style="margin: 0; color: #f1f5f9;">${icons.get('info')} Resumen General (${allEmployees.length})</h3>
                    <div style="color: #64748b;">${isCollapsed ? '▼' : '▲'}</div>
                </div>
    ${ isCollapsed ? '' : `<div class="sticky-table-container modern-scroll">${EmployeeReportGeneralTable(allEmployees, reportData.days)}</div>` }
            </div>`;
}

function EmployeeReportGeneralTable(employees, days) {
    return `<table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.875rem;">
                <thead>
                    <tr>
                        <th class="sticky-column" style="padding: 12px 8px; color: #94a3b8; text-align: left; width: 32px; min-width: 32px;">#</th>
                        <th class="sticky-column-2" style="padding: 12px 8px; color: #94a3b8; text-align: left; width: 130px; min-width: 130px; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Empleado</th>
                        ${days.map(d => `<th style="background: #1e293b; padding: 8px 4px; text-align: center; color: ${d.isHoliday ? '#f59e0b' : '#94a3b8'}; font-size: 0.7rem; min-width: 32px;">
                            <div>${['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.date.getDay()]}</div><div>${d.date.getDate()}</div>
                        </th>`).join('')}
                        <th style="background: #1e293b; padding: 12px 8px; color: #10b981; min-width: 50px;">Días</th>
                        <th style="background: #1e293b; padding: 12px 8px; color: #3b82f6; min-width: 50px;">Horas</th>
                    </tr>
                </thead>
                <tbody>
                    ${employees.map((emp, idx) => `
                        <tr style="background: ${idx % 2 === 0 ? '#0f172a' : '#1e293b'};">
                            <td class="sticky-column" style="padding: 10px 8px; color: #94a3b8; border-bottom: 1px solid #334155; background: inherit; width: 32px; min-width: 32px;">${emp.number}</td>
                            <td class="sticky-column-2" style="padding: 10px 8px; color: #f1f5f9; border-bottom: 1px solid #334155; background: inherit; width: 130px; min-width: 130px; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${emp.name}">${emp.name}</td>
                            ${days.map(d => {
        const val = emp.dayValues[getDateKey(d.date)];
        let color = '#334155';
        let text = '-';
        if (val > 0) {
            text = Number(val.toFixed(3));
            color = Math.abs(val - 1) < 0.01 ? (d.isHoliday ? '#f59e0b' : '#10b981') : (val < 1 ? '#ef4444' : '#3b82f6');
            if (Math.abs(val - 1) < 0.01) text = `${icons.get('check')}`;
        }
        return `<td style="padding: 10px 4px; text-align: center; color: ${color}; border-bottom: 1px solid #1e293b; font-weight: 700;">${text}</td>`;
    }).join('')}
                            <td style="padding: 10px 8px; text-align: center; color: #10b981; border-bottom: 1px solid #1e293b;">${Number(emp.totalDays.toFixed(3))}</td>
                            <td style="padding: 10px 8px; text-align: center; color: #3b82f6; border-bottom: 1px solid #1e293b;">${emp.totalHours.toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
}

function EmployeeReportPositionSection(posData, days) {
    const state = getState();
    const collapses = state.collapsedPositions || {};
    const isCollapsed = collapses[posData.position.id];
    return `<div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 16px; border: 1px solid #334155;">
    <div onclick="AnalyticsUI.togglePositionCollapse('${posData.position.id}')" style="display: flex; justify-content: space-between; align-items: center; cursor: pointer; border-bottom: ${isCollapsed ? 'none' : '1px solid #334155'}; padding-bottom: ${isCollapsed ? '0' : '16px'};">
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 12px; height: 12px; border-radius: 50%; background: ${posData.position.color};"></div>
            <h3 style="margin: 0; color: #f1f5f9;">${posData.position.name} (${posData.employees.length})</h3>
        </div>
        <div style="color: #64748b;">${isCollapsed ? '▼' : '▲'}</div>
    </div>
                ${ isCollapsed ? '' : `<div class="sticky-table-container modern-scroll">${EmployeeReportTable(posData, days)}</div>` }
            </div>`;
}

function EmployeeReportTable(posData, days) {
    return `<table style="width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.875rem;">
                <thead>
                    <tr>
                        <th class="sticky-column" style="padding: 12px 8px; color: #94a3b8; text-align: left; width: 32px; min-width: 32px;">#</th>
                        <th class="sticky-column-2" style="padding: 12px 8px; color: #94a3b8; text-align: left; width: 130px; min-width: 130px; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Nombre</th>
                        ${days.map(d => `<th style="padding: 8px 4px; text-align: center; color: #fff; background: ${d.isHoliday ? '#f59e0b' : '#3b82f6'}; min-width: 32px; font-size: 0.75rem;">${d.date.getDate()}</th>`).join('')}
                        <th style="padding: 12px 8px; color: #10b981; background: #1e293b; min-width: 60px;">TOTAL</th>
                    </tr>
                </thead>
                <tbody>
                    ${posData.employees.map(emp => `
                        <tr style="border-bottom: 1px solid #334155;">
                            <td class="sticky-column" style="padding: 12px 8px; color: #f1f5f9; background: inherit; width: 32px; min-width: 32px;">${emp.number}</td>
                            <td class="sticky-column-2" style="padding: 12px 8px; color: #f1f5f9; background: inherit; width: 130px; min-width: 130px; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${emp.name}">${emp.name}</td>
                            ${days.map(d => {
        const val = emp.dayValues[getDateKey(d.date)] || 0;
        let color = '#334155';
        if (val > 0) color = val < 0.75 ? '#ef4444' : val < 1 ? '#f59e0b' : val === 1 ? '#10b981' : '#3b82f6';
        return `<td style="padding: 8px 4px; text-align: center; background: ${color}; color: white; font-weight: 600;">${val > 0 ? Number(val.toFixed(3)) : '0'}</td>`;
    }).join('')}
                            <td style="padding: 12px 8px; text-align: center; color: #10b981; background: #0f172a;">${Number(emp.total.toFixed(3))}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>`;
}

function calculateEmployeeReportData() {
    const state = getState();
    const startDate = state.employeeReportStartDate;
    const endDate = state.employeeReportEndDate;
    const regularHours = state.settings.regularHoursPerDay;
    const holidayFactor = state.settings.holidayFactor;
    const startDateObj = parseDate(startDate);
    const endDateObj = parseDate(endDate);

    const days = [];
    for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
        const date = new Date(d);
        days.push({ date: date, isHoliday: isDayHoliday(date) });
    }

    const activePositions = state.positions.filter(p => p.active);
    const positions = [];

    activePositions.forEach(position => {
        const employees = [];
        const empsByPosition = state.employees.filter(e => {
            if (!wasEmployeeActiveInRange(e, startDate, endDate, state.attendance)) return false;
            return (e.positions && Array.isArray(e.positions) && e.positions.includes(position.id)) || e.position === position.id;
        });

        empsByPosition.forEach(emp => {
            const dayValues = {};
            let total = 0;
            days.forEach(day => {
                const dateKey = getDateKey(day.date);
                const att = state.attendance[`${emp.id}-${dateKey}`];
                if (att && att.present) {
                    let dayValue = 0;
                    if (att.multiPosition && att.positionHours) {
                        const posHours = att.positionHours.find(ph => ph.positionId === position.id);
                        if (posHours) dayValue = (posHours.hours || 0) / regularHours;
                    } else {
                        const selectedPos = att.selectedPosition || (emp.positions || [])[0];
                        if (selectedPos !== position.id) return;
                        dayValue = (att.hoursWorked || 0) / regularHours;
                    }

                    if (day.isHoliday || att.isHoliday) dayValue *= (holidayFactor || 1);
                    if (!isNaN(dayValue)) { dayValues[dateKey] = dayValue; total += dayValue; }
                }
            });
            if (!isNaN(total)) employees.push({ id: emp.id, number: emp.number, name: emp.name, dayValues, total });
        });
        if (employees.length > 0) positions.push({ position, employees });
    });

    return { days, positions };
}

// ✅ wasEmployeeActiveInRange migrado a js/modules/utils/DateUtils.js

function EmployeeReportStartDatePicker() {
    const state = getState();
    return generateDatePicker(state.employeeReportStartPickerMonth, state.employeeReportStartDate, 'AnalyticsUI.selectEmployeeReportStartDate', 'AnalyticsUI.changeEmployeeReportStartPickerMonth');
}

function EmployeeReportEndDatePicker() {
    const state = getState();
    return generateDatePicker(state.employeeReportEndPickerMonth, state.employeeReportEndDate, 'AnalyticsUI.selectEmployeeReportEndDate', 'AnalyticsUI.changeEmployeeReportEndPickerMonth');
}

function generateDatePicker(month, selectedDate, selectFunc, changeMonthFunc) {
    const year = month.getFullYear();
    const monthIndex = month.getMonth();
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const startDayOfWeek = firstDay.getDay();
    const prevMonthLastDay = new Date(year, monthIndex, 0).getDate();
    const days = [];

    for (let i = startDayOfWeek - 1; i >= 0; i--) days.push({ date: new Date(year, monthIndex - 1, prevMonthLastDay - i), currentMonth: false });
    for (let i = 1; i <= lastDay.getDate(); i++) days.push({ date: new Date(year, monthIndex, i), currentMonth: true });

    const today = getDateKey(new Date());
    const selected = getDateKey(selectedDate);
    const dayNames = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];

    return `<div class="date-picker" onclick="event.stopPropagation()">
                <div class="date-picker-header">
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); ${changeMonthFunc}(-1)">${icons.get('edit')}</button>
                    <div class="date-picker-month">${formatMonthYear(month)}</div>
                    <button class="date-btn" style="width:32px;height:32px;font-size:1rem;" onclick="event.stopPropagation(); ${changeMonthFunc}(1)">${icons.get('edit')}</button>
                </div>
                <div class="date-picker-grid">
                    ${dayNames.map(d => `<div class="date-picker-day-label">${d}</div>`).join('')}
                    ${days.map(d => {
        const dKey = getDateKey(d.date);
        let cls = 'date-picker-day' + (d.currentMonth ? '' : ' other-month') + (dKey === today ? ' today' : '') + (dKey === selected ? ' selected' : '');
        return `<div class="${cls}" onclick="event.stopPropagation(); ${selectFunc}('${d.date.toISOString()}')">${d.date.getDate()}</div>`;
    }).join('')}
                </div>
            </div>`;
}

// ============================================
// EXPORT FUNCTIONS & WINDOW HANDLERS
// ============================================

export function setDashboardChart(chartType) {
    getState().dashboardChart = chartType;
    context.render();
}
export function toggleStartDatePicker() { dashboardDateManagerV2.toggleStartPicker(); context.render(); }
export function toggleEndDatePicker() { dashboardDateManagerV2.toggleEndPicker(); context.render(); }
export function changeStartDatePickerMonth(delta) { dashboardDateManagerV2.changeStartMonth(delta); context.render(); }
export function changeEndDatePickerMonth(delta) { dashboardDateManagerV2.changeEndMonth(delta); context.render(); }
export function selectStartDate(dateStr) { dashboardDateManagerV2.selectStartDate(dateStr); context.render(); }
export function selectEndDate(dateStr) { dashboardDateManagerV2.selectEndDate(dateStr); context.render(); }
export function setDashboardThisWeek() { dashboardDateManagerV2.setThisWeek(); memoCache.clear('chart-'); context.render(); }
export function setDashboardThisMonth() { dashboardDateManagerV2.setThisMonth(); memoCache.clear('chart-'); context.render(); }
export function setDashboardLast30Days() { dashboardDateManagerV2.setLast30Days(); memoCache.clear('chart-'); context.render(); }

export function changeReportViewMode(mode) { getState().reportViewMode = mode; context.render(); }
export function toggleEmployeeReportStartPicker() { employeeReportDateManagerV2.toggleStartPicker(); context.render(); }
export function toggleEmployeeReportEndPicker() { employeeReportDateManagerV2.toggleEndPicker(); context.render(); }
export function changeEmployeeReportStartPickerMonth(delta) { employeeReportDateManagerV2.changeStartMonth(delta); context.render(); }
export function changeEmployeeReportEndPickerMonth(delta) { employeeReportDateManagerV2.changeEndMonth(delta); context.render(); }
export function selectEmployeeReportStartDate(dateStr) { employeeReportDateManagerV2.selectStartDate(dateStr); context.render(); }
export function selectEmployeeReportEndDate(dateStr) { employeeReportDateManagerV2.selectEndDate(dateStr); context.render(); }
export function setEmployeeReportThisWeek() { employeeReportDateManagerV2.setThisWeek(); memoCache.clear('report-'); context.render(); }
export function setEmployeeReportThisMonth() { employeeReportDateManagerV2.setThisMonth(); memoCache.clear('report-'); context.render(); }
export function setEmployeeReportLast30Days() { employeeReportDateManagerV2.setLast30Days(); memoCache.clear('report-'); context.render(); }
export function togglePositionCollapse(id) {
    const state = getState();
    if (!state.collapsedPositions) state.collapsedPositions = {};
    state.collapsedPositions[id] = !state.collapsedPositions[id];
    context.render();
}

export async function exportEmployeeReportExcel() {
    const state = getState();
    const reportData = calculateEmployeeReportData();
    if (reportData.positions.length === 0) {
        if (window.showNotification) window.showNotification(`${ icons.get('info') } No hay datos para exportar`, 'error');
        return;
    }
    if (window.showNotification) window.showNotification(`${ icons.get('info') } Generando Excel...`, 'info');

    if (window.ExcelJS) {
        const workbook = new window.ExcelJS.Workbook();
        workbook.creator = state.settings.companyName;
        workbook.created = new Date();
        const startLabel = formatDateShort(state.employeeReportStartDate);
        const endLabel = formatDateShort(state.employeeReportEndDate);

        // -------- CONFIGURACIÓN DE ESTILOS --------
        const headerStyle = {
            font: { bold: true, color: { argb: 'FFFFFFFF' } },
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: {
                top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' }
            }
        };

        const sundayStyle = {
            fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE4E1' } } // MistyRose (un rojo muy suave)
        };

        const spanishDays = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

        const applyTableStyles = (sheet, dateStartIndex, dateEndIndex) => {
            // Estilo a las dos primeras filas (encabezado doble)
            [1, 2].forEach(rowNum => {
                const row = sheet.getRow(rowNum);
                row.height = 25;
                row.eachCell((cell) => {
                    cell.style = headerStyle;
                });
            });

            // Resaltar Domingos en todo el rango de datos
            sheet.eachRow((row, rowNumber) => {
                for (let colIdx = dateStartIndex; colIdx <= dateEndIndex; colIdx++) {
                    const date = reportData.days[colIdx - dateStartIndex]?.date;
                    if (date && date.getDay() === 0) {
                        const cell = row.getCell(colIdx);
                        // Mezclamos el estilo (si es header mantenemos el color oscuro, si es data aplicamos el suave)
                        if (rowNumber > 2) {
                            cell.fill = sundayStyle.fill;
                        } else {
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF991B1B' } }; // Rojo oscuro para el header de domingo
                        }
                    }
                }
            });

            // Congelar Paneles (Filas: 2, Columnas: 2)
            sheet.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }];

            // Auto-filtro (en la fila 2 de fechas)
            sheet.autoFilter = {
                from: { row: 2, column: 1 },
                to: { row: 2, column: sheet.columnCount }
            };

            // Formato de celdas de datos
            sheet.eachRow((row, rowNumber) => {
                if (rowNumber > 2) {
                    row.eachCell((cell, colNumber) => {
                        cell.alignment = { vertical: 'middle', horizontal: colNumber <= 2 ? 'left' : 'center' };
                        if (typeof cell.value === 'number') {
                            cell.numFmt = '0.00####';
                        }
                    });
                }
            });
        };

        const dayColumns = reportData.days.map(d => ({
            header: spanishDays[d.date.getDay()], // Fila 1: Nombre del día
            key: getDateKey(d.date),
            width: 8
        }));

        const addSubHeader = (sheet, startCol, endCol, extraColsBefore = 2, extraColsAfter = 2) => {
            // Insertar la fila de números de fecha como fila 2
            const subHeaderRow = [];
            for (let i = 0; i < extraColsBefore; i++) subHeaderRow.push('');
            reportData.days.forEach(d => subHeaderRow.push(`${d.date.getDate()}/${d.date.getMonth() + 1}`));
            for (let i = 0; i < extraColsAfter; i++) subHeaderRow.push('');
            
            sheet.insertRow(2, subHeaderRow);
            
            // Mergear celdas del encabezado izquierdo
            sheet.mergeCells(1, 1, 2, 1); // #
            sheet.mergeCells(1, 2, 2, 2); // Nombre
            
            // Mergear celdas del encabezado derecho (Totales)
            const lastCol = sheet.columnCount;
            for (let i = 0; i < extraColsAfter; i++) {
                const col = lastCol - i;
                sheet.mergeCells(1, col, 2, col);
            }
        };

        // -------- CÁLCULO DE MÉTRICAS GLOBALES PARA DASHBOARD --------
        const globalMetrics = {
            totalHours: 0,
            totalOvertime: 0,
            totalDays: 0,
            uniqueEmployees: new Set(),
            leaderStats: {},
            positionStats: {},
            holidays: []
        };

        // Identificar feriados en el rango
        reportData.days.forEach(d => {
            if (isDayHoliday(d.date, state.settings.holidays)) {
                globalMetrics.holidays.push(formatDate(d.date));
            }
        });

        // Procesar todos los datos para métricas
        reportData.positions.forEach(posData => {
            const pos = posData.position;
            const leader = state.leaders.find(l => l.id === pos.leaderId);
            const leaderName = leader ? leader.name : 'Sin Líder';

            if (!globalMetrics.positionStats[pos.name]) globalMetrics.positionStats[pos.name] = 0;
            if (!globalMetrics.leaderStats[leaderName]) globalMetrics.leaderStats[leaderName] = 0;

            posData.employees.forEach(emp => {
                globalMetrics.uniqueEmployees.add(emp.id);
                globalMetrics.totalDays += emp.total;
                
                Object.keys(emp.dayValues).forEach(dateKey => {
                    const att = state.attendance[`${emp.id}-${dateKey}`];
                    if (att && att.present) {
                        const hours = att.hoursWorked || 0;
                        const dayLimit = state.dayHoursConfig[dateKey] ?? state.settings.regularHoursPerDay ?? 8;
                        const extra = Math.max(0, hours - dayLimit);
                        
                        globalMetrics.totalHours += hours;
                        globalMetrics.totalOvertime += extra;
                        globalMetrics.leaderStats[leaderName] += hours;
                        globalMetrics.positionStats[pos.name] += hours;
                    }
                });
            });
        });

        // -------- HOJA: DASHBOARD DE CONTROL --------
        const dashSheet = workbook.addWorksheet('Dashboard de Control');
        
        // Estilos para el Dashboard
        const titleStyle = { font: { size: 18, bold: true, color: { argb: 'FF1E293B' } } };
        const labelStyle = { font: { bold: true, color: { argb: 'FF64748B' } } };
        const kpiValueStyle = { font: { size: 14, bold: true, color: { argb: 'FF0F172A' } }, alignment: { horizontal: 'center' } };
        const kpiLabelStyle = { font: { size: 10, color: { argb: 'FF475569' } }, alignment: { horizontal: 'center' }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } } };

        // 1. Encabezado de la Compañía
        dashSheet.mergeCells('A1:E2');
        const titleCell = dashSheet.getCell('A1');
        titleCell.value = state.settings.companyName || 'Sistema de Asistencia';
        titleCell.style = titleStyle;
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

        dashSheet.getCell('A3').value = 'REPORTE DE ASISTENCIA Y PRODUCTIVIDAD';
        dashSheet.getCell('A3').font = { bold: true, color: { argb: 'FF334155' } };

        // 2. Información General
        dashSheet.getCell('A5').value = 'Desde:'; dashSheet.getCell('A5').style = labelStyle;
        dashSheet.getCell('B5').value = formatDate(state.employeeReportStartDate);
        dashSheet.getCell('A6').value = 'Hasta:'; dashSheet.getCell('A6').style = labelStyle;
        dashSheet.getCell('B6').value = formatDate(state.employeeReportEndDate);
        dashSheet.getCell('D5').value = 'Fecha Reporte:'; dashSheet.getCell('D5').style = labelStyle;
        dashSheet.getCell('E5').value = new Date().toLocaleDateString();

        // 3. Tarjetas KPI
        const kpis = [
            { label: 'EMPLEADOS', value: globalMetrics.uniqueEmployees.size },
            { label: 'HORAS TOTALES', value: globalMetrics.totalHours },
            { label: 'HORAS EXTRAS', value: globalMetrics.totalOvertime },
            { label: 'DÍAS TRABAJADOS', value: globalMetrics.totalDays }
        ];

        kpis.forEach((kpi, i) => {
            const col = String.fromCharCode(65 + i); // A, B, C, D
            dashSheet.getCell(`${col}8`).value = kpi.label;
            dashSheet.getCell(`${col}8`).style = kpiLabelStyle;
            dashSheet.getCell(`${col}9`).value = Number(kpi.value);
            dashSheet.getCell(`${col}9`).style = kpiValueStyle;
            dashSheet.getCell(`${col}9`).numFmt = '0.00####';
            dashSheet.getColumn(col).width = 18;
        });

        // 4. Tablas de Resumen
        let currentRow = 12;

        // Resumen por Líder
        dashSheet.getCell(`A${currentRow}`).value = 'RESUMEN POR LÍDER';
        dashSheet.getCell(`A${currentRow}`).font = { bold: true };
        currentRow++;
        dashSheet.getCell(`A${currentRow}`).value = 'Líder';
        dashSheet.getCell(`B${currentRow}`).value = 'Suma de Horas';
        dashSheet.getCell(`A${currentRow}`).style = headerStyle;
        dashSheet.getCell(`B${currentRow}`).style = headerStyle;
        
        Object.entries(globalMetrics.leaderStats)
            .sort((a, b) => b[1] - a[1])
            .forEach(([name, hours]) => {
                currentRow++;
                dashSheet.getCell(`A${currentRow}`).value = name;
                dashSheet.getCell(`B${currentRow}`).value = hours;
                dashSheet.getCell(`B${currentRow}`).numFmt = '0.00####';
            });

        // Resumen por Posición (Top 5)
        currentRow += 3;
        dashSheet.getCell(`A${currentRow}`).value = 'TOP 5 POSICIONES (POR HORAS)';
        dashSheet.getCell(`A${currentRow}`).font = { bold: true };
        currentRow++;
        dashSheet.getCell(`A${currentRow}`).value = 'Posición';
        dashSheet.getCell(`B${currentRow}`).value = 'Total Horas';
        dashSheet.getCell(`A${currentRow}`).style = headerStyle;
        dashSheet.getCell(`B${currentRow}`).style = headerStyle;

        Object.entries(globalMetrics.positionStats)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .forEach(([name, hours]) => {
                currentRow++;
                dashSheet.getCell(`A${currentRow}`).value = name;
                dashSheet.getCell(`B${currentRow}`).value = hours;
                dashSheet.getCell(`B${currentRow}`).numFmt = '0.00####';
            });

        // Listado de Feriados
        if (globalMetrics.holidays.length > 0) {
            currentRow += 3;
            dashSheet.getCell(`A${currentRow}`).value = 'DÍAS FERIADOS DETECTADOS';
            dashSheet.getCell(`A${currentRow}`).font = { bold: true };
            currentRow++;
            globalMetrics.holidays.forEach(h => {
                dashSheet.getCell(`A${currentRow}`).value = h;
                dashSheet.getCell(`A${currentRow}`).font = { color: { argb: 'FFEF4444' } };
                currentRow++;
            });
        }

        // -------- HOJA: RESUMEN GENERAL (EXISTENTE) --------
        const summarySheet = workbook.addWorksheet('Resumen General');
        summarySheet.columns = [
            { header: '#', key: 'number', width: 8 },
            { header: 'Empleado', key: 'name', width: 32 },
            ...dayColumns,
            { header: 'Días Total', key: 'totalDays', width: 12 },
            { header: 'Horas Total', key: 'totalHours', width: 12 }
        ];

        const allEmployeesMap = new Map();
        reportData.positions.forEach(posData => {
            posData.employees.forEach(empData => {
                if (!allEmployeesMap.has(empData.id)) {
                    allEmployeesMap.set(empData.id, { ...empData, dayValues: {}, totalDays: 0, totalHours: 0 });
                }
                const entry = allEmployeesMap.get(empData.id);
                Object.keys(empData.dayValues).forEach(dateKey => {
                    entry.dayValues[dateKey] = (entry.dayValues[dateKey] || 0) + empData.dayValues[dateKey];
                });
            });
        });

        const allEmployees = Array.from(allEmployeesMap.values());
        allEmployees.forEach(emp => {
            emp.totalDays = Object.values(emp.dayValues).reduce((sum, v) => sum + v, 0);
            reportData.days.forEach(day => {
                const att = state.attendance[`${emp.id}-${getDateKey(day.date)}`];
                if (att && att.present) emp.totalHours += (att.hoursWorked || 0);
            });
        });
        allEmployees.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

        allEmployees.forEach(emp => {
            const row = {
                number: emp.number,
                name: emp.name,
                totalDays: emp.totalDays,
                totalHours: emp.totalHours
            };
            reportData.days.forEach(day => {
                const key = getDateKey(day.date);
                row[key] = emp.dayValues[key] !== undefined ? emp.dayValues[key] : null;
            });
            summarySheet.addRow(row);
        });

        addSubHeader(summarySheet, 3, reportData.days.length + 2, 2, 2);
        applyTableStyles(summarySheet, 3, reportData.days.length + 2);

        // -------- HOJAS POR POSICIÓN --------
        reportData.positions.forEach(posData => {
            const sheetName = (posData.position?.name || 'Posición').replace(/[*?:\\/\[\]]/g, '').slice(0, 31);
            const sheet = workbook.addWorksheet(sheetName);
            sheet.columns = [
                { header: '#', key: 'number', width: 8 },
                { header: 'Nombre', key: 'name', width: 32 },
                ...dayColumns,
                { header: 'Total Días', key: 'total', width: 12 }
            ];

            posData.employees
                .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
                .forEach(emp => {
                    const row = {
                        number: emp.number,
                        name: emp.name,
                        total: emp.total
                    };
                    reportData.days.forEach(day => {
                        const key = getDateKey(day.date);
                        row[key] = emp.dayValues[key] !== undefined ? emp.dayValues[key] : null;
                    });
                    sheet.addRow(row);
                });
            
            addSubHeader(sheet, 3, reportData.days.length + 2, 2, 1);
            applyTableStyles(sheet, 3, reportData.days.length + 2);
        });

        // -------- HOJAS POR LÍDER (OPTIMIZADO) --------
        state.leaders.forEach(leader => {
            const leaderPositions = reportData.positions.filter(p => p.position.leaderId === leader.id);
            if (leaderPositions.length === 0) return;

            const sheetName = (`Líder - ${leader.name}`).replace(/[*?:\\/\[\]]/g, '').slice(0, 31);
            const sheet = workbook.addWorksheet(sheetName);
            
            sheet.columns = [
                { header: 'No.', key: 'idx', width: 8 },
                { header: 'Descripción/Nombre', key: 'name', width: 32 },
                { header: 'Ocupación/Posición', key: 'position', width: 25 },
                ...dayColumns,
                { header: 'Total Días', key: 'days', width: 12 }
            ];

            const employeeMap = new Map();
            leaderPositions.forEach(posData => {
                posData.employees.forEach(emp => {
                    if (!employeeMap.has(emp.id)) {
                        employeeMap.set(emp.id, {
                            id: emp.id,
                            number: emp.number,
                            name: emp.name,
                            items: []
                        });
                    }
                    employeeMap.get(emp.id).items.push({
                        positionName: posData.position.name,
                        total: emp.total,
                        dayValues: emp.dayValues
                    });
                });
            });

            const sortedEmployees = Array.from(employeeMap.values())
                .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

            sortedEmployees.forEach((emp, i) => {
                const baseIndex = i + 1;
                emp.items.forEach((item, j) => {
                    const suffix = j === 0 ? '' : String.fromCharCode(96 + (j + 1));
                    const row = {
                        idx: `${baseIndex}${suffix}`,
                        name: emp.name,
                        position: item.positionName,
                        days: item.total
                    };
                    reportData.days.forEach(day => {
                        const key = getDateKey(day.date);
                        row[key] = item.dayValues[key] !== undefined ? item.dayValues[key] : null;
                    });
                    sheet.addRow(row);
                });
            });
            
            addSubHeader(sheet, 4, reportData.days.length + 3, 3, 1);
            applyTableStyles(sheet, 4, reportData.days.length + 3);
        });

        // -------- GUARDAR Y DESCARGAR --------
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        const fileName = `Reporte_Personal_${state.employeeReportStartDate}_${state.employeeReportEndDate}.xlsx`.replace(/:/g, '-');
        link.download = fileName;
        link.click();
        
        if (window.showNotification) window.showNotification(`${icons.get('reports')} Excel exportado correctamente`, 'success');
    } else {
        if (window.showNotification) window.showNotification('Error: ExcelJS no está cargado', 'error');
    }
}
