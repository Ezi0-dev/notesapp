const express = require('express');
const { body, param, query } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const friendsController = require('../controllers/friendsController');

const router = express.Router();

// Apply authentication and rate limiting to all routes
router.use(authenticate);
router.use(apiLimiter);

// Validation rules
const usernameValidation = [
  body('friendUsername')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .escape()
];

const friendshipIdValidation = [
  param('friendshipId')
    .isUUID()
    .withMessage('Invalid friendship ID')
];

const friendIdValidation = [
  param('friendId')
    .isUUID()
    .withMessage('Invalid friend ID')
];

const searchValidation = [
  query('username')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Search query must be between 2 and 50 characters')
    .escape()
];

// Routes
router.get('/search', searchValidation, friendsController.searchUsers);
router.post('/request', usernameValidation, friendsController.sendFriendRequest);
router.get('/requests', friendsController.getPendingRequests);
router.post('/accept/:friendshipId', friendshipIdValidation, friendsController.acceptFriendRequest);
router.post('/reject/:friendshipId', friendshipIdValidation, friendsController.rejectFriendRequest);
router.get('/', friendsController.getFriends);
router.delete('/:friendId', friendIdValidation, friendsController.removeFriend);

module.exports = router;