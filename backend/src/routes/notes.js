const express = require('express');
const { body, param } = require('express-validator');
const { apiLimiter } = require('../middleware/rateLimiter');
const { authenticate } = require('../middleware/auth');
const { setRLSContext } = require('../middleware/rlsContext');
const notesController = require('../controllers/notesController');

const router = express.Router();

// Apply authentication, RLS context, and rate limiting to all routes
router.use(authenticate);
router.use(setRLSContext); // Set RLS context after authentication
router.use(apiLimiter);

// Validation rules
const noteValidation = [
  body('title')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Title must be between 1 and 255 characters')
    .escape(), // XSS prot
  body('content')
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('Content must be between 1 and 50000 characters'),
  body('encrypted')
    .optional()
    .isBoolean()
    .withMessage('Encrypted must be a boolean value')
];

const idValidation = [
  param('id')
    .isUUID()
    .withMessage('Invalid note ID')
];

// Routes
router.post('/', noteValidation, notesController.createNote);
router.get('/', notesController.getNotes);
router.get('/:id', idValidation, notesController.getNote);
router.put('/:id', [...idValidation, ...noteValidation], notesController.updateNote);
router.delete('/:id', idValidation, notesController.deleteNote);

module.exports = router;