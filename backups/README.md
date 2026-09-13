# Database Backups

This folder is filled automatically, once per day, by the GitHub Action
at `.github/workflows/backup.yml` — nothing here needs to be touched by
hand under normal circumstances.

Each file is a compressed, complete snapshot of the database from that
day (`backup-YYYY-MM-DD.sql.gz`). Files older than 30 days are removed
automatically to keep this from growing forever — for anything older
than that, Neon's own dashboard may still have it under its own backup
history, depending on your plan.

## Restoring from a backup (only if something has genuinely gone wrong)

This *replaces* whatever is currently in the database with the contents
of the backup file — only do this if you're certain that's what you
want, ideally with guidance (from Claude or another developer) rather
than alone, since doing it incorrectly could itself cause data loss.

1. Download the specific `backup-YYYY-MM-DD.sql.gz` file you want to
   restore from GitHub.
2. On a computer with PostgreSQL's command-line tools installed:
   ```
   gunzip backup-YYYY-MM-DD.sql.gz
   psql "YOUR_DATABASE_URL_HERE" < backup-YYYY-MM-DD.sql
   ```
   (`YOUR_DATABASE_URL_HERE` is the same Neon connection string used
   everywhere else — the one in Render's environment variables.)
3. This can take a few minutes depending on how much data there is.
