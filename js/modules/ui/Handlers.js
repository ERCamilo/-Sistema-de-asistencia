/**
 * 🕹️ CONTROLADORES DE INTERACCIÓN (Fase 3 - Modularización)
 * Este módulo vincula las acciones de la UI con la lógica de negocio y el estado.
 */

import { state } from '../core/AppState.js';
import { render, saveScrollPosition, restoreScrollPosition, renderZone } from '../core/RenderManager.js';
import { eventBus } from '../core/Events.js';
import { modalManager } from '../core/ModalManager.js';
import { saveApplicationData } from '../services/PersistenceService.js';
import { buildAttendanceIndex } from '../core/AppState.js';
import { perfMonitor } from '../core/Performance.js';
import { Notification } from '../components/Notification.js';
import { UndoManager } from '../utils/UndoManager.js';
import { 
    getDateKey, parseDate, isDayHoliday, getDayHours 
} from '../utils/DateUtils.js';
import { getCheckColor } from './AttendanceUI.js';
import { 
    payrollService, 
    holidayService, 
    FirebaseService 
} from '../services/index.js';
import { formatCurrency } from '../utils/Formatters.js';
import { StatsGrid } from './AttendanceUI.js';

// --- ASISTENCIA ---

window.toggleAttendance = (empId, date = state.selectedDate) => {
    perfMonitor.start('toggleAttendance');
    const key = `${empId}-${getDateKey(date)}`;
    const att = state.attendance[key];
    const emp = state.employees.find(e => e.id === empId);

    const previousAtt = att ? { ...att, positionHours: att.positionHours ? [...att.positionHours] : [] } : null;

    if (att && att.present) {
        if (state.viewMode === 'week') return;
        delete state.attendance[key];
        UndoManager.push(previousAtt, `Asistencia de ${emp.name}`, () => { state.attendance[key] = previousAtt; });
    } else {
        const dayHours = getDayHours(date, state.settings?.dayHours);
        const selectedPos = state.tempPositionSelection?.[key] || emp.positions?.[0] || null;

        state.attendance[key] = {
            employeeId: empId,
            date: getDateKey(date),
            present: true,
            hoursWorked: dayHours,
            overtimeHours: 0,
            isHoliday: isDayHoliday(date, state.settings?.holidays),
            selectedPosition: selectedPos,
            multiPosition: false,
            positionHours: [],
            notes: '',
            updatedAt: Date.now()
        };

        UndoManager.push(null, `Asistencia de ${emp.name}`, () => { delete state.attendance[key]; });
    }

    buildAttendanceIndex(); // ⚡ P3-OPT: Actualizar índice tras mutación
    saveApplicationData({ dateKey: getDateKey(date) });
    
    if (state.viewMode === 'day') {
        updateCheckboxOnly(empId);
        renderZone('day-stats', () => StatsGrid());
        perfMonitor.end('toggleAttendance');
    } else {
        render();
        perfMonitor.end('toggleAttendance');
    }
};

function updateCheckboxOnly(empId) {
    const key = `${empId}-${getDateKey(state.selectedDate)}`;
    const att = state.attendance[key];
    const emp = state.employees.find(e => e.id === empId);
    const isChecked = att && att.present;
    
    const checkboxContainer = document.querySelector(`#emp-row-${empId} .check-container`);
    if (!checkboxContainer) { render(); return; }

    const checkInput = checkboxContainer.querySelector('.check-input');
    if (checkInput) checkInput.checked = isChecked;

    const checkBox = checkboxContainer.querySelector('.check-box');
    if (checkBox) {
        const checkColor = getCheckColor(att, state.selectedDate, state.settings);
        checkBox.className = `check-box ${checkColor}`;
        checkBox.textContent = isChecked ? '✓' : '';
    }

    let hoursBadge = checkboxContainer.querySelector('.hours-badge');
    if (isChecked) {
        if (!hoursBadge) {
            hoursBadge = document.createElement('div');
            hoursBadge.className = 'hours-badge';
            checkboxContainer.appendChild(hoursBadge);
        }
        hoursBadge.innerHTML = `${att.hoursWorked}h${att.multiPosition ? ' 🔄' : ''}`;
    } else if (hoursBadge) {
        hoursBadge.remove();
    }
}

window.handleWeekCheck = (empId, dateStr) => {
    if (state.isProcessingClick) return;
    state.isProcessingClick = true;
    saveScrollPosition();

    const key = `${empId}-${dateStr}`;
    const att = state.attendance[key];

    if (att && att.present) {
        // Abrir menú contextual
        state.contextMenu = {
            type: 'week',
            employeeId: empId,
            date: dateStr,
            x: window.innerWidth / 2 - 110,
            y: window.scrollY + 150
        };
    } else {
        const date = parseDate(dateStr);
        const emp = state.employees.find(e => e.id === empId);
        
        // 🔥 Unificación: Usar horas configuradas para el día, o el default
        const hours = state.dayHoursConfig?.[dateStr] ?? state.settings?.regularHoursPerDay ?? 8;

        state.attendance[key] = {
            employeeId: empId,
            date: dateStr,
            present: true,
            hoursWorked: hours,
            overtimeHours: 0,
            isHoliday: isDayHoliday(date, state.settings.holidays),
            selectedPosition: emp.positions?.[0] || null,
            multiPosition: false,
            positionHours: emp.positions?.[0] ? [{ positionId: emp.positions[0], hours: hours }] : [],
            updatedAt: Date.now()
        };
        buildAttendanceIndex(); // ⚡ P3-OPT: Actualizar índice tras mutación
        saveApplicationData({ dateKey: dateStr });
    }
    state.isProcessingClick = false;
    render();
};

window.saveAdvancedAttendance = () => {
    const emp = state.selectedEmployee;
    if (!emp) return;

    const dateKey = getDateKey(state.selectedDate);
    const key = `${emp.id}-` + dateKey;
    
    // Simplificación: Leer del DOM (esto es frágil, pero mantiene compatibilidad)
    const hours = parseFloat(document.getElementById('hoursWorked')?.value || 0);
    const overtime = parseFloat(document.getElementById('overtimeHours')?.value || 0);
    const notes = document.getElementById('notes')?.value || '';

    state.attendance[key] = {
        ...state.attendance[key],
        hoursWorked: hours,
        overtimeHours: overtime,
        notes: notes,
        present: true,
        updatedAt: Date.now()
    };

    buildAttendanceIndex(); // ⚡ P3-OPT: Actualizar índice tras mutación
    saveApplicationData({ dateKey });
    modalManager.close();
    render();
};

// --- PERFIL Y NÓMINA ---

window.openEmployeeProfile = (employeeId) => {
    state.employeeProfile = {
        employeeId,
        activeTab: 'nomina',
        periodStart: getDateKey(new Date(Date.now() - 14 * 86400000)),
        periodEnd: getDateKey(new Date()),
        deductions: [{ id: 'DED-1', type: 'percentage', value: 2, name: 'Deducción' }]
    };
    state.showEmployeeProfile = true;
    render();
};

window.closeEmployeeProfile = () => {
    state.showEmployeeProfile = false;
    render();
};

window.markAsPaid = () => {
    const emp = state.employees.find(e => e.id === state.employeeProfile.employeeId);
    if (!emp) return;
    saveApplicationData();
    Notification.success('✅ Marcado como pagado');
    render();
};

// --- NUBE ---

window.uploadToCloud = async () => {
    const loading = Notification.loading('📤 Sincronizando...');
    try {
        await FirebaseService.saveFullState(state);
        Notification.success('✅ Sincronizado');
    } catch (e) {
        Notification.error('❌ Error');
    } finally {
        loading.close();
    }
};

window.downloadFromCloud = async () => {
    const loading = Notification.loading('📥 Descargando...');
    try {
        const cloudData = await FirebaseService.getFullState();
        if (cloudData) {
            Object.assign(state, cloudData);
            saveApplicationData();
            Notification.success('✅ Datos actualizados');
        }
    } catch (e) {
        Notification.error('❌ Error');
    } finally {
        loading.close();
    }
};

// --- OTROS ---

window.closeModal = () => modalManager.close();
window.toggleSidebar = () => {
    state.settings.sidebarCollapsed = !state.settings.sidebarCollapsed;
    saveApplicationData();
    render();
};
