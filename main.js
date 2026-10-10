const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");

const DEFAULT_API_BASE = "https://telementary-production.up.railway.app";
const PAGE_LIMIT = 1000; /* max records the API returns per page */
const MAX_PAGES = 8;     /* safety cap: up to 8,000 records */

let mainWindow;
let masterToken = "";
let apiBase = DEFAULT_API_BASE;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#13111c",
    title: "Fern Dashboard",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile("index.html");
}

async function api(pathname) {
  if (!masterToken) throw new Error("Master token is not set.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  let response;
  try {
    response = await fetch(apiBase + pathname, {
      headers: { Authorization: `Bearer ${masterToken}` },
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(
      e && e.name === "AbortError"
        ? "Request timed out — check your connection."
        : "Cannot reach the telemetry server."
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    if (response.status === 401) throw new Error("Unauthorized — check your master token.");
    const msg = (data && data.error) || `HTTP ${response.status}`;
    throw new Error(msg);
  }
  return data;
}

function normalizeBase(raw) {
  let base = String(raw || "").trim().replace(/\/+$/, "");
  if (!base) base = DEFAULT_API_BASE;
  if (!/^https?:\/\//i.test(base)) {
    throw new Error("Server URL must start with http:// or https://");
  }
  return base;
}

ipcMain.handle("auth:setToken", async (_, payload) => {
  const token = typeof payload === "string" ? payload : payload && payload.token;
  const requestedBase = typeof payload === "string" ? DEFAULT_API_BASE : payload && payload.baseUrl;

  if (!token || !String(token).trim()) throw new Error("Token is empty.");

  const nextBase = normalizeBase(requestedBase);
  const previousToken = masterToken;
  const previousBase = apiBase;
  masterToken = String(token).trim();
  apiBase = nextBase;

  try {
    /* /api/devices is master-token protected, so it validates both values. */
    await api("/api/devices");
    return { ok: true, baseUrl: apiBase };
  } catch (e) {
    masterToken = previousToken;
    apiBase = previousBase;
    throw e;
  }
});

ipcMain.handle("auth:clear", () => {
  masterToken = "";
  return { ok: true };
});

ipcMain.handle("data:devices", () => api("/api/devices"));

/*
 * Fetch every page of telemetry (newest window first, then older pages),
 * so the player/session/command filters cover the full history instead of
 * only the latest 100 records.
 */
ipcMain.handle("data:telemetry", async () => {
  const pages = [];
  let fetched = 0;
  let total = null;

  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await api(`/api/telemetry?limit=${PAGE_LIMIT}&offset=${i * PAGE_LIMIT}`);
    const records = Array.isArray(page && page.records) ? page.records : [];
    if (page && typeof page.total === "number") total = page.total;
    pages.push(records);
    fetched += records.length;

    if (records.length < PAGE_LIMIT) break;
    if (total !== null && fetched >= total) break;
  }

  /* pages arrive newest-first; reverse to keep chronological order */
  const records = pages.reverse().flat();
  return { ok: true, total: total ?? records.length, fetched: records.length, records };
});

ipcMain.handle("data:saveFile", async (_, payload) => {
  const filename = payload && payload.filename ? String(payload.filename) : "fern-export.json";
  const content = String((payload && payload.content) || "");

  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Save export",
    defaultPath: path.join(app.getPath("downloads"), filename),
    filters: [
      { name: "JSON", extensions: ["json"] },
      { name: "All files", extensions: ["*"] }
    ]
  });

  if (canceled || !filePath) return { ok: false, canceled: true };

  fs.writeFileSync(filePath, content, "utf8");
  return { ok: true, path: filePath };
});

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
