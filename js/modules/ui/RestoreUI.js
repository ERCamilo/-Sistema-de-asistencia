import { DateUtils } from '../utils/DateUtils.js';

/**
 * 🌲 RestoreUI.js
 * Gestiona la interfaz de comparación y el flujo de decisión para restauración de backups.
 */

export const RestoreUI = {
    /**
     * Muestra el modal de comparación entre datos locales y backup
     */
    showComparisonModal(backupData, currentState, callbacks = {}) {
        const modalId = 'restore-comparison-modal';
        if (document.getElementById(modalId)) return;

        const backup = backupData.data || {};
        const current = currentState || {};

        // Extraer estadísticas del Backup
        const backupStats = {
            company: backup.settings?.companyName || 'Sin nombre',
            employees: backup.employees?.length || 0,
            attendance: Object.keys(backup.attendance || {}).length,
            dateRange: this._getAttendanceDateRange(backup.attendance || {})
        };

        const wasMigrated = backupData.wasMigrated;
        const originalVersion = backupData.originalVersion || 'Legacy';

        // Extraer estadísticas Actuales
        const currentStats = {
            company: current.settings?.companyName || 'Sin nombre',
            employees: current.employees?.length || 0,
            attendance: Object.keys(current.attendance || {}).length,
            dateRange: this._getAttendanceDateRange(current.attendance)
        };

        const isOnline = !!window.currentUser;

        const modalHTML = `
            <div id="${modalId}" class="modal-overlay" style="display: flex; align-items: center; justify-content: center; z-index: 10001; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(8px); position: fixed; top: 0; left: 0; width: 100%; height: 100%;">
                <div class="modal-content glass" style="max-width: 600px; width: 90%; padding: 24px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); background: #1e293b; color: #f1f5f9; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); position: relative;">
                    <button class="modal-close" onclick="const m=document.getElementById('${modalId}'); if(m) m.remove();" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: #94a3b8; cursor: pointer; font-size: 1.5rem;">&times;</button>
                    
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 12px;">
                            <i class="fas fa-file-import" style="color: #06b6d4;"></i> 
                            Revisar Backup
                        </h2>
                        ${wasMigrated ? `
                            <div style="background: #f59e0b; color: #fff; padding: 4px 10px; border-radius: 20px; font-size: 0.7rem; font-weight: bold; display: flex; align-items: center; gap: 5px;">
                                <i class="fas fa-history"></i> LEGACY ADAPTADO
                            </div>
                        ` : ''}
                    </div>

                    ${wasMigrated ? `
                        <div style="background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); color: #fbbf24; padding: 12px; border-radius: 8px; margin-bottom: 20px; font-size: 0.8rem; display: flex; align-items: center; gap: 10px;">
                            <i class="fas fa-info-circle"></i> 
                            Detectado backup de versión <b>${originalVersion}</b>. Hemos adaptado los datos automáticamente.
                        </div>
                    ` : ''}

                    <!-- Tabla de Comparación -->
                    <div style="background: rgba(15, 23, 42, 0.5); border-radius: 12px; overflow: hidden; border: 1px solid rgba(51, 65, 85, 0.5); margin-bottom: 24px;">
                        <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem; color: #cbd5e1;">
                            <thead style="background: rgba(30, 41, 59, 0.8);">
                                <tr>
                                    <th style="padding: 12px; text-align: left; color: #94a3b8; font-weight: 600;">Dato</th>
                                    <th style="padding: 12px; text-align: center; color: #94a3b8; font-weight: 600;">Actual</th>
                                    <th style="padding: 12px; text-align: center; color: #06b6d4; font-weight: 600;">Backup</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.3);">
                                    <td style="padding: 12px; font-weight: 500;">🏢 Empresa</td>
                                    <td style="padding: 12px; text-align: center;">${currentStats.company}</td>
                                    <td style="padding: 12px; text-align: center; color: #06b6d4;">${backupStats.company}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.3);">
                                    <td style="padding: 12px; font-weight: 500;">👥 Empleados</td>
                                    <td style="padding: 12px; text-align: center;">${currentStats.employees}</td>
                                    <td style="padding: 12px; text-align: center; color: #06b6d4;">${backupStats.employees}</td>
                                </tr>
                                <tr style="border-bottom: 1px solid rgba(51, 65, 85, 0.3);">
                                    <td style="padding: 12px; font-weight: 500;">📝 Registros</td>
                                    <td style="padding: 12px; text-align: center;">${currentStats.attendance}</td>
                                    <td style="padding: 12px; text-align: center; color: #06b6d4;">${backupStats.attendance}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 12px; font-weight: 500;">📅 Periodo</td>
                                    <td style="padding: 12px; text-align: center; font-size: 0.75rem;">${currentStats.dateRange}</td>
                                    <td style="padding: 12px; text-align: center; color: #06b6d4; font-size: 0.75rem;">${backupStats.dateRange}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Mensaje de Estado -->
                    <div style="background: rgba(30, 41, 59, 0.4); padding: 12px; border-radius: 8px; margin-bottom: 24px; border-left: 4px solid ${isOnline ? '#3b82f6' : '#94a3b8'};">
                        <div style="font-weight: 600; font-size: 0.85rem; color: ${isOnline ? '#60a5fa' : '#94a3b8'}; margin-bottom: 4px;">
                            ${isOnline ? '☁️ CONECTADO A LA NUBE' : '🔌 TRABAJANDO OFFLINE'}
                        </div>
                        <div style="font-size: 0.75rem; color: #94a3b8; line-height: 1.4;">
                            ${isOnline ? 'Detectamos que tienes una cuenta activa. Elige cómo quieres manejar el impacto de este backup en la nube.' : 'Los datos se cargarán solo en este dispositivo. Si luego inicias sesión, se sincronizarán normalmente.'}
                        </div>
                    </div>

                    <!-- Botones de Acción -->
                    <div style="display: flex; flex-direction: column; gap: 10px;">
                        ${!isOnline ? `
                            <button id="btn-restore-local" class="btn btn-primary" style="padding: 14px; background: linear-gradient(135deg, #06b6d4, #0891b2);">
                                ✅ Restaurar Datos Locales
                            </button>
                        ` : `
                            <button id="btn-restore-disconnect" class="btn btn-secondary" style="padding: 12px; display: flex; align-items: center; justify-content: space-between; background: rgba(30, 41, 59, 0.6); border: 1px solid #475569;">
                                <span>🏃 Desconectar y Restaurar</span>
                                <span style="font-size: 0.7rem; opacity: 0.7;">(Solo este teléfono)</span>
                            </button>
                            <button id="btn-restore-replace" class="btn btn-danger" style="padding: 12px; display: flex; align-items: center; justify-content: space-between; border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                                <span>🔥 Borrar y Reemplazar Nube</span>
                                <span style="font-size: 0.7rem; opacity: 0.8;">(Espejo total)</span>
                            </button>
                        `}
                        <button onclick="document.getElementById('${modalId}').remove()" class="btn-cancel" style="padding: 10px; background: none; border: none; color: #64748b; cursor: pointer; font-size: 0.9rem;">
                            Cancelar
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        const closeModal = () => {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.remove();
                document.removeEventListener('keydown', handleEscape);
            }
        };

        // Manejo de tecla Escape para cerrar
        const handleEscape = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        document.addEventListener('keydown', handleEscape);

        // Listeners para los botones
        if (!isOnline) {
            document.getElementById('btn-restore-local').onclick = () => {
                closeModal();
                if (callbacks.onLocalRestore) callbacks.onLocalRestore();
            };
        } else {
            document.getElementById('btn-restore-disconnect').onclick = () => {
                this.showEmergencySnapshotDialog(() => {
                    closeModal();
                    if (callbacks.onDisconnectRestore) callbacks.onDisconnectRestore();
                });
            };
            document.getElementById('btn-restore-replace').onclick = () => {
                this.showEmergencySnapshotDialog(() => {
                    closeModal();
                    if (callbacks.onReplaceCloudRestore) callbacks.onReplaceCloudRestore();
                });
            };
        }

        // Botón Cancelar y Cerrar (X) también deben remover el listener
        const closeBtn = document.querySelector(`#${modalId} .modal-close`);
        const cancelBtn = document.querySelector(`#${modalId} .btn-cancel`);
        if (closeBtn) closeBtn.onclick = closeModal;
        if (cancelBtn) cancelBtn.onclick = closeModal;
    },

    /**
     * Diálogo para preguntar si desea el snapshot de emergencia
     */
    showEmergencySnapshotDialog(onProceed) {
        const dialogId = 'emergency-snapshot-dialog';
        if (document.getElementById(dialogId)) return;

        const modalHTML = `
            <div id="${dialogId}" class="modal-overlay" style="display: flex; align-items: center; justify-content: center; z-index: 10010; background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(4px); position: fixed; top: 0; left: 0; width: 100%; height: 100%;">
                <div class="modal-content glass animate-slide-up" style="max-width: 450px; width: 90%; padding: 32px 24px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.1); text-align: center; background: #1e293b; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="font-size: 3.5rem; margin-bottom: 20px; filter: drop-shadow(0 0 10px rgba(16, 185, 129, 0.3));">📸</div>
                    <h3 style="margin: 0 0 16px 0; color: #f1f5f9; font-size: 1.5rem; font-weight: 800;">¿Respaldo de Seguridad?</h3>
                    <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6; margin-bottom: 28px;">
                        ¿Deseas guardar una copia <span style="color: #10b981; font-weight: 700;">PROTEGIDA</span> de tus datos actuales antes de este cambio? 
                        <br><br>
                        Funcionará como un paracaídas si quieres volver atrás.
                    </p>
                    
                    <div style="display: grid; grid-template-columns: 1fr; gap: 12px;">
                        <button id="btn-snap-yes" class="btn active" style="padding: 16px; background: linear-gradient(135deg, #10b981, #059669); border: none; border-radius: 12px; color: white; font-weight: 800; cursor: pointer; font-size: 1rem; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                            ✨ Sí, Crear Snapshot Protegido
                        </button>
                        <button id="btn-snap-no" class="btn" style="padding: 14px; background: transparent; color: #94a3b8; border: 1px solid #334155; border-radius: 12px; font-weight: 600; cursor: pointer;">
                            No, proceder directamente
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        document.getElementById('btn-snap-yes').onclick = async () => {
            const currentDialog = document.getElementById(dialogId);
            if (currentDialog) currentDialog.remove();
            
            const loaderId = 'snapshot-loader';
            const loader = document.createElement('div');
            loader.id = loaderId;
            loader.innerHTML = `
                <div style="position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15, 23, 42, 0.95); display:flex; flex-direction:column; align-items:center; justify-content:center; z-index:10020; color:white; font-family:sans-serif; gap:20px;">
                    <div class="sync-spinner" style="width:50px; height:50px; border:5px solid rgba(255,255,255,0.1); border-top:5px solid #10b981; border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                    <div style="text-align:center;">
                        <div style="font-weight:800; font-size:1.1rem; margin-bottom:5px;">Asegurando tus datos...</div>
                        <div style="color:#94a3b8; font-size:0.85rem;">Creando punto de restauración protegido</div>
                    </div>
                    <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
                </div>`;
            document.body.appendChild(loader);
            
            try {
                if (globalThis.createFirebaseSnapshot) {
                    await globalThis.createFirebaseSnapshot('pre-restore');
                }
            } catch (e) {
                console.error("Error al crear snapshot de emergencia:", e);
                if (window.showNotification) {
                    window.showNotification("⚠️ No se pudo crear el respaldo de seguridad, pero continuaremos.", "warning");
                }
            } finally {
                if (document.getElementById(loaderId)) {
                    document.getElementById(loaderId).remove();
                }
                onProceed();
            }
        };

        document.getElementById('btn-snap-no').onclick = () => {
            const currentDialog = document.getElementById(dialogId);
            if (currentDialog) currentDialog.remove();
            onProceed();
        };
    },

    /**
     * Auxiliar para obtener el rango de fechas de la asistencia
     */
    _getAttendanceDateRange(attendance) {
        if (!attendance) return 'Sin registros';
        
        // El objeto de asistencia puede tener llaves (empId-date) o ser una estructura plana
        const keys = Object.keys(attendance);
        if (keys.length === 0) return 'Sin registros';

        // Extraer fechas y limpiar valores nulos
        const dates = keys.map(k => attendance[k]?.date).filter(d => d && typeof d === 'string');
        
        if (dates.length === 0) return 'Sin registros';

        const sorted = dates.sort();
        const start = sorted[0];
        const end = sorted[sorted.length - 1];

        if (start === end) return DateUtils.formatShort(start);
        return `${DateUtils.formatShort(start)} - ${DateUtils.formatShort(end)}`;
    }
};
