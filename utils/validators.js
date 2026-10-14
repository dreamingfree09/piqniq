/**
 * utils/validators.js
 *
 * Request validation rules (express-validator).
 *
 * Keep all input validation centralized so routes can stay focused on behavior and
 * permission checks.
 */
const { body, validationResult } = require('express-validator');
const validator = require('validator');

// Validation middleware
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed', 
      details: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// Registration validation rules
const registerValidation = [
  body('email')
    .trim()
    .isEmail()
    .withMessage('Please provide a valid email address')
    .normalizeEmail()
    .isLength({ max: 255 })
    .withMessage('Email must not exceed 255 characters'),
  
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage('Username can only contain letters, numbers, underscores, and hyphens')
    .custom(value => {
      // Check for reserved usernames
      const reserved = ['admin', 'moderator', 'system', 'root', 'api', 'null', 'undefined'];
      if (reserved.includes(value.toLowerCase())) {
        throw new Error('This username is reserved');
      }
      return true;
    }),
  
  body('password')
    .isString().bail()
    .custom(value => Buffer.byteLength(value, 'utf8') <= 72).withMessage('Password must not exceed 72 UTF-8 bytes')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be between 8 and 128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
    .custom((value, { req }) => {
      // Check if password contains username
      if (req.body.username && value.toLowerCase().includes(req.body.username.toLowerCase())) {
        throw new Error('Password cannot contain your username');
      }
      return true;
    }),
  
  validateRequest
];

// Login validation rules
const loginValidation = [
  body('email')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Email or username is required')
    .custom((value) => {
      const v = String(value || '').trim();

      // If it looks like an email, validate as email.
      if (v.includes('@')) {
        if (!validator.isEmail(v)) {
          throw new Error('Please provide a valid email address');
        }
        return true;
      }

      // Otherwise validate as username.
      if (v.length < 3 || v.length > 30) {
        throw new Error('Username must be between 3 and 30 characters');
      }

      if (!/^[a-zA-Z0-9_-]+$/.test(v)) {
        throw new Error('Username can only contain letters, numbers, underscores, and hyphens');
      }

      return true;
    }),
  
  body('password')
    .isString().bail().isLength({ max: 128 })
    .notEmpty()
    .withMessage('Password is required'),
  
  validateRequest
];

// Post creation validation
const createPostValidation = [
  body('title')
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  
  body('content')
    .trim()
    .isLength({ min: 10, max: 10000 })
    .withMessage('Content must be between 10 and 10,000 characters'),
  
  body('category')
    .isIn(['general', 'frontend', 'backend', 'learning', 'showcase', 'career', 'cybersecurity', 'devops', 'cloud', 'data', 'mobile', 'ai'])
    .withMessage('Invalid category selected'),
  
  validateRequest
];

// Post update validation
const updatePostValidation = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 5, max: 200 })
    .withMessage('Title must be between 5 and 200 characters'),
  
  body('content')
    .optional()
    .trim()
    .isLength({ min: 10, max: 10000 })
    .withMessage('Content must be between 10 and 10,000 characters'),
  
  body('category')
    .optional()
    .isIn(['general', 'frontend', 'backend', 'learning', 'showcase', 'career', 'cybersecurity', 'devops', 'cloud', 'data', 'mobile', 'ai'])
    .withMessage('Invalid category selected'),
  
  validateRequest
];

// Profile updates accept cleared optional links and app-owned avatar paths.
const validHttpUrl = (value, domains) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    return !domains || domains.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain));
  } catch { return false; }
};
const socialLinkRule = (field, domains) => body(field)
  .optional().isString().bail().trim().isLength({ max: 500 })
  .custom(value => value === '' || validHttpUrl(value, domains)).withMessage('Must be a valid HTTP(S) URL for the expected site');
const updateProfileValidation = [
  body('bio').optional().isString().bail().trim().isLength({ max: 500 }).withMessage('Bio must not exceed 500 characters'),
  body('avatar').optional().isString().bail().trim().isLength({ max: 500 })
    .custom(value => {
      if (value === '' || validHttpUrl(value)) return true;
      if (value.includes(String.fromCharCode(92)) || /[\u0000-\u001f]/.test(value)) return false;
      const url = new URL(value, 'https://piqniq.invalid');
      return value.startsWith('/') && url.origin === 'https://piqniq.invalid' &&
        /^\/(uploads\/avatars|images)\//i.test(url.pathname);
    }).withMessage('Avatar must be an HTTP(S) image URL or app avatar path'),
  socialLinkRule('socialLinks.github', ['github.com']),
  socialLinkRule('socialLinks.linkedin', ['linkedin.com']),
  socialLinkRule('socialLinks.twitter', ['twitter.com', 'x.com']),
  socialLinkRule('socialLinks.website'),
  validateRequest
];

// Reply validation
const createReplyValidation = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Reply must be between 1 and 5,000 characters'),

  body('parentReplyId')
    .optional({ nullable: true })
    .isMongoId()
    .withMessage('Invalid parentReplyId'),
  
  validateRequest
];

// Sanitize HTML helper
const sanitizeHtml = (text) => {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
};

module.exports = {
  registerValidation,
  loginValidation,
  createPostValidation,
  updatePostValidation,
  updateProfileValidation,
  createReplyValidation,
  sanitizeHtml,
  validateRequest
};
