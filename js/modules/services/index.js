/**
 * 🛠️ services/index.js - Registro Central de Servicios
 * Punto único de acceso para instancias de servicios (Singletons).
 */

import { state } from '../core/AppState.js';
import { IndexedDBService } from './IndexedDBService.js';
import { DataService } from './DataService.js';
import FirebaseService from './FirebaseService.js';
import { StorageService } from './StorageService.js';
import { AttendanceService } from '../features/attendance/AttendanceService.js';
import { HolidayService } from '../features/attendance/HolidayService.js';
import { PayrollService } from '../features/payroll/PayrollService.js';
import { ChartService } from '../features/analytics/ChartService.js';

// 1. Instancias de Infraestructura
export const storageService = new StorageService();
export const indexedDBService = new IndexedDBService();

// 2. Instancias de Negocio
export const attendanceService = new AttendanceService(state);
export const holidayService = new HolidayService(state);
export const payrollService = new PayrollService(state);
export const chartService = new ChartService(state);

// 3. Instancia de Datos (Depende de Infraestructura)
export const dataService = new DataService(state, storageService, indexedDBService);

// 4. Exportar FirebaseService (es un objeto con métodos estáticos/instancia fija)
export { FirebaseService };

// Hacerlos disponibles globalmente para compatibilidad Legacy (Temporal)
globalThis.indexedDBService = indexedDBService;
globalThis.dataService = dataService;
globalThis.attendanceService = attendanceService;
globalThis.holidayService = holidayService;
globalThis.payrollService = payrollService;
globalThis.chartService = chartService;
