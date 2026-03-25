/**
 * 🎨 AttendanceUI.js - Componentes de la Interfaz de Asistencia
 * Parte de la Fase 4: Modularización y Componentización
 */

import { state, calculateStats, getEmployeeTotalHours } from '../core/AppState.js';
import icons from './IconSystem.js';
import { formatDateShort, getDateKey, wasEmployeeActiveInRange, wasEmployeeActiveOnDate, parseDate, isDayHoliday } from '../utils/DateUtils.js';

// Componentes y utilerías locales
// NOTA: Este archivo ahora importa explícitamente 'state', 'icons', y utilidades de fecha.

// --------------------------------------------------------------------------
// 📅 COMPONENTE: DateControlsCompact
// --------------------------------------------------------------------------
export function DateControlsCompact() {
    const dateText = state.viewMode === 'week'
        ? getWeekRangeText(state.selectedDate)
        : formatDateShort(state.selectedDate);

    // El picker ahora depende del estado global y funciones de window (Legacy bridge)
    const showPicker = state.showDatePicker && (state.datePickerTarget || 'full') === 'compact';
    const isWeek = state.viewMode === 'week';
    // Forzado: En vista semanal siempre es visible porque el scroll es interno y no llegará a 200px en la página.
    const isVisible = (state.isScrolled || isWeek) && (state.activeTab === 'attendance');

    return `
            <div class="date-controls-compact ${isVisible ? 'visible' : ''} ${isWeek ? 'at-bottom' : ''}">
                <div class="date-navigation" style="display: flex; align-items: center; background: #1e293b; border-radius: 20px; padding: 4px 8px; border: 1px solid #334155;">
                    <button class="date-btn" onclick="changeDate(-1)" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px 8px; font-size: 1rem;">◀</button>
                    <div class="date-display" onclick="toggleDatePicker('compact')" style="padding: 0 10px; cursor: pointer;">
                        <span style="display:flex; align-items:center; gap:6px; font-size: 0.85rem; font-weight: 600; color: #f1f5f9;">
                            ${icons.get('calendar', { size: 14 })}
                            ${dateText}
                        </span>
                        ${showPicker ? (typeof window.DatePicker === 'function' ? window.DatePicker() : '') : ''}
                    </div>
                    <button class="date-btn" onclick="changeDate(1)" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 4px 8px; font-size: 1rem;">▶</button>
                </div>
            </div>
        `;
}

// Helper para DateControlsCompact (Mantenido local para desacoplar de app.js)
function getWeekRangeText(date) {
    if (typeof window.getWeekRangeText === 'function') return window.getWeekRangeText(date);
    // Simple fallback
    const d = new Date(date);
    const day = d.getDay() || 7;
    d.setHours(-24 * (day - 1));
    const start = d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
    d.setDate(d.getDate() + 6);
    const end = d.toLocaleDateString('es-DO', { day: 'numeric', month: 'short' });
    return `${start} - ${end}`;
}

/**
 * 🦴 Renderiza esqueletos de carga para una mejor percepción de velocidad.
 */
export function renderSkeleton(count = 5) {
    return Array(count).fill(0).map(() => `
        <div class="skeleton" style="height: 120px; margin-bottom: 16px; width: 100%; opacity: 0.2;"></div>
    `).join('');
}

/**
 * 📊 Grid de Estadísticas (Presentes, Ausentes, Horas, Extras)
 */
export function StatsGrid() {
    const stats = calculateStats();
    const f = state.employeeFilter;
    const filterNames = {
        present: 'Mostrando solo PRESENTES',
        absent: 'Mostrando solo AUSENTES',
        overtime: 'Mostrando solo con EXTRAS'
    };
    return `<div id="day-stats" class="stats-combined"><div class="stats-row">
                <div class="stat-item ${f === 'present' ? 'active' : ''}" onclick="setEmployeeFilter('present')">
                    <div class="stat-icon">✅</div>
                    <div class="stat-value">${stats.present}</div>
                    <div class="stat-label">Presentes</div>
                </div>
                <div class="stat-item ${f === 'absent' ? 'active' : ''}" onclick="setEmployeeFilter('absent')">
                    <div class="stat-icon">❌</div>
                    <div class="stat-value">${stats.absent}</div>
                    <div class="stat-label">Ausentes</div>
                </div>
                <div class="stat-item">
                    <div class="stat-icon">⏱️</div>
                    <div class="stat-value">${stats.totalHours}h</div>
                    <div class="stat-label">Horas</div>
                </div>
                <div class="stat-item ${f === 'overtime' ? 'active' : ''}" onclick="setEmployeeFilter('overtime')">
                    <div class="stat-icon">⚡</div>
                    <div class="stat-value">${stats.overtimeHours}h</div>
                    <div class="stat-label">Extras</div>
                </div>
            </div>${f ? `<div style="margin-top:12px;padding:8px 12px;background:rgba(6,182,212,0.1);border:1px solid rgba(6,182,212,0.3);border-radius:8px;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;"><span style="font-size:0.875rem;color:#06b6d4;font-weight:600;">🔍 ${filterNames[f]}</span><button onclick="setEmployeeFilter(null)" style="background:#1e293b;border:1px solid #334155;color:#94a3b8;padding:4px 12px;border-radius:6px;font-size:0.75rem;cursor:pointer;font-weight:600;">✕ Limpiar</button></div>` : ''}</div>`;
}

/**
 * 🎨 Leyenda de colores explicativa
 */
export function Legend() {
    return `<div class="legend"><div class="legend-header" onclick="toggleLegend()"><div class="legend-title">🎨 Leyenda de Colores</div><div style="color:#64748b;font-size:1.25rem;">${state.showLegend ? '▼' : '▶'}</div></div>${state.showLegend ? '<div class="legend-items"><div class="legend-item"><div class="legend-color check-regular"></div><span class="legend-text">Regular</span></div><div class="legend-item"><div class="legend-color check-multiposition"></div><span class="legend-text">Multi-Pos</span></div><div class="legend-item"><div class="legend-color check-holiday"></div><span class="legend-text">Festivo</span></div><div class="legend-item"><div class="legend-color check-overtime"></div><span class="legend-text">Extras</span></div><div class="legend-item"><div class="legend-color check-undertime"></div><span class="legend-text">Menos</span></div></div>' : ''}</div>`;
}

/**
 * 🎯 Filtros rápidos por Posición
 */
export function PositionFilters() {
    const allActivePositions = state.positions.filter(p => p.active);
    const seenNames = new Set();
    const activePositions = allActivePositions.filter(pos => {
        if (seenNames.has(pos.name)) return false;
        seenNames.add(pos.name);
        return true;
    });
    const activeEmployees = state.employees.filter(e => wasEmployeeActiveOnDate(e, state.selectedDate));

    const positionCounts = {};
    activePositions.forEach(pos => {
        const sameNameIds = allActivePositions.filter(p => p.name === pos.name).map(p => p.id);
        positionCounts[pos.id] = activeEmployees.filter(emp =>
            emp.positions.some(pId => sameNameIds.includes(pId))
        ).length;
    });

    const totalCount = activeEmployees.length;
    const currentFilter = state.filters.position;

    return `
        <div class="position-filters-container" style="margin-top: 16px;">
            <button class="filters-toggle" onclick="toggleFilters()" 
                    style="width: 100%; background: #1e293b; border: 1px solid #334155; padding: 10px 14px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; cursor: pointer; transition: all 0.2s;">
                <span style="color: #f1f5f9; font-weight: 600; font-size: 0.875rem;">🎯 Filtrar Posición</span>
                <span style="font-size: 1.25rem; color: #94a3b8;">${state.showFilters ? '▼' : '▶'}</span>
            </button>
            ${state.showFilters ? `
                <div class="filters-content" style="margin-top: 12px; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px;">
                    <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" 
                            onclick="setPositionFilter('all')"
                            style="background: ${currentFilter === 'all' ? 'linear-gradient(135deg, #06b6d4, #10b981)' : '#1e293b'}; border: 2px solid ${currentFilter === 'all' ? '#06b6d4' : '#334155'}; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="font-size: 0.875rem; font-weight: 600; color: #f1f5f9;">Todos</span>
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${currentFilter === 'all' ? '#fff' : '#06b6d4'};">${totalCount}</span>
                    </button>
                    ${activePositions.map(pos => `
                        <button class="filter-btn ${currentFilter === pos.id ? 'active' : ''}" 
                                onclick="setPositionFilter('${pos.id}')"
                                style="background: ${currentFilter === pos.id ? pos.color : '#1e293b'}; border: 2px solid ${currentFilter === pos.id ? pos.color : '#334155'}; padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                            <span style="font-size: 0.875rem; font-weight: 600; color: ${currentFilter === pos.id ? '#fff' : '#f1f5f9'};">${pos.name}</span>
                            <span style="font-size: 1.25rem; font-weight: 700; color: ${currentFilter === pos.id ? '#fff' : pos.color};">${positionCounts[pos.id] || 0}</span>
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `;
}

/**
 * 🔍 Barra de Búsqueda con Filtro de Líder
 */
export function SearchBar() {
    const searchValue = state.filters.search || '';
    const leaderFilter = state.filters.leaderId || 'all';

    return `
        <div class="search-container" style="margin-bottom: 16px; display: flex; gap: 12px; width: 100%;">
            <div style="position: relative; flex: 3;">
                <input type="text" id="search-input" value="${searchValue}" oninput="setSearchFilter(this.value)"
                       placeholder="🔍 Buscar por nombre, número o posición..."
                       style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; padding-left: 36px; border-radius: 8px; font-size: 0.875rem;">
                <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 1rem; opacity: 0.5;">🔍</span>
                ${searchValue ? `<button onclick="setSearchFilter('');" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px;">✕</button>` : ''}
            </div>
            <div style="flex: 2; position: relative;">
                <div style="position: absolute; left: 12px; top: 52%; transform: translateY(-50%); font-size: 1rem; opacity: 0.5; display: flex; align-items: center;">
                    ${icons.get('key')}
                </div>
                <select onchange="setLeaderFilter(this.value)" 
                        style="width: 100%; background: #1e293b; border: 1px solid #334155; color: #f1f5f9; padding: 10px 12px; padding-left: 36px; border-radius: 8px; font-size: 0.875rem; cursor: pointer; outline: none; appearance: none; -webkit-appearance: none;">
                    <option value="all" ${leaderFilter === 'all' ? 'selected' : ''}>Todos los Líderes</option>
                    ${state.leaders.filter(l => l.active).map(l => `<option value="${l.id}" ${leaderFilter === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
                </select>
                <div style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5; font-size: 0.75rem;">▼</div>
            </div>
        </div>
    `;
}

/**
 * 🎨 Determina el color del check según tipo de jornada
 * (Migrado desde app.js para independencia modular)
 */
function getCheckColor(att, date) {
    if (!att || !att.present) return '';
    // Multi-posición (MORADO)
    if (att.positionHours && att.positionHours.length > 1) {
        return 'check-multiposition';
    }
    // Día festivo (DORADO)
    if (isDayHoliday(date, state.settings?.holidays)) return 'check-holiday';
    // Horas trabajadas
    const tolerance = 0.1;
    const hours = att.hoursWorked || 0;
    const regular = state.settings?.regularHoursPerDay || 8;
    if (hours > regular + tolerance) return 'check-overtime';
    if (hours < regular - tolerance) return 'check-undertime';
    return 'check-regular';
}

/**
 * 👤 Fila de Empleado (Vista Diaria / Relajada)
 */
export function EmployeeRow(emp) {
    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const checkColor = getCheckColor(att, state.selectedDate);
    const isChecked = att && att.present;
    const selPos = att?.selectedPosition || emp.positions?.[0] || null;
    const isMultiPosition = att?.multiPosition || false;
    const hasMultiplePositions = emp.positions.length > 1;

    // 👆 Tocar registro para caché LRU
    if (att && typeof attendanceService !== 'undefined') attendanceService.touchRecord(emp.id, getDateKey(state.selectedDate));

    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthHours = getEmployeeTotalHours(emp.id, firstDay, today);
    let monthDays = 0;
    let monthOvertimeHours = 0;
    for (let d = new Date(firstDay); d <= today; d.setDate(d.getDate() + 1)) {
        const k = `${emp.id}-${getDateKey(new Date(d))}`;
        const a = state.attendance[k];
        if (a && a.present) {
            monthDays++;
            if (a.overtimeHours) monthOvertimeHours += a.overtimeHours;
        }
    }

    const selectedPosId = state.tempPositionSelection?.[key] || emp.positions[0];

    return `<div id="emp-row-${emp.id}" class="employee-row">
                <div class="employee-info">
                    <div class="employee-header">
                        <div class="employee-number">${emp.number}</div>
                        <div class="employee-name" onclick="openEmployeeFloating('${emp.id}')">${emp.name}${!emp.active ? '<span style="margin-left:8px;padding:2px 8px;background:rgba(239,68,68,0.2);border:1px solid #ef4444;border-radius:6px;font-size:0.65rem;color:#ef4444;font-weight:600;">INACTIVO</span>' : ''}</div>
                    </div>
                    <div class="position-toggles" style="margin-top: 8px;">
                        ${emp.positions.map(pid => {
        const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
        const isActive = isChecked ? (selPos === pid) : (selectedPosId === pid);
        return `<button class="position-toggle ${isActive ? 'active' : ''}" 
                                                   onclick="${isChecked ? `togglePosition('${emp.id}', '${pid}')` : `event.stopPropagation(); selectTempPosition('${emp.id}', '${pid}')`}">
                                        <span class="pos-dot" style="background:${pos.color || "#64748b"};"></span>${pos.name || "Posición"}
                                    </button>`;
    }).join('')}
                    </div>
                    ${isMultiPosition ? `
                        <div class="multi-position-breakdown" style="margin-top: 8px; padding: 8px; background: #1e293b; border-radius: 6px; border: 1px solid #334155;">
                            <div style="font-size: 0.75rem; color: #06b6d4; margin-bottom: 4px; font-weight: 600;">🔄 Múltiples Posiciones:</div>
                            ${att.positionHours.map(ph => {
        const pos = state.positions.find(p => p.id === ph.positionId);
        return `<div style="display: flex; align-items: center; gap: 8px; font-size: 0.875rem; margin-bottom: 4px;">
                                            <span style="width: 8px; height: 8px; border-radius: 50%; background: ${pos?.color || '#64748b'};"></span>
                                            <span style="flex: 1; color: #f1f5f9;">${pos?.name || '?'}</span>
                                            <span style="color: #10b981; font-weight: 600;">${ph.hours}h${ph.overtimeHours > 0 ? ` +${ph.overtimeHours}h` : ''}</span>
                                        </div>`;
    }).join('')}
                        </div>
                    ` : ''}
                    <div class="employee-meta">
                        <div class="employee-meta-item">📅 ${monthDays} días</div>
                        <div class="employee-meta-divider"></div>
                        <div class="employee-meta-item">⏱️ ${monthHours}h</div>
                        ${monthOvertimeHours > 0 ? `<div class="employee-meta-divider"></div><div class="employee-meta-item" style="color:#06b6d4;">⚡ +${monthOvertimeHours}h extras mes</div>` : ''}
                    </div>
                    <div class="employee-meta" style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #1e293b; min-height: 24px; display: flex; align-items: center; overflow: hidden;">
                        ${isChecked && att.hoursWorked > state.settings.regularHoursPerDay ? `
                            <div class="employee-meta-item" style="color: #3b82f6; font-weight: 600; white-space: nowrap; flex-shrink: 0;">⚡ +${(att.hoursWorked - state.settings.regularHoursPerDay).toFixed(1)}h extras</div>
                        ` : ''}
                        ${isChecked && att.notes && att.notes.trim() ? `
                            <div class="employee-meta-divider"></div>
                            <div class="employee-meta-item" style="color: #94a3b8; font-size: 0.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; flex: 1;" 
                                 onclick="event.stopPropagation(); openAdvancedAttendance('${emp.id}')">
                                📝 ${att.notes}
                            </div>
                        ` : '<div style="height: 20px;"></div>'}
                    </div>
                </div>
                <div style="display: flex; flex-direction: column; gap: 8px; align-items: center; justify-content: flex-start; min-width: 80px; width: 80px; flex-shrink: 0;">
                    <label class="check-container" style="position: relative;">
                        <input type="checkbox" class="check-input" ${isChecked ? 'checked' : ''} onclick="handleCheckboxClick(event, '${emp.id}')">
                        <div class="check-box ${checkColor}">${isChecked ? '✓' : ''}</div>
                        ${isChecked ? `<div class="hours-badge">${att.hoursWorked}h${isMultiPosition ? ' 🔄' : ''}</div>` : ''}
                    </label>
                    ${isChecked && hasMultiplePositions ? `
                        <button onclick="event.stopPropagation(); openAdvancedAttendance('${emp.id}')" 
                                style="width: 40px; height: 40px; border-radius: 8px; background: #1e293b; border: 2px solid #334155; color: #06b6d4; font-size: 1.25rem; font-weight: 700; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center;">
                            +
                        </button>
                    ` : '<div style="width: 40px; height: 40px;"></div>'}
                </div>
            </div>`;
}

/**
 * 👤 Fila de Empleado (Vista Diaria / Compacta)
 */
export function EmployeeRowCompact(emp) {
    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const checkColor = getCheckColor(att, state.selectedDate);
    const isChecked = att && att.present;

    // 👆 Tocar registro para caché LRU
    if (att && typeof attendanceService !== 'undefined') attendanceService.touchRecord(emp.id, getDateKey(state.selectedDate));

    return `<div id="emp-row-${emp.id}" class="employee-row compact-mode" style="padding: 8px 12px; height: 60px; display: flex; align-items: center; border-bottom: 1px solid #1e293b;">
                <div style="width: 40px; font-family: monospace; color: #64748b; font-size: 0.75rem;">${emp.number}</div>
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="font-weight: 600; color: #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;" onclick="openEmployeeFloating('${emp.id}')">${emp.name}</div>
                    <div style="font-size: 0.7rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${emp.positions.map(pid => state.positions.find(p => p.id === pid)?.name).join(', ')}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${isChecked ? `<div style="color: #10b981; font-weight: 700; font-size: 0.875rem;">${att.hoursWorked}h</div>` : ''}
                    <label class="check-container" style="margin: 0;">
                        <input type="checkbox" class="check-input" ${isChecked ? 'checked' : ''} onclick="handleCheckboxClick(event, '${emp.id}')">
                        <div class="check-box ${checkColor}" style="width: 32px; height: 32px; font-size: 0.875rem;">${isChecked ? '✓' : ''}</div>
                    </label>
                </div>
            </div>`;
}

/**
 * 📅 Vista Diaria Principal (DayView)
 */
export function DayView() {
    setTimeout(() => {
        const filtered = getFilteredEmployeesForDay();
        window.renderInChunks('day-view-list', filtered, (emp) => {
            return state.listDisplayMode === 'compact' ? EmployeeRowCompact(emp) : EmployeeRow(emp);
        }, { initialHTML: renderSkeleton(10) });
    }, 0);

    return `
        ${StatsGrid()}
        ${Legend()}
        ${PositionFilters()}
        ${SearchBar()}
        ${DateControlsCompact()}
        <div id="day-view-list" class="employee-list ${state.listDisplayMode === 'compact' ? 'compact-list' : ''}">
            ${renderSkeleton(10)}
        </div>
    `;
}

/**
 * 🔍 Lógica de filtrado para DayView
 */
export function getFilteredEmployeesForDay() {
    const date = parseDate(state.selectedDate);
    let employees = state.employees.filter(emp => wasEmployeeActiveOnDate(emp, date));

    // Ordenar por número
    employees.sort((a, b) => (a.number || '').localeCompare(b.number || '', 'es', { numeric: true }));

    // Filtrar por Líder
    if (state.filters.leaderId && state.filters.leaderId !== 'all') {
        employees = employees.filter(emp => emp.positions?.some(pid => state.positions.find(p => p.id === pid)?.leaderId === state.filters.leaderId));
    }

    // Filtrar por Posición
    if (state.filters.position && state.filters.position !== 'all') {
        const selectedPos = state.positions.find(p => p.id === state.filters.position);
        if (selectedPos) {
            // Incluir todas las posiciones con el mismo nombre (por si hay IDs duplicados)
            const sameNameIds = state.positions.filter(p => p.name === selectedPos.name).map(p => p.id);
            employees = employees.filter(emp => emp.positions?.some(pid => sameNameIds.includes(pid)));
        }
    }

    // Filtrar por Estado (Presentes/Ausentes/Extras)
    if (state.employeeFilter) {
        const dateKey = getDateKey(state.selectedDate);
        const dayHours = state.dayHoursConfig?.[dateKey] ?? state.settings?.regularHoursPerDay ?? 8;
        employees = employees.filter(emp => {
            const att = state.attendance[`${emp.id}-${dateKey}`];
            const isChecked = att && att.present;
            if (state.employeeFilter === 'present') return isChecked;
            if (state.employeeFilter === 'absent') return !isChecked;
            if (state.employeeFilter === 'overtime') return isChecked && att.hoursWorked > dayHours;
            return true;
        });
    }

    // Filtrar por Búsqueda
    if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        employees = employees.filter(emp => {
            const matchesName = emp.name.toLowerCase().includes(term);
            const matchesNumber = emp.number.toLowerCase().includes(term);
            const matchesPosition = emp.positions?.some(pid => state.positions.find(p => p.id === pid)?.name.toLowerCase().includes(term));
            return matchesName || matchesNumber || matchesPosition;
        });
    }

    return employees;
}

/**
 * 📅 Calcula las 7 fechas de la semana para una fecha dada
 * (Migrado desde app.js para independencia modular)
 */
function getWeekDates(date) {
    const d = typeof date === 'string' ? parseDate(date) : date;
    const dayOfWeek = d.getDay();
    const diff = d.getDate() - dayOfWeek;
    const sunday = new Date(d);
    sunday.setDate(diff);
    const week = [];
    for (let i = 0; i < 7; i++) {
        const weekDay = new Date(sunday);
        weekDay.setDate(sunday.getDate() + i);
        week.push(weekDay);
    }
    return week;
}

/**
 * 📅 Vista Semanal Principal (WeekView)
 */
export function WeekView() {
    setTimeout(() => {
        const week = getWeekDates(new Date(state.selectedDate));
        const filtered = getFilteredEmployeesForWeek(week);
        window.renderInChunks('week-view-tbody', filtered, (emp) => WeekRow(emp, week), {
            initialHTML: `<tr><td colspan="8">${renderSkeleton(5)}</td></tr>`
        });
    }, 0);

    return `
        ${SearchBar()}
        ${DateControlsCompact()}
        <div id="week-view-list" class="sticky-table-container modern-scroll">
            <table class="week-view-table">
                <thead class="sticky-header">
                    <tr>
                        <th class="sticky-column" style="min-width: 180px;">EMPLEADO</th>
                        ${getWeekDates(new Date(state.selectedDate)).map(date => {
        const isH = isDayHoliday(date, state.settings?.holidays);
        const isS = date.getDay() === 0;
        return `<th class="${isH ? 'holiday-header' : ''} ${isS ? 'sunday-header' : ''}">${formatDateShort(date)}</th>`;
    }).join('')}
                    </tr>
                </thead>
                <tbody id="week-view-tbody">
                    <tr><td colspan="8">${renderSkeleton(5)}</td></tr>
                </tbody>
                <tfoot>
                    ${WeekViewTotalsRow()}
                </tfoot>
            </table>
        </div>
    `;
}

/**
 * 📏 Fila de Empleado (Vista Semanal)
 */
export function WeekRow(emp, week) {
    return `
        <tr id="week-row-${emp.id}">
            <td class="sticky-column">
                <div class="week-employee-cell">
                    <div class="employee-number">${emp.number}</div>
                    <div class="week-employee-name-container">
                        <div class="week-employee-name">${emp.name}</div>
                        <div class="week-employee-positions" style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">
                            ${emp.positions?.map(pid => state.positions.find(p => p.id === pid)?.name).filter(Boolean).join(' • ') || 'Sin posición'}
                        </div>
                    </div>
                </div>
            </td>
            ${week.map(date => {
        const dKey = getDateKey(date);
        const aKey = `${emp.id}-${dKey}`;
        const att = state.attendance[aKey];

        // 👆 Tocar registro para caché LRU
        if (att && typeof attendanceService !== 'undefined') {
            attendanceService.touchRecord(emp.id, dKey);
        }
        const isCh = att && att.present;
        const cColor = getCheckColor(att, date);
        const selP = att?.selectedPosition || emp.positions?.[0] || null;

        return `
                    <td>
                        <div class="day-cell">
                            <div class="week-check-wrapper" onclick="event.stopPropagation(); handleWeekCheck('${emp.id}', '${dKey}')">
                                <div class="check-box week-check-box ${cColor}">${isCh ? '✓' : ''}</div>
                                ${isCh ? `<div class="hours-badge">${att.hoursWorked}h</div>` : ''}
                            </div>
                            ${isCh && emp.positions?.length > 1 ? `
                                <div class="week-position-toggles">
                                    ${emp.positions.map(pid => {
            const pos = state.positions.find(p => p.id === pid);
            if (!pos) return '';
            const isSel = selP === pid;
            return `<button class="week-position-toggle ${isSel ? 'active' : ''}" 
                                                        onclick="event.stopPropagation(); toggleWeekPosition('${emp.id}', '${pid}', '${dKey}')">
                                                    ${pos.name.substring(0, 3)}
                                                </button>`;
        }).filter(Boolean).join('')}
                                </div>
                            ` : ''}
                        </div>
                    </td>
                `;
    }).join('')}
        </tr>
    `;
}

/**
 * 📏 Fila de Totales (Vista Semanal)
 */
export function WeekViewTotalsRow() {
    const week = getWeekDates(new Date(state.selectedDate));
    return `
        <tr id="week-totals-row" style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-top: 2px solid #06b6d4;">
            <td style="padding: 12px 16px; position: sticky; left: 0; background: #0f172a; z-index: 5;">
                <div style="font-weight: 700; color: #06b6d4; font-size: 0.875rem;">TOTALES</div>
            </td>
            ${week.map(date => {
        const dKey = getDateKey(date);
        const dayAttendance = Object.values(state.attendance).filter(a => a.date === dKey && a.present);
        const totalHours = dayAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
        const presentCount = dayAttendance.length;
        return `
                    <td style="text-align: center; padding: 12px 8px;">
                        <div style="color: #06b6d4; font-weight: 700; font-size: 1rem; margin-bottom: 4px;">${presentCount}</div>
                        <div style="font-size: 0.7rem; color: #94a3b8;">${totalHours.toFixed(1)}h</div>
                    </td>
                `;
    }).join('')}
        </tr>
    `;
}

/**
 * 🔍 Lógica de filtrado para WeekView
 */
export function getFilteredEmployeesForWeek(week) {
    const startDate = week[0];
    const endDate = week[6];
    let employees = state.employees.filter(emp => wasEmployeeActiveInRange(emp, startDate, endDate, state.attendance));
    employees.sort((a, b) => (a.number || '').localeCompare(b.number || '', 'es', { numeric: true }));

    if (state.filters.leaderId && state.filters.leaderId !== 'all') {
        employees = employees.filter(emp => emp.positions?.some(pid => state.positions.find(p => p.id === pid)?.leaderId === state.filters.leaderId));
    }

    if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        employees = employees.filter(emp => {
            const matchesName = emp.name.toLowerCase().includes(term);
            const matchesNumber = emp.number.toLowerCase().includes(term);
            const matchesPosition = emp.positions?.some(pid => state.positions.find(p => p.id === pid)?.name.toLowerCase().includes(term));
            return matchesName || matchesNumber || matchesPosition;
        });
    }

    return employees;
}

/**
 * 🔄 Funciones de actualización zonal (DOM Patching)
 * Se exportan y se asignan a window para compatibilidad con el sistema de eventos actual.
 */
export function updateEmployeeRow(empId) {
    const row = document.getElementById(`emp-row-${empId}`);
    if (!row) return;

    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    const newHTML = state.listDisplayMode === 'compact' ? EmployeeRowCompact(emp) : EmployeeRow(emp);
    const temp = document.createElement('div');
    temp.innerHTML = newHTML;
    const newRow = temp.firstElementChild;

    row.replaceWith(newRow);
}

export function updateWeekRow(empId) {
    const row = document.getElementById(`week-row-${empId}`);
    if (!row) return;

    const emp = state.employees.find(e => e.id === empId);
    if (!emp) return;

    const week = getWeekDates(new Date(state.selectedDate));
    const temp = document.createElement('tbody');
    temp.innerHTML = WeekRow(emp, week);
    const newRow = temp.firstElementChild;

    row.replaceWith(newRow);
}

export function updateWeekTotals() {
    const totalsRow = document.getElementById('week-totals-row');
    if (!totalsRow) return;

    const temp = document.createElement('table');
    temp.innerHTML = `<tfoot>${WeekViewTotalsRow()}</tfoot>`;
    const newTotalsRow = temp.querySelector('tr');

    totalsRow.replaceWith(newTotalsRow);
}

// Asignar a window para que las llamadas desde FirebaseService sigan funcionando
window.updateEmployeeRow = updateEmployeeRow;
window.updateWeekRow = updateWeekRow;
window.updateWeekTotals = updateWeekTotals;
