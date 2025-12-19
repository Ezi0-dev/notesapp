import api from './api.js';
import {
  redirectIfNotAuthenticated,
  escapeHtml,
  getUserAvatarUrl,
  showToast
} from './utils.js';
import {
  initProfileModal,
  openProfileModal,
  setFriendsList,
  getFriendsList
} from './profileModal.js';

// ==================== Initialization ====================
document.addEventListener("DOMContentLoaded", async () => {
  await redirectIfNotAuthenticated();

  // Start auto-refresh timer
  api.startRefreshTimer();

  // Initialize shared profile modal module
  initProfileModal({
    onFriendsUpdate: async () => {
      await loadFriends();
      // Refresh search results if any
      const searchInput = document.getElementById("searchInput");
      if (searchInput && searchInput.value.trim().length >= 2) {
        await performSearch();
      }
    }
  });

  initializeSearchPage();
  setupSearchListeners();
  setupNavigationListeners();
});

// ==================== Page Initialization ====================
async function initializeSearchPage() {
  await loadFriends();
}

// ==================== Event Listener Setup ====================
function setupSearchListeners() {
  const searchInput = document.getElementById("searchInput");
  const searchBtn = document.getElementById("searchBtn");

  searchBtn.addEventListener("click", performSearch);
  searchInput.addEventListener("keypress", handleSearchKeypress);
  searchInput.addEventListener("input", handleSearchInput);
}

function setupModalListeners() {
  const closeModal = document.querySelector(".close");
  const profileModal = document.getElementById("profileModal");

  closeModal.addEventListener("click", closeProfileModal);
  window.addEventListener("click", (e) => {
    if (e.target === profileModal) {
      closeProfileModal();
    }
  });
}

function setupFriendActionListeners() {
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");

  addFriendBtn.addEventListener("click", handleAddFriend);
  removeFriendBtn.addEventListener("click", handleRemoveFriend);
}

function setupNavigationListeners() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", (e) => {
      e.preventDefault();
      logout();
    });
  }
}

// ==================== State Management ====================
// Note: myFriends now managed by shared profileModal.js module

// ==================== Search Functions ====================
function handleSearchKeypress(e) {
  if (e.key === "Enter") {
    performSearch();
  }
}

let searchTimeout;
function handleSearchInput(e) {
  clearTimeout(searchTimeout);
  const query = e.target.value.trim();
  const searchResults = document.getElementById("searchResults");

  if (query.length >= 2) {
    searchTimeout = setTimeout(() => {
      performSearch();
    }, 500);
  } else if (query.length === 0) {
    searchResults.innerHTML =
      '<p class="search-hint">Enter a username to search for users</p>';
  }
}

async function performSearch() {
  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");
  const query = searchInput.value.trim();

  if (query.length < 2) {
    showToast({
      icon: "✗",
      type: "error",
      title: "Search Error",
      message: "Please enter at least 2 characters"
    });
    return;
  }

  try {
    searchResults.innerHTML = '<p class="loading">Searching...</p>';

    const response = await api.searchUsers(query);

    if (response.users.length === 0) {
      searchResults.innerHTML = '<p class="no-results">No users found</p>';
      return;
    }

    displaySearchResults(response.users);
  } catch (error) {
    console.error("Search error:", error);
    searchResults.innerHTML =
      '<p class="error">Failed to search users. Please try again.</p>';
    showToast({
      icon: "✗",
      type: "error",
      title: "Search Failed",
      message: "Failed to search users"
    });
  }
}

function displaySearchResults(users) {
  const searchResults = document.getElementById("searchResults");
  searchResults.innerHTML = "";

  users.forEach((user) => {
    const userCard = createUserCard(user);
    searchResults.appendChild(userCard);
  });

  attachProfileButtonListeners();
}

function createUserCard(user) {
  const userCard = document.createElement("div");
  userCard.className = "user-card";

  const isFriend = getFriendsList().some((friend) => friend.friend_id === user.id);

  userCard.innerHTML = `
        <img src="${getUserAvatarUrl(user.profile_picture, user.username)}" alt="${escapeHtml(
    user.username
  )}" class="user-avatar" style="object-fit: cover;">
        <div class="user-info">
            <h3>${escapeHtml(user.username)}</h3>
            ${isFriend ? '<span class="friend-badge">Friend</span>' : ""}
        </div>
        <button class="btn-view-profile" data-user-id="${
          user.id
        }" data-username="${user.username}" data-profile-picture="${user.profile_picture || ''}">
            View Profile
        </button>
    `;

  return userCard;
}

function attachProfileButtonListeners() {
  document.querySelectorAll(".btn-view-profile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.dataset.userId;
      const username = btn.dataset.username;
      const profilePicture = btn.dataset.profilePicture;
      openProfileModal(userId, username, profilePicture);
    });
  });
}

// ==================== Profile Modal Functions ====================
// Note: Profile modal logic now handled by shared profileModal.js module
// Functions available: openProfileModal, closeProfileModal, setFriendsList, getFriendsList

// ==================== Data Loading ====================
async function loadFriends() {
  try {
    const response = await api.getFriends();
    // Update shared module state
    setFriendsList(response.friends);
  } catch (error) {
    console.error("Error loading friends:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Load Failed",
      message: "Failed to load friends list"
    });
  }
}

// ==================== Utility Functions ====================
// Note: All utility functions now imported from utils.js
