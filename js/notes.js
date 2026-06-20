'use strict';

let NOTES = [];
let noteTab = 'all';

async function fetchNotes() {
  try {
    const res = await apiFetch('/notes');
    NOTES = res.notes || [];
    renderNotes();
  } catch (e) { console.error('Failed to load notes', e); }
}

function switchNotesTab(tab, el) {
  noteTab = tab;
  document.querySelectorAll('#tab-notes .rtab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  renderNotes();
}

function renderNotes() {
  const el = document.getElementById('notes-list');
  if (!el) return;
  el.innerHTML = '';
  
  const list = noteTab === 'mine' ? NOTES.filter(n => n.author_uid === ME.uid) : NOTES.filter(n => n.is_public);
  
  if (list.length === 0) {
    el.innerHTML = `<div class="empty"><div>No notes found in this space.</div></div>`;
    return;
  }

  list.forEach(n => {
    const d = document.createElement('div');
    d.className = 'req-card'; // Reusing style for consistency
    d.style.cursor = 'pointer';
    const date = new Date(n.ts).toLocaleDateString();
    const isMine = n.author_uid === ME.uid;
    
    d.innerHTML = `
      <div class="av" style="${avStyle(n.author_uid, n.author_name || 'User', 36, .7)}">${initials(n.author_name || 'User')}</div>
      <div class="req-body">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="req-name">${escHtml(n.title)}</div>
            <div class="req-det">By ${n.author_name || 'Unknown'} · ${date}</div>
          </div>
          <div style="display:flex;gap:4px">
            ${n.is_public ? '<span class="pill g">Public</span>' : '<span class="pill m">Private</span>'}
            ${n.forks > 0 ? `<span class="pill b"><i class="ph ph-git-fork"></i> ${n.forks}</span>` : ''}
          </div>
        </div>
      </div>
    `;
    d.onclick = () => openViewNote(n.id);
    el.appendChild(d);
  });
}

function openNewNoteModal() {
  document.getElementById('mnote-id').value = '';
  document.getElementById('mnote-name').value = '';
  document.getElementById('mnote-content').value = '';
  document.getElementById('mnote-public').checked = false;
  document.getElementById('mnote-title').textContent = 'Create New Note';
  openOvl('modal-note');
}

async function openViewNote(id) {
  const n = NOTES.find(x => x.id === id);
  if (!n) return;

  document.getElementById('vnote-title').textContent = n.title;
  document.getElementById('vnote-meta').textContent = `By ${n.author_name} · Created ${new Date(n.ts).toLocaleDateString()}`;
  document.getElementById('vnote-content').textContent = n.content;

  const acts = document.getElementById('vnote-acts');
  acts.innerHTML = '';

  if (n.author_uid === ME.uid) {
    const editBtn = document.createElement('button');
    editBtn.className = 'btn-sm p';
    editBtn.innerHTML = '<i class="ph ph-pencil"></i> Edit';
    editBtn.onclick = () => { closeOvl('modal-view-note'); openEditNote(n); };
    acts.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn-sm d';
    delBtn.innerHTML = '<i class="ph ph-trash"></i> Delete';
    delBtn.onclick = () => deleteNote(n.id);
    acts.appendChild(delBtn);
  } else {
    const forkBtn = document.createElement('button');
    forkBtn.className = 'btn-sm b';
    forkBtn.innerHTML = '<i class="ph ph-git-fork"></i> Fork to My Notes';
    forkBtn.onclick = () => forkNote(n.id);
    acts.appendChild(forkBtn);
  }

  openOvl('modal-view-note');
}

function openEditNote(n) {
  document.getElementById('mnote-id').value = n.id;
  document.getElementById('mnote-name').value = n.title;
  document.getElementById('mnote-content').value = n.content;
  document.getElementById('mnote-public').checked = !!n.is_public;
  document.getElementById('mnote-title').textContent = 'Edit Note';
  openOvl('modal-note');
}

async function saveNote() {
  const id = document.getElementById('mnote-id').value;
  const title = document.getElementById('mnote-name').value;
  const content = document.getElementById('mnote-content').value;
  const is_public = document.getElementById('mnote-public').checked ? 1 : 0;

  if (!title) return toast('Please enter a title', 'er');

  try {
    if (id) {
      await apiFetch(`/notes/${id}`, { method: 'PATCH', body: { title, content, is_public } });
      toast('Note updated', 'ok');
    } else {
      await apiFetch('/notes', { method: 'POST', body: { title, content, is_public } });
      toast('Note created', 'ok');
    }
    closeOvl('modal-note');
    fetchNotes();
  } catch (e) { toast('Failed to save note', 'er'); }
}

async function forkNote(id) {
  try {
    await apiFetch(`/notes/${id}/fork`, { method: 'POST' });
    toast('Note forked to your collection!', 'ok');
    closeOvl('modal-view-note');
    fetchNotes();
  } catch (e) { toast('Failed to fork note', 'er'); }
}

async function deleteNote(id) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  try {
    await apiFetch(`/notes/${id}`, { method: 'DELETE' });
    toast('Note deleted', 'ok');
    closeOvl('modal-view-note');
    fetchNotes();
  } catch (e) { toast('Failed to delete note', 'er'); }
}
