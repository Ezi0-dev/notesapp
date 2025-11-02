const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { encrypt, decrypt } = require('../utils/encryption');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');
const { logSecurityEvent } = require('../utils/securityLogger');

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

    const result = await pool.query(
      'INSERT INTO notes (user_id, title, content, encrypted) VALUES ($1, $2, $3, $4) RETURNING id, title, created_at, updated_at, encrypted',
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

    res.status(201).json({
      message: 'Note created successfully',
      note: {
        ...result.rows[0],
        content: content
      }
    });
    
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

    const result = await pool.query(
      'SELECT id, title, content, encrypted, created_at, updated_at FROM notes WHERE user_id = $1 ORDER BY updated_at DESC',
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

    const result = await pool.query(
      'SELECT id, title, content, encrypted, created_at, updated_at FROM notes WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    const note = result.rows[0];

    // AUTHORIZATION CHECK
    if (note.user_id !== userId) {
      // Log unauthorized access attempt
      await logSecurityEvent(
        'unauthorized_access',
        'high',
        userId,
        req,
        { 
          resource: 'note',
          noteId: id,
          ownerId: note.user_id,
          attemptedAction: 'read'
        }
      );

      logger.warn('Unauthorized access attempt:', { 
        userId, 
        noteId: id, 
        ownerId: note.user_id 
      });

      return res.status(403).json({ error: { message: 'Access denied' } });
    }

    // User is authorized - proceed with decryption if needed
    if (note.encrypted) {
      try {
        note.content = decrypt(note.content);
      } catch (decryptError) {
        // ... (tampering detection code from above)
      }
    }

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

    const result = await pool.query(
      'UPDATE notes SET title = $1, content = $2, encrypted = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 AND user_id = $5 RETURNING id, title, created_at, updated_at, encrypted',
      [title, finalContent, encrypted, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'Note not found' } });
    }

    await auditLog(userId, 'NOTE_UPDATED', true, req, { noteId: id, title });

    res.json({
      message: 'Note updated successfully',
      note: {
        ...result.rows[0],
        content: content
      }
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

    // Check ownership first
    const checkResult = await pool.query(
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

    const result = await pool.query(
      'DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id, title',
      [id, userId]
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