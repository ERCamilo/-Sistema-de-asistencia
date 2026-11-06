import { attachProjectDialogA11y } from './ProjectDialogA11y.js';

const paths = {
 close: '<path d="M8 5v14M16 5v14"/>',
 reopen: '<path d="m9 5 11 7-11 7z"/>',
 archive: '<path d="M4 8h16v12H4zM3 4h18v4H3zM9 12h6"/>',
 unarchive: '<path d="M4 10v10h16V10M8 7l4-4 4 4M12 3v12"/>',
 request: '<path d="M8 4h8M5 8h14M7 8l1 13h8l1-13M10 12v5M14 12v5"/>',
 cancel: '<path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12"/>',
 delete: '<path d="M8 4h8M5 8h14M7 8l1 13h8l1-13M10 12v5M14 12v5"/>',
 impact: '<path d="M12 9v4M12 17h.01M12 3 2 21h20z"/>'
};
export const PROJECT_ACTION_COPY = Object.freeze({
 close: { title: '¿Pausar esta obra?', text: 'La obra deja de estar disponible para trabajar. Sus datos se conservan; puedes reactivarla cuando quieras.', confirm: 'Pausar obra' },
 reopen: { title: '¿Reactivar esta obra?', text: 'Volverás a poder seleccionarla y trabajar con sus datos. Su historial se conserva.', confirm: 'Reactivar obra' },
 archive: { title: '¿Archivar esta obra?', text: 'Pasará a Archivadas y seguirá sin estar disponible para trabajar. Sus datos se conservan; puedes sacarla del archivo.', confirm: 'Archivar obra' },
 unarchive: { title: '¿Sacar esta obra del archivo?', text: 'Volverá a Pausadas. Sus datos se conservan; tendrás que reactivarla para trabajar.', confirm: 'Sacar del archivo' },
 request: { title: '¿Solicitar eliminación?', text: 'No se borrará ahora. Tendrás otros 30 días para cancelar. La eliminación con historial seguirá bloqueada.', confirm: 'Solicitar eliminación' },
 cancel: { title: '¿Cancelar la eliminación?', text: 'Se retirará la solicitud. La obra seguirá pausada o archivada y conservará todos sus datos.', confirm: 'Cancelar solicitud' },
 delete: { title: '¿Retirar esta obra vacía?', text: 'Se retirará del catálogo. No se borran datos de otras obras; se conserva el registro de su baja para sincronizar.', confirm: 'Retirar obra vacía' },
 impact: { title: 'Eliminación con historial bloqueada', text: 'Esta obra conserva historial y relaciones. El borrado definitivo con datos está deshabilitado. Puedes pausarla o archivarla sin perder su historial.', confirm: 'Entendido' }
});
export function projectActionIcon(action) {
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[action] || paths.impact) + '</svg>';
}
/** Resolve false for every dismissal. Data writes always remain in the caller. */
export function confirmProjectAction(action, project, { details = '' } = {}) {
 const copy = PROJECT_ACTION_COPY[action];
 if (!copy) return Promise.resolve(false);
 const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
 return new Promise(resolve => {
  const overlay = document.createElement('div');
  overlay.className = 'project-shell-overlay project-action-overlay';
  overlay.innerHTML = '<section class="project-shell project-action-dialog" role="dialog" aria-modal="true" aria-labelledby="project-action-title" aria-describedby="project-action-description">'
   + '<div class="project-action-symbol" data-action="' + action + '">' + projectActionIcon(action) + '</div>'
   + '<h2 id="project-action-title">' + copy.title + '</h2><p class="project-action-name">' + esc(project?.name) + '</p>'
   + '<p id="project-action-description">' + copy.text + '</p>' + details
   + '<div class="project-actions">' + (action === 'impact' ? '' : '<button type="button" class="project-action is-secondary" data-project-action-cancel>Volver</button>')
   + '<button type="button" class="project-action ' + (['request','delete'].includes(action) ? 'is-danger' : 'is-primary') + '" data-project-action-confirm>' + copy.confirm + '</button></div></section>';
  document.body.appendChild(overlay);
  let detach, done = false;
  const close = value => { if (done) return; done = true; detach?.(); overlay.remove(); resolve(value); };
  detach = attachProjectDialogA11y(overlay, { onEscape: () => close(false) });
  overlay.querySelector('[data-project-action-cancel]')?.addEventListener('click', () => close(false));
  overlay.querySelector('[data-project-action-confirm]').addEventListener('click', () => close(true));
  overlay.addEventListener('click', event => { if (event.target === overlay) close(false); });
 });
}
