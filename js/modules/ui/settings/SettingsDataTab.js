/**
 * SettingsDataTab.js - Componente de la pestaña Datos, Sincronización y Backups
 */
import { DateUtils } from '../../utils/DateUtils.js';

export function SettingsDataTab(context) {
    const state = context.state;
    const icons = context.icons;
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
                            
                            <button type="button" data-settings-action="login-with-google" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 14px; background: white; color: #374151; font-weight: 600; border: 1px solid #d1d5db; transition: all 0.2s;">
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
                                <button type="button" data-settings-action="logout-firebase" style="padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">
                                    Salir
                                </button>
                            </div>

                            <!-- Herramientas de Nube -->
                            <div style="margin-bottom: 20px;">
                                <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Backup y Snapshots</div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">
                                    <button type="button" data-settings-action="sync-firebase-now" class="btn-secondary" style="background: rgba(66, 133, 244, 0.1); color: #4285F4; border: 1px solid rgba(66, 133, 244, 0.2); padding: 12px; font-size: 0.85rem;">
                                       🔄 Sync Actual
                                    </button>
                                    <button type="button" data-settings-action="sync-history-now" class="btn-secondary" style="background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); padding: 12px; font-size: 0.85rem;">
                                       📅 Sync Historial
                                    </button>
                                    <button type="button" data-settings-action="create-firebase-snapshot" class="btn-secondary" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2); padding: 12px; font-size: 0.85rem; grid-column: span 2;">
                                       📸 Crear Snapshot Manual
                                    </button>
                                </div>
                                
                                <div class="form-group" style="margin-bottom: 0;">
                                    <label class="form-label" style="font-size: 0.85rem; color: #64748b;">Auto-Backup</label>
                                    <select id="backupFrequency" onchange="updateBackupFrequency(this.value)" class="form-input" style="background: #0f172a; border-color: #334155; font-size: 0.85rem; height: 38px;">
                                        <option value="none" ${state.settings.backupFrequency === 'none' ? 'selected' : ''}>Desactivado</option>
                                        <option value="daily" ${state.settings.backupFrequency === 'daily' ? 'selected' : ''}>Diario</option>
                                        <option value="weekly" ${state.settings.backupFrequency === 'weekly' ? 'selected' : ''}>Semanal</option>
                                        <option value="monthly" ${state.settings.backupFrequency === 'monthly' ? 'selected' : ''}>Mensual</option>
                                    </select>
                                </div>
                            </div>
                        `}
                    </div>

                    <!-- Fase 4: Historial de Snapshots -->
                    ${currentUser ? SnapshotHistory(context) : ''}
                    
                    <!-- Salud de Datos y Duplicados -->
                    <div style="background: linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(15, 23, 42, 0.1)); border-radius: 12px; padding: 24px; margin-top: 20px; border: 1px solid #0891b2;">
                        <h3 style="margin: 0 0 12px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                            <span>🛡️</span> Salud de los Datos
                        </h3>
                        <p style="color: #94a3b8; font-size: 0.85rem; margin-bottom: 20px; line-height: 1.6;">
                            Busca y resuelve inconsistencias, como empleados con números de ficha duplicados. Esto asegura que la nómina y las asistencias sean precisas.
                        </p>
                        <button type="button" data-settings-action="start-maintenance-wizard" class="btn-primary" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px; background: #0891b2; border: none;">
                            🧹 Iniciar Asistente de Saneamiento
                        </button>
                    </div>

                    <!-- Gestión de Datos -->
                    <div style="margin-top: 32px; display: flex; flex-direction: column; gap: 24px;">
                        
                        <!-- Columna: Datos Locales -->
                        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #334155;">
                            <h3 style="margin: 0 0 20px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                                <span>📱</span> Datos Locales (Este dispositivo)
                            </h3>

                            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
                                <!-- Sistema de Almacenamiento -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="font-weight: 600; color: #94a3b8; margin-bottom: 12px; font-size: 0.85rem; text-transform: uppercase;">Almacenamiento Interno</div>
                                    <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="localStorage" ${!state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${!state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${!state.useIndexedDB ? '#0891b2' : '#334155'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${!state.useIndexedDB ? 'white' : '#94a3b8'};">📦 Local</div>
                                            </div>
                                        </label>
                                        <label style="flex: 1; cursor: pointer;">
                                            <input type="radio" name="storageTypeData" value="indexedDB" ${state.useIndexedDB ? 'checked' : ''} onchange="handleStorageTypeChange(this.value)" style="display: none;">
                                            <div style="padding: 10px; background: ${state.useIndexedDB ? '#0891b2' : '#1e293b'}; border-radius: 8px; text-align: center; border: 1px solid ${state.useIndexedDB ? '#0891b2' : '#334155'};">
                                                <div style="font-weight: 600; font-size: 0.9rem; color: ${state.useIndexedDB ? 'white' : '#94a3b8'};">🗄️ IndexedDB</div>
                                            </div>
                                        </label>
                                    </div>
                                    <div id="indexeddb-stats" style="font-size: 0.7rem; color: #64748b; line-height: 1.5;">${state.useIndexedDB ? 'Cargando estadísticas...' : 'Usando LocalStorage (límite 5MB)'}</div>
                                </div>

                                <!-- Backups Manuales -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155; display: flex; flex-direction: column; gap: 10px;">
                                    <div style="font-weight: 600; color: #94a3b8; margin-bottom: 2px; font-size: 0.85rem; text-transform: uppercase;">Archivo Backup (.json)</div>
                                    <button type="button" data-settings-action="export-data" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px;">📥 Descargar Backup</button>
                                    <button type="button" data-settings-action="open-import-input" class="btn-secondary" style="width: 100%; justify-content: center; padding: 10px;">📤 Cargar Backup</button>
                                    <input type="file" id="import-file-input" accept=".json" style="display: none;" onchange="importData(event)">
                                </div>
                            </div>

                            <!-- Borrado Local -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(239, 68, 68, 0.05); border-radius: 10px; border: 1px dashed rgba(239, 68, 68, 0.3);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; padding-right: 16px;">
                                        <div style="color: #ef4444; font-weight: 700; font-size: 0.9rem; margin-bottom: 4px;">BORRADO LOCAL TOTAL</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8;">Limpia este teléfono por completo. Los datos en la nube NO se borrarán.</div>
                                    </div>
                                    <button type="button" data-settings-action="delete-all-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px;">🗑️ Borrar Local</button>
                                </div>
                            </div>
                        </div>

                        <!-- Columna: Datos en la Nube -->
                        ${currentUser ? `
                        <div style="background: #1e293b; border-radius: 12px; padding: 24px; border: 1px solid #4285F4;">
                            <h3 style="margin: 0 0 20px 0; font-size: 1.125rem; color: #f1f5f9; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                                <span>☁️</span> Gestión de Nube (Google Account)
                            </h3>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                                <!-- Override: Download -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="color: #4285F4; font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">DESCARGAR DE LA NUBE</div>
                                    <p style="font-size: 0.75rem; color: #94a3b8; margin: 0 0 12px 0;">Reemplaza todos los datos de este teléfono con lo que hay en la nube.</p>
                                    <button type="button" data-settings-action="download-from-cloud" class="btn-secondary" style="width: 100%; border-color: rgba(66, 133, 244, 0.4); color: #4285F4;">📥 Sobrescribir Local</button>
                                </div>

                                <!-- Override: Upload -->
                                <div style="background: #0f172a; border-radius: 10px; padding: 16px; border: 1px solid #334155;">
                                    <div style="color: #10b981; font-weight: 700; font-size: 0.85rem; margin-bottom: 8px;">SUBIR A LA NUBE</div>
                                    <p style="font-size: 0.75rem; color: #94a3b8; margin: 0 0 12px 0;">Fuerza que la nube guarde exactamente lo que tienes en este teléfono.</p>
                                    <button type="button" data-settings-action="upload-to-cloud" class="btn-secondary" style="width: 100%; border-color: rgba(16, 185, 129, 0.4); color: #10b981;">📤 Sobrescribir Nube</button>
                                </div>
                            </div>

                            <!-- Borrado Nube -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(239, 68, 68, 0.05); border-radius: 10px; border: 1px dashed rgba(239, 68, 68, 0.3);">
                                <div style="display: flex; justify-content: space-between; align-items: center;">
                                    <div style="flex: 1; padding-right: 16px;">
                                        <div style="color: #ef4444; font-weight: 700; font-size: 0.9rem; margin-bottom: 4px;">ELIMINAR DATOS DE LA NUBE</div>
                                        <div style="font-size: 0.75rem; color: #94a3b8;">Borra permanentemente tu respaldo en Google/Firebase. El teléfono no se verá afectado.</div>
                                    </div>
                                    <button type="button" data-settings-action="delete-cloud-data" class="btn-danger" style="white-space: nowrap; padding: 10px 20px; background: none; border: 1px solid #ef4444; color: #ef4444;">🗑️ Borrar Nube</button>
                                </div>
                            </div>
                            
                            <!-- Limpieza de Historial Masiva -->
                            <div style="margin-top: 16px; padding: 16px; background: rgba(15, 23, 42, 0.5); border-radius: 10px; border: 1px solid #334155;">
                                <div style="color: #94a3b8; font-weight: 700; font-size: 0.85rem; margin-bottom: 12px; text-transform: uppercase; display: flex; align-items: center; gap: 8px;">
                                    <span>🧹</span> Limpieza de Historial (Snapshots)
                                </div>
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="auto" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8;">
                                        Borrar Todos los Autos
                                    </button>
                                    <button type="button" data-settings-action="bulk-delete-snapshots" data-value="manual" class="btn-secondary" style="font-size: 0.75rem; padding: 8px; border-color: rgba(239, 68, 68, 0.3); color: #94a3b8;">
                                        Borrar Todos los Manuales
                                    </button>
                                </div>
                                <p style="margin: 8px 0 0 0; font-size: 0.65rem; color: #64748b;">
                                    * Las versiones marcadas como 'Protegidas' (p. ej. pre-restauración) no se borrarán.
                                </p>
                            </div>
                        </div>
                        ` : ''}
                    </div>
            `;
}

function SnapshotHistory(context) {
    const state = context.state;
    const icons = context.icons;
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
                                    ${snap.type === 'pre-restore' ? `
                                        <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                                            🛡️ PROTEGIDO
                                        </span>
                                    ` : `
                                        <span style="font-size: 0.75rem; padding: 2px 6px; border-radius: 4px; background: ${snap.type === 'auto' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(6, 182, 212, 0.1)'}; color: ${snap.type === 'auto' ? '#10b981' : '#06b6d4'}; border: 1px solid currentColor;">
                                            ${snap.type === 'auto' ? 'AUTO' : 'MANUAL'}
                                        </span>
                                    `}
                                    <span style="color: #f1f5f9; font-weight: 600; font-size: 0.9rem;">
                                        ${DateUtils.formatDateTime(snap.createdAt)}
                                    </span>

                                </div>
                                <div style="color: #94a3b8; font-size: 0.75rem; display: flex; align-items: center; gap: 4px;">
                                    ${icons.get('personnel', { size: 12 })} ${snap.employeeCount} empleados <span style="opacity: 0.4;">|</span> ${icons.get('file', { size: 12 })} ${snap.attendanceCount} registros
                                </div>
                            </div>
                            <div style="display: flex; gap: 6px;">
                                <button type="button" data-settings-action="delete-snapshot" data-id="${snap.id}" aria-label="Eliminar snapshot"
                                        style="padding: 8px; background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 6px; cursor: pointer; display: flex; align-items: center; justify-content: center;"
                                        title="Eliminar permanentemente">
                                    🗑️
                                </button>
                                <button type="button" data-settings-action="restore-snapshot" data-id="${snap.id}" aria-label="Restaurar snapshot" 
                                        style="padding: 8px 16px; background: rgba(6, 182, 212, 0.1); color: #06b6d4; border: 1px solid rgba(6, 182, 212, 0.2); border-radius: 6px; font-size: 0.8rem; cursor: pointer; transition: all 0.2s;">
                                    ⏪ Restaurar
                                </button>
                            </div>
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
