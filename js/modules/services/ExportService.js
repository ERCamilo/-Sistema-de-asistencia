/**
 * 📤 SERVICIO DE EXPORTACIÓN
 * Maneja la generación de reportes CSV/JSON y compartición de archivos.
 */

import { indexedDBService } from './IndexedDBService.js';

export class ExportService {
    constructor() {
        this.exportWorker = null;
    }

    createExportWorker() {
        const workerCode = `
            self.onmessage = (e) => {
                const { type, data } = e.data;
                if (type === 'csv') {
                    const csv = convertToCSV(data);
                    self.postMessage({ type: 'csv', data: csv });
                }
                if (type === 'json') {
                    const json = JSON.stringify(data, null, 2);
                    self.postMessage({ type: 'json', data: json });
                }
            };
            function convertToCSV(data) {
                if (!data || data.length === 0) return '';
                const headers = Object.keys(data[0]);
                const csvHeaders = headers.join(',');
                const rows = data.map(row => {
                    return headers.map(header => {
                        let value = row[header];
                        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                            value = '"' + value.replace(/"/g, '""') + '"';
                        }
                        return value;
                    }).join(',');
                });
                return [csvHeaders, ...rows].join('\\n');
            }
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        return new Worker(URL.createObjectURL(blob));
    }

    async exportToCSV(data, filename = 'export.csv') {
        return new Promise((resolve, reject) => {
            if (!this.exportWorker) this.exportWorker = this.createExportWorker();
            this.exportWorker.onmessage = (e) => {
                if (e.data.type === 'csv') {
                    const blob = new Blob([e.data.data], { type: 'text/csv;charset=utf-8;' });
                    this.downloadBlob(blob, filename);
                    resolve();
                }
            };
            this.exportWorker.onerror = reject;
            this.exportWorker.postMessage({ type: 'csv', data });
        });
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async exportMonthlyAttendance(year, month) {
        try {
            const employees = await indexedDBService.getAll('employees');
            const attendance = await indexedDBService.getAll('attendance');
            const monthlyData = attendance.filter(a => {
                const date = new Date(a.date);
                return date.getFullYear() === year && date.getMonth() === month;
            });
            const exportData = monthlyData.map(a => {
                const emp = employees.find(e => e.id === a.employeeId);
                return {
                    Fecha: a.date,
                    Empleado: emp ? emp.name : a.employeeId,
                    Numero: emp ? emp.number : '',
                    Horas: a.hoursWorked || 0,
                    HorasExtra: a.overtimeHours || 0,
                    Festivo: a.isHoliday ? 'Sí' : 'No',
                    Notas: a.notes || ''
                };
            });
            const filename = `asistencia-${year}-${String(month + 1).padStart(2, '0')}.csv`;
            await this.exportToCSV(exportData, filename);
            if (window.Notification) window.Notification.success(`✅ Exportado: ${filename}`);
        } catch (error) {
            console.error('❌ Error al exportar:', error);
        }
    }
}

export const exportService = new ExportService();
