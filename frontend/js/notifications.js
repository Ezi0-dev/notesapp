// ==================== Initialization ====================
document.addEventListener("DOMContentLoaded", () => {
  initializeNotifications();
  setupNotificationListeners();
  setupDropdownListeners();

  // Start polling for new notifications
  startNotificationsPolling();
});

// ==================== State Management ====================
let notificationsPollingInterval = null;
let currentNotifications = [];

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
    //console.log(currentNotifications);

    displayNotifications(currentNotifications);
    updateNotificationBadge(currentNotifications);
  } catch (error) {
    console.error("Failed to load notifications:", error);
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
                title="Mark as read">
          ✓
        </button>
      `
          : ""
      }
      <button class="btn-notification-action btn-delete btn-notification-delete"
              data-notification-id="${notification.id}"
              title="Delete">
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
  // Poll every 5 minutes
  notificationsPollingInterval = setInterval(() => {
    loadNotifications();
  }, 60000 * 5);
}

function stopNotificationsPolling() {
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function showNotificationError(message) {
  console.error(message);
  // Could integrate with toast notification system if available
}
