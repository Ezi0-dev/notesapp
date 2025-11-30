let notes = [];
let sharednotes = [];
let currentNoteId = null;

document.addEventListener("DOMContentLoaded", () => {
  // Check if user is logged in
  redirectIfNotAuthenticated();

  // Load user info and notes
  loadUserInfo();
  loadNotes();

  // Event listeners
  document
    .getElementById("newNoteBtn")
    .addEventListener("click", openNewNoteModal);
  document.getElementById("closeModal").addEventListener("click", closeModal);
  document.getElementById("cancelBtn").addEventListener("click", closeModal);
  document.getElementById("noteForm").addEventListener("submit", saveNote);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("searchInput").addEventListener("input", filterNotes);

  // Share modal event listeners
  document.getElementById("closeShareModal").addEventListener("click", closeShareModal);
  document.getElementById("cancelShareBtn").addEventListener("click", closeShareModal);
  document.getElementById("shareForm").addEventListener("submit", (e) => {
    e.preventDefault();
    confirmShare();
  });

  // Manage shares modal event listeners
  document.getElementById("closeManageSharesModal").addEventListener("click", closeManageSharesModal);

  // Close modal on outside click
  document.getElementById("noteModal").addEventListener("click", (e) => {
    if (e.target.id === "noteModal") {
      closeModal();
    }
  });

  document.getElementById("shareModal").addEventListener("click", (e) => {
    if (e.target.id === "shareModal") {
      closeShareModal();
    }
  });

  document.getElementById("manageSharesModal").addEventListener("click", (e) => {
    if (e.target.id === "manageSharesModal") {
      closeManageSharesModal();
    }
  });

  // Close modal on Escape key
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.getElementById("noteModal").style.display === "flex") {
        closeModal();
      } else if (document.getElementById("shareModal").style.display === "flex") {
        closeShareModal();
      } else if (document.getElementById("manageSharesModal").style.display === "flex") {
        closeManageSharesModal();
      }
    }
  });
});

// Load user information from localStorage and fetch latest profile data
async function loadUserInfo() {
  try {
    // Get user from localStorage first for immediate display
    const storedUser = JSON.parse(localStorage.getItem("user"));
    if (storedUser) {
      document.getElementById("dashboardUsername").textContent = storedUser.username;

      // Set initial avatar (initials or stored profile picture)
      updateAvatarDisplay(storedUser.profilePicture, storedUser.username);
    }

    // Fetch latest profile data from API to ensure we have the most current profile picture
    const response = await api.getProfile();
    if (response && response.user) {
      const user = response.user;

      // Update localStorage with latest data
      const updatedUser = {
        id: user.id,
        username: user.username,
        email: user.email,
        profilePicture: user.profile_picture
      };
      localStorage.setItem("user", JSON.stringify(updatedUser));

      // Update avatar display with latest profile picture
      updateAvatarDisplay(user.profile_picture, user.username);
      document.getElementById("dashboardUsername").textContent = user.username;
    }
  } catch (error) {
    console.error("Error loading user info:", error);
  }
}

// Update avatar display with profile picture or initials
function updateAvatarDisplay(profilePicture, username) {
  const avatarElement = document.getElementById("dashboardAvatar");

  if (profilePicture) {
    // Display profile picture
    avatarElement.innerHTML = `<img src="${getUserAvatarUrl(profilePicture, username)}" alt="${escapeHtml(username)}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
  } else {
    // Display initials as fallback
    const initials = getUserInitials(username);
    avatarElement.textContent = initials;
    avatarElement.style.backgroundImage = 'none';
  }
}

// Load all notes from API
async function loadNotes() {
  const spinner = document.getElementById("loadingSpinner");

  try {
    spinner.style.display = "flex";

    // Fetch both owned and shared notes in parallel
    const [ownedData, sharedData] = await Promise.all([
      api.getNotes(),
      api.getSharedWithMe(),
    ]);

    notes = [
      ...(ownedData.notes || []),
      ...(sharedData.notes || []).map((note) => ({ ...note, isShared: true })),
    ];

    displayNotes(notes);
    updateStatistics();
  } catch (error) {
    showError("noteError", "Failed to load notes: " + error.message);
    console.error("Load notes error:", error);
  } finally {
    spinner.style.display = "none";
  }
}

// Display notes in the grid
function displayNotes(notesToDisplay) {
  const container = document.getElementById("notesContainer");
  const emptyState = document.getElementById("emptyState");

  if (notesToDisplay.length === 0) {
    container.innerHTML = "";
    container.style.display = "none";
    emptyState.style.display = "flex";
    return;
  }

  emptyState.style.display = "none";
  container.style.display = "grid";

  container.innerHTML = notesToDisplay
    .map(
      (note) => `
    <div class="note-card" data-id="${note.id}" onclick="viewNote('${
        note.id
      }')">
      <div class="note-header">
        <h3 class="note-title">${escapeHtml(note.title)}</h3>
        <div class="note-badges">
          ${
            note.encrypted ? '<span class="note-badge">🔒 Encrypted</span>' : ""
          }
          ${
            note.isShared
              ? `
            <span class="note-badge shared">📤 Shared by ${escapeHtml(
              note.owner_username
            )}</span>
            <span class="note-badge ${
              note.permission === "write" ? "write" : "read"
            }">
              ${note.permission === "write" ? "✏️ Write" : "👁️ Read"}
            </span>
          `
              : ""
          }
        </div>
      </div>
      <div class="note-preview">${escapeHtml(note.content.substring(0, 150))}${
        note.content.length > 150 ? "..." : ""
      }</div>
      <div class="note-meta">
        <span class="note-date">${formatDate(note.updated_at)}</span>
      </div>
      <div class="note-actions" onclick="event.stopPropagation()">
        <button class="btn-icon" onclick="editNote('${
          note.id
        }')" title="Edit Note">✏️</button>
        ${
          !note.isShared
            ? `
          <button class="btn-icon" onclick="shareNote('${
            note.id
          }')" title="Share Note">👥</button>
          ${
            note.share_count > 0
              ? `<button class="btn-icon" onclick="manageShares('${note.id}')" title="Manage Shares">⚙️</button>`
              : ""
          }
          <button class="btn-icon btn-delete" onclick="deleteNote('${
            note.id
          }')" title="Delete Note">🗑️</button>
          `
            : `
          <button class="btn-icon" onclick="leaveNote('${note.id}')" title="Leave Note">👋</button>
        `
        }
      </div>
    </div>
  `
    )
    .join("");

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
  const filtered = notes.filter(
    (note) =>
      note.title.toLowerCase().includes(searchTerm) ||
      note.content.toLowerCase().includes(searchTerm)
  );
  displayNotes(filtered);
}

// Update statistics
function updateStatistics() {
  const totalNotes = notes.length;
  const sharedNotes = notes.filter((note) => note.isShared).length;
  const encryptedNotes = notes.filter((note) => note.encrypted).length;

  document.getElementById("totalNotes").textContent = totalNotes;
  document.getElementById("sharedNotes").textContent = sharedNotes;
  document.getElementById("encryptedNotes").textContent = encryptedNotes;
}

// Open modal for new note
function openNewNoteModal() {
  currentNoteId = null;
  document.getElementById("modalTitle").textContent = "New Note";
  document.getElementById("noteTitle").value = "";
  document.getElementById("noteContent").value = "";
  document.getElementById("noteEncrypted").checked = true;
  document.getElementById("noteError").style.display = "none";
  document.getElementById("noteModal").style.display = "flex";

  setModalMode("new");

  // Focus on title input
  setTimeout(() => {
    document.getElementById("noteTitle").focus();
  }, 100);
}

// Edit existing note
window.editNote = async function (id) {
  try {
    const noteData = notes.find((n) => n.id === id);

    // Check permissions for shared notes
    if (noteData?.isShared && noteData.permission === "read") {
      showError("noteError", "You only have read access to this note");
      return;
    }

    const isShared = noteData?.isShared;

    // Fetch from appropriate endpoint
    const data = isShared ? await api.getSharedNote(id) : await api.getNote(id);

    const note = data.note;

    currentNoteId = note.id;
    document.getElementById("modalTitle").textContent = "Edit Note";
    document.getElementById("noteTitle").value = note.title;
    document.getElementById("noteContent").value = note.content;
    document.getElementById("noteEncrypted").checked = note.encrypted;
    document.getElementById("noteError").style.display = "none";
    document.getElementById("noteModal").style.display = "flex";

    setModalMode("edit");

    // Focus on title input
    setTimeout(() => {
      document.getElementById("noteTitle").focus();
    }, 100);
  } catch (error) {
    showError("noteError", "Failed to load note: " + error.message);
    console.error("Edit note error:", error);
  }
};

// Delete note
async function deleteNote(id) {
  const confirmed = await showConfirm({
    icon: "🗑️",
    type: "danger",
    title: "Delete Note?",
    message:
      "This action cannot be undone. Your note will be permanently deleted.",
    confirmText: "Delete",
    cancelText: "Keep Note",
  });

  if (!confirmed) return;

  try {
    await api.deleteNote(id);
    showToast({
      icon: "✓",
      type: "success",
      title: "Note Deleted",
      message: "Your note has been permanently deleted",
    });
    await loadNotes();
  } catch (error) {
    showToast({
      icon: "✗",
      type: "error",
      title: "Delete Failed",
      message: error.message || "Failed to delete note",
    });
  }
}

// Save note (create or update)
async function saveNote(e) {
  e.preventDefault();

  const title = document.getElementById("noteTitle").value.trim();
  const content = document.getElementById("noteContent").value.trim();
  const encrypted = document.getElementById("noteEncrypted").checked;

  if (!title || !content) {
    showError("noteError", "Please fill in both title and content");
    return;
  }

  const saveBtn = document.getElementById("saveNoteBtn");
  const originalText = saveBtn.innerHTML;

  // Add loading state
  saveBtn.disabled = true;
  saveBtn.classList.add("loading");
  saveBtn.innerHTML = '<span class="btn-text">Saving...</span>';

  try {
    const noteData = notes.find((n) => n.id === currentNoteId);
    const isShared = noteData?.isShared;

    if (currentNoteId && isShared) {
      await api.updateSharedNote(currentNoteId, title, content, encrypted);
      showToast({
        icon: "✓",
        type: "success",
        title: "Shared Note Updated",
        message: "Your changes have been saved",
      });
    } else if (currentNoteId) {
      await api.updateNote(currentNoteId, title, content, encrypted);
      showToast({
        icon: "✓",
        type: "success",
        title: "Note Updated",
        message: "Your changes have been saved",
      });
    } else {
      await api.createNote(title, content, encrypted);
      showToast({
        icon: "✓",
        type: "success",
        title: "Note Created",
        message: encrypted
          ? "Your note is encrypted and secure"
          : "Your note has been saved",
      });
    }

    closeModal();
    await loadNotes();

    // Hide success message after 3 seconds
    setTimeout(() => {
      hideMessage("successMessage");
    }, 3000);
  } catch (error) {
    showError("noteError", error.message);
    console.error("Save note error:", error);
  } finally {
    saveBtn.disabled = false;
    saveBtn.classList.remove("loading");
    saveBtn.innerHTML = originalText;
  }
}

window.shareNote = async function (noteId) {
  try {
    currentNoteId = noteId;

    const friendsData = await api.getFriends();
    const friends = friendsData.friends || []; // Keep this line as-is

    const sharesData = await api.getNoteShares(noteId);
    const shares = sharesData.shares || [];
    const sharedWithIds = shares.map((s) => s.shared_with_id);

    const availableFriends = friends.filter(
      (f) => !sharedWithIds.includes(f.friend_id)
    );

    // Populate friend select dropdown
    const friendSelect = document.getElementById("shareFriendSelect");
    friendSelect.innerHTML = `
      <option value="">Choose a friend...</option>
      ${availableFriends
        .map(
          (f) =>
            `<option value="${f.friend_id}">${escapeHtml(f.username)}</option>`
        )
        .join("")}
    `;

    // Reset form
    document.getElementById("sharePermissionSelect").value = "read";
    document.getElementById("shareError").style.display = "none";

    // Show modal
    document.getElementById("shareModal").style.display = "flex";
  } catch (error) {
    showError("noteError", "Failed to load friends: " + error.message);
  }
};

window.confirmShare = async function () {
  const friendId = document.getElementById("shareFriendSelect").value;
  const permission = document.getElementById("sharePermissionSelect").value;

  if (!friendId) {
    showError("shareError", "Please select a friend");
    return;
  }

  const shareBtn = document.getElementById("shareBtn");
  const originalText = shareBtn.innerHTML;

  try {
    // Add loading state
    shareBtn.disabled = true;
    shareBtn.classList.add("loading");
    shareBtn.innerHTML = '<span class="btn-text">Sharing...</span>';

    await api.shareNote(currentNoteId, friendId, permission);
    closeShareModal();
    showSuccess("Note shared successfully!");
  } catch (error) {
    showError("shareError", "Failed to share note: " + error.message);
  } finally {
    // Remove loading state
    shareBtn.disabled = false;
    shareBtn.classList.remove("loading");
    shareBtn.innerHTML = originalText;
  }
};

// Close share modal
window.closeShareModal = function () {
  document.getElementById("shareModal").style.display = "none";
  currentNoteId = null;
};

window.manageShares = async function (noteId) {
  try {
    const shares = await api.getNoteShares(noteId);

    if (!shares.shares || shares.shares.length === 0) {
      return; // Don't show modal if no shares
    }

    const sharesList = document.getElementById("sharesList");
    sharesList.innerHTML = shares.shares
      .map(
        (share) => `
      <div class="share-item" data-share-id="${share.id}">
        <img src="${share.avatar_url || "/default-avatar.png"}" alt="${
          share.username
        }" class="share-avatar">
        <span class="share-username">${escapeHtml(share.username)}</span>
        <select class="share-permission" onchange="updateSharePermission('${noteId}', '${
          share.shared_with_id
        }', this.value)">
          <option value="read" ${
            share.permission === "read" ? "selected" : ""
          }>Read</option>
          <option value="write" ${
            share.permission === "write" ? "selected" : ""
          }>Write</option>
        </select>
        <button class="btn-unshare" onclick="unshareNote('${noteId}', '${
          share.shared_with_id
        }')">Unshare</button>
      </div>
    `
      )
      .join("");

    document.getElementById("manageSharesModal").style.display = "flex";
  } catch (error) {
    showError("manageSharesError", "Failed to load shares: " + error.message);
    console.error("Manage shares error:", error);
  }
};

function closeManageSharesModal() {
  document.getElementById("manageSharesModal").style.display = "none";
}

window.updateSharePermission = async function (
  noteId,
  sharedWithId,
  permission
) {
  try {
    await api.updateSharePermission(noteId, sharedWithId, permission);
    showToast({
      icon: "✓",
      type: "success",
      title: "Permission Updated",
      message: `Changed to ${permission} access`,
    });
  } catch (error) {
    showError(
      "manageSharesError",
      "Failed to update permission: " + error.message
    );
    console.error("Update permission error:", error);
  }
};

window.unshareNote = async function (noteId, sharedWithId) {
  if (!confirm("Are you sure you want to unshare this note?")) return;

  try {
    await api.unshareNote(noteId, sharedWithId);
    showToast({
      icon: "✓",
      type: "success",
      title: "Note Unshared",
      message: "Note access removed",
    });

    // Refresh the shares list
    manageShares(noteId);
  } catch (error) {
    showError("manageSharesError", "Failed to unshare note: " + error.message);
    console.error("Unshare note error:", error);
  }
};

// Close modal
function closeModal() {
  document.getElementById("noteModal").style.display = "none";
  document.getElementById("noteError").style.display = "none";
  currentNoteId = null;
}

async function leaveNote(noteId) {
  const confirmed = await showConfirm({
    icon: "👋",
    type: "warning",
    title: "Leave?",
    message: "Are you sure you want to leave the note?",
    confirmText: "Leave",
    cancelText: "Cancel",
  });

  if (!confirmed) return;

  try {
    await api.leaveSharedNote(noteId);
    showToast({
      icon: "👋",
      type: "success",
      title: "Left note",
      message: "Successfully left note!",
    });

    loadNotes();
  } catch (error) {
    console.error("Leave note error:", error);
  }
}

// Logout
async function logout() {
  const confirmed = await showConfirm({
    icon: "👋",
    type: "warning",
    title: "Logout?",
    message:
      "You will be logged out of your account. Your notes are safe and will be here when you return.",
    confirmText: "Logout",
    cancelText: "Stay",
  });

  if (!confirmed) return;

  try {
    await api.logout();
    showToast({
      icon: "👋",
      type: "success",
      title: "Logged Out",
      message: "See you soon!",
    });

    // Wait for toast to show, then redirect
    setTimeout(() => {
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
      localStorage.removeItem("user");
      window.location.href = "/login.html";
    }, 1000);
  } catch (error) {
    console.error("Logout error:", error);
    // Logout locally even if API fails
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("user");
    window.location.href = "/login.html";
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

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function setModalMode(mode) {
  const titleInput = document.getElementById("noteTitle");
  const contentInput = document.getElementById("noteContent");
  const encryptedInput = document.getElementById("noteEncrypted");
  const saveBtn = document.getElementById("saveNoteBtn");
  const cancelBtn = document.getElementById("cancelBtn");
  const editBtn = document.getElementById("editBtn"); // optional
  const encryptionContainer = document.getElementById("encryptionContainer");
  const modalContainer = document.getElementById("modalContainer");

  if (mode === "view") {
    // Disable inputs
    if (titleInput) titleInput.readOnly = true;
    if (contentInput) contentInput.readOnly = true;
    if (encryptedInput) encryptedInput.disabled = true;

    // Hide Save/Cancel
    if (saveBtn) saveBtn.style.display = "none";
    if (cancelBtn) cancelBtn.style.display = "none";
    if (encryptionContainer) encryptionContainer.style.display = "none";
    if (modalContainer) modalContainer.style.display = "none";

    // Show Edit button if it exists
    if (editBtn) editBtn.style.display = "inline-flex";
  } else {
    // Enable inputs
    if (titleInput) titleInput.readOnly = false;
    if (contentInput) contentInput.readOnly = false;
    if (encryptedInput) encryptedInput.disabled = false;

    // Show Save/Cancel
    if (saveBtn) saveBtn.style.display = "inline-flex";
    if (cancelBtn) cancelBtn.style.display = "inline-flex";
    if (encryptionContainer) encryptionContainer.style.display = "inline-flex";
    if (modalContainer) modalContainer.style.display = "flex";

    // Hide Edit button if it exists
    if (editBtn) editBtn.style.display = "none";
  }
}

window.viewNote = async function (id) {
  try {
    // Find if note is shared
    const noteData = notes.find((n) => n.id === id);
    const isShared = noteData?.isShared;

    // Fetch from appropriate endpoint
    const data = isShared ? await api.getSharedNote(id) : await api.getNote(id);

    const note = data.note;

    if (!note) {
      console.warn("Note not found");
      return;
    }

    // 2. Fill modal fields
    const titleInput = document.getElementById("noteTitle");
    const contentInput = document.getElementById("noteContent");
    const encryptedInput = document.getElementById("noteEncrypted");

    if (titleInput) titleInput.value = note.title || "(Untitled)";
    if (contentInput) contentInput.value = note.content || "(Empty note)";
    if (encryptedInput) encryptedInput.checked = note.encrypted || false;

    // 3. Set modal to view (read-only)
    setModalMode("view");

    // 4. Update modal header and show it
    document.getElementById("modalTitle").textContent = "View Note";
    document.getElementById("noteModal").style.display = "flex";
  } catch (err) {
    console.error("Failed to view note:", err);
    showError("noteError", "Failed to load note: " + err.message);
  }
};

// Masonry initialization
let masonryInstance = null;

function initMasonry() {
  const container = document.getElementById("notesContainer");

  if (masonryInstance) {
    masonryInstance.destroy();
  }

  masonryInstance = new Masonry(container, {
    itemSelector: ".note-card",
    columnWidth: ".note-card",
    percentPosition: true,
    gutter: 24,
    transitionDuration: "0.3s",
  });
}
