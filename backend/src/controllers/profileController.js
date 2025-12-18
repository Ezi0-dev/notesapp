// backend/src/controllers/profileController.js
const argon2 = require('argon2');
const { pool } = require('../config/database');
const { executeAsSystem } = require('../middleware/rlsContext');
const { validationResult } = require('express-validator');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');

exports.changePassword = async (req, res) => {
  const client = await pool.connect();

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    logger.info('Password change attempt for user:', userId);

    // Get user's current password hash
    const result = await client.query(
      'SELECT password_hash, username FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      logger.warn('User not found:', userId);
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const user = result.rows[0];
    logger.debug('Found user:', user.username);

    // Verify current password
    const isValidPassword = await argon2.verify(user.password_hash, currentPassword);
    logger.debug('Current password valid:', isValidPassword);

    if (!isValidPassword) {
      await auditLog(userId, 'PASSWORD_CHANGE_FAILED', false, req, {
        reason: 'Invalid current password'
      });
      return res.status(401).json({
        error: { message: 'Current password is incorrect' }
      });
    }

    // Check if new password is same as old
    const isSamePassword = await argon2.verify(user.password_hash, newPassword);
    if (isSamePassword) {
      logger.debug('New password same as old');
      return res.status(400).json({
        error: { message: 'New password must be different from current password' }
      });
    }

    // Hash new password
    logger.debug('Hashing new password...');
    const newPasswordHash = await argon2.hash(newPassword);

    // Start transaction - all or nothing
    await client.query('BEGIN');

    try {
      // Update password
      logger.debug('Updating password in database...');
      await client.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [newPasswordHash, userId]
      );

      // Revoke all refresh tokens (force re-login on all devices)
      logger.debug('Revoking refresh tokens...');
      await client.query(
        'UPDATE refresh_tokens SET revoked = true, revoked_at = NOW(), revoked_reason = $2 WHERE user_id = $1',
        [userId, 'password_changed']
      );

      await client.query('COMMIT');
      logger.debug('Transaction committed successfully');
    } catch (txError) {
      await client.query('ROLLBACK');
      logger.error('Transaction failed, rolled back:', txError);
      throw txError;
    }

    await auditLog(userId, 'PASSWORD_CHANGED', true, req);
    logger.info(`Password changed for user ${userId} (${user.username})`);

    res.json({
      message: 'Password changed successfully. Please login again with your new password.'
    });
  } catch (err) {
    logger.error('Change password error:', err);
    res.status(500).json({ error: { message: 'Failed to change password' } });
  } finally {
    client.release();
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Log the deletion attempt
    await auditLog(userId, 'ACCOUNT_DELETION_INITIATED', true, req);

    // Delete user (CASCADE will delete notes, refresh_tokens, and audit_logs)
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING username, email',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const deletedUser = result.rows[0];
    logger.warn(`Account deleted: ${deletedUser.username} (${deletedUser.email})`);

    res.json({
      message: 'Account successfully deleted'
    });
  } catch (err) {
    logger.error('Delete account error:', err);
    res.status(500).json({ error: { message: 'Failed to delete account' } });
  }
};

const fs = require('fs').promises;
const path = require('path');

exports.uploadAvatar = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: { message: 'No file uploaded' }
      });
    }

    // Get user's current profile picture
    const userResult = await pool.query(
      'SELECT profile_picture, username FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      // Clean up uploaded file if user not found
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const oldProfilePicture = userResult.rows[0].profile_picture;

    // Update database with new profile picture filename
    await pool.query(
      'UPDATE users SET profile_picture = $1 WHERE id = $2',
      [req.file.filename, userId]
    );

    // Delete old profile picture file if it exists
    if (oldProfilePicture) {
      const oldFilePath = path.join('uploads/avatars', oldProfilePicture);
      await fs.unlink(oldFilePath).catch(err => {
        logger.warn(`Failed to delete old avatar: ${err.message}`);
      });
    }

    await auditLog(userId, 'PROFILE_PICTURE_UPLOADED', true, req, {
      filename: req.file.filename,
      size: req.file.size
    });

    logger.info(`Profile picture uploaded for user ${userId} (${userResult.rows[0].username})`);

    res.json({
      message: 'Profile picture uploaded successfully',
      profilePicture: req.file.filename
    });
  } catch (err) {
    logger.error('Upload avatar error:', err);
    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: { message: 'Failed to upload avatar' } });
  }
};

exports.removeAvatar = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's current profile picture
    const result = await pool.query(
      'SELECT profile_picture, username FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const profilePicture = result.rows[0].profile_picture;

    if (!profilePicture) {
      return res.status(400).json({
        error: { message: 'No profile picture to remove' }
      });
    }

    // Remove profile picture from database
    await pool.query(
      'UPDATE users SET profile_picture = NULL WHERE id = $1',
      [userId]
    );

    // Delete file from filesystem
    const filePath = path.join('uploads/avatars', profilePicture);
    await fs.unlink(filePath).catch(err => {
      logger.warn(`Failed to delete avatar file: ${err.message}`);
    });

    await auditLog(userId, 'PROFILE_PICTURE_REMOVED', true, req, {
      filename: profilePicture
    });

    logger.info(`Profile picture removed for user ${userId} (${result.rows[0].username})`);

    res.json({
      message: 'Profile picture removed successfully'
    });
  } catch (err) {
    logger.error('Remove avatar error:', err);
    res.status(500).json({ error: { message: 'Failed to remove avatar' } });
  }
};