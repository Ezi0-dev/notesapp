const express = require('express');
const { param } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { setRLSContext } = require('../middleware/rlsContext');
const notificationsController = require('../controllers/notificationsController');

const router = express.Router();

// Apply authentication, RLS context, and rate limiting to all routes
router.use(authenticate);
router.use(setRLSContext);
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