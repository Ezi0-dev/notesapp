// ==================== Profile Modal Module ====================
// Shared modal logic for friends.js and search.js
// This prevents ~300 lines of code duplication

import api from './api.js';
import { getUserAvatarUrl, setButtonLoading, resetButton, showToast, handleError, ErrorSeverity } from './utils.js';

// Module state
let currentSelectedUser = null;
let friendsList = [];
let onFriendsUpdate = null;  // Callback for when friends list changes
let onRequestsUpdate = null; // Callback for when friend requests change

// Store listener references for cleanup
let modalClickOutsideHandler = null;
let closeButtonHandler = null;
let addFriendHandler = null;
let removeFriendHandler = null;

// ==================== Module Configuration ====================
function initProfileModal(config = {}) {
  // Set up callbacks from parent page
  onFriendsUpdate = config.onFriendsUpdate || null;
  onRequestsUpdate = config.onRequestsUpdate || null;

  // Clean up existing listeners before adding new ones
  cleanupProfileModal();

  // Set up modal listeners
  const closeModal = document.querySelector(".close");
  const profileModal = document.getElementById("profileModal");
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");

  // Store listener references
  closeButtonHandler = closeProfileModal;
  modalClickOutsideHandler = (e) => {
    if (e.target === profileModal) {
      closeProfileModal();
    }
  };
  addFriendHandler = handleAddFriend;
  removeFriendHandler = handleRemoveFriend;

  // Add listeners
  if (closeModal) {
    closeModal.addEventListener("click", closeButtonHandler);
  }

  if (profileModal) {
    window.addEventListener("click", modalClickOutsideHandler);
  }

  if (addFriendBtn) {
    addFriendBtn.addEventListener("click", addFriendHandler);
  }

  if (removeFriendBtn) {
    removeFriendBtn.addEventListener("click", removeFriendHandler);
  }
}

// Clean up event listeners
function cleanupProfileModal() {
  const closeModal = document.querySelector(".close");
  const addFriendBtn = document.getElementById("addFriendBtn");
  const removeFriendBtn = document.getElementById("removeFriendBtn");

  // Remove existing listeners if they exist
  if (closeModal && closeButtonHandler) {
    closeModal.removeEventListener("click", closeButtonHandler);
  }

  if (modalClickOutsideHandler) {
    window.removeEventListener("click", modalClickOutsideHandler);
  }

  if (addFriendBtn && addFriendHandler) {
    addFriendBtn.removeEventListener("click", addFriendHandler);
  }

  if (removeFriendBtn && removeFriendHandler) {
    removeFriendBtn.removeEventListener("click", removeFriendHandler);
  }

  // Reset handler references
  modalClickOutsideHandler = null;
  closeButtonHandler = null;
  addFriendHandler = null;
  removeFriendHandler = null;
}

// ==================== State Management ====================
function setFriendsList(friends) {
  friendsList = friends;
}

function getFriendsList() {
  return friendsList;
}

// ==================== Profile Modal Functions ====================
async function openProfileModal(userId, username, profilePicture = null, createdAt = null) {
  const profileModal = document.getElementById("profileModal");
  const profilePictureEl = document.getElementById("profilePicture");
  const profileUsername = document.getElementById("profileUsername");
  const profileMemberSince = document.getElementById("profileMemberSince");

  currentSelectedUser = { id: userId, username: username };

  // Reset modal UI state to prevent old state from showing
  resetModalState();

  // Set profile information
  const pictureToUse = profilePicture || friendsList.find(f => f.friend_id === userId)?.profile_picture;
  profilePictureEl.src = getUserAvatarUrl(pictureToUse, username);
  profileUsername.textContent = username;

  // Get created_at from parameter or friends list
  const memberDate = createdAt || friendsList.find(f => f.friend_id === userId)?.created_at;

  if (memberDate) {
    const date = new Date(memberDate);
    const year = date.getFullYear();
    profileMemberSince.textContent = `Member since ${year}`;
  } else {
    profileMemberSince.textContent = "Member";
  }

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
  const isFriend = friendsList.some((friend) => friend.friend_id === userId);

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
    handleError(error, {
      severity: ErrorSeverity.WARNING,
      title: 'Friend Status Check Failed',
      context: 'Failed to check pending friend requests',
      showUser: false // Fail gracefully without showing toast
    });
    showAddFriendButton(); // Fallback to showing add friend button
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

    // Call the callback to reload friend requests if provided
    if (onRequestsUpdate) {
      await onRequestsUpdate();
    }
  } catch (error) {
    console.error("Error sending friend request:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Request Failed",
      message: "Friend request already sent."
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

    // Call the callback to reload friends list if provided
    if (onFriendsUpdate) {
      await onFriendsUpdate();
    }

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

// Export public API
export { initProfileModal, openProfileModal, closeProfileModal, setFriendsList, getFriendsList, cleanupProfileModal };
