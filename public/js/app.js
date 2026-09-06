// ============================================================================
// ZICHRI SCHOOL — Admin dashboard frontend (vanilla JS, hash-routed SPA)
// ============================================================================

const appEl = document.getElementById("app");

function route() {
  const hash = window.location.hash || "#/login";
  const [path, queryString] = hash.slice(2).split("?");
  const parts = path.split("/").filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryString || ""));

  const user = Auth.getUser();
  const loggedIn = !!Auth.getAccessToken() && !!user;

  const publicPaths = ["login", "forgot-password", "reset-password", "register-teacher", "register-student"];
  if (!loggedIn && !publicPaths.includes(parts[0])) {
    window.location.hash = "#/login";
    return;
  }

  if (loggedIn && user.role === "ADMIN" && user.mustCompleteAdminSecuritySetup && parts[0] !== "security-setup") {
    window.location.hash = "#/security-setup";
    return;
  }

  switch (parts[0]) {
    case "login": return renderLogin();
    case "forgot-password": return renderForgotPassword();
    case "reset-password": return renderResetPassword();
    case "register-teacher": return renderRegisterTeacher();
    case "register-student": return renderRegisterStudent();
    case "security-setup": return renderSecuritySetup();
    // ---- Admin ----
    case "dashboard": return renderShell(renderDashboard);
    case "teachers": return parts[1] ? renderShell(() => renderTeacherProfile(parts[1])) : renderShell(renderTeachersList);
    case "students": return parts[1] ? renderShell(() => renderStudentProfile(parts[1])) : renderShell(renderStudentsList);
    case "classes": return parts[1] ? renderShell(() => renderClassDetail(parts[1])) : renderShell(renderClassesList);
    case "spreadsheets": return renderShell(renderSpreadsheetsList);
    case "spreadsheet-version": return renderShell(() => renderSpreadsheetVersionDetail(parts[1]));
    case "admin-report-card": return renderShell(() => renderAdminReportCardView(parts[1]));
    case "settings": return renderShell(renderSettings);
    case "audit-log": return renderShell(renderAuditLog);
    case "search": return renderShell(() => renderSearch(query.q || ""));
    // ---- Teacher ----
    case "teacher-profile-setup": return renderTeacherProfileSetup();
    case "teacher-dashboard": return renderTeacherShell(renderTeacherDashboard);
    case "teacher-create-spreadsheet": return renderTeacherShell(renderCreateSpreadsheetWizard);
    case "teacher-spreadsheet": return renderTeacherShell(() => renderSpreadsheetEditor(parts[1]));
    case "teacher-report-card": return renderTeacherShell(() => renderTeacherReportCardView(parts[1]));
    case "teacher-settings": return renderTeacherShell(renderTeacherSettings);
    // ---- Student ----
    case "student-setup-wizard": return renderStudentSetupWizard();
    case "student-dashboard": return renderStudentShell(renderStudentDashboard);
    case "student-report-card": return renderStudentShell(() => renderStudentReportCardDetail(parts[1]));
    case "student-settings": return renderStudentShell(renderStudentSettings);
    default:
      if (!loggedIn) { window.location.hash = "#/login"; return; }
      window.location.hash = user.role === "TEACHER" ? "#/teacher-dashboard" : user.role === "STUDENT" ? "#/student-dashboard" : "#/dashboard";
  }
}
window.addEventListener("hashchange", route);
window.addEventListener("DOMContentLoaded", route);

function go(hash) { window.location.hash = hash; }

// ----------------------------------------------------------------------------
// AUTH SCREENS
// ----------------------------------------------------------------------------

function renderLogin() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header">
        <div class="logo-circle">ZS</div>
        <h1>Zichri School</h1>
        <p>Result Management System — Admin</p>
      </div>
      <div id="login-alert"></div>
      <form id="login-form">
        <div class="form-group">
          <label>Username or Email</label>
          <input type="text" id="username" autocomplete="username" required />
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" id="password" autocomplete="current-password" required />
        </div>
        <button class="btn btn-primary" type="submit">Log In</button>
      </form>
      <div style="text-align:center; margin-top:16px;">
        <a href="#/forgot-password" style="color:var(--blue-600); font-weight:600; font-size:13.5px;">Forgot password?</a>
      </div>
      <div style="text-align:center; margin-top:10px; display:flex; gap:14px; justify-content:center;">
        <a href="#/register-teacher" style="color:var(--gray-500); font-weight:600; font-size:12.5px;">Register as Teacher</a>
        <a href="#/register-student" style="color:var(--gray-500); font-weight:600; font-size:12.5px;">Register as Student</a>
      </div>
    </div>
  `;

  document.getElementById("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("login-alert");
    alertEl.innerHTML = "";
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: { username: document.getElementById("username").value, password: document.getElementById("password").value },
      });
      Auth.setSession(data.accessToken, data.refreshToken, data.user);
      if (data.user.role === "TEACHER") {
        try {
          const me = await api("/teacher/me");
          go(me.teacher.needsProfilePicture ? "#/teacher-profile-setup" : "#/teacher-dashboard");
        } catch {
          go("#/teacher-dashboard");
        }
      } else if (data.user.role === "ADMIN") {
        go(data.user.mustCompleteAdminSecuritySetup ? "#/security-setup" : "#/dashboard");
      } else {
        try {
          const me = await api("/student/me");
          go(me.student.needsProfileSetup ? "#/student-setup-wizard" : "#/student-dashboard");
        } catch {
          go("#/student-dashboard");
        }
      }
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

function renderForgotPassword() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Forgot Password</h1><p>Enter your username to receive a reset link on your verified recovery email.</p></div>
      <div id="fp-alert"></div>
      <form id="fp-form">
        <div class="form-group"><label>Username</label><input type="text" id="fp-username" required /></div>
        <button class="btn btn-primary" type="submit">Send Reset Link</button>
      </form>
      <div style="text-align:center; margin-top:16px;"><a href="#/login" style="color:var(--blue-600); font-weight:600; font-size:13.5px;">Back to login</a></div>
      <div style="text-align:center; margin-top:10px;"><a href="#/reset-password" style="color:var(--gray-500); font-weight:600; font-size:12.5px;">Already have a reset token?</a></div>
    </div>
  `;
  document.getElementById("fp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("fp-alert");
    try {
      const data = await api("/auth/forgot-password", { method: "POST", body: { username: document.getElementById("fp-username").value } });
      alertEl.innerHTML = `<div class="alert alert-success">${data.message}</div>`;
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

function renderResetPassword() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Reset Password</h1><p>Paste the token from your recovery email.</p></div>
      <div id="rp-alert"></div>
      <form id="rp-form">
        <div class="form-group"><label>Reset token</label><input type="text" id="rp-token" required /></div>
        <div class="form-group"><label>New password</label><input type="password" id="rp-password" minlength="8" required /></div>
        <button class="btn btn-primary" type="submit">Reset Password</button>
      </form>
      <div style="text-align:center; margin-top:16px;"><a href="#/login" style="color:var(--blue-600); font-weight:600; font-size:13.5px;">Back to login</a></div>
    </div>
  `;
  document.getElementById("rp-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("rp-alert");
    try {
      await api("/auth/reset-password", { method: "POST", body: { token: document.getElementById("rp-token").value, newPassword: document.getElementById("rp-password").value } });
      alertEl.innerHTML = `<div class="alert alert-success">Password reset. You can now log in.</div>`;
      setTimeout(() => go("#/login"), 1200);
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

/**
 * Forced first-login flow. There is no skip/close control anywhere in
 * this screen, and route() redirects back here on every navigation
 * attempt while mustCompleteAdminSecuritySetup is true — this is what
 * makes the setup actually unbypassable rather than just default-shown.
 */
function renderSecuritySetup() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Security Setup Required</h1><p>Before you can continue, set two recovery emails and a new password.</p></div>
      <div id="ss-alert"></div>
      <form id="ss-form">
        <div class="form-group"><label>Recovery Email 1</label><input type="email" id="ss-email1" required /></div>
        <div class="form-group"><label>Recovery Email 2</label><input type="email" id="ss-email2" required /></div>
        <div class="form-group"><label>New Password</label><input type="password" id="ss-password" minlength="8" required /></div>
        <button class="btn btn-primary" type="submit">Submit &amp; Send Verification Emails</button>
      </form>
    </div>
  `;
  document.getElementById("ss-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("ss-alert");
    try {
      const data = await api("/auth/admin/security-setup", {
        method: "POST",
        body: {
          recoveryEmail1: document.getElementById("ss-email1").value,
          recoveryEmail2: document.getElementById("ss-email2").value,
          newPassword: document.getElementById("ss-password").value,
        },
      });
      alertEl.innerHTML = `<div class="alert alert-success">${data.message} Once both are verified, log in again to continue.</div>`;
      document.getElementById("ss-form").querySelector("button").disabled = true;
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

function renderRegisterTeacher() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Teacher Registration</h1><p>Your account will need Admin verification before you can log in.</p></div>
      <div id="reg-alert"></div>
      <form id="reg-form">
        <div class="form-group"><label>Full name</label><input type="text" id="reg-fullname" required /></div>
        <div class="form-group"><label>Username</label><input type="text" id="reg-username" minlength="3" required /></div>
        <div class="form-group"><label>Email</label><input type="email" id="reg-email" required /></div>
        <div class="form-group"><label>Password</label><input type="password" id="reg-password" minlength="8" required /></div>
        <div class="form-group"><label>Class</label><select id="reg-class" required><option value="">Loading classes…</option></select></div>
        <button class="btn btn-primary" type="submit">Register</button>
      </form>
      <div style="text-align:center; margin-top:16px;"><a href="#/login" style="color:var(--blue-600); font-weight:600; font-size:13.5px;">Back to login</a></div>
    </div>
  `;

  fetch("/api/public/classes").then((r) => r.json()).then((data) => {
    const sel = document.getElementById("reg-class");
    if (!data.classes.length) { sel.innerHTML = `<option value="">No classes available yet — contact Admin</option>`; return; }
    sel.innerHTML = `<option value="">Select a class…</option>` + data.classes.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  });

  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("reg-alert");
    try {
      const data = await api("/register/teacher", {
        method: "POST",
        body: {
          fullName: document.getElementById("reg-fullname").value,
          username: document.getElementById("reg-username").value,
          email: document.getElementById("reg-email").value,
          password: document.getElementById("reg-password").value,
          classId: document.getElementById("reg-class").value,
        },
      });
      alertEl.innerHTML = `<div class="alert alert-success">${data.message}</div>`;
      document.getElementById("reg-form").reset();
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

/**
 * Forced-but-friendly prompt right after a teacher's first successful
 * login (see renderLogin's post-login branch, which routes here whenever
 * needsProfilePicture is true). Uploading takes them straight to the
 * dashboard; there's no skip button per spec.
 */
function renderRegisterStudent() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Student Registration</h1><p>Your account will need Admin approval before you can log in.</p></div>
      <div id="reg-alert"></div>
      <form id="reg-form">
        <div class="form-group"><label>Username</label><input type="text" id="reg-username" minlength="3" required /></div>
        <div class="form-group"><label>Email</label><input type="email" id="reg-email" required /></div>
        <div class="form-group"><label>Password</label><input type="password" id="reg-password" minlength="8" required /></div>
        <button class="btn btn-primary" type="submit">Register</button>
      </form>
      <div style="text-align:center; margin-top:16px;"><a href="#/login" style="color:var(--blue-600); font-weight:600; font-size:13.5px;">Back to login</a></div>
    </div>
  `;

  document.getElementById("reg-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const alertEl = document.getElementById("reg-alert");
    try {
      const data = await api("/register/student", {
        method: "POST",
        body: {
          username: document.getElementById("reg-username").value,
          email: document.getElementById("reg-email").value,
          password: document.getElementById("reg-password").value,
        },
      });
      alertEl.innerHTML = `<div class="alert alert-success">${data.message}</div>`;
      document.getElementById("reg-form").reset();
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

function renderTeacherProfileSetup() {
  appEl.innerHTML = `
    <div class="center-screen">
      <div class="brand-header"><div class="logo-circle">ZS</div><h1>Welcome!</h1><p>Please upload a profile picture to finish setting up your account.</p></div>
      <div id="photo-alert"></div>
      <div class="form-group"><label>Profile picture</label><input type="file" id="photo-input" accept="image/*" /></div>
      <button class="btn btn-primary" id="photo-submit">Upload &amp; Continue</button>
    </div>
  `;
  document.getElementById("photo-submit").addEventListener("click", async () => {
    const alertEl = document.getElementById("photo-alert");
    const file = document.getElementById("photo-input").files[0];
    if (!file) { alertEl.innerHTML = `<div class="alert alert-error">Please choose a photo first.</div>`; return; }
    const form = new FormData();
    form.append("photo", file);
    try {
      await api("/teacher/me/photo", { method: "POST", body: form, isForm: true });
      go("#/teacher-dashboard");
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

function logout() {
  api("/auth/logout", { method: "POST", body: { refreshToken: Auth.getRefreshToken() } }).catch(() => {});
  Auth.clear();
  go("#/login");
}

// ----------------------------------------------------------------------------
// SHELL (topbar + bottom nav) wrapping every logged-in view
// ----------------------------------------------------------------------------

async function renderShell(contentRenderer) {
  const user = Auth.getUser();
  const activePath = (window.location.hash.split("?")[0]).slice(2).split("/")[0];

  appEl.innerHTML = `
    <div class="topbar">
      <div class="topbar-row">
        <div class="topbar-school">ZICHRI SCHOOL</div>
        <div class="topbar-icons">
          <button class="icon-btn" id="notif-btn" title="Notifications">🔔<span class="badge" id="notif-badge" style="display:none;"></span></button>
          <button class="avatar" id="profile-avatar" aria-label="Your profile and settings">${initials(user?.username)}</button>
        </div>
      </div>
      <div class="search-bar">
        <span>🔍</span>
        <input type="text" id="global-search" placeholder="Search teachers, students, classes, spreadsheets…" />
      </div>
    </div>
    <div class="content" id="content"><div class="spinner"></div></div>
    <div class="bottom-nav">
      <button class="nav-item ${activePath === "dashboard" ? "active" : ""}" data-go="#/dashboard"><span class="nav-icon">🏠</span>Home</button>
      <button class="nav-item ${activePath === "teachers" ? "active" : ""}" data-go="#/teachers"><span class="nav-icon">👩‍🏫</span>Teachers</button>
      <button class="nav-item ${activePath === "students" ? "active" : ""}" data-go="#/students"><span class="nav-icon">🎓</span>Students</button>
      <button class="nav-item ${activePath === "spreadsheets" ? "active" : ""}" data-go="#/spreadsheets"><span class="nav-icon">📊</span>Sheets</button>
      <button class="nav-item ${activePath === "settings" ? "active" : ""}" data-go="#/settings"><span class="nav-icon">⚙️</span>Settings</button>
    </div>
  `;

  appEl.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.go)));
  document.getElementById("profile-avatar").addEventListener("click", () => go("#/settings"));
  document.getElementById("notif-btn").addEventListener("click", () => go("#/dashboard"));

  const searchInput = document.getElementById("global-search");
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchInput.value.trim()) {
      go(`#/search?q=${encodeURIComponent(searchInput.value.trim())}`);
    }
  });

  loadNotificationBadge();

  const contentEl = document.getElementById("content");
  try {
    await contentRenderer(contentEl);
  } catch (err) {
    contentEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

async function loadNotificationBadge() {
  try {
    const data = await api("/admin/dashboard-summary");
    const badge = document.getElementById("notif-badge");
    if (badge && data.notificationCount > 0) {
      badge.style.display = "flex";
      badge.textContent = data.notificationCount > 99 ? "99+" : data.notificationCount;
    }
  } catch { /* non-fatal */ }
}

// ----------------------------------------------------------------------------
// DASHBOARD
// ----------------------------------------------------------------------------

async function renderDashboard(contentEl) {
  const [summary, teachers, students] = await Promise.all([
    api("/admin/dashboard-summary"),
    api("/admin/teachers"),
    api("/admin/students"),
  ]);

  contentEl.innerHTML = `
    ${summary.pendingTeachers + summary.pendingStudents > 0 ? `
      <div class="alert alert-info">
        ${summary.pendingTeachers} teacher(s) and ${summary.pendingStudents} student(s) awaiting verification.
      </div>` : ""}

    <div class="tile-grid">
      <div class="tile" data-go="#/teachers"><span class="tile-icon">👩‍🏫</span>Teachers<span class="tile-count">${summary.verifiedTeachers} verified</span></div>
      <div class="tile" data-go="#/students"><span class="tile-icon">🎓</span>Students<span class="tile-count">${summary.verifiedStudents} verified</span></div>
      <div class="tile" data-go="#/classes"><span class="tile-icon">🏫</span>Classes<span class="tile-count">Manage</span></div>
      <div class="tile" data-go="#/spreadsheets"><span class="tile-icon">📊</span>Spreadsheets<span class="tile-count">${summary.lockedSpreadsheets} locked</span></div>
      <div class="tile" data-go="#/settings"><span class="tile-icon">⚙️</span>Settings<span class="tile-count">School config</span></div>
      <div class="tile" data-go="#/audit-log"><span class="tile-icon">📜</span>Audit Log<span class="tile-count">Activity</span></div>
    </div>

    <div class="section-title">Teachers <a class="see-all" href="#/teachers">See all</a></div>
    <div class="hscroll">
      ${teachers.teachers.length ? teachers.teachers.slice(0, 10).map(teacherCardHtml).join("") : `<div class="empty-state">No verified teachers yet.</div>`}
    </div>

    <div class="section-title">Students <a class="see-all" href="#/students">See all</a></div>
    <div class="hscroll">
      ${students.students.length ? students.students.slice(0, 10).map(studentCardHtml).join("") : `<div class="empty-state">No verified students yet.</div>`}
    </div>
  `;

  contentEl.querySelectorAll("[data-go]").forEach((el) => el.addEventListener("click", () => go(el.dataset.go)));
  contentEl.querySelectorAll("[data-teacher]").forEach((el) => el.addEventListener("click", () => go(`#/teachers/${el.dataset.teacher}`)));
  contentEl.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () => go(`#/students/${el.dataset.student}`)));
}

function teacherCardHtml(t) {
  return `
    <div class="person-card" data-teacher="${t.id}">
      <div class="avatar-lg">${t.profileImageId ? `<img src="/files/profile_images/${t.profileImageId}" />` : initials(t.fullName)}</div>
      <div class="name">${escapeHtml(t.fullName)}</div>
      <div class="meta">${escapeHtml(t.className || "Unassigned")}</div>
      <span class="status-pill status-${t.status}">${t.status}</span>
    </div>`;
}

function studentCardHtml(s) {
  return `
    <div class="person-card" data-student="${s.id}">
      <div class="avatar-lg">${s.profileImageId ? `<img src="/files/profile_images/${s.profileImageId}" />` : initials(s.fullName)}</div>
      <div class="name">${escapeHtml(s.fullName)}</div>
      <div class="meta">${escapeHtml(s.className || "Unassigned")}</div>
      <span class="status-pill status-${s.status}">${s.status}</span>
    </div>`;
}

function escapeHtml(str) {
  if (str == null) return "";
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ----------------------------------------------------------------------------
// Shared helpers: page header, confirm modal
// ----------------------------------------------------------------------------

function pageHeaderHtml(title, backHash) {
  return `
    <div class="page-header page-header-bleed">
      <button class="back-btn" data-go="${backHash}" aria-label="Go back">←</button>
      <h2>${title}</h2>
    </div>`;
}

function showConfirmModal({ title, message, confirmLabel = "Confirm", danger = false, onConfirm }) {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <h3>${title}</h3>
      <p style="color:var(--gray-700); font-size:14px;">${message}</p>
      <div class="btn-row">
        <button class="btn btn-outline" id="modal-cancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" id="modal-confirm">${confirmLabel}</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#modal-cancel").addEventListener("click", () => wrap.remove());
  wrap.querySelector("#modal-confirm").addEventListener("click", async () => {
    wrap.remove();
    await onConfirm();
  });
}

function bindNav(el) {
  el.querySelectorAll("[data-go]").forEach((n) => n.addEventListener("click", () => go(n.dataset.go)));
}

// ----------------------------------------------------------------------------
// TEACHERS
// ----------------------------------------------------------------------------

async function renderTeachersList(contentEl) {
  contentEl.innerHTML = `
    ${pageHeaderHtml("Teachers", "#/dashboard")}
    <div class="tabs" id="teacher-tabs">
      <button class="tab-btn active" data-status="VERIFIED">Verified</button>
      <button class="tab-btn" data-status="PENDING">Pending</button>
      <button class="tab-btn" data-status="REJECTED">Rejected</button>
      <button class="tab-btn" data-status="REMOVED">Removed</button>
    </div>
    <div id="teacher-list"><div class="spinner"></div></div>
  `;
  bindNav(contentEl);

  async function load(status) {
    const listEl = document.getElementById("teacher-list");
    listEl.innerHTML = `<div class="spinner"></div>`;
    const data = await api(`/admin/teachers?status=${status}`);
    if (!data.teachers.length) { listEl.innerHTML = `<div class="empty-state">No ${status.toLowerCase()} teachers.</div>`; return; }
    listEl.innerHTML = data.teachers.map((t) => `
      <div class="card" style="display:flex; align-items:center; gap:12px;" data-teacher="${t.id}">
        <div class="avatar-lg" style="margin:0;">${t.profileImageId ? `<img src="/files/profile_images/${t.profileImageId}" />` : initials(t.fullName)}</div>
        <div style="flex:1;">
          <div style="font-weight:700; font-size:14.5px;">${escapeHtml(t.fullName)}</div>
          <div style="font-size:12.5px; color:var(--gray-500);">${escapeHtml(t.className || "Unassigned")}</div>
        </div>
        <span class="status-pill status-${t.status}">${t.status}</span>
      </div>`).join("");
    listEl.querySelectorAll("[data-teacher]").forEach((el) => el.addEventListener("click", () => go(`#/teachers/${el.dataset.teacher}`)));
  }

  contentEl.querySelectorAll("#teacher-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      contentEl.querySelectorAll("#teacher-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      load(btn.dataset.status);
    });
  });

  load("VERIFIED");
}

async function renderTeacherProfile(teacherId) {
  const contentEl = document.getElementById("content");
  const data = await api(`/admin/teachers/${teacherId}`);
  const t = data.teacher;

  contentEl.innerHTML = `
    ${pageHeaderHtml("Teacher Profile", "#/teachers")}
    <div class="card" style="text-align:center;">
      <div class="avatar-lg" style="width:72px; height:72px; font-size:22px; margin:0 auto 10px;">${t.profileImageId ? `<img src="/files/profile_images/${t.profileImageId}" />` : initials(t.fullName)}</div>
      <div style="font-weight:700; font-size:17px;">${escapeHtml(t.fullName)}</div>
      <div style="color:var(--gray-500); font-size:13px; margin-top:2px;">@${escapeHtml(t.username)} · ${escapeHtml(t.email)}</div>
      <div style="margin-top:8px;"><span class="status-pill status-${t.accountStatus}">${t.accountStatus}</span></div>
      <div style="color:var(--gray-500); font-size:12.5px; margin-top:6px;">Classes: ${t.classes.map((c) => escapeHtml(c.name)).join(", ") || "None assigned"}</div>
    </div>

    <div class="btn-row" id="teacher-actions">
      ${t.accountStatus === "PENDING" ? `
        <button class="btn btn-success btn-sm" data-action="VERIFIED">Verify</button>
        <button class="btn btn-danger btn-sm" data-action="REJECTED">Reject</button>` : ""}
      ${t.accountStatus === "VERIFIED" ? `<button class="btn btn-danger btn-sm" data-action="REMOVED">Remove account</button>` : ""}
    </div>

    <div class="section-title">Spreadsheets (newest first)</div>
    ${data.spreadsheets.length ? data.spreadsheets.map((s) => `
      <div class="card spreadsheet-card">
        <div>
          <div class="title">${escapeHtml(s.title)}</div>
          <div class="sub">${escapeHtml(s.term)} · ${s.latestVersion ? fmtDateTime(s.latestVersion.lockedAt) : "No locked version yet"}</div>
        </div>
        ${s.latestVersion?.status === "LOCKED" ? `<span class="version-tag" data-open-version="${s.latestVersion.id}">Version ${s.latestVersion.versionNumber}</span>` : `<span class="version-tag" style="background:var(--gray-200); color:var(--gray-500);">Draft</span>`}
      </div>`).join("") : `<div class="empty-state">This teacher has no spreadsheets yet.</div>`}
  `;

  bindNav(contentEl);
  contentEl.querySelectorAll("[data-open-version]").forEach((el) => el.addEventListener("click", () => go(`#/spreadsheet-version/${el.dataset.openVersion}`)));

  contentEl.querySelectorAll("#teacher-actions [data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = btn.dataset.action;
      const verbs = { VERIFIED: "verify", REJECTED: "reject", REMOVED: "remove" };
      showConfirmModal({
        title: `${verbs[status][0].toUpperCase() + verbs[status].slice(1)} teacher?`,
        message: `Are you sure you want to ${verbs[status]} ${t.fullName}'s account?`,
        confirmLabel: verbs[status][0].toUpperCase() + verbs[status].slice(1),
        danger: status !== "VERIFIED",
        onConfirm: async () => {
          await api(`/admin/accounts/${t.userId}/status`, { method: "PATCH", body: { status } });
          renderTeacherProfile(teacherId);
        },
      });
    });
  });
}

// ----------------------------------------------------------------------------
// STUDENTS
// ----------------------------------------------------------------------------

async function renderStudentsList(contentEl) {
  contentEl.innerHTML = `
    ${pageHeaderHtml("Students", "#/dashboard")}
    <div class="tabs" id="student-tabs">
      <button class="tab-btn active" data-status="VERIFIED">Verified</button>
      <button class="tab-btn" data-status="PENDING">Pending</button>
      <button class="tab-btn" data-status="REJECTED">Rejected</button>
      <button class="tab-btn" data-status="REMOVED">Removed</button>
    </div>
    <div id="student-list"><div class="spinner"></div></div>
  `;
  bindNav(contentEl);

  async function load(status) {
    const listEl = document.getElementById("student-list");
    listEl.innerHTML = `<div class="spinner"></div>`;
    const data = await api(`/admin/students?status=${status}`);
    if (!data.students.length) { listEl.innerHTML = `<div class="empty-state">No ${status.toLowerCase()} students.</div>`; return; }
    listEl.innerHTML = data.students.map((s) => `
      <div class="card" style="display:flex; align-items:center; gap:12px;" data-student="${s.id}">
        <div class="avatar-lg" style="margin:0;">${s.profileImageId ? `<img src="/files/profile_images/${s.profileImageId}" />` : initials(s.fullName)}</div>
        <div style="flex:1;">
          <div style="font-weight:700; font-size:14.5px;">${escapeHtml(s.fullName)}</div>
          <div style="font-size:12.5px; color:var(--gray-500);">${escapeHtml(s.className || "Unassigned")}</div>
        </div>
        <span class="status-pill status-${s.status}">${s.status}</span>
      </div>`).join("");
    listEl.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () => go(`#/students/${el.dataset.student}`)));
  }

  contentEl.querySelectorAll("#student-tabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      contentEl.querySelectorAll("#student-tabs .tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      load(btn.dataset.status);
    });
  });

  load("VERIFIED");
}

async function renderStudentProfile(studentId) {
  const contentEl = document.getElementById("content");
  const [data, classesData] = await Promise.all([
    api(`/admin/students/${studentId}`),
    api("/admin/classes"),
  ]);
  const s = data.student;

  contentEl.innerHTML = `
    ${pageHeaderHtml("Student Profile", "#/students")}
    <div class="card" style="text-align:center;">
      <div class="avatar-lg" style="width:72px; height:72px; font-size:22px; margin:0 auto 10px;">${s.profileImageId ? `<img src="/files/profile_images/${s.profileImageId}" />` : initials(s.firstName + " " + s.lastName)}</div>
      <div style="font-weight:700; font-size:17px;">${escapeHtml(s.firstName)} ${escapeHtml(s.middleName || "")} ${escapeHtml(s.lastName)}</div>
      <div style="color:var(--gray-500); font-size:13px; margin-top:2px;">@${escapeHtml(s.username)} · ${escapeHtml(s.className || "Unassigned")}</div>
      <div style="margin-top:8px;"><span class="status-pill status-${s.accountStatus}">${s.accountStatus}</span></div>
    </div>

    <div class="card">
      <div class="form-group" style="margin-bottom:10px;">
        <label>Class</label>
        <select id="assign-class-select">
          <option value="">No class assigned</option>
          ${classesData.classes.map((c) => `<option value="${c.id}" ${data.student.className === c.name ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </div>
      <button class="btn btn-outline btn-sm" id="assign-class-btn">Save Class</button>
      <div id="assign-class-alert" style="margin-top:8px;"></div>
    </div>

    <div class="btn-row" id="student-actions">
      ${s.accountStatus === "PENDING" ? `
        <button class="btn btn-success btn-sm" data-action="VERIFIED">Accept</button>
        <button class="btn btn-danger btn-sm" data-action="REJECTED">Reject</button>` : ""}
      ${s.accountStatus === "VERIFIED" ? `<button class="btn btn-danger btn-sm" data-action="REMOVED">Remove account</button>` : ""}
    </div>

    <div class="section-title">Report Card History (newest first)</div>
    ${data.reportCards.length ? data.reportCards.map((rc) => `
      <div class="card spreadsheet-card" ${rc.issuedAt ? `data-open-rc="${rc.id}"` : ""} style="${rc.issuedAt ? "" : "opacity:0.6;"}">
        <div>
          <div class="title">${escapeHtml(rc.className)} — ${escapeHtml(rc.termName)}</div>
          <div class="sub">${escapeHtml(rc.sessionName)} · ${rc.issuedAt ? "Issued " + fmtDateTime(rc.issuedAt) : "Not yet issued"}</div>
        </div>
        <span class="version-tag">Version ${rc.versionNumber}</span>
      </div>`).join("") : `<div class="empty-state">No report cards issued yet.</div>`}
  `;

  bindNav(contentEl);
  contentEl.querySelectorAll("[data-open-rc]").forEach((el) => el.addEventListener("click", () => go(`#/admin-report-card/${el.dataset.openRc}`)));

  document.getElementById("assign-class-btn").addEventListener("click", async () => {
    const alertEl = document.getElementById("assign-class-alert");
    const classId = document.getElementById("assign-class-select").value;
    if (!classId) { alertEl.innerHTML = `<div class="alert alert-error">Select a class first.</div>`; return; }
    try {
      await api(`/admin/students/${studentId}/class`, { method: "PATCH", body: { classId } });
      alertEl.innerHTML = `<div class="alert alert-success">Class updated.</div>`;
      renderStudentProfile(studentId);
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  contentEl.querySelectorAll("#student-actions [data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const status = btn.dataset.action;
      const verbs = { VERIFIED: "accept", REJECTED: "reject", REMOVED: "remove" };
      showConfirmModal({
        title: `${verbs[status][0].toUpperCase() + verbs[status].slice(1)} student?`,
        message: `Are you sure you want to ${verbs[status]} ${s.firstName} ${s.lastName}'s account? Historical academic records are never affected by this.`,
        confirmLabel: verbs[status][0].toUpperCase() + verbs[status].slice(1),
        danger: status !== "VERIFIED",
        onConfirm: async () => {
          await api(`/admin/accounts/${s.userId}/status`, { method: "PATCH", body: { status } });
          renderStudentProfile(studentId);
        },
      });
    });
  });
}

// ----------------------------------------------------------------------------
// CLASSES
// ----------------------------------------------------------------------------

async function renderClassesList(contentEl) {
  const data = await api("/admin/classes");
  contentEl.innerHTML = `
    ${pageHeaderHtml("Classes", "#/dashboard")}
    <button class="btn btn-primary" id="new-class-btn" style="margin-bottom:14px;">+ Create Class</button>
    <div id="class-list">
      ${data.classes.length ? data.classes.map((c) => `
        <div class="card" style="display:flex; justify-content:space-between; align-items:center;" data-class="${c.id}">
          <div style="font-weight:700; font-size:14.5px;">${escapeHtml(c.name)}</div>
          <span>›</span>
        </div>`).join("") : `<div class="empty-state">No classes yet. Create one to get started.</div>`}
    </div>
  `;
  bindNav(contentEl);
  contentEl.querySelectorAll("[data-class]").forEach((el) => el.addEventListener("click", () => go(`#/classes/${el.dataset.class}`)));

  document.getElementById("new-class-btn").addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal-sheet">
        <h3>Create Class</h3>
        <div class="form-group"><label>Class name</label><input type="text" id="new-class-name" placeholder="e.g. Basic 6" /></div>
        <div id="new-class-alert"></div>
        <div class="btn-row">
          <button class="btn btn-outline" id="nc-cancel">Cancel</button>
          <button class="btn btn-primary" id="nc-create">Create</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#nc-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#nc-create").addEventListener("click", async () => {
      const name = document.getElementById("new-class-name").value.trim();
      if (!name) return;
      try {
        await api("/admin/classes", { method: "POST", body: { name } });
        wrap.remove();
        renderClassesList(contentEl);
      } catch (err) {
        document.getElementById("new-class-alert").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    });
  });
}

async function renderClassDetail(classId) {
  const contentEl = document.getElementById("content");
  const data = await api(`/admin/classes/${classId}`);

  contentEl.innerHTML = `
    ${pageHeaderHtml(data.class.name, "#/classes")}
    <div class="btn-row">
      <button class="btn btn-outline btn-sm" id="rename-btn">Rename</button>
      <button class="btn btn-danger btn-sm" id="archive-btn">Archive class</button>
    </div>

    <div class="section-title">Teachers</div>
    ${data.teachers.length ? data.teachers.map((t) => `
      <div class="card" style="display:flex; align-items:center; gap:12px;" data-teacher="${t.id}">
        <div class="avatar-lg" style="margin:0; width:44px; height:44px; font-size:14px;">${t.profileImageId ? `<img src="/files/profile_images/${t.profileImageId}" />` : initials(t.fullName)}</div>
        <div style="flex:1; font-weight:600; font-size:14px;">${escapeHtml(t.fullName)}</div>
        <span class="status-pill status-${t.status}">${t.status}</span>
      </div>`).join("") : `<div class="empty-state">No teachers assigned.</div>`}

    <div class="section-title">Students</div>
    ${data.students.length ? data.students.map((s) => `
      <div class="card" style="display:flex; align-items:center; gap:12px;" data-student="${s.id}">
        <div class="avatar-lg" style="margin:0; width:44px; height:44px; font-size:14px;">${s.profileImageId ? `<img src="/files/profile_images/${s.profileImageId}" />` : initials(s.fullName)}</div>
        <div style="flex:1; font-weight:600; font-size:14px;">${escapeHtml(s.fullName)}</div>
        <span class="status-pill status-${s.status}">${s.status}</span>
      </div>`).join("") : `<div class="empty-state">No students in this class.</div>`}
  `;

  bindNav(contentEl);
  contentEl.querySelectorAll("[data-teacher]").forEach((el) => el.addEventListener("click", () => go(`#/teachers/${el.dataset.teacher}`)));
  contentEl.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () => go(`#/students/${el.dataset.student}`)));

  document.getElementById("rename-btn").addEventListener("click", () => {
    const newName = prompt("New class name:", data.class.name);
    if (!newName || newName === data.class.name) return;
    api(`/admin/classes/${classId}`, { method: "PATCH", body: { name: newName } })
      .then(() => renderClassDetail(classId))
      .catch((err) => alert(err.message));
  });

  document.getElementById("archive-btn").addEventListener("click", () => {
    showConfirmModal({
      title: "Archive this class?",
      message: "The class will be hidden from new-spreadsheet pickers, but all historical spreadsheets, report cards, and student records tied to it remain fully intact and accessible.",
      confirmLabel: "Archive",
      danger: true,
      onConfirm: async () => {
        await api(`/admin/classes/${classId}/archive`, { method: "POST" });
        go("#/classes");
      },
    });
  });
}

// ----------------------------------------------------------------------------
// SPREADSHEETS
// ----------------------------------------------------------------------------

async function renderSpreadsheetsList(contentEl) {
  const data = await api("/admin/spreadsheets");
  contentEl.innerHTML = `
    ${pageHeaderHtml("Locked Spreadsheets", "#/dashboard")}
    ${data.spreadsheets.length ? data.spreadsheets.map((s) => `
      <div class="card spreadsheet-card" data-sheet="${s.spreadsheetId}">
        <div>
          <div class="title">${escapeHtml(s.title)}</div>
          <div class="sub">${escapeHtml(s.term)} · ${fmtDateTime(s.lockedAt)} · ${escapeHtml(s.teacher.fullName)}</div>
        </div>
        <span class="version-tag">${escapeHtml(s.versionLabel)}</span>
      </div>`).join("") : `<div class="empty-state">No locked spreadsheets yet. They'll appear here once a teacher locks one.</div>`}
  `;
  bindNav(contentEl);
  contentEl.querySelectorAll("[data-sheet]").forEach((el) => {
    el.addEventListener("click", async () => {
      const versions = await api(`/admin/spreadsheets/${el.dataset.sheet}/versions`);
      const latest = versions.versions[versions.versions.length - 1];
      if (latest) go(`#/spreadsheet-version/${latest.id}`);
    });
  });
}

async function renderSpreadsheetVersionDetail(versionId) {
  const contentEl = document.getElementById("content");
  const detail = await api(`/admin/spreadsheet-versions/${versionId}`);
  const [allVersions, delivery] = await Promise.all([
    api(`/admin/spreadsheets/${detail.spreadsheet.id}/versions`).catch(() => ({ versions: [] })),
    api(`/admin/spreadsheet-versions/${versionId}/delivery-status`).catch(() => ({ reportCards: [] })),
  ]);

  const deliveredIds = new Set(delivery.reportCards.filter((rc) => rc.issuedAt).map((rc) => rc.studentId));

  contentEl.innerHTML = `
    ${pageHeaderHtml(detail.spreadsheet.title, "#/spreadsheets")}
    <div class="alert alert-info">Read-only — Admin cannot edit scores. Teacher: ${escapeHtml(detail.spreadsheet.teacherName)}</div>

    <div class="tabs">
      ${allVersions.versions.map((v) => `<button class="tab-btn ${v.id === versionId ? "active" : ""}" data-version="${v.id}">Version ${v.versionNumber}</button>`).join("")}
    </div>

    <div class="select-all-row">
      <input type="checkbox" id="select-all" />
      <label for="select-all">SELECT ALL</label>
    </div>

    <div class="row-checkbox-list" id="student-rows">
      ${detail.rows.map((r) => {
        const totalDisplay = r.scores.map((sc) => `${sc.subject.name}: ${sc.totalScore ?? "-"}`).join(" · ");
        const alreadySent = deliveredIds.has(r.student.id);
        return `
        <div class="student-row" data-student-row="${r.student.id}">
          <input type="checkbox" class="student-checkbox" value="${r.student.id}" />
          <div class="info" data-open-report="${r.student.id}">
            <div class="name">${escapeHtml(r.student.firstName)} ${escapeHtml(r.student.lastName)} ${alreadySent ? '<span class="status-pill status-VERIFIED" style="margin-left:6px;">SENT</span>' : ""}</div>
            <div class="scores">${totalDisplay || "No scores recorded"}</div>
          </div>
        </div>`;
      }).join("")}
    </div>

    <div class="btn-row" style="margin-bottom:10px;">
      <button class="btn btn-outline btn-sm" id="batch-pdf-btn">📚 Download All Report Cards (PDF)</button>
    </div>

    <button class="btn btn-primary" id="send-btn" style="margin-top:16px;">SEND REPORT CARDS</button>
    <div id="send-alert"></div>
  `;

  bindNav(contentEl);

  contentEl.querySelectorAll("[data-version]").forEach((btn) => btn.addEventListener("click", () => go(`#/spreadsheet-version/${btn.dataset.version}`)));

  document.getElementById("select-all").addEventListener("change", (e) => {
    contentEl.querySelectorAll(".student-checkbox").forEach((cb) => (cb.checked = e.target.checked));
  });

  document.getElementById("batch-pdf-btn").addEventListener("click", async () => {
    try { await downloadAuthenticatedFile(`/admin/spreadsheet-versions/${versionId}/report-cards/pdf`, `${detail.spreadsheet.title}-report-cards.pdf`); }
    catch (err) { alert(err.message); }
  });

  contentEl.querySelectorAll("[data-open-report]").forEach((el) => {
    el.addEventListener("click", () => {
      const studentId = el.dataset.openReport;
      const rc = delivery.reportCards.find((r) => r.studentId === studentId);
      if (rc && rc.issuedAt) {
        go(`#/admin-report-card/${rc.reportCardId}`);
      } else {
        go(`#/students/${studentId}`);
      }
    });
  });

  document.getElementById("send-btn").addEventListener("click", () => {
    const selected = Array.from(contentEl.querySelectorAll(".student-checkbox:checked")).map((cb) => cb.value);
    const alertEl = document.getElementById("send-alert");
    if (!selected.length) {
      alertEl.innerHTML = `<div class="alert alert-error">Select at least one student first.</div>`;
      return;
    }
    showConfirmModal({
      title: "Send report cards?",
      message: `This will deliver report cards to ${selected.length} selected student(s), email a copy to each (if configured), and send an administrative copy. This cannot be undone.`,
      confirmLabel: "Send",
      onConfirm: async () => {
        alertEl.innerHTML = `<div class="alert alert-info">Sending…</div>`;
        try {
          await api(`/admin/spreadsheet-versions/${versionId}/send-report-cards`, {
            method: "POST",
            body: { studentIds: selected, confirm: true },
          });
          alertEl.innerHTML = `<div class="alert alert-success">Report cards sent to ${selected.length} student(s).</div>`;
          renderSpreadsheetVersionDetail(versionId);
        } catch (err) {
          alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
        }
      },
    });
  });
}

// ----------------------------------------------------------------------------
// SETTINGS
// ----------------------------------------------------------------------------

async function renderSettings(contentEl) {
  const [settingsData, me, sessionsData] = await Promise.all([
    api("/admin/school-settings"),
    api("/me"),
    api("/admin/sessions"),
  ]);
  const s = settingsData.settings;
  const phones = s.phoneNumbers ? JSON.parse(s.phoneNumbers) : [];

  contentEl.innerHTML = `
    ${pageHeaderHtml("Settings", "#/dashboard")}

    <div class="section-title">School Profile</div>
    <div class="card">
      <div class="form-group"><label>School name</label><input type="text" id="set-name" value="${escapeHtml(s.schoolName)}" /></div>
      <div class="form-group"><label>Address</label><textarea id="set-address">${escapeHtml(s.address)}</textarea></div>
      <div class="form-group"><label>Telephone number(s) — comma separated</label><input type="text" id="set-phones" value="${escapeHtml(phones.join(", "))}" /></div>
      <div class="form-group"><label>Administrative email</label><input type="email" id="set-admin-email" value="${escapeHtml(s.administrativeEmail || "")}" /></div>
      <div class="form-group"><label>School logo</label><input type="file" id="set-logo" accept="image/*" /></div>
      <button class="btn btn-primary" id="save-settings-btn">Save Changes</button>
      <div id="settings-alert"></div>
    </div>

    <div class="section-title">Academic Sessions &amp; Terms</div>
    <div class="card">
      <p style="font-size:12.5px; color:var(--gray-500); margin-top:0;">Teachers pick from these when creating a spreadsheet — add a session (e.g. 2025/2026) and at least one term under it before teachers can get started.</p>
      <div style="display:flex; gap:8px; margin-bottom:14px;">
        <input type="text" id="new-session-input" placeholder="e.g. 2025/2026" style="flex:1; min-height:44px; border-radius:10px; border:1.5px solid var(--gray-200); padding:0 14px;" />
        <button class="btn btn-outline btn-sm" id="add-session-btn">Add Session</button>
      </div>
      <div id="sessions-alert"></div>
      <div id="sessions-list">
        ${sessionsData.sessions.length ? sessionsData.sessions.map((sess) => `
          <div class="card" style="margin-bottom:10px;">
            <div style="font-weight:700; color:var(--blue-900); margin-bottom:6px;">${escapeHtml(sess.name)}</div>
            <div style="font-size:12.5px; color:var(--gray-500); margin-bottom:8px;">
              ${sess.terms.length ? sess.terms.map((t) => escapeHtml(t.name)).join(" · ") : "No terms yet"}
            </div>
            <div style="display:flex; gap:8px;">
              <input type="text" class="new-term-input" data-session="${sess.id}" placeholder="e.g. 1st Term" style="flex:1; min-height:40px; border-radius:8px; border:1.5px solid var(--gray-200); padding:0 12px; font-size:13px;" />
              <button class="btn btn-outline btn-sm add-term-btn" data-session="${sess.id}">Add Term</button>
            </div>
          </div>
        `).join("") : `<div class="empty-state">No academic sessions yet — add one above.</div>`}
      </div>
    </div>

    <div class="section-title">Account Security</div>
    <div class="card">
      <div style="font-size:13px; color:var(--gray-700); margin-bottom:10px;">Logged in as <b>${escapeHtml(me.user.username)}</b></div>
      <button class="btn btn-outline" id="change-pw-btn">Change Password</button>
      <div id="pw-alert" style="margin-top:10px;"></div>
    </div>

    <div class="section-title"></div>
    <button class="btn btn-danger" id="logout-btn">Log Out</button>
  `;

  bindNav(contentEl);

  document.getElementById("add-session-btn").addEventListener("click", async () => {
    const input = document.getElementById("new-session-input");
    const name = input.value.trim();
    const alertEl = document.getElementById("sessions-alert");
    if (!name) { alertEl.innerHTML = `<div class="alert alert-error">Enter a session name first, e.g. 2025/2026.</div>`; return; }
    try {
      await api("/admin/sessions", { method: "POST", body: { name } });
      renderSettings(contentEl);
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  contentEl.querySelectorAll(".add-term-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sessionId = btn.dataset.session;
      const input = contentEl.querySelector(`.new-term-input[data-session="${sessionId}"]`);
      const name = input.value.trim();
      const alertEl = document.getElementById("sessions-alert");
      if (!name) { alertEl.innerHTML = `<div class="alert alert-error">Enter a term name first, e.g. 1st Term.</div>`; return; }
      try {
        await api("/admin/terms", { method: "POST", body: { sessionId, name } });
        renderSettings(contentEl);
      } catch (err) {
        alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    });
  });

  document.getElementById("save-settings-btn").addEventListener("click", async () => {
    const alertEl = document.getElementById("settings-alert");
    try {
      await api("/admin/school-settings", {
        method: "PATCH",
        body: {
          schoolName: document.getElementById("set-name").value,
          address: document.getElementById("set-address").value,
          phoneNumbers: document.getElementById("set-phones").value.split(",").map((p) => p.trim()).filter(Boolean),
          administrativeEmail: document.getElementById("set-admin-email").value || undefined,
        },
      });

      const logoFile = document.getElementById("set-logo").files[0];
      if (logoFile) {
        const form = new FormData();
        form.append("logo", logoFile);
        await api("/admin/school-settings/logo", { method: "POST", body: form, isForm: true });
      }

      alertEl.innerHTML = `<div class="alert alert-success">Settings saved.</div>`;
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  document.getElementById("change-pw-btn").addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal-sheet">
        <h3>Change Password</h3>
        <div class="form-group"><label>Current password</label><input type="password" id="cp-current" /></div>
        <div class="form-group"><label>New password</label><input type="password" id="cp-new" minlength="8" /></div>
        <div id="cp-alert"></div>
        <div class="btn-row">
          <button class="btn btn-outline" id="cp-cancel">Cancel</button>
          <button class="btn btn-primary" id="cp-submit">Update</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#cp-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#cp-submit").addEventListener("click", async () => {
      try {
        await api("/auth/change-password", {
          method: "POST",
          body: { currentPassword: document.getElementById("cp-current").value, newPassword: document.getElementById("cp-new").value },
        });
        wrap.remove();
        document.getElementById("pw-alert").innerHTML = `<div class="alert alert-success">Password updated.</div>`;
      } catch (err) {
        wrap.querySelector("#cp-alert").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    });
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    showConfirmModal({ title: "Log out?", message: "You'll need to log in again to access the dashboard.", confirmLabel: "Log Out", danger: true, onConfirm: async () => logout() });
  });
}

// ----------------------------------------------------------------------------
// AUDIT LOG
// ----------------------------------------------------------------------------

async function renderAuditLog(contentEl) {
  const data = await api("/admin/audit-logs?limit=100");
  contentEl.innerHTML = `
    ${pageHeaderHtml("Audit Log", "#/dashboard")}
    ${data.logs.length ? data.logs.map((l) => `
      <div class="audit-row">
        <div class="action">${escapeHtml(l.action.replace(/_/g, " "))}</div>
        <div class="time">${fmtDateTime(l.createdAt)} ${l.actorUser ? "· by " + escapeHtml(l.actorUser.username) : ""}</div>
      </div>`).join("") : `<div class="empty-state">No activity recorded yet.</div>`}
  `;
  bindNav(contentEl);
}

// ----------------------------------------------------------------------------
// SEARCH
// ----------------------------------------------------------------------------

async function renderSearch(query) {
  const contentEl = document.getElementById("content");
  if (!query) { contentEl.innerHTML = `${pageHeaderHtml("Search", "#/dashboard")}<div class="empty-state">Type something in the search bar above.</div>`; return; }

  const data = await api(`/admin/search?q=${encodeURIComponent(query)}`);

  const section = (title, items, renderItem) => items.length ? `
    <div class="section-title">${title}</div>
    ${items.map(renderItem).join("")}
  ` : "";

  contentEl.innerHTML = `
    ${pageHeaderHtml(`Results for "${escapeHtml(query)}"`, "#/dashboard")}
    ${section("Teachers", data.teachers, (t) => `<div class="card" data-teacher="${t.id}"><b>${escapeHtml(t.fullName)}</b><div class="sub" style="color:var(--gray-500); font-size:12.5px;">@${escapeHtml(t.username)} · ${escapeHtml(t.email)}</div></div>`)}
    ${section("Students", data.students, (s) => `<div class="card" data-student="${s.id}"><b>${escapeHtml(s.fullName)}</b><div class="sub" style="color:var(--gray-500); font-size:12.5px;">@${escapeHtml(s.username)} · ${escapeHtml(s.className || "")}</div></div>`)}
    ${section("Classes", data.classes, (c) => `<div class="card" data-classitem="${c.id}"><b>${escapeHtml(c.name)}</b></div>`)}
    ${section("Spreadsheets", data.spreadsheets, (sp) => `<div class="card"><b>${escapeHtml(sp.title)}</b><div class="sub" style="color:var(--gray-500); font-size:12.5px;">${escapeHtml(sp.term)}</div></div>`)}
    ${!data.teachers.length && !data.students.length && !data.classes.length && !data.spreadsheets.length ? `<div class="empty-state">No results found.</div>` : ""}
  `;

  bindNav(contentEl);
  contentEl.querySelectorAll("[data-teacher]").forEach((el) => el.addEventListener("click", () => go(`#/teachers/${el.dataset.teacher}`)));
  contentEl.querySelectorAll("[data-student]").forEach((el) => el.addEventListener("click", () => go(`#/students/${el.dataset.student}`)));
  contentEl.querySelectorAll("[data-classitem]").forEach((el) => el.addEventListener("click", () => go(`#/classes/${el.dataset.classitem}`)));
}

// ============================================================================
// TEACHER EXPERIENCE
// ============================================================================

async function renderTeacherShell(contentRenderer) {
  const activePath = (window.location.hash.split("?")[0]).slice(2).split("/")[0];

  appEl.innerHTML = `
    <div class="topbar">
      <div class="topbar-row">
        <div class="topbar-school">ZICHRI SCHOOL</div>
        <div class="topbar-icons">
          <button class="avatar" id="teacher-avatar" aria-label="Your profile and settings">?</button>
        </div>
      </div>
    </div>
    <div class="content" id="content"><div class="spinner"></div></div>
    <div class="bottom-nav">
      <button class="nav-item ${activePath === "teacher-dashboard" ? "active" : ""}" data-go="#/teacher-dashboard"><span class="nav-icon">🏠</span>Home</button>
      <button class="nav-item ${activePath === "teacher-create-spreadsheet" ? "active" : ""}" data-go="#/teacher-create-spreadsheet"><span class="nav-icon">➕</span>Create</button>
      <button class="nav-item ${activePath === "teacher-settings" ? "active" : ""}" data-go="#/teacher-settings"><span class="nav-icon">⚙️</span>Settings</button>
    </div>
  `;
  appEl.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.go)));
  document.getElementById("teacher-avatar").addEventListener("click", () => go("#/teacher-settings"));

  api("/teacher/me").then((me) => {
    document.getElementById("teacher-avatar").innerHTML = me.teacher.profileImageId
      ? `<img src="/files/profile_images/${me.teacher.profileImageId}" />`
      : initials(me.teacher.fullName);
  }).catch(() => {});

  const contentEl = document.getElementById("content");
  try {
    await contentRenderer(contentEl);
  } catch (err) {
    contentEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

async function renderTeacherDashboard(contentEl) {
  const [me, sheets] = await Promise.all([api("/teacher/me"), api("/teacher/spreadsheets")]);
  const t = me.teacher;

  contentEl.innerHTML = `
    <div class="card" style="text-align:center;">
      <div class="avatar-lg" style="width:64px; height:64px; font-size:20px; margin:0 auto 8px;">${t.profileImageId ? `<img src="/files/profile_images/${t.profileImageId}" />` : initials(t.fullName)}</div>
      <div style="font-weight:700; font-size:16px;">${escapeHtml(t.fullName)}</div>
      <div style="color:var(--gray-500); font-size:12.5px; margin-top:2px;">${escapeHtml(t.class?.name || "No class assigned")} · ${escapeHtml(t.email)}</div>
    </div>

    <button class="btn btn-primary" id="create-sheet-btn" style="margin:14px 0;">+ Create Spreadsheet</button>

    <div class="section-title">Your Spreadsheets</div>
    ${sheets.spreadsheets.length ? sheets.spreadsheets.map((s) => `
      <div class="card spreadsheet-card" data-open="${s.latest ? s.latest.id : s.currentVersionId}">
        <div>
          <div class="title">${escapeHtml(s.title)}</div>
          <div class="sub">${escapeHtml(s.term)} · ${s.latest ? fmtDateTime(s.latest.lockedAt || s.latest.updatedAt) : "Not started"}</div>
        </div>
        <span class="version-tag" style="${s.latest?.status === 'LOCKED' ? '' : 'background:var(--gray-200); color:var(--gray-500);'}">
          ${s.latest ? (s.latest.status === "LOCKED" ? `Version ${s.latest.versionNumber} · Locked` : `Version ${s.latest.versionNumber} · Draft`) : "Draft"}
        </span>
      </div>`).join("") : `<div class="empty-state">No spreadsheets yet. Create your first one to get started.</div>`}
  `;

  document.getElementById("create-sheet-btn").addEventListener("click", () => go("#/teacher-create-spreadsheet"));
  contentEl.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => go(`#/teacher-spreadsheet/${el.dataset.open}`)));
}

async function renderTeacherSettings(contentEl) {
  const me = await api("/teacher/me");
  contentEl.innerHTML = `
    ${pageHeaderHtml("Settings", "#/teacher-dashboard")}
    <div class="card">
      <div style="font-size:13px; color:var(--gray-700); margin-bottom:10px;">Logged in as <b>${escapeHtml(me.teacher.username)}</b> (${escapeHtml(me.teacher.email)})</div>
      <div class="form-group"><label>Update profile picture</label><input type="file" id="pic-input" accept="image/*" /></div>
      <button class="btn btn-outline" id="pic-save-btn">Update Photo</button>
      <div id="pic-alert" style="margin-top:10px;"></div>
    </div>
    <div class="card">
      <button class="btn btn-outline" id="change-pw-btn">Change Password</button>
      <div id="pw-alert" style="margin-top:10px;"></div>
    </div>
    <button class="btn btn-danger" id="logout-btn">Log Out</button>
  `;
  bindNav(contentEl);

  document.getElementById("pic-save-btn").addEventListener("click", async () => {
    const alertEl = document.getElementById("pic-alert");
    const file = document.getElementById("pic-input").files[0];
    if (!file) return;
    const form = new FormData();
    form.append("photo", file);
    try {
      await api("/teacher/me/photo", { method: "POST", body: form, isForm: true });
      alertEl.innerHTML = `<div class="alert alert-success">Photo updated.</div>`;
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  document.getElementById("change-pw-btn").addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal-sheet">
        <h3>Change Password</h3>
        <div class="form-group"><label>Current password</label><input type="password" id="cp-current" /></div>
        <div class="form-group"><label>New password</label><input type="password" id="cp-new" minlength="8" /></div>
        <div id="cp-alert"></div>
        <div class="btn-row"><button class="btn btn-outline" id="cp-cancel">Cancel</button><button class="btn btn-primary" id="cp-submit">Update</button></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#cp-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#cp-submit").addEventListener("click", async () => {
      try {
        await api("/auth/change-password", { method: "POST", body: { currentPassword: document.getElementById("cp-current").value, newPassword: document.getElementById("cp-new").value } });
        wrap.remove();
        document.getElementById("pw-alert").innerHTML = `<div class="alert alert-success">Password updated.</div>`;
      } catch (err) {
        wrap.querySelector("#cp-alert").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    });
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    showConfirmModal({ title: "Log out?", message: "You'll need to log in again.", confirmLabel: "Log Out", danger: true, onConfirm: async () => logout() });
  });
}

// ----------------------------------------------------------------------------
// CREATE SPREADSHEET WIZARD
// ----------------------------------------------------------------------------

async function renderCreateSpreadsheetWizard(contentEl) {
  const options = await api("/teacher/create-options");
  let selectedStudents = new Set();
  let selectedSubjects = new Set();

  contentEl.innerHTML = `
    ${pageHeaderHtml("Create Spreadsheet", "#/teacher-dashboard")}
    <div id="wizard-alert"></div>

    <div class="wizard-step">
      <h4>Class</h4>
      <div class="card" style="font-weight:700; color:var(--blue-900);">${escapeHtml(options.class?.name || "No class assigned — contact Admin")}</div>
    </div>

    <div class="wizard-step">
      <h4>Academic Year</h4>
      <div class="form-group">
        <select id="session-select">
          <option value="">Select academic year…</option>
          ${options.sessions.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}
        </select>
      </div>
    </div>

    <div class="wizard-step">
      <h4>Term</h4>
      <div class="form-group">
        <select id="term-select" disabled>
          <option value="">Select academic year first…</option>
        </select>
      </div>
    </div>

    <div class="wizard-step">
      <h4>Students</h4>
      <input type="text" id="student-search" placeholder="Search students…" style="width:100%; max-width:480px; min-height:44px; border-radius:10px; border:1.5px solid var(--gray-200); padding:0 14px; margin-bottom:8px;" />
      <div class="select-all-inline"><input type="checkbox" id="student-select-all" /><label for="student-select-all">Select All</label></div>
      <div class="checkbox-list" id="student-checkbox-list">
        ${options.students.map((s) => `
          <label class="checkbox-row"><input type="checkbox" class="student-cb" value="${s.id}" data-name="${escapeHtml((s.firstName + ' ' + s.lastName).toLowerCase())}" /> ${escapeHtml(s.firstName)} ${escapeHtml(s.lastName)}</label>
        `).join("") || `<div class="empty-state">No verified students in this class yet.</div>`}
      </div>
    </div>

    <div class="wizard-step">
      <h4>Subjects</h4>
      <div style="display:flex; gap:8px; margin-bottom:8px;">
        <input type="text" id="new-subject-input" placeholder="Add a new subject…" style="flex:1; min-height:44px; border-radius:10px; border:1.5px solid var(--gray-200); padding:0 14px;" />
        <button class="btn btn-outline btn-sm" id="add-subject-btn">Add</button>
      </div>
      <div class="checkbox-list" id="subject-checkbox-list">
        ${options.subjects.map((s) => `<label class="checkbox-row"><input type="checkbox" class="subject-cb" value="${s.id}" /> ${escapeHtml(s.name)}</label>`).join("")}
      </div>
    </div>

    <button class="btn btn-primary" id="create-submit-btn" style="margin-top:10px;">Create Spreadsheet</button>
  `;
  bindNav(contentEl);

  document.getElementById("session-select").addEventListener("change", (e) => {
    const session = options.sessions.find((s) => s.id === e.target.value);
    const termSelect = document.getElementById("term-select");
    if (!session) { termSelect.innerHTML = `<option value="">Select academic year first…</option>`; termSelect.disabled = true; return; }
    termSelect.disabled = false;
    termSelect.innerHTML = `<option value="">Select term…</option>` + session.terms.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  });

  document.getElementById("student-search").addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    contentEl.querySelectorAll(".student-cb").forEach((cb) => {
      cb.closest(".checkbox-row").style.display = cb.dataset.name.includes(q) ? "" : "none";
    });
  });

  document.getElementById("student-select-all").addEventListener("change", (e) => {
    contentEl.querySelectorAll(".student-cb").forEach((cb) => { if (cb.closest(".checkbox-row").style.display !== "none") cb.checked = e.target.checked; });
  });

  document.getElementById("add-subject-btn").addEventListener("click", async () => {
    const input = document.getElementById("new-subject-input");
    const name = input.value.trim();
    if (!name) return;
    try {
      const data = await api("/teacher/subjects", { method: "POST", body: { name } });
      const list = document.getElementById("subject-checkbox-list");
      if (!list.querySelector(`input[value="${data.subject.id}"]`)) {
        list.insertAdjacentHTML("beforeend", `<label class="checkbox-row"><input type="checkbox" class="subject-cb" value="${data.subject.id}" checked /> ${escapeHtml(data.subject.name)}</label>`);
      } else {
        list.querySelector(`input[value="${data.subject.id}"]`).checked = true;
      }
      input.value = "";
    } catch (err) {
      document.getElementById("wizard-alert").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  document.getElementById("create-submit-btn").addEventListener("click", async () => {
    const alertEl = document.getElementById("wizard-alert");
    const sessionId = document.getElementById("session-select").value;
    const termId = document.getElementById("term-select").value;
    const studentIds = Array.from(contentEl.querySelectorAll(".student-cb:checked")).map((cb) => cb.value);
    const subjectIds = Array.from(contentEl.querySelectorAll(".subject-cb:checked")).map((cb) => cb.value);

    if (!sessionId || !termId) { alertEl.innerHTML = `<div class="alert alert-error">Select an academic year and term.</div>`; return; }
    if (!studentIds.length) { alertEl.innerHTML = `<div class="alert alert-error">Select at least one student.</div>`; return; }
    if (!subjectIds.length) { alertEl.innerHTML = `<div class="alert alert-error">Select at least one subject.</div>`; return; }

    try {
      const data = await api("/teacher/spreadsheets", { method: "POST", body: { sessionId, termId, studentIds, subjectIds } });
      go(`#/teacher-spreadsheet/${data.versionId}`);
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

// ----------------------------------------------------------------------------
// Client-side grading mirror — for instant visual feedback only. The
// server (src/lib/grading.js) is the actual source of truth and
// re-validates everything independently; this copy exists purely so the
// UI doesn't have to round-trip to the server on every keystroke.
// ----------------------------------------------------------------------------

const GRADE_BANDS_CLIENT = [
  { min: 90, max: 100, grade: "A+", label: "Outstanding" },
  { min: 80, max: 89, grade: "A", label: "Excellent" },
  { min: 70, max: 79, grade: "B+", label: "Very Good" },
  { min: 60, max: 69, grade: "B", label: "Good" },
  { min: 50, max: 59, grade: "C", label: "Average" },
  { min: 40, max: 49, grade: "D", label: "Fair" },
  { min: 0, max: 39, grade: "F", label: "Fail" },
];
// Same gap-free floor-check logic as the server's grading.js — see that
// file for why an inclusive min/max range on adjacent whole-number bands
// silently misgraded any decimal percentage (e.g. 89.5%) as F.
function gradeForPct(pct) {
  for (const band of GRADE_BANDS_CLIENT) {
    if (pct >= band.min) return band;
  }
  return GRADE_BANDS_CLIENT[GRADE_BANDS_CLIENT.length - 1];
}
function computeSubjectResultClient(test, exam) {
  const hasTest = test !== null && test !== undefined;
  const hasExam = exam !== null && exam !== undefined;
  if (!hasTest && !hasExam) return { totalScore: null, grade: null };
  const total = (hasTest ? test : 0) + (hasExam ? exam : 0);
  if (!hasTest || !hasExam) return { totalScore: total, grade: null };
  return { totalScore: total, grade: gradeForPct(total).grade };
}
function computeOverallClient(subjectTotals, subjectCount) {
  const maxScore = subjectCount * 100;
  const totalScore = subjectTotals.reduce((sum, t) => sum + (t || 0), 0);
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 10000) / 100 : 0;
  const band = gradeForPct(percentage);
  return { maxScore, totalScore, percentage, finalGrade: band.grade, gradeLabel: band.label };
}

const PSYCHOMOTOR_TRAITS = ["Handwriting", "Verbal Fluency", "Sports/Games", "Punctuality", "Drawing & Painting"];

async function renderSpreadsheetEditor(versionId) {
  const contentEl = document.getElementById("content");
  const view = await api(`/teacher/spreadsheet-versions/${versionId}`);
  const schoolInfo = await fetch("/api/public/school-info").then((r) => r.json()).catch(() => ({ schoolName: "ZICHRI SCHOOL", address: "" }));

  const locked = view.version.status === "LOCKED";

  // Live editable state, seeded from the server view, mutated in place as the teacher types.
  const state = {
    scores: {}, // `${studentId}:${subjectId}` -> {testScore, examScore}
    psychomotor: {}, // `${studentId}:${trait}` -> rating|null
    schoolOpened: null,
    present: {}, // studentId -> value
    remarks: {}, // studentId -> text
  };
  view.rows.forEach((row) => {
    view.subjects.forEach((subj) => {
      state.scores[`${row.student.id}:${subj.id}`] = { ...row.scores[subj.id] };
    });
    PSYCHOMOTOR_TRAITS.forEach((trait) => {
      const found = row.psychomotor.find((p) => p.trait === trait);
      state.psychomotor[`${row.student.id}:${trait}`] = found ? found.rating : null;
    });
    if (row.attendance?.timesSchoolOpened != null) state.schoolOpened = row.attendance.timesSchoolOpened;
    state.present[row.student.id] = row.attendance?.timesPresent ?? null;
    state.remarks[row.student.id] = row.remark || "";
  });

  const dirty = { scores: new Set(), psychomotor: new Set(), attendanceStudents: new Set(), attendanceGlobal: false, remarks: new Set() };
  let saveTimer = null;

  contentEl.innerHTML = `
    ${pageHeaderHtml(view.spreadsheet.title, "#/teacher-dashboard")}

    <div class="sheet-header-card">
      <div class="school-name">${escapeHtml(schoolInfo.schoolName)}</div>
      <div class="school-address">${escapeHtml(schoolInfo.address)}</div>
      <div class="meta-row">
        <span>${escapeHtml(view.spreadsheet.sessionName)}</span>
        <span>${escapeHtml(view.spreadsheet.className)}</span>
        <span>${escapeHtml(view.spreadsheet.termName)}</span>
      </div>
    </div>

    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:4px;">
      <span class="save-indicator saved" id="save-indicator">${locked ? "Locked — read only" : "Saved"}</span>
      ${!locked ? `<button class="btn btn-outline btn-sm" id="manual-save-btn">💾 Save Now</button>` : ""}
    </div>

    ${!locked ? `
      <div class="attendance-bar">
        <label>No. of Times School Opened:</label>
        <input type="number" min="0" id="school-opened-input" value="${state.schoolOpened ?? ""}" />
        <span style="font-size:11.5px; color:var(--gray-500);">Applies to every student below</span>
      </div>` : `
      <div class="attendance-bar"><label>No. of Times School Opened:</label><span>${state.schoolOpened ?? "-"}</span></div>`}

    <div class="btn-row" style="margin-bottom:10px;">
      <button class="btn btn-outline btn-sm" id="print-btn">🖨️ Print / PDF (Spreadsheet)</button>
      ${locked ? `<button class="btn btn-outline btn-sm" id="reportcards-btn">📄 Generate Report Cards</button>` : ""}
      ${locked ? `<button class="btn btn-outline btn-sm" id="batch-reportcards-btn">📚 Download All (One PDF)</button>` : ""}
    </div>
    ${locked ? `<div id="report-card-links" style="margin-bottom:10px;"></div>` : ""}

    <div class="sheet-scroll-wrap">
      <button class="scroll-arrow left" id="scroll-left" aria-label="Scroll table left">‹</button>
      <div class="sheet-scroll" id="sheet-scroll">
        <table class="sheet-table" id="sheet-table"></table>
      </div>
      <button class="scroll-arrow right" id="scroll-right" aria-label="Scroll table right">›</button>
    </div>

    <button class="lock-btn ${locked ? "locked" : "unlocked"}" id="lock-toggle-btn">${locked ? "🔓 Unlock for Editing" : "🔒 Lock Spreadsheet"}</button>
  `;

  bindNav(contentEl);

  document.getElementById("scroll-left").addEventListener("click", () => document.getElementById("sheet-scroll").scrollBy({ left: -260, behavior: "smooth" }));
  document.getElementById("scroll-right").addEventListener("click", () => document.getElementById("sheet-scroll").scrollBy({ left: 260, behavior: "smooth" }));

  function scheduleAutosave() {
    const indicator = document.getElementById("save-indicator");
    indicator.className = "save-indicator saving";
    indicator.textContent = "Saving…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushAutosave, 3000);
  }

  async function flushAutosave() {
    const indicator = document.getElementById("save-indicator");
    const payload = { scores: [], psychomotor: [], remarks: [] };

    dirty.scores.forEach((key) => {
      const [studentId, subjectId] = key.split(":");
      const s = state.scores[key] || {};
      payload.scores.push({ studentId, subjectId, testScore: s.testScore ?? null, examScore: s.examScore ?? null });
    });
    dirty.psychomotor.forEach((key) => {
      const [studentId, trait] = key.split(":");
      payload.psychomotor.push({ studentId, trait, rating: state.psychomotor[key] });
    });
    dirty.remarks.forEach((studentId) => payload.remarks.push({ studentId, remark: state.remarks[studentId] || "" }));
    if (dirty.attendanceGlobal || dirty.attendanceStudents.size) {
      payload.attendance = {
        timesSchoolOpened: state.schoolOpened,
        perStudent: Array.from(dirty.attendanceStudents).map((studentId) => ({ studentId, timesPresent: state.present[studentId] })),
      };
    }

    if (!payload.scores.length && !payload.psychomotor.length && !payload.remarks.length && !payload.attendance) {
      indicator.className = "save-indicator saved";
      indicator.textContent = "Saved";
      return;
    }

    try {
      await api(`/teacher/spreadsheet-versions/${versionId}/autosave`, { method: "PATCH", body: payload });
      dirty.scores.clear(); dirty.psychomotor.clear(); dirty.attendanceStudents.clear(); dirty.attendanceGlobal = false; dirty.remarks.clear();
      indicator.className = "save-indicator saved";
      indicator.textContent = `Saved at ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    } catch (err) {
      indicator.className = "save-indicator error";
      indicator.textContent = `Error: ${err.message}`;
    }
  }

  function recomputeRow(studentId) {
    const totals = view.subjects.map((subj) => (state.scores[`${studentId}:${subj.id}`]?.totalScore) || 0);
    return computeOverallClient(totals, view.subjects.length);
  }

  function renderTable() {
    const table = document.getElementById("sheet-table");
    const subjectHeaderCells = view.subjects.map((s) => `<th colspan="4">${escapeHtml(s.name)}</th>`).join("");
    const subjectSubHeaderCells = view.subjects.map(() => `<th>Test</th><th>Exam</th><th>Total</th><th>Grade</th>`).join("");
    const psyHeaderCells = PSYCHOMOTOR_TRAITS.map((t) => `<th>${escapeHtml(t)}</th>`).join("");

    table.innerHTML = `
      <thead>
        <tr>
          <th rowspan="2">S/N</th><th class="name-cell" rowspan="2">Names</th>
          ${subjectHeaderCells}
          <th rowspan="2">Max Score</th><th rowspan="2">Total Score</th><th rowspan="2">Percentage</th><th rowspan="2">Final Grade</th><th rowspan="2">Remarks</th>
          ${psyHeaderCells}
          <th rowspan="2">Times School<br/>Opened</th><th rowspan="2">Times<br/>Present</th><th rowspan="2">Teacher Remarks</th>
        </tr>
        <tr>${subjectSubHeaderCells}</tr>
      </thead>
      <tbody>
        ${view.rows.map((row, idx) => {
          const overall = recomputeRow(row.student.id);
          const sn = idx + 1;
          const subjectCells = view.subjects.map((subj) => {
            const key = `${row.student.id}:${subj.id}`;
            const s = state.scores[key] || {};
            return `
              <td><input type="number" min="0" max="40" class="score-input" data-kind="test" data-student="${row.student.id}" data-subject="${subj.id}" value="${s.testScore ?? ""}" ${locked ? "disabled" : ""} /></td>
              <td><input type="number" min="0" max="60" class="score-input" data-kind="exam" data-student="${row.student.id}" data-subject="${subj.id}" value="${s.examScore ?? ""}" ${locked ? "disabled" : ""} /></td>
              <td class="cell-total" data-total-for="${key}">${s.totalScore ?? "-"}</td>
              <td class="cell-grade" data-grade-for="${key}">${s.grade ?? "-"}</td>
            `;
          }).join("");
          const psyCells = PSYCHOMOTOR_TRAITS.map((trait) => {
            const key = `${row.student.id}:${trait}`;
            const current = state.psychomotor[key];
            return `<td><div class="psy-ticks" data-psy-group="${key}">
              ${[1,2,3,4,5].map((n) => `<button type="button" class="psy-tick ${current === n ? "selected" : ""}" data-student="${row.student.id}" data-trait="${trait}" data-value="${n}" ${locked ? "disabled" : ""}>${n}</button>`).join("")}
            </div></td>`;
          }).join("");
          const present = state.present[row.student.id];
          return `
            <tr>
              <td>${sn}</td>
              <td class="name-cell">${escapeHtml(row.student.firstName)} ${escapeHtml(row.student.lastName)}</td>
              ${subjectCells}
              <td class="cell-max" data-max-for="${row.student.id}">${overall.maxScore}</td>
              <td class="cell-totalscore" data-totalscore-for="${row.student.id}">${overall.totalScore}</td>
              <td class="cell-pct" data-pct-for="${row.student.id}">${overall.percentage}%</td>
              <td class="cell-finalgrade" data-finalgrade-for="${row.student.id}">${overall.finalGrade}</td>
              <td class="cell-remarklabel" data-remarklabel-for="${row.student.id}">${overall.gradeLabel}</td>
              ${psyCells}
              <td>${state.schoolOpened ?? "-"}</td>
              <td><input type="number" min="0" class="score-input present-input" data-student="${row.student.id}" value="${present ?? ""}" ${locked || state.schoolOpened == null ? "disabled" : ""} placeholder="${state.schoolOpened == null ? "Set opened" : ""}" /></td>
              <td class="remark-cell">
                <textarea class="remark-textarea" data-student="${row.student.id}" ${locked ? "disabled" : ""}>${escapeHtml(state.remarks[row.student.id] || "")}</textarea>
                ${!locked ? `<button type="button" class="ai-assist-btn" data-ai-for="${row.student.id}">✨ AI-Assist</button>` : ""}
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    `;

    if (!locked) bindEditorEvents();
  }

  function bindEditorEvents() {
    contentEl.querySelectorAll(".score-input[data-kind]").forEach((input) => {
      input.addEventListener("input", () => {
        const studentId = input.dataset.student, subjectId = input.dataset.subject, kind = input.dataset.kind;
        const max = kind === "test" ? 40 : 60;
        let val = input.value === "" ? null : Number(input.value);
        if (val !== null && (val < 0 || val > max || Number.isNaN(val))) {
          input.classList.add("invalid");
          setTimeout(() => { input.value = ""; input.classList.remove("invalid"); applyScore(studentId, subjectId, kind, null); }, 500);
          return;
        }
        input.classList.remove("invalid");
        applyScore(studentId, subjectId, kind, val);
      });
    });

    function applyScore(studentId, subjectId, kind, val) {
      const key = `${studentId}:${subjectId}`;
      state.scores[key] = state.scores[key] || {};
      state.scores[key][kind === "test" ? "testScore" : "examScore"] = val;
      const result = computeSubjectResultClient(state.scores[key].testScore, state.scores[key].examScore);
      state.scores[key].totalScore = result.totalScore;
      state.scores[key].grade = result.grade;
      contentEl.querySelector(`[data-total-for="${key}"]`).textContent = result.totalScore ?? "-";
      contentEl.querySelector(`[data-grade-for="${key}"]`).textContent = result.grade ?? "-";

      const overall = recomputeRow(studentId);
      contentEl.querySelector(`[data-totalscore-for="${studentId}"]`).textContent = overall.totalScore;
      contentEl.querySelector(`[data-pct-for="${studentId}"]`).textContent = `${overall.percentage}%`;
      contentEl.querySelector(`[data-finalgrade-for="${studentId}"]`).textContent = overall.finalGrade;
      contentEl.querySelector(`[data-remarklabel-for="${studentId}"]`).textContent = overall.gradeLabel;

      dirty.scores.add(key);
      scheduleAutosave();
    }

    contentEl.querySelectorAll(".psy-tick").forEach((btn) => {
      btn.addEventListener("click", () => {
        const { student, trait, value } = btn.dataset;
        const key = `${student}:${trait}`;
        const newVal = state.psychomotor[key] === Number(value) ? null : Number(value);
        state.psychomotor[key] = newVal;
        contentEl.querySelectorAll(`[data-psy-group="${key}"] .psy-tick`).forEach((b) => b.classList.toggle("selected", Number(b.dataset.value) === newVal));
        dirty.psychomotor.add(key);
        scheduleAutosave();
      });
    });

    const openedInput = document.getElementById("school-opened-input");
    if (openedInput) {
      openedInput.addEventListener("input", () => {
        const val = openedInput.value === "" ? null : Number(openedInput.value);
        if (val !== null && val < 0) { openedInput.value = ""; return; }
        state.schoolOpened = val;
        dirty.attendanceGlobal = true;

        // "School Opened" applies to every student at once — if lowering
        // it now puts an already-entered "Present" value out of range,
        // clear that value here too (same auto-clear-invalid pattern as
        // the score inputs) instead of silently sending a stale number
        // to the server, where it would previously get quietly skipped
        // while everyone else's row still saved.
        if (val !== null) {
          for (const studentId of Object.keys(state.present)) {
            if (state.present[studentId] != null && state.present[studentId] > val) {
              state.present[studentId] = null;
              dirty.attendanceStudents.add(studentId);
            }
          }
        }

        renderTable(); // school-opened changes every row's "Times Present" enabled-state and displayed value
        scheduleAutosave();
      });
    }

    contentEl.querySelectorAll(".present-input").forEach((input) => {
      input.addEventListener("input", () => {
        const studentId = input.dataset.student;
        let val = input.value === "" ? null : Number(input.value);
        if (val !== null && (val < 0 || (state.schoolOpened != null && val > state.schoolOpened))) {
          input.classList.add("invalid");
          setTimeout(() => { input.value = ""; input.classList.remove("invalid"); state.present[studentId] = null; dirty.attendanceStudents.add(studentId); scheduleAutosave(); }, 500);
          return;
        }
        input.classList.remove("invalid");
        state.present[studentId] = val;
        dirty.attendanceStudents.add(studentId);
        scheduleAutosave();
      });
    });

    contentEl.querySelectorAll(".remark-textarea").forEach((ta) => {
      ta.addEventListener("input", () => {
        state.remarks[ta.dataset.student] = ta.value;
        dirty.remarks.add(ta.dataset.student);
        scheduleAutosave();
      });
    });

    contentEl.querySelectorAll("[data-ai-for]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const studentId = btn.dataset.aiFor;
        const textarea = contentEl.querySelector(`.remark-textarea[data-student="${studentId}"]`);
        // Never overwrite an existing manual comment automatically — only fill when empty, otherwise ask first.
        if (textarea.value.trim()) {
          showConfirmModal({
            title: "Replace existing remark?",
            message: "There's already a comment here. Generate a new AI suggestion and replace it?",
            confirmLabel: "Replace",
            onConfirm: () => applyAiSuggestion(studentId, textarea),
          });
        } else {
          await applyAiSuggestion(studentId, textarea);
        }
      });
    });

    async function applyAiSuggestion(studentId, textarea) {
      try {
        const data = await api(`/teacher/spreadsheet-versions/${versionId}/students/${studentId}/ai-remark`);
        textarea.value = data.suggestion;
        state.remarks[studentId] = data.suggestion;
        dirty.remarks.add(studentId);
        scheduleAutosave();
      } catch (err) {
        alert(err.message);
      }
    }
  }

  renderTable();

  const manualSaveBtn = document.getElementById("manual-save-btn");
  if (manualSaveBtn) {
    manualSaveBtn.addEventListener("click", async () => {
      clearTimeout(saveTimer);
      manualSaveBtn.disabled = true;
      await flushAutosave();
      manualSaveBtn.disabled = false;
    });
  }

  document.getElementById("print-btn").addEventListener("click", async () => {
    try { await downloadAuthenticatedFile(`/teacher/spreadsheet-versions/${versionId}/print`, `${view.spreadsheet.title}.pdf`); }
    catch (err) { alert(err.message); }
  });

  const reportBtn = document.getElementById("reportcards-btn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async () => {
      reportBtn.disabled = true;
      reportBtn.textContent = "Generating…";
      try {
        const data = await api(`/teacher/spreadsheet-versions/${versionId}/generate-report-cards`, { method: "POST" });
        const linksEl = document.getElementById("report-card-links");
        linksEl.innerHTML = `<div class="alert alert-success" style="margin-bottom:8px;">Report cards ready — tap a student to view, print, or download individually:</div>` +
          data.results.map((r) => {
            const row = view.rows.find((row) => row.student.id === r.studentId);
            const name = row ? `${row.student.firstName} ${row.student.lastName}` : r.studentId;
            return `<button class="btn btn-outline btn-sm" style="margin:0 6px 6px 0;" data-view-rc="${r.reportCardId}">${escapeHtml(name)}</button>`;
          }).join("");
        linksEl.querySelectorAll("[data-view-rc]").forEach((btn) => btn.addEventListener("click", () => go(`#/teacher-report-card/${btn.dataset.viewRc}`)));
        reportBtn.textContent = "✓ Report Cards Generated";
      } catch (err) {
        alert(err.message);
        reportBtn.disabled = false;
        reportBtn.textContent = "📄 Generate Report Cards";
      }
    });
  }

  const batchBtn = document.getElementById("batch-reportcards-btn");
  if (batchBtn) {
    batchBtn.addEventListener("click", async () => {
      batchBtn.disabled = true;
      batchBtn.textContent = "Preparing…";
      try {
        await downloadAuthenticatedFile(`/teacher/spreadsheet-versions/${versionId}/report-cards/pdf`, `${view.spreadsheet.title}-report-cards.pdf`);
      } catch (err) {
        alert(err.message);
      } finally {
        batchBtn.disabled = false;
        batchBtn.textContent = "📚 Download All (One PDF)";
      }
    });
  }

  document.getElementById("lock-toggle-btn").addEventListener("click", () => {
    if (locked) {
      showConfirmModal({
        title: "Unlock this spreadsheet?",
        message: "This creates a new revision for editing. The current locked version is permanently preserved and remains visible to Admin.",
        confirmLabel: "Unlock",
        onConfirm: async () => {
          try {
            const data = await api(`/teacher/spreadsheet-versions/${versionId}/unlock`, { method: "POST" });
            go(`#/teacher-spreadsheet/${data.newVersionId}`);
          } catch (err) { alert(err.message); }
        },
      });
    } else {
      clearTimeout(saveTimer);
      flushAutosave().then(() => {
        showConfirmModal({
          title: "Lock this spreadsheet?",
          message: "Locking freezes this version as official and makes it visible to Admin. You can still unlock it later to make further edits, which will create a new version.",
          confirmLabel: "Lock",
          onConfirm: async () => {
            try {
              await api(`/teacher/spreadsheet-versions/${versionId}/lock`, { method: "POST" });
              renderSpreadsheetEditor(versionId);
            } catch (err) { alert(err.message); }
          },
        });
      });
    }
  });
}

// ============================================================================
// STUDENT EXPERIENCE
// ============================================================================

/**
 * Floating 3-page setup wizard shown right after a student's first
 * successful login (renderLogin routes here when needsProfileSetup is
 * true). Each page validates its own required fields before advancing —
 * that's what prevents "accidentally skipping" required profile info —
 * and there is no skip/close control anywhere on the card.
 */
function renderStudentSetupWizard() {
  const draft = { firstName: "", middleName: "", lastName: "", dateOfBirth: "", stateOfOrigin: "", sex: "", religion: "" };
  let page = 1;
  let photoFile = null;

  function render() {
    const dots = [1, 2, 3].map((n) => `<div class="dot ${n < page ? "done" : n === page ? "active" : ""}"></div>`).join("");

    let body = "";
    if (page === 1) {
      body = `
        <h3>Let's set up your profile</h3>
        <p class="wizard-sub">Step 1 of 3 — Your name</p>
        <div class="form-group"><label>First Name</label><input type="text" id="w-first" value="${escapeHtml(draft.firstName)}" /></div>
        <div class="form-group"><label>Middle Name (optional)</label><input type="text" id="w-middle" value="${escapeHtml(draft.middleName)}" /></div>
        <div class="form-group"><label>Last Name</label><input type="text" id="w-last" value="${escapeHtml(draft.lastName)}" /></div>
        <div id="w-alert"></div>
        <div class="wizard-nav-row"><button class="btn btn-primary" id="w-next">Next</button></div>
      `;
    } else if (page === 2) {
      body = `
        <h3>A little more about you</h3>
        <p class="wizard-sub">Step 2 of 3</p>
        <div class="form-group"><label>Date of Birth</label><input type="date" id="w-dob" value="${draft.dateOfBirth}" /></div>
        <div class="form-group"><label>State of Origin</label><input type="text" id="w-state" value="${escapeHtml(draft.stateOfOrigin)}" /></div>
        <div class="form-group"><label>Sex</label>
          <select id="w-sex">
            <option value="">Select…</option>
            <option value="MALE" ${draft.sex === "MALE" ? "selected" : ""}>Male</option>
            <option value="FEMALE" ${draft.sex === "FEMALE" ? "selected" : ""}>Female</option>
          </select>
        </div>
        <div class="form-group"><label>Religion (optional)</label><input type="text" id="w-religion" value="${escapeHtml(draft.religion)}" /></div>
        <div id="w-alert"></div>
        <div class="wizard-nav-row"><button class="btn btn-outline" id="w-back">Back</button><button class="btn btn-primary" id="w-next">Next</button></div>
      `;
    } else {
      body = `
        <h3>Add a profile picture</h3>
        <p class="wizard-sub">Step 3 of 3 — Almost done!</p>
        <div class="wizard-photo-preview" id="w-photo-preview">Tap below<br/>to choose a photo</div>
        <div class="form-group"><input type="file" id="w-photo-input" accept="image/*" /></div>
        <div id="w-alert"></div>
        <div class="wizard-nav-row"><button class="btn btn-outline" id="w-back">Back</button><button class="btn btn-primary" id="w-complete">Complete</button></div>
      `;
    }

    appEl.innerHTML = `
      <div class="wizard-overlay">
        <div class="wizard-card">
          <div class="wizard-progress">${dots}</div>
          ${body}
        </div>
      </div>
    `;

    if (page === 1) {
      document.getElementById("w-next").addEventListener("click", async () => {
        const firstName = document.getElementById("w-first").value.trim();
        const lastName = document.getElementById("w-last").value.trim();
        const alertEl = document.getElementById("w-alert");
        if (!firstName || !lastName) { alertEl.innerHTML = `<div class="alert alert-error">First and last name are required.</div>`; return; }
        draft.firstName = firstName;
        draft.middleName = document.getElementById("w-middle").value.trim();
        draft.lastName = lastName;
        try {
          await api("/student/profile", { method: "PATCH", body: { firstName: draft.firstName, middleName: draft.middleName || undefined, lastName: draft.lastName } });
          page = 2; render();
        } catch (err) { alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
      });
    } else if (page === 2) {
      document.getElementById("w-back").addEventListener("click", () => { page = 1; render(); });
      document.getElementById("w-next").addEventListener("click", async () => {
        const dob = document.getElementById("w-dob").value;
        const state = document.getElementById("w-state").value.trim();
        const sex = document.getElementById("w-sex").value;
        const alertEl = document.getElementById("w-alert");
        if (!dob || !state || !sex) { alertEl.innerHTML = `<div class="alert alert-error">Date of birth, state of origin, and sex are required.</div>`; return; }
        draft.dateOfBirth = dob; draft.stateOfOrigin = state; draft.sex = sex;
        draft.religion = document.getElementById("w-religion").value.trim();
        try {
          await api("/student/profile", { method: "PATCH", body: { dateOfBirth: draft.dateOfBirth, stateOfOrigin: draft.stateOfOrigin, sex: draft.sex, religion: draft.religion || undefined } });
          page = 3; render();
        } catch (err) { alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
      });
    } else {
      document.getElementById("w-back").addEventListener("click", () => { page = 2; render(); });
      document.getElementById("w-photo-input").addEventListener("change", (e) => {
        photoFile = e.target.files[0];
        if (photoFile) {
          const reader = new FileReader();
          reader.onload = () => { document.getElementById("w-photo-preview").innerHTML = `<img src="${reader.result}" />`; };
          reader.readAsDataURL(photoFile);
        }
      });
      document.getElementById("w-complete").addEventListener("click", async () => {
        const alertEl = document.getElementById("w-alert");
        if (!photoFile) { alertEl.innerHTML = `<div class="alert alert-error">Please choose a profile picture.</div>`; return; }
        const form = new FormData();
        form.append("photo", photoFile);
        try {
          await api("/student/profile/photo", { method: "POST", body: form, isForm: true });
          go("#/student-dashboard");
        } catch (err) { alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`; }
      });
    }
  }

  render();
}

// ----------------------------------------------------------------------------
// Student shell + floating help button
// ----------------------------------------------------------------------------

async function renderStudentShell(contentRenderer) {
  const activePath = (window.location.hash.split("?")[0]).slice(2).split("/")[0];

  appEl.innerHTML = `
    <div class="topbar">
      <div class="topbar-row">
        <div class="topbar-school">ZICHRI SCHOOL</div>
        <div class="topbar-icons"><button class="avatar" id="student-avatar" aria-label="Your profile and settings">?</button></div>
      </div>
    </div>
    <div class="content" id="content"><div class="spinner"></div></div>
    <button class="help-fab" id="help-fab" title="Need help?" aria-label="Get help — send a message to the school office">❓</button>
    <div class="bottom-nav">
      <button class="nav-item ${activePath === "student-dashboard" ? "active" : ""}" data-go="#/student-dashboard"><span class="nav-icon">🏠</span>Home</button>
      <button class="nav-item ${activePath === "student-settings" ? "active" : ""}" data-go="#/student-settings"><span class="nav-icon">⚙️</span>Settings</button>
    </div>
  `;
  appEl.querySelectorAll("[data-go]").forEach((btn) => btn.addEventListener("click", () => go(btn.dataset.go)));
  document.getElementById("student-avatar").addEventListener("click", () => go("#/student-settings"));
  document.getElementById("help-fab").addEventListener("click", openHelpModal);

  api("/student/me").then((me) => {
    document.getElementById("student-avatar").innerHTML = me.student.profileImageId
      ? `<img src="/files/profile_images/${me.student.profileImageId}" />`
      : initials(`${me.student.firstName || ""} ${me.student.lastName || ""}`.trim() || me.student.username);
  }).catch(() => {});

  const contentEl = document.getElementById("content");
  try {
    await contentRenderer(contentEl);
  } catch (err) {
    contentEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
  }
}

function openHelpModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
    <div class="modal-sheet">
      <h3>Need help?</h3>
      <p style="color:var(--gray-500); font-size:13px; margin-top:-4px;">Your message goes straight to the school office.</p>
      <div class="form-group"><textarea id="help-message" rows="4" placeholder="Type your message…"></textarea></div>
      <div id="help-alert"></div>
      <div class="btn-row">
        <button class="btn btn-outline" id="help-cancel">Cancel</button>
        <button class="btn btn-primary" id="help-send">Send</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  wrap.querySelector("#help-cancel").addEventListener("click", () => wrap.remove());
  wrap.querySelector("#help-send").addEventListener("click", async () => {
    const alertEl = wrap.querySelector("#help-alert");
    const message = wrap.querySelector("#help-message").value.trim();
    if (!message) { alertEl.innerHTML = `<div class="alert alert-error">Please write a message first.</div>`; return; }
    try {
      const data = await api("/student/help", { method: "POST", body: { message } });
      wrap.querySelector(".modal-sheet").innerHTML = `<h3>Sent!</h3><div class="alert alert-success">${data.message}</div><button class="btn btn-primary" id="help-close">Close</button>`;
      wrap.querySelector("#help-close").addEventListener("click", () => wrap.remove());
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });
}

// ----------------------------------------------------------------------------
// Dashboard
// ----------------------------------------------------------------------------

async function renderStudentDashboard(contentEl) {
  const [me, schoolInfo, reportCards] = await Promise.all([
    api("/student/me"),
    fetch("/api/public/school-info").then((r) => r.json()).catch(() => ({ schoolName: "ZICHRI SCHOOL", address: "" })),
    api("/student/report-cards"),
  ]);
  const s = me.student;

  contentEl.innerHTML = `
    <div class="sheet-header-card">
      <div class="school-name">${escapeHtml(schoolInfo.schoolName)}</div>
      <div class="school-address">${escapeHtml(schoolInfo.address)}</div>
    </div>

    <div class="card" style="text-align:center;">
      <div class="avatar-lg" style="width:76px; height:76px; font-size:24px; margin:0 auto 10px;">${s.profileImageId ? `<img src="/files/profile_images/${s.profileImageId}" />` : initials(`${s.firstName || ""} ${s.lastName || ""}`.trim() || s.username)}</div>
      <div style="font-weight:800; font-size:17px;">${escapeHtml(`${s.firstName || ""} ${s.lastName || ""}`.trim() || s.username)}</div>
      <div style="color:var(--gray-500); font-size:12.5px; margin-top:2px;">${escapeHtml(s.className || "No class assigned yet")} · ${escapeHtml(s.email)}</div>
    </div>

    <div class="section-title">Your Report Cards</div>
    ${reportCards.reportCards.length ? reportCards.reportCards.map((rc) => `
      <div class="report-card-tile" data-open="${rc.id}">
        <div class="rc-top">
          <div>
            <div class="rc-term">${escapeHtml(rc.sessionName)} — ${escapeHtml(rc.termName)}</div>
            <div class="rc-meta">${escapeHtml(rc.className)} · Issued ${fmtDateTime(rc.issuedAt)}</div>
          </div>
          <div>
            <div class="rc-pct">${rc.percentage != null ? rc.percentage + "%" : "-"}</div>
            <div class="rc-grade">${rc.finalGrade || "-"}</div>
          </div>
        </div>
      </div>`).join("") : `<div class="empty-state">No report cards have been issued to you yet.</div>`}
  `;

  contentEl.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => go(`#/student-report-card/${el.dataset.open}`)));
}

// ----------------------------------------------------------------------------
// Full report card
// ----------------------------------------------------------------------------

async function renderStudentReportCardDetail(reportCardId) {
  const contentEl = document.getElementById("content");
  const [detail, schoolInfo] = await Promise.all([
    api(`/student/report-cards/${reportCardId}`),
    fetch("/api/public/school-info").then((r) => r.json()).catch(() => ({ schoolName: "ZICHRI SCHOOL", address: "" })),
  ]);
  renderReportCardViewer(contentEl, detail, schoolInfo, `/student/report-cards/${reportCardId}/pdf`, "#/student-dashboard");
}

// ----------------------------------------------------------------------------
// Settings
// ----------------------------------------------------------------------------

async function renderStudentSettings(contentEl) {
  const me = await api("/student/me");
  contentEl.innerHTML = `
    ${pageHeaderHtml("Settings", "#/student-dashboard")}
    <div class="card">
      <div style="font-size:13px; color:var(--gray-700); margin-bottom:10px;">Logged in as <b>${escapeHtml(me.student.username)}</b> (${escapeHtml(me.student.email)})</div>
      <div class="form-group"><label>Update profile picture</label><input type="file" id="pic-input" accept="image/*" /></div>
      <button class="btn btn-outline" id="pic-save-btn">Update Photo</button>
      <div id="pic-alert" style="margin-top:10px;"></div>
    </div>
    <div class="card">
      <button class="btn btn-outline" id="change-pw-btn">Change Password</button>
      <div id="pw-alert" style="margin-top:10px;"></div>
    </div>
    <button class="btn btn-danger" id="logout-btn">Log Out</button>
  `;
  bindNav(contentEl);

  document.getElementById("pic-save-btn").addEventListener("click", async () => {
    const alertEl = document.getElementById("pic-alert");
    const file = document.getElementById("pic-input").files[0];
    if (!file) return;
    const form = new FormData();
    form.append("photo", file);
    try {
      await api("/student/profile/photo", { method: "POST", body: form, isForm: true });
      alertEl.innerHTML = `<div class="alert alert-success">Photo updated.</div>`;
    } catch (err) {
      alertEl.innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  });

  document.getElementById("change-pw-btn").addEventListener("click", () => {
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.innerHTML = `
      <div class="modal-sheet">
        <h3>Change Password</h3>
        <div class="form-group"><label>Current password</label><input type="password" id="cp-current" /></div>
        <div class="form-group"><label>New password</label><input type="password" id="cp-new" minlength="8" /></div>
        <div id="cp-alert"></div>
        <div class="btn-row"><button class="btn btn-outline" id="cp-cancel">Cancel</button><button class="btn btn-primary" id="cp-submit">Update</button></div>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector("#cp-cancel").addEventListener("click", () => wrap.remove());
    wrap.querySelector("#cp-submit").addEventListener("click", async () => {
      try {
        await api("/auth/change-password", { method: "POST", body: { currentPassword: document.getElementById("cp-current").value, newPassword: document.getElementById("cp-new").value } });
        wrap.remove();
        document.getElementById("pw-alert").innerHTML = `<div class="alert alert-success">Password updated.</div>`;
      } catch (err) {
        wrap.querySelector("#cp-alert").innerHTML = `<div class="alert alert-error">${err.message}</div>`;
      }
    });
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    showConfirmModal({ title: "Log out?", message: "You'll need to log in again.", confirmLabel: "Log Out", danger: true, onConfirm: async () => logout() });
  });
}

// ============================================================================
// SHARED REPORT CARD PRINT RENDERER
//
// One HTML block, used by the student's own view, the teacher's
// print-preview, and the admin's print-preview. The .print-only elements
// (Head of School's comment, signature, date, school resumes) are
// invisible on screen and revealed only by the @media print rules in
// styles.css — that CSS switch IS the "online vs print" split, not two
// separate templates that could drift apart.
// ============================================================================

function renderPrintableReportCardHtml(detail, schoolInfo) {
  const gradingKey = "90-100=A+ Outstanding | 80-89=A Excellent | 70-79=B+ Very Good | 60-69=B Good | 50-59=C Average | 40-49=D Fair | 0-39=F Fail";
  return `
    <div class="rc-print-header">
      <div class="school-name">${escapeHtml(schoolInfo.schoolName)}</div>
      <div class="school-address">${escapeHtml(schoolInfo.address)}</div>
      <div class="doc-title">Terminal Report Card</div>
    </div>

    <div class="rc-print-identity">
      <div class="rc-print-photo">${detail.student.profileImageId ? `<img src="/files/profile_images/${detail.student.profileImageId}" />` : initials(`${detail.student.firstName} ${detail.student.lastName}`)}</div>
      <div class="rc-print-fields">
        <div class="rc-print-name">${escapeHtml(detail.student.firstName)} ${escapeHtml(detail.student.lastName)}</div>
        <div><b>Class:</b> ${escapeHtml(detail.student.className)}</div>
        <div><b>Gender:</b> ${detail.student.sex === "MALE" ? "Male" : detail.student.sex === "FEMALE" ? "Female" : "-"}</div>
        <div><b>Age:</b> ${detail.student.age != null ? detail.student.age + " yrs" : "-"}</div>
        <div><b>Academic Year:</b> ${escapeHtml(detail.academic.sessionName)}</div>
        <div><b>Term:</b> ${escapeHtml(detail.academic.termName)}</div>
        <div><b>Times School Opened:</b> ${detail.attendance?.timesSchoolOpened ?? "-"}</div>
        <div><b>Times Present:</b> ${detail.attendance?.timesPresent ?? "-"}</div>
      </div>
    </div>

    <div class="rc-print-section-label">Academic Performance</div>
    <table class="rc-print-table">
      <thead><tr><th>Subject</th><th>Test /40</th><th>Exam /60</th><th>Total /100</th><th>Grade</th><th>Remarks</th></tr></thead>
      <tbody>
        ${detail.subjects.map((s) => `<tr><td>${escapeHtml(s.name)}</td><td>${s.testScore ?? "-"}</td><td>${s.examScore ?? "-"}</td><td>${s.totalScore ?? "-"}</td><td>${s.grade ?? "-"}</td><td>${s.totalScore != null ? gradeLabelFor(s.totalScore) : "-"}</td></tr>`).join("")}
      </tbody>
    </table>
    <div class="rc-print-key">${gradingKey}</div>

    <div class="rc-print-section-label">Overall Result</div>
    <div class="rc-print-stats">
      <div class="rc-print-stat"><div class="l">Max Score</div><div class="v">${detail.overall.maxScore}</div></div>
      <div class="rc-print-stat"><div class="l">Total Score</div><div class="v">${detail.overall.totalScore}</div></div>
      <div class="rc-print-stat"><div class="l">Percentage</div><div class="v">${detail.overall.percentage}%</div></div>
      <div class="rc-print-stat"><div class="l">Final Grade</div><div class="v">${detail.overall.finalGrade}</div></div>
      <div class="rc-print-stat"><div class="l">Remark</div><div class="v" style="font-size:10px;">${escapeHtml(detail.overall.gradeLabel)}</div></div>
    </div>

    <div class="rc-print-section-label">Psychomotor Ratings</div>
    <table class="rc-print-psy-table">
      <thead><tr><th>Trait</th><th>5</th><th>4</th><th>3</th><th>2</th><th>1</th></tr></thead>
      <tbody>
        ${PSYCHOMOTOR_TRAITS.map((trait) => {
          const rating = detail.psychomotor.find((p) => p.trait === trait)?.rating;
          return `<tr><td>${escapeHtml(trait)}</td>${[5,4,3,2,1].map((n) => `<td>${rating === n ? '<div class="rc-print-psy-dot"></div>' : ""}</td>`).join("")}</tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="rc-print-key">5-Excellent &nbsp; 4-Very Good &nbsp; 3-Good &nbsp; 2-Fair &nbsp; 1-Poor</div>

    <div class="rc-print-section-label">Teacher's Comment</div>
    <div class="rc-print-comment-box">${escapeHtml(detail.teacherComment) || "-"}</div>

    <div class="print-only">
      <div class="rc-print-section-label">Head of School's Comments</div>
      <div class="rc-print-blank-box"></div>

      <div class="rc-print-line-field"><span class="fl">SIGNATURE:</span></div>
      <div class="rc-print-line-field"><span class="fl">DATE:</span></div>
      <div class="rc-print-line-field"><span class="fl">SCHOOL RESUMES:</span></div>
    </div>
  `;
}

function gradeLabelFor(pct) {
  if (pct >= 90) return "Outstanding";
  if (pct >= 80) return "Excellent";
  if (pct >= 70) return "Very Good";
  if (pct >= 60) return "Good";
  if (pct >= 50) return "Average";
  if (pct >= 40) return "Fair";
  return "Fail";
}

/** Wraps the printable block with on-screen action buttons (hidden via .no-print when actually printing) and wires up Print/Download. */
function renderReportCardViewer(contentEl, detail, schoolInfo, pdfDownloadPath, backHash) {
  contentEl.innerHTML = `
    ${pageHeaderHtml("Report Card", backHash)}
    <div class="rc-print-actions no-print">
      <button class="btn btn-outline btn-sm" id="rc-print-btn">🖨️ Print</button>
      <button class="btn btn-outline btn-sm" id="rc-pdf-btn">⬇️ Download PDF</button>
    </div>
    <div class="rc-print-sheet card">
      ${renderPrintableReportCardHtml(detail, schoolInfo)}
    </div>
  `;
  bindNav(contentEl);
  document.getElementById("rc-print-btn").addEventListener("click", () => window.print());
  document.getElementById("rc-pdf-btn").addEventListener("click", async () => {
    try { await downloadAuthenticatedFile(pdfDownloadPath, `report-card-${detail.reportCardId}.pdf`); }
    catch (err) { alert(err.message); }
  });
}

/** Admin's read-only print-preview for any student's report card — reachable from a student's Report Card History. */
async function renderAdminReportCardView(reportCardId) {
  const contentEl = document.getElementById("content");
  const [detail, schoolInfo] = await Promise.all([
    api(`/admin/report-cards/${reportCardId}`),
    fetch("/api/public/school-info").then((r) => r.json()).catch(() => ({ schoolName: "ZICHRI SCHOOL", address: "" })),
  ]);
  renderReportCardViewer(contentEl, detail, schoolInfo, `/admin/report-cards/${reportCardId}/pdf`, "#/spreadsheets");
}

/** Teacher's read-only print-preview for a report card generated from their own spreadsheet. */
async function renderTeacherReportCardView(reportCardId) {
  const contentEl = document.getElementById("content");
  const [detail, schoolInfo] = await Promise.all([
    api(`/teacher/report-cards/${reportCardId}`),
    fetch("/api/public/school-info").then((r) => r.json()).catch(() => ({ schoolName: "ZICHRI SCHOOL", address: "" })),
  ]);
  renderReportCardViewer(contentEl, detail, schoolInfo, `/teacher/report-cards/${reportCardId}/pdf`, "#/teacher-dashboard");
}
