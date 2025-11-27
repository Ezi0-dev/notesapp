const express = require('express');
const { param } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const notificationsController = require('../controllers/notificationsController');

const router = express.Router();

// Apply rate limiting and auth
router.use(authenticate);
router.use(apiLimiter);

// Validation 
const notificationIdValidation = [
  param('id')
    .isUUID()
    .withMessage('Invalid notification ID')
];

router.get('/', notificationsController.getNotifications);
router.post('/:id/read', notificationIdValidation, notificationsController.markAsRead);
router.post('/read-all', notificationsController.markAllAsRead);
router.delete('/:id', notificationIdValidation, notificationsController.deleteNotification);

module.exports = router;