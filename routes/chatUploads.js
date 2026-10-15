/**
 * routes/chatUploads.js
 *
 * Chat file upload endpoints.
 *
 * Security:
 * - Enforces size limits
 * - Sanitizes filenames to prevent path traversal
 * - Authenticated operations only
 */
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { isAuthenticated } = require('../middleware/auth');
const { IMAGE_FORMATS, validRaster, removeUploadedFile } = require('../utils/uploadValidation');
const { Logger } = require('../utils/logger');

const User = require('../models/User');
const ChatRoom = require('../models/ChatRoom');
const ChatUpload = require('../models/ChatUpload');

const router = express.Router();

const MAX_CHAT_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB
const CHAT_UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'chat');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function safeBasename(name) {
  const base = path.basename(String(name || '')).trim();
  // Keep it simple and filesystem-safe
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 160) || 'file';
}

function isAllowedMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (!m) return false;

  if (Object.hasOwn(IMAGE_FORMATS, m)) {
    // jpeg, png, gif, webp, etc.
    return true;
  }

  return m === 'text/plain' || m === 'application/pdf';
}

ensureDir(CHAT_UPLOADS_DIR);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CHAT_UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const token = crypto.randomBytes(16).toString('base64url');
    const ext = path.extname(file.originalname || '').slice(0, 12);
    const storedName = `${token}${ext}`;
    cb(null, storedName);
  }
});

const uploadChatFile = multer({
  storage,
  limits: { fileSize: MAX_CHAT_UPLOAD_BYTES },
  fileFilter: (req, file, cb) => {
    if (!isAllowedMime(file.mimetype)) {
      cb(Object.assign(new Error('Only small raster images, .txt, and .pdf files are allowed.'), { statusCode: 400 }));
      return;
    }
    cb(null, true);
  }
});

// POST /api/chat/uploads  (multipart/form-data: file + roomId)
router.post('/uploads', isAuthenticated, uploadChatFile.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const roomId = String(req.body?.roomId || '').trim();
    if (!roomId) {
      // cleanup orphan file
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore
      }
      return res.status(400).json({ message: 'roomId is required' });
    }

    if (!/^[a-f0-9]{24}$/i.test(roomId)) {
      await removeUploadedFile(req);
      return res.status(400).json({ message: 'Invalid room' });
    }
    if (Object.hasOwn(IMAGE_FORMATS, req.file.mimetype) && !(await validRaster(req.file))) {
      await removeUploadedFile(req);
      return res.status(400).json({ message: 'File content did not match its image type' });
    }
    const room = await ChatRoom.findById(roomId).select('_id isPrivate createdBy');
    if (!room) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore
      }
      return res.status(404).json({ message: 'Room not found' });
    }

    // Private uploads require the creator or a currently joined socket from this session.
    const joined = [...(global.wsManager?.chat?.sockets?.values() || [])].some(socket =>
      socket.request.sessionID === req.sessionID && socket.userId === String(req.session.userId) && socket.rooms.has('chatroom:' + roomId));
    if (room.isPrivate && String(room.createdBy || '') !== String(req.session.userId) && !joined) {
      await removeUploadedFile(req);
      return res.status(403).json({ message: 'Join the private room before uploading' });
    }
    const user = await User.findById(req.session.userId).select('_id username');
    if (!user) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {
        // ignore
      }
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const doc = await ChatUpload.create({
      room: room._id,
      user: user._id,
      username: user.username,
      originalName: safeBasename(req.file.originalname),
      storedName: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size
    });

    Logger.info('Chat upload stored', {
      userId: req.session.userId,
      roomId: roomId,
      uploadId: doc._id,
      size: doc.size,
      mimeType: doc.mimeType
    });

    return res.json({
      message: 'Upload OK',
      upload: {
        id: doc._id.toString(),
        roomId: roomId,
        name: doc.originalName,
        mimeType: doc.mimeType,
        size: doc.size,
        url: `/api/chat/uploads/${encodeURIComponent(doc.storedName)}`
      }
    });
  } catch (error) {
    await removeUploadedFile(req);
    Logger.error('Chat upload failed', { error: error?.message });
    return res.status(500).json({ message: 'Failed to upload file' });
  }
});

// GET /api/chat/uploads/:storedName  (auth required; capability URL)
router.get('/uploads/:storedName', isAuthenticated, async (req, res) => {
  try {
    const storedName = String(req.params?.storedName || '').trim();
    if (!storedName) {
      return res.status(400).json({ message: 'Invalid upload' });
    }

    const upload = await ChatUpload.findOne({ storedName }).select('storedName originalName mimeType');
    if (!upload) {
      return res.status(404).json({ message: 'File not found' });
    }

    const filePath = path.join(CHAT_UPLOADS_DIR, upload.storedName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File missing on disk' });
    }

    res.setHeader('Content-Type', upload.mimeType || 'application/octet-stream');

    const isInline = String(upload.mimeType || '').toLowerCase().startsWith('image/');
    const dispositionType = isInline ? 'inline' : 'attachment';
    const safeName = safeBasename(upload.originalName);
    res.setHeader('Content-Disposition', `${dispositionType}; filename="${safeName}"`);

    return res.sendFile(filePath);
  } catch (error) {
    Logger.error('Chat download failed', { error: error?.message });
    return res.status(500).json({ message: 'Failed to download file' });
  }
});

module.exports = router;
module.exports.CHAT_UPLOADS_DIR = CHAT_UPLOADS_DIR;
