/** Accept decimal comma/point and consistently grouped thousands; never strip punctuation blindly. */
export function parsePayrollLoanAmount(value) {
    const text = String(value ?? '').trim();
    let normalized;
    if (/^\d+(?:[.,]\d{1,2})?$/.test(text)) normalized = text.replace(',', '.');
    else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(text)) normalized = text.replace(/,/g, '');
    else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
    else return null;
    const amount = Number(normalized);
    return amount > 0 && Number.isSafeInteger(Math.round(amount * 100)) ? amount : null;
}
