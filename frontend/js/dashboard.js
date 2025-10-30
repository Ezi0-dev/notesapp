let notes = [];
let currentNoteId = null;

document.addEventListener('DOMContentLoaded', () => {
  // Check if user is logged in
  redirectIfNotAuthenticated();
  
  // Load user info and notes
  loadUserInfo();
  loadNotes();
  
  // Event listeners
  document.getElementById('newNoteBtn').addEventListener('click', openNewNoteModal);
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('cancelBtn').addEventListener('click', closeModal);
  document.getElementById('noteForm').addEventListener('submit', saveNote);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('searchInput').addEventListener('input', filterNotes);
  
  // Close modal on outside click
  document.getElementById('noteModal').addEventListener('click', (e) => {
    if (e.target.id === 'noteModal') {
      closeModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('noteModal').style.display === 'flex') {
      closeModal();
    }
  });
});

// Load user information from localStorage
async function loadUserInfo() {
  try {
    const user = JSON.parse(localStorage.getItem('user'));
    if (user) {
      const initials = user.username.substring(0, 2).toUpperCase();
      document.getElementById('dashboardAvatar').textContent = initials;
      document.getElementById('dashboardUsername').textContent = user.username;
    }
  } catch (error) {
    console.error('Error loading user info:', error);
  }
}

// Load all notes from API
async function loadNotes() {
  const spinner = document.getElementById('loadingSpinner');
  
  try {
    spinner.style.display = 'flex';
    
    // Call API - backend returns { notes: [...] }
    const data = await api.getNotes();
    notes = data.notes || [];
    
    displayNotes(notes);
    updateStatistics();
  } catch (error) {
    showError('noteError', 'Failed to load notes: ' + error.message);
    console.error('Load notes error:', error);
  } finally {
    spinner.style.display = 'none';
  }
}

// Display notes in the grid
function displayNotes(notesToDisplay) {
  const container = document.getElementById('notesContainer');
  const emptyState = document.getElementById('emptyState');
  
  if (notesToDisplay.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    emptyState.style.display = 'flex';
    return;
  }
  
  emptyState.style.display = 'none';
  container.style.display = 'grid';
  
  container.innerHTML = notesToDisplay.map(note => `
    <div class="note-card" data-id="${note.id}" onclick="viewNote('${note.id}')">
      <div class="note-header">
        <h3 class="note-title">${escapeHtml(note.title)}</h3>
        ${note.encrypted ? '<span class="note-badge">🔒 Encrypted</span>' : ''}
      </div>
      <div class="note-preview">${escapeHtml(note.content.substring(0, 150))}${note.content.length > 150 ? '...' : ''}</div>
      <div class="note-meta">
        <span class="note-date">${formatDate(note.updated_at)}</span>
      </div>
      <div class="note-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="editNote('${note.id}')" title="Edit Note">✏️</button>
        <button class="btn-icon btn-delete" onclick="deleteNote('${note.id}')" title="Delete Note">🗑️</button>
      </div>
    </div>
  `).join('');

  // Initialize Masonry after rendering
  setTimeout(() => {
    initMasonry();
  }, 100);
}

// Debounce function
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Filter notes based on search term
function filterNotes(e) {
  const searchTerm = e.target.value.toLowerCase();
  const filtered = notes.filter(note => 
    note.title.toLowerCase().includes(searchTerm) || 
    note.content.toLowerCase().includes(searchTerm)
  );
  displayNotes(filtered);
}

// Update statistics
function updateStatistics() {
  const totalNotes = notes.length;
  const encryptedNotes = notes.filter(note => note.encrypted).length;
  
  document.getElementById('totalNotes').textContent = totalNotes;
  document.getElementById('encryptedNotes').textContent = encryptedNotes;
}

// Open modal for new note
function openNewNoteModal() {
  currentNoteId = null;
  document.getElementById('modalTitle').textContent = 'New Note';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteContent').value = '';
  document.getElementById('noteEncrypted').checked = true;
  document.getElementById('noteError').style.display = 'none';
  document.getElementById('noteModal').style.display = 'flex';

  setModalMode('new');
  
  // Focus on title input
  setTimeout(() => {
    document.getElementById('noteTitle').focus();
  }, 100);
}

// Edit existing note
window.editNote = async function(id) {
  try {
    // Call API to get specific note - backend returns { note: {...} }
    const data = await api.getNote(id);
    const note = data.note;
    
    currentNoteId = note.id;
    document.getElementById('modalTitle').textContent = 'Edit Note';
    document.getElementById('noteTitle').value = note.title;
    document.getElementById('noteContent').value = note.content;
    document.getElementById('noteEncrypted').checked = note.encrypted;
    document.getElementById('noteError').style.display = 'none';
    document.getElementById('noteModal').style.display = 'flex';

    setModalMode('edit');
    
    // Focus on title input
    setTimeout(() => {
      document.getElementById('noteTitle').focus();
    }, 100);
  } catch (error) {
    showError('noteError', 'Failed to load note: ' + error.message);
    console.error('Edit note error:', error);
  }
};

// Delete note
async function deleteNote(id) {
  const confirmed = await showConfirm({
    icon: '🗑️',
    type: 'danger',
    title: 'Delete Note?',
    message: 'This action cannot be undone. Your note will be permanently deleted.',
    confirmText: 'Delete',
    cancelText: 'Keep Note'
  });

  if (!confirmed) return;
  
  try {
    await api.deleteNote(id);
    showToast({
      icon: '✓',
      type: 'success',
      title: 'Note Deleted',
      message: 'Your note has been permanently deleted'
    });
    await loadNotes();
  } catch (error) {
    showToast({
      icon: '✗',
      type: 'error',
      title: 'Delete Failed',
      message: error.message || 'Failed to delete note'
    });
  }
}

// Save note (create or update)
async function saveNote(e) {
  e.preventDefault();
  
  const title = document.getElementById('noteTitle').value.trim();
  const content = document.getElementById('noteContent').value.trim();
  const encrypted = document.getElementById('noteEncrypted').checked;
  
  if (!title || !content) {
    showError('noteError', 'Please fill in both title and content');
    return;
  }
  
  const saveBtn = document.getElementById('saveNoteBtn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  
  try {
    if (currentNoteId) {
      await api.updateNote(currentNoteId, title, content, encrypted);
      showToast({
        icon: '✓',
        type: 'success',
        title: 'Note Updated',
        message: 'Your changes have been saved'
      });
    } else {
      await api.createNote(title, content, encrypted);
      showToast({
        icon: '✓',
        type: 'success',
        title: 'Note Created',
        message: encrypted ? 'Your note is encrypted and secure' : 'Your note has been saved'
      });
    }
    
    closeModal();
    await loadNotes();
    
    // Hide success message after 3 seconds
    setTimeout(() => {
      hideMessage('successMessage');
    }, 3000);
    
  } catch (error) {
    showError('noteError', error.message);
    console.error('Save note error:', error);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save Note';
  }
}

// Close modal
function closeModal() {
  document.getElementById('noteModal').style.display = 'none';
  document.getElementById('noteError').style.display = 'none';
  currentNoteId = null;
}

// Logout
async function logout() {
  const confirmed = await showConfirm({
    icon: '👋',
    type: 'warning',
    title: 'Logout?',
    message: 'You will be logged out of your account. Your notes are safe and will be here when you return.',
    confirmText: 'Logout',
    cancelText: 'Stay'
  });

  if (!confirmed) return;
  
  try {
    await api.logout();
    showToast({
      icon: '👋',
      type: 'success',
      title: 'Logged Out',
      message: 'See you soon!'
    });
    
    // Wait for toast to show, then redirect
    setTimeout(() => {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      window.location.href = '/login.html';
    }, 1000);
  } catch (error) {
    console.error('Logout error:', error);
    // Logout locally even if API fails
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
  }
}

// Utility function: Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
  });
}

function setModalMode(mode) {
  const titleInput = document.getElementById('noteTitle');
  const contentInput = document.getElementById('noteContent');
  const encryptedInput = document.getElementById('noteEncrypted');
  const saveBtn = document.getElementById('saveNoteBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const editBtn = document.getElementById('editBtn'); // optional
  const encryptionContainer = document.getElementById('encryptionContainer');
  const modalContainer = document.getElementById('modalContainer');

  if (mode === 'view') {
    // Disable inputs
    if (titleInput) titleInput.readOnly = true;
    if (contentInput) contentInput.readOnly = true;
    if (encryptedInput) encryptedInput.disabled = true;

    // Hide Save/Cancel
    if (saveBtn) saveBtn.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
    if (encryptionContainer) encryptionContainer.style.display = 'none';
    if (modalContainer) modalContainer.style.display = 'none';

    // Show Edit button if it exists
    if (editBtn) editBtn.style.display = 'inline-flex';
  } else {
    // Enable inputs
    if (titleInput) titleInput.readOnly = false;
    if (contentInput) contentInput.readOnly = false;
    if (encryptedInput) encryptedInput.disabled = false;

    // Show Save/Cancel
    if (saveBtn) saveBtn.style.display = 'inline-flex';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
    if (encryptionContainer) encryptionContainer.style.display = 'inline-flex';
    if (modalContainer) modalContainer.style.display = 'inline-flex';

    // Hide Edit button if it exists
    if (editBtn) editBtn.style.display = 'none';
  }
}

window.viewNote = async function(id) {
  try {
    // 1. Fetch note from API
    const data = await api.getNote(id);
    const note = data.note; // ✅ fix: extract from response

    if (!note) {
      console.warn('Note not found');
      return;
    }

    // 2. Fill modal fields
    const titleInput = document.getElementById('noteTitle');
    const contentInput = document.getElementById('noteContent');
    const encryptedInput = document.getElementById('noteEncrypted');

    if (titleInput) titleInput.value = note.title || '(Untitled)';
    if (contentInput) contentInput.value = note.content || '(Empty note)';
    if (encryptedInput) encryptedInput.checked = note.encrypted || false;

    // 3. Set modal to view (read-only)
    setModalMode('view');

    // 4. Update modal header and show it
    document.getElementById('modalTitle').textContent = 'View Note';
    document.getElementById('noteModal').style.display = 'flex';

  } catch (err) {
    console.error('Failed to view note:', err);
    showError('noteError', 'Failed to load note: ' + err.message);
  }
}

// Masonry initialization
let masonryInstance = null;

function initMasonry() {
  const container = document.getElementById('notesContainer');
  
  if (masonryInstance) {
    masonryInstance.destroy();
  }
  
  masonryInstance = new Masonry(container, {
    itemSelector: '.note-card',
    columnWidth: '.note-card',
    percentPosition: true,
    gutter: 24,
    transitionDuration: '0.3s'
  });
}
