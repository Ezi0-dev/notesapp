// backend/src/controllers/profileController.js
const bcrypt = require('bcrypt');
const { pool } = require('../config/database');
const { validationResult } = require('express-validator');
const { bcrypt: bcryptConfig } = require('../config/security');
const { logger } = require('../utils/logger');
const { auditLog } = require('../middleware/security');

exports.changePassword = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.user.userId;

    console.log('Password change attempt for user:', userId);

    // Get user's current password hash
    const result = await pool.query(
      'SELECT password_hash, username FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      console.log('User not found:', userId);
      return res.status(404).json({ error: { message: 'User not found' } });
    }

    const user = result.rows[0];
    console.log('Found user:', user.username);

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
    console.log('Current password valid:', isValidPassword);
    
    if (!isValidPassword) {
      await auditLog(userId, 'PASSWORD_CHANGE_FAILED', false, req, { 
        reason: 'Invalid current password' 
      });
      return res.status(401).json({ 
        error: { message: 'Current password is incorrect' } 
      });
    }

    // Check if new password is same as old
    const isSamePassword = await bcrypt.compare(newPassword, user.password_hash);
    if (isSamePassword) {
      console.log('New password same as old');
      return res.status(400).json({
        error: { message: 'New password must be different from current password' }
      });
    }

    // Hash new password
    console.log('Hashing new password...');
    const newPasswordHash = await bcrypt.hash(newPassword, bcryptConfig.saltRounds);

    // Update password
    console.log('Updating password in database...');
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newPasswordHash, userId]
    );

    // Revoke all refresh tokens (force re-login on all devices)
    console.log('Revoking refresh tokens...');
    await pool.query(
      'UPDATE refresh_tokens SET revoked = true WHERE user_id = $1',
      [userId]
    );

    await auditLog(userId, 'PASSWORD_CHANGED', true, req);
    logger.info(`Password changed for user ${userId} (${user.username})`);

    console.log('Password change successful!');

    res.json({
      message: 'Password changed successfully. Please login again with your new password.'
    });
  } catch (err) {
    console.error('Change password error:', err);
    logger.error('Change password error:', err);
    res.status(500).json({ error: { message: 'Failed to change password' } });
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

// Note: Profile picture upload/remove would require additional setup
// with multer for file uploads and storage (S3, local filesystem, etc.)
// For now, these are placeholder functions

exports.uploadAvatar = async (req, res) => {
  try {
    // This would require multer middleware and file storage setup
    // For educational purposes, return not implemented
    res.status(501).json({ 
      error: { message: 'Avatar upload not yet implemented. Coming soon!' } 
    });
  } catch (err) {
    logger.error('Upload avatar error:', err);
    res.status(500).json({ error: { message: 'Failed to upload avatar' } });
  }
};

exports.removeAvatar = async (req, res) => {
  try {
    // This would update user's avatar_url to null in database
    res.status(501).json({ 
      error: { message: 'Avatar removal not yet implemented. Coming soon!' } 
    });
  } catch (err) {
    logger.error('Remove avatar error:', err);
    res.status(500).json({ error: { message: 'Failed to remove avatar' } });
  }
};