import api from './api.js';
import { escapeHtml, getRelativeTime, getUserAvatarUrl, showToast, handleError, ErrorSeverity } from './utils.js';

// ==================== State Management ====================
// NOTE: These must be declared BEFORE initNotifications() runs
let notificationsPollingInterval = null;
let currentNotifications = [];

// WebSocket state management
let socket = null;
let isSocketConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ==================== Initialization ====================
// Export initialization function for dynamic imports
export function initNotifications() {
  // Note: api.startRefreshTimer() is already called in dashboard.js
  // so we don't call it here to avoid duplicate timers

  initializeNotifications();
  setupNotificationListeners();
  setupDropdownListeners();

  // Start polling for new notifications
  startNotificationsPolling();
}

// Auto-initialize if loaded traditionally (non-dynamic import)
// OR when loaded dynamically after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener("DOMContentLoaded", initNotifications);
} else {
  // DOM already loaded (dynamic import case)
  initNotifications();
}

// ==================== Page Initialization ====================
async function initializeNotifications() {
  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationsDropdown = document.getElementById(
    "notificationsDropdown"
  );

  if (!notificationsBtn || !notificationsDropdown) {
    console.error("Notifications elements not found");
    return;
  }

  // Initial load
  await loadNotifications();
}

// ==================== Event Listener Setup ====================
function setupNotificationListeners() {
  const markAllReadBtn = document.getElementById("markAllReadBtn");

  if (markAllReadBtn) {
    markAllReadBtn.addEventListener("click", handleMarkAllAsRead);
  }
}

function setupDropdownListeners() {
  const notificationsBtn = document.getElementById("notificationsBtn");
  const notificationsDropdown = document.getElementById(
    "notificationsDropdown"
  );

  // Toggle dropdown on button click
  notificationsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (
      !notificationsBtn.contains(e.target) &&
      !notificationsDropdown.contains(e.target)
    ) {
      closeDropdown();
    }
  });
}

function attachNotificationActionListeners() {
  // Mark as read listeners
  document.querySelectorAll(".btn-notification-mark-read").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const notificationId = btn.dataset.notificationId;
      await handleMarkAsRead(notificationId);
    });
  });

  // Delete notification listeners
  document.querySelectorAll(".btn-notification-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const notificationId = btn.dataset.notificationId;
      await handleDeleteNotification(notificationId);
    });
  });
}

// ==================== Notifications List Functions ====================
async function loadNotifications() {
  try {
    const response = await api.getNotifications();
    currentNotifications = response.data || [];

    displayNotifications(currentNotifications);
    updateNotificationBadge(currentNotifications);
  } catch (error) {
    handleError(error, {
      severity: ErrorSeverity.WARNING,
      title: 'Notifications Load Failed',
      context: 'Failed to load notifications',
      showUser: false // Don't show toast for background polling failures
    });
  }
}

function displayNotifications(notifications) {
  const notificationsList = document.getElementById("notificationsList");
  const notificationsEmpty = document.getElementById("notificationsEmpty");

  if (!notificationsList) return;

  // Clear current list
  notificationsList.innerHTML = "";

  if (notifications.length === 0) {
    notificationsList.style.display = "none";
    notificationsEmpty.style.display = "block";
    return;
  }

  notificationsList.style.display = "block";
  notificationsEmpty.style.display = "none";

  notifications.forEach((notification) => {
    const notificationElement = createNotificationElement(notification);
    notificationsList.appendChild(notificationElement);
  });

  // Attach event listeners after rendering
  attachNotificationActionListeners();
}

function createNotificationElement(notification) {
  const div = document.createElement("div");
  div.className = `notification-item ${
    notification.is_read ? "read" : "unread"
  }`;
  div.setAttribute("data-notification-id", notification.id);
  div.setAttribute("data-type", notification.type);

  const timeAgo = formatTimeAgo(new Date(notification.created_at));

  div.innerHTML = `
    <div class="notification-content">
      <div class="notification-icon">${getNotificationIcon(
        notification.type
      )}</div>
      <div class="notification-body">
        <div class="notification-message">${escapeHtml(
          notification.message
        )}</div>
        <div class="notification-time">${timeAgo}</div>
      </div>
    </div>
    <div class="notification-actions">
      ${
        !notification.is_read
          ? `
        <button class="btn-notification-action btn-notification-mark-read"
                data-notification-id="${notification.id}"
                title="Mark as read"
                aria-label="Mark notification as read">
          👁️
        </button>
      `
          : ""
      }
      <button class="btn-notification-action btn-delete btn-notification-delete"
              data-notification-id="${notification.id}"
              title="Delete"
              aria-label="Delete notification">
        🗑️
      </button>
    </div>
  `;

  return div;
}

// ==================== Notification Action Handlers ====================
async function handleMarkAsRead(notificationId) {
  try {
    await api.markNotificationAsRead(notificationId);
    await loadNotifications();
  } catch (error) {
    console.error("Failed to mark notification as read:", error);
    showNotificationError("Failed to mark notification as read");
  }
}

async function handleMarkAllAsRead() {
  try {
    await api.markAllNotificationsAsRead();
    await loadNotifications();
  } catch (error) {
    console.error("Failed to mark all notifications as read:", error);
    showNotificationError("Failed to mark all as read");
  }
}

async function handleDeleteNotification(notificationId) {
  try {
    await api.deleteNotification(notificationId);
    await loadNotifications();
  } catch (error) {
    console.error("Failed to delete notification:", error);
    showNotificationError("Failed to delete notification");
  }
}

// ==================== Dropdown Functions ====================
function toggleDropdown() {
  const notificationsDropdown = document.getElementById(
    "notificationsDropdown"
  );
  const isVisible = notificationsDropdown.style.display !== "none";

  if (isVisible) {
    closeDropdown();
  } else {
    openDropdown();
  }
}

function openDropdown() {
  const notificationsDropdown = document.getElementById(
    "notificationsDropdown"
  );
  notificationsDropdown.style.display = "block";
  loadNotifications();
}

function closeDropdown() {
  const notificationsDropdown = document.getElementById(
    "notificationsDropdown"
  );
  notificationsDropdown.style.display = "none";
}

// ==================== Polling Functions ====================
function startNotificationsPolling() {
  // Try WebSocket first, fallback to polling if unavailable
  if (typeof io !== 'undefined') {
    initializeWebSocket();
  } else {
    console.warn('Socket.io not available, using polling fallback');
    startPollingFallback();
  }
}

function initializeWebSocket() {
  try {
    // Connect to WebSocket server through nginx proxy (same origin)
    // This ensures cookies are sent (no cross-origin issues)
    socket = io({
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: MAX_RECONNECT_ATTEMPTS
    });

    // Connection established
    socket.on('connect', () => {
      isSocketConnected = true;
      reconnectAttempts = 0;

      // Load notifications on initial connection
      loadNotifications();
    });

    // New notification received
    socket.on('notification:new', (notification) => {
      // Add to current notifications array
      currentNotifications.unshift(notification);

      // Update UI
      displayNotifications(currentNotifications);
      updateNotificationBadge(currentNotifications);
    });

    // Notification marked as read
    socket.on('notification:read', ({ id }) => {
      const notification = currentNotifications.find(n => n.id === id);
      if (notification) {
        notification.is_read = true;
        displayNotifications(currentNotifications);
        updateNotificationBadge(currentNotifications);
      }
    });

    // Notification deleted
    socket.on('notification:deleted', ({ id }) => {
      currentNotifications = currentNotifications.filter(n => n.id !== id);
      displayNotifications(currentNotifications);
      updateNotificationBadge(currentNotifications);
    });

    // All notifications marked as read
    socket.on('notification:all_read', () => {
      currentNotifications.forEach(n => n.is_read = true);
      displayNotifications(currentNotifications);
      updateNotificationBadge(currentNotifications);
    });

    // Connection error
    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error.message);
      reconnectAttempts++;

      // Fall back to polling after max reconnect attempts
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        console.warn('WebSocket reconnection failed, falling back to polling');
        socket.disconnect();
        startPollingFallback();
      }
    });

    // Disconnected
    socket.on('disconnect', (reason) => {
      isSocketConnected = false;

      // If server initiated disconnect, fall back to polling
      if (reason === 'io server disconnect') {
        startPollingFallback();
      }
    });

    // Reconnected successfully
    socket.on('reconnect', (attemptNumber) => {
      isSocketConnected = true;
      reconnectAttempts = 0;

      // Re-fetch notifications to sync state
      loadNotifications();
    });

  } catch (error) {
    console.error('Failed to initialize WebSocket:', error);
    startPollingFallback();
  }
}

// Polling fallback (original implementation)
function startPollingFallback() {
  notificationsPollingInterval = setInterval(() => {
    loadNotifications();
  }, 60000 * 5);
}

function stopNotificationsPolling() {
  // Disconnect WebSocket if active
  if (socket && isSocketConnected) {
    socket.disconnect();
    socket = null;
    isSocketConnected = false;
  }

  // Clear polling interval if active
  if (notificationsPollingInterval) {
    clearInterval(notificationsPollingInterval);
    notificationsPollingInterval = null;
  }
}

// ==================== Badge Functions ====================
function updateNotificationBadge(notifications) {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (unreadCount > 0) {
    badge.textContent = unreadCount > 99 ? "99+" : unreadCount;
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

// ==================== Utility Functions ====================
function getNotificationIcon(type) {
  const icons = {
    friend_request: "👤",
    friend_accepted: "🤝",
    note_shared: "📝",
    note_unshared: "🚫",
    note_left: "🚪",
    share_permission_updated: "🔄",
    default: "🔔",
  };

  return icons[type] || icons["default"];
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) {
    return "Just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  } else if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days > 1 ? "s" : ""} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

// Note: escapeHtml is now imported from utils.js

function showNotificationError(message) {
  console.error(message);
  // Could integrate with toast notification system if available
}
