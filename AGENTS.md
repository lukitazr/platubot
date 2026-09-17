# AGENTS.md

## Developer Commands
- **Start Bot**: `bun index.js`
- **Deploy Slash Commands**: `bun deploy-commands.js`
- **Setup Local MongoDB**: `bun scripts/setup-local-mongo.js` (installs `mongod.exe` and `mongosh.exe` to `bin/`)
- **Migrate JSON Data**: `bun scripts/migrate-to-mongo.js`
- **Manual Database Backup**: `bun scripts/backup-db.js` (or `bun scripts/backup-db.js --tier=30m|1h|3h|1d|1w`)
- **Restore Database Backup**: `bun scripts/restore-db.js` (interactive selector or `bun scripts/restore-db.js --path=backups/...`)
- **Sync Fixture Standings**: `>sincronizarfixture` (or `/platubi-sincronizarfixture`)


## Runtime & Framework Quirks
- **Runtime**: Requires **Bun** (v1.3+).
- **Mongoose / Bun Compatibility**: `database/polyfill.js` patches `process.getBuiltinModule('v8')` for Mongoose BSON compatibility under Bun. Always import `database/polyfill.js` before `mongoose` in any new entry points.
- **Embedded API Server**: Starting the bot initializes an HTTP server via `Bun.serve` on `DASHBOARD_PORT` (default `3001`) from `database/backupManager.js`. Requires `DASHBOARD_API_SECRET` for Bearer auth on `/api/*` endpoints.

## Architecture & Code Routing
- **Command Structure**: Commands reside in subdirectories inside `commands/` (e.g. `commands/superliga/`, `commands/coppa/`). Both `execute` (Slash commands) and `run` (Prefix commands) methods may be present.
- **Dynamic Tournament Commands**: Syntax `<prefix><torneo_prefix>-<subcommand>` (e.g. `>copa-tabla`) is routed in `events/server/messageCreate.js` to `torneo-generic` (`commands/copa/genericTorneo.js`).
- **Visual Image Rendering**: Image generators in `utils/visual/` build HTML/SVG using `satori` and convert to PNG using `@resvg/resvg-js` offloaded to a `piscina` worker pool (`renderPool.js` & `renderWorker.js`).
- **Interaction Centralization**: Discord buttons, modals, tournament approvals, and Gemini AI match score validation are handled in `events/server/interactionCreate.js`.
