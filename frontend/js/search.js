// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    redirectIfNotAuthenticated();
    
    initializeSearchPage();
    setupSearchListeners();
    setupModalListeners();
    setupFriendActionListeners();
    setupNavigationListeners();
});

// ==================== Page Initialization ====================
async function initializeSearchPage() {
    await loadFriends();
}

// ==================== Event Listener Setup ====================
function setupSearchListeners() {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    
    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keypress', handleSearchKeypress);
    searchInput.addEventListener('input', handleSearchInput);
}

function setupModalListeners() {
    const closeModal = document.querySelector('.close');
    const profileModal = document.getElementById('profileModal');
    
    closeModal.addEventListener('click', closeProfileModal);
    window.addEventListener('click', (e) => {
        if (e.target === profileModal) {
            closeProfileModal();
        }
    });
}

function setupFriendActionListeners() {
    const addFriendBtn = document.getElementById('addFriendBtn');
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    
    addFriendBtn.addEventListener('click', handleAddFriend);
    removeFriendBtn.addEventListener('click', handleRemoveFriend);
}

function setupNavigationListeners() {
    const logoutBtn = document.getElementById('logoutBtn');
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logout();
    });
}

// ==================== State Management ====================
let currentSelectedUser = null;
let myFriends = [];

// ==================== Search Functions ====================
function handleSearchKeypress(e) {
    if (e.key === 'Enter') {
        performSearch();
    }
}

let searchTimeout;
function handleSearchInput(e) {
    clearTimeout(searchTimeout);
    const query = e.target.value.trim();
    const searchResults = document.getElementById('searchResults');
    
    if (query.length >= 2) {
        searchTimeout = setTimeout(() => {
            performSearch();
        }, 500);
    } else if (query.length === 0) {
        searchResults.innerHTML = '<p class="search-hint">Enter a username to search for users</p>';
    }
}

async function performSearch() {
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const query = searchInput.value.trim();
    
    if (query.length < 2) {
        showAlert('Please enter at least 2 characters', 'error');
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
        console.error('Search error:', error);
        searchResults.innerHTML = '<p class="error">Failed to search users. Please try again.</p>';
        showAlert('Failed to search users', 'error');
    }
}

function displaySearchResults(users) {
    const searchResults = document.getElementById('searchResults');
    searchResults.innerHTML = '';
    
    users.forEach(user => {
        const userCard = createUserCard(user);
        searchResults.appendChild(userCard);
    });

    attachProfileButtonListeners();
}

function createUserCard(user) {
    const userCard = document.createElement('div');
    userCard.className = 'user-card';
    
    const isFriend = myFriends.some(friend => friend.friend_id === user.id);
    
    userCard.innerHTML = `
        <img src="${getUserAvatar(user.username)}" alt="${user.username}" class="user-avatar">
        <div class="user-info">
            <h3>${escapeHtml(user.username)}</h3>
            ${isFriend ? '<span class="friend-badge">Friend</span>' : ''}
        </div>
        <button class="btn-view-profile" data-user-id="${user.id}" data-username="${user.username}">
            View Profile
        </button>
    `;
    
    return userCard;
}

function attachProfileButtonListeners() {
    document.querySelectorAll('.btn-view-profile').forEach(btn => {
        btn.addEventListener('click', () => {
            const userId = parseInt(btn.dataset.userId);
            const username = btn.dataset.username;
            openProfileModal(userId, username);
        });
    });
}

// ==================== Profile Modal Functions ====================
async function openProfileModal(userId, username) {
    const profileModal = document.getElementById('profileModal');
    const profilePicture = document.getElementById('profilePicture');
    const profileUsername = document.getElementById('profileUsername');
    const profileMemberSince = document.getElementById('profileMemberSince');
    
    currentSelectedUser = { id: userId, username: username };
    
    // Set profile information
    profilePicture.src = getUserAvatar(username);
    profileUsername.textContent = username;
    profileMemberSince.textContent = 'Member since 2025';
    
    // Check and update friendship status
    await updateFriendshipStatus(userId);
    
    // Show modal
    profileModal.style.display = 'block';
}

function closeProfileModal() {
    const profileModal = document.getElementById('profileModal');
    profileModal.style.display = 'none';
    currentSelectedUser = null;
}

async function updateFriendshipStatus(userId) {
    const isFriend = myFriends.some(friend => friend.friend_id === userId);
    
    if (isFriend) {
        showFriendStatus();
    } else {
        await checkPendingRequest(userId);
    }
}

function showFriendStatus() {
    const addFriendBtn = document.getElementById('addFriendBtn');
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    const friendshipStatus = document.getElementById('friendshipStatus');
    
    addFriendBtn.style.display = 'none';
    removeFriendBtn.style.display = 'block';
    friendshipStatus.textContent = '✓ You are friends';
    friendshipStatus.className = 'friendship-status friends';
}

async function checkPendingRequest(userId) {
    try {
        const response = await api.getPendingFriendRequests();
        const hasPendingRequest = response.requests.some(req => req.user_id === userId);
        
        if (hasPendingRequest) {
            showPendingStatus();
        } else {
            showAddFriendButton();
        }
    } catch (error) {
        console.error('Error checking friend requests:', error);
        showAddFriendButton();
    }
}

function showPendingStatus() {
    const addFriendBtn = document.getElementById('addFriendBtn');
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    const friendshipStatus = document.getElementById('friendshipStatus');
    
    addFriendBtn.style.display = 'none';
    removeFriendBtn.style.display = 'none';
    friendshipStatus.textContent = 'Friend request pending';
    friendshipStatus.className = 'friendship-status pending';
}

function showAddFriendButton() {
    const addFriendBtn = document.getElementById('addFriendBtn');
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    const friendshipStatus = document.getElementById('friendshipStatus');
    
    addFriendBtn.style.display = 'block';
    removeFriendBtn.style.display = 'none';
    friendshipStatus.textContent = '';
}

// ==================== Friend Actions ====================
async function handleAddFriend() {
    if (!currentSelectedUser) return;
    
    const addFriendBtn = document.getElementById('addFriendBtn');
    const friendshipStatus = document.getElementById('friendshipStatus');
    
    try {
        setButtonLoading(addFriendBtn, 'Sending...');
        
        await api.sendFriendRequest(currentSelectedUser.username);
        
        friendshipStatus.textContent = 'Friend request sent!';
        friendshipStatus.className = 'friendship-status pending';
        addFriendBtn.style.display = 'none';
        
        showAlert('Friend request sent successfully!', 'success');
    } catch (error) {
        console.error('Error sending friend request:', error);
        showAlert('Friend request already sent.', 'error');
        resetButton(addFriendBtn, 'Add Friend');    
    }
}

async function handleRemoveFriend() {
    if (!currentSelectedUser) return;
    
    if (!confirm(`Are you sure you want to remove ${currentSelectedUser.username} as a friend?`)) {
        return;
    }
    
    const removeFriendBtn = document.getElementById('removeFriendBtn');
    const addFriendBtn = document.getElementById('addFriendBtn');
    const friendshipStatus = document.getElementById('friendshipStatus');
    const searchInput = document.getElementById('searchInput');
    
    try {
        setButtonLoading(removeFriendBtn, 'Removing...');
        
        await api.removeFriend(currentSelectedUser.id);
        
        // Update UI
        addFriendBtn.style.display = 'block';
        removeFriendBtn.style.display = 'none';
        friendshipStatus.textContent = '';
        
        // Reload friends list
        await loadFriends();
        
        // Refresh search results if any
        if (searchInput.value.trim().length >= 2) {
            await performSearch();
        }
        
        showAlert('Friend removed successfully', 'success');
        closeProfileModal();
    } catch (error) {
        console.error('Error removing friend:', error);
        showAlert('Failed to remove friend', 'error');
        resetButton(removeFriendBtn, 'Remove Friend');
    }
}

// ==================== Data Loading ====================
async function loadFriends() {
    try {
        const response = await api.getFriends();
        myFriends = response.friends;
    } catch (error) {
        console.error('Error loading friends:', error);
        showAlert('Failed to load friends list', 'error');
    }
}

// ==================== Utility Functions ====================
function getUserAvatar(username) {
    return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(username)}`;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function setButtonLoading(button, text) {
    button.disabled = true;
    button.textContent = text;
}

function resetButton(button, text) {
    button.disabled = false;
    button.textContent = text;
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    
    const container = document.querySelector('.search-container');
    container.insertBefore(alertDiv, document.getElementById('searchResults'));
    
    setTimeout(() => alertDiv.remove(), 3000);
}