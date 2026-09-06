require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const routes = require("./routes");
const errorHandler = require("./middleware/errorHandler");

const app = express();

// Render (and most hosting platforms) sit the app behind a reverse
// proxy, which rewrites the real client IP into an X-Forwarded-For
// header. Without telling Express to trust that proxy, express-rate-limit
// (used below on login/registration) refuses to trust the header at all
// and throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every rate-limited
// request — breaking login/registration outright rather than just
// mis-tracking rate limits. `1` means "trust exactly one hop" (the
// platform's own proxy), which is the correct, safe value here — it
// doesn't blindly trust arbitrary forwarded headers from the internet.
app.set("trust proxy", 1);

app.use(helmet());
app.use(cors()); // tighten to specific origins before production deploy
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

// A simple, reliable "closed for now" switch — turn it on by setting
// MAINTENANCE_MODE=true in the hosting platform's environment variables
// (no code change or redeploy needed). Every visitor sees a friendly
// notice instead of the app; turn it back off the same way to reopen
// instantly. This exists as a guaranteed fallback alongside whatever
// pause/suspend feature the hosting platform itself offers.
if (process.env.MAINTENANCE_MODE === "true") {
  app.use((req, res) => {
    res.status(503).set("Content-Type", "text/html").send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Zichri School — Temporarily Unavailable</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #eff6ff; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; text-align: center; }
          .box { background: #fff; border-radius: 20px; padding: 40px 28px; max-width: 420px; box-shadow: 0 6px 24px rgba(30,58,138,0.12); }
          h1 { color: #1d4ed8; font-size: 20px; margin: 0 0 12px; }
          p { color: #64748b; font-size: 15px; line-height: 1.5; margin: 0; }
        </style>
      </head>
      <body>
        <div class="box">
          <h1>ZICHRI SCHOOL</h1>
          <p>We're doing some quick maintenance right now. Please check back shortly — we'll be back soon.</p>
        </div>
      </body>
      </html>
    `);
  });
} else {

// Serve uploaded images straight from the database by their UploadedFile
// id — not from local disk. Two reasons this replaced static-directory
// serving: (1) most free hosts (including Render's free tier) wipe local
// disk on every restart/redeploy, so anything written there doesn't
// survive; (2) the app has always referred to images by their database
// id, not by the actual randomly-generated filename multer used to save
// them under — static serving-by-filename could never have matched that
// id in the first place. Storing bytes in the database sidesteps both
// problems at once, using storage that's already persistent (the same
// database everything else lives in) at no extra cost.
async function serveUploadedImage(req, res, purpose) {
  const prisma = require("./lib/prisma");
  const file = await prisma.uploadedFile.findUnique({ where: { id: req.params.fileId } });
  if (!file || file.purpose !== purpose) return res.status(404).send("Not found");
  res.set("Content-Type", file.mimeType);
  res.set("Cache-Control", "public, max-age=31536000, immutable"); // image bytes never change once uploaded — a new upload gets a new id
  res.send(file.data);
}
app.get("/files/profile_images/:fileId", (req, res) => serveUploadedImage(req, res, "PROFILE_IMAGE").catch((err) => res.status(500).json({ error: err.message })));
app.get("/files/school_logo/:fileId", (req, res) => serveUploadedImage(req, res, "SCHOOL_LOGO").catch((err) => res.status(500).json({ error: err.message })));

app.use("/api", routes);

// Admin frontend (mobile-first blue/white dashboard) — static single-page app.
app.use(express.static(require("path").join(__dirname, "..", "public")));
app.get(/^(?!\/api).*/, (req, res) => {
  res.sendFile(require("path").join(__dirname, "..", "public", "index.html"));
});

app.use((req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

} // end of "else" (normal operation) branch from the maintenance-mode check above

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Zichri School Result Management System API listening on port ${PORT}`);
});

module.exports = app;
