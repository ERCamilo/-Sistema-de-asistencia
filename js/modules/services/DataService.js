import icons from '../ui/IconSystem.js';
import { Modal } from '../components/Modal.js';
import { Employee } from '../features/employees/Employee.js';
import { Position } from '../features/employees/Position.js';
import { Leader } from '../features/employees/Leader.js';
import { Attendance } from '../features/attendance/Attendance.js';

export class DataService {
    constructor(state, storage, indexedDBService = null) {
        this.state = state;
        this.storage = storage;
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
        Modal.confirm({
            title: `${icons.get('info')} Borrar Información Local`,
            message: '¿Estás seguro de eliminar TODOS los datos locales (empleados, asistencias, etc.)? Los datos en la nube no se verán afectados.',
            confirmText: 'Sí, borrar local',
            cancelText: 'Cancelar',
            type: 'danger',
            onConfirm: async () => {
                // 1. Limpiar LocalStorage
                this.storage.clear();
                
                // 2. Limpiar IndexedDB si está disponible
                if (this.indexedDBService) {
                    await this.indexedDBService.clearAll();
                } else if (window.indexedDBService) {
                    await window.indexedDBService.clearAll();
                }
                
                // 3. Limpiar banderas de migración
                localStorage.removeItem('migrated-to-idb');
                localStorage.removeItem('onboardingCompleted');

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
