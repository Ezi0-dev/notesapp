const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');
const { executeAsSystem } = require('../middleware/rlsContext');

// Helper to get the correct database client (RLS-aware if available, otherwise pool)
const getDbClient = (req) => req.dbClient || pool;

// Send a friend request
exports.sendFriendRequest = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn('Friend request validation failed:', errors.array());
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendUsername: friendUsernameFromBody, friendId: friendIdFromBody } = req.body;

        logger.info('Friend request received', {
            userId,
            friendUsernameFromBody,
            friendIdFromBody,
            bodyKeys: Object.keys(req.body)
        });

        // Additional safety check: ensure at least one is provided and not empty
        // Handle both undefined and empty string cases
        const hasFriendUsername = friendUsernameFromBody && typeof friendUsernameFromBody === 'string' && friendUsernameFromBody.trim().length > 0;
        const hasFriendId = friendIdFromBody && typeof friendIdFromBody === 'string' && friendIdFromBody.trim().length > 0;

        if (!hasFriendUsername && !hasFriendId) {
            logger.warn('Friend request missing both username and ID', { userId });
            return res.status(400).json({ error: { message: 'Either friendUsername or friendId is required' } });
        }

        let friendId;
        let friendUsername;

        // Support both friendId and friendUsername for flexibility
        if (hasFriendId) {
            // Additional UUID format validation
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(friendIdFromBody.trim())) {
                logger.warn('Invalid UUID format for friendId', { friendId: friendIdFromBody, userId });
                return res.status(400).json({ error: { message: 'Invalid friend ID format' } });
            }

            // Find the friend by ID
            const friendResult = await getDbClient(req).query(
                'SELECT id, username FROM users WHERE id = $1',
                [friendIdFromBody.trim()]
            );

            if (friendResult.rows.length === 0) {
                return res.status(404).json({ error: { message: 'User not found' } });
            }

            friendId = friendResult.rows[0].id;
            friendUsername = friendResult.rows[0].username;
        } else if (hasFriendUsername) {
            // Find the friend by username
            const friendResult = await getDbClient(req).query(
                'SELECT id, username FROM users WHERE username = $1',
                [friendUsernameFromBody.trim()]
            );

            if (friendResult.rows.length === 0) {
                return res.status(404).json({ error: { message: 'User not found' } });
            }

            friendId = friendResult.rows[0].id;
            friendUsername = friendResult.rows[0].username;
        } else {
            return res.status(400).json({ error: { message: 'Either friendUsername or friendId is required' } });
        }

        logger.info('Friend lookup completed', {
            userId,
            friendId,
            friendUsername,
            friendIdType: typeof friendId,
            friendIdLength: friendId ? friendId.length : 0
        });

        // Can't friend yourself
        if (friendId === userId) {
            return res.status(400).json({ error: { message: 'Cannot send friend request to yourself' } });
        }

        // Validate friendId is a proper UUID before querying
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!friendId || !uuidRegex.test(friendId)) {
            logger.error('Invalid friendId after lookup', { friendId, userId });
            return res.status(400).json({ error: { message: 'Invalid friend ID' } });
        }

        // Check if friendship already exists (in either direction)
        // Use the RLS-enabled client - this will check friendships where current user is involved
        logger.debug('Checking for existing friendship', { userId, friendId });
        const existingFriendship = await getDbClient(req).query(
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

        // Create friend request using RLS-enabled client
        // The RLS policy allows INSERT where user_id = current_setting('app.user_id')
        const friendshipResult = await getDbClient(req).query(
            'INSERT INTO friendships (user_id, friend_id, status) VALUES ($1, $2, $3) RETURNING *',
            [userId, friendId, 'pending']
        );

        const friendship = friendshipResult.rows[0];

        // Create notification for the friend
        // The RLS policy on notifications allows INSERT with WITH CHECK (true), so we can create notifications for any user
        const requesterUsername = req.user.username;
        await getDbClient(req).query(
            'INSERT INTO notifications (user_id, type, from_user_id, related_id, message) VALUES ($1, $2, $3, $4, $5)',
            [
                friendId,
                'friend_request',
                userId,
                friendship.id,
                `${requesterUsername} sent you a friend request`
            ]
        );

        await auditLog(userId, 'FRIEND_REQUEST_SENT', true, req, { friendId, friendUsername });
        logger.info(`Friend request sent by user ${userId} to user ${friendId}`);

        res.status(201).json(friendship);
    } catch (err) {
        logger.error('Send friend request error:', err);

        // Handle specific PostgreSQL errors
        if (err.code === '22P02') {
            logger.error('Invalid UUID format passed to database', { error: err.message });
            return res.status(400).json({ error: { message: 'Invalid user ID format' } });
        }

        if (err.code === '23505') {
            // Unique constraint violation - friendship already exists
            return res.status(400).json({ error: { message: 'Friend request already exists' } });
        }

        res.status(500).json({ error: { message: 'Failed to send friend request' } });
    }
};

// Get pending friend requests (received)
exports.getPendingRequests = async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await getDbClient(req).query(
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
            logger.warn('Accept friend request validation failed:', errors.array());
            return res.status(400).json({ errors: errors.array() });
        }

        logger.info('Accepting friendship ID:', req.params.friendshipId);
        logger.info('Authenticated user ID:', req.user.userId);

        const userId = req.user.userId;
        const { friendshipId } = req.params;

        // Additional UUID format validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!friendshipId || !uuidRegex.test(friendshipId)) {
            logger.warn('Invalid UUID format for friendshipId in acceptFriendRequest', { friendshipId, userId });
            return res.status(400).json({ error: { message: 'Invalid friendship ID format' } });
        }

        // Verify this request is for the current user
        const friendship = await getDbClient(req).query(
            'SELECT * FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
            [friendshipId, userId, 'pending']
        );

        if (friendship.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Friend request not found' } });
        }

        const requesterId = friendship.rows[0].user_id;

        // Update status to accepted
        const updateResult = await getDbClient(req).query(
            'UPDATE friendships SET status = $1, accepted_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING *',
            ['accepted', friendshipId]
        );

        // Mark the friend request notification as read
        await getDbClient(req).query(
            `UPDATE notifications
             SET is_read = TRUE
             WHERE user_id = $1 AND type = 'friend_request' AND related_id = $2`,
            [userId, friendshipId]
        );

        // Create notification for requester that their request was accepted
        // The RLS policy on notifications allows INSERT with WITH CHECK (true)
        const accepterUsername = req.user.username;
        await getDbClient(req).query(
            `INSERT INTO notifications (user_id, type, from_user_id, related_id, message)
             VALUES ($1, $2, $3, $4, $5)`,
            [requesterId, 'friend_request', userId, friendshipId, `${accepterUsername} accepted your friend request!`]
        );

        await auditLog(userId, 'FRIEND_REQUEST_ACCEPTED', true, req, { friendshipId });
        logger.info(`Friend request ${friendshipId} accepted by user ${userId}`);

        res.json(updateResult.rows[0]);
    } catch (err) {
        logger.error('Accept friend request error:', err);

        // Handle specific PostgreSQL errors
        if (err.code === '22P02') {
            logger.error('Invalid UUID format passed to database', { error: err.message });
            return res.status(400).json({ error: { message: 'Invalid friendship ID format' } });
        }

        res.status(500).json({ error: { message: 'Failed to accept friend request' } });
    }
};

// Reject friend request
exports.rejectFriendRequest = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            logger.warn('Reject friend request validation failed:', errors.array());
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendshipId } = req.params;

        // Additional UUID format validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!friendshipId || !uuidRegex.test(friendshipId)) {
            logger.warn('Invalid UUID format for friendshipId in rejectFriendRequest', { friendshipId, userId });
            return res.status(400).json({ error: { message: 'Invalid friendship ID format' } });
        }

        // Verify and delete the request
        const result = await getDbClient(req).query(
            'DELETE FROM friendships WHERE id = $1 AND friend_id = $2 AND status = $3',
            [friendshipId, userId, 'pending']
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Friend request not found' } });
        }

        // Delete notification
        await getDbClient(req).query(
            'DELETE FROM notifications WHERE user_id = $1 AND type = $2 AND related_id = $3',
            [userId, 'friend_request', friendshipId]
        );

        await auditLog(userId, 'FRIEND_REQUEST_REJECTED', true, req, { friendshipId });
        logger.info(`Friend request ${friendshipId} rejected by user ${userId}`);

        res.json({ message: 'Friend request rejected' });
    } catch (err) {
        logger.error('Reject friend request error:', err);

        // Handle specific PostgreSQL errors
        if (err.code === '22P02') {
            logger.error('Invalid UUID format passed to database', { error: err.message });
            return res.status(400).json({ error: { message: 'Invalid friendship ID format' } });
        }

        res.status(500).json({ error: { message: 'Failed to reject friend request' } });
    }
};

// Get all friends (accepted friendships)
exports.getFriends = async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await getDbClient(req).query(
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
            logger.warn('Remove friend validation failed:', errors.array());
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { friendId } = req.params;

        // Additional UUID format validation
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!friendId || !uuidRegex.test(friendId)) {
            logger.warn('Invalid UUID format for friendId in removeFriend', { friendId, userId });
            return res.status(400).json({ error: { message: 'Invalid friend ID format' } });
        }

        // Delete friendship in either direction using RLS-enabled client
        // The RLS policy allows DELETE where user is involved in the friendship
        const result = await getDbClient(req).query(
            `DELETE FROM friendships
             WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
             AND status = 'accepted'
             RETURNING id`,
            [userId, friendId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Friendship not found' } });
        }

        const friendshipId = result.rows[0].id;

        // Remove all note shares between these users (both directions)
        // The RLS policy allows DELETE where user is owner or shared_with
        await getDbClient(req).query(
            `DELETE FROM note_shares
             WHERE (owner_id = $1 AND shared_with_id = $2)
             OR (owner_id = $2 AND shared_with_id = $1)`,
            [userId, friendId]
        );

        // Delete notifications related to this friendship
        // The RLS policy only allows deleting own notifications, so we can only delete notifications for current user
        // Notifications for the other user will remain (this is acceptable - they can see "User X removed you as friend")
        await getDbClient(req).query(
            `DELETE FROM notifications
             WHERE user_id = $1 AND related_id = $2 AND type IN ('friend_request', 'note_shared')`,
            [userId, friendshipId]
        );

        await auditLog(userId, 'FRIEND_REMOVED', true, req, { friendId });
        logger.info(`User ${userId} removed friend ${friendId} and unshared all notes`);

        res.json({ message: 'Friend removed' });
    } catch (err) {
        logger.error('Remove friend error:', err);

        // Handle specific PostgreSQL errors
        if (err.code === '22P02') {
            logger.error('Invalid UUID format passed to database', { error: err.message });
            return res.status(400).json({ error: { message: 'Invalid friend ID format' } });
        }

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

        const result = await getDbClient(req).query(
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