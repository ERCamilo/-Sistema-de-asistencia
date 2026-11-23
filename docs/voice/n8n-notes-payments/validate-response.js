const r = $input.first().json || {};
const requestId = $('Validar entrada').first().json.requestId ?? null;
const fail = (statusCode, code, message, retryable=false) => [{json:{valid:false,statusCode,body:{ok:false,schemaVersion:1,requestId,error:{code,message,retryable}}}}];
const status = Number(r.statusCode ?? 200);
if (status === 429) return fail(429,'RATE_LIMITED','El proveedor limitó la solicitud.',true);
if (status >= 500 || status < 200) return fail(502,'PROVIDER_ERROR','El proveedor no pudo procesar el audio.',true);
const payload = r.body && typeof r.body === 'object' ? r.body : r;
const text = payload?.candidates?.[0]?.content?.parts?.find(p => typeof p.text === 'string')?.text;
if (typeof text !== 'string' || !text.trim()) return fail(502,'INVALID_PROVIDER_RESPONSE','La respuesta del proveedor no contiene JSON.');
let d;
try { d = JSON.parse(text); } catch (_) { return fail(502,'INVALID_PROVIDER_RESPONSE','La respuesta del proveedor no es JSON válido.'); }
const top = ['transcript','intent','employee','loan','pettyCash','extracted','note','payment','needsReview','issues','evidence'];
if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(k => !top.includes(k))) return fail(502,'INVALID_PROVIDER_RESPONSE','La respuesta no cumple el esquema v1.');
const intents = new Set(['buscar_empleado','crear_prestamo','abrir_asistencia','abrir_prestamos','desconocida','registrar_gasto_caja_chica','crear_nota','registrar_abono']);
if (typeof d.transcript !== 'string' || d.transcript.length > 16000 || !intents.has(d.intent) || typeof d.employee !== 'object' || d.employee === null || typeof d.needsReview !== 'boolean' || !Array.isArray(d.issues) || typeof d.evidence !== 'object' || d.evidence === null || !Object.prototype.hasOwnProperty.call(d, 'pettyCash')) return fail(502,'INVALID_PROVIDER_RESPONSE','La respuesta no cumple los tipos obligatorios.');
if (!(d.loan === null || (typeof d.loan === 'object' && !Array.isArray(d.loan)))) return fail(502,'INVALID_PROVIDER_RESPONSE','loan debe ser objeto o null.');
const finiteOrNull = v => v === null || (typeof v === 'number' && Number.isFinite(v));
if (!['spokenName','spokenNumber'].every(k => d.employee[k] === null || typeof d.employee[k] === 'string') || Object.keys(d.employee).some(k => !['spokenName','spokenNumber'].includes(k))) return fail(502,'INVALID_PROVIDER_RESPONSE','employee contiene tipos o campos inválidos.');
if (d.intent === 'registrar_gasto_caja_chica' && (d.employee.spokenName !== null || d.employee.spokenNumber !== null)) return fail(502,'INVALID_PROVIDER_RESPONSE','employee.spokenName y employee.spokenNumber deben ser null para registrar_gasto_caja_chica.');
//const cajaChicaPhrase = /\bcaja[\s-]+chica\b/i;
//if (d.intent === 'registrar_gasto_caja_chica' && !cajaChicaPhrase.test(d.transcript)) return fail(502,'INVALID_PROVIDER_RESPONSE','registrar_gasto_caja_chica requiere la frase explícita caja chica en transcript.');
if (!(d.pettyCash === null || (typeof d.pettyCash === 'object' && !Array.isArray(d.pettyCash)))) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash debe ser objeto o null.');
if (d.pettyCash) { const pk=['amount','concept','date','note','spokenCategory','paidTo']; if (Object.keys(d.pettyCash).some(k=>!pk.includes(k)) || pk.some(k=>!(k in d.pettyCash))) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash no cumple el esquema.'); if (!(d.pettyCash.amount === null || (typeof d.pettyCash.amount === 'number' && Number.isFinite(d.pettyCash.amount)))) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash.amount debe ser finito o null.'); if (!pk.filter(k=>k!=='amount').every(k=>d.pettyCash[k] === null || typeof d.pettyCash[k] === 'string')) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash contiene tipos inválidos.'); const dm = d.pettyCash.date === null ? null : String(d.pettyCash.date).match(/^(\d{4})-(\d{2})-(\d{2})$/); const dt = dm ? new Date(Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]))) : null; if (!(d.pettyCash.date === null || (dm && dt.getUTCFullYear() === Number(dm[1]) && dt.getUTCMonth() === Number(dm[2]) - 1 && dt.getUTCDate() === Number(dm[3])))) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash.date debe ser YYYY-MM-DD o null.'); }
if (d.intent === 'registrar_gasto_caja_chica' && d.pettyCash === null) return fail(502,'INVALID_PROVIDER_RESPONSE','registrar_gasto_caja_chica requiere pettyCash.');
if (d.intent === 'registrar_gasto_caja_chica' && d.loan !== null) return fail(502,'INVALID_PROVIDER_RESPONSE','loan debe ser null para registrar_gasto_caja_chica.');
if (d.intent !== 'registrar_gasto_caja_chica' && d.pettyCash !== null) return fail(502,'INVALID_PROVIDER_RESPONSE','pettyCash debe ser null para otros intents.');
const eKeys=['amount','spokenName','spokenNumber','concept','note','date','paidTo','spokenCategory'];
if (!(d.extracted === null || (typeof d.extracted === 'object' && !Array.isArray(d.extracted)))) return fail(502,'INVALID_PROVIDER_RESPONSE','extracted debe ser objeto o null.');
if (d.extracted) { if (Object.keys(d.extracted).some(k=>!eKeys.includes(k)) || eKeys.some(k=>!(k in d.extracted))) return fail(502,'INVALID_PROVIDER_RESPONSE','extracted no cumple el esquema.');
 if (!(d.extracted.amount === null || (typeof d.extracted.amount === 'number' && Number.isFinite(d.extracted.amount)))) return fail(502,'INVALID_PROVIDER_RESPONSE','extracted.amount debe ser número finito o null.');
 if (!eKeys.filter(k=>k!=='amount').every(k=>d.extracted[k] === null || typeof d.extracted[k] === 'string')) return fail(502,'INVALID_PROVIDER_RESPONSE','extracted contiene tipos inválidos.');
 const em = d.extracted.date === null ? null : String(d.extracted.date).match(/^(\d{4})-(\d{2})-(\d{2})$/); const edt = em ? new Date(Date.UTC(Number(em[1]), Number(em[2]) - 1, Number(em[3]))) : null;
 if (!(d.extracted.date === null || (em && edt.getUTCFullYear() === Number(em[1]) && edt.getUTCMonth() === Number(em[2]) - 1 && edt.getUTCDate() === Number(em[3])))) return fail(502,'INVALID_PROVIDER_RESPONSE','extracted.date debe ser YYYY-MM-DD o null.'); }

if (d.loan) { const lk=['principal','interestRate','interestIncluded','installmentMode','installmentCount','installmentFrequencyWeeks','startDate','concept']; if (Object.keys(d.loan).some(k=>!lk.includes(k)) || lk.some(k=>!(k in d.loan))) return fail(502,'INVALID_PROVIDER_RESPONSE','loan no cumple el esquema.'); if (!['principal','interestRate','installmentCount','installmentFrequencyWeeks'].every(k=>finiteOrNull(d.loan[k]))) return fail(502,'INVALID_PROVIDER_RESPONSE','loan contiene números inválidos.'); if (!(d.loan.interestIncluded === null || typeof d.loan.interestIncluded === 'boolean') || !(d.loan.installmentMode === null || ['lump','installments'].includes(d.loan.installmentMode)) || !(d.loan.startDate === null || typeof d.loan.startDate === 'string') || !(d.loan.concept === null || typeof d.loan.concept === 'string')) return fail(502,'INVALID_PROVIDER_RESPONSE','loan contiene valores inválidos.'); }
const ek=['employee','principal','interestRate','installmentCount','installmentFrequencyWeeks'];
if (Object.keys(d.evidence).some(k=>!ek.includes(k)) || ek.some(k=>!(k in d.evidence)) || ek.some(k=>!(d.evidence[k] === null || typeof d.evidence[k] === 'string'))) return fail(502,'INVALID_PROVIDER_RESPONSE','evidence no cumple el esquema.');
for (const i of d.issues) if (!i || typeof i !== 'object' || Object.keys(i).some(k=>!['code','field','message'].includes(k)) || typeof i.code !== 'string' || !(i.field === null || typeof i.field === 'string') || typeof i.message !== 'string') return fail(502,'INVALID_PROVIDER_RESPONSE','issues no cumple el esquema.');
if (d.intent === 'crear_prestamo' && d.loan === null) return fail(502,'INVALID_PROVIDER_RESPONSE','crear_prestamo requiere loan.');
// Validate object keys, never reject words like “saldo” inside the dictated note.
const validDate = value => {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
 const date = new Date(value + 'T12:00:00Z');
 return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
};
for (const [key, fields] of Object.entries({note:['text','date'],payment:['amount','date','note','spokenLoanNumber','channel','payrollDate']})) {
 const obj = d[key];
 if (obj == null) {
   if (d.intent === (key === 'note' ? 'crear_nota' : 'registrar_abono')) return fail(502,'INVALID_PROVIDER_RESPONSE',key+' es obligatorio para esta acción.');
   continue;
 }
 if (typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).some(k=>!fields.includes(k)) || fields.some(k=>!(k in obj))) return fail(502,'INVALID_PROVIDER_RESPONSE',key+' no cumple el esquema.');
 for (const field of fields) {
   const v = obj[field];
   if (field === 'amount' ? !finiteOrNull(v) : !(v === null || typeof v === 'string' && v.length <= 2000)) return fail(502,'INVALID_PROVIDER_RESPONSE',key+'.'+field+' tiene un tipo inválido.');
   if (['date','payrollDate'].includes(field) && v !== null && !validDate(v)) return fail(502,'INVALID_PROVIDER_RESPONSE','Fecha inválida.');
   if (field === 'channel' && ![null,'payroll','cash','transfer'].includes(v)) return fail(502,'INVALID_PROVIDER_RESPONSE','Forma de pago inválida.');
 }
 if (d.intent !== (key === 'note' ? 'crear_nota' : 'registrar_abono')) return fail(502,'INVALID_PROVIDER_RESPONSE',key+' debe ser null para otras acciones.');
}
if (['crear_nota','registrar_abono'].includes(d.intent) && (d.loan !== null || d.pettyCash !== null)) return fail(502,'INVALID_PROVIDER_RESPONSE','No mezcles acciones en el borrador.');
if (d.issues.length > 50 || [d.employee,d.loan,d.pettyCash,d.extracted,d.evidence].filter(Boolean).some(o=>Object.values(o).some(v=>typeof v==='string' && v.length>2000))) return fail(502,'INVALID_PROVIDER_RESPONSE','La respuesta supera los límites de texto.');
return [{json:{valid:true,statusCode:200,body:{ok:true,schemaVersion:1,requestId,result:{transcript:d.transcript,intent:d.intent,employee:{spokenName:d.employee.spokenName ?? null,spokenNumber:d.employee.spokenNumber ?? null},loan:d.loan,pettyCash:d.pettyCash,note:d.note ?? null,payment:d.payment ?? null,extracted:d.extracted ?? null,needsReview:d.needsReview,issues:d.issues,evidence:d.evidence}}}}];
