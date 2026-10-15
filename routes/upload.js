/**
 * routes/upload.js
 *
 * Media upload endpoints for avatars and post images.
 *
 * Uses multer storage configuration from config/multer.js.
 */
const express = require('express');
const router = express.Router();
const { uploadAvatar, uploadPostImage } = require('../config/multer');
const { validateRasterUpload, removeUploadedFile } = require('../utils/uploadValidation');
const User = require('../models/User');
const { Logger } = require('../utils/logger');
const { isAuthenticated } = require('../middleware/auth');
const { PERMISSIONS } = require('../utils/permissionsCatalog');
const { computePermissionsForUser, userHasPermission } = require('../utils/permissions');

const MAX_RECENT_UPLOADS = 20;
const RECENT_UPLOAD_TTL_MS = 30 * 60 * 1000; // 30 minutes

const rememberUpload = (req, fileUrl) => {
  if (!req.session) return;
  const now = Date.now();
  const current = Array.isArray(req.session.recentUploads) ? req.session.recentUploads : [];
  const next = [...current, { url: String(fileUrl || ''), at: now }]
    .filter((e) => e && typeof e.url === 'string' && (now - Number(e.at || 0)) <= RECENT_UPLOAD_TTL_MS)
    .slice(-MAX_RECENT_UPLOADS);
  req.session.recentUploads = next;
};

const canDeleteFromSession = (req, fileUrl) => {
  if (!req.session) return false;
  const now = Date.now();
  const list = Array.isArray(req.session.recentUploads) ? req.session.recentUploads : [];
  return list.some((e) => e && e.url === fileUrl && (now - Number(e.at || 0)) <= RECENT_UPLOAD_TTL_MS);
};

const canDeleteAnyUploads = async (req) => {
  if (!req.session?.userId) return false;
  const user = await User.findById(req.session.userId)
    .select('-password')
    .populate('roles', 'name permissions');
  if (!user) return false;
  const permissions = await computePermissionsForUser(user);
  return userHasPermission(permissions, PERMISSIONS.UPLOADS_DELETE_ANY);
};

const normalizeUploadPath = (filePath) => {
  if (typeof filePath !== 'string') return null;
  // Only accept POSIX-style URLs from the client.
  if (filePath.includes('\\')) return null;
  if (!filePath.startsWith('/uploads/')) return null;
  if (filePath.includes('..')) return null;

  const normalized = filePath.replace(/\\/g, '/');
  const allowed = normalized.startsWith('/uploads/avatars/') || normalized.startsWith('/uploads/posts/');
  if (!allowed) return null;
  return normalized;
};

// Upload avatar
router.post('/avatar', isAuthenticated, uploadAvatar.single('avatar'), validateRasterUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    
    // Update user's avatar in database
    await User.findByIdAndUpdate(req.session.userId, {
      avatar: avatarUrl
    });

    rememberUpload(req, avatarUrl);

    Logger.info('Avatar uploaded', { 
      userId: req.session.userId,
      filename: req.file.filename 
    });

    res.json({ 
      message: 'Avatar uploaded successfully',
      avatarUrl 
    });
  } catch (error) {
    await removeUploadedFile(req);
    Logger.error('Avatar upload failed', { error: error.message });
    res.status(500).json({ message: 'Failed to upload avatar' });
  }
});

// Upload post image
router.post('/post-image', isAuthenticated, uploadPostImage.single('image'), validateRasterUpload, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const imageUrl = `/uploads/posts/${req.file.filename}`;

    rememberUpload(req, imageUrl);

    Logger.info('Post image uploaded', { 
      userId: req.session.userId,
      filename: req.file.filename 
    });

    res.json({ 
      message: 'Image uploaded successfully',
      imageUrl 
    });
  } catch (error) {
    Logger.error('Post image upload failed', { error: error.message });
    res.status(500).json({ message: 'Failed to upload image' });
  }
});

// Delete uploaded file
router.delete('/delete', isAuthenticated, async (req, res) => {
  try {
    const { filePath } = req.body;
    const fs = require('fs');
    const path = require('path');

    const normalized = normalizeUploadPath(filePath);
    if (!normalized) {
      return res.status(400).json({ message: 'Invalid file path' });
    }

    const publicDir = path.resolve(__dirname, '..', 'public');
    const uploadsDir = path.resolve(publicDir, 'uploads');
    const relative = normalized.replace(/^\/+/, '');
    const fullPath = path.resolve(publicDir, relative);

    if (!fullPath.startsWith(uploadsDir + path.sep)) {
      return res.status(400).json({ message: 'Invalid file path' });
    }

    const allowedBySession = canDeleteFromSession(req, normalized);
    const allowedByPermission = allowedBySession ? false : await canDeleteAnyUploads(req);
    if (!allowedBySession && !allowedByPermission) {
      return res.status(403).json({ message: 'Permission denied' });
    }
    
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
      Logger.info('File deleted', { filePath: normalized, userId: req.session.userId, via: allowedBySession ? 'session' : 'permission' });
      res.json({ message: 'File deleted successfully' });
    } else {
      res.status(404).json({ message: 'File not found' });
    }
  } catch (error) {
    Logger.error('File deletion failed', { error: error.message });
    res.status(500).json({ message: 'Failed to delete file' });
  }
});

module.exports = router;
