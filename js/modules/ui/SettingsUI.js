import { DateUtils } from '../utils/DateUtils.js';

let context = {};


export function initSettingsUI(dependencies) {
    context = dependencies;
}

function getState() { return context.state; }
function getIcons() { return context.icons; }

// ============================================
// SETTINGS TAB (entry point)
// ============================================

export function SettingsTab() {
    const state = getState();
    const icons = getIcons();
    return `
                <div style="max-width: 900px; margin: 0 auto;">
                    <div style="margin-bottom: 24px;">
                        <h2 style="margin: 0 0 8px 0; font-size: 1.75rem; display: flex; align-items: center; gap: 12px;">
                            <span>⚙️</span>
                            <span class="gradient-text">Configuración del Sistema</span>
                        </h2>
                        <p style="margin: 0; color: #94a3b8; font-size: 0.875rem;">
                            Personaliza la configuración de tu sistema de asistencia
                        </p>
                    </div>
                    
                    <!-- ✨ Dashboard de Resumen -->
                    ${SettingsDashboard()}
                    
                    <!-- Navegación de Pestañas -->
                    <div class="nav-tabs" style="margin-bottom: 32px;">

                        <button class="nav-tab ${state.settingsActiveTab === 'data' ? 'active' : ''}" 
                                onclick="changeSettingsTab('data')">
                            <span>${icons.get('save')}</span><span class="tab-text"> Datos</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'general' ? 'active' : ''}" 
                                onclick="changeSettingsTab('general')">
                            <span>${icons.get('settings')}</span><span class="tab-text"> General</span>
                        </button>

                        <button class="nav-tab ${state.settingsActiveTab === 'calendar' ? 'active' : ''}" 
                                onclick="changeSettingsTab('calendar')">
                            <span>${icons.get('calendar')}</span><span class="tab-text"> Calendario</span>
                        </button>
                    </div>
                    
                    <!-- Contenido de las Pestañas -->
                    ${state.settingsActiveTab === 'general' ? SettingsTabGeneral() : ''}
                    ${state.settingsActiveTab === 'data' ? SettingsTabData() : ''}
                    ${state.settingsActiveTab === 'calendar' ? SettingsTabCalendar() : ''}
                    
                    <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
                        <button onclick="saveSettings()" class="btn btn-primary" style="padding: 12px 32px; font-size: 1rem;">
                            💾 Guardar Configuración
                        </button>
                    </div>
                </div>
            `;
}

// ============================================
// DASHBOARD DE CONFIGURACIÓN
// ============================================

function SettingsDashboard() {
    const state = getState();
    const storage = context.calculateStorageStats();
    const syncStatus = state.supabaseSyncStatus || {
        connected: false,
        localEmployees: state.employees.length,
        localAttendance: Object.keys(state.attendance).length,
        localDays: new Set(Object.values(state.attendance).map(a => a.date)).size
    };

    const freeSpace = Math.round(100 - storage.percentage);
    const syncIcon = syncStatus.connected ? '✅' : '⚪';
    const syncText = syncStatus.connected ? 'Online' : 'Offline';
    const syncColor = syncStatus.connected ? '#10b981' : '#94a3b8';

    return `
                <details style="background: linear-gradient(135deg, #1e293b, #0f172a); border-radius: 12px; margin-bottom: 24px; border: 1px solid #334155; overflow: hidden;">
                    <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; list-style: none; user-select: none;">
                        <h3 style="margin: 0; color: #06b6d4; font-size: 1rem; display: flex; align-items: center; gap: 6px;">
                            <span>📊</span>
                            <span>Resumen del Sistema</span>
                        </h3>
                        
                        <div style="display: flex; align-items: center; gap: 12px; font-size: 0.8rem;">
                            <!-- Resumen Storage -->
                            <div style="display: flex; align-items: center; gap: 4px; color: ${freeSpace < 20 ? '#ef4444' : '#94a3b8'};">
                                <span>💾</span>
                                <span>${freeSpace}% libre</span>
                            </div>
                            
                            <!-- Resumen Sync -->
                            <div style="display: flex; align-items: center; gap: 4px; color: ${syncColor};">
                                <span>${syncIcon}</span>
                                <span style="display: none; @media (min-width: 400px) { display: inline; }">${syncText}</span>
                            </div>
                            
                            <span style="color: #64748b; font-size: 0.8rem;">▼</span>
                        </div>
                    </summary>
                    
                    <div style="padding: 0 16px 16px 16px;">
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; border-top: 1px solid #334155; padding-top: 16px;">
                            ${StorageCard(storage)}
                            ${SyncCard(syncStatus)}
                            ${DataSummaryCard()}
                        </div>
                    </div>
                </details>
            `;
}

function StorageCard(stats) {
    const color = stats.percentage > 80 ? '#ef4444' :
        stats.percentage > 60 ? '#f59e0b' : '#10b981';

    return `
                <div style="background: #0f172a; border-radius: 8px; padding: 12px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <span style="font-size: 1rem;">💾</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.8rem;">Almacenamiento</span>
                    </div>
                    
                    <div style="font-size: 1.25rem; font-weight: 700; color: ${color}; margin-bottom: 2px; line-height: 1;">
                        ${stats.usedMB} <span style="font-size: 0.75rem; color: #64748b; font-weight: 400;">MB</span>
                    </div>
                    
                    <!-- Barra de progreso mini -->
                    <div style="background: #1e293b; height: 4px; border-radius: 2px; overflow: hidden; margin: 6px 0;">
                        <div style="background: ${color}; height: 100%; width: ${stats.percentage}%; transition: width 0.3s;"></div>
                    </div>
                    
                    <div style="display: flex; justify-content: space-between; font-size: 0.7rem; color: #94a3b8;">
                        <span>${stats.percentage}% uso</span>
                        <span>${stats.available} libre</span>
                    </div>
                </div>
            `;
}

export function SyncCard(status) {
    const currentUser = window.currentUser;
    const isConnected = !!currentUser;
    const statusColor = isConnected ? '#10b981' : '#64748b';
    const statusIcon = isConnected ? '✅' : '⚪';
    const statusText = isConnected ? 'Conectado' : 'Sin conexión';

    return `
                <div style="background: #0f172a; border-radius: 12px; padding: 16px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
                        <span style="font-size: 1.5rem;">☁️</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.95rem;">Sincronización (Firebase)</span>
                    </div>
                    
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                        <span style="font-size: 1.5rem;">${statusIcon}</span>
                        <span style="font-size: 1.25rem; font-weight: 700; color: ${statusColor};">
                            ${statusText}
                        </span>
                    </div>
                    
                    ${isConnected ? `
                        <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                            ${currentUser.email}
                        </div>
                    ` : `
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            Usa tu cuenta de Google para respaldar tus datos.
                        </div>
                    `}
                </div>
            `;
}

function DataSummaryCard() {
    const state = getState();
    const activeEmployees = state.employees.filter(e => e.active).length;
    const totalEmployees = state.employees.length;
    const activePositions = state.positions.filter(p => p.active).length;

    return `
                <div style="background: #0f172a; border-radius: 8px; padding: 12px; border: 1px solid #334155;">
                    <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
                        <span style="font-size: 1rem;">👥</span>
                        <span style="font-weight: 600; color: #f1f5f9; font-size: 0.8rem;">Datos Generales</span>
                    </div>
                    
                    <div style="display: flex; align-items: baseline; gap: 6px; margin-bottom: 8px;">
                        <div style="font-size: 1.25rem; font-weight: 700; color: #06b6d4;">
                            ${totalEmployees}
                        </div>
                        <div style="font-size: 0.7rem; color: #64748b;">
                            empleados (${activeEmployees} activos)
                        </div>
                    </div>
                    
                    <div style="background: #1e293b; padding: 6px; border-radius: 4px; margin-top: auto;">
                        <div style="display: flex; justify-content: space-between; font-size: 0.7rem;">
                            <span style="color: #94a3b8;">Posiciones:</span>
                            <span style="color: #10b981; font-weight: 600;">${activePositions}</span>
                        </div>
                    </div>
                </div>
            `;
}

// ============================================
// PESTAÑA: GENERAL
// ============================================
function SettingsTabGeneral() {
    return `
                ${SettingsForm()}
            `;
}

// ============================================
// PESTAÑA: DATOS
// ============================================
function SettingsTabData() {
    const state = getState();
    const currentUser = context.currentUser;

    return `
                    <!-- Sincronización con Firebase (Google) -->
                    <div style="background: linear-gradient(135deg, rgba(66, 133, 244, 0.1), rgba(52, 168, 83, 0.1)); border-radius: 12px; padding: 24px; margin-top: 20px; border: 2px solid ${currentUser ? '#4285F4' : '#334155'};">
                        <h2 style="margin: 0 0 12px 0; font-size: 1.25rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                            <span>☁️</span> Sincronización en la Nube
                        </h2>
                        
                        ${!currentUser ? `
                            <div style="color: #94a3b8; margin-bottom: 20px; line-height: 1.6;">
                                Conecta tu cuenta de Google para respaldar tus datos y acceder desde cualquier dispositivo.
                            </div>
                            
                            <button onclick="loginWithGoogle()" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px; background: white; color: #374151; font-weight: 600; border: 1px solid #d1d5db; transition: all 0.2s;">
                                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="20" height="20">
                                Continuar con Google
                            </button>
                        ` : `
                            <div style="background: rgba(16, 185, 129, 0.1); padding: 16px; border-radius: 10px; margin-bottom: 20px; border: 1px solid #10b981; display: flex; align-items: center; gap: 12px;">
                                <img src="${currentUser.photoURL || ''}" style="width: 40px; height: 40px; border-radius: 50%; background: #334155;" onerror="this.src='https://ui-avatars.com/api/?name=${currentUser.displayName}'">
                                <div style="flex: 1;">
                                    <div style="color: #f1f5f9; font-weight: 600; font-size: 0.95rem;">${currentUser.displayName || 'Usuario'}</div>
                                    <div style="color: #94a3b8; font-size: 0.8rem;">${currentUser.email}</div>
                                </div>
                                <div style="color: #10b981; font-size: 0.75rem; font-weight: 700;">CONECTADO</div>
                            </div>

                            <!-- Controles de Fase 2 y 3 -->
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
                                <button onclick="syncFirebaseNow()" class="btn-secondary" style="background: rgba(66, 133, 244, 0.1); color: #4285F4; border: 1px solid rgba(66, 133, 244, 0.2); padding: 12px; font-size: 0.85rem;">
                                   🔄 Sincronizar Todo
                                </button>
                                <button onclick="syncHistoryNow()" class="btn-secondary" style="background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); padding: 12px; font-size: 0.85rem;">
                                   📅 Sinc. Historial
                                </button>
                                <button onclick="createFirebaseSnapshot()" class="btn-secondary" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; font-size: 0.85rem; grid-column: span 2;">
                                   📸 Crear Snapshot (Backup Completo)
                                </button>
                            </div>

                            <div class="form-group" style="margin-bottom: 20px;">
                                <label class="form-label" style="font-size: 0.85rem; color: #94a3b8;">Frecuencia de Backup Automático</label>
                                <select id="backupFrequency" onchange="updateBackupFrequency(this.value)" class="form-input" style="background: #0f172a; border-color: #334155;">
                                    <option value="none" ${state.settings.backupFrequency === 'none' ? 'selected' : ''}>Desactivado</option>
                                    <option value="daily" ${state.settings.backupFrequency === 'daily' ? 'selected' : ''}>Diario</option>
                                    <option value="weekly" ${state.settings.backupFrequency === 'weekly' ? 'selected' : ''}>Semanal</option>
                                    <option value="monthly" ${state.settings.backupFrequency === 'monthly' ? 'selected' : ''}>Mensual</option>
                                </select>
                            </div>
                            
                            <button onclick="logoutFirebase()" style="width: 100%; padding: 10px; background: none; border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; border-radius: 8px; font-size: 0.8rem; cursor: pointer;">
                                Cerrar Sesión
                            </button>
                        `}
                    </div>

                    <!-- Fase 4: Historial de Snapshots -->
                    ${currentUser ? SnapshotHistory() : ''}
                    
                    <!-- Gestión de Datos -->
                    <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid #334155;">
                        <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                            💾 Gestión de Datos
                        </h3>
                        
                        <!-- Sistema de Almacenamiento -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.25rem;">💾</span>
                                <span>Tipo de Almacenamiento</span>
                            </div>
                            
                            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                                <label style="flex: 1; cursor: pointer;">
                                    <input type="radio" 
                                           name="storageTypeData" 
                                           value="localStorage" 
                                           ${!state.useIndexedDB ? 'checked' : ''}
                                           onchange="handleStorageTypeChange(this.value)"
                                           style="display: none;">
                                    <div style="padding: 10px; background: ${!state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${!state.useIndexedDB ? '#0891b2' : '#334155'}; transition: all 0.2s;">
                                        <div style="font-weight: 600; font-size: 0.9rem; color: ${!state.useIndexedDB ? 'white' : '#94a3b8'};">📦 Local</div>
                                        <div style="font-size: 0.7rem; color: ${!state.useIndexedDB ? '#e0f2fe' : '#64748b'};">Max 5MB</div>
                                    </div>
                                </label>
                                
                                <label style="flex: 1; cursor: pointer;">
                                    <input type="radio" 
                                           name="storageTypeData" 
                                           value="indexedDB" 
                                           ${state.useIndexedDB ? 'checked' : ''}
                                           onchange="handleStorageTypeChange(this.value)"
                                           style="display: none;">
                                    <div style="padding: 10px; background: ${state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${state.useIndexedDB ? '#0891b2' : '#334155'}; transition: all 0.2s;">
                                        <div style="font-weight: 600; font-size: 0.9rem; color: ${state.useIndexedDB ? 'white' : '#94a3b8'};">🗄️ IndexedDB</div>
                                        <div style="font-size: 0.7rem; color: ${state.useIndexedDB ? '#e0f2fe' : '#64748b'};">Ilimitado</div>
                                    </div>
                                </label>
                            </div>
                            
                            ${state.useIndexedDB ? `
                                <div style="background: #1e293b; padding: 8px; border-radius: 6px; border: 1px solid #334155;">
                                    <div style="font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">
                                        📊 Estadísticas:
                                    </div>
                                    <div id="indexeddb-stats" style="font-size: 0.7rem; color: #64748b;">
                                        Cargando...
                                    </div>
                                </div>
                            ` : ''}
                        </div>

                        <!-- Exportar Backup -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">📥</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">Exportar Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Descarga todos tus datos en formato JSON para hacer un respaldo de seguridad.
                                    </div>
                                </div>
                            </div>
                            <button onclick="exportData()" class="btn btn-secondary" style="width: 100%;">
                                📥 Exportar Backup
                            </button>
                        </div>
                        
                        <!-- Importar Backup -->
                        <div style="background: #0f172a; border-radius: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid #334155;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">📤</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #f1f5f9; margin-bottom: 4px;">Importar Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Carga un archivo de respaldo previamente exportado.
                                    </div>
                                    <div style="font-size: 0.75rem; color: #f59e0b; margin-top: 8px; display: flex; align-items: center; gap: 4px;">
                                        <span>⚠️</span>
                                        <span>Esto reemplazará todos tus datos actuales</span>
                                    </div>
                                </div>
                            </div>
                            <input type="file" id="import-file-input" accept=".json" style="display: none;" onchange="importData(event)">
                            <button onclick="document.getElementById('import-file-input').click()" class="btn btn-secondary" style="width: 100%;">
                                📤 Importar Backup
                            </button>
                        </div>
                        
                        <!-- Eliminar Todos los Datos -->
                        <div style="background: linear-gradient(135deg, rgba(239, 68, 68, 0.1), rgba(220, 38, 38, 0.05)); border-radius: 12px; padding: 16px; border: 2px solid #dc2626;">
                            <div style="display: flex; align-items: start; gap: 12px; margin-bottom: 12px;">
                                <div style="font-size: 1.5rem;">🗑️</div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; color: #ef4444; margin-bottom: 4px;">Eliminar Todos los Datos</div>
                                    <div style="font-size: 0.875rem; color: #94a3b8; line-height: 1.6;">
                                        Elimina permanentemente toda la información del sistema. Esta acción no se puede deshacer.
                                    </div>
                                    <div style="font-size: 0.75rem; color: #ef4444; margin-top: 8px; font-weight: 600;">
                                        ⚠️ ADVERTENCIA: Se eliminarán empleados, posiciones, asistencia y configuración.
                                    </div>
                                </div>
                            </div>
                            <button onclick="deleteAllData()" style="width: 100%; padding: 12px 24px; border-radius: 10px; background: linear-gradient(135deg, #dc2626, #b91c1c); border: none; color: white; font-weight: 700; cursor: pointer; transition: all 0.2s; font-size: 0.875rem;" onmouseover="this.style.transform='scale(1.02)'; this.style.boxShadow='0 8px 20px rgba(220, 38, 38, 0.4)'" onmouseout="this.style.transform='scale(1)'; this.style.boxShadow='none'">
                                🗑️ Eliminar Todo
                            </button>
                        </div>
                        </div>
                    </div>
            `;
}

// ============================================
// PESTAÑA: CALENDARIO  
// ============================================
function SettingsTabCalendar() {
    const state = getState();
    return `
                <!-- Fecha de Pago Global -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💰 Fecha de Pago Global
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Día del mes para pagos periódicos</label>
                        <input type="number" 
                               id="globalPaymentDay" 
                               value="${state.settings.globalPaymentDay || ''}" 
                               class="form-input"
                               min="1" max="31"
                               placeholder="Ej: 15 (día 15 de cada mes)"
                               onchange="updateGlobalPaymentDay(this.value)">
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Este día aparecerá marcado con 💰 en el calendario flotante de cada empleado.
                            Útil para identificar visualmente cuándo se realizan los pagos mensuales.
                        </div>
                    </div>
                </div>
                
                <!-- Días Festivos -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ☀️ Días Festivos del Año
                    </h3>
                    <div style="font-size: 0.875rem; color: #94a3b8; margin-bottom: 16px;">
                        Click en un día para marcarlo/desmarcarlo como festivo. Los días festivos tendrán pago especial según el factor configurado.
                    </div>
                    ${SettingsHolidayCalendar()}
                    <div style="margin-top: 12px; font-size: 0.75rem; color: #64748b;">
                        📅 Total de días festivos configurados: <strong style="color: #f59e0b;">${state.settings.holidays.length}</strong>
                    </div>
                </div>
            `;
}

function SettingsForm() {
    const state = getState();
    const icons = getIcons();
    const iconSetOptions = icons.getAvailableSets()
        .map(set => `<option value="${set}" ${state.settings.iconSet === set ? 'selected' : ''}>${set}</option>`)
        .join('');

    return `
                <!-- Información de la Empresa -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        🏢 Información de la Empresa
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Nombre de la Empresa</label>
                        <input type="text" 
                               id="companyName" 
                               value="${state.settings.companyName}" 
                               class="form-input"
                               placeholder="Ej: Constructora El Progreso">
                    </div>
                </div>

                <!-- Interfaz -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        🖥️ Interfaz de Navegación
                    </h3>
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="legacyNavigation" ${state.settings.legacyNavigation ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: #06b6d4; cursor: pointer;">
                            <span style="font-weight: 600; font-size: 1rem; color: #f1f5f9;">Usar Menú Superior Clásico</span>
                        </label>
                        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 8px; margin-left: 32px; line-height: 1.5;">
                            Si se activa, el menú se mostrará como pestañas en la parte superior en lugar de la barra flotante inferior.
                        </div>
                    </div>
                </div>

                <!-- Iconos -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ${icons.get('palette')} Iconos
                    </h3>
                    <div class="form-group">
                        <label class="form-label">Estilo de iconos</label>
                        <select id="iconSet" class="form-input" onchange="previewIconSet(this.value)">
                            ${iconSetOptions}
                        </select>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px; line-height: 1.6;">
                            Se aplica a toda la aplicación y queda guardado como preferencia.
                        </div>
                    </div>
                </div>
                
                <!-- Instalación como App (PWA) -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        📱 Instalar como Aplicación
                    </h3>
                    
                    <div style="background: #0f172a; padding: 16px; border-radius: 8px; border: 1px solid #334155; margin-bottom: 16px;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="font-size: 2.5rem;">📲</div>
                            <div>
                                <div style="font-weight: 600; font-size: 1rem; margin-bottom: 4px;">
                                    Instala esta app en tu dispositivo
                                </div>
                                <div style="font-size: 0.875rem; color: #94a3b8;">
                                    Acceso rápido sin abrir el navegador
                                </div>
                            </div>
                        </div>
                        
                        <div style="font-size: 0.75rem; color: #64748b; line-height: 1.6; margin-bottom: 16px;">
                            <strong style="color: #10b981;">Ventajas de instalar:</strong><br>
                            ✅ Icono en tu pantalla de inicio<br>
                            ✅ Funciona como app nativa<br>
                            ✅ Sin barra del navegador<br>
                            ✅ Más rápido de abrir<br>
                            ✅ Funciona offline (si activaste IndexedDB)
                        </div>
                        
                        <div id="install-pwa-status"></div>
                        
                        <button id="install-pwa-button" 
                                onclick="handleInstallPWA()" 
                                class="btn btn-primary" 
                                style="width: 100%; padding: 12px; font-size: 1rem; background: linear-gradient(135deg, #10b981, #059669); border: none;">
                            📱 Instalar Aplicación
                        </button>
                    </div>
                    
                    <details style="margin-top: 12px;">
                        <summary style="cursor: pointer; color: #94a3b8; font-size: 0.875rem; padding: 8px; background: #0f172a; border-radius: 6px;">
                            ℹ️ ¿Cómo instalar manualmente?
                        </summary>
                        <div style="margin-top: 12px; padding: 12px; background: #0f172a; border-radius: 6px; font-size: 0.75rem; color: #64748b; line-height: 1.8;">
                            <strong style="color: #06b6d4;">En Android (Chrome/Edge):</strong><br>
                            1. Menú (⋮) → "Agregar a pantalla de inicio"<br>
                            2. Confirmar instalación<br>
                            <br>
                            <strong style="color: #06b6d4;">En iPhone/iPad (Safari):</strong><br>
                            1. Botón "Compartir" (▢↑)<br>
                            2. "Agregar a pantalla de inicio"<br>
                            3. Confirmar<br>
                            <br>
                            <strong style="color: #06b6d4;">En PC (Chrome/Edge):</strong><br>
                            1. Icono de instalación en la barra de direcciones<br>
                            2. Click en "Instalar"
                        </div>
                    </details>
                </div>
                
                <!-- Jornada Laboral -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        ⏰ Jornada Laboral
                    </h3>
                    
                    <!-- Horas Regulares -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Horas Regulares por Día</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Define cuántas horas se consideran como jornada normal">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="regularHoursPerDay" 
                                   value="${state.settings.regularHoursPerDay}" 
                                   min="1" 
                                   max="24" 
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">horas</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Las horas trabajadas por encima de este valor se considerarán extras
                        </div>
                    </div>
                    
                    <!-- Factor Horas Extras -->
                    <div class="form-group" style="margin-bottom: 20px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Factor de Horas Extras</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Multiplicador para calcular el pago de horas extras">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="overtimeFactor" 
                                   value="${state.settings.overtimeFactor || 1.5}" 
                                   min="1" 
                                   max="5" 
                                   step="0.1"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">× (multiplicador)</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Ejemplo: Factor 1.5 = tiempo y medio, Factor 2 = doble pago
                        </div>
                    </div>
                    
                    <!-- Factor Festivos -->
                    <div class="form-group">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            <span>Factor de Días Festivos</span>
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Multiplicador para calcular el pago en días festivos">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="holidayFactor" 
                                   value="${state.settings.holidayFactor}" 
                                   min="1" 
                                   max="5" 
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">× (multiplicador)</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Ejemplo: Factor 2 = doble pago, Factor 1.5 = pago y medio
                        </div>
                    </div>
                </div>
                
                <!-- Configuración de Nómina -->
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        💰 Configuración de Nómina
                    </h3>
                    
                    <!-- Porcentaje de deducción por defecto -->
                    <div class="form-group" style="margin-bottom: 16px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            💸 Porcentaje de Deducción por Defecto
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Este porcentaje se aplicará automáticamente al agregar deducciones">ⓘ</span>
                        </label>
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <input type="number" 
                                   id="defaultDeductionPercentage" 
                                   value="${state.settings.defaultDeductionPercentage || 2}" 
                                   min="0" 
                                   max="100"
                                   step="0.5"
                                   class="form-input"
                                   style="flex: 1;">
                            <span style="color: #94a3b8; font-size: 0.875rem;">%</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Todas las nuevas deducciones usarán este porcentaje por defecto. Se puede cambiar individualmente en cada nómina.
                        </div>
                    </div>
                    
                    <!-- Último día de pago global -->
                    <div class="form-group" style="margin-top: 16px;">
                        <label class="form-label" style="display: flex; align-items: center; gap: 8px;">
                            📅 Último Día de Pago (Global)
                            <span style="background: #334155; color: #94a3b8; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; cursor: help;" 
                                  title="Configura el último día en que se pagó nómina a todos los empleados">ⓘ</span>
                        </label>
                        <input type="date" 
                               id="globalLastPaymentDate" 
                               value="${state.settings.globalLastPaymentDate || ''}" 
                               class="form-input">
                        <div style="font-size: 0.75rem; color: #64748b; margin-top: 8px;">
                            💡 Esta fecha se usará en el preset "Desde Último Pago" para todos los empleados que no tengan una fecha individual configurada.
                        </div>
                    </div>
                </div>
            `;
}

function SettingsHolidayCalendar() {
    return context.holidayService.renderSettingsCalendar();
}

// ============================================
// COMPONENTE: HISTORIAL DE SNAPSHOTS (Fase 4)
// ============================================
function SnapshotHistory() {
    const state = getState();
    const snapshots = state.snapshots || [];
    const isLoading = state.isLoadingSnapshots;

    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px; border: 1px solid #334155;">
            <h3 style="margin: 0 0 16px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                <span>🕒</span> Historial de Versiones (Snapshots)
            </h3>
            
            ${isLoading ? `
                <div style="padding: 20px; text-align: center; color: #94a3b8;">
                    <div class="spinner" style="margin: 0 auto 10px;"></div>
                    Cargando versiones desde la nube...
                </div>
            ` : snapshots.length === 0 ? `
                <div style="padding: 20px; text-align: center; color: #64748b; font-style: italic;">
                    No hay snapshots disponibles en esta cuenta.
                </div>
            ` : `
                <div style="display: flex; flex-direction: column; gap: 8px;">
                    ${snapshots.map(snap => `
                        <div style="background: #0f172a; padding: 12px; border-radius: 8px; border: 1px solid #334155; display: flex; align-items: center; justify-content: space-between;">
                            <div style="flex: 1;">
                                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                    <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: ${snap.type === 'auto' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(6, 182, 212, 0.1)'}; color: ${snap.type === 'auto' ? '#10b981' : '#06b6d4'}; border: 1px solid currentColor;">
                                        ${snap.type === 'auto' ? 'AUTO' : 'MANUAL'}
                                    </span>
                                    <span style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">
                                        ${DateUtils.formatDateTime(snap.createdAt)}
                                    </span>

                                </div>
                                <div style="color: #94a3b8; font-size: 0.75rem;">
                                    👥 ${snap.employeeCount} empleados | 📝 ${snap.attendanceCount} registros
                                </div>
                            </div>
                            <button onclick="restoreSnapshot('${snap.id}')" 
                                    style="padding: 8px 16px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">
                                ⏪ Restaurar
                            </button>
                        </div>
                    `).join('')}
                </div>
            `}
            
            <p style="margin: 16px 0 0 0; font-size: 0.7rem; color: #64748b; line-height: 1.4;">
                ⚠️ <strong>Nota:</strong> Al restaurar una versión, se sobrescribirán los datos actuales. Asegúrate de crear un snapshot nuevo antes si no estás seguro.
            </p>
        </div>
    `;
}
