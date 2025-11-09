const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');

// Send a friend request
exports.sendFriendRequest = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendUsername } = req.body;

        // Find the friend by username
        const friendResult = await pool.query(
            'SELECT id, username FROM users WHERE username = $1',
            [friendUsername]
        );

        if (friendResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'User not found' } });
        }

        const friendId = friendResult.rows[0].id;

        // Can't friend yourself
        if (friendId === userId) {
            return res.status(400).json({ error: { message: 'Cannot send friend request to yourself' } });
        }

        // Check if friendship already exists (in either direction)
        const existingFriendship = await pool.query(
            `SELECT * FROM friendships 
             WHERE (user_id = $1 AND friend_id = $2) 
             OR (user_id = $2 AND friend_id = $1)`,
            [userId, friendId]
        );

        if (existingFriendship.rows.length > 0) {
            const status = existingFriendship.rows[0].status;
            if (status === 'accepted') {
                return res.status(400).json({ error: { message: 'Already friends' } });
            } else if (status === 'pending') {
                return res.status(400).json({ error: { message: 'Friend request already sent' } });
            }
        }

        // Create friend request
        await pool.query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3)',
            [userId, friendId, 'pending']
        );

        await auditLog(userId, 'FRIEND_REQUEST_SENT', true, req, { friendId, friendUsername });
        logger.info(`Friend request sent by user ${userId} to user ${friendId}`);

        res.status(201).json({ 
            message: 'Friend request sent',
            friend: { id: friendId, username: friendUsername }
        });
    } catch (err) {
        logger.error('Send friend request error:', err);
        res.status(500).json({ error: { message: 'Failed to send friend request' } });
    }
};

// Get pending friend requests (received)
exports.getPendingRequests = async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(
            `SELECT f.id, f.user_id, u.username, f.requested_at
             FROM friendships f
             JOIN users u ON f.user_id = u.id
             WHERE f.friend_id = $1 AND f.status = 'pending'
             ORDER BY f.requested_at DESC`,
            [userId]
        );

        logger.info(`Pending requests fetched by user ${userId}`);
        res.json({ requests: result.rows });
    } catch (err) {
        logger.error('Get pending requests error:', err);
        res.status(500).json({ error: { message: 'Failed to get pending requests' } });
    }
};

// Accept friend request
exports.acceptFriendRequest = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        logger.info('Accepting friendship ID:', req.params.friendshipId);
        logger.info('Authenticated user ID:', req.user.userId);

        const userId = req.user.userId;
        const { friendshipId } = req.params;

        // Verify this request is for the current user
        const friendship = await pool.query(
            'SELECT * FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
            [friendshipId, userId, 'pending']
        );

        if (friendship.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Friend request not found' } });
        }

        // Update status to accepted
        await pool.query(
            'UPDATE friendships SET status = $1, accepted_at = CURRENT_TIMESTAMP WHERE id = $2',
            ['accepted', friendshipId]
        );

        await auditLog(userId, 'FRIEND_REQUEST_ACCEPTED', true, req, { friendshipId });
        logger.info(`Friend request ${friendshipId} accepted by user ${userId}`);

        res.json({ message: 'Friend request accepted' });
    } catch (err) {
        logger.error('Accept friend request error:', err);
        res.status(500).json({ error: { message: 'Failed to accept friend request' } });
    }
};

// Reject friend request
exports.rejectFriendRequest = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendshipId } = req.params;

        // Verify and delete the request
        const result = await pool.query(
            'DELETE FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
            [friendshipId, userId, 'pending']
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Friend request not found' } });
        }

        await auditLog(userId, 'FRIEND_REQUEST_REJECTED', true, req, { friendshipId });
        logger.info(`Friend request ${friendshipId} rejected by user ${userId}`);

        res.json({ message: 'Friend request rejected' });
    } catch (err) {
        logger.error('Reject friend request error:', err);
        res.status(500).json({ error: { message: 'Failed to reject friend request' } });
    }
};

// Get all friends (accepted friendships)
exports.getFriends = async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(
            `SELECT DISTINCT
                CASE 
                    WHEN f.user_id = $1 THEN f.friend_id
                    ELSE f.user_id
                END as friend_id,
                u.username,
                f.accepted_at
             FROM friendships f
             JOIN users u ON (
                 CASE 
                     WHEN f.user_id = $1 THEN f.friend_id
                     ELSE f.user_id
                 END = u.id
             )
             WHERE (f.user_id = $1 OR f.friend_id = $1) AND f.status = 'accepted'
             ORDER BY u.username`,
            [userId]
        );

        logger.info(`Friends list fetched by user ${userId}`);
        res.json({ friends: result.rows });
    } catch (err) {
        logger.error('Get friends error:', err);
        res.status(500).json({ error: { message: 'Failed to get friends' } });
    }
};

// Remove friend
exports.removeFriend = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendId } = req.params;

        const result = await pool.query(
            `DELETE FROM friendships 
             WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
             AND status = 'accepted'`,
            [userId, friendId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Friendship not found' } });
        }

        await auditLog(userId, 'FRIEND_REMOVED', true, req, { friendId });
        logger.info(`User ${userId} removed friend ${friendId}`);

        res.json({ message: 'Friend removed' });
    } catch (err) {
        logger.error('Remove friend error:', err);
        res.status(500).json({ error: { message: 'Failed to remove friend' } });
    }
};

// Search users by username
exports.searchUsers = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { username } = req.query;

        const result = await pool.query(
            `SELECT id, username 
             FROM users 
             WHERE username ILIKE $1 AND id != $2
             LIMIT 10`,
            [`%${username}%`, userId]
        );

        logger.info(`User search performed by user ${userId}`);
        res.json({ users: result.rows });
    } catch (err) {
        logger.error('Search users error:', err);
        res.status(500).json({ error: { message: 'Failed to search users' } });
    }
};