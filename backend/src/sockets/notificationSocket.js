// Notification broadcasting utilities
// Used by controllers to emit real-time notifications
const { logger } = require('../utils/logger');

let ioInstance = null;

// Store reference to Socket.io instance
function setSocketInstance(io) {
  ioInstance = io;
  logger.info('Socket instance registered for notifications');
}

// Emit notification to specific user
function emitNotification(userId, notification) {
  if (!ioInstance) {
    logger.warn('Socket.io not initialized, skipping real-time notification');
    return;
  }

  // Emit to user-specific room
  const roomName = `user:${userId}`;
  const clientsInRoom = ioInstance.sockets.adapter.rooms.get(roomName);
  const numClients = clientsInRoom ? clientsInRoom.size : 0;

  ioInstance.to(roomName).emit('notification:new', notification);

  logger.debug('Real-time notification sent', {
    userId,
    roomName,
    connectedClients: numClients,
    notificationId: notification.id,
    type: notification.type
  });
}

// Emit notification read status update
function emitNotificationRead(userId, notificationId) {
  if (!ioInstance) return;

  ioInstance.to(`user:${userId}`).emit('notification:read', { id: notificationId });
}

// Emit notification deletion
function emitNotificationDeleted(userId, notificationId) {
  if (!ioInstance) return;

  ioInstance.to(`user:${userId}`).emit('notification:deleted', { id: notificationId });
}

// Emit batch notification mark as read
function emitAllNotificationsRead(userId) {
  if (!ioInstance) return;

  ioInstance.to(`user:${userId}`).emit('notification:all_read');
}

module.exports = {
  setSocketInstance,
  emitNotification,
  emitNotificationRead,
  emitNotificationDeleted,
  emitAllNotificationsRead
};
