/**
 * SUPABASE SERVICE
 * Módulo para gestionar la sincronización y autenticación con Supabase.
 */

export class SupabaseService {
    constructor(dependencies) {
        this.config = {
            url: 'https://whmkrkxphqmczsklvxpk.supabase.co',
            anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndobWtya3hwaHFtY3pza2x2eHBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyNTE1MzksImV4cCI6MjA4NTgyNzUzOX0.a9Y1xImann_2wzW0c41FsGPUDaN97RRTReRL8aE7sV8'
        };

        // Estado de Supabase
        this.useSupabase = false;
        this.currentUser = null;
        this.isSyncing = false;
        this.autoSyncEnabled = false;
        this.syncTimeout = null;
        this.uuidCache = {};

        // Dependencias externas
        this.state = dependencies.state;
        this.render = dependencies.render;
        this.showNotification = dependencies.showNotification;
        this.saveToLocalStorage = dependencies.saveToLocalStorage;
        this.applyIconSet = dependencies.applyIconSet;
        this.resolveIconSet = dependencies.resolveIconSet;

        // Inicializar cliente
        this.client = window.supabase.createClient(this.config.url, this.config.anonKey);
    }

    // ============================================
    // UTILERÍAS DE UUID
    // ============================================

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    isValidUUID(id) {
        if (!id || typeof id !== 'string') return false;
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(id);
    }

    ensureUUID(id) {
        if (this.isValidUUID(id)) return id;
        if (this.uuidCache[id]) return this.uuidCache[id];
        
        const newUUID = this.generateUUID();
        this.uuidCache[id] = newUUID;
        console.log(`🔄 ID migrado: "${id}" → "${newUUID}"`);
        return newUUID;
    }

    // ============================================
    // MÉTODOS DE SINCRONIZACIÓN
    // ============================================

    async loadFromSupabase() {
        if (!this.currentUser) return;

        try {
            console.log('☁️ Cargando TODOS los datos desde Supabase...');

            // 1. Cargar SETTINGS
            const { data: settings } = await this.client
                .from('settings')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (settings) {
                const previousIconSet = this.state.settings?.iconSet;
                this.state.settings = {
                    companyName: settings.company_name,
                    regularHoursPerDay: settings.regular_hours_per_day || 8,
                    overtimeFactor: settings.overtime_factor || 1.5,
                    holidayFactor: settings.holiday_factor || 2,
                    defaultDeductionPercentage: settings.default_deduction_percentage || 2,
                    globalPaymentDay: settings.global_payment_day || null,
                    holidays: settings.holidays || [],
                    lastPaymentDate: settings.last_payment_date,
                    nextPaymentDate: settings.next_payment_date,
                    iconSet: this.resolveIconSet(settings.icon_set || previousIconSet)
                };
                this.state.calendarMarkerMode = settings.calendar_marker_mode || 'holiday';
                this.state.settings.iconSet = this.applyIconSet(this.state.settings.iconSet);
                console.log('✅ Settings cargados');
            }

            // 2. Cargar LEADERS
            const { data: leaders } = await this.client
                .from('leaders')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('number');

            if (leaders && leaders.length > 0) {
                this.state.leaders = leaders.map(l => ({
                    id: l.id,
                    number: l.number,
                    name: l.name,
                    active: l.active,
                    phone: l.phone,
                    email: l.email,
                    notes: l.notes,
                    lastStatusChange: l.last_status_change,
                    statusHistory: l.status_history || []
                }));
                console.log('✅ Leaders cargados:', this.state.leaders.length);
            }

            // 3. Cargar POSITIONS
            const { data: positions } = await this.client
                .from('positions')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('name');

            if (positions && positions.length > 0) {
                this.state.positions = positions.map(p => ({
                    id: p.id,
                    name: p.name,
                    color: p.color,
                    hourlyRate: p.hourly_rate,
                    baseSalary: p.base_salary || p.hourly_rate,
                    workingDays: p.working_days || [1, 2, 3, 4, 5],
                    salaryConfig: p.salary_config,
                    leaderId: p.leader_id,
                    active: p.active,
                    lastStatusChange: p.last_status_change,
                    statusHistory: p.status_history || []
                }));
                console.log('✅ Positions cargadas:', this.state.positions.length);
            }

            // 4. Cargar EMPLOYEES
            const { data: employees } = await this.client
                .from('employees')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('number');

            if (employees && employees.length > 0) {
                this.state.employees = employees.map(e => ({
                    id: e.id,
                    key: e.id,
                    number: e.number,
                    name: e.name,
                    positions: e.positions || [],
                    positionSalaries: e.position_salaries || {},
                    customSalary: e.custom_salary,
                    customWorkingDays: e.custom_working_days || {},
                    hireDate: e.hire_date,
                    phone: e.phone,
                    email: e.email,
                    notes: e.notes,
                    active: e.active,
                    lastPaymentDate: e.last_payment_date,
                    lastStatusChange: e.last_status_change,
                    statusHistory: e.status_history || [],
                    createdDate: e.created_date
                }));
                console.log('✅ Employees cargados:', this.state.employees.length);
            }

            // 5. Cargar ATTENDANCE (con sus detalles)
            const { data: attendance } = await this.client
                .from('attendance')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .order('date', { ascending: false });

            if (attendance && attendance.length > 0) {
                this.state.attendance = {};
                const attendanceIds = attendance.map(a => a.id);
                
                const { data: attendancePositions } = await this.client
                    .from('attendance_positions')
                    .select('*')
                    .in('attendance_id', attendanceIds);

                const positionsByAttendance = {};
                if (attendancePositions) {
                    attendancePositions.forEach(ap => {
                        if (!positionsByAttendance[ap.attendance_id]) {
                            positionsByAttendance[ap.attendance_id] = [];
                        }
                        positionsByAttendance[ap.attendance_id].push({
                            positionId: ap.position_id,
                            hours: parseFloat(ap.hours) || 0,
                            overtimeHours: parseFloat(ap.overtime_hours) || 0
                        });
                    });
                }

                attendance.forEach(record => {
                    const key = `${record.employee_id}-${record.date}`;
                    const positionHours = positionsByAttendance[record.id] || [];

                    this.state.attendance[key] = {
                        employeeId: record.employee_id,
                        date: record.date,
                        present: record.present,
                        hoursWorked: parseFloat(record.hours_worked) || 0,
                        overtimeHours: parseFloat(record.overtime_hours) || 0,
                        isHoliday: record.is_holiday || false,
                        notes: record.notes || '',
                        selectedPosition: record.position_id,
                        multiPosition: record.multi_position || positionHours.length > 1,
                        useTempPosition: record.use_temp_position || false,
                        positionHours: positionHours
                    };
                });
                console.log('✅ Attendance cargados:', attendance.length);
            }

            // 6. TEMP_ASSIGNMENTS
            const { data: tempAssignments } = await this.client
                .from('temp_assignments')
                .select('*')
                .eq('user_id', this.currentUser.id);

            if (tempAssignments) {
                this.state.tempAssignments = tempAssignments.map(ta => ({
                    id: ta.id,
                    employeeId: ta.employee_id,
                    positionId: ta.position_id,
                    startDate: ta.start_date,
                    endDate: ta.end_date,
                    notes: ta.notes
                }));
            }

            // 7. DAY_HOURS_CONFIG
            const { data: dayHours } = await this.client
                .from('day_hours_config')
                .select('*')
                .eq('user_id', this.currentUser.id);

            if (dayHours) {
                this.state.dayHoursConfig = {};
                dayHours.forEach(dh => {
                    this.state.dayHoursConfig[dh.date] = {
                        hours: dh.hours,
                        notes: dh.notes
                    };
                });
            }

            console.log('🎉 Datos COMPLETOS cargados desde Supabase');
            this.render();

        } catch (error) {
            console.error('❌ Error cargando datos:', error);
            this.showNotification('⚠️ Error al cargar datos desde la nube', 'error');
        }
    }

    async migrateToSupabase() {
        if (!this.currentUser || this.isSyncing) return;
        this.isSyncing = true;

        try {
            console.log('📤 Iniciando migración COMPLETA a Supabase...');
            
            const idMap = { leaders: {}, positions: {}, employees: {} };

            // Obtener IDs existentes para evitar colisiones
            const { data: existingPos } = await this.client.from('positions').select('id').eq('user_id', this.currentUser.id);
            const { data: existingEmp } = await this.client.from('employees').select('id').eq('user_id', this.currentUser.id);
            const { data: existingLdr } = await this.client.from('leaders').select('id').eq('user_id', this.currentUser.id);

            const existingPosIds = new Set((existingPos || []).map(p => p.id));
            const existingEmpIds = new Set((existingEmp || []).map(e => e.id));
            const existingLdrIds = new Set((existingLdr || []).map(l => l.id));

            // Mapear IDs
            if (this.state.leaders) {
                this.state.leaders.forEach(l => {
                    const readyId = this.ensureUUID(l.id);
                    idMap.leaders[l.id] = existingLdrIds.has(readyId) ? readyId : this.generateUUID();
                });
            }

            if (this.state.positions) {
                this.state.positions.forEach(p => {
                    idMap.positions[p.id] = existingPosIds.has(p.id) ? p.id : this.generateUUID();
                });
            }

            if (this.state.employees) {
                this.state.employees.forEach(e => {
                    const oldId = e.id || e.key;
                    const readyId = this.ensureUUID(oldId);
                    idMap.employees[oldId] = existingEmpIds.has(readyId) ? readyId : this.generateUUID();
                });
            }

            const remapId = (oldId, type) => idMap[type]?.[oldId] || oldId;

            // 1. Settings
            const holidays = Array.isArray(this.state.settings.holidays)
                ? this.state.settings.holidays.map(h => typeof h === 'string' ? h : h.toISOString().split('T')[0])
                : [];

            const { error: settingsError } = await this.client.from('settings').upsert({
                user_id: this.currentUser.id,
                company_name: this.state.settings.companyName,
                regular_hours_per_day: this.state.settings.regularHoursPerDay,
                overtime_factor: this.state.settings.overtimeFactor,
                holiday_factor: this.state.settings.holidayFactor,
                default_deduction_percentage: this.state.settings.defaultDeductionPercentage,
                global_payment_day: this.state.settings.globalPaymentDay,
                holidays: holidays,
                last_payment_date: this.state.settings.lastPaymentDate,
                next_payment_date: this.state.settings.nextPaymentDate,
                calendar_marker_mode: this.state.calendarMarkerMode,
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

            if (settingsError) throw new Error(`Error en Settings: ${settingsError.message}`);

            // 2. Leaders
            if (this.state.leaders?.length > 0) {
                const leadersData = this.state.leaders.map(l => ({
                    id: remapId(l.id, 'leaders'),
                    user_id: this.currentUser.id,
                    number: l.number,
                    name: l.name,
                    active: l.active ?? true,
                    phone: l.phone,
                    email: l.email,
                    notes: l.notes,
                    last_status_change: l.lastStatusChange,
                    status_history: l.statusHistory || []
                }));
                const { error: ldrError } = await this.client.from('leaders').upsert(leadersData);
                if (ldrError) throw new Error(`Error en Líderes: ${ldrError.message}`);

                // Persistir IDs en el estado local
                this.state.leaders.forEach(l => {
                    l.id = remapId(l.id, 'leaders');
                });
            }

            // 3. Positions
            if (this.state.positions?.length > 0) {
                const positionsData = this.state.positions.map(p => ({
                    user_id: this.currentUser.id,
                    name: p.name,
                    color: p.color,
                    hourly_rate: p.hourlyRate || null,
                    working_days: p.workingDays || [1, 2, 3, 4, 5],
                    salary_config: p.salaryConfig,
                    base_salary: p.baseSalary || 0,
                    leader_id: remapId(p.leaderId, 'leaders'),
                    active: p.active ?? true,
                    last_status_change: p.lastStatusChange,
                    status_history: p.statusHistory || [],
                    updated_at: new Date().toISOString()
                }));
                const { error: posError } = await this.client.from('positions').upsert(positionsData, { onConflict: 'user_id,name' });
                if (posError) throw new Error(`Error en Posiciones: ${posError.message}`);
                
                // Actualizar idMap con IDs de DB (ya que onConflict usa name)
                const { data: dbPos } = await this.client.from('positions').select('id, name').eq('user_id', this.currentUser.id);
                if (dbPos) {
                    const dbPosMap = {};
                    dbPos.forEach(p => { dbPosMap[p.name] = p.id; });
                    this.state.positions.forEach(p => {
                        if (dbPosMap[p.name]) {
                            const newId = dbPosMap[p.name];
                            idMap.positions[p.id] = newId;
                            p.id = newId; // Persistir en estado local
                        }
                    });
                }
            }

            // 4. Employees
            if (this.state.employees?.length > 0) {
                const employeesData = this.state.employees.map(e => {
                    const posSalaries = {};
                    if (e.positionSalaries) {
                        Object.keys(e.positionSalaries).forEach(id => {
                            posSalaries[remapId(id, 'positions')] = e.positionSalaries[id];
                        });
                    }
                    const customWorkDays = {};
                    if (e.customWorkingDays) {
                        Object.keys(e.customWorkingDays).forEach(id => {
                            customWorkDays[remapId(id, 'positions')] = e.customWorkingDays[id];
                        });
                    }
                    return {
                        id: remapId(e.id || e.key, 'employees'),
                        user_id: this.currentUser.id,
                        number: e.number,
                        name: e.name,
                        positions: (e.positions || []).map(id => remapId(id, 'positions')),
                        position_salaries: posSalaries,
                        custom_salary: e.customSalary,
                        custom_working_days: customWorkDays,
                        hire_date: e.hireDate,
                        phone: e.phone,
                        email: e.email,
                        notes: e.notes,
                        active: e.active ?? true,
                        last_payment_date: e.lastPaymentDate,
                        last_status_change: e.lastStatusChange,
                        status_history: e.statusHistory || [],
                        created_date: e.createdDate || new Date().toISOString()
                    };
                });
                const { error: empError } = await this.client.from('employees').upsert(employeesData);
                if (empError) {
                    console.error('❌ Error en empleados:', empError);
                    if (empError.code === '23505') {
                        throw new Error(`Hay un empleado con un número duplicado que la nube rechaza.`);
                    }
                    throw new Error(`Error en Empleados: ${empError.message}`);
                }

                // Persistir IDs en el estado local
                this.state.employees.forEach(e => {
                    const oldId = e.id || e.key;
                    const newId = remapId(oldId, 'employees');
                    e.id = newId;
                    e.key = newId;
                });
            }

            // 5. Attendance
            const attendanceMap = this.state.attendance instanceof Map ? this.state.attendance : new Map(Object.entries(this.state.attendance || {}));
            if (attendanceMap.size > 0) {
                const attendanceData = [];
                const attPosData = [];

                attendanceMap.forEach((record, key) => {
                    const empId = record.employeeId || key.split('-').slice(0, -3).join('-');
                    const date = record.date || key.split('-').slice(-3).join('-');
                    const attId = this.generateUUID();

                    attendanceData.push({
                        id: attId,
                        user_id: this.currentUser.id,
                        employee_id: remapId(empId, 'employees'),
                        date: date,
                        present: record.present,
                        hours_worked: record.hoursWorked || record.hours || 0,
                        overtime_hours: record.overtimeHours || 0,
                        is_holiday: record.isHoliday || false,
                        position_id: remapId(record.selectedPosition, 'positions'),
                        notes: record.notes,
                        multi_position: record.multiPosition || false
                    });

                    if (record.positionHours?.length > 0) {
                        record.positionHours.forEach(ph => {
                            attPosData.push({
                                attendance_id: attId,
                                position_id: remapId(ph.positionId, 'positions'),
                                hours: ph.hours || 0,
                                overtime_hours: ph.overtimeHours || 0
                            });
                        });
                    }
                });

                // Limpiar viejo e insertar nuevo
                const { data: oldAtt } = await this.client.from('attendance').select('id').eq('user_id', this.currentUser.id);
                if (oldAtt?.length > 0) {
                    const oldIds = oldAtt.map(a => a.id);
                    await this.client.from('attendance_positions').delete().in('attendance_id', oldIds);
                    await this.client.from('attendance').delete().eq('user_id', this.currentUser.id);
                }

                // Lotes de 100
                for (let i = 0; i < attendanceData.length; i += 100) {
                    await this.client.from('attendance').insert(attendanceData.slice(i, i + 100));
                }
                for (let i = 0; i < attPosData.length; i += 100) {
                    await this.client.from('attendance_positions').insert(attPosData.slice(i, i + 100));
                }
            }

            console.log('🎉 Migración COMPLETA exitosa');
        } catch (error) {
            console.error('❌ Error en migración:', error);
        } finally {
            this.isSyncing = false;
        }
    }

    async syncNow() {
        await this.migrateToSupabase();
        await this.loadFromSupabase();
    }

    // ============================================
    // GESTIÓN DE SESIÓN
    // ============================================

    initAuth() {
        // Restaurar auto-sync pref
        const savedAutoSync = localStorage.getItem('phoenix-auto-sync');
        this.autoSyncEnabled = savedAutoSync === 'true';

        this.client.auth.getSession().then(async ({ data: { session } }) => {
            if (session) {
                console.log('☁️ Sesión activa detectada:', session.user.email);
                this.currentUser = session.user;
                this.useSupabase = true;

                // Smart sync
                const { data: cloudData } = await this.client.from('employees').select('id').eq('user_id', session.user.id).limit(1);
                if (cloudData?.length > 0) {
                    await this.loadFromSupabase();
                }

                this.showNotification('✅ Conectado como: ' + session.user.email, 'success');
                this.render();
            }
        });

        this.client.auth.onAuthStateChange((_event, session) => {
            if (session) {
                this.currentUser = session.user;
                this.useSupabase = true;
            } else {
                this.currentUser = null;
                this.useSupabase = false;
            }
            this.render();
        });
    }

    handleAutoSync() {
        if (this.useSupabase && this.currentUser && !this.isSyncing && this.autoSyncEnabled) {
            if (this.syncTimeout) clearTimeout(this.syncTimeout);

            this.syncTimeout = setTimeout(() => {
                console.log('⏱️ Auto-sync activado...');
                this.state.syncStatus = 'syncing';
                this.render();

                this.migrateToSupabase()
                    .then(() => {
                        this.state.syncStatus = 'synced';
                        setTimeout(() => {
                            this.state.syncStatus = 'idle';
                            this.render();
                        }, 3000);
                    })
                    .catch(() => {
                        this.state.syncStatus = 'error';
                        this.render();
                    });
            }, 3000);
        }
    }

    async disconnect() {
        if (!confirm('¿Deseas desconectar de Supabase? Tus datos seguirán en la nube, pero trabajarás en modo local.')) {
            return;
        }

        console.log('🔌 Iniciando desconexión de Supabase...');
        this.showNotification('🔄 Desconectando...', 'info');

        // 1. PRIMERO limpiar localStorage inmediatamente
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (key.startsWith('sb-') || key.includes('supabase') || key === 'phoenix-auto-sync')) {
                keysToRemove.push(key);
            }
        }

        keysToRemove.forEach(key => localStorage.removeItem(key));
        sessionStorage.clear();

        // 2. Limpiar variables de estado
        this.useSupabase = false;
        this.currentUser = null;
        this.autoSyncEnabled = false;

        // 3. Intentar signOut
        try {
            const signOutPromise = this.client.auth.signOut({ scope: 'global' });
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 3000));
            await Promise.race([signOutPromise, timeoutPromise]);
        } catch (error) {
            console.warn('⚠️ signOut falló o timeout:', error.message);
        }

        this.showNotification('✅ Desconectado correctamente. Recargando...', 'success');
        setTimeout(() => window.location.reload(), 1000);
    }

    async downloadFromCloud() {
        if (typeof window.closeModal === 'function') window.closeModal();
        this.state.syncStatus = 'syncing';
        this.render();

        try {
            await this.loadFromSupabase();
            this.saveToLocalStorage();

            this.state.lastSupabaseSync = new Date().toISOString();
            this.state.syncStatus = 'synced';
            if (typeof window.updateSyncStatus === 'function') await window.updateSyncStatus();
            this.showNotification('✅ Datos descargados', 'success');

            setTimeout(() => {
                this.state.syncStatus = 'idle';
                this.render();
            }, 3000);
        } catch (error) {
            this.state.syncStatus = 'error';
            this.showNotification('❌ Error al descargar', 'error');
        }
        this.render();
    }

    async manualSync() {
        if (!this.currentUser || this.isSyncing) {
            this.showNotification('⚠️ Ya hay una sincronización en proceso', 'warning');
            return;
        }

        this.state.syncStatus = 'syncing';
        this.render();

        try {
            await this.migrateToSupabase();
            this.state.lastSupabaseSync = new Date().toISOString();
            this.state.syncStatus = 'synced';
            if (typeof window.updateSyncStatus === 'function') await window.updateSyncStatus();
            this.showNotification('✅ Sincronizado', 'success');

            setTimeout(() => {
                this.state.syncStatus = 'idle';
                this.render();
            }, 3000);
        } catch (error) {
            this.state.syncStatus = 'error';
            this.showNotification(`❌ Error al sincronizar: ${error.message}`, 'error');
        }
        this.render();
    }

    toggleAutoSync() {
        this.autoSyncEnabled = !this.autoSyncEnabled;
        localStorage.setItem('phoenix-auto-sync', this.autoSyncEnabled ? 'true' : 'false');

        const status = this.autoSyncEnabled ? 'activada' : 'desactivada';
        const icon = this.autoSyncEnabled ? '✅' : '❌';
        this.showNotification(`${icon} Sincronización automática ${status}`, 'success');
        this.render();
    }

    async getSyncStatus() {
        if (!this.useSupabase || !this.currentUser) {
            return {
                connected: false,
                cloudEmployees: 0,
                cloudAttendance: 0,
                cloudDays: 0,
                localEmployees: this.state.employees.length,
                localAttendance: Object.keys(this.state.attendance).length,
                localDays: new Set(Object.values(this.state.attendance).map(a => a.date)).size,
                lastSync: null,
                timeAgo: 'No conectado'
            };
        }

        try {
            const { count: cloudEmployeesCount } = await this.client
                .from('employees')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', this.currentUser.id);

            const { data: cloudDates } = await this.client
                .from('attendance')
                .select('date')
                .eq('user_id', this.currentUser.id);

            const cloudAttendanceCount = cloudDates ? cloudDates.length : 0;
            const cloudDaysCount = cloudDates ? new Set(cloudDates.map(d => d.date)).size : 0;

            const lastSync = this.state.lastSupabaseSync;
            
            // Reutilizar lógica de tiempo (o importarla)
            const getTimeAgo = (date) => {
                const now = new Date();
                const diff = now - date;
                const seconds = Math.floor(diff / 1000);
                const minutes = Math.floor(seconds / 60);
                const hours = Math.floor(minutes / 60);
                const days = Math.floor(hours / 24);
                if (seconds < 60) return 'Hace un momento';
                if (minutes < 60) return `Hace ${minutes} minuto${minutes > 1 ? 's' : ''}`;
                if (hours < 24) return `Hace ${hours} hora${hours > 1 ? 's' : ''}`;
                return `Hace ${days} día${days > 1 ? 's' : ''}`;
            };

            const timeAgo = lastSync ? getTimeAgo(new Date(lastSync)) : 'Nunca';

            return {
                connected: true,
                cloudEmployees: cloudEmployeesCount || 0,
                cloudAttendance: cloudAttendanceCount || 0,
                cloudDays: cloudDaysCount || 0,
                localEmployees: this.state.employees.length,
                localAttendance: Object.keys(this.state.attendance).length,
                localDays: new Set(Object.values(this.state.attendance).map(a => a.date)).size,
                lastSync,
                timeAgo
            };
        } catch (error) {
            console.error('Error obteniendo estado de sync:', error);
            return { connected: false, error: error.message };
        }
    }

    async hasCloudData() {
        if (!this.currentUser) return false;
        try {
            const { data } = await this.client
                .from('employees')
                .select('id')
                .eq('user_id', this.currentUser.id)
                .limit(1);
            return data && data.length > 0;
        } catch (e) {
            return false;
        }
    }

    async signIn(email, password) {
        const { data, error } = await this.client.auth.signInWithPassword({
            email,
            password
        });
        if (error) throw error;
        this.currentUser = data.user;
        this.useSupabase = true;
        return data.user;
    }

    async signUp(email, password) {
        const { data, error } = await this.client.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: 'Usuario Phoenix'
                }
            }
        });
        if (error) throw error;
        this.currentUser = data.user;
        this.useSupabase = true;
        return data.user;
    }
}
