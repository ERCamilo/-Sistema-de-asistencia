/**
 * SettingsTestsTab.js — Panel de pruebas del sistema en Configuración.
 *
 * Permite ejecutar la suite de pruebas con datos aislados directamente
 * desde el navegador, sin afectar datos reales del usuario.
 */

export function SettingsTestsTab() {
    return `
        <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
            <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; flex-wrap: wrap;">
                <div>
                    <h3 style="margin: 0 0 8px 0; font-size: 1.125rem; color: #06b6d4; font-weight: 700;">
                        🧪 Pruebas del Sistema
                    </h3>
                    <p style="margin: 0; color: #94a3b8; font-size: 0.875rem; line-height: 1.5; max-width: 520px;">
                        Ejecuta la suite de pruebas automáticas con <strong style="color:#e2e8f0;">datos de prueba aislados</strong>.
                        Ninguna prueba toca tus empleados, asistencias ni préstamos reales.
                    </p>
                </div>
                <button
                    type="button"
                    data-settings-action="run-browser-tests"
                    class="btn btn-primary"
                    style="flex-shrink: 0; padding: 10px 20px; font-size: 0.875rem; white-space: nowrap;">
                    ▶ Ejecutar Pruebas
                </button>
            </div>

            <div id="browser-test-results" style="font-family: monospace;">
                <div style="padding: 16px; background: #0f172a; border-radius: 8px; color: #475569; font-size: 0.8rem; text-align: center;">
                    Presiona "Ejecutar Pruebas" para iniciar la verificación del sistema.
                </div>
            </div>
        </div>
    `;
}
