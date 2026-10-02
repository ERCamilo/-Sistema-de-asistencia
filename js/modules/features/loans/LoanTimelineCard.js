/**
 * ⏱️ LoanTimelineCard.js — Visual component for historical loan timeline & debt reconciliation.
 *
 * Implements the 100% faithful replication of the user's reference design:
 *   - Navigation bar: `< Fecha anterior` | `📅 Fecha` | `Próxima fecha >`
 *   - Collapsible SVG Bézier debt curve ("emerges from timeline horizon")
 *   - Interactive scrubber track with event milestones
 *   - Executive Snapshot Card:
 *       Hero: Deuda total + Delta % + Badge Reconstruido + (i)
 *       Trilateral flow: Antes -> Cambios -> Después (cyan highlighted)
 */

import { buildLoanTimeline, getTimelineSnapshotAtDate, round2 } from './LoanTimelineEngine.js';
import { escapeHTML } from '../../utils/Sanitize.js';

/** Formats currency with commas and 2 decimals, using standard clean numerals */
function fmtMoney(amount) {
    const n = Number(amount) || 0;
    return n.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formats YYYY-MM-DD into "DD Mes AAAA" (e.g. 12 abr 2024) */
function fmtDate(isoDate) {
    if (!isoDate || typeof isoDate !== 'string') return '—';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    const year = parts[0];
    const monthIdx = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    return `${day} ${months[monthIdx] || ''} ${year}`;
}

/**
 * Generates an SVG path string for a smooth Bézier curve connecting milestones.
 */
function generateSvgChart(milestones, activeIndex, width = 860, height = 140) {
    if (!milestones || milestones.length < 2) return '';

    const maxVal = Math.max(...milestones.map(m => m.afterBalance), 1);
    const paddingX = 40;
    const paddingY = 25;
    const chartW = width - paddingX * 2;
    const chartH = height - paddingY * 2;

    const points = milestones.map((m, idx) => {
        const x = paddingX + (idx / (milestones.length - 1)) * chartW;
        const y = paddingY + chartH - (m.afterBalance / maxVal) * chartH;
        return { x: round2(x), y: round2(y), milestone: m, idx };
    });

    // Build smooth cubic Bézier spline
    let pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[i];
        const p1 = points[i + 1];
        const cpX = (p0.x + p1.x) / 2;
        pathD += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`;
    }

    const areaD = `${pathD} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

    const pinsSvg = points.map(pt => {
        const isActive = pt.idx === activeIndex;
        const color = isActive ? '#06b6d4' : '#64748b';
        const r = isActive ? 6 : 4;
        return `
            <circle cx="${pt.x}" cy="${pt.y}" r="${r + 3}" fill="${color}" opacity="0.3"></circle>
            <circle cx="${pt.x}" cy="${pt.y}" r="${r}" fill="${color}" stroke="#0c1726" stroke-width="2"></circle>
        `;
    }).join('');

    return `
        <svg class="loan-svg-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="loanChartGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.35"></stop>
                    <stop offset="100%" stop-color="#06b6d4" stop-opacity="0.0"></stop>
                </linearGradient>
            </defs>
            <path d="${areaD}" fill="url(#loanChartGrad)"></path>
            <path d="${pathD}" fill="none" stroke="#06b6d4" stroke-width="2.5" stroke-linecap="round"></path>
            ${pinsSvg}
        </svg>
    `;
}

/**
 * Renders the central "Cambios" column inside the snapshot card.
 * Color coding (canónico del sistema):
 *   - Verdes: Pagos / Abonos
 *   - Amarillos: Préstamos otorgados
 *   - Morados: Refinanciamientos (con etiqueta de monto base refinanciado)
 */
function renderChangesColumn(snapshot) {
    const summary = snapshot.summary || (function() {
        const loansList = (snapshot.changes || []).filter(c => c.type === 'loan');
        const paymentsList = (snapshot.changes || []).filter(c => c.type === 'payment');
        const refinancingsList = (snapshot.changes || []).filter(c => c.type === 'refinance');
        const totalLoansDue = loansList.reduce((s, l) => s + l.amount, 0);
        const totalPayments = paymentsList.reduce((s, p) => s + p.amount, 0);
        const totalRefinanceInterest = refinancingsList.reduce((s, r) => s + r.amount, 0);
        const totalBaseRefinanced = refinancingsList.reduce((s, r) => s + (r.baseAmount || 0), 0);
        return {
            totalSumas: totalLoansDue + totalRefinanceInterest,
            totalRestas: totalPayments,
            netChange: snapshot.delta || 0,
            loans: { count: loansList.length, items: loansList, totalDue: totalLoansDue },
            payments: { count: paymentsList.length, items: paymentsList, total: totalPayments },
            refinancings: { count: refinancingsList.length, items: refinancingsList, totalInterest: totalRefinanceInterest, totalBaseRefinanced }
        };
    })();

    const hasChanges = (snapshot.changes && snapshot.changes.length > 0);
    const netSign = summary.netChange > 0 ? '+' : (summary.netChange < 0 ? '−' : '');
    const netClass = summary.netChange < 0 ? 'is-decrease' : (summary.netChange > 0 ? 'is-increase' : 'is-neutral');

    return `
        <div class="loan-trilateral-col loan-trilateral-col--changes">
            <div class="loan-col-header">
                <div class="loan-col-title">Cambios hasta ${fmtDate(snapshot.date)}</div>
                <div class="loan-col-date">${fmtDate(snapshot.date)}</div>
            </div>

            <!-- Resumen superior: Monto total neto + Total sumas y restas -->
            <div class="loan-changes-overview-card">
                <div class="loan-changes-net-row">
                    <span class="loan-changes-net-label">Variación neta</span>
                    <span class="loan-changes-net-value ${netClass}">${netSign}$${fmtMoney(Math.abs(summary.netChange))}</span>
                </div>
                <div class="loan-changes-sums-restas-row">
                    ${summary.totalSumas > 0 ? `
                        <span class="loan-badge-sum" title="Nuevas deudas e intereses sumados">+ $${fmtMoney(summary.totalSumas)} cargos</span>
                    ` : ''}
                    ${summary.totalRestas > 0 ? `
                        <span class="loan-badge-resta" title="Abonos y pagos que reducen la deuda">− $${fmtMoney(summary.totalRestas)} pagos</span>
                    ` : ''}
                </div>
            </div>

            <!-- Lista desplegable de bloques por tipo de cambio -->
            <div class="loan-changes-accordions">
                ${!hasChanges ? `
                    <div class="loan-changes-empty">Sin movimientos registrados en esta fecha</div>
                ` : ''}

                <!-- 🟢 1. Pagos / Abonos (Verde) -->
                ${summary.payments.count > 0 ? `
                    <details class="loan-change-group is-payment" open>
                        <summary class="loan-change-summary">
                            <div class="loan-summary-left">
                                <span class="loan-change-type-icon is-payment">✓</span>
                                <span class="loan-change-type-title">Abonos / Pagos</span>
                                <span class="loan-change-count-badge is-payment">#${summary.payments.count}</span>
                            </div>
                            <div class="loan-summary-right">
                                <span class="loan-change-group-total is-payment">−$${fmtMoney(summary.payments.total)}</span>
                                <span class="loan-change-chevron">▾</span>
                            </div>
                        </summary>
                        <div class="loan-change-details-body">
                            ${summary.payments.items.map(p => `
                                <div class="loan-detail-item is-payment">
                                    <div class="loan-detail-header-row">
                                        <div class="loan-detail-amount-pill is-payment">−$${fmtMoney(p.amount)}</div>
                                        <span class="loan-loan-num-tag">#${p.loanSeq || 1}</span>
                                        <span class="loan-detail-label-text">${escapeHTML(p.label || 'Abono a préstamo')}</span>
                                    </div>
                                    <div class="loan-breakdown-pills">
                                        ${p.interestCovered > 0 ? `
                                            <span class="loan-pill-chip is-interest" title="Interés liquidado primero por prelación">
                                                $${fmtMoney(p.interestCovered)} interés
                                            </span>
                                        ` : ''}
                                        ${p.principalCovered > 0 ? `
                                            <span class="loan-pill-chip is-principal" title="Amortización a capital">
                                                $${fmtMoney(p.principalCovered)} capital
                                            </span>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}

                <!-- 🟡 2. Préstamos otorgados (Amarillo) -->
                ${summary.loans.count > 0 ? `
                    <details class="loan-change-group is-loan" open>
                        <summary class="loan-change-summary">
                            <div class="loan-summary-left">
                                <span class="loan-change-type-icon is-loan">+</span>
                                <span class="loan-change-type-title">Préstamos otorgados</span>
                                <span class="loan-change-count-badge is-loan">#${summary.loans.count}</span>
                            </div>
                            <div class="loan-summary-right">
                                <span class="loan-change-group-total is-loan">+$${fmtMoney(summary.loans.totalDue)}</span>
                                <span class="loan-change-chevron">▾</span>
                            </div>
                        </summary>
                        <div class="loan-change-details-body">
                            ${summary.loans.items.map(l => `
                                <div class="loan-detail-item is-loan">
                                    <div class="loan-detail-header-row">
                                        <div class="loan-detail-amount-pill is-loan">+$${fmtMoney(l.amount)}</div>
                                        <span class="loan-loan-num-tag">#${l.loanSeq || 1}</span>
                                        <span class="loan-detail-label-text">${escapeHTML(l.concept || l.label || 'Préstamo')}</span>
                                    </div>
                                    <div class="loan-breakdown-pills">
                                        <span class="loan-pill-chip is-principal">
                                            $${fmtMoney(l.principalPart || l.amount)} capital #${l.loanSeq || 1}
                                        </span>
                                        ${l.interestPart > 0 ? `
                                            <span class="loan-pill-chip is-interest">
                                                $${fmtMoney(l.interestPart)} interés (${l.interestRate || 0}%)
                                            </span>
                                        ` : `
                                            <span class="loan-pill-chip is-interest-zero">0% interés</span>
                                        `}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}

                <!-- 🟣 3. Refinanciamientos (Morado) -->
                ${summary.refinancings.count > 0 ? `
                    <details class="loan-change-group is-refinance" open>
                        <summary class="loan-change-summary">
                            <div class="loan-summary-left">
                                <span class="loan-change-type-icon is-refinance">🔄</span>
                                <span class="loan-change-type-title">Refinanciamiento</span>
                                <span class="loan-change-count-badge is-refinance">#${summary.refinancings.count}</span>
                                <span class="loan-refinance-base-tag" title="Monto base sobre el que se calculó el refinanciamiento">
                                    Base refinanciada: $${fmtMoney(summary.refinancings.totalBaseRefinanced)}
                                </span>
                            </div>
                            <div class="loan-summary-right">
                                <span class="loan-change-group-total is-refinance">+$${fmtMoney(summary.refinancings.totalInterest)}</span>
                                <span class="loan-change-chevron">▾</span>
                            </div>
                        </summary>
                        <div class="loan-change-details-body">
                            ${summary.refinancings.items.map(r => `
                                <div class="loan-detail-item is-refinance">
                                    <div class="loan-detail-header-row">
                                        <div class="loan-detail-amount-pill is-refinance">+$${fmtMoney(r.amount)}</div>
                                        <span class="loan-loan-num-tag">#${r.loanSeq || 1}</span>
                                        <span class="loan-detail-label-text">Recargo refinanciamiento (${r.interestRate || 0}%)</span>
                                    </div>
                                    <div class="loan-breakdown-pills">
                                        <span class="loan-pill-chip is-refinance">
                                            Base refinanciada: $${fmtMoney(r.baseAmount || 0)} #${r.loanSeq || 1}
                                        </span>
                                        ${r.note ? `
                                            <span class="loan-pill-chip is-note">${escapeHTML(r.note)}</span>
                                        ` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </details>
                ` : ''}
            </div>
        </div>
    `;
}

/**
 * Main render function for the historical loan timeline card.
 *
 * @param {object|object[]} empOrList - Active employee or array of employees in project scope
 * @param {object} [options]
 * @param {string} [options.selectedDate] - Date string 'YYYY-MM-DD'
 * @param {boolean} [options.showChart=false] - Whether the SVG horizon curve is expanded
 * @returns {string} HTML string
 */
export function renderLoanTimelineCard(empOrList, options = {}) {
    const timeline = buildLoanTimeline(empOrList);
    if (!timeline.hasHistory || timeline.milestones.length === 0) {
        return '';
    }

    const milestones = timeline.milestones;
    const selectedDate = options.selectedDate || milestones[milestones.length - 1].date;
    const snapshot = getTimelineSnapshotAtDate(timeline, selectedDate) || milestones[milestones.length - 1];
    const currentIndex = snapshot.index;

    const prevMilestone = currentIndex > 0 ? milestones[currentIndex - 1] : null;
    const nextMilestone = currentIndex < milestones.length - 1 ? milestones[currentIndex + 1] : null;

    // Position percentage for the active thumb and pointer
    const activePercent = milestones.length > 1
        ? round2((currentIndex / (milestones.length - 1)) * 100)
        : 50;

    const showChart = !!options.showChart;

    // Delta metrics
    const isDecrease = snapshot.delta < 0;
    const deltaSign = snapshot.delta > 0 ? '+' : (snapshot.delta < 0 ? '−' : '');
    const deltaClass = isDecrease ? '' : 'is-increase';
    const deltaArrow = isDecrease ? '↓' : '↑';

    return `
    <div class="loan-timeline-wrapper">
        <!-- Barra Superior de Navegación -->
        <div class="loan-nav-bar">
            <button type="button" class="loan-nav-btn"
                data-app-fn="loanTimelineNav" data-arg="${prevMilestone ? prevMilestone.date : ''}"
                ${!prevMilestone ? 'disabled' : ''}>
                ‹ Fecha anterior
            </button>

            <button type="button" class="loan-nav-date-btn" data-app-fn="loanTimelineToggleChart">
                <span class="loan-nav-date-icon">📅</span>
                <span>${fmtDate(snapshot.date)}</span>
                <span style="font-size:10px;opacity:0.6;margin-left:4px;">${showChart ? '▲' : '▼'}</span>
            </button>

            <button type="button" class="loan-nav-btn"
                data-app-fn="loanTimelineNav" data-arg="${nextMilestone ? nextMilestone.date : ''}"
                ${!nextMilestone ? 'disabled' : ''}>
                Próxima fecha ›
            </button>
        </div>

        <!-- Gráfica Desplegable que Emerge de la Línea de Tiempo -->
        <div class="loan-chart-container ${showChart ? 'is-expanded' : 'is-collapsed'}">
            ${showChart ? generateSvgChart(milestones, currentIndex) : ''}
        </div>

        <!-- Riel Scrubber Magnético -->
        <div class="loan-scrubber-track">
            <div class="loan-scrubber-progress" style="width: ${activePercent}%;"></div>
            ${milestones.map(m => {
                const pct = milestones.length > 1 ? round2((m.index / (milestones.length - 1)) * 100) : 50;
                return `<div class="loan-scrubber-pin ${m.index === currentIndex ? 'is-active' : ''}"
                    style="left: ${pct}%;" data-app-fn="loanTimelineNav" data-arg="${m.date}" title="${fmtDate(m.date)}"></div>`;
            }).join('')}
            <div class="loan-scrubber-thumb" style="left: ${activePercent}%;"></div>
        </div>

        <!-- Tarjeta Principal de Snapshot (Fiel a Foto) -->
        <div class="loan-snapshot-card" style="--active-pin-pos: ${activePercent}%;">
            <!-- Cabecera Hero -->
            <div class="loan-snapshot-header">
                <div class="loan-snapshot-hero-title">Deuda total</div>
                <div class="loan-snapshot-header-right">
                    <span class="loan-badge-rebuilt">🔄 Reconstruido</span>
                    <button type="button" class="loan-info-btn" data-app-fn="showLoanTimelineHelp" title="Cálculo histórico reconstruido con prelación de interés">i</button>
                </div>
            </div>

            <div class="loan-snapshot-hero-amount">$${fmtMoney(snapshot.afterBalance)}</div>

            <div class="loan-snapshot-hero-delta">
                <span>vs. ${fmtDate(snapshot.previousDate)}</span>
                <span class="loan-snapshot-delta-val ${deltaClass}">
                    ${deltaArrow} ${deltaSign}$${fmtMoney(Math.abs(snapshot.delta))} (${snapshot.deltaPercent > 0 ? '+' : ''}${snapshot.deltaPercent}%)
                </span>
            </div>

            <!-- Grid Trilateral (Antes -> Cambios -> Después) -->
            <div class="loan-trilateral-grid">
                <!-- Columna Antes -->
                <div class="loan-trilateral-col">
                    <div class="loan-col-header">
                        <div class="loan-col-title">Antes</div>
                        <div class="loan-col-date">${fmtDate(snapshot.previousDate)}</div>
                    </div>
                    <div class="loan-trilateral-box">
                        $${fmtMoney(snapshot.beforeBalance)}
                    </div>
                </div>

                <!-- Divisor 1 con Flecha -->
                <div class="loan-trilateral-divider">
                    <div class="loan-trilateral-chevron">›</div>
                </div>

                <!-- Columna Central: Cambios Desglosados -->
                ${renderChangesColumn(snapshot)}

                <!-- Divisor 2 con Flecha -->
                <div class="loan-trilateral-divider">
                    <div class="loan-trilateral-chevron">›</div>
                </div>

                <!-- Columna Después: Saldo Consolidado -->
                <div class="loan-trilateral-col">
                    <div class="loan-col-header">
                        <div class="loan-col-title">Después</div>
                        <div class="loan-col-date">${fmtDate(snapshot.date)}</div>
                    </div>
                    <div class="loan-trilateral-box is-highlighted">
                        $${fmtMoney(snapshot.afterBalance)}
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
}
