import api from './api.js';

// Show success message
export function showSuccess(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.style.display = "block";

    // Auto-hide after 5 seconds
    setTimeout(() => {
      hideMessage(elementId);
    }, 5000);
  }
}

// Show error message
export function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.style.display = "block";
  }
}

// Hide message
export function hideMessage(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = "none";
    element.textContent = "";
  }
}

// Check if user is authenticated by calling backend
// Can't check cookies from JS (httpOnly), so we ask the server
export async function isAuthenticated() {
  try {
    const response = await api.checkAuth();
    return response.authenticated === true;
  } catch (error) {
    return false;
  }
}

// Redirect to login if not authenticated
export async function redirectIfNotAuthenticated() {
  const authenticated = await isAuthenticated();
  if (!authenticated) {
    window.location.href = "/login.html";
  }
}

// Redirect to dashboard if already authenticated
export async function redirectIfAuthenticated() {
  const authenticated = await isAuthenticated();
  if (authenticated) {
    window.location.href = "/dashboard.html";
  }
}

// Update password strength indicator
export function checkPasswordStrength(password) {
  let strength = 0;
  if (password.length >= 8) strength++;
  if (password.length >= 12) strength++;
  if (/[a-z]/.test(password)) strength++;
  if (/[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;

  return strength;
}

export function updatePasswordStrength(password, elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;

  const strength = checkPasswordStrength(password);
  const strengthText = [
    "Very Weak",
    "Weak",
    "Fair",
    "Good",
    "Strong",
    "Very Strong",
  ];
  const strengthClass = [
    "very-weak",
    "weak",
    "fair",
    "good",
    "strong",
    "very-strong",
  ];

  element.className = "password-strength " + strengthClass[strength];
  element.textContent = strengthText[strength];
  element.style.display = "block";
}

// Validate email format
export function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Format file size
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

// Debounce function for search/filter
export function debounce(func, wait) {
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

// Copy text to clipboard
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error("Failed to copy:", err);
    return false;
  }
}

// Get relative time (e.g., "2 hours ago")
export function getRelativeTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1,
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return interval === 1 ? `1 ${unit} ago` : `${interval} ${unit}s ago`;
    }
  }

  return "just now";
}

// Format date as absolute (e.g., "Jan 15, 2024")
export function formatAbsoluteDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Button loading state helpers
export function setButtonLoading(button, text) {
  button.disabled = true;
  button.textContent = text;
}

export function resetButton(button, text) {
  button.disabled = false;
  button.textContent = text;
}

// Truncate text
export function truncate(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "...";
}

// Generate random ID
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

// Check if dark mode is enabled
export function isDarkMode() {
  return (
    document.body.classList.contains("dark-mode") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

// Toggle dark mode
export function toggleDarkMode() {
  document.body.classList.toggle("dark-mode");
  localStorage.setItem(
    "darkMode",
    document.body.classList.contains("dark-mode")
  );
}

export function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Get user avatar URL with fallback
export function getUserAvatarUrl(profilePicture, username) {
  if (profilePicture) {
    // Return the uploaded profile picture URL (relative path through nginx)
    return `/uploads/avatars/${profilePicture}`;
  }
  // Fallback to generated avatar based on username
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

// Get initials from username
export function getUserInitials(username) {
  if (!username) return "??";
  return username.substring(0, 2).toUpperCase();
}

// Custom Confirm Modal
export function showConfirm(options) {
  return new Promise((resolve) => {
    const modal = document.getElementById("confirmModal");
    const icon = document.getElementById("confirmIcon");
    const title = document.getElementById("confirmTitle");
    const message = document.getElementById("confirmMessage");
    const cancelBtn = document.getElementById("confirmCancel");
    const okBtn = document.getElementById("confirmOk");

    // Set content
    icon.textContent = options.icon || "⚠️";
    icon.className = `confirm-icon ${options.type || "warning"}`;
    title.textContent = options.title || "Confirm Action";
    message.textContent = options.message || "Are you sure?";
    okBtn.textContent = options.confirmText || "Confirm";
    okBtn.className = `btn btn-confirm ${
      options.type === "danger" ? "danger" : ""
    }`;
    cancelBtn.textContent = options.cancelText || "Cancel";

    // Show modal
    modal.classList.add("show");

    // Handle buttons
    const handleConfirm = () => {
      modal.classList.remove("show");
      cleanup();
      resolve(true);
    };

    const handleCancel = () => {
      modal.classList.remove("show");
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      okBtn.removeEventListener("click", handleConfirm);
      cancelBtn.removeEventListener("click", handleCancel);
      modal.removeEventListener("click", handleOutsideClick);
    };

    const handleOutsideClick = (e) => {
      if (e.target === modal) {
        handleCancel();
      }
    };

    okBtn.addEventListener("click", handleConfirm);
    cancelBtn.addEventListener("click", handleCancel);
    modal.addEventListener("click", handleOutsideClick);
  });
}

// Toast Notification
export function showToast(options) {
  const toast = document.getElementById("toast");
  const icon = toast.querySelector(".toast-icon");
  const title = document.getElementById("toastTitle");
  const message = document.getElementById("toastMessage");

  // Set content
  icon.textContent = options.icon || "✓";
  title.textContent = options.title || "Success";
  message.textContent = options.message || "Action completed";
  toast.className = `toast ${options.type || "success"} show`;

  // Auto hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove("show");
  }, options.duration || 3000);
}

// Centralized error handling with severity levels
export const ErrorSeverity = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
};

export function handleError(error, options = {}) {
  const {
    severity = ErrorSeverity.ERROR,
    title,
    context = '',
    showUser = true,
    logToConsole = true
  } = options;

  // Extract error message
  const errorMessage = error?.message || error || 'An unexpected error occurred';

  // Log to console based on severity
  if (logToConsole) {
    const logMessage = context ? `${context}: ${errorMessage}` : errorMessage;

    switch (severity) {
      case ErrorSeverity.INFO:
        console.info(logMessage, error);
        break;
      case ErrorSeverity.WARNING:
        console.warn(logMessage, error);
        break;
      case ErrorSeverity.ERROR:
        console.error(logMessage, error);
        break;
      case ErrorSeverity.CRITICAL:
        console.error(`[CRITICAL] ${logMessage}`, error);
        break;
    }
  }

  // Show user-friendly notification
  if (showUser) {
    const toastConfig = {
      message: errorMessage,
      duration: 4000
    };

    switch (severity) {
      case ErrorSeverity.INFO:
        toastConfig.icon = 'ℹ️';
        toastConfig.title = title || 'Info';
        toastConfig.type = 'info';
        break;
      case ErrorSeverity.WARNING:
        toastConfig.icon = '⚠️';
        toastConfig.title = title || 'Warning';
        toastConfig.type = 'warning';
        toastConfig.duration = 5000;
        break;
      case ErrorSeverity.ERROR:
        toastConfig.icon = '❌';
        toastConfig.title = title || 'Error';
        toastConfig.type = 'error';
        toastConfig.duration = 5000;
        break;
      case ErrorSeverity.CRITICAL:
        toastConfig.icon = '🚨';
        toastConfig.title = title || 'Critical Error';
        toastConfig.type = 'error';
        toastConfig.duration = 7000;
        break;
    }

    showToast(toastConfig);
  }

  return errorMessage;
}
