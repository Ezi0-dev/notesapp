// Use relative URL to go through nginx proxy
// This allows Docker network isolation while still working in browser
const API_URL = "/api";

// Auto-refresh config - refresh 10min before 3h expiry
const TOKEN_REFRESH_INTERVAL = 170 * 60 * 1000; // 2h 50min
let refreshTimer = null;

const api = {
  async request(endpoint, options = {}) {
    const config = {
      ...options,
      credentials: 'include', // Send cookies with every request
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        console.error("API request failed:", {
          endpoint: `${API_URL}${endpoint}`,
          status: response.status,
          statusText: response.statusText,
          data,
        });

        if (response.status === 401) {
          // Token expired or invalid - clear user data and logout
          localStorage.removeItem("user");
          this.stopRefreshTimer();

          // Broadcast logout to other tabs
          if (typeof BroadcastChannel !== 'undefined') {
            const authChannel = new BroadcastChannel('auth-channel');
            authChannel.postMessage({ type: 'logout' });
            authChannel.close();
          }

          // Only redirect if NOT already on auth pages
          const currentPage = window.location.pathname;
          if (
            !currentPage.includes("login") &&
            !currentPage.includes("register")
          ) {
            window.location.href = "/login.html";
          }
        }

        throw new Error(data.error?.message || "Request failed");
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  // Token refresh management
  startRefreshTimer() {
    this.stopRefreshTimer(); // Clear any existing timer

    refreshTimer = setInterval(async () => {
      try {
        await this.refreshToken();
        console.log('Token auto-refreshed successfully');
      } catch (error) {
        console.error('Auto-refresh failed:', error);
        // Don't logout immediately - might be temporary network issue
        // Next 401 will trigger logout
      }
    }, TOKEN_REFRESH_INTERVAL);

    console.log('Auto-refresh timer started (will refresh in 2h 50min)');
  },

  stopRefreshTimer() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
      console.log('Auto-refresh timer stopped');
    }
  },

  async refreshToken() {
    return this.request("/auth/refresh", {
      method: "POST"
    });
  },

  async checkAuth() {
    return this.request("/auth/me");
  },

  // Auth endpoints
  async register(username, email, password) {
    const response = await this.request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, email, password }),
    });

    // Start auto-refresh timer after successful registration
    this.startRefreshTimer();

    // Broadcast login to other tabs
    if (typeof BroadcastChannel !== 'undefined') {
      const authChannel = new BroadcastChannel('auth-channel');
      authChannel.postMessage({ type: 'login', user: response.user });
      authChannel.close();
    }

    return response;
  },

  async login(username, password) {
    const response = await this.request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });

    // Start auto-refresh timer after successful login
    this.startRefreshTimer();

    // Broadcast login to other tabs
    if (typeof BroadcastChannel !== 'undefined') {
      const authChannel = new BroadcastChannel('auth-channel');
      authChannel.postMessage({ type: 'login', user: response.user });
      authChannel.close();
    }

    return response;
  },

  async logout() {
    // Stop refresh timer
    this.stopRefreshTimer();

    const response = await this.request("/auth/logout", {
      method: "POST"
    });

    // Clear user from localStorage (cookies cleared by server)
    localStorage.removeItem("user");

    // Broadcast logout to other tabs
    if (typeof BroadcastChannel !== 'undefined') {
      const authChannel = new BroadcastChannel('auth-channel');
      authChannel.postMessage({ type: 'logout' });
      authChannel.close();
    }

    return response;
  },

  async getProfile() {
    return this.request("/auth/profile");
  },

  // Profile management endpoints
  async changePassword(currentPassword, newPassword) {
    return this.request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async deleteAccount() {
    return this.request("/auth/delete-account", {
      method: "DELETE",
    });
  },

  async uploadProfilePicture(file) {
    const formData = new FormData();
    formData.append("avatar", file);

    try {
      const response = await fetch(`${API_URL}/auth/upload-avatar`, {
        method: "POST",
        credentials: 'include', // Send cookies for authentication
        body: formData,
        // Don't set Content-Type - browser sets it automatically with boundary for FormData
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Upload failed:", data);
        throw new Error(data.error?.message || "Failed to upload avatar");
      }

      console.log("Upload successful:", data);
      return data;
    } catch (error) {
      console.error("Upload error:", error);
      throw error;
    }
  },

  async removeProfilePicture() {
    return this.request("/auth/remove-avatar", {
      method: "DELETE",
    });
  },

  // Notes endpoints
  async getNotes() {
    return this.request("/notes");
  },

  async getNote(id) {
    return this.request(`/notes/${id}`);
  },

  async createNote(title, content, encrypted = true) {
    return this.request("/notes", {
      method: "POST",
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async updateNote(id, title, content, encrypted = true) {
    return this.request(`/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async updateSharedNote(id, title, content, encrypted = true) {
    return this.request(`/sharing/shared-notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async deleteNote(id) {
    return this.request(`/notes/${id}`, {
      method: "DELETE",
    });
  },

  // Friends endpoints
  async searchUsers(username) {
    return this.request(
      `/friends/search?username=${encodeURIComponent(username)}`
    );
  },

  async sendFriendRequest(friendUsername) {
    return this.request("/friends/request", {
      method: "POST",
      body: JSON.stringify({ friendUsername }),
    });
  },

  async getPendingFriendRequests() {
    return this.request("/friends/requests");
  },

  async getFriends() {
    return this.request("/friends");
  },

  async removeFriend(friendId) {
    return this.request(`/friends/${friendId}`, {
      method: "DELETE",
    });
  },

  async acceptFriendRequest(friendshipId) {
    return this.request(`/friends/accept/${friendshipId}`, {
      method: "POST",
    });
  },

  async declineFriendRequest(friendshipId) {
    return this.request(`/friends/reject/${friendshipId}`, {
      method: "POST",
    });
  },

  // Sharing endpoints
  async getNoteShares(noteId) {
    return this.request(`/sharing/notes/${noteId}/shares`);
  },

  async getSharedWithMe() {
    return this.request("/sharing/shared-with-me");
  },

  async getSharedNote(noteId) {
    return this.request(`/sharing/notes/${noteId}`);
  },

  async shareNote(noteId, friendId, permission = "read") {
    return this.request(`/sharing/notes/${noteId}/share`, {
      method: "POST",
      body: JSON.stringify({ friendId, permission }),
    });
  },

  async unshareNote(noteId, friendId) {
    return this.request(`/sharing/notes/${noteId}/share/${friendId}`, {
      method: "DELETE",
    });
  },

  async leaveSharedNote(noteId) {
    return this.request(`/sharing/notes/${noteId}/leave`, {
      method: "DELETE",
    });
  },

  async updateSharePermission(noteId, friendId, permission) {
    return this.request(`/sharing/notes/${noteId}/share/${friendId}`, {
      method: "PUT",
      body: JSON.stringify({ permission }),
    });
  },

  // Notifications endpoints
  async getNotifications() {
    return this.request("/notifications");
  },

  async markNotificationAsRead(notificationId) {
    return this.request(`/notifications/${notificationId}/read`, {
      method: "POST",
    });
  },

  async markAllNotificationsAsRead() {
    return this.request("/notifications/read-all", {
      method: "POST",
    });
  },

  async deleteNotification(notificationId) {
    return this.request(`/notifications/${notificationId}`, {
      method: "DELETE",
    });
  },
};

export default api;
