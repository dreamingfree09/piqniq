/** Verify raster bytes as well as the declared type before retaining uploads. */
const fs = require('fs/promises');
const sharp = require('sharp');
const IMAGE_FORMATS = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
async function removeUploadedFile(req) {
  if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
}
async function validRaster(file) {
  if (!file || !IMAGE_FORMATS[file.mimetype]) return false;
  try {
    const metadata = await sharp(file.path, { limitInputPixels: 40_000_000 }).metadata();
    return metadata.format === IMAGE_FORMATS[file.mimetype] && metadata.width > 0 && metadata.height > 0;
  } catch { return false; }
}
async function validateRasterUpload(req, res, next) {
  if (!req.file) return next();
  if (await validRaster(req.file)) return next();
  await removeUploadedFile(req);
  return res.status(400).json({ message: 'File content did not match its image type' });
}
module.exports = { IMAGE_FORMATS, validRaster, validateRasterUpload, removeUploadedFile };
