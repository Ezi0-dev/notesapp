const { pool } = require('../config/database');
const { logger } = require('../utils/logger');

// Get all notifications for the current user
exports.getNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(
      `SELECT n.id,
              n.user_id,
              n.type,
              n.from_user_id,
              n.related_id,
              n.message,
              n.is_read,
              n.created_at,
              u.username as from_username
       FROM notifications n
       LEFT JOIN users u ON n.from_user_id = u.id AND u.deleted_at IS NULL
       WHERE n.user_id = $1
       ORDER BY n.is_read ASC, n.created_at DESC
       LIMIT 50`,
      [userId]
    );

    logger.info(`Notifications fetched for user ${userId}`);
    res.json({ data: result.rows });
  } catch (error) {
    logger.error('Get notifications error:', error);
    res.status(500).json({
      error: { message: 'Failed to fetch notifications' }
    });
  }
};

// Mark a single notification as read
exports.markAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { message: 'Notification not found' }
      });
    }

    logger.info(`Notification ${id} marked as read by user ${userId}`);
    res.json({ message: 'Notification marked as read' });
  } catch (error) {
    logger.error('Mark notification read error:', error);
    res.status(500).json({
      error: { message: 'Failed to mark notification as read' }
    });
  }
};

// Mark all notifications as read
exports.markAllAsRead = async (req, res) => {
  try {
    const userId = req.user.userId;

    await pool.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
      [userId]
    );

    logger.info(`All notifications marked as read for user ${userId}`);
    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    logger.error('Mark all notifications read error:', error);
    res.status(500).json({
      error: { message: 'Failed to mark all notifications as read' }
    });
  }
};

// Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { message: 'Notification not found' }
      });
    }

    logger.info(`Notification ${id} deleted by user ${userId}`);
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    logger.error('Delete notification error:', error);
    res.status(500).json({
      error: { message: 'Failed to delete notification' }
    });
  }
};