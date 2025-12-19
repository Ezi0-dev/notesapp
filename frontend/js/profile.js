// frontend/js/profile.js

// Validate file by checking magic bytes (file signature)
async function validateImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      const bytes = new Uint8Array(e.target.result);

      // Check magic bytes for common image formats
      const signatures = {
        'image/jpeg': [
          [0xFF, 0xD8, 0xFF, 0xE0], // JPEG JFIF
          [0xFF, 0xD8, 0xFF, 0xE1], // JPEG EXIF
          [0xFF, 0xD8, 0xFF, 0xE2], // JPEG still
          [0xFF, 0xD8, 0xFF, 0xDB]  // JPEG raw
        ],
        'image/png': [
          [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]
        ],
        'image/gif': [
          [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
          [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]  // GIF89a
        ],
        'image/webp': [
          [0x52, 0x49, 0x46, 0x46] // RIFF (WebP container)
        ]
      };

      // Check if file matches any valid signature
      let isValid = false;
      let detectedType = null;

      for (const [mimeType, sigs] of Object.entries(signatures)) {
        for (const sig of sigs) {
          const matches = sig.every((byte, index) => bytes[index] === byte);
          if (matches) {
            isValid = true;
            detectedType = mimeType;
            break;
          }
        }
        if (isValid) break;
      }

      // Extra check for WebP - verify WebP signature after RIFF
      if (detectedType === 'image/webp') {
        const webpSig = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
        const webpMatch = webpSig.every((byte, index) => bytes[index + 8] === byte);
        if (!webpMatch) {
          isValid = false;
          detectedType = null;
        }
      }

      if (!isValid) {
        reject(new Error('File is not a valid image format'));
      } else {
        // Verify the detected type matches the declared MIME type
        if (file.type && file.type !== detectedType) {
          reject(new Error(`File signature mismatch: expected ${file.type}, got ${detectedType}`));
        } else {
          resolve(detectedType);
        }
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));

    // Read first 12 bytes to check signature
    reader.readAsArrayBuffer(file.slice(0, 12));
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await redirectIfNotAuthenticated();

  // Start auto-refresh timer
  api.startRefreshTimer();

  loadUserProfile();
  setupNavigationListeners();
  setupProfilePictureListeners();
  setupPasswordChangeListener();
  setupDeleteAccountListener();
  setupPasswordStrengthIndicator();
});

// Navigation between sections
function setupNavigationListeners() {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll(".settings-section");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const sectionId = item.getAttribute("data-section") + "-section";

      // Update active nav item
      navItems.forEach((nav) => nav.classList.remove("active"));
      item.classList.add("active");

      // Show corresponding section
      sections.forEach((section) => section.classList.remove("active"));
      document.getElementById(sectionId).classList.add("active");
    });
  });
}

// Load user profile data
async function loadUserProfile() {
  try {
    const data = await api.getProfile();
    const user = data.user;

    // Set profile picture initials
    const initials = user.username.substring(0, 2).toUpperCase();
    document.getElementById("avatarInitials").textContent = initials;
    document.getElementById("profileUsername").textContent = user.username;
    document.getElementById("profileEmail").textContent = user.email;

    // Set account info
    document.getElementById("infoUsername").textContent = user.username;
    document.getElementById("infoEmail").textContent = user.email;
    document.getElementById("infoCreatedAt").textContent = new Date(
      user.created_at
    ).toLocaleDateString();
    document.getElementById("infoLastLogin").textContent = user.last_login
      ? new Date(user.last_login).toLocaleString()
      : "Never";

    // Load profile picture if exists
    console.log("User profile data:", user);
    if (user.profile_picture) {
      console.log("Loading profile picture:", user.profile_picture);
      const avatarImage = document.getElementById("profilePicture");
      const avatarPlaceholder = document.getElementById("avatarPlaceholder");

      avatarImage.src = `/uploads/avatars/${user.profile_picture}`;
      avatarImage.classList.add("show");
      avatarPlaceholder.classList.add("hide");
    } else {
      console.log("No profile picture found");
    }
  } catch (error) {
    console.error("Failed to load profile:", error);
    showToast({
      icon: "✗",
      type: "error",
      title: "Error",
      message: "Failed to load profile data",
    });
  }
}

// Profile Picture Handlers
function setupProfilePictureListeners() {
  const uploadBtn = document.getElementById("uploadAvatarBtn");
  const removeBtn = document.getElementById("removeAvatarBtn");
  const avatarInput = document.getElementById("avatarInput");
  const avatarImage = document.getElementById("profilePicture");
  const avatarPlaceholder = document.getElementById("avatarPlaceholder");

  uploadBtn.addEventListener("click", () => {
    avatarInput.click();
  });

  avatarInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      showToast({
        icon: "✗",
        type: "error",
        title: "File Too Large",
        message: "Please choose an image under 2MB",
      });
      e.target.value = ''; // Clear the input
      return;
    }

    // Validate file type (basic MIME check)
    if (!file.type.startsWith("image/")) {
      showToast({
        icon: "✗",
        type: "error",
        title: "Invalid File",
        message: "Please choose an image file",
      });
      e.target.value = ''; // Clear the input
      return;
    }

    // Validate actual file content by checking magic bytes
    // This prevents users from uploading disguised files (e.g., .exe renamed to .jpg)
    try {
      await validateImageFile(file);
    } catch (error) {
      showToast({
        icon: "✗",
        type: "error",
        title: "Invalid Image File",
        message: error.message || "File content doesn't match a valid image format",
      });
      e.target.value = ''; // Clear the input
      return;
    }

    try {
      // Upload to server (backend performs additional validation)
      console.log("Uploading profile picture...");
      const data = await api.uploadProfilePicture(file);
      console.log("Upload response:", data);

      // Display the uploaded image from server
      if (data.profilePicture) {
        avatarImage.src = `/uploads/avatars/${data.profilePicture}`;
        avatarImage.classList.add("show");
        avatarPlaceholder.classList.add("hide");

        // Show success message
        showToast({
          icon: "📷",
          type: "success",
          title: "Picture Updated",
          message: "Profile picture uploaded successfully",
        });
      }
    } catch (error) {
      console.error("Upload error:", error);
      showToast({
        icon: "✗",
        type: "error",
        title: "Upload Failed",
        message: error.message || "Failed to upload profile picture",
      });
      e.target.value = ''; // Clear the input on upload failure
    }
  });

  removeBtn.addEventListener("click", async () => {
    const confirmed = await showConfirm({
      icon: "🗑️",
      type: "warning",
      title: "Remove Picture?",
      message:
        "Your profile picture will be removed and replaced with your initials.",
      confirmText: "Remove",
      cancelText: "Keep",
    });

    if (confirmed) {
      try {
        await api.removeProfilePicture();

        avatarImage.classList.remove("show");
        avatarPlaceholder.classList.remove("hide");
        avatarInput.value = "";

        showToast({
          icon: "✓",
          type: "success",
          title: "Picture Removed",
          message: "Profile picture has been removed",
        });
      } catch (error) {
        showToast({
          icon: "✗",
          type: "error",
          title: "Error",
          message: error.message || "Failed to remove profile picture",
        });
      }
    }
  });
}

// Password Strength Indicator
function setupPasswordStrengthIndicator() {
  const newPasswordInput = document.getElementById("newPassword");
  newPasswordInput.addEventListener("input", (e) => {
    updatePasswordStrength(e.target.value, "newPasswordStrength");
  });
}

// Change Password
function setupPasswordChangeListener() {
  const form = document.getElementById("changePasswordForm");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword =
      document.getElementById("confirmNewPassword").value;

    // Clear previous messages
    document.getElementById("passwordError").style.display = "none";
    document.getElementById("passwordSuccess").style.display = "none";

    // Validate passwords match
    if (newPassword !== confirmNewPassword) {
      showError("passwordError", "New passwords do not match");
      return;
    }

    // Validate password strength
    if (newPassword.length < 8) {
      showError("passwordError", "Password must be at least 8 characters");
      return;
    }

    if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      showError(
        "passwordError",
        "Password must contain uppercase, lowercase, and number"
      );
      return;
    }

    const btn = document.getElementById("changePasswordBtn");
    btn.disabled = true;
    btn.textContent = "Updating...";

    try {
      // Call backend
      await api.changePassword(currentPassword, newPassword);

      showSuccess("passwordSuccess", "✓ Password updated successfully!");
      form.reset();

      showToast({
        icon: "🔒",
        type: "success",
        title: "Password Changed",
        message: "Your password has been updated successfully. Logging out in 3 seconds...",
      });

      // Only logout and redirect on success
      await api.logout();
      localStorage.removeItem("user");

      setTimeout(() => {
        window.location.href = "/login.html";
      }, 3000);
    } catch (error) {
      showError("passwordError", error.message || "Failed to update password");
      btn.disabled = false;
      btn.textContent = "🔒 Update Password";
    }
  });
}

// Delete Account
function setupDeleteAccountListener() {
  const deleteBtn = document.getElementById("deleteAccountBtn");

  deleteBtn.addEventListener("click", async () => {
    // First confirmation
    const firstConfirm = await showConfirm({
      icon: "⚠️",
      type: "danger",
      title: "Delete Account?",
      message:
        "This will permanently delete your account and all your notes. This action cannot be undone.",
      confirmText: "Continue",
      cancelText: "Cancel",
    });

    if (!firstConfirm) return;

    // Second confirmation with stronger warning
    const secondConfirm = await showConfirm({
      icon: "🚨",
      type: "danger",
      title: "Are You Absolutely Sure?",
      message:
        "All your notes, data, and account will be permanently erased. There is NO way to recover your account after this.",
      confirmText: "Yes, Delete Everything",
      cancelText: "No, Keep My Account",
    });

    if (!secondConfirm) return;

    try {
      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";

      await api.deleteAccount();

      showToast({
        icon: "👋",
        type: "success",
        title: "Account Deleted",
        message: "Your account has been permanently deleted",
      });

      // Clear all data and redirect to homepage
      setTimeout(() => {
        localStorage.clear();
        window.location.href = "/index.html";
      }, 2000);
    } catch (error) {
      showToast({
        icon: "✗",
        type: "error",
        title: "Error",
        message: error.message || "Failed to delete account",
      });
      deleteBtn.disabled = false;
      deleteBtn.textContent = "Delete Account";
    }
  });
}
