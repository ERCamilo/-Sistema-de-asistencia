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
        this.replacedIdsQueue = []; // ⚡ NUEVO: Track de IDs que deben borrarse de DB local
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

    setIndexedDBService(idb) {
        this.indexedDBService = idb;
    }

    // ============================================
    // MÉTODOS DE SINCRONIZACIÓN
    // ============================================

    async loadFromSupabase() {
        if (!this.currentUser) return;

        try {
            console.log('☁️ Sincronización inteligente (Descarga) iniciada...');

            // Mapeador genérico de merge inteligente
            const smartMerge = (localArray, remoteArray, mapFn, contextName = 'Unknown', businessKeyField = null) => {
                const resultMap = new Map();
                const businessKeyMap = new Map();
                const idMap = {};
                const replacedIds = [];

                // Normalizador de claves de negocio (strings sin espacios)
                const normalizeBK = (val) => (val !== undefined && val !== null) ? String(val).trim() : null;

                (localArray || []).forEach(item => {
                    const BK = normalizeBK(businessKeyField ? item[businessKeyField] : null);
                    const existingIdForBK = BK ? businessKeyMap.get(BK) : null;
                    
                    if (existingIdForBK) {
                        const existing = resultMap.get(existingIdForBK);
                        if (item.updatedAt > (existing.updatedAt || 0)) {
                            resultMap.delete(existingIdForBK);
                            resultMap.set(item.id, item);
                            businessKeyMap.set(BK, item.id);
                        }
                    } else {
                        resultMap.set(item.id, item);
                        if (BK) businessKeyMap.set(BK, item.id);
                    }
                });

                (remoteArray || []).forEach(remote => {
                    const remoteId = remote.id;
                    const remoteMapped = mapFn(remote);
                    const remoteTs = new Date(remote.updated_at).getTime();
                    const businessKeyValue = normalizeBK(businessKeyField ? remoteMapped[businessKeyField] : null);

                    let localId = remoteId;
                    if (businessKeyField && businessKeyValue) {
                        const idByBK = businessKeyMap.get(businessKeyValue);
                        if (idByBK && idByBK !== remoteId) {
                            console.log(`[Merge] 🔀 Detectado conflicto de BusinessKey para "${contextName}": ${businessKeyField}=${businessKeyValue}. LocalID:${idByBK}, RemotoID:${remoteId}`);
                            localId = idByBK; 
                        }
                    }

                    const local = resultMap.get(localId);
                    const localTs = local ? (local.updatedAt || 0) : 0;
                    if (local && local._isDirty) return;

                    if (!local || remoteTs > localTs + 500) {
                        if (local && localId !== remoteId) {
                            resultMap.delete(localId);
                            idMap[localId] = remoteId;
                            replacedIds.push(localId);
                        }
                        resultMap.set(remoteId, { ...remoteMapped, updatedAt: remoteTs });
                        
                        if (businessKeyField && businessKeyValue) {
                            businessKeyMap.set(businessKeyValue, remoteId);
                        }
                    }
                });
                return { merged: Array.from(resultMap.values()), idMap, replacedIds };
            };

            const cumulativeIdMap = {};

            // 1. SETTINGS
            const { data: settings } = await this.client.from('settings').select('*').eq('user_id', this.currentUser.id).maybeSingle();
            if (settings) {
                const remoteTs = new Date(settings.updated_at).getTime();
                const localTs = this.state.settings?.updatedAt || 0;
                if (!this.state.settings?._isDirty && (remoteTs > localTs)) {
                    console.log('✅ Aplicando settings más recientes de la nube');
                    this.state.settings = {
                        ...this.state.settings,
                        companyName: settings.company_name,
                        regularHoursPerDay: settings.regular_hours_per_day,
                        overtimeFactor: settings.overtime_factor,
                        holidayFactor: settings.holiday_factor,
                        defaultDeductionPercentage: settings.default_deduction_percentage,
                        globalPaymentDay: settings.global_payment_day,
                        holidays: settings.holidays || [],
                        lastPaymentDate: settings.last_payment_date,
                        nextPaymentDate: settings.next_payment_date,
                        iconSet: this.applyIconSet(this.resolveIconSet(settings.icon_set || this.state.settings.iconSet)),
                        updatedAt: remoteTs
                    };
                    this.state.calendarMarkerMode = settings.calendar_marker_mode || 'holiday';
                }
            }

            // 2. LEADERS
            const { data: remoteLeaders } = await this.client.from('leaders').select('*').eq('user_id', this.currentUser.id);
            if (remoteLeaders) {
                const { merged, idMap, replacedIds } = smartMerge(this.state.leaders || [], remoteLeaders, (l) => ({
                    id: l.id, number: l.number, name: l.name, active: l.active, phone: l.phone, email: l.email, notes: l.notes,
                    lastStatusChange: l.last_status_change, statusHistory: l.status_history || []
                }), 'Líderes', 'number');
                this.state.leaders = merged;
                Object.assign(cumulativeIdMap, idMap);
                this.replacedIdsQueue.push(...replacedIds.map(id => ({ store: 'leaders', id })));
            }

            // 3. POSITIONS
            const { data: remotePositions } = await this.client.from('positions').select('*').eq('user_id', this.currentUser.id);
            if (remotePositions) {
                const { merged, idMap, replacedIds } = smartMerge(this.state.positions || [], remotePositions, (p) => ({
                    id: p.id, name: p.name, color: p.color, hourlyRate: p.hourly_rate, baseSalary: p.base_salary,
                    workingDays: p.working_days || [1, 2, 3, 4, 5], salaryConfig: p.salary_config,
                    leaderId: cumulativeIdMap[p.leader_id] || p.leader_id, active: p.active,
                    lastStatusChange: p.last_status_change, statusHistory: p.status_history || []
                }), 'Posiciones', 'name');
                this.state.positions = merged;
                Object.assign(cumulativeIdMap, idMap);
                this.replacedIdsQueue.push(...replacedIds.map(id => ({ store: 'positions', id })));
            }

            // Aplicar mapeos intermedios a posiciones y empleados existentes
            this.state.positions?.forEach(p => { if (cumulativeIdMap[p.leaderId]) p.leaderId = cumulativeIdMap[p.leaderId]; });
            this.state.employees?.forEach(e => {
                if (e.positions) e.positions = e.positions.map(pid => cumulativeIdMap[pid] || pid);
                if (e.positionSalaries) {
                    const newSalaries = {};
                    Object.entries(e.positionSalaries).forEach(([pid, val]) => { newSalaries[cumulativeIdMap[pid] || pid] = val; });
                    e.positionSalaries = newSalaries;
                }
            });

            // 4. EMPLOYEES
            const { data: remoteEmployees } = await this.client.from('employees').select('*').eq('user_id', this.currentUser.id);
            if (remoteEmployees) {
                const { merged, idMap, replacedIds } = smartMerge(this.state.employees || [], remoteEmployees, (e) => {
                    const cleanedPositions = (e.positions || []).map(pid => cumulativeIdMap[pid] || pid);
                    const cleanedSalaries = {};
                    if (e.position_salaries) Object.entries(e.position_salaries).forEach(([pid, val]) => { cleanedSalaries[cumulativeIdMap[pid] || pid] = val; });
                    return {
                        id: e.id, key: e.id, number: e.number, name: e.name, positions: cleanedPositions,
                        positionSalaries: cleanedSalaries, customSalary: e.custom_salary, customWorkingDays: e.custom_working_days || {},
                        hireDate: e.hire_date, phone: e.phone, email: e.email, notes: e.notes, active: e.active,
                        lastPaymentDate: e.last_payment_date, lastStatusChange: e.last_status_change, statusHistory: e.status_history || [],
                        createdDate: e.created_date
                    };
                }, 'Empleados', 'number');
                this.state.employees = merged;
                Object.assign(cumulativeIdMap, idMap);
                this.replacedIdsQueue.push(...replacedIds.map(id => ({ store: 'employees', id })));
            }

            // 5. ATTENDANCE
            const { data: remoteAttendance } = await this.client.from('attendance').select('*').eq('user_id', this.currentUser.id);
            if (remoteAttendance) {
                // Pre-procesar asistencia local para corregir IDs remapeados
                const remappedLocal = {};
                Object.values(this.state.attendance || {}).forEach(att => {
                    const mappedId = cumulativeIdMap[att.employeeId] || att.employeeId;
                    const currentKey = att.key || `${att.employeeId}-${att.date}`;
                    
                    if (mappedId !== att.employeeId) {
                        // El ID cambió. Debemos borrar la key vieja de IDB para evitar ConstraintError
                        this.replacedIdsQueue.push({ store: 'attendance', id: currentKey });
                        att.employeeId = mappedId;
                        att.key = `${mappedId}-${att.date}`;
                    } else {
                        att.key = currentKey;
                    }
                    remappedLocal[att.key] = att;
                });

                const { merged } = smartMerge([], remoteAttendance, (a) => ({
                    id: a.id, employeeId: cumulativeIdMap[a.employee_id] || a.employee_id, date: a.date, status: a.status,
                    hours: a.hours, overtimeHours: a.overtime_hours, positionHours: (a.position_hours || []).map(ph => ({ ...ph, positionId: cumulativeIdMap[ph.positionId] || ph.positionId })),
                    isHoliday: a.is_holiday, isRestDay: a.is_rest_day, notes: a.notes, updatedAt: new Date(a.updated_at).getTime()
                }), 'Asistencia');

                const newAttendance = { ...remappedLocal };
                merged.forEach(att => {
                    const key = `${att.employeeId}-${att.date}`;
                    const localAtt = newAttendance[key];
                    if (!localAtt || (att.updatedAt > (localAtt.updatedAt || 0) + 500)) {
                        att.key = key;
                        newAttendance[key] = att;
                    }
                });

                // Limpieza final de referencias (por si acaso)
                Object.values(newAttendance).forEach(att => {
                    att.employeeId = cumulativeIdMap[att.employeeId] || att.employeeId;
                    if (att.positionHours) att.positionHours.forEach(ph => { ph.positionId = cumulativeIdMap[ph.positionId] || ph.positionId; });
                });
                this.state.attendance = newAttendance;
            }

            // 6. TEMP_ASSIGNMENTS
            const { data: tempAssignments } = await this.client.from('temp_assignments').select('*').eq('user_id', this.currentUser.id);
            if (tempAssignments) {
                this.state.tempAssignments = tempAssignments.map(ta => ({
                    id: ta.id, employeeId: cumulativeIdMap[ta.employee_id] || ta.employee_id,
                    positionId: cumulativeIdMap[ta.position_id] || ta.position_id,
                    startDate: ta.start_date, endDate: ta.end_date, notes: ta.notes
                }));
            }

            // ═══════════════════════════════════════════════════════════
            // 🛡️ LIMPIEZA DE IDs REEMPLAZADOS (Evitar ConstraintError en IDB)
            // ═══════════════════════════════════════════════════════════
            if (this.indexedDBService && this.replacedIdsQueue.length > 0) {
                console.log(`[SupabaseService] 🧹 Borrando ${this.replacedIdsQueue.length} IDs obsoletos de IDB...`);
                for (const item of this.replacedIdsQueue) {
                    try {
                        await this.indexedDBService.delete(item.store, item.id);
                    } catch (e) {
                        console.warn(`[SupabaseService] Error borrando ID ${item.id} de ${item.store}`, e);
                    }
                }
                this.replacedIdsQueue = []; // Vaciar cola
            }

            // 🛡️ ÚLTIMA DEFENSA: Deduplicación Final antes de render
            // ═══════════════════════════════════════════════════════════
            const finalDedup = (arr, key) => {
                if (!arr) return [];
                const map = new Map();
                const idMap = new Map(); // Para evitar duplicados de ID también
                
                arr.forEach(item => {
                    const bkVal = String(item[key] || '').trim();
                    const idVal = item.id;
                    
                    // Si ya existe por BK o por ID, comparar updatedAt
                    const existingByBK = bkVal ? map.get(bkVal) : null;
                    const existingByID = idMap.get(idVal);
                    
                    const existing = existingByBK || existingByID;
                    
                    if (!existing || (item.updatedAt || 0) > (existing.updatedAt || 0)) {
                        if (existingByBK) map.delete(bkVal);
                        if (existingByID) idMap.delete(existingByID.id);
                        
                        if (bkVal) map.set(bkVal, item);
                        idMap.set(idVal, item);
                    }
                });
                return Array.from(idMap.values());
            };

            this.state.leaders = finalDedup(this.state.leaders, 'number');
            this.state.positions = finalDedup(this.state.positions, 'name');
            this.state.employees = finalDedup(this.state.employees, 'number');

            console.log('🎉 Sincronización inteligente (Descarga) completada');
            this.isSyncing = false;
            
            // Forzar render y guardado final
            this.render();
            if (this.saveToLocalStorage) this.saveToLocalStorage();

        } catch (error) {
            console.error('❌ Error cargando datos:', error);
            if (this.showNotification) this.showNotification('⚠️ Error al cargar datos', 'error');
        }
    }

    async migrateToSupabase() {
        if (!this.currentUser || this.isSyncing) return;
        this.isSyncing = true;

        try {
            console.log('📤 Iniciando sincronización incremental a Supabase...');

            const { error: settingsError } = await this.client.from('settings').upsert({
                user_id: this.currentUser.id,
                company_name: this.state.settings.companyName,
                regular_hours_per_day: this.state.settings.regularHoursPerDay,
                overtime_factor: this.state.settings.overtimeFactor,
                holiday_factor: this.state.settings.holidayFactor,
                default_deduction_percentage: this.state.settings.defaultDeductionPercentage,
                global_payment_day: this.state.settings.globalPaymentDay,
                holidays: this.state.settings.holidays || [],
                last_payment_date: this.state.settings.lastPaymentDate,
                next_payment_date: this.state.settings.nextPaymentDate,
                calendar_marker_mode: this.state.calendarMarkerMode,
                updated_at: this.state.settings.updatedAt ? new Date(this.state.settings.updatedAt).toISOString() : new Date().toISOString()
            }, { onConflict: 'user_id' });

            if (settingsError) throw new Error(`Error en Settings: ${settingsError.message}`);
            
            // Limpiar flag sucio
            delete this.state.settings._isDirty;

            // 2. Leaders
            if (this.state.leaders?.length > 0) {
                const leadersData = this.state.leaders.map(l => ({
                    id: l.id,
                    user_id: this.currentUser.id,
                    number: l.number,
                    name: l.name,
                    active: l.active ?? true,
                    phone: l.phone,
                    email: l.email,
                    notes: l.notes,
                    last_status_change: l.lastStatusChange,
                    status_history: l.statusHistory || [],
                    updated_at: l.updatedAt ? new Date(l.updatedAt).toISOString() : new Date().toISOString()
                }));
                const { data: syncedLeaders, error: ldrError } = await this.client.from('leaders').upsert(leadersData, { onConflict: 'id' }).select();
                if (ldrError) throw new Error(`Error en Líderes: ${ldrError.message}`);
                
                // Actualizar marcas de tiempo y limpiar flag sucio
                if (syncedLeaders) {
                    syncedLeaders.forEach(sl => {
                        const localIndex = this.state.leaders.findIndex(l => l.id === sl.id || l.number === sl.number);
                        if (localIndex !== -1) {
                            const local = this.state.leaders[localIndex];
                            if (local.id !== sl.id) {
                                console.log(`[Sync] 🔀 Actualizando ID Líder: ${local.id} -> ${sl.id}`);
                                local.id = sl.id;
                            }
                            local.updatedAt = new Date(sl.updated_at).getTime();
                            delete local._isDirty;
                        }
                    });
                }
            }

            // 3. Positions
            if (this.state.positions?.length > 0) {
                const positionsData = this.state.positions.map(p => ({
                    id: p.id,
                    user_id: this.currentUser.id,
                    name: p.name,
                    color: p.color,
                    hourly_rate: p.hourlyRate || null,
                    working_days: p.workingDays || [1, 2, 3, 4, 5],
                    salary_config: p.salaryConfig,
                    base_salary: p.baseSalary || 0,
                    leader_id: p.leaderId,
                    active: p.active ?? true,
                    last_status_change: p.lastStatusChange,
                    status_history: p.statusHistory || [],
                    updated_at: p.updatedAt ? new Date(p.updatedAt).toISOString() : new Date().toISOString()
                }));
                const { data: syncedPositions, error: posError } = await this.client.from('positions').upsert(positionsData, { onConflict: 'id' }).select();
                if (posError) throw new Error(`Error en Posiciones: ${posError.message}`);

                // Actualizar marcas de tiempo y limpiar flag sucio
                if (syncedPositions) {
                    syncedPositions.forEach(sp => {
                        const localIndex = this.state.positions.findIndex(p => p.id === sp.id || p.name === sp.name);
                        if (localIndex !== -1) {
                            const local = this.state.positions[localIndex];
                            if (local.id !== sp.id) {
                                console.log(`[Sync] 🔀 Actualizando ID Posición: ${local.id} -> ${sp.id}`);
                                local.id = sp.id;
                            }
                            local.updatedAt = new Date(sp.updated_at).getTime();
                            delete local._isDirty;
                        }
                    });
                }
            }

            // 4. Employees
            if (this.state.employees?.length > 0) {
                const employeesData = this.state.employees.map(e => ({
                    id: e.id || e.key,
                    user_id: this.currentUser.id,
                    number: e.number,
                    name: e.name,
                    positions: e.positions || [],
                    position_salaries: e.positionSalaries || {},
                    custom_salary: e.customSalary,
                    custom_working_days: e.customWorkingDays || {},
                    hire_date: e.hireDate,
                    phone: e.phone,
                    email: e.email,
                    notes: e.notes,
                    active: e.active ?? true,
                    last_payment_date: e.lastPaymentDate,
                    last_status_change: e.lastStatusChange,
                    status_history: e.statusHistory || [],
                    created_date: e.createdDate || new Date().toISOString(),
                    updated_at: e.updatedAt ? new Date(e.updatedAt).toISOString() : new Date().toISOString()
                }));
                const { data: syncedEmployees, error: empError } = await this.client.from('employees').upsert(employeesData, { onConflict: 'id' }).select();
                if (empError) throw new Error(`Error en Empleados: ${empError.message}`);

                // Actualizar marcas de tiempo y limpiar flag sucio
                if (syncedEmployees) {
                    syncedEmployees.forEach(se => {
                        // Buscar por ID o por Number
                        const localIndex = this.state.employees.findIndex(e => e.id === se.id || e.number === se.number);
                        if (localIndex !== -1) {
                            const local = this.state.employees[localIndex];
                            // Si el ID cambió (merge en Supabase), actualizar el objeto
                            if (local.id !== se.id) {
                                console.log(`[Sync] 🔀 Actualizando ID local: ${local.id} -> ${se.id} (BK: ${se.number})`);
                                local.id = se.id;
                                local.key = se.id; // Mantener consistencia
                            }
                            local.updatedAt = new Date(se.updated_at).getTime();
                            delete local._isDirty;
                        }
                    });
                }
            }

            // 5. Attendance
            const attendanceMap = this.state.attendance instanceof Map ? this.state.attendance : new Map(Object.entries(this.state.attendance || {}));
            if (attendanceMap.size > 0) {
                const attendanceData = [];
                const attPosData = [];

                attendanceMap.forEach((record, key) => {
                    const empId = record.employeeId || key.split('-').slice(0, -3).join('-');
                    const date = record.date || key.split('-').slice(-3).join('-');
                    const attId = record.id || this.generateUUID();
                    if (!record.id) record.id = attId; // Persistir ID localmente

                    attendanceData.push({
                        id: attId,
                        user_id: this.currentUser.id,
                        employee_id: empId,
                        date: date,
                        present: record.present,
                        hours_worked: record.hoursWorked || record.hours || 0,
                        overtime_hours: record.overtimeHours || 0,
                        is_holiday: record.isHoliday || false,
                        position_id: record.selectedPosition,
                        notes: record.notes,
                        multi_position: record.multiPosition || false,
                        updated_at: record.updatedAt ? new Date(record.updatedAt).toISOString() : new Date().toISOString()
                    });

                    if (record.positionHours?.length > 0) {
                        record.positionHours.forEach(ph => {
                            attPosData.push({
                                attendance_id: attId,
                                position_id: ph.positionId,
                                hours: ph.hours || 0,
                                overtime_hours: ph.overtimeHours || 0
                            });
                        });
                    }
                });

                // Upsert Attendance (incremental)
                for (let i = 0; i < attendanceData.length; i += 100) {
                    const chunk = attendanceData.slice(i, i + 100);
                    const { data: syncedAtt, error: attErr } = await this.client.from('attendance').upsert(chunk, { onConflict: 'id' }).select();
                    
                    if (attErr) {
                        console.error('⚠️ Error upserting attendance:', attErr);
                    } else if (syncedAtt) {
                        // Limpiar flags sucios localmente
                        syncedAtt.forEach(sa => {
                            const key = `${sa.employee_id}-${sa.date}`;
                            const local = this.state.attendance[key];
                            if (local) {
                                local.updatedAt = new Date(sa.updated_at).getTime();
                                delete local._isDirty;
                            }
                        });
                    }
                }

                // Para attendance_positions, dado que no hay una natural key única obvia aparte del ID autogenerado,
                // seguiremos el patrón de limpiar y re-insertar SOLO para los registros que estamos subiendo,
                // pero por simplicidad en esta fase, usaremos upsert si logramos identificar el ID del detalle.
                // Por ahora, solo subimos el lote.
                if (attPosData.length > 0) {
                    for (let i = 0; i < attPosData.length; i += 100) {
                        await this.client.from('attendance_positions').upsert(attPosData.slice(i, i + 100), { onConflict: 'attendance_id,position_id' });
                    }
                }
            }

            console.log('🎉 Sincronización exitosa');

            // 6. Reconciliation (Cleanup deleted items)
            // Solo si el usuario lo desea o como comportamiento por defecto en Smart Sync
            await this.reconcileDeletions();
        } catch (error) {
            console.error('❌ Error en sincronización:', error);
            
            // Detectar conflicto de Primary Key (Account mismatch)
            if (error.message.includes('duplicate key') || error.message.includes('pkey')) {
                const confirmClone = confirm(
                    '⚠️ CONFLICTO DE CUENTA DETECTADO\n\n' +
                    'Los datos locales parecen pertenecer a otra cuenta de Supabase. ' +
                    'Para subirlos a esta cuenta nueva, es necesario regenerar sus IDs (Clonado).\n\n' +
                    '¿Deseas clonar los datos actuales a esta cuenta nueva?\n' +
                    '(Esto no afectará los datos en la cuenta original)'
                );

                if (confirmClone && typeof window.prepareDataForNewAccount === 'function') {
                    try {
                        await window.prepareDataForNewAccount();
                        this.showNotification('🔄 IDs regenerados. Reintentando sincronización...', 'info');
                        // Reintentar una sola vez
                        return await this.migrateToSupabase();
                    } catch (cloneError) {
                        console.error('Error durante el clonado:', cloneError);
                    }
                }
            }
            throw error;
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

    handleAutoSync() {
        if (!this.autoSyncEnabled || !this.currentUser || this.isSyncing) return;

        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }

        this.syncTimeout = setTimeout(() => {
            if (!this.isSyncing) {
                console.log('🔄 Sincronización automática iniciada...');
                this.migrateToSupabase().catch(err => {
                    console.error('❌ Error en auto-sync:', err);
                });
            }
        }, 5000); // Debounce de 5 segundos
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

    async reconcileDeletions() {
        if (!this.currentUser) return;
        
        console.log('🧹 Reconciliando eliminaciones...');
        
        try {
            // Eliminar Líderes no presentes localmente
            const localLeaderIds = this.state.leaders.map(l => l.id);
            const { data: cloudLeaders } = await this.client.from('leaders').select('id').eq('user_id', this.currentUser.id);
            const leadersToDelete = cloudLeaders?.filter(cl => !localLeaderIds.includes(cl.id)).map(cl => cl.id) || [];
            if (leadersToDelete.length > 0) {
                await this.client.from('leaders').delete().in('id', leadersToDelete);
                console.log(`🗑️ ${leadersToDelete.length} líderes eliminados de la nube`);
            }

            // Eliminar Posiciones no presentes localmente
            const localPositionIds = this.state.positions.map(p => p.id);
            const { data: cloudPositions } = await this.client.from('positions').select('id').eq('user_id', this.currentUser.id);
            const positionsToDelete = cloudPositions?.filter(cp => !localPositionIds.includes(cp.id)).map(cp => cp.id) || [];
            if (positionsToDelete.length > 0) {
                await this.client.from('positions').delete().in('id', positionsToDelete);
                console.log(`🗑️ ${positionsToDelete.length} posiciones eliminadas de la nube`);
            }

            // Eliminar Empleados no presentes localmente
            const localEmployeeIds = this.state.employees.map(e => e.id || e.key);
            const { data: cloudEmployees } = await this.client.from('employees').select('id').eq('user_id', this.currentUser.id);
            const employeesToDelete = cloudEmployees?.filter(ce => !localEmployeeIds.includes(ce.id)).map(ce => ce.id) || [];
            if (employeesToDelete.length > 0) {
                await this.client.from('employees').delete().in('id', employeesToDelete);
                console.log(`🗑️ ${employeesToDelete.length} empleados eliminados de la nube`);
            }

            // Eliminar Asistencia no presente localmente
            const attendanceMap = this.state.attendance instanceof Map ? this.state.attendance : new Map(Object.entries(this.state.attendance || {}));
            const localAttendanceIds = Array.from(attendanceMap.values()).map(r => r.id).filter(id => !!id);
            const { data: cloudAttendance } = await this.client.from('attendance').select('id').eq('user_id', this.currentUser.id);
            const attendanceToDelete = cloudAttendance?.filter(ca => !localAttendanceIds.includes(ca.id)).map(ca => ca.id) || [];
            if (attendanceToDelete.length > 0) {
                for (let i = 0; i < attendanceToDelete.length; i += 100) {
                    await this.client.from('attendance').delete().in('id', attendanceToDelete.slice(i, i + 100));
                }
                console.log(`🗑️ ${attendanceToDelete.length} registros de asistencia eliminados de la nube`);
            }
        } catch (error) {
            console.error('⚠️ Error reconciliando eliminaciones:', error);
        }
    }

    /**
     * 🛰️ Forzar descarga completa desde la Nube
     * Reemplaza todos los datos locales con la versión de Supabase.
     */
    async forceDownloadContents() {
        if (!this.currentUser) throw new Error("Debes estar autenticado");
        if (!this.indexedDBService) throw new Error("Servicio de base de datos no inicializado");
        
        console.log('🛰️ Forzando descarga completa...');
        
        // 1. Limpiar todos los almacenes de IndexedDB
        const stores = ['employees', 'positions', 'attendance', 'leaders', 'settings'];
        for (const store of stores) {
            await this.indexedDBService.clear(store);
        }
        
        // 2. Resetear estado local (manteniendo auth/settings críticos)
        this.state.employees = [];
        this.state.positions = [];
        this.state.attendance = {};
        this.state.leaders = [];
        
        // 3. Re-sincronizar (esto descargará todo de nuevo)
        await this.loadFromSupabase();
    }

    /**
     * 🛰️ Forzar subida completa a la Nube
     * Tus datos locales se volverán la fuente de verdad.
     */
    async forceUploadContents() {
        if (!this.currentUser) throw new Error("Debes estar autenticado");
        
        console.log('🛰️ Forzando subida completa...');
        
        // Ejecutar migración masiva (que ya usa upsert)
        await this.migrateToSupabase();
    }

    /**
     * 🛰️ Reintentar Merge con limpieza profunda
     */
    async retryMerge() {
        console.log('🛰️ Reintentando combinación profunda...');
        // Limpiar cola de IDs por si acaso
        this.replacedIdsQueue = [];
        
        // Ejecutar carga inteligente de nuevo
        await this.loadFromSupabase();
    }
}
