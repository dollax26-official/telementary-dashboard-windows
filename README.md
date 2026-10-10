# Fern Dashboard

Desktop telemetry dashboard for **Fern** (Electron). This is the v1.1 redesign:
a cleaner, smoother UI in a Railway-style dark theme, plus per-player filtering
in **Sessions** and a **Commands ⇄ Chat logs** switch in **Commands**.

## Run it

```powershell
cd C:\Users\%USER%\Desktop\FernDashboard
npm start
```

Dependencies are already installed (`node_modules` present). If you ever move
the folder: `npm install` first.

Build a Windows installer:

```powershell
npm run dist
# output: dist\FernDashboard-Setup-1.1.0.exe
```

## Connect

The login screen asks for two things:

1. **Telemetry server URL** — your Fern "data storer" on Railway, e.g.
   `https://your-app.up.railway.app` (prefilled with the current deployment).
2. **Railway master token** — the `TELEMETRY_TOKEN` value set on the
   telementary service in Railway.

Both are kept in memory for the app session only. If your Railway URL ever
changes, update the default in `main.js` (`DEFAULT_API_BASE`) — or just type
the new URL on the login screen.

## What you can do

| View | Highlights |
| --- | --- |
| **Overview** | Totals (players / sessions / commands / chat logs), recent sessions, top players by commands. Click any row to jump to that player's sessions. |
| **Players** | Search by name, UUID or device ID. Status badge (Online / Idle / Offline) from the last upload. Click UUID / device ID to copy. |
| **Sessions** | **Filter by player** (choose exactly whose sessions you see), search by server, click a session to expand its timeline (commands + chat). |
| **Commands** | **Filter by player**, switch **Commands ⇄ Chat logs**, and text-search within either list. |
| **Worlds** | Every single-player world the mod users have played — game mode, dates, sessions, playtime, commands & chats. The **Download JSON** button exports what's currently in view, fetched from your server. |

## How it works

```
Fern mod (Minecraft)                     Telementary API (Railway)            Fern Dashboard (this app)
  records sessions/commands  ──POST──▶  /api/register  /api/telemetry  ◀──GET──  /api/devices, /api/telemetry?limit=1000&offset=…
  (device token)                          stores records (master-token read)          (master token)
```

- `main.js` talks to the API: validates the master token via `/api/devices`,
  then pages through `/api/telemetry` (up to 8 × 1000 records) so filters see
  the full history.
- `renderer.js` merges uploads by `deviceId` into players, then builds the
  Sessions / Commands / Chat log lists and applies the filters.

### About chat logs & single-player worlds

Chat logs render from each session's `chats` array (received messages show their
sender; messages you sent are shown without one). Single-player sessions show the
world name from `session.world`, and the **Worlds** section merges the mod's
`singlePlayerWorlds` metadata with per-session world info. Fern v0.2+ uploads both
automatically — older session data without them simply shows a clean empty state.

## File map / where to change things

| File | Purpose |
| --- | --- |
| `main.js` | Electron main process + API client. API base URL, page size, timeouts live here. |
| `preload.js` | Safe bridge (`window.fern`). Rarely needs changes. |
| `index.html` | App structure: login screen, sidebar, views, toolbars. |
| `styles.css` | All styling. Theme colors are CSS variables in `:root` (top of file). |
| `renderer.js` | All logic: data merge, filters, rendering, toasts. Filter state lives in `state.filters`. |
| `_old-v1/` | Backup of the previous design (not bundled into builds). |

Quick tweaks:

- **Colors / theme** → `styles.css` `:root` variables (`--bg`, `--accent`, …).
- **API server address** → `main.js` `API_BASE`.
- **Max records fetched** → `main.js` `PAGE_LIMIT` / `MAX_PAGES`.
- **Table row caps** → `renderer.js` `CAP` constant.
- **Filter defaults** → `renderer.js` `state.filters`.

## Quality notes

- Empty, loading (skeleton) and error (with retry) states for every list.
- Hover/active/focus-visible states on all controls; keyboard reachable.
- Responsive down to the 960px minimum window width; sidebar collapses to
  icons on narrow layouts.
- All content is escaped; no remote assets; works fully offline except the API.
- Custom scrollbars, reduced-motion support (`prefers-reduced-motion`).
