const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { encrypt, decrypt } = require('../utils/encryption');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');

// Share a note with a friend
exports.shareNote = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { noteId } = req.params;
        const { friendId, permission = 'read' } = req.body;

        // Verify user owns the note
        const noteResult = await pool.query(
            'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
            [noteId, userId]
        );

        if (noteResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Note not found or unauthorized' } });
        }

        // Verify they are friends
        const friendshipResult = await pool.query(
            `SELECT * FROM friendships 
             WHERE ((user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1))
             AND status = 'accepted'`,
            [userId, friendId]
        );

        if (friendshipResult.rows.length === 0) {
            return res.status(403).json({ error: { message: 'Can only share with accepted friends' } });
        }

        // Check if already shared
        const existingShare = await pool.query(
            'SELECT * FROM note_shares WHERE note_id = $1 AND shared_with_id = $2',
            [noteId, friendId]
        );

        if (existingShare.rows.length > 0) {
            return res.status(400).json({ error: { message: 'Note already shared with this user' } });
        }

        // Create share
        await pool.query(
            'INSERT INTO note_shares (note_id, owner_id, shared_with_id, permission) VALUES ($1, $2, $3, $4)',
            [noteId, userId, friendId, permission]
        );

        // Create notification for the friend
        const note = noteResult.rows[0];
        const ownerResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const ownerUsername = ownerResult.rows[0].username;

        await pool.query(
            'INSERT INTO notifications (user_id, type, from_user_id, related_id, message) VALUES ($1, $2, $3, $4, $5)',
            [
                friendId,
                'note_shared',
                userId,
                noteId,
                `${ownerUsername} shared a note "${note.title}" with you`
            ]
        );

        await auditLog(userId, 'NOTE_SHARED', true, req, { noteId, friendId, permission });
        logger.info(`Note ${noteId} shared by user ${userId} with user ${friendId}`);

        res.status(201).json({ message: 'Note shared successfully' });
    } catch (err) {
        logger.error('Share note error:', err);
        res.status(500).json({ error: { message: 'Failed to share note' } });
    }
};

// Unshare a note
exports.unshareNote = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { noteId, friendId } = req.params;

        // Get note details before deleting the share
        const noteResult = await pool.query(
            'SELECT title FROM notes WHERE id = $1',
            [noteId]
        );

        const result = await pool.query(
            'DELETE FROM note_shares WHERE note_id = $1 AND owner_id = $2 AND shared_with_id = $3',
            [noteId, userId, friendId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Share not found' } });
        }

        // Create notification for the friend
        if (noteResult.rows.length > 0) {
            const noteTitle = noteResult.rows[0].title;
            const ownerResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
            const ownerUsername = ownerResult.rows[0].username;

            await pool.query(
                'INSERT INTO notifications (user_id, type, from_user_id, related_id, message) VALUES ($1, $2, $3, $4, $5)',
                [
                    friendId,
                    'note_unshared',
                    userId,
                    noteId,
                    `${ownerUsername} unshared the note "${noteTitle}" with you`
                ]
            );
        }

        await auditLog(userId, 'NOTE_UNSHARED', true, req, { noteId, friendId });
        logger.info(`Note ${noteId} unshared by user ${userId} from user ${friendId}`);

        res.json({ message: 'Note unshared successfully' });
    } catch (err) {
        logger.error('Unshare note error:', err);
        res.status(500).json({ error: { message: 'Failed to unshare note' } });
    }
};

// Get notes shared with current user
exports.getSharedWithMe = async (req, res) => {
    try {
        const userId = req.user.userId;

        const result = await pool.query(
            `SELECT 
                n.id, 
                n.title, 
                n.content, 
                n.created_at, 
                n.updated_at,
                n.encrypted,
                u.username as owner_username,
                ns.owner_id,
                ns.permission,
                ns.shared_at
             FROM note_shares ns
             JOIN notes n ON ns.note_id = n.id
             JOIN users u ON ns.owner_id = u.id
             WHERE ns.shared_with_id = $1
             ORDER BY ns.shared_at DESC`,
            [userId]
        );

        // Decrypt notes if encrypted
        const decryptedNotes = result.rows.map(note => {
            if (note.encrypted) {
                try {
                    return {
                        ...note,
                        content: decrypt(note.content)
                    };
                } catch (decryptError) {
                    logger.error('Decryption failed for shared note:', { noteId: note.id, error: decryptError.message });
                    return {
                        ...note,
                        title: '[Decryption Error]',
                        content: '[Unable to decrypt content]'
                    };
                }
            }
            return note;
        });

        logger.info(`Shared notes fetched by user ${userId}`);
        res.json({ notes: decryptedNotes });
    } catch (err) {
        logger.error('Get shared notes error:', err);
        res.status(500).json({ error: { message: 'Failed to get shared notes' } });
    }
};

exports.getSharedNote = async (req, res) => {
    try {
        const userId = req.user.userId;
        const noteId = req.params.id;

        const result = await pool.query(
            `SELECT 
                n.id, 
                n.title, 
                n.content, 
                n.created_at, 
                n.updated_at,
                n.encrypted,
                u.username as owner_username,
                ns.owner_id,
                ns.permission,
                ns.shared_at
             FROM note_shares ns
             JOIN notes n ON ns.note_id = n.id
             JOIN users u ON ns.owner_id = u.id
             WHERE ns.shared_with_id = $1 AND n.id = $2`,
            [userId, noteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Shared note not found' } });
        }

        const note = result.rows[0];

        if (note.encrypted) {
            try {
                note.content = decrypt(note.content);
            } catch (decryptError) {
                logger.error('Decryption failed:', { noteId, error: decryptError.message });
                return res.status(500).json({ error: { message: 'Failed to decrypt note' } });
            }
        }

        res.json({ note });
    } catch (err) {
        logger.error('Get shared note error:', err);
        res.status(500).json({ error: { message: 'Failed to get shared note' } });
    }
};

// Get list of users a note is shared with
exports.getNoteShares = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { noteId } = req.params;

        // Verify user owns the note
        const noteResult = await pool.query(
            'SELECT * FROM notes WHERE id = $1 AND user_id = $2',
            [noteId, userId]
        );

        if (noteResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Note not found or unauthorized' } });
        }

        // Get all shares for this note
        const result = await pool.query(
            `SELECT 
                ns.id,
                ns.shared_with_id,
                u.username,
                ns.permission,
                ns.shared_at
             FROM note_shares ns
             JOIN users u ON ns.shared_with_id = u.id
             WHERE ns.note_id = $1
             ORDER BY ns.shared_at DESC`,
            [noteId]
        );

        logger.info(`Note shares fetched for note ${noteId} by user ${userId}`);
        res.json({ shares: result.rows });
    } catch (err) {
        logger.error('Get note shares error:', err);
        res.status(500).json({ error: { message: 'Failed to get note shares' } });
    }
};

// Update share permission
exports.updateSharePermission = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { noteId, friendId } = req.params;
        const { permission } = req.body;

        // Get note details before updating
        const noteResult = await pool.query(
            'SELECT title FROM notes WHERE id = $1',
            [noteId]
        );

        if (noteResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Note not found' } });
        }

        const result = await pool.query(
            'UPDATE note_shares SET permission = $1 WHERE note_id = $2 AND owner_id = $3 AND shared_with_id = $4',
            [permission, noteId, userId, friendId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: { message: 'Share not found' } });
        }

        // Create notification for the friend
        const noteTitle = noteResult.rows[0].title;
        const ownerResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const ownerUsername = ownerResult.rows[0].username;

        await pool.query(
            'INSERT INTO notifications (user_id, type, from_user_id, related_id, message) VALUES ($1, $2, $3, $4, $5)',
            [
                friendId,
                'share_permission_updated',
                userId,
                noteId,
                `${ownerUsername} changed your permission to "${permission}" for note "${noteTitle}"`
            ]
        );

        await auditLog(userId, 'SHARE_PERMISSION_UPDATED', true, req, { noteId, friendId, permission });
        logger.info(`Share permission updated for note ${noteId} by user ${userId}`);

        res.json({ message: 'Permission updated successfully' });
    } catch (err) {
        logger.error('Update permission error:', err);
        res.status(500).json({ error: { message: 'Failed to update permission' } });
    }
};

// If a user wants to leave a note that has been shared with them
exports.leaveSharedNote = async (req, res) => {
    try {
        const userId = req.user.userId;
        const { noteId } = req.params;

        // Get share and note details before deleting
        const shareResult = await pool.query(
            `SELECT ns.owner_id, n.title
             FROM note_shares ns
             JOIN notes n ON ns.note_id = n.id
             WHERE ns.note_id = $1 AND ns.shared_with_id = $2`,
            [noteId, userId]
        );

        if (shareResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Shared note not found' } });
        }

        const ownerId = shareResult.rows[0].owner_id;
        const noteTitle = shareResult.rows[0].title;

        const result = await pool.query(
            'DELETE FROM note_shares WHERE note_id = $1 AND shared_with_id = $2',
            [noteId, userId]
        );

        // Create notification for the owner
        const leaverResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
        const leaverUsername = leaverResult.rows[0].username;

        await pool.query(
            'INSERT INTO notifications (user_id, type, from_user_id, related_id, message) VALUES ($1, $2, $3, $4, $5)',
            [
                ownerId,
                'note_left',
                userId,
                noteId,
                `${leaverUsername} left the shared note "${noteTitle}"`
            ]
        );

        logger.info(`User ${userId} left shared note ${noteId}`);
        await auditLog(userId, 'LEAVE_NOTE', true, req, { noteId });

        res.json({ message: 'Successfully left shared note' });

    } catch (err) {
        logger.error('Leave shared note error:', err);
        res.status(500).json({ error: { message: 'Failed to leave shared note' } });
    }
};

// Update a shared note (for users with write permission)
exports.updateSharedNote = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const userId = req.user.userId;
        const { noteId } = req.params;
        const { title, content } = req.body;

        // Check if user has write permission
        const shareResult = await pool.query(
            'SELECT * FROM note_shares WHERE note_id = $1 AND shared_with_id = $2 AND permission = $3',
            [noteId, userId, 'write']
        );

        if (shareResult.rows.length === 0) {
            return res.status(403).json({ error: { message: 'No write permission for this note' } });
        }

        // Get note to check if it's encrypted
        const noteResult = await pool.query(
            'SELECT encrypted FROM notes WHERE id = $1',
            [noteId]
        );

        if (noteResult.rows.length === 0) {
            return res.status(404).json({ error: { message: 'Note not found' } });
        }

        const isEncrypted = noteResult.rows[0].encrypted;

        // Encrypt if needed
        let finalContent = content;

        if (isEncrypted) {
            try {
                finalContent = encrypt(content);
            } catch (encryptError) {
                logger.error('Encryption failed:', { userId, error: encryptError.message });
                return res.status(500).json({ error: { message: 'Failed to update note' } });
            }
        }

        await pool.query(
            'UPDATE notes SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
            [title, finalContent, noteId]
        );

        await auditLog(userId, 'SHARED_NOTE_UPDATED', true, req, { noteId });
        logger.info(`Shared note ${noteId} updated by user ${userId}`);

        res.json({ message: 'Shared note updated successfully' });
    } catch (err) {
        logger.error('Update shared note error:', err);
        res.status(500).json({ error: { message: 'Failed to update shared note' } });
    }
};