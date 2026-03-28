/**
 * WebWorkerPool: Gestión de trabajadores en paralelo (Workers inline).
 * Permite ejecutar tareas pesadas fuera del hilo principal de UI.
 * Parte de la infraestructura core (Alpha Refactorizer).
 */
class WebWorkerPool {
    constructor() {
        this.workers = new Map();
        this.tasks = this.defineTasksDefinitions();
    }

    // Definir tareas inline (Extensible)
    defineTasksDefinitions() {
        return {
            'calculateMonthlyStats': function (e) {
                const { attendance, employees, startDate, endDate } = e.data;
                const stats = {
                    totalDays: 0,
                    totalHours: 0,
                    totalOvertime: 0,
                    employeeStats: {}
                };

                employees.forEach(emp => {
                    const empAttendance = attendance.filter(a =>
                        a.employeeId === emp.id &&
                        a.date >= startDate &&
                        a.date <= endDate &&
                        a.present
                    );

                    stats.employeeStats[emp.id] = {
                        days: empAttendance.length,
                        hours: empAttendance.reduce((sum, a) => sum + (a.hoursWorked || 0), 0),
                        overtime: empAttendance.reduce((sum, a) => sum + (a.overtimeHours || 0), 0)
                    };

                    stats.totalDays += empAttendance.length;
                    stats.totalHours += stats.employeeStats[emp.id].hours;
                    stats.totalOvertime += stats.employeeStats[emp.id].overtime;
                });

                self.postMessage({ type: 'result', data: stats });
            },

            'generateReport': function (e) {
                const { employees, attendance, period } = e.data;
                const report = {
                    period: period,
                    generatedAt: new Date().toISOString(),
                    employees: []
                };

                employees.forEach(emp => {
                    const empAtt = attendance.filter(a => a.employeeId === emp.id && a.present);
                    report.employees.push({
                        id: emp.id,
                        name: emp.name,
                        number: emp.number,
                        totalDays: empAtt.length,
                        totalHours: empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0),
                        averageHours: empAtt.length > 0 ?
                            empAtt.reduce((sum, a) => sum + (a.hoursWorked || 0), 0) / empAtt.length : 0
                    });
                });

                self.postMessage({ type: 'result', data: report });
            }
        };
    }

    // Crear worker inline desde función
    createInlineWorker(taskFunction) {
        const code = `self.onmessage = ${taskFunction.toString()};`;
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        return new Worker(url);
    }

    // Ejecutar tarea
    async execute(taskName, data) {
        const taskFunction = this.tasks[taskName];
        if (!taskFunction) {
            throw new Error(`Tarea '${taskName}' no encontrada`);
        }

        return new Promise((resolve, reject) => {
            const worker = this.createInlineWorker(taskFunction);
            const timeout = setTimeout(() => {
                worker.terminate();
                reject(new Error('Worker timeout'));
            }, 30000);

            worker.onmessage = (e) => {
                clearTimeout(timeout);
                if (e.data.type === 'result') {
                    resolve(e.data.data);
                }
                worker.terminate();
            };

            worker.onerror = (error) => {
                clearTimeout(timeout);
                reject(error);
                worker.terminate();
            };

            worker.postMessage(data);
        });
    }
}

const workerPool = new WebWorkerPool();
export default workerPool;
