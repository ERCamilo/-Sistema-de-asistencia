/**
 * 🎨 AttendanceUI.js - Componentes de la Interfaz de Asistencia
 * Parte de la Fase 4: Modularización y Componentización
 */

import { state, calculateStats, getEmployeeTotalHours } from '../core/AppState.js';
import icons from './IconSystem.js';
import { entityInScope, peekEntityScope } from '../features/projects/ProjectContext.js';
import { formatDateShort, getDateKey, wasEmployeeActiveInRange, wasEmployeeActiveOnDate, isEmployeeVisibleOnDate, parseDate, isDayHoliday, getWeekRangeText, getPeriodRangeText, DateUtils } from '../utils/DateUtils.js';
import { ScrollService } from '../services/ScrollService.js';
import { componentMemo } from '../utils/MemoCache.js';
import { EmptyState } from '../components/EmptyState.js';
import { escapeHTML } from '../utils/Sanitize.js';
import { normalizeRegularHoursPerDay, resolveDailyTargetHours } from '../utils/AttendanceHours.js';
import {
    renderPositionIconSvg,
    resolveLeaderIcon,
    resolvePositionIcon,
    safePositionColor
} from '../features/employees/PositionVisuals.js';
import {
    buildAttendanceCardPeriodMetrics,
    formatAttendanceDecimal,
    formatAttendanceDayNumber,
    formatAttendanceDeficit
} from '../features/attendance/AttendanceCardMetrics.js';
import { EmployeeAvatar } from './components/EmployeeAvatar.js';

// Componentes y utilerías locales
// NOTA: Este archivo ahora importa explícitamente 'state', 'icons', y utilidades de fecha.

// ============================================
// 🎯 EVENT DELEGATION (data-action)
// ============================================
const _ACTION_MAP = {
    'change-date': (delta) => window.changeDate?.(parseFloat(delta)),
    'change-period-page': (delta) => window.changePeriodPage?.(parseInt(delta, 10)),
    'change-view-mode': (mode) => window.changeViewMode?.(mode),
    'go-to-today': () => window.goToToday?.(),
    'toggle-date-picker': (mode, _el, e) => { e?.stopPropagation(); window.toggleDatePicker?.(mode); },
    'toggle-holiday': () => window.toggleHoliday?.(),
    'change-base-hours': (delta) => window.changeBaseHours?.(parseFloat(delta)),
    'set-employee-filter': (val) => window.setEmployeeFilter?.(val === 'null' ? null : val),
    'set-position-filter': (id) => window.setPositionFilter?.(id),
    'set-search-filter': (_, el) => window.setSearchFilter?.(el.value),
    'set-leader-filter': (id, el) => window.setLeaderFilter?.(id ?? el?.value),
    'toggle-filters': () => window.toggleFilters?.(),
    'open-filter-catalog': (mode) => window.openAttendanceFilterCatalog?.(mode),
    'close-filter-catalog': () => window.closeAttendanceFilterCatalog?.(),
    'clear-search-filter': () => window.setSearchFilter?.(''),
    'view-employee-details': (id) => window.viewAttendanceEmployee?.(id),
    'open-advanced-attendance': (id, _el, e) => { e?.stopPropagation(); window.openAdvancedAttendance?.(id); },
    'handle-week-check': (_, el, e) => { e?.stopPropagation(); window.handleWeekCheck?.(el.dataset.empId, el.dataset.dateKey, e, el); },
    'toggle-week-position': (_, el, e) => { e?.stopPropagation(); window.toggleWeekPosition?.(el.dataset.empId, el.dataset.posId, el.dataset.dateKey); },
    'change-week-span': (val) => window.changeAttendanceWeekSpan?.(val),
    'change-period-page': (delta) => window.changePeriodPage?.(parseInt(delta, 10)),
    'toggle-legend': () => window.toggleLegend?.(),
    'toggle-weather': () => window.toggleWeatherExpanded?.(),
    'toggle-position': (_, el) => window.togglePosition?.(el.dataset.empId, el.dataset.posId),
    'select-temp-position': (_, el, e) => { e?.stopPropagation(); window.selectTempPosition?.(el.dataset.empId, el.dataset.posId); },
    'handle-checkbox-click': (_, el, e) => window.handleCheckboxClick?.(e, el.dataset.empId),
    'mark-visible-present': () => window.markVisibleEmployeesPresent?.(),
    'clear-visible-attendance': () => window.clearVisibleAttendance?.(),
    'open-mini-attendance-import': () => window.openMiniAttendanceImport?.()
};

function _handleAttendanceClick(e) {
    if (e.target.closest('.calendar-picker')) return;
    const target = e.target.closest('[data-att-action]');
    if (!target) return;
    const action = target.dataset.attAction;
    if (action === 'set-search-filter') return;
    if ((action === 'set-leader-filter' || action === 'set-position-filter') && target.tagName === 'SELECT') return;
    const handler = _ACTION_MAP[action];
    if (!handler) return;
    const arg = target.dataset.id ?? target.dataset.value ?? null;
    handler(arg, target, e);
}

function _handleAttendanceInput(e) {
    const target = e.target.closest('[data-att-action]');
    if (!target || target.dataset.attAction !== 'set-search-filter') return;
    _ACTION_MAP['set-search-filter']?.(null, target, e);
}

function _handleAttendanceChange(e) {
    const target = e.target.closest('[data-att-action]');
    if (!target) return;
    const action = target.dataset.attAction;
    if (action !== 'set-leader-filter' && action !== 'set-position-filter') return;
    _ACTION_MAP[action]?.(target.value, target, e);
}

function _handleAttendanceKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('.calendar-picker')) return;
    const target = e.target.closest('[data-att-action]');
    if (!target || target.tagName === 'BUTTON' || target.tagName === 'A') return;
    if (target.getAttribute('role') !== 'button') return;
    e.preventDefault();
    _handleAttendanceClick(e);
}

let _attendanceDelegationAttached = false;
export function attachAttendanceDelegation() {
    if (_attendanceDelegationAttached) return;
    document.addEventListener('click', _handleAttendanceClick);
    document.addEventListener('input', _handleAttendanceInput);
    document.addEventListener('change', _handleAttendanceChange);
    document.addEventListener('keydown', _handleAttendanceKeydown);
    _attendanceDelegationAttached = true;
}
attachAttendanceDelegation();

// --------------------------------------------------------------------------
// 📅 COMPONENTE: DateControlsCompact
// --------------------------------------------------------------------------
export function shouldShowCompactDayControls({
    scrollY,
    activationScrollY = 200,
    safeTop,
    protectedBottom
}) {
    return Number(scrollY) > Number(activationScrollY)
        && Number(protectedBottom) <= Number(safeTop);
}

export function DateControlsCompact() {
    const isWeek = state.viewMode === 'week';
    const isLegacy = state.settings?.legacyNavigation;
    const isAsBottomBar = isWeek && isLegacy;
    const periodInfo = isWeek ? getPeriodViewDates(state.selectedDate) : null;
    const dateText = isWeek
        ? (periodInfo && periodInfo.dates.length > 7 ? getPeriodRangeText(periodInfo.periodStart, periodInfo.periodEnd) : getWeekRangeText(state.selectedDate))
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
        showPicker ? 'date-picker-open' : '',
        isWeek ? 'at-bottom' : '',
        isAsBottomBar ? 'as-bottom-bar' : ''
    ].filter(Boolean).join(' ');

    const isToday = getDateKey(new Date()) === getDateKey(state.selectedDate);
    const dayHours = getDayHours(state.selectedDate);
    const regularHoursPerDay = normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay);
    let hourColor = '#10b981';
    if (dayHours > regularHoursPerDay) {
        hourColor = '#3b82f6';
    } else if (dayHours < regularHoursPerDay) {
        hourColor = '#ef4444';
    }

    return `
            <div class="${classes}">
                <div class="attendance-floating-date">
                    <div class="pill-nav">
                        <button class="pill-btn" type="button" data-att-action="change-date" data-value="-1">
                            ${icons.get('chevron-left', { size: 18 })}
                        </button>

                        <div class="pill-display" role="button" tabindex="0" data-att-action="toggle-date-picker" data-value="compact" style="position: relative; ${isToday ? 'border-color: rgba(6, 182, 212, 0.5);' : ''}">
                            ${icons.get('calendar', { size: 14, color: isToday ? '#06b6d4' : undefined })}
                            <span style="${isToday ? 'color: #06b6d4;' : ''}">${dateText}</span>
                            ${datePickerHTML}
                        </div>

                        <button class="pill-btn" type="button" data-att-action="change-date" data-value="1">
                            ${icons.get('chevron-right', { size: 18 })}
                        </button>
                    </div>
                </div>
                ${isWeek ? '' : `
                    <div class="attendance-floating-hours" aria-label="Horas a asignar para este día">
                        <div class="stepper-container" title="Horas a asignar para este día">
                            <button class="stepper-btn" type="button" data-att-action="change-base-hours" data-value="-0.5" aria-label="Reducir horas">−</button>
                            <div class="stepper-value" style="color: ${hourColor} !important;">${dayHours}h</div>
                            <button class="stepper-btn" type="button" data-att-action="change-base-hours" data-value="0.5" aria-label="Aumentar horas">+</button>
                        </div>
                    </div>
                `}
            </div>
        `;
}

/**
 * 👤 Divide el nombre completo del empleado en primer nombre y primer apellido
 * para visualización vertical compacta en móviles.
 */
export function formatSplitName(fullName) {
    if (!fullName) return '';
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return escapeHTML(fullName);

    const first = escapeHTML(parts[0]);
    const commonMiddleNames = ['jose', 'josé', 'maria', 'maría', 'carlos', 'luis', 'antonio', 'manuel', 'francisco', 'juan', 'altagracia', 'alexander', 'miguel', 'angel', 'ángel', 'david', 'eduardo', 'rafael', 'ramon', 'ramón', 'alberto', 'jesus', 'jesús'];

    if (parts.length >= 3 && commonMiddleNames.includes(parts[1].toLowerCase())) {
        return `<div class="name-line-1">${first}</div><div class="name-line-2">${escapeHTML(parts[2])}</div>`;
    }

    return `<div class="name-line-1">${first}</div><div class="name-line-2">${escapeHTML(parts[1])}</div>`;
}

/**
 * 🕒 Obtener horas configuradas para un día específico
 */
export function getDayHours(date) {
    const key = getDateKey(date);
    return resolveDailyTargetHours(key, state.dayHoursConfig, state.settings?.regularHoursPerDay);
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
    const regular = normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay);
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
                    <button class="segmented-item ${state.viewMode === 'day' ? 'active' : ''}" type="button" data-att-action="change-view-mode" data-value="day">${dayLabel}</button>
                    <button class="segmented-item ${state.viewMode === 'week' ? 'active' : ''}" type="button" data-att-action="change-view-mode" data-value="week">${weekLabel}</button>
                </div>
            </div>
        `;
}
function navPillSelectorDeFecha(isToday, displayText, datePickerHTML) {
    //<!-- 2. NIVEL MEDIO: Nav Pill (Fecha) -->
    const iconoCalendario = icons.get('calendar', { size: 18, color: isToday ? '#06b6d4' : undefined });
    const flechaDerecha = icons.get('chevron-right');
    const flechaIzquierda = icons.get('chevron-left');
    let colorBorde = isToday ? 'border-color: rgba(6, 182, 212, 0.5);' : '';
    let colorTexto = isToday ? '#06b6d4' : '';

    return `<div class="pill-nav" style="margin-bottom: 20px;">
                <button class="pill-btn" type="button" data-att-action="change-date" data-value="-1">${flechaIzquierda}</button>
                <div class="pill-display" role="button" tabindex="0" data-att-action="toggle-date-picker" data-value="full" style="position: relative; ${colorBorde}">
                    ${iconoCalendario}
                    <span style="${colorTexto}">${displayText}</span>
                    ${datePickerHTML}
                </div>
                <button class="pill-btn" type="button" data-att-action="change-date" data-value="1">${flechaDerecha}</button>
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
                    <div class="holiday-control ${clase}" role="button" tabindex="0" data-att-action="toggle-holiday" title="${title}">
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
                        <button class="stepper-btn" type="button" data-att-action="change-base-hours" data-value="-0.5" aria-label="Reducir horas">-</button>
                        <div class="stepper-value" style="color: ${hourColor} !important;">${dayHours}h</div>
                        <button class="stepper-btn" type="button" data-att-action="change-base-hours" data-value="0.5" aria-label="Aumentar horas">+</button>
                    </div>
                </div>`
}
function ControlesAsistenciaHoy(isToday, todayBtnStyle, todayIconColor) {
    //    <!-- Seccion Hoy (Derecha - 1fr) -->
    let color = isToday ? 'color: #06b6d4;' : '';

    return ` <div class="control-section side-control">
                 <div class="control-section-label">Navegación</div>
                <button class="btn-today-nav" type="button" data-att-action="go-to-today" title="Ir a hoy" aria-label="Ir a hoy" style="${todayBtnStyle}">
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
    const periodInfo = state.viewMode === 'week' ? getPeriodViewDates(state.selectedDate) : null;
    const displayText = state.viewMode === 'week'
        ? (periodInfo && periodInfo.dates.length > 7 ? getPeriodRangeText(periodInfo.periodStart, periodInfo.periodEnd) : getWeekRangeText(state.selectedDate))
        : formatDateShort(state.selectedDate);

    // Lógica de etiquetas consistentes para ahorrar espacio en móvil sin alternancia molesta
    const dayLabel = 'Día';
    const weekLabel = 'Semana';

    // Semántica de colores en horas (Refactorizado de operador ternario anidado)
    const regularHoursPerDay = normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay);
    let hourColor = '#10b981';
    if (dayHours > regularHoursPerDay) {
        hourColor = '#3b82f6';
    } else if (dayHours < regularHoursPerDay) {
        hourColor = '#ef4444';
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
        <div class="attendance-toolbar glass-effect ${showPicker ? 'date-picker-open' : ''}" style="position: relative; z-index: 10; padding: 16px; border-radius: 20px; margin-bottom: 2px; box-shadow: 0 10px 25px rgba(0,0,0,0.25);">
            
            <!-- 1. NIVEL SUPERIOR: Selector de Vista y Alcance -->
            <div class="view-mode-container" style="margin-bottom: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px;">
                <div class="segmented-control" style="width: 200px;">
                    <button class="segmented-item ${state.viewMode === 'day' ? 'active' : ''}" type="button" data-att-action="change-view-mode" data-value="day">${dayLabel}</button>
                    <button class="segmented-item ${state.viewMode === 'week' ? 'active' : ''}" type="button" data-att-action="change-view-mode" data-value="week">${weekLabel}</button>
                </div>
                ${state.viewMode === 'week' ? `
                    <div class="week-span-selector segmented-control" style="width: 100%; max-width: 320px;" title="Alcance de semanas a mostrar">
                        <button class="segmented-item ${(state.attendanceWeekSpan === '1' || state.attendanceWeekSpan === 1) ? 'active' : ''}" type="button" data-att-action="change-week-span" data-value="1">1 sem</button>
                        <button class="segmented-item ${(state.attendanceWeekSpan === '2' || state.attendanceWeekSpan === 2) ? 'active' : ''}" type="button" data-att-action="change-week-span" data-value="2">2 sem</button>
                        <button class="segmented-item ${(state.attendanceWeekSpan === '3' || state.attendanceWeekSpan === 3) ? 'active' : ''}" type="button" data-att-action="change-week-span" data-value="3">3 sem</button>
                        <button class="segmented-item ${(!state.attendanceWeekSpan || state.attendanceWeekSpan === 'period') ? 'active' : ''}" type="button" data-att-action="change-week-span" data-value="period">Período</button>
                    </div>
                ` : ''}
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
    const filterVal = filtro || 'null';
    return `<div class="stat-item ${f === nombreID ? 'active' : ''}" role="button" tabindex="0" data-att-action="set-employee-filter" data-value="${filterVal}">
        <div class="stat-icon">${icon}</div>
        <div class="stat-value">${stats}</div>
        <div class="stat-label">${nombre}</div>
    </div>`
}
function statCard_clock(f, nombreID, nombre, icon, stats, filtro) {
    const filterVal = filtro || 'null';
    return `<div class="stat-item ${f === nombreID ? 'active' : ''}" role="button" tabindex="0" data-att-action="set-employee-filter" data-value="${filterVal}">
        <div class="stat-icon">${icon}</div>
        <div class="stat-value-clock">${stats}</div>
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
    
             ${statCard(f, 'present', 'Presente', '✅', stats.present, 'present')}
             ${statCard(f, 'absent', 'Ausentes', '❌', stats.absent, 'absent')}
             ${statCard_clock(f, 'time', 'Horas', '⏱️', stats.totalHours, '')}
             ${statCard(f, 'overtime', 'Extras', '⚡', stats.overtimeHours, 'overtime')}


            </div>${f ? `<div class="filter-status-notification">
                <span class="filter-status-text" style="display: inline-flex; align-items: center; gap: 6px;">${icons.get('filter', { size: 14 })} ${filterNames[f]}</span>
                <button type="button" data-att-action="set-employee-filter" data-value="null" class="view-btn" style="padding: 4px 12px; font-size: 0.75rem; display: inline-flex; align-items: center; gap: 4px;" aria-label="Limpiar filtro">${icons.get('close', { size: 12 })} Limpiar</button>
            </div>` : ''}</div>`;
}

/**
 * 🌤️ Weather bar — replaces the legacy "Leyenda de Colores" surface.
 *
 * Delegates to window.WeatherBar so this UI file stays decoupled from the
 * weather feature module (the legacy bridge pattern used across the app).
 * Returns an empty string if the weather module is not wired up — safe.
 *
 * The exported name is kept as Legend() because callers (e.g. app.js render
 * pipeline) still import this symbol. Inside, what it produces is now a
 * weather strip, not a color legend.
 */
export function Legend() {
    if (typeof window !== 'undefined' && typeof window.WeatherBar === 'function') {
        return window.WeatherBar();
    }
    return '';
}

/**
 * 🎯 Catálogo visual compartido de filtros por profesión o líder
 */
export function PositionFilters() {
    if (!state.showFilters) return '';

    const allActivePositions = state.positions.filter(p => p.active);
    const seenNames = new Set();
    const activePositions = allActivePositions.filter(position => {
        const normalizedName = String(position.name || '').trim().toLocaleLowerCase('es');
        if (seenNames.has(normalizedName)) return false;
        seenNames.add(normalizedName);
        return true;
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    // F1.5: los contadores del catálogo respetan el alcance de proyecto activo.
    const scopeForCatalog = peekEntityScope();
    const activeLeaders = state.leaders
        .filter(leader => leader.active && entityInScope(leader, scopeForCatalog))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    const activeEmployees = state.employees.filter(employee =>
        wasEmployeeActiveOnDate(employee, state.selectedDate)
        && entityInScope(employee, scopeForCatalog)
    );
    const mode = state.attendanceFilterCatalog === 'leaders' ? 'leaders' : 'positions';

    const positionCounts = new Map();
    activePositions.forEach(position => {
        const matchingIds = new Set(allActivePositions
            .filter(candidate => candidate.name === position.name)
            .map(candidate => candidate.id));
        positionCounts.set(position.id, activeEmployees.filter(employee =>
            employee.positions?.some(positionId => matchingIds.has(positionId))
        ).length);
    });

    const leaderCounts = new Map();
    activeLeaders.forEach(leader => {
        const leaderPositionIds = new Set(allActivePositions
            .filter(position => position.leaderId === leader.id)
            .map(position => position.id));
        leaderCounts.set(leader.id, activeEmployees.filter(employee =>
            employee.positions?.some(positionId => leaderPositionIds.has(positionId))
        ).length);
    });

    const currentFilter = mode === 'leaders'
        ? (state.filters.leaderId || 'all')
        : (state.filters.position || 'all');
    const cards = mode === 'leaders'
        ? activeLeaders.map(leader => {
            const selected = currentFilter === leader.id;
            return `
                <button class="attendance-filter-card ${selected ? 'is-selected' : ''}"
                        type="button"
                        data-att-action="set-leader-filter"
                        data-id="${escapeHTML(leader.id)}"
                        style="--filter-accent: #06b6d4;"
                        aria-pressed="${selected}">
                    <span class="attendance-filter-card-icon">
                        ${renderPositionIconSvg(resolveLeaderIcon(leader), { size: 23 })}
                    </span>
                    <span class="attendance-filter-card-copy">
                        <strong>${escapeHTML(leader.name)}</strong>
                        <small>${escapeHTML(leader.number || 'Líder')}</small>
                    </span>
                    <span class="attendance-filter-card-count">${leaderCounts.get(leader.id) || 0}</span>
                </button>
            `;
        }).join('')
        : activePositions.map(position => {
            const selected = currentFilter === position.id;
            const color = safePositionColor(position.color);
            return `
                <button class="attendance-filter-card ${selected ? 'is-selected' : ''}"
                        type="button"
                        data-att-action="set-position-filter"
                        data-id="${escapeHTML(position.id)}"
                        style="--filter-accent: ${color};"
                        aria-pressed="${selected}">
                    <span class="attendance-filter-card-icon">
                        ${renderPositionIconSvg(resolvePositionIcon(position), { size: 23 })}
                    </span>
                    <span class="attendance-filter-card-copy">
                        <strong>${escapeHTML(position.name)}</strong>
                        <small>Profesión</small>
                    </span>
                    <span class="attendance-filter-card-count">${positionCounts.get(position.id) || 0}</span>
                </button>
            `;
        }).join('');

    const allSelected = currentFilter === 'all';
    const action = mode === 'leaders' ? 'set-leader-filter' : 'set-position-filter';
    const emptyMessage = mode === 'leaders'
        ? 'No hay líderes activos para mostrar.'
        : 'No hay profesiones activas para mostrar.';

    return `
        <section class="attendance-filter-panel" aria-label="Filtros visuales de asistencia">
            <header class="attendance-filter-panel-header">
                <div>
                    <span class="attendance-filter-panel-eyebrow">Explorar filtros</span>
                    <h3>Filtrar por ${mode === 'leaders' ? 'líderes' : 'profesiones'}</h3>
                </div>
                <button type="button"
                        class="attendance-filter-panel-close"
                        data-att-action="close-filter-catalog"
                        aria-label="Cerrar filtros">
                    ${icons.get('close', { size: 17 })}
                </button>
            </header>
            <div class="position-filters-grid">
                <button class="attendance-filter-card attendance-filter-card-all ${allSelected ? 'is-selected' : ''}"
                        type="button"
                        data-att-action="${action}"
                        data-id="all"
                        style="--filter-accent: #06b6d4;"
                        aria-pressed="${allSelected}">
                    <span class="attendance-filter-card-icon">
                        ${icons.get(mode === 'leaders' ? 'personnel' : 'briefcase', { size: 22 })}
                    </span>
                    <span class="attendance-filter-card-copy">
                        <strong>${mode === 'leaders' ? 'Todos los líderes' : 'Todas las profesiones'}</strong>
                        <small>Sin filtrar</small>
                    </span>
                    <span class="attendance-filter-card-count">${activeEmployees.length}</span>
                </button>
                ${cards || `<p class="attendance-filter-empty">${emptyMessage}</p>`}
            </div>
        </section>
    `;
}

export function usesAttendanceDetailPanel(viewportWidth) {
    return Number(viewportWidth) >= 1024;
}

export function AttendanceDetailAvatar(employee) {
    return `<div class="attendance-detail-avatar" data-attendance-detail-avatar>
        ${EmployeeAvatar(employee, { variant: 'default' })}
    </div>`;
}

export function getEffectiveAttendanceDetailEmployeeId() {
    const selectedId = state.selectedDetailEmployeeId;
    if (selectedId && state.employees.some(employee => employee.id === selectedId)) {
        return selectedId;
    }

    return state.employees.find(employee => employee.active !== false)?.id
        || state.employees[0]?.id
        || null;
}

export function getAttendanceWatermarkPositions(
    emp,
    attendance,
    positions = state.positions,
    { allowAbsent = false } = {}
) {
    if (!attendance?.present && !allowAbsent) return [];

    const positionHours = Array.isArray(attendance?.positionHours)
        ? attendance.positionHours
        : [];
    const usesMultiplePositions = attendance?.present
        && (attendance.multiPosition || positionHours.length > 1);
    const positionIds = usesMultiplePositions
        ? positionHours.map(item => item?.positionId)
        : [attendance?.selectedPosition || emp.positions?.[0] || emp.positionId];

    return [...new Set(positionIds.filter(Boolean))]
        .map(positionId => positions.find(position => position.id === positionId))
        .filter(Boolean);
}

export function getAttendanceWatermarkModel(emp, attendance, positions = state.positions) {
    const enabled = state.settings?.attendancePositionWatermarks !== false;
    const visibility = state.settings?.attendanceWatermarkVisibility === 'always'
        ? 'always'
        : 'present';
    const content = state.settings?.attendanceWatermarkContent === 'number'
        ? 'number'
        : 'position';
    const visible = enabled && (visibility === 'always' || attendance?.present === true);

    if (!visible) {
        return { visible: false, visibility, content, positions: [], fingerprint: 'hidden' };
    }

    if (content === 'number') {
        const number = String(emp.number ?? '').trim();
        return {
            visible: !!number,
            visibility,
            content,
            number,
            positions: [],
            fingerprint: number ? `${visibility}:number:${number}` : 'hidden'
        };
    }

    const resolvedPositions = getAttendanceWatermarkPositions(
        emp,
        attendance,
        positions,
        { allowAbsent: visibility === 'always' }
    );
    const positionFingerprint = resolvedPositions
        .map(position => `${position.id}:${position.updatedAt || 0}:${position.icon || ''}:${position.color || ''}`)
        .join('|');
    return {
        visible: resolvedPositions.length > 0,
        visibility,
        content,
        positions: resolvedPositions,
        fingerprint: positionFingerprint
            ? `${visibility}:position:${positionFingerprint}`
            : 'hidden'
    };
}

function renderAttendanceWatermark(model) {
    if (!model?.visible) return '';

    if (model.content === 'number') {
        return `
            <div class="attendance-watermarks is-number" aria-hidden="true">
                <span>${escapeHTML(model.number)}</span>
            </div>
        `;
    }

    const visiblePositions = model.positions.slice(0, 3);
    const hiddenCount = Math.max(0, model.positions.length - visiblePositions.length);

    return `
        <div class="attendance-watermarks is-position has-${visiblePositions.length}" aria-hidden="true">
            ${visiblePositions.map(position => `
                <span style="--watermark-color: ${safePositionColor(position.color)};">
                    ${renderPositionIconSvg(resolvePositionIcon(position), { size: 112 })}
                </span>
            `).join('')}
            ${hiddenCount ? `<small>+${hiddenCount}</small>` : ''}
        </div>
    `;
}

/**
 * 🔍 Barra de Búsqueda con Filtro de Líder
 */
export function SearchBar() {
    const searchValue = state.filters.search || '';
    const leaderFilter = state.filters.leaderId || 'all';
    const positionFilter = state.filters.position || 'all';
    const openMode = state.showFilters
        ? (state.attendanceFilterCatalog === 'leaders' ? 'leaders' : 'positions')
        : '';

    return `
        <div class="search-wrapper">
            <div class="search-input-group attendance-search-group">
                <input type="text" id="search-input" value="${escapeHTML(searchValue)}"
                       data-att-action="set-search-filter"
                       placeholder="Buscar por nombre, número o posición..."
                       class="search-input-field employee-search-input">
                <span class="search-icon-fixed">🔍</span>
                ${searchValue ? `<button type="button" data-att-action="clear-search-filter" aria-label="Limpiar búsqueda" style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: none; border: none; color: #94a3b8; cursor: pointer; padding: 4px;">${icons.get('close', { size: 12 })}</button>` : ''}
            </div>
            <button type="button"
                    class="attendance-filter-catalog-btn ${openMode === 'positions' ? 'is-open' : ''} ${positionFilter !== 'all' ? 'has-selection' : ''}"
                    data-att-action="open-filter-catalog"
                    data-value="positions"
                    aria-expanded="${openMode === 'positions'}">
                ${icons.get('briefcase', { size: 17 })}
                <span>Profesiones</span>
                ${positionFilter !== 'all' ? '<span class="attendance-filter-selection">1</span>' : ''}
            </button>
            <button type="button"
                    class="attendance-filter-catalog-btn ${openMode === 'leaders' ? 'is-open' : ''} ${leaderFilter !== 'all' ? 'has-selection' : ''}"
                    data-att-action="open-filter-catalog"
                    data-value="leaders"
                    aria-expanded="${openMode === 'leaders'}">
                ${icons.get('personnel', { size: 17 })}
                <span>Líderes</span>
                ${leaderFilter !== 'all' ? '<span class="attendance-filter-selection">1</span>' : ''}
            </button>
            <button type="button"
                    class="attendance-layout-btn"
                    data-app-fn="openAttendanceLayoutModal"
                    aria-label="Opciones de distribución de la lista"
                    title="Opciones de distribución">
                ${icons.get('settings', { size: 18 })}
            </button>
        </div>
    `;
}

export function AttendanceBulkActions(employees) {
    const dateKey = getDateKey(state.selectedDate);
    const presentCount = employees.filter(employee => state.attendance[`${employee.id}-${dateKey}`]?.present).length;
    const absentCount = employees.length - presentCount;

    return `
        <div class="attendance-bulk-bar" aria-label="Acciones masivas del día">
            <div class="attendance-bulk-context">
                <span class="attendance-bulk-title">Acciones del día</span>
                <span class="attendance-bulk-scope">${employees.length} empleado${employees.length === 1 ? '' : 's'} visible${employees.length === 1 ? '' : 's'}</span>
            </div>
            <div class="attendance-bulk-actions">
                <button type="button"
                        class="attendance-bulk-btn attendance-bulk-btn-present"
                        data-att-action="mark-visible-present"
                        ${absentCount === 0 ? 'disabled' : ''}
                        aria-label="Poner presentes a los empleados visibles">
                    ${icons.get('check', { size: 17 })}
                    <span>Poner todos presentes</span>
                    <span class="attendance-bulk-count">${absentCount}</span>
                </button>
                <button type="button"
                        class="attendance-bulk-btn attendance-bulk-btn-clear"
                        data-att-action="clear-visible-attendance"
                        ${presentCount === 0 ? 'disabled' : ''}
                        aria-label="Limpiar la asistencia de los empleados visibles">
                    ${icons.get('delete', { size: 17 })}
                    <span>Limpiar asistencias</span>
                    <span class="attendance-bulk-count">${presentCount}</span>
                </button>
                <button type="button"
                        class="attendance-bulk-btn attendance-bulk-btn-mini"
                        data-att-action="open-mini-attendance-import"
                        aria-label="Importar asistencia desde Mini">
                    ${icons.get('import', { size: 17 })}
                    <span>Importar desde Mini</span>
                </button>
            </div>
        </div>
    `;
}


/**
 * 👤 Fila de Empleado (Vista Diaria / Relajada)
 */
export function getAttendanceCardStatus(employee, selectedDate, attendance = {}) {
    const activeOnSelectedDate = wasEmployeeActiveOnDate(employee, selectedDate, attendance);
    if (!activeOnSelectedDate) {
        return { kind: 'not-active-on-date', activeOnSelectedDate };
    }
    if (employee?.active === false) {
        return { kind: 'inactive-currently', activeOnSelectedDate };
    }
    return { kind: 'active', activeOnSelectedDate };
}

function renderAttendanceCardStatus(status) {
    if (status.kind === 'not-active-on-date') {
        return `<span class="attendance-status-pill is-date-inactive" role="status">${icons.get('alert', { size: 12 })}<span>No activo en esta fecha</span></span>`;
    }
    if (status.kind === 'inactive-currently') {
        return `<span class="attendance-status-pill is-currently-inactive" role="status"><span>Inactivo actualmente</span></span>`;
    }
    return '';
}

export function EmployeeRow(emp) {
    const dateKey = getDateKey(state.selectedDate);
    const attKey = `${emp.id}-${dateKey}`;
    const att = state.attendance[attKey];
    const isDetailSelected = getEffectiveAttendanceDetailEmployeeId() === emp.id;
    const watermarkModel = getAttendanceWatermarkModel(emp, att);
    const cardStatus = getAttendanceCardStatus(emp, dateKey, state.attendance);
    const periodMetrics = buildAttendanceCardPeriodMetrics({
        employee: emp,
        selectedDate: state.selectedDate,
        attendance: state.attendance,
        positions: state.positions,
        settings: state.settings,
        dayHoursConfig: state.dayHoursConfig
    });

    // ⚡ P4-OPT: Solo regenerar si algo relevante cambió
    // - att.updatedAt: cambia cuando se registra/modifica asistencia de este empleado
    // - emp.updatedAt: cambia cuando se editan datos del empleado
    // - dateKey: cambia cuando el usuario navega a otra fecha
    return componentMemo.get(
        `emp-row-${emp.id}`,
        () => _buildEmployeeRow(emp, dateKey, attKey, att, watermarkModel, periodMetrics, cardStatus),
        [
            dateKey,
            att?.updatedAt ?? 0,
            emp.updatedAt ?? 0,
            state.listDisplayMode,
            normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay),
            getDayHours(state.selectedDate),
            (state.settings.holidays || []).join(','),
            state.tempPositionSelection?.[attKey] || '',
            att?.selectedPosition || '',
            isDetailSelected,
            cardStatus.kind,
            watermarkModel.fingerprint,
            periodMetrics.fingerprint,
            state.settings?.showAttendanceCardDeficit === true,
            state.settings?.attendanceDeficitUnit || 'days'
        ]
    );
}

function _buildEmployeeRow(emp, dateKey, key, att, watermarkModel, periodMetrics, cardStatus) {
    // Defensa: empleados con formato viejo (positionId sin positions[])
    if (!emp.positions) {
        emp.positions = emp.positionId ? [emp.positionId] : [];
    }
    const checkColor = getCheckColor(att, state.selectedDate);
    const isChecked = att && att.present;
    const selPos = att?.selectedPosition || emp.positions?.[0] || null;
    const isMultiPosition = att?.multiPosition || false;
    const hasMultiplePositions = (emp.positions?.length || 0) > 1;

    // 👆 Tocar registro para caché LRU
    if (att && typeof attendanceService !== 'undefined') attendanceService.touchRecord(emp.id, getDateKey(state.selectedDate));

    const selectedPosId = state.tempPositionSelection?.[key] || emp.positions?.[0];

    // Extraer badge de horas (Antes era ternario anidado)
    const multiPosIcon = isMultiPosition ? ' 🔄' : '';
    const hoursBadgeHTML = isChecked
        ? `<div class="hours-badge">${att.hoursWorked}h${multiPosIcon}</div>`
        : '';

    const workedPositionIds = isChecked
        ? (isMultiPosition ? (att.positionHours || []).map(ph => ph.positionId) : [selPos])
        : [];
    const isDetailSelected = getEffectiveAttendanceDetailEmployeeId() === emp.id;

    const fingerprint = `${dateKey}-${att?.updatedAt || 0}-${emp.updatedAt || 0}-${state.listDisplayMode}-${cardStatus.kind}-${isDetailSelected ? 'selected' : 'idle'}-${watermarkModel?.fingerprint || 'hidden'}`;
    return `<div id="emp-row-${emp.id}" class="employee-row ${isDetailSelected ? 'is-detail-selected' : ''}${cardStatus.kind === 'not-active-on-date' ? ' inactive-on-date' : ''}" data-memo-f="${fingerprint}">
                ${renderAttendanceWatermark(watermarkModel)}
                <div class="employee-info">
                    <div class="employee-header">
                        <div class="employee-identity">
                            <span class="employee-number-badge" aria-label="Empleado número ${escapeHTML(String(emp.number ?? ''))}">${escapeHTML(String(emp.number ?? ''))}</span>
                            <div class="employee-name" role="button" tabindex="0" data-att-action="view-employee-details" data-id="${emp.id}" aria-label="Ver detalles de ${escapeHTML(emp.name)}">${escapeHTML(emp.name)}</div>
                        </div>
                        <div class="employee-status-slot">${renderAttendanceCardStatus(cardStatus)}</div>
                    </div>
                    <div class="position-toggles" style="margin-top: 2px;">
                        ${emp.positions.map(pid => {
        const pos = state.positions.find(p => p.id === pid); if (!pos) return '';
        const isActive = isChecked ? (selPos === pid) : (selectedPosId === pid);
        const isWorked = workedPositionIds.includes(pid);

        // Estilos Neón dinámicos
        const posColor = pos.color || "#64748b";
        const neonStyle = isWorked ? `border-color: ${posColor}; box-shadow: 0 0 10px ${posColor}66; background: ${posColor}15; color: #fff;` : '';

        const posAction = isChecked ? 'toggle-position' : 'select-temp-position';
        return `<button class="position-toggle ${isActive ? 'active' : ''} ${isWorked ? 'worked-today' : ''}"
                                                   type="button"
                                                   style="${neonStyle}"
                                                   data-att-action="${posAction}" data-emp-id="${emp.id}" data-pos-id="${pid}">
                                        <span class="pos-dot" style="background:${posColor};"></span>${pos.name || "Posición"}
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
                    <div class="attendance-period-summary" aria-label="Resumen rápido de asistencia">
                        <span class="attendance-period-credit">${formatAttendanceDayNumber(periodMetrics.workedDays)}/${formatAttendanceDayNumber(periodMetrics.scheduledDays)} días</span>
                        ${state.settings?.showAttendanceCardDeficit === true
                            ? `<span class="attendance-period-deficit check-undertime">${formatAttendanceDeficit(periodMetrics, state.settings?.attendanceDeficitUnit || 'days')}</span>`
                            : ''}
                        <span class="attendance-period-overtime">+${formatAttendanceDecimal(periodMetrics.overtimeHours)}h extra${periodMetrics.overtimeHours === 1 ? '' : 's'}</span>
                    </div>
                    ${periodMetrics.selectedDayNote ? `
                        <div class="attendance-card-note" title="${escapeHTML(periodMetrics.selectedDayNote)}"
                             data-att-action="open-advanced-attendance" data-id="${emp.id}">
                            ${icons.get('file', { size: 12 })}<span>${escapeHTML(periodMetrics.selectedDayNote)}</span>
                        </div>
                    ` : ''}
                </div>
                <div style="display: flex; flex-direction: column; gap: 6px; align-items: center; justify-content: center; min-width: 60px; flex-shrink: 0;">
                    <label class="check-container" style="position: relative;">
                        <input type="checkbox" class="check-input" ${isChecked ? 'checked' : ''} data-att-action="handle-checkbox-click" data-emp-id="${emp.id}">
                        <div class="check-box ${checkColor}">${isChecked ? '✓' : ''}</div>
                        ${hoursBadgeHTML}
                    </label>
                    ${isChecked && hasMultiplePositions ? `
                        <button data-att-action="open-advanced-attendance" data-id="${emp.id}" 
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
    // Defensa: empleados con formato viejo (positionId sin positions[])
    if (!emp.positions) {
        emp.positions = emp.positionId ? [emp.positionId] : [];
    }
    const key = `${emp.id}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const checkColor = getCheckColor(att, state.selectedDate);
    const isChecked = att && att.present;
    const isDetailSelected = getEffectiveAttendanceDetailEmployeeId() === emp.id;
    const watermarkModel = getAttendanceWatermarkModel(emp, att);
    const cardStatus = getAttendanceCardStatus(emp, state.selectedDate, state.attendance);

    // 👆 Tocar registro para caché LRU
    if (att && typeof attendanceService !== 'undefined') attendanceService.touchRecord(emp.id, getDateKey(state.selectedDate));

    return `<div id="emp-row-${emp.id}" class="employee-row compact-mode employee-row-compact ${isDetailSelected ? 'is-detail-selected' : ''}${cardStatus.kind === 'not-active-on-date' ? ' inactive-on-date' : ''}">
                ${renderAttendanceWatermark(watermarkModel)}
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div class="employee-header">
                        <div class="employee-compact-heading">
                            <span class="employee-number-badge" aria-label="Empleado número ${escapeHTML(String(emp.number ?? ''))}">${escapeHTML(String(emp.number ?? ''))}</span>
                            <div class="employee-compact-name" role="button" tabindex="0" data-att-action="view-employee-details" data-id="${emp.id}" aria-label="Ver detalles de ${escapeHTML(emp.name)}">${escapeHTML(emp.name)}</div>
                        </div>
                        <div class="employee-status-slot">${renderAttendanceCardStatus(cardStatus)}</div>
                    </div>
                    <div style="font-size: 0.7rem; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        ${emp.positions.map(pid => state.positions.find(p => p.id === pid)?.name).join(', ')}
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    ${isChecked ? `<div style="color: #10b981; font-weight: 700; font-size: 0.875rem;">${att.hoursWorked}h</div>` : ''}
                    <label class="check-container" style="margin: 0;">
                        <input type="checkbox" class="check-input" ${isChecked ? 'checked' : ''} data-att-action="handle-checkbox-click" data-emp-id="${emp.id}">
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
    const columns = Number(state.attendanceListColumns) === 2 ? 2 : 1;
    const listHTML = filtered.length > 0
        ? filtered.map(emp => state.listDisplayMode === 'compact' ? EmployeeRowCompact(emp) : EmployeeRow(emp)).join('')
        : EmptyState.render({
            icon: 'personnel',
            title: 'No hay resultados',
            description: 'No hay empleados que coincidan con los filtros actuales.',
            size: 'medium'
        });

    return `
        <div class="day-view-page-mode ${isHoliday ? 'holiday-theme' : ''}">
            ${StatsGrid()}
            ${Legend()}
            
            <div class="attendance-flow-controls" style="margin-top: 12px; margin-bottom: 0;">
                ${SearchBar()}
                ${AttendanceBulkActions(filtered)}
            </div>
            ${PositionFilters()}
            
            <div id="day-view-list-parent" style="position: relative; margin-top: 16px;">
                <div id="day-view-list" data-preserve-scroll="attendance-day-list" class="employee-list employee-list-cols-${columns} ${state.listDisplayMode === 'compact' ? 'compact-list' : ''} sticky-table-container modern-scroll">
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
    // 🔎 Un empleado activo HOY siempre aparece (desde su ingreso), aunque el
    // historial diga inactivo ese día — en ese caso se marca visualmente en la
    // tarjeta (ver _buildEmployeeRow). Pasamos state.attendance para que un día
    // con asistencia registrada cuente como activo.
    // F1.5: con el scope activo, la lista diaria sólo muestra empleados del
    // proyecto efectivo (misma regla que la vista de empleados); flag OFF ⇒
    // entityInScope es true ⇒ paridad legacy exacta.
    let employees = state.employees.filter(emp =>
        isEmployeeVisibleOnDate(emp, date, state.attendance).visible && entityInScope(emp)
    );

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
            const sameNameIds = new Set(state.positions.filter(p => p.name === selectedPos.name).map(p => p.id));
            employees = employees.filter(emp => emp.positions?.some(pid => sameNameIds.has(pid)));
        }
    }

    // Filtrar por Estado (Presentes/Ausentes/Extras)
    if (state.employeeFilter) {
        const dateKey = getDateKey(state.selectedDate);
        const dayHours = resolveDailyTargetHours(dateKey, state.dayHoursConfig, state.settings?.regularHoursPerDay);
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
 * 📅 Obtiene las fechas del período visible para la matriz de asistencia en Desktop
 * mostrando el alcance seleccionado (1, 2, 3 semanas o período de nómina activo).
 */
export function getPeriodViewDates(selectedDateInput = state.selectedDate) {
    const selectedKey = getDateKey(selectedDateInput);
    const span = state.attendanceWeekSpan || 'period';

    // 1. Si el usuario seleccionó un número fijo de semanas (1 semana = 7 días):
    if (span === '1' || span === 1) {
        const weekDates = DateUtils.getWeekDates(selectedKey);
        return {
            dates: weekDates,
            page: 0,
            totalPages: 1,
            periodStart: weekDates[0],
            periodEnd: weekDates[weekDates.length - 1],
            hasPagination: false,
            totalPeriodDays: 7
        };
    }

    // 2. Si el usuario seleccionó 2 semanas (14 días):
    if (span === '2' || span === 2) {
        const startStr = DateUtils.getWeekStart(selectedKey);
        const dates = [];
        for (let i = 0; i < 14; i++) {
            dates.push(DateUtils.addDays(startStr, i));
        }
        return {
            dates,
            page: 0,
            totalPages: 1,
            periodStart: dates[0],
            periodEnd: dates[dates.length - 1],
            hasPagination: false,
            totalPeriodDays: 14
        };
    }

    // 3. Si el usuario seleccionó 3 semanas (21 días):
    if (span === '3' || span === 3) {
        const startStr = DateUtils.getWeekStart(selectedKey);
        const dates = [];
        for (let i = 0; i < 21; i++) {
            dates.push(DateUtils.addDays(startStr, i));
        }
        return {
            dates,
            page: 0,
            totalPages: 1,
            periodStart: dates[0],
            periodEnd: dates[dates.length - 1],
            hasPagination: false,
            totalPeriodDays: 21
        };
    }

    // 4. Modo 'period': Período de nómina configurado
    const settingsPp = state.settings?.payPeriod;
    const exportPp = state.exportConfig?.payPeriod;
    const payPeriod = (settingsPp?.periodStart && Number(settingsPp?.periodLength) > 0)
        ? settingsPp
        : ((exportPp?.periodStart && Number(exportPp?.periodLength) > 0) ? exportPp : (settingsPp || exportPp));
    const length = Number(payPeriod?.periodLength);

    // Si hay un período de nómina configurado con fecha de inicio y longitud válidas:
    if (payPeriod?.periodStart && Number.isInteger(length) && length >= 1 && length <= 366) {
        const configuredStart = new Date(`${payPeriod.periodStart}T00:00:00`);
        const selDate = typeof selectedDateInput === 'string' ? parseDate(selectedDateInput) : new Date(selectedDateInput);
        
        // Calcular ciclo activo que contiene la fecha seleccionada
        const diffDays = Math.floor((selDate.getTime() - configuredStart.getTime()) / (1000 * 60 * 60 * 24));
        const cycleOffset = Math.floor(diffDays / length);

        const cycleStartDate = new Date(configuredStart);
        cycleStartDate.setDate(configuredStart.getDate() + (cycleOffset * length));

        const allPeriodDates = [];
        for (let i = 0; i < length; i++) {
            const d = new Date(cycleStartDate);
            d.setDate(d.getDate() + i);
            allPeriodDates.push(getDateKey(d));
        }

        // Si el período entra en 21 días (ej. 7, 14, 15 o 21 días), se muestra únicamente este período:
        if (allPeriodDates.length <= 21) {
            return {
                dates: allPeriodDates,
                page: 0,
                totalPages: 1,
                periodStart: allPeriodDates[0],
                periodEnd: allPeriodDates[allPeriodDates.length - 1],
                hasPagination: false,
                totalPeriodDays: allPeriodDates.length
            };
        }

        // Si supera los 21 días (ej. período mensual de 30 o 31 días), se pagina en bloques de hasta 21 días:
        const selectedIndex = allPeriodDates.indexOf(selectedKey);
        const activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
        const page = Math.floor(activeIndex / 21);
        const totalPages = Math.ceil(allPeriodDates.length / 21);
        const pageDates = allPeriodDates.slice(page * 21, (page + 1) * 21);

        return {
            dates: pageDates,
            page,
            totalPages,
            periodStart: pageDates[0],
            periodEnd: pageDates[pageDates.length - 1],
            hasPagination: true,
            totalPeriodDays: allPeriodDates.length
        };
    }

    // Fallback si no hay período configurado: la semana de 7 días de la fecha seleccionada
    const weekDates = DateUtils.getWeekDates(selectedKey);
    return {
        dates: weekDates,
        page: 0,
        totalPages: 1,
        periodStart: weekDates[0],
        periodEnd: weekDates[weekDates.length - 1],
        hasPagination: false,
        totalPeriodDays: 7
    };
}

/**
 * 📅 Vista Semanal / Período Principal (WeekView)
 */
export function WeekView() {
    const periodInfo = getPeriodViewDates();
    const dates = periodInfo.dates;
    
    // ⚡ P4-OPT: Mapa de posiciones para búsquedas O(1)
    const positionMap = new Map(state.positions.map(p => [p.id, p]));
    const filtered = getFilteredEmployeesForWeek(dates, positionMap);
    
    const tbodyHTML = filtered.length > 0
        ? filtered.map(emp => WeekRow(emp, dates, positionMap)).join('')
        : `<tr><td colspan="${dates.length + 1}">${EmptyState.render({ icon: 'personnel', title: 'No hay empleados', description: 'Sin registros para este periodo.', size: 'medium' })}</td></tr>`;

    const paginationHTML = periodInfo.hasPagination ? `
        <div class="period-pagination-bar" style="display: flex; justify-content: space-between; align-items: center; background: #1e293b; padding: 10px 16px; border-radius: 10px; margin-bottom: 12px; border: 1px solid #334155;">
            <span style="font-size: 0.82rem; color: #94a3b8;">
                Mostrando días <strong style="color: #06b6d4;">${periodInfo.page * 21 + 1} - ${Math.min((periodInfo.page + 1) * 21, periodInfo.totalPeriodDays)}</strong> de ${periodInfo.totalPeriodDays} del período
            </span>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button type="button" class="pill-btn" style="width: 34px; height: 34px; border-radius: 8px;" ${periodInfo.page === 0 ? 'disabled style="opacity: 0.3; cursor: not-allowed; width: 34px; height: 34px; border-radius: 8px;"' : 'data-att-action="change-period-page" data-value="-1"'} aria-label="Página anterior del período">
                    ${icons.get('chevron-left', { size: 16 })}
                </button>
                <span style="font-size: 0.82rem; color: #f1f5f9; font-weight: 700; padding: 0 4px;">Pág. ${periodInfo.page + 1} de ${periodInfo.totalPages}</span>
                <button type="button" class="pill-btn" style="width: 34px; height: 34px; border-radius: 8px;" ${periodInfo.page >= periodInfo.totalPages - 1 ? 'disabled style="opacity: 0.3; cursor: not-allowed; width: 34px; height: 34px; border-radius: 8px;"' : 'data-att-action="change-period-page" data-value="1"'} aria-label="Página siguiente del período">
                    ${icons.get('chevron-right', { size: 16 })}
                </button>
            </div>
        </div>
    ` : '';

    return `
        <div class="sticky-controls-wrapper" style="margin: 8px 0 16px 0;">
            ${SearchBar()}
        </div>
        ${PositionFilters()}
        ${paginationHTML}
        <div id="week-view-list" data-preserve-scroll="attendance-week-list" class="sticky-table-container modern-scroll">
            <table class="week-view-table" style="margin-bottom: 100px; width: 100%;">
                <thead class="sticky-header">
                    <tr>
                        <th class="sticky-column">EMPLEADO</th>
                         ${dates.map(date => {
        const dObj = parseDate(date);
        const isH = isDayHoliday(date, state.settings?.holidays);
        const isS = dObj.getDay() === 0;
        const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const dayLabel = `${dayNames[dObj.getDay()]} ${dObj.getDate()}`;
        return `<th class="${isH ? 'holiday-header' : ''} ${isS ? 'sunday-header' : ''}">${dayLabel}</th>`;
    }).join('')}
                    </tr>
                </thead>
                <tbody id="week-view-tbody">
                    ${tbodyHTML}
                </tbody>
                <tfoot>
                    ${WeekViewTotalsRow(dates)}
                </tfoot>
            </table>
        </div>
    `;
}

export function WeekRow(emp, week, positionMapArg = null) {
    const dates = (Array.isArray(week) && week.length > 0) ? week : getPeriodViewDates().dates;
    const positionMap = positionMapArg || new Map(state.positions.map(p => [p.id, p]));
    // ⚡ P4-OPT: Fingerprint = updatedAt de cada día de la semana para este empleado
    const deps = [
        emp.updatedAt ?? 0,
        state.settings?.updatedAt ?? 0, // ⚡ P4-OPT: Sincronismo vía timestamp global de settings
        normalizeRegularHoursPerDay(state.settings?.regularHoursPerDay),
        ...dates.map(date => {
            const att = state.attendance[`${emp.id}-${getDateKey(date)}`];
            return att?.updatedAt ?? 0;
        })
    ];
    return componentMemo.get(
        `week-row-${emp.id}-${getDateKey(dates[0])}-${dates.length}`,
        () => _buildWeekRow(emp, dates, positionMap, deps.join('-')),
        deps
    );
}

function _buildWeekRow(emp, week, positionMap, depsFingerprint) {
    const fingerprint = `${emp.id}-${getDateKey(week[0])}-${depsFingerprint}`;
    return `
        <tr id="week-row-${emp.id}" data-memo-f="${fingerprint}">
            <td class="sticky-column">
                <div class="week-employee-cell">
                        <div class="week-employee-name-container">
                            <div class="week-employee-name" style="cursor: pointer;" role="button" tabindex="0" data-att-action="view-employee-details" data-id="${emp.id}" aria-label="Ver detalles de ${escapeHTML(emp.name)}">${formatSplitName(emp.name)}</div>
                        <div class="week-employee-positions" style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">
                            ${emp.positions?.map(pid => positionMap.get(pid)?.name).filter(Boolean).join(' • ') || 'Sin posición'}
                        </div>
                    </div>
                    <div class="employee-number">${emp.number}</div>
                </div>
            </td>
            ${week.map(date => {
        const dObj = parseDate(date);
        const isS = dObj.getDay() === 0;
        const isH = isDayHoliday(date, state.settings?.holidays);
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
                    <td class="${isS ? 'sunday-cell' : ''} ${isH ? 'holiday-cell' : ''}">
                        <div class="day-cell">
                            <div class="week-check-wrapper" role="button" tabindex="0" data-att-action="handle-week-check" data-emp-id="${emp.id}" data-date-key="${dKey}">
                                <div class="check-box week-check-box ${cColor}">${isCh ? '✓' : ''}</div>
                                ${isCh ? `<div class="hours-badge">${att.hoursWorked}h</div>` : ''}
                            </div>
                            ${isCh && emp.positions?.length > 1 ? `
                                <div class="week-position-toggles">
                                    ${emp.positions.map(pid => {
            const pos = positionMap.get(pid);
            if (!pos) return '';
            const isSel = selP === pid;
            return `<button class="week-position-toggle ${isSel ? 'active' : ''}" 
                                                        data-att-action="toggle-week-position" data-emp-id="${emp.id}" data-pos-id="${pid}" data-date-key="${dKey}">
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
 * 📏 Fila de Totales (Vista Semanal / Período)
 */
export function WeekViewTotalsRow(datesArg = null) {
    const dates = (Array.isArray(datesArg) && datesArg.length > 0) ? datesArg : getPeriodViewDates().dates;
    return `
        <tr id="week-totals-row" style="background: linear-gradient(135deg, rgba(6, 182, 212, 0.1), rgba(16, 185, 129, 0.1)); border-top: 2px solid #06b6d4;">
            <td class="sticky-column" style="padding: 12px 16px; background: #0f172a; z-index: 5;">
                <div style="font-weight: 700; color: #06b6d4; font-size: 0.875rem;">TOTALES</div>
            </td>
            ${dates.map(date => {
        const dObj = parseDate(date);
        const isS = dObj.getDay() === 0;
        const isH = isDayHoliday(date, state.settings?.holidays);
        const dKey = getDateKey(date);
        // ⚡ P3-OPT: Lookup O(1) en lugar de filter O(N) sobre todo el historial
        // F1.5: los totales del día cuentan sólo registros del proyecto efectivo.
        const dayAttendance = (state.attendanceByDate[dKey] || []).filter(a => a.present && entityInScope(a));
        const totalHours = dayAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0);
        const presentCount = dayAttendance.length;
        return `
                    <td class="${isS ? 'sunday-cell' : ''} ${isH ? 'holiday-cell' : ''}" style="text-align: center; padding: 12px 8px;">
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
export function getFilteredEmployeesForWeek(week, positionMapArg = null) {
    const dates = (Array.isArray(week) && week.length > 0) ? week : getPeriodViewDates().dates;
    const startDate = dates[0];
    const endDate = dates[dates.length - 1];
    
    // Crear mapa si no se provee
    const positionMap = positionMapArg || new Map(state.positions.map(p => [p.id, p]));

    let employees = state.employees.filter(emp => {
        if (!entityInScope(emp)) return false; // F1.5: alcance de proyecto activo
        if (wasEmployeeActiveInRange(emp, startDate, endDate, state.attendance)) return true;
        // Activo HOY → aparece desde su ingreso, consistente con la vista diaria.
        if (emp.active === true) {
            const hire = emp.hireDate ? String(emp.hireDate).slice(0, 10) : null;
            const end = typeof endDate === 'string' ? endDate : getDateKey(endDate);
            if (!hire || end >= hire) return true;
        }
        return false;
    });
    employees.sort((a, b) => (a.number || '').localeCompare(b.number || '', 'es', { numeric: true }));

    if (state.filters.leaderId && state.filters.leaderId !== 'all') {
        employees = employees.filter(emp => emp.positions?.some(pid => positionMap.get(pid)?.leaderId === state.filters.leaderId));
    }

    if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        employees = employees.filter(emp => {
            const matchesName = emp.name.toLowerCase().includes(term);
            const matchesNumber = emp.number.toLowerCase().includes(term);
            const matchesPosition = emp.positions?.some(pid => positionMap.get(pid)?.name.toLowerCase().includes(term));
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

    const dates = getPeriodViewDates().dates;
    const temp = document.createElement('tbody');
    temp.innerHTML = WeekRow(emp, dates);
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
window.getPeriodViewDates = getPeriodViewDates;
window.getWeekDates = DateUtils.getWeekDates;
