const multer = require("multer");

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5MB

// Announcement attachments — PDFs, Word docs, and images only, per
// school policy, at a slightly larger size cap since these are real
// documents (letters, permission slips, etc.) rather than just photos.
const DOCUMENT_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

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
    limits: { fileSize: IMAGE_MAX_BYTES },
    fileFilter: (req, file, cb) => {
      if (!IMAGE_MIME.has(file.mimetype)) {
        return cb(new Error("Only JPEG, PNG, or WEBP images are allowed"));
      }
      cb(null, true);
    },
  });
}

/** For announcement attachments — PDFs, Word docs (.doc/.docx), and images. */
function makeDocumentUploader() {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: DOCUMENT_MAX_BYTES, files: 5 },
    fileFilter: (req, file, cb) => {
      if (!DOCUMENT_MIME.has(file.mimetype)) {
        return cb(new Error("Only PDF, Word documents, or images (JPEG/PNG/WEBP) are allowed"));
      }
      cb(null, true);
    },
  });
}

module.exports = { makeUploader, makeDocumentUploader };
