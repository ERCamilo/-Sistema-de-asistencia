import { state } from '../core/AppState.js';
import { AttendanceService } from '../features/attendance/AttendanceService.js';
import { HolidayService } from '../features/attendance/HolidayService.js';
import { PayrollService } from '../features/payroll/PayrollService.js';
import { ChartService } from '../features/analytics/ChartService.js';

import storageService from './StorageService.js';
import indexedDBService from './IndexedDBService.js';
import dataService from './DataService.js';
import FirebaseService from './FirebaseService.js';

import { ScrollService } from './ScrollService.js';

// Instancias de Negocio
export const attendanceService = new AttendanceService(state);
export const holidayService = new HolidayService(state);
export const payrollService = new PayrollService(state);
export const chartService = new ChartService(state);

export { storageService, indexedDBService, dataService, FirebaseService, ScrollService };

// Hacerlos disponibles globalmente para compatibilidad Legacy (Temporal)
globalThis.indexedDBService = indexedDBService;
globalThis.dataService = dataService;
globalThis.attendanceService = attendanceService;
globalThis.holidayService = holidayService;
globalThis.payrollService = payrollService;
globalThis.chartService = chartService;
globalThis.ScrollService = ScrollService;
