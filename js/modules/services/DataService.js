import { state, buildAttendanceIndex, invalidateAllStats } from '../core/AppState.js';
import storageService from './StorageService.js';
import indexedDBService from './IndexedDBService.js';
// L4: imports explícitos — antes estos símbolos se resolvían vía globals que
// app.js cuelga de globalThis; un cambio en el orden de carga rompía
// loadAll()/reset() con ReferenceError silencioso.
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';
import { Attendance } from '../features/attendance/Attendance.js';
import { Modal } from '../components/Modal.js';
import { Notification } from '../components/Notification.js';
import icons from '../ui/IconSystem.js';
// Fase 0.5 (U3): borrado local REAL — todo rastro, incluidas las colas de
// borrado pendientes hacia la nube (bug ALTA #2: sobrevivían al reset y
// ejecutaban borrados viejos EN LA NUBE tras el siguiente login). El ciclo
// DataService → LocalWipeService → PersistenceService → DataService es
// seguro: todas las referencias cruzadas ocurren dentro de funciones, nunca
// durante la evaluación del módulo.
import { wipeAllLocalTraces } from './LocalWipeService.js';

export class DataService {
    constructor() {
        this.state = state;
        this.storage = storageService;
        this.indexedDBService = indexedDBService;
    }

    // Guardar todo el estado
    saveAll() {
        const data = {
            employees: this.state.employees,
            positions: this.state.positions,
            leaders: this.state.leaders,
            attendance: this.state.attendance,
            settings: this.state.settings,
            today: this.state.today,
            selectedDate: this.state.selectedDate,
            dayHoursConfig: this.state.dayHoursConfig,
            quickWeekHours: this.state.quickWeekHours,
            dashboardStartDate: this.state.dashboardStartDate,
            dashboardEndDate: this.state.dashboardEndDate,
            employeeReportStartDate: this.state.employeeReportStartDate,
            employeeReportEndDate: this.state.employeeReportEndDate,
            version: '2.0',
            savedAt: new Date().toISOString()
        };

        const result = this.storage.save(data);
        console.log(`💾 Datos guardados (${data.employees.length} emp, ${Object.keys(data.attendance).length} att)`);

        return result;
    }

    // Cargar todo el estado
    loadAll() {
        const data = this.storage.load();
        if (!data) return false;

        // Reconstruir objetos Employee, Position, etc.
        if (data.employees) {
            this.state.employees = data.employees.map(e =>
                e instanceof Employee ? e : new Employee(e)
            );
        }

        if (data.positions) {
            const seenPositions = new Set();
            this.state.positions = data.positions
                .map(p => (p instanceof Position ? p : new Position(p)))
                .filter(p => {
                    const key = p.id || p.name;
                    if (seenPositions.has(key)) return false;
                    seenPositions.add(key);
                    return true;
                });
        }

        if (data.leaders) {
            this.state.leaders = data.leaders.map(l =>
                l instanceof Leader ? l : new Leader(l)
            );
        }

        if (data.attendance) {
            this.state.attendance = {};
            Object.entries(data.attendance).forEach(([key, value]) => {
                this.state.attendance[key] = value instanceof Attendance ? value : new Attendance(value);
            });
            // Bulk replace → explicit coherence (load-bearing once the proxy traps
            // are removed in Paso 4): total index rebuild + wholesale stats clear.
            invalidateAllStats();
            buildAttendanceIndex();
        }

        if (data.settings) {
            Object.assign(this.state.settings, data.settings);
        }

        // 💡 Restaurar fechas (Reviviendo strings ISO a objetos Date)
        const reviveDate = (val) => {
            if (!val) return null;
            const d = new Date(val);
            return isNaN(d.getTime()) ? new Date() : d;
        };

        if (data.today) {
            this.state.today = reviveDate(data.today);
        }
        if (data.selectedDate) {
            this.state.selectedDate = reviveDate(data.selectedDate);
        }

        // 💡 Restaurar configuraciones de horas
        if (data.dayHoursConfig) {
            this.state.dayHoursConfig = data.dayHoursConfig;
        }
        if (data.quickWeekHours !== undefined) {
            this.state.quickWeekHours = data.quickWeekHours;
        }

        // 💡 Restaurar fechas del dashboard
        if (data.dashboardStartDate) {
            this.state.dashboardStartDate = reviveDate(data.dashboardStartDate);
        }
        if (data.dashboardEndDate) {
            this.state.dashboardEndDate = reviveDate(data.dashboardEndDate);
        }

        // 💡 Restaurar fechas del reporte de empleados
        if (data.employeeReportStartDate) {
            this.state.employeeReportStartDate = reviveDate(data.employeeReportStartDate);
        }
        if (data.employeeReportEndDate) {
            this.state.employeeReportEndDate = reviveDate(data.employeeReportEndDate);
        }

        if (window.debug) window.debug.log(`${icons.get('info')} Datos cargados correctamente`);
        return true;
    }

    async reset() {
        // Fase 0.5 (U3): texto HONESTO — antes decía "los datos en la nube no
        // se verán afectados" pero la cola de borrados pendientes sobrevivía
        // en localStorage y ejecutaba borrados EN LA NUBE tras el re-login.
        // wipeAllLocalTraces() purga todo pendiente antes de limpiar, y el
        // mensaje aclara qué pasa después si seguís con la sesión iniciada.
        Modal.confirm({
            title: `${icons.get('info')} Borrar Información Local`,
            message: '¿Eliminar TODOS los datos de ESTE dispositivo (empleados, asistencias, ajustes y subidas pendientes)? '
                + 'Los datos en la nube NO se tocan. '
                + 'Si mantienes la sesión iniciada, al recargar se descargarán de nuevo desde la nube.',
            confirmText: 'Sí, borrar local',
            cancelText: 'Cancelar',
            type: 'danger',
            onConfirm: async () => {
                // Borrado REAL de todo rastro (U3): bloquea guardados
                // implícitos (U2), purga pendientes hacia la nube (U1) y
                // limpia localStorage completo + sessionStorage + IndexedDB
                // + propiedad del dispositivo. Best-effort: un fallo parcial
                // se loguea y se sigue — ver LocalWipeService.
                const result = await wipeAllLocalTraces();
                if (!result.ok) {
                    console.warn('⚠️ Borrado local parcial:', result.errors);
                }

                console.log('✅ Borrado local completo');
                location.reload();
            }
        });
    }

    // Exportar datos
    exportData() {
        const url = this.storage.export();
        if (!url) {
            Notification.error(`${icons.get('info')} No hay datos para exportar`);
            return;
        }

        const a = document.createElement('a');
        a.href = url;
        a.download = `asistencia-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        Notification.success(`${icons.get('info')} Datos exportados correctamente`);
    }

    // Importar datos
    importData(file) {
        this.storage.import(file)
            .then(data => {
                this.loadAll();
                Notification.success(`${icons.get('info')} Datos importados correctamente`);
                // render() is not generic, assuming render() function exists globally or passed as callback? 
                // In app.js it called render(). Here it's inside a module. 
                // Ideally this should trigger an event or callback.
                // For now, I'll rely on global render() if available or refactor later.
                // Wait, 'render' is not imported. It's a global function in app.js.
                if (window.render) window.render();
            })
            .catch(error => {
                Notification.error(`${icons.get('info')} Error al importar: ${error.message}`, 6000);
            });
    }
}

export const dataService = new DataService();
export default dataService;
