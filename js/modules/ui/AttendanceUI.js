/**
 * 🎨 AttendanceUI.js - Componentes de la Interfaz de Asistencia
 * Parte de la Fase 4: Modularización y Componentización
 */

import { state, calculateStats, getEmployeeTotalHours } from '../core/AppState.js';
import icons from './IconSystem.js';
import { formatDateShort, getDateKey, wasEmployeeActiveInRange, wasEmployeeActiveOnDate, parseDate, isDayHoliday, getWeekRangeText, DateUtils } from '../utils/DateUtils.js';
import { ScrollService } from '../services/ScrollService.js';
import { componentMemo } from '../utils/MemoCache.js';

// Componentes y utilerías locales
// NOTA: Este archivo ahora importa explícitamente 'state', 'icons', y utilidades de fecha.

// --------------------------------------------------------------------------
// 📅 COMPONENTE: DateControlsCompact
// --------------------------------------------------------------------------
export function DateControlsCompact() {
    const isWeek = state.viewMode === 'week';
    const isLegacy = state.settings?.legacyNavigation;
    const isAsBottomBar = isWeek && isLegacy;

    const dateText = isWeek
        ? getWeekRangeText(state.selectedDate)
        : formatDateShort(state.selectedDate);

    // El picker ahora depende del estado global y funciones de window (Legacy bridge)
    const showPicker = state.showDatePicker && (state.datePickerTarget || 'full') === 'compact';
    const isVisible = (state.isScrolled || isAsBottomBar) && (state.activeTab === 'attendance');

    // Extraer lógica de DatePicker (Antes era ternario anidado)
    const datePickerHTML = (showPicker && typeof window.DatePicker === 'function')
        ? window.DatePicker()
        : '';

    const classes = [
        'date-controls-compact',
        isVisible ? 'visible' : '',
        isWeek ? 'at-bottom' : '',
        isAsBottomBar ? 'as-bottom-bar' : ''
    ].filter(Boolean).join(' ');

    const isToday = getDateKey(new Date()) === getDateKey(state.selectedDate);

    return `
            <div class="${classes}">
                <div class="pill-nav">
                    <button class="pill-btn" onclick="window.changeDate(-1)">
                        ${icons.get('chevron-left', { size: 18 })}
                    </button>
                    
                    <div class="pill-display" onclick="window.toggleDatePicker('compact'); event.stopPropagation();" style="position: relative; ${isToday ? 'border-color: rgba(6, 182, 212, 0.5);' : ''}">
                        ${icons.get('calendar', { size: 14, color: isToday ? '#06b6d4' : undefined })}
                        <span style="${isToday ? 'color: #06b6d4;' : ''}">${dateText}</span>
                        ${datePickerHTML}
                    </div>
                    
                    <button class="pill-btn" onclick="window.changeDate(1)">
                        ${icons.get('chevron-right', { size: 18 })}
                    </button>
                </div>
            </div>
        `;
}

/**
 * 🕒 Obtener horas configuradas para un día específico
 */
export function getDayHours(date) {
    const key = getDateKey(date);
    return state.dayHoursConfig[key] ?? state.settings.regularHoursPerDay;
}

/**
 * 🎨 Determinar el color del checkbox basado en el estado
 */
export function getCheckColor(att, date) {
    if (!att || !att.present) return 'check-empty';
    // Multi-posición (MORADO)
    if (att.positionHours && att.positionHours.length > 1) {
        return 'check-multiposition';
    }
    // Día festivo (DORADO)
    if (isDayHoliday(date, state.settings?.holidays)) return 'check-holiday';
    
    // Horas trabajadas vs Configuración Global General
    const hours = att.hoursWorked || 0;
    const regular = state.settings?.regularHoursPerDay || 8; 
    const tolerance = 0.1;

    if (hours > regular + tolerance) return 'check-overtime';
    if (hours < regular - tolerance) return 'check-undertime';
    return 'check-regular';
}

function ViewModeSelector() {
    //   <!-- 1. NIVEL SUPERIOR: Selector de Vista -->
    return `

            <div class="view-mode-container" style="margin-bottom: 16px; display: flex; justify-content: center;">
                <div class="segmented-control" style="width: 200px;">
                    <button class="segmented-item ${state.viewMode === 'day' ? 'active' : ''}" onclick="window.changeViewMode('day')">${dayLabel}</button>
                    <button class="segmented-item ${state.viewMode === 'week' ? 'active' : ''}" onclick="window.changeViewMode('week')">${weekLabel}</button>
                </div>
            </div>
        `;
}
function navPillSelectorDeFecha(isToday, displayText, datePickerHTML) {
    //<!-- 2. NIVEL MEDIO: Nav Pill (Fecha) -->
    const iconoCalendario = icons.get('calendar', { size: 18, color: isToday ? '#06b6d4' : undefined });
    const flechaDerecha = icons.get('chevron-right');
    const flechaIzquierda = icons.get('chevron-left');
    let colorBorde = isToday ? 'rgba(6, 182, 212, 0.5)' : '';
    let colorTexto = isToday ? '#06b6d4' : '';


    return `<div class="pill-nav" style="margin-bottom: 20px;">
                <button class="pill-btn" onclick="window.changeDate(-1)">${flechaIzquierda}</button>
                <div class="pill-display" onclick="window.toggleDatePicker('full'); event.stopPropagation();" style="position: relative; ${colorBorde}">
                    ${iconoCalendario}
                    <span style="${colorTexto}">${displayText}</span>
                    ${datePickerHTML}
                </div>
                <button class="pill-btn" onclick="window.changeDate(1)">${flechaDerecha}</button>
            </div>`
}
//            <!-- 3. NIVEL INFERIOR: Controles Equilibrados -->

function ControlesAsistenciaFeriado(isHoliday) {
    //    <!-- Seccion Feriado (Izquierda - 1fr) -->
    let title, icono, clase = "";

    if (isHoliday) {
        title = "Día Feriado";
        icono = "palmtree";
        clase = "active";

    } else {
        title = "Día Laboral";
        icono = "briefcase";
    }
    return `          
             <div class="view-controls-row">
                <div class="control-section side-control">
                    <div class="control-section-label">Feriado</div>
                    <div class="holiday-control ${clase}" onclick="window.toggleHoliday()" title="${title}">
                        <div class="holiday-icon-box">
                            ${icons.get(icono, { size: 20 })}
                        </div>
                        <div class="switch-toggle">
                            <div class="switch-handle"></div>
                        </div>
                    </div>
                </div>`
}
function ControlesAsistenciaHorasBase(hourColor, dayHours) {
    //    <!-- Seccion Horas a Asignar (Centro - Auto) -->
    return `          
                <div class="control-section center-control">
                    <div class="control-section-label">Horas a Asignar</div>
                    <div class="stepper-container" title="Horas a asignar para este día">
                        <button class="stepper-btn" onclick="window.changeBaseHours(-0.5)">-</button>
                        <div class="stepper-value" style="color: ${hourColor} !important;">${dayHours}h</div>
                        <button class="stepper-btn" onclick="window.changeBaseHours(0.5)">+</button>
                    </div>
                </div>`
}
function ControlesAsistenciaHoy(isToday, todayBtnStyle, todayIconColor) {
    //    <!-- Seccion Hoy (Derecha - 1fr) -->
    let color = isToday ? 'color: #06b6d4;' : '';

    return ` <div class="control-section side-control">
                 <div class="control-section-label">Navegación</div>
                <button class="btn-today-nav" onclick="window.goToToday()" title="Ir a hoy" style="${todayBtnStyle}">
                     ${icons.get('target', { size: 18, color: todayIconColor })}
                      <span style="${color}">Hoy</span>
                </button>
             </div>`
}


/**
 * 📅 COMPONENTE: DateControls (Estándar)
 */
export function DateControls() {
    const isHoliday = isDayHoliday(state.selectedDate, state.settings.holidays);
    const dayHours = getDayHours(state.selectedDate);
    const displayText = state.viewMode === 'week'
        ? getWeekRangeText(state.selectedDate)
        : formatDateShort(state.selectedDate);

    // Lógica de etiquetas adaptativas para ahorrar espacio en móvil
    const dayLabel = state.viewMode === 'day' ? 'Día' : 'D';
    const weekLabel = state.viewMode === 'week' ? 'Semana' : 'S';

    // Semántica de colores en horas (Refactorizado de operador ternario anidado)
    let hourColor = '#10b981'; // Verde (8h) - Default
    if (dayHours > 8) {
        hourColor = '#3b82f6'; // Azul (> 8h)
    } else if (dayHours < 8) {
        hourColor = '#ef4444'; // Rojo (< 8h)
    }

    // Seccion Hoy (Derecha - 1fr)
    const isToday = getDateKey(new Date()) === getDateKey(state.selectedDate);
    const todayBtnStyle = isToday
        ? 'background: rgba(6, 182, 212, 0.15); border-color: rgba(6, 182, 212, 0.5); color: #06b6d4;'
        : '';
    const todayIconColor = isToday ? '#06b6d4' : '#10b981';

    // Extraer lógica de DatePicker (Antes era ternario anidado)
    const showPicker = state.showDatePicker && (state.datePickerTarget || 'full') === 'full';
    const datePickerHTML = (showPicker && typeof window.DatePicker === 'function')
        ? window.DatePicker('full')
        : '';

    return `
        <div class="attendance-toolbar glass-effect" style="position: relative; z-index: 100; padding: 16px; border-radius: 20px; margin-bottom: 2px; box-shadow: 0 10px 25px rgba(0,0,0,0.25);">
            
            <!-- 1. NIVEL SUPERIOR: Selector de Vista -->
            <div class="view-mode-container" style="margin-bottom: 16px; display: flex; justify-content: center;">
                <div class="segmented-control" style="width: 200px;">
                    <button class="segmented-item ${state.viewMode === 'day' ? 'active' : ''}" onclick="window.changeViewMode('day')">${dayLabel}</button>
                    <button class="segmented-item ${state.viewMode === 'week' ? 'active' : ''}" onclick="window.changeViewMode('week')">${weekLabel}</button>
                </div>
            </div>

            <!-- 2. NIVEL MEDIO: Nav Pill (Fecha) -->
                ${navPillSelectorDeFecha(isToday, displayText, datePickerHTML)}
            
            <!-- 3. NIVEL INFERIOR: Controles Equilibrados -->
                ${ControlesAsistenciaFeriado(isHoliday)}

                <!-- Seccion Horas Base (Centro - Auto) -->
                ${ControlesAsistenciaHorasBase(hourColor, dayHours)}

                <!-- Seccion Hoy (Derecha - 1fr) -->
                ${ControlesAsistenciaHoy(isToday, todayBtnStyle, todayIconColor)}
            </div>
        </div>`;
}

// El componente ahora usa getWeekRangeText importado de DateUtils

/**
 * 🦴 Renderiza esqueletos de carga para una mejor percepción de velocidad.
 */
export function renderSkeleton(count = 5) {
    return Array(count).fill(0).map(() => `
        <div class="skeleton skeleton-item"></div>
    `).join('');
}

/**
 * 📊 Grid de Estadísticas (Presentes, Ausentes, Horas, Extras)
 */

function statCard(f, nombreID, nombre, icon, stats, filtro) {
    return `<div class="stat-item ${f === nombreID ? 'active' : ''}" onclick="setEmployeeFilter(${filtro})">
        <div class="stat-icon">${icon}</div>
        <div class="stat-value">${stats}</div>
        <div class="stat-label">${nombre}</div>
    </div>`
}



export function StatsGrid() {
    const stats = calculateStats();
    const f = state.employeeFilter;
    const filterNames = {
        present: 'Mostrando solo PRESENTES',
        absent: 'Mostrando solo AUSENTES',
        overtime: 'Mostrando solo con EXTRAS'
    };
    return `<div id="day-stats" class="stats-combined"><div class="stats-row">
    
             ${statCard(f, 'present', 'Presente', '✅', stats.present, `'present'`)}
             ${statCard(f, 'absent', 'Ausentes', '❌', stats.absent, `'absent'`)}
             ${statCard(f, 'time', 'Horas', '⏱️', stats.totalHours, `''`)}
             ${statCard(f, 'overtime', 'Extras', '⚡', stats.overtimeHours, `'overtime'`)}


            </div>${f ? `<div class="filter-status-notification">
                <span class="filter-status-text">🔍 ${filterNames[f]}</span>
                <button onclick="setEmployeeFilter(null)" class="view-btn" style="padding: 4px 12px; font-size: 0.75rem;">✕ Limpiar</button>
            </div>` : ''}</div>`;
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
            <button class="filters-toggle view-btn" onclick="toggleFilters()" style="width: 100%; justify-content: space-between;">
                <span style="color: #f1f5f9; font-weight: 600; font-size: 0.875rem;">🎯 Filtrar Posición</span>
                <span style="font-size: 1.25rem; color: #94a3b8;">${state.showFilters ? '▼' : '▶'}</span>
            </button>
            ${state.showFilters ? `
                <div class="filters-content position-filters-grid">
                    <button class="filter-btn ${currentFilter === 'all' ? 'active' : ''}" 
                            onclick="setPositionFilter('all')"
                            style="background: ${currentFilter === 'all' ? 'linear-gradient(135deg, #06b6d4, #10b981)' : '#1e293b'}; border: 2px solid ${currentFilter === 'all' ? '#06b6d4' : '#334155'}; 
                            padding: 10px; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
                        <span style="font-size: 0.875rem; font-weight: 600; color: #f1f5f9;">Todos</span>
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${currentFilter === 'all' ? '#fff' : '#06b6d4'};">${totalCount}</span>
                    </button>
                    ${activePositions.map(pos => `
                        <button class="filter-btn ${currentFilter === pos.id ? 'active' : ''}" 
                                onclick="setPositionFilter('${pos.id}')"
                                style="background: ${currentFilter === pos.id ? pos.color : '#1e293b'}; border: 2px solid ${currentFilter === pos.id ? pos.color : '#334155'}; padding: 10px; border-radius: 
                                8px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; align-items: center; gap: 4px;">
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
        <div class="search-wrapper">
            <div class="search-input-group">
                <input type="text" id="search-input" value="${searchValue}" oninput="setSearchFilter(this.value)"
                       placeholder="Buscar por nombre, número o posición..."
                       class="search-input-field">
                <span class="search-icon-fixed">🔍</span>
                ${searchValue ? `<button onclick="setSearchFilter('');" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px;">✕</button>` : ''}
            </div>
            <div class="search-input-group" style="flex: 2;">
                <div class="search-icon-fixed">
                    ${icons.get('key')}
                </div>
                <select onchange="setLeaderFilter(this.value)" 
                        class="search-input-field" style="padding-left: 36px; appearance: none; -webkit-appearance: none;">
                    <option value="all" ${leaderFilter === 'all' ? 'selected' : ''}>Todos los Líderes</option>
                    ${state.leaders.filter(l => l.active).map(l => `<option value="${l.id}" ${leaderFilter === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}
                </select>
                <div style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); pointer-events: none; opacity: 0.5; font-size: 0.75rem;">▼</div>
            </div>
        </div>
    `;
}


/**
 * 👤 Fila de Empleado (Vista Diaria / Relajada)
 */
export function EmployeeRow(emp) {
    const dateKey = getDateKey(state.selectedDate);
    const attKey = `${emp.id}-${dateKey}`;
    const att = state.attendance[attKey];

    // ⚡ P4-OPT: Solo regenerar si algo relevante cambió
    // - att.updatedAt: cambia cuando se registra/modifica asistencia de este empleado
    // - emp.updatedAt: cambia cuando se editan datos del empleado
    // - dateKey: cambia cuando el usuario navega a otra fecha
    return componentMemo.get(
        `emp-row-${emp.id}`,
        () => _buildEmployeeRow(emp, dateKey, attKey, att),
        [
            dateKey, 
            att?.updatedAt ?? 0, 
            emp.updatedAt ?? 0, 
            state.listDisplayMode,
            state.settings?.regularHoursPerDay || 8,
            getDayHours(state.selectedDate),
            (state.settings.holidays || []).join(',')
        ]
    );
}

function _buildEmployeeRow(emp, dateKey, key, att) {
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

    // Extraer badge de horas (Antes era ternario anidado)
    const multiPosIcon = isMultiPosition ? ' 🔄' : '';
    const hoursBadgeHTML = isChecked
        ? `<div class="hours-badge">${att.hoursWorked}h${multiPosIcon}</div>`
        : '';

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
                        ${hoursBadgeHTML}
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

    return `<div id="emp-row-${emp.id}" class="employee-row compact-mode employee-row-compact">
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
 * Se eliminó el uso de setTimeout + renderInChunks para prevenir parpadeos en renderizado reactivo.
 */
export function DayView() {
    const isHoliday = isDayHoliday(state.selectedDate, state.settings.holidays);
    const filtered = getFilteredEmployeesForDay();
    const listHTML = filtered.length > 0
        ? filtered.map(emp => state.listDisplayMode === 'compact' ? EmployeeRowCompact(emp) : EmployeeRow(emp)).join('')
        : '<div class="empty-state">No hay resultados</div>';

    return `
        <div class="day-view-page-mode ${isHoliday ? 'holiday-theme' : ''}">
            ${StatsGrid()}
            ${Legend()}
            ${PositionFilters()}
            
            <div class="sticky-controls-wrapper" style="margin-top: 12px; margin-bottom: 0;">
                ${SearchBar()}
            </div>
            
            <div id="day-view-list-parent" style="position: relative; margin-top: 16px;">
                <div id="day-view-list" class="employee-list ${state.listDisplayMode === 'compact' ? 'compact-list' : ''} sticky-table-container modern-scroll">
                    ${listHTML}
                </div>
                ${ScrollService.renderIndicators(filtered, true)}
            </div>
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
 * 📅 Vista Semanal Principal (WeekView)
 */
export function WeekView() {
    const week = DateUtils.getWeekDates(getDateKey(state.selectedDate));
    const filtered = getFilteredEmployeesForWeek(week);
    const tbodyHTML = filtered.length > 0
        ? filtered.map(emp => WeekRow(emp, week)).join('')
        : '<tr><td colspan="8"><div class="empty-state">No hay empleados registrados para este periodo</div></td></tr>';

    return `
        <div class="sticky-controls-wrapper" style="margin: 8px 0 16px 0;">
            ${SearchBar()}
        </div>
        <div id="week-view-list" class="sticky-table-container modern-scroll">
            <table class="week-view-table" style="margin-bottom: 100px;">
                <thead class="sticky-header">
                    <tr>
                        <th class="sticky-column" style="min-width: 180px;">EMPLEADO</th>
                        ${week.map(date => {
        const dObj = parseDate(date);
        const isH = isDayHoliday(date, state.settings?.holidays);
        const isS = dObj.getDay() === 0;
        return `<th class="${isH ? 'holiday-header' : ''} ${isS ? 'sunday-header' : ''}">${formatDateShort(dObj)}</th>`;
    }).join('')}
                    </tr>
                </thead>
                <tbody id="week-view-tbody">
                    ${tbodyHTML}
                </tbody>
                <tfoot>
                    ${WeekViewTotalsRow()}
                </tfoot>
            </table>
        </div>
    `;
}

export function WeekRow(emp, week) {
    // ⚡ P4-OPT: Fingerprint = updatedAt de cada día de la semana para este empleado
    const deps = [
        emp.updatedAt ?? 0, 
        (state.settings.holidays || []).join(','),
        state.settings?.regularHoursPerDay || 8,
        ...week.map(date => getDayHours(date)),
        ...week.map(date => {
            const att = state.attendance[`${emp.id}-${getDateKey(date)}`];
            return att?.updatedAt ?? 0;
        })
    ];
    return componentMemo.get(
        `week-row-${emp.id}-${getDateKey(week[0])}`,
        () => _buildWeekRow(emp, week),
        deps
    );
}

function _buildWeekRow(emp, week) {
    return `
        <tr id="week-row-${emp.id}">
            <td class="sticky-column">
                <div class="week-employee-cell">
                    <div class="employee-number">${emp.number}</div>
                    <div class="week-employee-name-container">
                        <div class="week-employee-name" style="cursor: pointer;" onclick="openEmployeeFloating('${emp.id}')">${emp.name}</div>
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
        const cColor = getCheckColor(att, parseDate(date));
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
    const week = DateUtils.getWeekDates(getDateKey(state.selectedDate));
    return `
        <tr id="week-totals-row" style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-top: 2px solid #06b6d4;">
            <td style="padding: 12px 16px; position: sticky; left: 0; background: #0f172a; z-index: 5;">
                <div style="font-weight: 700; color: #06b6d4; font-size: 0.875rem;">TOTALES</div>
            </td>
            ${week.map(date => {
        const dKey = getDateKey(date);
        // ⚡ P3-OPT: Lookup O(1) en lugar de filter O(N) sobre todo el historial
        const dayAttendance = (state.attendanceByDate[dKey] || []).filter(a => a.present);
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

    const week = DateUtils.getWeekDates(getDateKey(state.selectedDate));
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

// Asignar a window para que las llamadas desde FirebaseService y handlers de UI sigan funcionando
window.updateEmployeeRow = updateEmployeeRow;
window.updateWeekRow = updateWeekRow;
window.updateWeekTotals = updateWeekTotals;
window.getFilteredEmployeesForDay = getFilteredEmployeesForDay;
window.getFilteredEmployeesForWeek = getFilteredEmployeesForWeek;
window.getWeekDates = DateUtils.getWeekDates;
