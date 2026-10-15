/**
 * config/multer.js
 *
 * Multer storage configuration for uploads (avatars and post images).
 *
 * Creates upload directories on boot and enforces basic file type checks.
 */
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, '../public/uploads');
const avatarsDir = path.join(uploadDir, 'avatars');
const postsDir = path.join(uploadDir, 'posts');

[uploadDir, avatarsDir, postsDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage for avatars
const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, avatarsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// Configure storage for post images
const postImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, postsDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'post-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter for images only
const imageFilter = (req, file, cb) => {
  const extensions = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp' };
  const extname = path.extname(file.originalname).toLowerCase();
  const mimetype = extensions[extname] && extensions[extname] === file.mimetype;

  if (extname && mimetype) {
    cb(null, true);
  } else {
    cb(Object.assign(new Error('Only image files are allowed (jpeg, jpg, png, gif, webp)'), { statusCode: 400 }));
  }
};

// Avatar upload configuration
const uploadAvatar = multer({
  storage: avatarStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: imageFilter
});

// Post image upload configuration
const uploadPostImage = multer({
  storage: postImageStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: imageFilter
});

module.exports = {
  uploadAvatar,
  uploadPostImage
};
