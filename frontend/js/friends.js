// ==================== Initialization ====================
document.addEventListener("DOMContentLoaded", async () => {
  await redirectIfNotAuthenticated();

  // Start auto-refresh timer
  api.startRefreshTimer();

  initializeFriendsPage();
  setupFriendsListeners();
  setupModalListeners();
  setupFriendActionListeners();
  setupNavigationListeners();
});

// ==================== Page Initialization ====================
async function initializeFriendsPage() {
  await loadFriends();
  await loadFriendRequests();
}

// ==================== Event Listener Setup ====================
function setupFriendsListeners() {
  // Additional listeners specific to friends page can be added here
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
let currentSelectedUser = null;
let myFriends = [];
let pendingRequests = [];

// ==================== Friends List Functions ====================
async function loadFriends() {
  try {
    const response = await api.getFriends();

    myFriends = response.friends;
    displayFriendsList();
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

function displayFriendsList() {
  const friendsList = document.getElementById("friendsList");

  if (myFriends.length === 0) {
    friendsList.innerHTML =
      '<p class="no-friends">You haven\'t added any friends yet. Use the search page to find and add friends!</p>';
    return;
  }

  friendsList.innerHTML = "";

  myFriends.forEach((friend) => {
    const friendItem = createFriendItem(friend);
    friendsList.appendChild(friendItem);
  });
}

function createFriendItem(friend) {
  const friendItem = document.createElement("div");
  friendItem.className = "friend-item";

  friendItem.innerHTML = `
        <div class="friend-avatar">
            <img src="${getUserAvatarUrl(friend.profile_picture, friend.username)}" alt="${escapeHtml(
    friend.username
  )}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
        </div>
        <div class="friend-info">
            <div class="friend-name">${escapeHtml(friend.username)}</div>
            <div class="friend-since">Friends since ${formatDate(
              friend.accepted_at
            )}</div>
        </div>
        <div class="friend-actions">
            <button class="btn-view-profile btn btn-primary" data-user-id="${
              friend.friend_id
            }" data-username="${friend.username}" data-profile-picture="${friend.profile_picture || ''}">
                View Profile
            </button>
            <button class="btn-remove-friend btn btn-danger" data-user-id="${
              friend.friend_id
            }" data-username="${friend.username}">
                Remove
            </button>
        </div>
    `;

  return friendItem;
}

// ==================== Friend Requests Functions ====================
async function loadFriendRequests() {
  try {
    const response = await api.getPendingFriendRequests();

    pendingRequests = response.requests;
    // console.log(pendingRequests);
    displayFriendRequests();
  } catch (error) {
    console.error("Error loading friend requests:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Load Failed",
      message: "Failed to load friend requests"
    });
  }
}

function displayFriendRequests() {
  const requestsList = document.getElementById("friendRequests");

  if (pendingRequests.length === 0) {
    requestsList.innerHTML =
      '<p class="no-requests">No pending friend requests</p>';
    return;
  }

  requestsList.innerHTML = "";

  pendingRequests.forEach((request) => {
    const requestItem = createRequestItem(request);
    requestsList.appendChild(requestItem);
  });
}

function createRequestItem(request) {
  const requestItem = document.createElement("div");

  requestItem.className = "request-item";

  requestItem.innerHTML = `
        <div class="request-avatar">
            <img src="${getUserAvatarUrl(request.profile_picture, request.username)}" alt="${escapeHtml(
    request.username
  )}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
        </div>
        <div class="request-info">
            <div class="request-name">${escapeHtml(request.username)}</div>
            <div class="request-date">Request sent ${formatDate(
              request.requested_at
            )}</div>
        </div>
        <div class="request-actions">
            <button class="btn btn-accept-request btn-success" data-request-id="${
              request.id
            }" data-user-id="${request.user_id}">
                Accept
            </button>
            <button class="btn btn-decline-request btn-danger" data-request-id="${
              request.id
            }" data-user-id="${request.user_id}">
                Decline
            </button>
        </div>
    `;

  return requestItem;
}

// ==================== Request Action Handlers ====================
function attachRequestActionListeners() {
  // Accept request listeners
  document.querySelectorAll(".btn-accept-request").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = btn.dataset.requestId; // keep as string
      await handleAcceptRequest(requestId);
    });
  });

  // Decline request listeners
  document.querySelectorAll(".btn-decline-request").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const requestId = btn.dataset.requestId;
      await handleDeclineRequest(requestId);
    });
  });

  // Remove friend listeners
  document.querySelectorAll(".btn-remove-friend").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.userId;
      const username = btn.dataset.username;
      await handleRemoveFriendFromList(userId, username);
    });
  });

  // View profile listeners
  document.querySelectorAll(".btn-view-profile").forEach((btn) => {
    btn.addEventListener("click", () => {
      const userId = btn.dataset.userId;
      const username = btn.dataset.username;
      const profilePicture = btn.dataset.profilePicture;
      openProfileModal(userId, username, profilePicture);
    });
  });
}

async function handleAcceptRequest(requestId) {
  try {
    if (!requestId) throw new Error("Invalid request ID");

    await api.acceptFriendRequest(requestId);
    showToast({
      icon: "✓",
      type: "success",
      title: "Request Accepted",
      message: "Friend request accepted!"
    });

    await loadFriends();
    await loadFriendRequests();
  } catch (error) {
    console.error("Error accepting friend request:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Accept Failed",
      message: "Failed to accept friend request"
    });
  }
}

async function handleDeclineRequest(requestId) {
  try {
    await api.declineFriendRequest(requestId);
    showToast({
      icon: "✓",
      type: "success",
      title: "Request Declined",
      message: "Friend request declined"
    });

    // Reload requests list
    await loadFriendRequests();
  } catch (error) {
    console.error("Error declining friend request:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Decline Failed",
      message: "Failed to decline friend request"
    });
  }
}

async function handleRemoveFriendFromList(userId, username) {
  if (!confirm(`Are you sure you want to remove ${username} as a friend?`)) {
    return;
  }

  try {
    await api.removeFriend(userId);
    showToast({
      icon: "✓",
      type: "success",
      title: "Friend Removed",
      message: "Friend removed successfully"
    });

    // Reload friends list
    await loadFriends();
  } catch (error) {
    console.error("Error removing friend:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Remove Failed",
      message: "Failed to remove friend"
    });
  }
}

// ==================== Profile Modal Functions ====================
async function openProfileModal(userId, username, profilePicture = null) {
  const profileModal = document.getElementById("profileModal");
  const profilePictureEl = document.getElementById("profilePicture");
  const profileUsername = document.getElementById("profileUsername");
  const profileMemberSince = document.getElementById("profileMemberSince");

  currentSelectedUser = { id: userId, username: username };

  // Reset modal UI state to prevent old state from showing
  resetModalState();

  // Set profile information
  // Use provided profile picture, or try to find from friends list, or use fallback
  const pictureToUse = profilePicture || myFriends.find(f => f.friend_id === userId)?.profile_picture;
  profilePictureEl.src = getUserAvatarUrl(pictureToUse, username);
  profileUsername.textContent = username;
  profileMemberSince.textContent = "Member since 2025";

  // Check and update friendship status
  await updateFriendshipStatus(userId);

  // Show modal
  profileModal.style.display = "block";
}

function resetModalState() {
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  // Reset to default state - hide all buttons and clear status
  addFriendBtn.style.display = "none";
  removeFriendBtn.style.display = "none";
  addFriendBtn.disabled = false;
  removeFriendBtn.disabled = false;
  addFriendBtn.textContent = "Add Friend";
  removeFriendBtn.textContent = "Remove Friend";
  friendshipStatus.textContent = "";
  friendshipStatus.className = "friendship-status";
}

function closeProfileModal() {
  const profileModal = document.getElementById("profileModal");
  profileModal.style.display = "none";
  currentSelectedUser = null;
}

async function updateFriendshipStatus(userId) {
  const isFriend = myFriends.some((friend) => friend.friend_id === userId);

  if (isFriend) {
    showFriendStatus();
  } else {
    await checkPendingRequest(userId);
  }
}

function showFriendStatus() {
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  addFriendBtn.style.display = "none";
  removeFriendBtn.style.display = "block";
  friendshipStatus.textContent = "✓ You are friends";
  friendshipStatus.className = "friendship-status friends";
}

async function checkPendingRequest(userId) {
  try {
    const response = await api.getPendingFriendRequests();
    const hasPendingRequest = response.requests.some(
      (req) => req.user_id === userId
    );

    if (hasPendingRequest) {
      showPendingStatus();
    } else {
      showAddFriendButton();
    }
  } catch (error) {
    console.error("Error checking friend requests:", error);
    showAddFriendButton();
  }
}

function showPendingStatus() {
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  addFriendBtn.style.display = "none";
  removeFriendBtn.style.display = "none";
  friendshipStatus.textContent = "Friend request pending";
  friendshipStatus.className = "friendship-status pending";
}

function showAddFriendButton() {
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  addFriendBtn.style.display = "block";
  removeFriendBtn.style.display = "none";
  friendshipStatus.textContent = "";
}

// ==================== Friend Actions ====================
async function handleAddFriend() {
  if (!currentSelectedUser) return;

  const addFriendBtn = document.getElementById("addFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  try {
    setButtonLoading(addFriendBtn, "Sending...");

    await api.sendFriendRequest(currentSelectedUser.username);

    friendshipStatus.textContent = "Friend request sent!";
    friendshipStatus.className = "friendship-status pending";
    addFriendBtn.style.display = "none";

    showToast({
      icon: "✓",
      type: "success",
      title: "Request Sent",
      message: "Friend request sent successfully!"
    });

    // Reload requests in case this user sent us a request
    await loadFriendRequests();
  } catch (error) {
    console.error("Error sending friend request:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Request Failed",
      message: "Failed to send friend request"
    });
    resetButton(addFriendBtn, "Add Friend");
  }
}

async function handleRemoveFriend() {
  if (!currentSelectedUser) return;

  if (
    !confirm(
      `Are you sure you want to remove ${currentSelectedUser.username} as a friend?`
    )
  ) {
    return;
  }

  const removeFriendBtn = document.getElementById("removeFriendBtn");
  const addFriendBtn = document.getElementById("addFriendBtn");
  const friendshipStatus = document.getElementById("friendshipStatus");

  try {
    setButtonLoading(removeFriendBtn, "Removing...");

    await api.removeFriend(currentSelectedUser.id);

    // Update UI
    addFriendBtn.style.display = "block";
    removeFriendBtn.style.display = "none";
    friendshipStatus.textContent = "";

    // Reload friends list
    await loadFriends();

    showToast({
      icon: "✓",
      type: "success",
      title: "Friend Removed",
      message: "Friend removed successfully"
    });
    closeProfileModal();
  } catch (error) {
    console.error("Error removing friend:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Remove Failed",
      message: "Failed to remove friend"
    });
    resetButton(removeFriendBtn, "Remove Friend");
  }
}

// ==================== Utility Functions ====================
// Note: escapeHtml is now imported from utils.js

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function setButtonLoading(button, text) {
  button.disabled = true;
  button.textContent = text;
}

function resetButton(button, text) {
  button.disabled = false;
  button.textContent = text;
}

// Update display functions to attach listeners after rendering
function displayFriendsList() {
  const friendsList = document.getElementById("friendsList");

  if (myFriends.length === 0) {
    friendsList.innerHTML =
      '<p class="no-friends">You haven\'t added any friends yet. Use the search page to find and add friends!</p>';
    return;
  }

  friendsList.innerHTML = "";

  myFriends.forEach((friend) => {
    const friendItem = createFriendItem(friend);
    friendsList.appendChild(friendItem);
  });

  attachRequestActionListeners();
}

function displayFriendRequests() {
  const requestsList = document.getElementById("friendRequests");

  if (pendingRequests.length === 0) {
    requestsList.innerHTML =
      '<p class="no-requests">No pending friend requests</p>';
    return;
  }

  requestsList.innerHTML = "";

  pendingRequests.forEach((request) => {
    const requestItem = createRequestItem(request);
    requestsList.appendChild(requestItem);
  });

  attachRequestActionListeners();
}
