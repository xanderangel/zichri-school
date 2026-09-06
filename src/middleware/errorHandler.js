// Centralized error handler — keeps stack traces out of API responses in
// production while still logging them server-side for debugging.
function errorHandler(err, req, res, next) {
  console.error("[error]", err);

  if (err.message && err.message.includes("Only JPEG, PNG, or WEBP")) {
    return res.status(400).json({ error: err.message });
  }
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File too large (max 5MB)" });
  }

  const status = err.status || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : err.message,
  });
}

module.exports = errorHandler;
