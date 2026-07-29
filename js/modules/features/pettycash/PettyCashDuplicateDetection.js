function normalizeText(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function normalizeIdentifier(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function invoiceDate(movement) {
    const value = movement?.fechaEmision || movement?.date || '';
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

function providerName(movement) {
    return normalizeText(movement?.paidTo || movement?.description);
}

function amountInCents(movement) {
    const amount = Number(movement?.amount);
    return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function movementOrder(left, right) {
    const leftNumber = Number(left.movement.recordNumber);
    const rightNumber = Number(right.movement.recordNumber);
    const hasLeftNumber = Number.isInteger(leftNumber) && leftNumber > 0;
    const hasRightNumber = Number.isInteger(rightNumber) && rightNumber > 0;
    if (hasLeftNumber && hasRightNumber && leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
    }
    if (hasLeftNumber !== hasRightNumber) return hasLeftNumber ? -1 : 1;

    const leftCreated = Number(left.movement.createdAt);
    const rightCreated = Number(right.movement.createdAt);
    const hasLeftCreated = Number.isFinite(leftCreated) && leftCreated > 0;
    const hasRightCreated = Number.isFinite(rightCreated) && rightCreated > 0;
    if (hasLeftCreated && hasRightCreated && leftCreated !== rightCreated) {
        return leftCreated - rightCreated;
    }
    if (hasLeftCreated !== hasRightCreated) return hasLeftCreated ? -1 : 1;
    return left.index - right.index;
}

function hasSameIssuer(left, right) {
    const leftRnc = normalizeIdentifier(left.rncEmisor);
    const rightRnc = normalizeIdentifier(right.rncEmisor);
    if (leftRnc && rightRnc) return leftRnc === rightRnc;

    const leftProvider = providerName(left);
    const rightProvider = providerName(right);
    return Boolean(leftProvider && rightProvider && leftProvider === rightProvider);
}

function isExactDuplicate(left, right) {
    const leftNcf = normalizeIdentifier(left.ncf);
    const rightNcf = normalizeIdentifier(right.ncf);
    return Boolean(leftNcf && rightNcf && leftNcf === rightNcf && hasSameIssuer(left, right));
}

function isPossibleDuplicate(left, right) {
    const leftDate = invoiceDate(left);
    const rightDate = invoiceDate(right);
    const leftProvider = providerName(left);
    const rightProvider = providerName(right);
    const leftAmount = amountInCents(left);
    const rightAmount = amountInCents(right);
    return Boolean(
        leftDate
        && leftDate === rightDate
        && leftProvider
        && leftProvider === rightProvider
        && leftAmount !== null
        && leftAmount === rightAmount
    );
}

function findingFor(movement, reference, confidence, periodLabels) {
    return {
        movementId: movement.id,
        referenceId: reference.id,
        confidence,
        referenceNumber: reference.recordNumber,
        referencePeriodId: reference.periodId || null,
        referencePeriodLabel: periodLabels.get(reference.periodId) || 'Periodo sin nombre',
        reason: confidence === 'exact'
            ? 'Mismo comprobante fiscal y emisor'
            : 'Misma fecha, proveedor y monto'
    };
}

export function normalizeDuplicateText(value) {
    return normalizeText(value);
}

/**
 * Detecta candidatos duplicados sin modificar ni bloquear los movimientos.
 * Cada registro posterior se enlaza con el registro canónico más antiguo.
 */
export function detectPettyCashDuplicates(movements = [], periods = []) {
    const periodLabels = new Map(
        (Array.isArray(periods) ? periods : []).map((period) => [period.id, period.label])
    );
    const byProject = new Map();

    (Array.isArray(movements) ? movements : []).forEach((movement, index) => {
        if (!movement?.id || !movement.projectId || movement.type !== 'gasto') return;
        if (!byProject.has(movement.projectId)) byProject.set(movement.projectId, []);
        byProject.get(movement.projectId).push({ movement, index });
    });

    const findings = [];
    byProject.forEach((items) => {
        const ordered = items.slice().sort(movementOrder).map((item) => item.movement);
        ordered.forEach((movement, index) => {
            const previous = ordered.slice(0, index);
            const exact = previous.find((candidate) => isExactDuplicate(movement, candidate));
            if (exact) {
                findings.push(findingFor(movement, exact, 'exact', periodLabels));
                return;
            }
            const possible = previous.find((candidate) => isPossibleDuplicate(movement, candidate));
            if (possible) {
                findings.push(findingFor(movement, possible, 'possible', periodLabels));
            }
        });
    });

    return findings;
}
