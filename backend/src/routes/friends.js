const express = require('express');
const { body, param, query } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { setRLSContext } = require('../middleware/rlsContext');
const friendsController = require('../controllers/friendsController');

const router = express.Router();

// Apply authentication, RLS context, and rate limiting to all routes
router.use(authenticate);
router.use(setRLSContext);
router.use(apiLimiter);

// Validation rules
const usernameValidation = [
  body('friendUsername')
    .optional({ checkFalsy: true })
    .trim()
    .notEmpty()
    .withMessage('Username cannot be empty')
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be between 3 and 50 characters')
    .escape(),
  body('friendId')
    .optional({ checkFalsy: true })
    .custom((value, { req }) => {
      // Skip if not provided or empty
      if (!value || value.trim().length === 0) {
        // At least one of friendId or friendUsername must be provided
        if (!req.body.friendUsername || req.body.friendUsername.trim().length === 0) {
          throw new Error('Either friendUsername or friendId is required');
        }
        return true;
      }

      // If provided and not empty, must be a valid UUID
      const trimmedValue = value.trim();
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(trimmedValue)) {
        throw new Error('Invalid friend ID format');
      }
      return true;
    })
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