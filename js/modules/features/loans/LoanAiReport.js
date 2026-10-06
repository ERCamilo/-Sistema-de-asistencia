/**
 * 🤖 LoanAiReport — informe en Markdown de los préstamos para pedirle un
 * análisis a una IA, sin datos personales.
 *
 * Los empleados aparecen solo por su número de empleado (quien exporta sabe
 * quién es cada uno; la IA no). No se incluyen nombres, notas, conceptos de
 * préstamos ni identificadores internos.
 *
 * Incluye: contexto de cómo funcionan los préstamos y los cobros, la cartera
 * hoy, el historial por periodo y por mes, los descuentos de nómina por
 * periodo, la antigüedad de la deuda, el riesgo y, por empleado, sus
 * préstamos, abonos y lo que ganó en cada periodo frente a lo que ganaría
 * normalmente (indica si faltó, trabajó normal o hizo horas extra).
 *
 * Función pura: recibe todo calculado (los sueldos por periodo los arma
 * LoanExportPanel con la asistencia).
 */

import { LOAN_STATUS, round2, getActiveLoanTerms, getPaidAmount } from './LoansService.js';
import { replayLoan } from './LoanTimeline.js';
import { getAccountSummary, VENCIDO_GRACE_DAYS } from './LoanAccount.js';
import { buildFlowBuckets, computeLoanFlows } from './LoanFlowChart.js';
import { buildPayPeriods } from './LoanPayPeriods.js';
import { RISK_LEVELS } from './LoanRisk.js';

const M = v => `$${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const M0 = v => `$${Math.round(Number(v || 0)).toLocaleString('en-US')}`;
const dmy = key => (key ? `${key.slice(8, 10)}/${key.slice(5, 7)}/${key.slice(0, 4)}` : '—');
const PCT = v => (Number.isFinite(v) ? `${Math.round(v * 100)} %` : '—');
const DAY = 86_400_000;
const toTime = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
const plusDays = (key, n) => new Date(toTime(key) + n * DAY).toISOString().slice(0, 10);
const table = (head, rows) => (rows.length ? [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n') : '_Sin datos._');
const alias = emp => `#${String(emp?.number ?? '').trim() || '?'}`;
const isPayroll = p => p.origin === 'payroll' || p.source === 'payroll' || Boolean(p.payrollClosureId);
const counted = loan => loan && loan.status !== LOAN_STATUS.WRITTEN_OFF;

/** Lectura de lo que ganó frente a lo normal. */
export function earningReading({ gross = 0, expected = 0, overtimeHours = 0, partial = false } = {}) {
    if (!(expected > 0)) return gross > 0 ? 'sin sueldo normal configurado' : 'sin asistencia ni sueldo';
    if (!(gross > 0)) return partial ? 'aún sin asistencia en el periodo' : 'no trabajó (sin asistencia)';
    const r = gross / expected;
    if (r < 0.9) return 'trabajó menos de lo normal (faltas o días incompletos)';
    if (overtimeHours > 0.01 && r > 1.02) return 'normal con horas extra';
    if (r > 1.1) return 'más de lo normal';
    return 'normal';
}

/** Periodos de pago (inicio–fin, día de pago) a los que pertenece un abono de nómina. */
function payrollPeriodOf(payment, periods) {
    if (payment.payrollPeriodEnd) return periods.find(p => p.end === payment.payrollPeriodEnd) || null;
    return periods.find(p => payment.date >= p.end && payment.date <= plusDays(p.payDate, VENCIDO_GRACE_DAYS)) || null;
}

/**
 * @param {object} input
 * @param {string} input.today
 * @param {object} input.payPeriod             configuración de Nómina
 * @param {Array}  input.employees             empleados de la obra (leídos como en la pantalla)
 * @param {object} input.summary               computePortfolioSummary
 * @param {Array}  input.risk                  computeRiskList
 * @param {Map}    input.earnings              empId → [{ start, end, gross, expected, days, regularHours, overtimeHours, partial }]
 * @param {object} [input.notes]               { duplicates, review, consolidationsUndone, virtual }
 * @param {object} [input.focus]               { label, preview } rango elegido en el panel
 */
export function buildAiReport({ today, payPeriod = null, employees = [], summary, risk = [], earnings = new Map(), notes = {}, focus = null }) {
    const out = [];
    const periodLength = Number(payPeriod?.periodLength) || 0;
    const periods = periodLength ? buildPayPeriods(payPeriod, today, { before: 40, after: 1 }) : [];
    const firstLoan = employees.flatMap(e => (e.loans || []).filter(counted).map(l => l.startDate)).filter(Boolean).sort()[0] || today;
    const usedPeriods = periods.filter(p => p.end >= firstLoan && p.start <= today);
    const payDayOffset = periods[0] ? Math.round((toTime(periods[0].payDate) - toTime(periods[0].end)) / DAY) : 0;
    const allLoans = employees.flatMap(e => (e.loans || []).filter(counted));

    out.push('# Préstamos a empleados: datos para análisis');
    out.push('');
    out.push(`Generado el ${dmy(today)}. Los montos están en pesos (RD$). Los empleados aparecen solo por su número de empleado; no hay nombres ni datos que los identifiquen.${focus ? ` Rango de interés elegido al exportar: ${focus.label}.` : ''}`);
    out.push('');
    out.push('## 1. Contexto: cómo funcionan los préstamos y los cobros');
    out.push('');
    out.push([
        '- Es una empresa de construcción que presta dinero (o da adelantos) a sus empleados. El dinero se recupera **descontándolo de la nómina** del empleado.',
        periodLength ? `- **Nómina:** periodos de ${periodLength} días; el pago se hace ${payDayOffset} día(s) después de terminar el periodo. Periodo actual: ${(() => { const c = periods.find(p => p.start <= today && today <= p.end); return c ? `${dmy(c.start)} – ${dmy(c.end)}, se paga el ${dmy(c.payDate)}` : '—'; })()}.` : '- **Nómina:** no hay calendario de nómina configurado.',
        '- **Interés:** cada préstamo tiene una tasa fija (por ejemplo 10 % o 20 %) que se cobra **una sola vez sobre el capital** al prestar; no crece con el tiempo.',
        '- **Nómina de cobro:** cada préstamo indica en qué día de pago debe descontarse completo (capital + interés).',
        '- **Cómo se aplica un abono:** primero cubre el interés pendiente y después el capital.',
        '- **Refinanciamiento:** si en el día de pago no se cobra todo, lo que falta se pasa a la nómina siguiente y se cobra un interés adicional (la tasa sobre el saldo que quedaba). Por eso un préstamo refinanciado varias veces encarece la deuda.',
        `- **Vencido:** un cobro se considera atrasado ${VENCIDO_GRACE_DAYS} días después del día de pago si no se registró. Para medir el atraso se usa la nómina de cobro **original**: refinanciar mueve el cobro pero no borra el atraso.`,
        '- **Cierre de nómina:** cuando se cierra una nómina, los descuentos de préstamos quedan ligados a ese cierre y ya no se editan (solo se corrigen con ajustes).',
        '- **Empleados inactivos:** ya no cobran nómina, así que su deuda solo se recupera con abonos directos (efectivo o transferencia).',
        '- **Abono de nómina vs directo:** «nómina» = descontado del pago; «directo» = el empleado pagó aparte y se registró a mano.',
        '- **Anulados:** los préstamos anulados por error no cuentan en ninguna cifra.'
    ].join('\n'));
    const quality = [];
    if (notes.virtual) quality.push('- Los datos se leyeron como si ya se hubieran deshecho las consolidaciones (préstamos que se habían juntado en uno) y completado los datos viejos (números, nómina de cobro y origen de abonos inferidos). El origen nómina/directo de los abonos antiguos es una inferencia por la fecha.');
    if (notes.duplicates?.total) quality.push(`- Hay ${notes.duplicates.total} posibles registros repetidos sin revisar (pueden inflar lo cobrado o lo prestado).`);
    if (notes.review) quality.push(`- Hay ${notes.review} abonos con origen dudoso (cayeron fuera de los días de pago).`);
    const missing = usedPeriods.filter(p => p.payDate < today && p.payDate >= plusDays(today, -periodLength * 3))
        .filter(p => allLoans.some(l => l.dueDate === p.payDate) && !allLoans.some(l => (l.payments || []).some(x => !x.voided && isPayroll(x) && payrollPeriodOf(x, periods) === p)));
    for (const p of missing) quality.push(`- La nómina del ${dmy(p.payDate)} (periodo ${dmy(p.start)} – ${dmy(p.end)}) ya pasó y no tiene ningún descuento de préstamos registrado, aunque ${allLoans.filter(l => l.dueDate === p.payDate).length} préstamos vencían ese día. Probablemente esa nómina todavía no se registró en la app: esos préstamos pueden estar cobrados en realidad.`);
    // Periodos sin ninguna asistencia de nadie: faltan datos, no es que no trabajaran.
    const allEarn = [...earnings.values()].flat();
    const withData = allEarn.filter(x => x.gross > 0).map(x => x.start).sort()[0] || null;
    const noData = x => !withData || x.start < withData;
    if (allEarn.length && withData && allEarn.some(noData)) quality.push(`- No hay asistencia guardada en la app antes del ${dmy(withData)}: en esos periodos «Ganó» sale en $0 por falta de datos, no porque el empleado no trabajara.`);
    quality.push('- Cuando un abono y un refinanciamiento son del mismo día, el reparto entre interés y capital puede diferir un poco del real (el total no cambia).');
    out.push('');
    out.push('**Calidad de los datos (tenerlo en cuenta al analizar):**');
    out.push('');
    out.push(quality.join('\n'));

    // 2. Cartera hoy
    const s = summary;
    out.push('');
    out.push(`## 2. Cartera al ${dmy(today)}`);
    out.push('');
    out.push(table(['Cifra', 'Monto', 'Detalle'], [
        ['Por cobrar (lo que deben)', M(s.porCobrar.total), `capital ${M(s.porCobrar.capital)} + interés ${M(s.porCobrar.interest)}; ${s.porCobrar.people} empleados, ${s.porCobrar.loans} préstamos abiertos`],
        ['De eso, inactivos', M(s.porCobrar.inactive), `${s.porCobrar.inactivePeople} empleados que ya no cobran nómina`],
        ['Interés ganado (cobrado)', M(s.interesGanado.collected), `de ${M(s.interesGanado.total)} en total (ganado + por cobrar)`],
        ['Cobrado desde el inicio', M(s.cobrado.total), `capital ${M(s.cobrado.capital)}, interés ${M(s.cobrado.interest)}, pagado de más ${M(s.cobrado.excess)}; nómina ${M(s.cobrado.payroll)}, directo ${M(s.cobrado.direct)}; desde ${dmy(s.cobrado.since)}`],
        ['Prestado desde el inicio', M(s.prestado.total), `${s.prestado.loans} préstamos; ${PCT(s.prestado.pctReturned)} del capital ya devuelto; ${s.prestado.voided} anulados por error (${M(s.prestado.voidedAmount)}) no cuentan`]
    ]));
    if (focus?.preview) {
        const p = focus.preview;
        out.push('');
        out.push(`**Rango elegido (${focus.label}):** empezó en ${M(p.start)}, + ${M(p.newLoans)} en ${p.nLoans} préstamos nuevos con su interés, + ${M(p.refi)} de ${p.nRefi} refinanciamientos, − ${M(p.paid)} en ${p.nPays} abonos${p.closed > 0.004 ? `, − ${M(p.closed)} cerrados o ajustes` : ''}; terminó en ${M(p.end)}.`);
    }

    // 3. Historial por periodo y por mes
    const flowTable = (kind) => {
        const buckets = buildFlowBuckets(kind, { from: firstLoan, to: today, payPeriod });
        const flows = computeLoanFlows(allLoans, buckets);
        return table(
            [kind === 'period' ? 'Periodo' : 'Mes', 'Venía de antes', 'Capital prestado', 'Interés al prestar', 'Interés por refinanciar', 'Cobrado: interés', 'Cobrado: capital', 'Pagado de más', 'Saldo al cerrar', '% cobrado de lo que venía'],
            buckets.map(b => {
                const o = flows.get(b.key);
                const cur = b.start <= today && today <= b.end;
                return [`${kind === 'period' ? b.label : b.long}${cur ? ' (en curso)' : ''}`, M0(o.open), M0(o.newCap), M0(o.newInt), M0(o.refiInt + o.adjustUp), M0(o.payInt), M0(o.payCap), M0(o.excess), M0(o.end), o.open > 0.004 ? PCT((o.payInt + o.payCap) / o.open) : '—'];
            })
        );
    };
    out.push('');
    out.push('## 3. Historial');
    out.push('');
    out.push('«Venía de antes» + lo prestado + el interés − lo cobrado = «Saldo al cerrar». «% cobrado de lo que venía» puede pasar de 100 % si también se cobró algo prestado en el mismo periodo.');
    if (periodLength) {
        out.push('');
        out.push('### Por periodo de nómina');
        out.push('');
        out.push(flowTable('period'));
    }
    out.push('');
    out.push('### Por mes');
    out.push('');
    out.push(flowTable('month'));

    // 4. Descuentos de nómina por periodo (cierres)
    if (periodLength) {
        const rows = usedPeriods.map(p => {
            let total = 0, closed = 0, direct = 0;
            const who = new Set();
            const dueCount = allLoans.filter(l => l.dueDate === p.payDate).length;
            for (const e of employees) for (const l of (e.loans || []).filter(counted)) for (const x of l.payments || []) {
                if (x.voided || x.adjustment) continue;
                if (isPayroll(x) && payrollPeriodOf(x, periods) === p) { total += Number(x.amount || 0); who.add(e.id); if (x.payrollClosureId) closed += Number(x.amount || 0); }
                else if (!isPayroll(x) && x.date >= p.start && x.date <= p.end) direct += Number(x.amount || 0);
            }
            return [`${p.label}`, dmy(p.payDate), String(dueCount), M0(total), String(who.size), closed > 0.004 ? `sí (${M0(closed)})` : 'no', M0(direct)];
        });
        out.push('');
        out.push('## 4. Descuentos de nómina por periodo (cierres)');
        out.push('');
        out.push('«Préstamos que vencían» = préstamos cuya nómina de cobro original era ese día de pago. «En un cierre» = descuentos ligados a un cierre de nómina registrado en la app.');
        out.push('');
        out.push(table(['Periodo', 'Día de pago', 'Préstamos que vencían', 'Descontado en nómina', 'Empleados con descuento', 'En un cierre', 'Abonos directos en el periodo'], rows));
    }

    // 5. Antigüedad de la deuda hoy
    const payDates = periods.map(p => p.payDate);
    const age = { no: 0, one: 0, two: 0, more: 0 };
    for (const e of employees) {
        for (const item of getAccountSummary(e).loans) {
            const due = item.loan.dueDate;
            const n = due ? payDates.filter(d => d >= due && plusDays(d, VENCIDO_GRACE_DAYS) < today).length : 0;
            age[n === 0 ? 'no' : n === 1 ? 'one' : n === 2 ? 'two' : 'more'] += item.balance;
        }
    }
    out.push('');
    out.push('## 5. Antigüedad de la deuda hoy');
    out.push('');
    out.push('Cuántas nóminas pasaron (con el margen) desde la nómina de cobro original de cada préstamo abierto.');
    out.push('');
    out.push(table(['Situación', 'Saldo'], [['Todavía no le toca cobrarse', M(age.no)], ['1 nómina sin cobrar', M(age.one)], ['2 nóminas sin cobrar', M(age.two)], ['3 o más nóminas sin cobrar', M(age.more)]]));

    // 6. Riesgo
    out.push('');
    out.push('## 6. Empleados en riesgo (clasificación de la app)');
    out.push('');
    out.push('Reglas: se compara lo que debe con lo que gana en un periodo. Muy alto: inactivo con deuda, debe un sueldo o más, o le falta de nóminas anteriores la mitad de su sueldo o más. Alto: debe 60 % o más, le falta 25 % o más, o no pagó nada en el periodo y lo atrasado no bajó. Moderado: debe 35 % o más, o le queda algo atrasado. Baja un nivel si viene pagando y lo atrasado baja.');
    out.push('');
    out.push(risk.length ? table(['Empleado', 'Nivel', 'Debe', 'Sueldo de referencia por periodo', 'Por qué'], risk.map(r => [alias(r.emp), RISK_LEVELS[r.lvl], M0(r.bal), r.salary ? `${M0(r.salary.value)} (${r.salary.source})` : '—', [...r.why, ...r.ctx].join(' ').replace(/\|/g, '/')])) : '_Ningún empleado en riesgo._');

    // 7. Por empleado
    out.push('');
    out.push('## 7. Detalle por empleado');
    out.push('');
    out.push('Sueldo normal = lo que ganaría en un periodo completo trabajando su horario normal (según su puesto y días de trabajo). «Ganó» sale de la asistencia registrada. Si ganó bastante menos que lo normal, probablemente faltó; si ganó más y tiene horas extra, trabajó horas extra.');
    const riskBy = new Map(risk.map(r => [r.emp.id, r]));
    const people = employees.filter(e => (e.loans || []).some(counted))
        .map(e => ({ e, acc: getAccountSummary(e) }))
        .sort((a, b) => b.acc.balance - a.acc.balance || String(a.e.number).localeCompare(String(b.e.number), 'es', { numeric: true }));
    for (const { e, acc } of people) {
        const r = riskBy.get(e.id);
        out.push('');
        out.push(`### Empleado ${alias(e)} (${e.active === false ? 'inactivo' : 'activo'})`);
        out.push('');
        out.push(`- Debe ${M(acc.balance)} (capital ${M(acc.capital)}, interés ${M(acc.interest)}) en ${acc.count} préstamo(s) abierto(s). Riesgo: ${r ? RISK_LEVELS[r.lvl] : 'sin riesgo'}.`);
        const earn = earnings.get(e.id) || [];
        const normal = earn.find(x => x.expected > 0 && !x.partial)?.expected || 0;
        out.push(`- Sueldo normal por periodo: ${normal > 0 ? `≈${M0(normal)}` : 'no configurado'}.`);
        if (earn.length) {
            out.push('');
            out.push(table(['Periodo', 'Días', 'Horas normales', 'Horas extra', 'Ganó', 'Normal', 'Ganó vs normal', 'Lectura', 'Descontado de préstamos'],
                earn.map(x => noData(x)
                    ? [x.label, '—', '—', '—', '—', x.expected > 0 ? M0(x.expected) : '—', '—', 'sin datos de asistencia en la app', M0(x.deducted || 0)]
                    : [`${x.label}${x.partial ? ' (en curso)' : ''}`, String(x.days ?? '—'), String(round2(x.regularHours || 0)), String(round2(x.overtimeHours || 0)), M0(x.gross), x.expected > 0 ? M0(x.expected) : '—', x.expected > 0 ? PCT(x.gross / x.expected) : '—', earningReading(x), M0(x.deducted || 0)])));
        }
        const loanRows = (e.loans || []).filter(counted).sort((a, b) => String(a.startDate).localeCompare(String(b.startDate))).map(l => {
            const t = getActiveLoanTerms({ ...l, refinancings: [] });
            const refis = (l.refinancings || []).filter(x => !x.voided && !x.adjustment);
            const last = replayLoan(l).steps.at(-1);
            const bal = last ? round2(last.capitalAfter + last.interestAfter) : 0;
            return [l.number ? `#${l.number}` : '—', dmy(l.startDate), M0(t.principal), `${Number(t.interestRate || 0)} %`, M0(t.interestIncluded ? 0 : t.principal * t.interestRate / 100),
                refis.length ? `${refis.length} (${M0(refis.reduce((x, y) => x + Number(y.interestAmount || 0), 0))}): ${refis.map(x => dmy(x.date)).join(', ')}` : '—',
                dmy(l.dueDate), M0(getPaidAmount(l)), M0(bal), l.status === LOAN_STATUS.ACTIVE ? 'abierto' : 'saldado'];
        });
        out.push('');
        out.push(table(['Préstamo', 'Entregado', 'Capital', 'Tasa', 'Interés', 'Refinanciamientos (interés): fechas', 'Nómina de cobro original', 'Pagado', 'Saldo', 'Estado'], loanRows));
        const pays = (e.loans || []).filter(counted).flatMap(l => (l.payments || []).filter(x => !x.voided && !x.adjustment).map(x => ({ x, l })))
            .sort((a, b) => String(a.x.date).localeCompare(String(b.x.date)));
        if (pays.length) {
            out.push('');
            out.push(`Abonos: ${pays.map(({ x, l }) => `${dmy(x.date)} ${M0(x.amount)} ${isPayroll(x) ? 'nómina' : 'directo'}${x.payrollClosureId ? ' (cierre)' : ''}${l.number ? ` a #${l.number}` : ''}`).join('; ')}.`);
        }
    }

    out.push('');
    out.push('## 8. Qué pedirle a la IA (sugerencias)');
    out.push('');
    out.push([
        '- ¿La cartera está creciendo o bajando? ¿Se presta más rápido de lo que se cobra?',
        '- ¿Qué empleados deberían dejar de recibir préstamos por ahora y por qué?',
        '- Para cada empleado en riesgo alto o muy alto: ¿cuánto descontarle por nómina sin dejarlo sin sueldo (por ejemplo, máximo 30 % de su sueldo normal) y en cuántas nóminas saldaría?',
        '- ¿Hay empleados que faltan seguido y por eso no alcanzan a pagar? ¿O que hacen horas extra y podrían pagar más rápido?',
        '- ¿Qué tanto encarecen los refinanciamientos la deuda? ¿Conviene un acuerdo de pago fijo en lugar de refinanciar?',
        '- ¿Qué política de préstamos recomiendas (monto máximo según el sueldo, plazos, tasa)?'
    ].join('\n'));
    out.push('');
    return out.join('\n');
}
