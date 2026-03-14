function DashboardControls() {
            const startDate = state.dashboardStartDate;
            const endDate = state.dashboardEndDate;
            
            return `
                <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; border: 1px solid #334155;">
                    <!-- Selector de Gráfico -->
                    <div style="margin-bottom: 20px;">
                        <div style="font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                            📊 TIPO DE VISUALIZACIÓN
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
                            <button onclick="setDashboardChart('attendance')" 
                                    class="dashboard-chart-btn ${state.dashboardChart === 'attendance' ? 'active' : ''}">
                                📈 Asistencia
                            </button>
                            <button onclick="setDashboardChart('hours')" 
                                    class="dashboard-chart-btn ${state.dashboardChart === 'hours' ? 'active' : ''}">
                                📊 Horas
                            </button>
                            <button onclick="setDashboardChart('positions')" 
                                    class="dashboard-chart-btn ${state.dashboardChart === 'positions' ? 'active' : ''}">
                                🍩 Posiciones
                            </button>
                            <button onclick="setDashboardChart('top10')" 
                                    class="dashboard-chart-btn ${state.dashboardChart === 'top10' ? 'active' : ''}">
                                🏆 Top 10
                            </button>
                            <button onclick="setDashboardChart('heatmap')" 
                                    class="dashboard-chart-btn ${state.dashboardChart === 'heatmap' ? 'active' : ''}">
                                🔥 Mapa Calor
                            </button>
                        </div>
                    </div>
                    
                    <!-- Selector de Rango de Fechas -->
                    <div style="margin-bottom: 20px;">
                        <div style="font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                            📅 PERÍODO DE ANÁLISIS
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px;">
                            <!-- Fecha Desde -->
                            <div style="position: relative;">
                                <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Desde:</label>
                                <div class="date-display" onclick="toggleStartDatePicker()" 
                                     style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                                    ${formatDateShort(startDate)}
                                </div>
                                ${state.showStartDatePicker ? DashboardStartDatePicker() : ''}
                            </div>
                            
                            <!-- Fecha Hasta -->
                            <div style="position: relative;">
                                <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px;">Hasta:</label>
                                <div class="date-display" onclick="toggleEndDatePicker()" 
                                     style="background: #0f172a; border: 1px solid #334155; color: #f1f5f9; padding: 8px 12px; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                                    ${formatDateShort(endDate)}
                                </div>
                                ${state.showEndDatePicker ? DashboardEndDatePicker() : ''}
                            </div>
                            
                            <!-- Botones rápidos -->
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <label style="font-size: 0.75rem; color: #64748b; display: block; margin-bottom: 4px; opacity: 0;">-</label>
                                <button onclick="setDashboardThisWeek()" 
                                        style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap; transition: all 0.2s;"
                                        onmouseover="this.style.borderColor='#06b6d4'" 
                                        onmouseout="this.style.borderColor='#334155'">
                                    Esta Semana
                                </button>
                                <button onclick="setDashboardThisMonth()" 
                                        style="background: #1e293b; border: 1px solid #334155; color: #06b6d4; padding: 6px 12px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; white-space: nowrap; transition: all 0.2s;"
                                        onmouseover="this.style.borderColor='#06b6d4'" 
                                        onmouseout="this.style.borderColor='#334155'">
                                    Este Mes
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Botones de Exportación -->
                    <div>
                        <div style="font-size: 0.875rem; font-weight: 600; color: #94a3b8; margin-bottom: 12px;">
                            📥 EXPORTAR
                        </div>
                        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                            <button onclick="exportExcel()" 
                                    style="background: linear-gradient(135deg, #10b981, #059669); border: none; color: white; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.875rem;">
                                📊 Excel
                            </button>
                            <button onclick="exportPDF()" 
                                    style="background: linear-gradient(135deg, #ef4444, #dc2626); border: none; color: white; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.875rem;">
                                📄 PDF
                            </button>
                            <button onclick="exportCSV()" 
                                    style="background: linear-gradient(135deg, #3b82f6, #2563eb); border: none; color: white; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.875rem;">
                                📋 CSV
                            </button>
                            <button onclick="exportImage()" 
                                    style="background: linear-gradient(135deg, #8b5cf6, #7c3aed); border: none; color: white; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.875rem;">
                                🖼️ Imagen
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }