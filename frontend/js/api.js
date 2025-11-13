const API_URL = 'http://localhost:5000/api';

const api = {
  async request(endpoint, options = {}) {
    const token = localStorage.getItem('accessToken');
    
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };

    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_URL}${endpoint}`, config);
      const data = await response.json();

      if (!response.ok) {
        console.error('API request failed:', {
          endpoint: `${API_URL}${endpoint}`,
          status: response.status,
          statusText: response.statusText,
          data
        });

        if (response.status === 401) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('user');
          window.location.href = '/login.html';
        }

        throw new Error(data.error?.message || 'Request failed');
      }

      return data;
    } catch (error) {
      throw error;
    }
  },

  // Auth endpoints
  async register(username, email, password) {
    return this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password }),
    });
  },

  async login(username, password) {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },

  async logout() {
    const refreshToken = localStorage.getItem('refreshToken');
    return this.request('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },

  async getProfile() {
    return this.request('/auth/profile');
  },

  // Profile management endpoints
  async changePassword(currentPassword, newPassword) {
    return this.request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  },

  async deleteAccount() {
    return this.request('/auth/delete-account', {
      method: 'DELETE',
    });
  },

  async uploadProfilePicture(file) {
    const formData = new FormData();
    formData.append('avatar', file);
    
    const token = localStorage.getItem('accessToken');
    const response = await fetch(`${API_URL}/auth/upload-avatar`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error('Failed to upload avatar');
    }

    return response.json();
  },

  async removeProfilePicture() {
    return this.request('/auth/remove-avatar', {
      method: 'DELETE',
    });
  },

  // Notes endpoints
  async getNotes() {
    return this.request('/notes');
  },

  async getNote(id) {
    return this.request(`/notes/${id}`);
  },

  async createNote(title, content, encrypted = true) {
    return this.request('/notes', {
      method: 'POST',
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async updateNote(id, title, content, encrypted = true) {
    return this.request(`/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async updateSharedNote(id, title, content, encrypted = true) {
    return this.request(`/sharing/shared-notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, content, encrypted }),
    });
  },

  async deleteNote(id) {
    return this.request(`/notes/${id}`, {
      method: 'DELETE',
    });
  },

  // Friends endpoints
  async searchUsers(username) {
    return this.request(`/friends/search?username=${encodeURIComponent(username)}`);
  },

  async sendFriendRequest(friendUsername) {
    return this.request('/friends/request', {
      method: 'POST',
      body: JSON.stringify({ friendUsername }),
    });
  },

  async getPendingFriendRequests() {
    return this.request('/friends/requests');
  },

  async getFriends() {
    return this.request('/friends');
  },

  async removeFriend(friendId) {
    return this.request(`/friends/${friendId}`, {
      method: 'DELETE',
    });
  },

  async acceptFriendRequest(friendshipId) {
    return this.request(`/friends/accept/${friendshipId}`, {
      method: 'POST',
    });
  },

  // Sharing endpoints
  async getNoteShares(noteId) {
    return this.request(`/sharing/notes/${noteId}/shares`);
  },

  async getSharedWithMe() {
    return this.request('/sharing/shared-with-me');
  },

  async getSharedNote(noteId) {
    return this.request(`/sharing/notes/${noteId}`);
  },

  async shareNote(noteId, friendId, permission = 'read') {
    return this.request(`/sharing/notes/${noteId}/share`, {
      method: 'POST',
      body: JSON.stringify({ friendId, permission }),
    });
  },

  async unshareNote(noteId, friendId) {
    return this.request(`/sharing/notes/${noteId}/share/${friendId}`, {
      method: 'DELETE'
    });
  },

  async updateSharePermission(noteId, friendId, permission) {
    return this.request(`/sharing/notes/${noteId}/share/${friendId}`, {
      method: 'PUT',
      body: JSON.stringify({ permission })
    });
  },
};