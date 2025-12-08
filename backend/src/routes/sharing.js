const express = require('express');
const { body, param } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { setRLSContext } = require('../middleware/rlsContext');
const sharingController = require('../controllers/sharingController');

const router = express.Router();

// Apply authentication, RLS context, and rate limiting to all routes
router.use(authenticate);
router.use(setRLSContext);
router.use(apiLimiter);

// Validation rules
const shareValidation = [
  param('noteId')
    .isUUID()
    .withMessage('Invalid note ID'),
  body('friendId')
    .trim()
    .notEmpty()
    .withMessage('Friend ID is required')
    .isUUID()
    .withMessage('Invalid friend ID'),
  body('permission')
    .optional()
    .isIn(['read', 'write'])
    .withMessage('Permission must be "read" or "write"')
];

const unshareValidation = [
  param('noteId')
    .isUUID()
    .withMessage('Invalid note ID'),
  param('friendId')
    .isUUID()
    .withMessage('Invalid friend ID')
];

const noteIdValidation = [
  param('noteId')
    .isUUID()
    .withMessage('Invalid note ID')
];

const permissionUpdateValidation = [
  param('noteId')
    .isUUID()
    .withMessage('Invalid note ID'),
  param('friendId')
    .isUUID()
    .withMessage('Invalid friend ID'),
  body('permission')
    .isIn(['read', 'write'])
    .withMessage('Permission must be "read" or "write"')
];

const sharedNoteUpdateValidation = [
  param('noteId')
    .isUUID()
    .withMessage('Invalid note ID'),
  body('title')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters')
    .escape(),
  body('content')
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('Content must be between 1 and 50000 characters')
];

// Routes
router.post('/notes/:noteId/share', shareValidation, sharingController.shareNote);
router.delete('/notes/:noteId/share/:friendId', unshareValidation, sharingController.unshareNote);
router.get('/notes/:noteId/shares', noteIdValidation, sharingController.getNoteShares);
router.put('/notes/:noteId/share/:friendId', permissionUpdateValidation, sharingController.updateSharePermission);
router.get('/shared-with-me', sharingController.getSharedWithMe);
router.put('/shared-notes/:noteId', sharedNoteUpdateValidation, sharingController.updateSharedNote);
router.get('/notes/:id', sharingController.getSharedNote);
router.delete('/notes/:noteId/leave', sharingController.leaveSharedNote);

module.exports = router;