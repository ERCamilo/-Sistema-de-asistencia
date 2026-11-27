import { state } from '../../core/AppState.js';
import { formatDateShort } from '../../utils/DateUtils.js';
import { escapeHTML, escapeAttr } from '../../utils/Sanitize.js';
import { notesCenterView } from './NotesController.js';
import { filterNotesCards, notesEmployees, readNotesCards } from './NotesCenterModel.js';

const button = (text, fn, arg = '', extra = '') =>
    `<button type="button" data-app-fn="${fn}" data-arg="${escapeAttr(arg)}" ${extra}>${text}</button>`;
const cardAction = (card, label, action, extra = '') =>
    button(label, 'actOnNoteCard', card.key, `data-arg2="${action}" ${extra}`);

function employeeName(employee) {
    return escapeHTML(employee.name || 'Empleado') + (employee.number ? ` · #${escapeHTML(employee.number)}` : '');
}

function menu(card) {
    const actions = card.folder === 'trash' ? cardAction(card, 'Restaurar', 'restore') : [
        card.folder === 'active' ? cardAction(card, card.pinned ? 'Desfijar' : 'Fijar', 'pin') : '',
        cardAction(card, 'Editar', 'edit'),
        card.folder === 'active' ? cardAction(card, 'Archivar', 'archive') : cardAction(card, 'Volver a Notas', 'restore'),
        cardAction(card, 'Enviar a papelera', 'trash')
    ].join('');
    return `<details class="notes-center__menu"><summary aria-label="Opciones de la nota">⋯</summary><div>${actions}</div></details>`;
}

function noteCard(card) {
    const active = card.folder === 'active';
    const date = escapeHTML(formatDateShort(card.record.date));
    const body = `<span class="notes-center__meta">${card.pinned ? '<span class="notes-center__pin">Fijada</span>' : ''}<time datetime="${escapeAttr(card.record.date)}">${date}</time></span>
        <strong>${employeeName(card.employee)}</strong>
        <span class="notes-center__excerpt">${escapeHTML(card.record.notes)}</span>`;
    return `<article class="notes-center__row" ${active ? 'data-note-swipe' : ''}>
        <div class="notes-center__card">${cardAction(card, body, 'open', 'class="notes-center__card-open"')}${menu(card)}</div>
        ${active ? cardAction(card, 'Archivar', 'archive', 'class="notes-center__swipe-action" hidden') : ''}
    </article>`;
}

export function NotesCenter() {
    if (!state.showNotesCenter) return '';
    const view = notesCenterView();
    const cards = readNotesCards(state);
    const selected = cards.find(card => card.key === view.selected);
    const folderNames = { active: 'Notas', archive: 'Archivo', trash: 'Papelera' };
    const title = selected ? 'Nota' : view.choosing ? 'Nueva nota' : folderNames[view.folder];
    const inList = !selected && !view.choosing;
    const employeeId = state.notesCenterEmployeeId;
    const filtered = filterNotesCards(cards, { ...view, employeeId });
    const employees = view.choosing ? notesEmployees(state).sort((a, b) =>
        String(a.number || '').localeCompare(String(b.number || ''), 'es', { numeric: true })) : [];
    let body;
    if (selected) {
        body = `<article class="notes-center__detail">
            <div class="notes-center__meta">${escapeHTML(formatDateShort(selected.record.date))}${selected.pinned ? ' · Fijada' : ''}</div>
            <h2>${employeeName(selected.employee)}</h2><p>${escapeHTML(selected.record.notes)}</p>
        </article>`;
    } else if (view.choosing) {
        body = `<div class="notes-center__employees">${employees.map(employee =>
            button(employeeName(employee), 'notesCreateForEmployee', employee.id)).join('') || '<p>No hay empleados en esta obra.</p>'}</div>`;
    } else {
        body = (filtered.map(noteCard).join('') || '<p class="notes-center__empty">No hay notas en el historial cargado.</p>') +
            button('Cargar historial de notas', 'loadNotesHistory', '', 'class="notes-center__history"');
    }
    return `<div class="modal-overlay notes-center" role="dialog" aria-modal="true" aria-labelledby="notes-center-title">
        <section class="notes-center__shell">
            <header class="notes-center__header">
                ${inList ? '' : button('‹', 'notesBackToInbox', '', 'aria-label="Volver a la lista"')}
                <h1 id="notes-center-title">${title}</h1>
                ${selected ? menu(selected) : ''}
                ${inList ? button('⌕', 'notesToggleSearch', '', 'aria-label="Buscar notas"') : ''}
                ${button('×', 'closeNotesCenter', '', 'aria-label="Cerrar notas"')}
            </header>
            ${inList ? `<nav class="notes-center__filters" aria-label="Carpetas">
                ${Object.entries(folderNames).map(([folder, label]) => button(label, 'notesChooseFolder', folder, `aria-pressed="${folder === view.folder}"`)).join('')}
                ${employeeId ? button('Todos los empleados', 'backToNotesList') : ''}
            </nav>` : ''}
            ${inList && view.searching ? `<label class="notes-center__search"><span>Buscar notas</span><input id="notes-search" type="search" autocomplete="off" placeholder="Nombre, número o texto" value="${escapeAttr(view.search)}" oninput="notesChangeSearch(this.value)"></label>` : ''}
            <div class="notes-center__body">${body}</div>
            ${inList && view.folder === 'active' ? `<footer class="notes-center__footer">${button('+ Nueva nota', 'notesChooseEmployee', '', 'class="notes-center__primary"')}</footer>` : ''}
            ${view.undo ? `<aside class="notes-center__feedback"><span role="status">${view.undo.message}</span>${button('Deshacer', 'undoNoteCard')}${button('×', 'notesDismissFeedback', '', 'aria-label="Cerrar aviso"')}</aside>` : ''}
        </section>
    </div>`;
}
