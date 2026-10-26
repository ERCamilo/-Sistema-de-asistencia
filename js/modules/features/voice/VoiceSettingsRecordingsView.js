import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { formatCurrency } from '../../utils/Formatters.js';
import { voiceRecordingInfo, voiceBytes } from './VoiceSettingsData.js';
import { vsArrow, vsDate, vsIcon, vsIdentity, vsWave } from './VoiceSettingsViewUtils.js';

export function voiceExpiryText(expiresAt, now = Date.now()) {
    const hours = Math.ceil((expiresAt-now)/3600000);
    return hours <= 0 ? 'Audio vencido' : hours < 24 ? `Vence en ${hours} h` : `Vence en ${Math.ceil(hours/24)} días`;
}
export function VoiceSettingsRecordingsView(ui) {
    const infos = ui.recordingInfos(), available = infos.filter(row => row.available);
    const rows = infos.filter(row => ui.recordFilter === 'available' ? row.available : ui.recordFilter === 'soon' ? row.soon : !row.available);
    return `<div class="vs-storage"><div class="vs-storage-line"><strong>${ui.storage ? `${voiceBytes(ui.storage.bytes)} / 50 MiB` : 'Espacio sin consultar'}</strong><small>Archivo local</small></div>${ui.storage ? `<div class="vs-meter" role="meter" aria-label="Espacio del archivo local usado" aria-valuemin="0" aria-valuemax="50" aria-valuenow="${Math.min(50,ui.storage.bytes/1048576)}"><span style="width:${Math.min(100,ui.storage.bytes/52428800*100)}%"></span></div>` : ''}<p class="vs-help">Esta obra: ${available.length} audios · ${voiceBytes(available.reduce((sum,row)=>sum+row.bytes,0))}</p>${ui.storage?.low ? '<p class="vs-notice">Queda poco espacio para audios.</p>' : ''}</div><div class="vs-record-filters" role="group" aria-label="Filtrar grabaciones">${[['available','Disponibles'],['soon','Por vencer'],['unavailable','Sin audio']].map(([value,label])=>`<button type="button" class="vs-segment" data-vs-action="record-filter" data-value="${value}" aria-pressed="${ui.recordFilter===value}">${label}</button>`).join('')}</div>${rows.map(({record,available,soon,expiresAt,label})=>{
        const employee = ui.adapter.getEmployees().find(item=>String(item.id)===String(record.selectedEmployeeId)), loan = ui.loanFor(record);
        const who = employee?.name || (record.completedLoanId ? 'Grabación de préstamo' : 'Instrucción sin confirmar');
        return `<div class="vs-record-row"><button type="button" class="vs-record-main" data-vs-action="audio" data-value="${escapeAttr(record.requestId)}" ${available?'':'disabled'}><span class="vs-play-circle">${vsIcon(available?'play':'clock')}</span><span class="vs-record-copy"><strong>${escapeHTML(who)}</strong><small>${record.completedLoanId?'Préstamo'+(loan?` · ${formatCurrency(loan.principal)}`:''):'Borrador'} · ${escapeHTML(vsDate(record.createdAt,record.context?.timeZone))}</small></span></button><div class="vs-record-bottom"><span class="${soon?'vs-expires':''}">${available?voiceExpiryText(expiresAt):label}</span>${!record.completedLoanId&&available?'<span class="vs-draft-chip">Borrador</span>':!available&&record.completedLoanId?'<span>Préstamo conservado</span>':''}</div></div>`;
    }).join('')||'<p class="vs-empty">No hay audios en esta vista.</p>'}<button type="button" class="vs-link-row" data-vs-action="retention"><span>Conservar audios de préstamos</span><small>${ui.retentionText()}</small>${vsArrow()}</button>`;
}
export function VoiceSettingsAudioView(ui) {
    const record = ui.recording(), employee = ui.adapter.getEmployees().find(item=>String(item.id)===String(record.selectedEmployeeId)), loan=ui.loanFor(record);
    const info = voiceRecordingInfo(record, ui.adapter.getSettings());
    return `${employee?vsIdentity(ui,employee):'<span class="vs-draft-chip">'+(record.completedLoanId?'Grabación de préstamo':'Borrador sin confirmar')+'</span>'}<div class="vs-audio-summary"><strong>${loan?formatCurrency(loan.principal):'Instrucción'}</strong><small>${record.completedLoanId?'Préstamo registrado':'Pendiente'}</small></div><div class="vs-player">${vsWave()}<div class="vs-player-controls"><button type="button" class="vs-player-toggle" data-vs-action="play" aria-label="Reproducir audio" aria-pressed="false">${vsIcon('play')}</button><input type="range" data-vs-seek min="0" max="${Math.max(1,(record.durationMs||0)/1000)}" step=".1" value="0" aria-label="Posición del audio"><span class="vs-time" data-vs-time>0:00</span></div><audio data-vs-audio src="${escapeAttr(ui.audioURL||'')}" preload="metadata"></audio></div><p class="vs-audio-caption">${escapeHTML(record.transcript||record.result?.transcript||'')}<br>${escapeHTML(vsDate(record.createdAt,record.context?.timeZone))}</p><p class="vs-footnote" data-vs-expiry>${vsIcon('clock')}${voiceExpiryText(info.expiresAt)}</p>${loan?'<button type="button" class="vs-secondary-wide" data-vs-action="open-loan">Abrir préstamo '+vsIcon('arrow')+'</button>':''}`;
}
export function VoiceSettingsRetentionView(ui) {
    const policy=ui.policy();
    return `<p class="vs-help">Tiempo desde el registro del préstamo.</p><div class="vs-retention-grid">${[0,1,2,3,4,5].map(days=>`<button type="button" class="vs-choice" data-vs-action="retention-days" data-value="${days}" aria-pressed="${(policy.keep?policy.days:0)===days}" ${ui.busy?'disabled':''}><strong>${days||'No'}</strong><small>${days?days===1?'día':'días':'guardar'}</small></button>`).join('')}</div><p class="vs-help">Eliminar audio conserva el préstamo.<br>Los borradores duran hasta 24 horas.</p>`;
}
