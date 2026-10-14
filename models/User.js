/**
 * models/User.js
 *
 * User accounts.
 *
 * Stores credentials (hashed), profile fields, notifications, gamification state,
 * and role assignments used by RBAC.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const nodeEnv = process.env.NODE_ENV || 'development';
const isTestRuntime = nodeEnv === 'test' || process.env.JEST_WORKER_ID !== undefined;

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
    minlength: 6,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  avatar: {
    type: String,
    default: '/images/default-avatar.png',
  },
  bio: {
    type: String,
    maxlength: 500,
  },
  socialLinks: {
    github: String,
    linkedin: String,
    twitter: String,
    website: String,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  // Incremented on credential reset/account erasure to revoke existing sessions.
  sessionVersion: { type: Number, default: 0 },
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  role: {
    type: String,
    enum: ['member', 'moderator', 'admin'],
    default: 'member',
  },
  // Multi-role support (custom roles created in UI)
  roles: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Role'
  }],
  // Superadmin override: full permissions regardless of assigned roles
  isSuperAdmin: {
    type: Boolean,
    default: false,
  },
  reputation: {
    type: Number,
    default: 0,
  },
  badges: [{
    name: String,
    icon: String,
    earnedAt: { type: Date, default: Date.now },
  }],
  notifications: [{
    type: { type: String },
    message: String,
    link: String,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  posts: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post'
  }],
});

// API serialization never includes credential or verification/reset secrets.
userSchema.set('toJSON', { transform: (_doc, value) => {
  delete value.password;
  delete value.emailVerificationToken;
  delete value.passwordResetToken;
  return value;
} });

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  // bcrypt truncates after 72 bytes; reject new raw passwords rather than silently weakening them.
  if (Buffer.byteLength(this.password, 'utf8') > 72) return next(new Error('Password must not exceed 72 UTF-8 bytes'));
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Superadmin protection: prevent delete operations from matching superadmins.
// In test runtime we allow cleanup.
const excludeSuperAdminsFromDeleteQueries = function (next) {
  try {
    if (isTestRuntime) return next();

    const filter = (typeof this.getFilter === 'function') ? (this.getFilter() || {}) : {};

    // Preserve any existing isSuperAdmin predicate, but ensure we never delete superadmins.
    // If caller explicitly tries to delete a superadmin, the query will become a no-op.
    const safeFilter = {
      ...filter,
      isSuperAdmin: { $ne: true },
    };

    if (typeof this.setQuery === 'function') {
      this.setQuery(safeFilter);
    } else if (typeof this.setFilter === 'function') {
      this.setFilter(safeFilter);
    }

    return next();
  } catch (e) {
    return next(e);
  }
};

userSchema.pre('deleteOne', { document: false, query: true }, excludeSuperAdminsFromDeleteQueries);
userSchema.pre('deleteMany', { document: false, query: true }, excludeSuperAdminsFromDeleteQueries);
userSchema.pre('findOneAndDelete', { document: false, query: true }, excludeSuperAdminsFromDeleteQueries);
userSchema.pre('findOneAndRemove', { document: false, query: true }, excludeSuperAdminsFromDeleteQueries);

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
