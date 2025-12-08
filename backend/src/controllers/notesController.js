const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { encrypt, decrypt } = require('../utils/encryption');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');
const { logSecurityEvent } = require('../utils/securityLogger');

// Helper to get the correct database client (RLS-aware if available, otherwise pool)
const getDbClient = (req) => req.dbClient || pool;

exports.createNote = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, content, encrypted = true } = req.body;
    const userId = req.user.userId;

    // Validate content
    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        error: { message: 'Note content cannot be empty' } 
      });
    }

    let finalContent;

    if (encrypted) {
      try {
        finalContent = encrypt(content);
        logger.info(`Note content encrypted for user ${userId}`);
      } catch (encryptError) {
        logger.error('Encryption failed:', {
          userId,
          error: encryptError.message
        });
        
        await logSecurityEvent(
          'ENCRYPTION_FAILURE',
          'MEDIUM',
          userId,
          req,
          { 
            noteId: id,
            operation: 'CREATE_NOTE',
            error: encryptError.message
          }
        );

        return res.status(500).json({ 
          error: { message: 'Failed to create note' } 
        });
      }
    } else {
      finalContent = content;
      logger.info(`Note created without encryption for user ${userId}`);
    }

    const result = await getDbClient(req).query(
      'INSERT INTO notes (user_id, title, content, encrypted) VALUES ($1, $2, $3, $4) RETURNING id, title, content, created_at, updated_at, encrypted',
      [userId, title, finalContent, encrypted]
    );

    await auditLog(userId, 'NOTE_CREATED', true, req, {
      noteId: result.rows[0].id,
      title
    });

    logger.info(`Note created successfully`, {
      userId,
      noteId: result.rows[0].id,
      encrypted
    });

    res.status(201).json(result.rows[0]);
    
  } catch (err) {
    logger.error('Create note error:', {
      userId: req.user?.userId,
      error: err.message,
      stack: err.stack
    });

    res.status(500).json({ 
      error: { message: 'Failed to create note' } 
    });
  }
};

exports.getNotes = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Explicitly filter to user's OWN notes (not shared with them)
    // RLS has both owner and shared policies, so we need explicit user_id filter
    // Use LEFT JOIN with COUNT for better performance than correlated subquery
    const result = await getDbClient(req).query(
      `SELECT
        n.id,
        n.title,
        n.content,
        n.encrypted,
        n.created_at,
        n.updated_at,
        COALESCE(COUNT(ns.id), 0)::INTEGER as share_count
      FROM notes n
      LEFT JOIN note_shares ns ON ns.note_id = n.id
      WHERE n.deleted_at IS NULL AND n.user_id = $1
      GROUP BY n.id, n.title, n.content, n.encrypted, n.created_at, n.updated_at
      ORDER BY n.updated_at DESC`,
      [userId]
    );

    const notes = result.rows.map(note => ({
      ...note,
      content: note.encrypted ? decrypt(note.content) : note.content
    }));

    res.json({ notes });
  } catch (err) {
    logger.error('Get notes error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch notes' } });
  }
};

exports.getNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // RLS automatically filters to authorized notes (own or shared)
    const result = await getDbClient(req).query(
      'SELECT id, user_id, title, content, encrypted, created_at, updated_at FROM notes WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    const note = result.rows[0];

    // RLS policy already ensured user has access (own note or shared with them)
    // Proceed with decryption if needed
    if (note.encrypted) {
      try {
        note.content = decrypt(note.content);
      } catch (decryptError) {
        logger.error('Decryption failed - possible data tampering:', {
          userId,
          noteId: id,
          error: decryptError.message
        });

        await logSecurityEvent(
          'DECRYPTION_FAILURE',
          'HIGH',
          userId,
          req,
          {
            noteId: id,
            operation: 'GET_NOTE',
            error: decryptError.message
          }
        );

        return res.status(500).json({
          error: { message: 'Failed to decrypt note - possible data corruption' }
        });
      }
    }

    // Don't expose user_id in response
    delete note.user_id;

    res.json({ note });
    
  } catch (err) {
    logger.error('Get note error:', err);
    res.status(500).json({ error: { message: 'Failed to fetch note' } });
  }
};

exports.updateNote = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { title, content, encrypted = true } = req.body;
    const userId = req.user.userId;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ 
        error: { message: 'Note content cannot be empty' } 
      });
    }

    let finalContent;

    if (encrypted) {
      try {
        finalContent = encrypt(content);
      } catch (encryptError) {
        logger.error('Encryption failed during note update:', { 
          userId, 
          noteId: id,
          error: encryptError.message 
        });

        await logSecurityEvent(
          'ENCRYPTION_FAILURE',
          'MEDIUM',
          userId,
          req,
          { 
            noteId: id,
            operation: 'UPDATE_NOTE',
            error: encryptError.message
          }
        );

        return res.status(500).json({ 
          error: { message: 'Failed to update note' } 
        });
      }
    } else {
      finalContent = content;
    }

    // RLS automatically restricts to notes user can modify
    const result = await getDbClient(req).query(
      'UPDATE notes SET title = $1, content = $2, encrypted = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND deleted_at IS NULL RETURNING id, title, created_at, updated_at, encrypted',
      [title, finalContent, encrypted, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found or no permission' } });
    }

    await auditLog(userId, 'NOTE_UPDATED', true, req, { noteId: id, title });

    res.json({
      ...result.rows[0],
      content: finalContent
    });
  } catch (err) {
    logger.error('Update note error:', err);
    res.status(500).json({ error: { message: 'Failed to update note' } });
  }
};

exports.deleteNote = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;

    // Check if note exists (RLS will filter to user's notes)
    const checkResult = await getDbClient(req).query(
      'SELECT user_id, title FROM notes WHERE id = $1',
      [id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    // AUTHORIZATION CHECK
    if (checkResult.rows[0].user_id !== userId) {
      await logSecurityEvent(
        'UNAUTHORIZED_ACCESS',
        'HIGH',
        userId,
        req,
        { 
          resource: 'note',
          noteId: id,
          ownerId: checkResult.rows[0].user_id,
          attemptedAction: 'delete'
        }
      );

      logger.warn('Unauthorized delete attempt:', { 
        userId, 
        noteId: id, 
        ownerId: checkResult.rows[0].user_id 
      });

      return res.status(403).json({ error: { message: 'Access denied' } });
    }

    // RLS restricts DELETE to owner only
    const result = await getDbClient(req).query(
      'DELETE FROM notes WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    await auditLog(userId, 'NOTE_DELETED', true, req, { noteId: id, title: result.rows[0].title });

    res.json({ message: 'Note deleted successfully' });
  } catch (err) {
    logger.error('Delete note error:', err);
    res.status(500).json({ error: { message: 'Failed to delete note' } });
  }
};