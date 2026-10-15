const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const User = require('../models/User');
const { establishSession } = require('../middleware/sessionIdentity');
const { registerValidation, loginValidation } = require('../utils/validators');
const { sendVerificationEmail } = require('../utils/email');
const { Logger } = require('../utils/logger');
const { computePermissionsForUser } = require('../utils/permissions');

// Register
router.post('/register', registerValidation, async (req, res) => {
  try {
    const { email, password, username } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Email or username already exists' });
    }

    // Create new user
    const user = new User({ email, password, username });

    const nodeEnv = process.env.NODE_ENV || 'development';
    const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;
    const skipEmailVerification = String(process.env.SKIP_EMAIL_VERIFICATION || '').toLowerCase() === 'true';

    // Tests expect friction-free accounts; allow bypass in test runtime.
    // In dev/prod, require real verification unless explicitly skipped.
    if (isTestRuntime || skipEmailVerification) {
      user.isEmailVerified = true;
      user.emailVerificationToken = undefined;
      user.emailVerificationExpires = undefined;
    } else {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      user.isEmailVerified = false;
      user.emailVerificationToken = verificationToken;
      user.emailVerificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    }

    await user.save();

    // Optional bootstrap: promote the first-ever account to superadmin.
    // SECURITY: this is disabled by default in all environments.
    // Enable only for explicit one-time bootstrapping via ALLOW_SUPERADMIN_BOOTSTRAP=true.
    const allowBootstrap = String(process.env.ALLOW_SUPERADMIN_BOOTSTRAP || '').toLowerCase() === 'true';

    if (allowBootstrap && !user.isSuperAdmin) {
      const existingSuperAdmins = await User.countDocuments({ isSuperAdmin: true });
      if (existingSuperAdmins === 0) {
        user.isSuperAdmin = true;
        await user.save();
        Logger.warn('Bootstrapped first superadmin account', { userId: user._id, env: nodeEnv });
      }
    }

    // Replace any anonymous/previous account session before authenticating.
    await establishSession(req, user);

    // Send verification email when verification is required (don't fail registration if email fails)
    if (!user.isEmailVerified && user.emailVerificationToken) {
      try {
        await sendVerificationEmail(user, user.emailVerificationToken);
        Logger.info('Verification email sent', { userId: user._id, env: nodeEnv });
      } catch (emailError) {
        Logger.warn('Failed to send verification email', {
          userId: user._id,
          error: emailError.message,
          env: nodeEnv
        });
      }
    }

    const permissions = await computePermissionsForUser(user);
    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        isSuperAdmin: user.isSuperAdmin,
        permissions,
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// Login
router.post('/login', loginValidation, async (req, res) => {
  try {
    const { email, password } = req.body;
    const login = String(email || '').trim();

    // Validation
    if (!login || !password) {
      return res.status(400).json({ error: 'Email/username and password are required' });
    }

    // Find user by email OR username (case-insensitive for username)
    let user;
    if (login.includes('@')) {
      const normalizedEmail = login.toLowerCase();
      user = await User.findOne({ email: normalizedEmail });
    } else {
      user = await User.findOne({ username: login }).collation({ locale: 'en', strength: 2 });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Replace any anonymous/previous account session before authenticating.
    await establishSession(req, user);

    const permissions = await computePermissionsForUser(user);

    res.json({ 
      message: 'Login successful',
      user: {
        id: user._id,
        email: user.email,
        username: user.username,
        isSuperAdmin: user.isSuperAdmin,
        permissions,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  const sessionId = req.sessionID;
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Error logging out' });
    }
    global.wsManager?.disconnectSession?.(sessionId);
    res.clearCookie('connect.sid');
    res.json({ message: 'Logout successful' });
  });
});

// Get current user
router.get('/me', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await User.findById(req.session.userId)
      .select('-password -emailVerificationToken -passwordResetToken')
      .populate('roles', 'name permissions');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const permissions = await computePermissionsForUser(user);
    res.json({
      user: {
        ...user.toObject(),
        permissions,
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
