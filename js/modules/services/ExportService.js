/**
 * 📤 ExportService.js - Motor de Exportación de Datos (CSV/JSON)
 * Parte de la Fase 6: Infraestructura de Sistema (Alpha Refactorizer)
 * Utiliza WebWorkers para no bloquear el hilo principal durante grandes exportaciones.
 */

export class ExportService {
    constructor(indexedDBService, notificationSystem, debugSystem) {
        this.indexedDBService = indexedDBService;
        this.Notification = notificationSystem;
        this.debug = debugSystem;
        this.exportWorker = null;
    }

    /**
     * Crear el worker dedicado a procesamiento de datos
     */
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
                        // Escalar valores con comas o comillas
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

    /**
     * Exportar a CSV mediante Worker
     */
    async exportToCSV(data, filename = 'export.csv') {
        return new Promise((resolve, reject) => {
            if (!this.exportWorker) {
                this.exportWorker = this.createExportWorker();
            }

            this.exportWorker.onmessage = (e) => {
                if (e.data.type === 'csv') {
                    const blob = new Blob([e.data.data], { type: 'text/csv;charset=utf-8;' });
                    this.downloadBlob(blob, filename);
                    resolve();
                }
            };

            this.exportWorker.onerror = (error) => {
                reject(error);
            };

            this.exportWorker.postMessage({ type: 'csv', data });
        });
    }

    /**
     * Exportar a JSON mediante Worker
     */
    async exportToJSON(data, filename = 'export.json') {
        return new Promise((resolve, reject) => {
            if (!this.exportWorker) {
                this.exportWorker = this.createExportWorker();
            }

            this.exportWorker.onmessage = (e) => {
                if (e.data.type === 'json') {
                    const blob = new Blob([e.data.data], { type: 'application/json' });
                    this.downloadBlob(blob, filename);
                    resolve();
                }
            };

            this.exportWorker.onerror = (error) => {
                reject(error);
            };

            this.exportWorker.postMessage({ type: 'json', data });
        });
    }

    /**
     * Descarga física del archivo en el navegador
     */
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

    /**
     * Exportar reporte mensual completo
     */
    async exportMonthlyAttendance(year, month) {
        try {
            const employees = await this.indexedDBService.getAll('employees');
            const attendance = await this.indexedDBService.getAll('attendance');

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

            this.Notification.success(`✅ Exportado: ${filename}`);
        } catch (error) {
            this.debug.error('❌ Error al exportar:', error);
            this.Notification.error('❌ Error al exportar datos');
        }
    }

    /**
     * Compartir archivo mediante el sistema nativo
     */
    async shareFile(blob, title, filename) {
        if (!navigator.share || !navigator.canShare) {
            this.Notification.info('ℹ️ Share no disponible, descargando...');
            this.downloadBlob(blob, filename);
            return false;
        }

        try {
            const file = new File([blob], filename, { type: blob.type });

            if (navigator.canShare({ files: [file] })) {
                await navigator.share({
                    title: title,
                    files: [file]
                });
                this.Notification.success('✅ Archivo compartido');
                return true;
            } else {
                this.downloadBlob(blob, filename);
                return false;
            }
        } catch (error) {
            this.debug.error('❌ Error al compartir:', error);
            this.downloadBlob(blob, filename);
            return false;
        }
    }
}
