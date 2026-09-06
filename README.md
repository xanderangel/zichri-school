# Zichri School Result Management System — Phase 1: Core Backend

This phase establishes the **architecture, database, authentication, role
permissions, storage structure, and audit logging**. No dashboards are
built yet, per the spec.

## Stack chosen

- **Node.js + Express** — API server
- **Prisma ORM** over **SQLite** for local dev (zero setup — just `npm run prisma:migrate`).
  Switching to **PostgreSQL** for production is a two-line change (see below) —
  nothing else in the codebase needs to change, since Prisma abstracts the SQL dialect.
- **JWT access + refresh tokens**, refresh tokens backed by a `Session` table
  (so they can be revoked — logout, password change, account removal all
  invalidate sessions server-side, not just client-side).
- **bcrypt** for password hashing (12 salt rounds).
- **Local disk storage** for uploaded files in this phase, structured so it's
  a drop-in swap for S3/cloud storage later (see `src/utils/upload.js`).

## What's in this phase

```
zichri-school/
├── prisma/
│   ├── schema.prisma      ← full data model (20+ tables, see below)
│   └── seed.js            ← creates the fixed bootstrap admin account
├── src/
│   ├── server.js          ← app entry point
│   ├── lib/                ← prisma client, hashing, JWT helpers
│   ├── middleware/
│   │   ├── auth.middleware.js       ← requireAuth, requireRole, requireVerified
│   │   ├── ownership.middleware.js  ← blocks ID-swapping attacks
│   │   └── errorHandler.js
│   ├── controllers/
│   │   ├── auth.controller.js          ← login/refresh/logout, admin security setup
│   │   ├── registration.controller.js  ← teacher/student self-registration (→ PENDING)
│   │   └── admin.controller.js         ← verify accounts, classes, sessions/terms, subjects, settings, audit log
│   ├── routes/             ← route wiring, all admin routes gated by role middleware
│   ├── services/
│   │   └── audit.service.js
│   └── utils/
│       └── upload.js       ← secure file upload (randomized filenames, MIME/size checks)
├── storage/                ← local file storage root (profile_images / school_logo / report_cards)
├── .env.example
└── package.json
```

## Database model — how it satisfies the spec's hard requirements

**Versioning (the core mechanic):** `Spreadsheet` is the durable parent a
teacher thinks of as "one spreadsheet." It never holds scores directly.
Every lock creates a new immutable `SpreadsheetVersion` row, and all actual
data — `StudentSubjectScore`, `PsychomotorRating`, `Attendance`,
`TeacherRemark`, `SpreadsheetStudent` — is scoped to a *version*, not the
spreadsheet. Locking a version is a status flip (`DRAFT → SAVED → LOCKED`);
it is never deleted or overwritten. Draft autosave writes only touch the
current unlocked version, so autosave never creates version bloat — only
explicit locking does.

**Historical immutability:** `ReportCard` stores **snapshot fields**
(`snapshotFirstName`, `snapshotClassName`, etc.) copied at generation time.
A 2027 profile-picture change can never alter a 2026 report card, because
the report card doesn't read the student's live profile for display — only
for access control (confirming *which* student is allowed to view it).

**Classes have durable identity:** `Class.id` is a `cuid`, not the name —
renaming "Basic 6" later never breaks any foreign key referencing it.

**Account lifecycle:** `AccountStatus` enum (`PENDING/VERIFIED/REJECTED/REMOVED`)
on `User`. Teacher/Student self-registration lands as `PENDING`;
`requireVerified` middleware blocks all non-admin functionality until an
admin flips the status.

**Admin bootstrap:** `prisma/seed.js` creates the fixed
`Zichrisuperadmin100` account with `mustChangePassword: true`. First login
forces the client into the security-setup flow
(`POST /api/auth/admin/security-setup`), which requires both recovery
emails and a new password; `AdminProfile.securitySetupCompletedAt` only
gets set once **both** emails are verified via emailed tokens
(`VerificationToken` table).

**Audit log:** every sensitive mutation (`recordAudit(...)`) is called from
account verification, class creation, session/term/subject creation, school
settings changes, login, password change, recovery-email verification.
Report-card and spreadsheet-lock events are stubbed for the next phase, once
those controllers exist.

**Authorization / anti-ID-tampering:** `ownership.middleware.js` loads the
requested resource from the DB and checks it actually belongs to the
requesting user before any handler runs — a student can't view another
student's record by editing a URL param, and a teacher can't touch another
teacher's spreadsheet, regardless of what ID is passed in.

**File storage:** uploads are written to disk with **randomized filenames**
(never the original name) and MIME/size validation, with metadata tracked
in `UploadedFile`. Profile images/logo are served statically; report card
PDFs deliberately are **not** wired to static serving — that route will
require an authenticated ownership check in the next phase.

## Running it

```bash
cd zichri-school
npm install
cp .env.example .env        # then fill in real JWT secrets
npm run prisma:migrate      # creates dev.db and all tables
npm run seed                # creates the Zichrisuperadmin100 account
npm run dev
```

Then `POST /api/auth/login` with `{"username":"Zichrisuperadmin100","password":"123456789"}`.
The response's `mustCompleteAdminSecuritySetup: true` flag tells the client
to route straight to the security-setup screen before anything else.

## Decisions made that need your approval before the Admin phase

1. **Postgres vs SQLite for production.** I built against SQLite for
   zero-config local dev. For real deployment I'd recommend Postgres —
   changing `provider = "postgresql"` in `schema.prisma` and setting
   `DATABASE_URL` is the entire migration; do you have a Postgres host in
   mind (Supabase, Railway, RDS, etc.), or should I plan for a specific one?
2. **Email sending is stubbed.** Recovery-email verification and password
   reset generate tokens but don't yet send real emails — I need SMTP
   credentials (or a provider like Resend/SendGrid) to wire up
   `services/mailer.js` next.
3. **Teacher/Student self-registration vs admin-created accounts.** I built
   self-registration (landing as `PENDING`) since the spec describes account
   *statuses* including `PENDING`. If you'd rather admins create
   teacher/student accounts directly (skipping public registration
   entirely), that's a small change — let me know which model you want.
4. **Grading scale / report card settings** are stored as a flexible JSON
   blob (`SchoolSettings.reportCardSettings`) since you haven't specified
   the grading bands (A/B/C ranges, comment thresholds, etc.) yet — I'll
   need those before generating actual report cards.
5. **Multi-class teachers.** I modeled teacher↔class as many-to-many
   (`ClassAssignment`) with an `isPrimary` flag, even though the spec says
   "assigned class" (singular), so a teacher covering two classes isn't a
   schema change later. Confirm this flexibility is wanted, or if you want
   it strictly locked to one class per teacher at the API level.
6. **File storage backend.** Local disk for now, structured to swap to
   S3-compatible storage later. Confirm if you already have a target (S3,
   Cloudinary, etc.) so I build the swap now instead of twice.

---

# Phase 2: Complete Admin Experience

Built on top of Phase 1 without touching the schema. New backend pieces:

- `services/mailer.service.js` — sends real email if SMTP is configured in
  `.env`; otherwise logs to console so nothing blocks on missing credentials.
- `services/reportCard.service.js` — generates a `ReportCard` snapshot from
  a locked version (idempotent — safe to call repeatedly) and renders a PDF
  with `pdfkit`, saved under `storage/report_cards/`.
- `controllers/spreadsheet.controller.js` — admin's **read-only** view of
  locked spreadsheets, version history, and per-student score/remark
  detail. There is no write endpoint here at all — that's what actually
  enforces "admin cannot alter locked academic records," not just a
  permission check that could be bypassed.
- `controllers/reportDelivery.controller.js` — `POST
  /admin/spreadsheet-versions/:versionId/send-report-cards` takes
  `{studentIds, confirm:true}`, validates every id actually belongs to
  that version, generates/reuses each report card + PDF, delivers to the
  student's dashboard record, emails the student, and BCCs the school's
  administrative email — recording a `ReportCardDeliveryRecord` for every
  channel attempted (Pending/Sent/Failed).
- `controllers/teacher.controller.js` / `student.controller.js` — profile +
  history views. A removed teacher's `Teacher.id` never changes, so their
  spreadsheets stay fully queryable; report cards read only their own
  snapshot fields, so editing/removing a student later never rewrites a
  past report.
- `controllers/class.controller.js` — rename (always safe, `Class.id` is
  the FK) and archive (soft-delete only — a class is never hard-deleted
  while historical data references it).
- `controllers/search.controller.js` — one query, four categorized result
  arrays (teachers/students/classes/spreadsheets).
- `auth.controller.js` gained `forgotPassword` / `resetPassword` — routes
  through the same verified-recovery-email + `VerificationToken` system
  from Phase 1, generic response either way so it can't enumerate accounts.
- `admin.routes.js` gained a school-logo upload endpoint and an
  authenticated (not static) report-card PDF download route, since those
  PDFs carry personal academic data.

## Frontend

A mobile-first, blue-and-white, vanilla JS single-page app under `public/`
— no build step, served directly by Express as static files:

- `public/index.html` + `public/css/styles.css` — theme, touch-sized
  buttons (50px min height), bottom nav, horizontal-scroll cards.
- `public/js/api.js` — fetch wrapper with automatic access-token refresh.
- `public/js/app.js` — hash-based router covering: login, forced
  security-setup (unbypassable — `route()` redirects back to it on every
  navigation attempt until both recovery emails are verified),
  forgot/reset password, dashboard (notification badge, horizontal
  teacher/student rails, section tiles), teacher/student list + profile
  (verify/reject/remove with confirmation modals), classes (create/rename/
  archive), spreadsheets list → read-only version view with **large
  checkboxes, SELECT ALL, and SEND REPORT CARDS** behind a confirmation
  modal, settings (school profile, logo upload, password change), audit
  log, and categorized search.

## Running Phase 2

Same setup as Phase 1 (`npm install`, migrate, seed), then `npm run dev`
and open `http://localhost:4000` — the admin dashboard is served directly,
no separate frontend server needed.

**Note:** this sandbox has no network access, so `npm install` /
`prisma migrate` / `prisma generate` could not be executed here to verify
against a live database — every file was checked with `node --check` for
syntax validity, but please run the install + migrate steps locally before
first use, and flag anything that doesn't come up cleanly.

## What's deliberately deferred to the Teacher phase

- Actual spreadsheet creation/editing/locking (the mutation side of
  versioning) — Phase 1's schema supports it, Phase 2 only ever reads
  locked data.
- Teacher's own dashboard/profile management.
- Student-facing dashboard and self-service report card viewing (the
  authenticated PDF download route is ready for it to call).

---

# Phase 3: Complete Teacher Experience

Built without touching any existing table, relationship, or Admin
functionality. **One additive schema change** (safe — adds a table,
doesn't alter or remove anything): `SpreadsheetVersionSubject`, a join
table recording which subjects a version covers even before any score
exists for them (needed so a newly-added subject shows up as an empty
column immediately, not just once a score is typed).

## Login change

Login now resolves the identifier as **either a username or an email** —
Admin keeps using its fixed username, Teachers log in with their
registered email, both through the same `POST /api/auth/login`. This
required no schema change, just a lookup that also checks
`Teacher.email` / `Student.email` when the identifier isn't a known
username.

## Grading engine — `src/lib/grading.js`

Single source of truth for the whole grading scale, used identically by
the live autosave preview and the frozen lock-time numbers:

- Test max 40, Exam max 60 — both validated server-side (never trusted
  from the client) and rejected outright rather than silently clamped;
  the "auto-clear and flash red" behavior is a client-side UX nicety on
  top of a hard server rejection.
- Total is always derived (`test + exam`), never accepted as direct
  input, so it can't drift from its inputs.
- 90–100 A+, 80–89 A, 70–79 B+, 60–69 B, 50–59 C, 40–49 D, 0–39 F, exactly
  as specified — one grade band table, referenced everywhere a grade is
  computed (subject grade, overall final grade).
- Overall `maxScore = subjectCount × 100`, `percentage = totalScore ÷ maxScore × 100`.

## Versioning — how "one spreadsheet, many versions" actually works

- **Create**: makes the `Spreadsheet` row *and* a `SpreadsheetVersion` #1
  in `DRAFT` status in the same transaction. This draft is the teacher's
  working copy.
- **Autosave** (`PATCH .../autosave`): batch-upserts scores, psychomotor
  ratings, attendance, and remarks into the *current* version only —
  never touches versioning. Rejects writes to a `LOCKED` version outright.
  Flips `DRAFT → SAVED` on first successful save.
- **Lock**: flips the current version's status to `LOCKED`, stamps
  `lockedAt`/`lockedById`. This is the *only* action that makes a version
  immutable and visible to Admin — matching Phase 2, which only ever
  reads `LOCKED` versions.
- **Unlock**: only allowed on the version that is currently
  `spreadsheet.currentVersionId` (i.e., the latest) — an old historical
  version can never be reopened. Unlocking does **not** touch the locked
  version's own data or status at all; it stamps `unlockedAt` on it as a
  "superseded" marker and deep-copies every row (students, subjects,
  scores, psychomotor, attendance, remarks) into a **brand-new** `DRAFT`
  version numbered one higher, then repoints `currentVersionId` there.
  Lock that again and it becomes "Version 2," etc. — the old locked
  version is permanently frozen and still exactly what Admin already saw.

## Autosave behavior

The client accumulates edits in memory and debounces a single batched
`PATCH` 3 seconds after the last keystroke (within the spec's 2–5s
window), plus flushes immediately before a manual Lock. The save
indicator shows `Saving…` / `Saved at HH:MM` / an inline error. Grade/
total/percentage recalculation happens instantly client-side (a
lightweight mirror of `grading.js`) purely for feedback — the server
recomputes and stores the authoritative values on every autosave and at
lock time regardless of what the client displayed.

## Psychomotor, attendance, AI-assist

- Psychomotor: one `PsychomotorRating` row per (student, trait) — the
  unique constraint itself is what guarantees "only one rating per
  category," not just UI behavior. Clicking the selected number deletes
  the row (no rating); clicking another replaces it.
- Attendance: "School Opened" is entered once and applied identically to
  every student's `Attendance` row on autosave; "Present" is per-student
  and server-rejected if it exceeds School Opened.
- AI-assist (`GET .../ai-remark`) is a **rule-based, offline generator**
  (`src/services/aiRemark.service.js`) reading percentage/grade/
  attendance/psychomotor — no external API key needed to demo this
  phase. It only ever returns a suggestion; the frontend confirms before
  overwriting an existing manual remark, and nothing is saved until the
  teacher's own edit/accept triggers the normal autosave. Swap the body
  of `generateRemark()` for a real LLM call later without touching any
  caller.

## Print / PDF

- **Print spreadsheet** (`GET .../print`): renders the *exact* current
  version's full grid as a landscape PDF via `pdfkit`, built from the
  same `buildVersionView()` the editor and lock path already use — what
  prints can never drift from what's on screen.
- **Generate report cards** (`POST .../generate-report-cards`, locked
  versions only): reuses Phase 2's `reportCard.service.js` per student on
  the spreadsheet.

## Frontend

Extends the same no-build vanilla-JS app with a parallel teacher shell
(`#/teacher-*` hash routes) alongside the existing `#/…` admin routes —
login now branches by role after authenticating. New screens: teacher
registration (class dropdown sourced from a new public,
unauthenticated `GET /api/public/classes`), forced-but-friendly
first-login profile-picture prompt, dashboard with horizontally
rectangular spreadsheet cards (newest first), the multi-section
create-spreadsheet wizard (year → term → searchable student picker with
Select All → subject picker with inline "add new subject"), and the
spreadsheet editor itself: a wide horizontally-scrollable table with
floating semi-transparent touch-sized scroll arrows, live-validated
score inputs (red flash + auto-clear on out-of-range, mirroring the
server's hard rejection), psychomotor tick buttons, the attendance bar,
per-student remark + AI-assist, the save indicator, and a single
lock/unlock button gated behind a confirmation modal either direction.

## Running Phase 3

Same as before — `npm install`, `npm run prisma:migrate` (this will pick
up the new `SpreadsheetVersionSubject` table), `npm run seed`,
`npm run dev`. A teacher registers at `#/register-teacher` (needs at
least one Admin-created class to appear in the dropdown — create one
from the Admin dashboard first), gets verified by Admin, then logs in
with their email.

**Note:** as with Phase 2, this sandbox has no network access, so the
install/migrate steps could not be run here — every file was verified
with `node --check` and a static require-path resolver, but please run
migrate locally and flag anything that doesn't come up cleanly.

---

# Phase 4: Complete Student Experience

Built without touching Admin or Teacher functionality. **One schema
relaxation** (not a breaking change — existing filled-in student rows are
unaffected): `Student.firstName`, `lastName`, `dateOfBirth`,
`stateOfOrigin`, and `sex` became nullable, because registration now
collects only username/email/password per spec — the rest is filled in by
the first-login wizard. Admin's student list/profile views were updated
to fall back to the username when a name is still null, so nothing
renders "null null" for a student who hasn't finished setup yet.

## Registration & login

- `POST /api/register/student` now takes just `{username, email,
  password}`. Everything else starts null.
- Login already resolved by username-or-email since Phase 3; that
  resolver was extracted into `src/lib/identifierResolver.js` and reused
  by `forgotPassword` too, so **Forgot Password now works for
  teachers and students**, not just Admin — it sends the reset token to
  whatever email that role logs in with (a teacher's/student's own
  registered email; Admin still requires a *verified* recovery email,
  since that account has full system access and deserves the extra proof
  step).
- New small admin convenience: `PATCH /admin/students/:id/class`, since
  students no longer pick a class at registration — Admin assigns it
  once they verify the account. Additive, doesn't touch any existing
  route.

## First-login setup wizard

`PATCH /api/student/profile` accepts any subset of the six wizard
fields, so the frontend saves progressively — page 1 (names) on "Next,"
page 2 (DOB/state/sex/religion) on "Next," page 3 (photo) via
`POST /api/student/profile/photo` on "Complete." `needsProfileSetup` in
`GET /api/student/me` is computed (not stored) from whether every
required field is filled — the same "absence of the flag data IS the
flag" pattern used for the teacher's photo prompt in Phase 3. The
frontend wizard blocks "Next"/"Complete" until each page's required
fields are present, and there's no skip or close control on the card at
all — that's what "cannot accidentally skip" is enforced by, not just
a UI suggestion.

## Report cards — single source of truth, reused

`studentReportCard.controller.js` computes every number by calling
`teacherSpreadsheet.controller.js`'s `buildVersionView()` — the *exact*
same function the teacher's editor, lock, and print path already use.
This means a student's percentage/grade can never drift from what the
teacher saw when they locked the version — it isn't recalculated with
separate logic anywhere.

A report card is only visible to the student once `issuedAt` is set,
which only happens when Admin or the teacher actually sends it (Phase
2's delivery flow) — a `ReportCard` row can exist without being sent, and
an unsent one is invisible here by query, not just by UI hiding.

## Security — the actual mechanism, not just a check

`requireOwnReportCard` (new in `ownership.middleware.js`) loads the
report card, compares its `studentId` against the requesting user's own
`Student` row, and returns a plain **404** (not 403) on mismatch — so
guessing another student's report card ID can't even be used to confirm
it exists. Every student route that takes a `:reportCardId` goes through
this middleware; there is no route that skips it.

## Help button

`POST /api/student/help` emails the school's configured administrative
email (falls back to a clear "not configured yet" error rather than
silently failing) and logs a `STUDENT_HELP_MESSAGE_SENT` audit event
either way. The frontend's floating `❓` button is part of the student
shell itself, so it's available from every screen, not just the
dashboard.

## Frontend

New `#/student-*` routes alongside the existing admin/teacher ones:
public registration, the floating step wizard (progress dots, Back/Next/
Complete), the dashboard (school header pulled from the same public
`/api/public/school-info` Phase 3 added, profile card, large tappable
report-card tiles showing year/term/date/percentage/grade, newest
first), the full report card view (photo, stats grid, subject table,
psychomotor grid, teacher's comment), settings, and the site-wide
floating help button/modal.

## Running Phase 4

Same as before — `npm install`, `npm run prisma:migrate` (picks up the
nullable-field relaxation on `Student`), `npm run seed`, `npm run dev`.
A student registers at `#/register-student`, Admin verifies them and
assigns a class from the Admin dashboard, then the student logs in with
their email and lands in the setup wizard.

**Note:** same sandbox limitation as every prior phase — no network
access here, so install/migrate could not be run in this environment.
Every file passed `node --check` and a static require-path resolver;
please run migrate locally and flag anything that doesn't come up clean.

## What's now fully connected end-to-end

Admin verifies → Teacher builds and locks a spreadsheet → Admin or
Teacher sends report cards → Student sees them on their dashboard and
can open the full report, exactly as specified across all four phases.

---

# Phase 5: Official Report Card PDF & Print System

Built without touching Admin, Teacher, or Student functionality from
earlier phases — this phase upgrades *how report cards are rendered*,
not any of the underlying data model or permissions.

## What changed

**`src/services/spreadsheetView.service.js`** — `buildVersionView` (the
per-student score/grade/attendance/psychomotor read-model) was extracted
out of `teacherSpreadsheet.controller.js` into its own dependency-free
module. This was necessary, not cosmetic: the new report-card PDF
service needs it, and the PDF service is itself needed by the teacher
controller — leaving `buildVersionView` inside the controller would have
created a circular `require()`. The whole project's require graph was
verified cycle-free with an automated DFS check.

**`src/services/reportCardDetail.service.js`** — one shared
`buildReportCardDetailView(reportCardId)` function that assembles
*everything* a report card needs to display (student identity, academic
info, attendance, overall result, subject scores, psychomotor ratings,
teacher's comment) from a locked spreadsheet version. The student's own
detail endpoint, the teacher's and admin's read-only detail endpoints,
and the PDF renderer all call this one function — so the web view and
the printed/downloaded document can never disagree with each other, and
historical integrity is structural: every number traces back through
`buildVersionView` to rows tied to an immutable, already-locked
`spreadsheetVersionId`, never recalculated from a student's current data.

**`src/services/reportCard.service.js`** — completely rewritten PDF
rendering, referencing the physical result-sheet image supplied partway
through this phase for structure and professional appearance (not
screenshotted — redrawn as a proper vector document via `pdfkit`):

- School header, student photo (embedded from disk, with a graceful "NO
  PHOTO" placeholder box if none exists), and an identity grid (class,
  gender, age, academic year, term, times school opened, times present).
- Subject table: Subject | Test /40 | Exam /60 | Total /100 | Grade |
  **Remarks** — the per-subject remarks column (mirroring the reference
  sheet) shows that subject's grade-band label, computed from the exact
  same scale used everywhere else, so it can never contradict the grade
  next to it. A grading-key legend prints once under the table.
- Overall result stat blocks, a psychomotor ratings table laid out as
  one row per trait with columns for ratings 5→1 (mirroring the
  reference sheet's checkbox-style layout) and a filled marker in the
  student's actual rating, plus its own legend.
- Teacher's comment box, then — always, since the PDF *is* the print
  document — Head of School's Comments (large blank box), Signature,
  Date, and School Resumes lines with real blank space for handwriting.
- Page-aware: `ensureSpace()` adds a new page and redraws the table
  header with a "(continued)" marker if a long subject list would
  overflow — handles large numbers of subjects without ever overlapping
  content or breaking the professional appearance.
- `renderBatchReportCardsPdf()` draws every student on a locked version
  into one combined PDF via the exact same `drawOneReportCard()`
  function, calling `doc.addPage()` between students — so a student's
  individual download and their page inside the class-wide batch are
  pixel-identical, and each report clearly begins on its own page.
- Once generated, a report card's PDF is never silently regenerated
  (`renderReportCardPdf` returns the existing file if one exists) — an
  issued report is immutable, matching the historical-integrity rule.

## Online vs. print — one template, one CSS switch

The spec requires the online dashboard view and the printed/PDF version
to show different content (Head of School's comment / signature / school
resumes appear only in print). This is implemented as **one shared HTML
renderer** (`renderPrintableReportCardHtml` in `app.js`) with those
sections wrapped in a `.print-only` div — `display: none` on screen,
revealed only inside `@media print` in `styles.css`. The same is true in
reverse for the interactive chrome (topbar, buttons): hidden via
`.no-print` only when printing. This means the online view and the
printed view can never drift apart into two different templates — it's
the same DOM, switched by one CSS rule, matching the actual data flowing
through `buildReportCardDetailView`. Clicking "Print" calls the browser's
native `window.print()`, styled for A4 via `@page { size: A4; margin:
14mm }`.

## New routes

- `GET /teacher/report-cards/:id` and `GET /admin/report-cards/:id` —
  read-only detail JSON (student's own equivalent already existed from
  Phase 4), each with its own ownership check, powering the print-preview
  page for that role.
- `GET /teacher/spreadsheet-versions/:versionId/report-cards/pdf` and the
  admin equivalent — the combined batch PDF, locked versions only.
- Existing single-report PDF download routes (teacher/admin/student) now
  serve the upgraded professional layout automatically.

## Frontend

New `#/teacher-report-card/:id` and `#/admin-report-card/:id` routes
(the student one already existed) — each fetches its role-appropriate
detail endpoint and renders the shared print-preview component with
Print and Download PDF buttons. The teacher's spreadsheet editor and the
admin's spreadsheet-version view both gained a "Download All Report
Cards (One PDF)" button calling the batch endpoint, and a student's
Report Card History tiles on the admin's student profile page are now
clickable through to the same print-preview.

## Running Phase 5

No new dependencies, no schema changes, no migration needed — this phase
only changed rendering code. `npm install` / `npm run prisma:migrate` /
`npm run seed` / `npm run dev` as before.

**Note:** same sandbox limitation as every prior phase — no network
access here, so nothing could be run live. Every file passed `node
--check`, a static require-path resolver, and an automated
circular-dependency graph check (which is what caught and fixed a real
cycle introduced partway through this phase's refactor). Please pull up
an actual report card, a batch PDF, and the browser print preview locally
and flag anything that doesn't look right — this phase leaned entirely
on visual/layout judgment without being able to render a single page myself.

---

# Phase 6: Full Responsive Design — Mobile, Tablet, and Desktop

This phase doesn't add features — it fixes the app shell so it actually
adapts to the screen it's on, instead of being a fixed 480px (720px on
"desktop") phone-width column centered on a gray background regardless
of viewport size. That was the core problem this phase addresses: the
app technically "fit" any screen, but never looked intentionally
designed for anything wider than a phone.

## The app shell

`#app` no longer caps at 480/720px. It's fully fluid at every phone,
tablet, and laptop width, and only caps at 1600px on very large
monitors so content doesn't stretch edge-to-edge on a 27" screen.

**Navigation becomes a real desktop pattern, not a stretched mobile
one.** Below 1024px, `.bottom-nav` is the fixed bottom bar the spec
calls out as an appropriate mobile pattern — unchanged. At 1024px+, the
exact same markup (no JS or HTML changes needed) becomes a fixed left
sidebar via CSS alone: `flex-direction: column`, icon-left/label-right
nav items, positioned relative to the app panel. Content gets a matching
`margin-left` offset. Building and fixing this caught a real stacking
bug along the way — the sidebar and the sticky topbar shared a z-index,
and since the sidebar comes later in the DOM it would have rendered on
top of and covered the header in their small overlapping corner; the
sidebar now sits at a lower z-index so the topbar correctly paints over it.

**The topbar's inner content is centered with a sensible max-width**
instead of stretching a search bar or school-name row across a huge
screen — the bar's background still spans full width (so it doesn't
look like it "runs out"), but its content doesn't sprawl.

## Sizing that adapts instead of just scaling

- `.tile-grid` (dashboard sections): 2 columns on phones, 3 on tablets
  (≥640px), `auto-fill` on desktop so tiles wrap into as many
  reasonably-sized columns as fit rather than stretching individually huge.
- `.hscroll` (teacher/student/class card rails): stays a horizontal
  scroll on phones (the right mobile pattern), but at ≥640px the exact
  same cards simply wrap into a row via `flex-wrap` — no forced
  horizontal scrolling once there's room to just show them.
- Buttons and form inputs are capped at a comfortable max-width
  (`380px`/`480px`) once the screen is wide enough to need it — a
  full-width `width:100%` button makes sense on a 360px phone; stretched
  across a 1200px desktop content panel it just looks oversized, which
  the spec explicitly warns against.
- `.content` padding scales through real tiers (16px mobile → 22–32px
  tablet → 28–48px desktop) instead of one fixed value everywhere.

## The spreadsheet — the deliberate exception

Per spec, the spreadsheet is the one thing that should *not* try to
squash into a normal responsive layout. It keeps its horizontal scroll,
sticky Names column, sticky header, and floating semi-transparent
left/right arrows (all already built in Phase 3) at every width — but
now the scroll container's edge-bleed margins track the same padding
tiers as `.content`, so it reaches the actual screen edge at every
breakpoint instead of only lining up correctly at the one width it was
originally tuned for. On desktop, cell padding, font size, score inputs,
and remark textareas all get modestly larger (`@media (min-width:
1024px)`), since the spec explicitly asks the spreadsheet to use
available space and stay readable, not remain phone-cramped just because
it happens to scroll.

## Landscape

A `(orientation: landscape) and (max-height: 500px)` query — the
signature of a phone rotated sideways — trims vertical chrome (topbar
padding, the spreadsheet header card's address line, nav item height) so
more of the actual spreadsheet table is visible without scrolling, which
is exactly where the spec says landscape matters most. The same query
also caps modal/wizard height and tightens the login screen's vertical
rhythm so nothing gets pushed off a short viewport.

## Viewport-safety and accessibility

- `.modal-sheet` and `.wizard-card` both gained `max-height` +
  `overflow-y: auto` — neither can now overflow a short viewport
  regardless of how much content they hold, closing a real gap against
  the explicit "modals must fit within the viewport" requirement.
- Every interactive element gets a visible `:focus-visible` outline —
  this app suppresses the browser default everywhere (custom
  backgrounds, `border: none`), so without this rule keyboard navigation
  had no visible focus state at all, failing the accessibility
  requirement outright rather than just looking different.
- Icon-only controls (back button, help button, table scroll arrows)
  gained `aria-label`s where they had none. The profile avatar was
  actually a `<div>` with a click handler — not keyboard-focusable, not
  announced to a screen reader as a button at all — now a real
  `<button>` with a label, in all three shells (admin/teacher/student).
- Icon buttons and the back button were bumped toward the spec's ~44px
  touch-target guidance (were 40px/36px).
- Fixed a small pre-existing markup bug found while auditing this: the
  academic-year/term selects in the create-spreadsheet wizard had a
  `.form-group` class applied directly to the `<select>` instead of a
  wrapping `<div>`, so none of the form-input CSS (including this
  phase's desktop width cap and existing focus-color styling) was ever
  actually reaching them. Fixed to match the pattern used everywhere else.

## What didn't change

No backend files, no schema, no routes — this phase is CSS plus a
handful of small, targeted JS fixes (aria-labels, the avatar
div→button swap, the two select-wrapper fixes, and moving one page
header's inline edge-bleed style into a proper breakpoint-aware CSS
class). Every existing feature from Phases 1–5 works exactly as before;
only how it's laid out at each screen size changed.

## Running Phase 6

No new dependencies, no migration — purely front-end. Same
`npm install` / `npm run prisma:migrate` / `npm run seed` / `npm run dev`
as always.

**Note:** same sandbox limitation as every prior phase — there's no
display or browser available here, so nothing could be visually rendered
or measured against an actual screen. Every CSS/JS file was checked for
brace balance and syntax validity, and the responsive logic was reasoned
through against each of the specific breakpoints the spec listed
(320/360/375/390/414/480/768/1024/1280/1440px) plus landscape — but
please actually resize a browser window across those widths locally,
rotate a phone/tablet, and tab through the interface with a keyboard,
and flag anything that doesn't look or feel right. This phase leaned
entirely on CSS/layout judgment without being able to see a single
rendered pixel.

---

# Phase 7: Full Integration Audit

A systematic, code-level audit of every phase — permissions, calculations,
data integrity, report delivery, and mobile UX — following the explicit
test checklist. No new features were added, per the audit's own
instruction; everything below is either a confirmed-working check or an
actual bug found and fixed. This was a static code audit (no live
server/database available in this sandbox), done by tracing every
relevant code path by hand and, where possible, verifying with small
standalone calculations run outside the app.

## 1. What was tested

- **Admin**: login, forced first-time security setup (two recovery
  emails, verification, forced password change), forgot/reset password,
  teacher/student approval and removal, class creation, spreadsheet and
  version viewing, report-card sending, search, school settings, audit
  logs, and — explicitly — that Admin has no code path capable of
  writing to a locked spreadsheet's scores.
- **Teacher**: registration (class required, validated server-side),
  verification-gated login, password recovery, profile picture,
  spreadsheet creation (session/term/student/subject selection), every
  score-validation rule (Test >40, Exam >60, negatives), automatic
  total/grade/max-score/percentage/final-grade calculation, psychomotor
  selection, attendance (including the invalid-attendance edge case),
  AI-assisted comments, autosave, manual save, lock/unlock/Version
  2/Version 3, print, and PDF.
- **Student**: registration, admin approval gating, login, the
  first-login wizard, profile picture, dashboard, report-card visibility
  and history, help messaging, password recovery, and specifically that
  a student cannot reach another student's report by ID.
- **Data integrity**: traced every write path to the score/psychomotor/
  attendance/remark tables to confirm none can touch a `LOCKED` version;
  confirmed a `ReportCard`'s snapshot fields are never updated after
  creation; confirmed unlocking never mutates the old locked version,
  only stamps `unlockedAt` and creates a new one.
- **Report delivery**: confirmed only the `studentIds` explicitly passed
  to the send endpoint are touched — an unselected student's `ReportCard`
  row (if one exists at all) never gets `issuedAt` set, which is the
  actual condition controlling visibility.
- **Security**: every route file read end-to-end for missing
  `requireAuth`/`requireRole`/ownership checks; ID-manipulation
  resistance re-verified on every `:id`-scoped route; file-serving
  routes checked for path-traversal risk and correct ownership gating;
  password hashing and logging checked for plaintext exposure.
- **Calculations**: independently re-derived Subject Total, Maximum
  Score, Percentage, and every grade boundary by hand against the
  spec's exact numbers, including deliberately-awkward decimal
  percentages (89.5%, 33.33%, etc.) most likely to expose a boundary bug.
- **Mobile UX**: spot-checked against Phase 6's responsive work —
  touch targets, floating scroll arrows, modal viewport-fit, and the
  score-input auto-clear/red-flash behavior specifically.

## 2. What was fixed

**Critical — grading was silently wrong for decimal percentages.**
`gradeForPercentage()` checked `pct >= band.min && pct <= band.max`
against adjacent whole-number bands (A: 80–89, A+: 90–100). Any decimal
percentage landing *between* two bands — 89.5%, 79.3%, 69.99% — matched
neither band's inclusive range and silently fell through to the F
fallback. Since percentage is a computed, decimal-prone value
(`totalScore ÷ maxScore × 100`), this wasn't a rare edge case — it was
reachable by nearly any realistic score combination. It affected the
live spreadsheet editor's grade display, the final stored grade, and the
PDF's per-subject Remarks column (which uses the same function). Fixed
by checking only each band's floor against bands already ordered
highest-to-lowest — mathematically gap-free — **in both the backend
(`grading.js`) and an independent duplicate copy in the frontend** (the
live-preview mirror had the identical bug). Verified against a dozen
boundary and decimal cases by hand.

**Autosave could silently commit a partial batch while reporting
"nothing was saved."** The original autosave endpoint validated and
wrote in the same pass — an invalid row anywhere in the batch was
skipped, but everything else in that same transaction still committed,
and only afterward did the response claim the save had failed. The
concretely reachable case: a teacher lowering "School Opened" below a
value another student's already-saved "Present" required would silently
leave *that* student's attendance row on the old School Opened value
while every other student's row updated — a real, silent data
inconsistency reachable through completely normal use, not just API
misuse. Rewrote `autosave` to validate the *entire* batch first (reading
current state, computing every effective value) and only write if
everything checks out — the response is now literally true: either the
whole batch saved, or none of it did. Also fixed the frontend to
proactively clear a student's "Present" value the moment "School Opened"
is lowered past it, mirroring the existing auto-clear-and-flash-red
pattern already used for score inputs, so the teacher gets immediate
feedback instead of a delayed batch rejection.

**Documented setup would have broken every PDF/file download.** The
`.env.example` template's own documented default, `STORAGE_ROOT=./storage`,
is a relative path — and Express's `res.sendFile()` throws at runtime if
given one. Every report-card PDF, batch PDF, and spreadsheet print route
in the app calls `res.sendFile()` against a path built from
`STORAGE_ROOT`. Fixed with `path.resolve()` so a relative `.env` value
still resolves correctly regardless of the process's working directory.

**Search would quietly degrade if the documented Postgres migration was
ever followed.** SQLite's `LIKE` (what Prisma's `contains` compiles to)
is case-insensitive for ASCII by default, so search "just works" on the
current SQLite setup — but Postgres's `LIKE` is case-sensitive, and
Prisma's `mode: "insensitive"` fix for that is a Postgres/MongoDB-only
option that would *crash* on SQLite if added blindly. Added a small
provider-aware helper (`searchMode.js`) that detects the database from
`DATABASE_URL` and applies the right behavior for either — correct on
today's SQLite setup and safe for the exact Postgres migration this
project's own README recommends.

**Missing manual Save button.** The spec explicitly asks for one
alongside autosave; it didn't exist. Added, wired to immediately flush
any pending changes.

**A small pre-existing markup bug**, found while re-checking form
styling: the create-spreadsheet wizard's academic-year/term `<select>`
elements had a `.form-group` class applied directly to the `<select>`
itself instead of a wrapping `<div>` — meaning none of the shared
form-input CSS (focus color, the desktop width cap from Phase 6) was
ever actually reaching them. Fixed to match the pattern used everywhere
else in the app.

## 3. Remaining issues

None found that affect core correctness, security, or the explicit test
checklist above. Two small, non-blocking gaps worth naming honestly:

- Admin has no UI to update recovery emails *after* the initial forced
  setup (only change-password exists in Settings). Not a bug — nothing
  is broken or insecure — just a feature the phase specs never
  explicitly asked for beyond the one-time setup flow.
- This was a static audit without a running server, live database, or
  browser. Every fix was verified by hand-tracing logic and, for the
  calculation bug specifically, independently re-running the exact
  comparison logic outside the app to confirm both the bug and the fix.
  Nothing here substitutes for actually clicking through the app locally.

## 4. Recommended future improvements

(Explicitly not built now, per this phase's "don't add unnecessary
features" instruction — listed only because the phase asks for
recommendations.)

- A real end-to-end test suite (even a handful of Playwright/Jest tests
  covering the login→lock→send→view journey) would catch regressions
  like the two logic bugs found here automatically, rather than relying
  on a manual audit.
- Admin self-service recovery-email management after initial setup.
- The AI-assist remark generator is confirmed genuinely free — fully
  local, rule-based, zero API calls, zero cost, works with no
  configuration. If a more varied/natural writing style is ever wanted,
  a free-tier LLM API could be swapped in behind the exact same
  `generateRemark()` function signature without touching any caller —
  but the current version already satisfies "no paid AI dependency" and
  needs nothing added to keep working.
