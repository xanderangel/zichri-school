const multer = require("multer");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Files are held in memory (req.file.buffer) rather than written to
 * disk. The caller is responsible for saving that buffer into an
 * UploadedFile row's `data` column — see reportCard.service.js and the
 * profile-picture controllers. This is what keeps uploads (and
 * generated PDFs) intact across a host's restarts/redeploys, since nothing
 * ever depends on the local filesystem still having what it had before.
 */
function makeUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (req, file, cb) => {
      if (!ALLOWED_MIME.has(file.mimetype)) {
        return cb(new Error("Only JPEG, PNG, or WEBP images are allowed"));
      }
      cb(null, true);
    },
  });
}

module.exports = { makeUploader };
