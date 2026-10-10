"use strict";

/* ==========================================================================
   Fern Dashboard — renderer (v1.1 redesign)

   Data model (per "record" from GET /api/telemetry):
     { receivedAt, remoteAddress, source, deviceId,
       payload: { player, uuid, minecraftVersion,
                  sessions: [ { server, joined, left,
                                commands: [ { time, command } ],
                                chats?:   [ { time, message } ] } ] } }

   One "player" is keyed by deviceId (fallback: uuid, then name), so multiple
   uploads from the same install merge into a single player.
   ========================================================================== */

const $ = (id) => document.getElementById(id);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const RX_ERR = /^Error invoking remote method '[^']*':\s*(Error:\s*)?/;
const cleanErr = (e) => String((e && e.message) || e || "Unknown error").replace(RX_ERR, "");

/* --------------------------------- time --------------------------------- */

const dfmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const tfmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });

const ts = (t) => {
  if (typeof t === "number") return Number.isFinite(t) ? t : 0;
  const v = Date.parse(t);
  return Number.isFinite(v) ? v : 0;
};
const fmtDate = (t) => (ts(t) ? dfmt.format(ts(t)) : "—");
const fmtTime = (t) => (ts(t) ? tfmt.format(ts(t)) : "—");

function rel(t) {
  const v = ts(t);
  if (!v) return "—";
  const d = Date.now() - v;
  if (d < 0) return "just now";
  if (d < 45 * 1000) return "just now";
  const s = d / 1000;
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + "m ago";
  const h = s / 3600;
  if (h < 24) return Math.round(h) + "h ago";
  const days = h / 24;
  if (days < 30) return Math.round(days) + "d ago";
  const mo = days / 30.44;
  if (mo < 12) return Math.round(mo) + "mo ago";
  return Math.round(mo / 12) + "y ago";
}

function fmtDur(ms) {
  if (ms == null) return null;
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60), rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}
const durOf = (s) => fmtDur(ts(s.left) && ts(s.joined) && ts(s.left) >= ts(s.joined) ? ts(s.left) - ts(s.joined) : null);

/* -------------------------------- helpers -------------------------------- */

function hueOf(name) {
  let h = 0;
  for (const ch of String(name || "?")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}
const initialOf = (name) => (String(name || "?").trim()[0] || "?").toUpperCase();
const avatar = (name, cls = "") => `<span class="avatar ${cls}" style="--h:${hueOf(name)}">${esc(initialOf(name))}</span>`;

function shortServer(s) {
  if (!s) return "unknown";
  if (s.startsWith("local")) return "local world";
  return s.split("/")[0].replace(/\.$/, "") || s;
}
const isLocalServer = (s) => String(s || "").startsWith("local");

const serverLabel = (s) => (s && s.world && s.world.name) ? s.world.name : shortServer(s && s.server);

function worldBadge(s) {
  const w = s.world || {};
  const extra = [w.gameMode, w.hardcore ? "hardcore" : null].filter(Boolean).join(", ");
  const title = `Single-player world — ${w.name}${extra ? ` (${extra})` : ""}`;
  return `<span class="badge server local" title="${esc(title)}">${esc(w.name)}</span>`;
}

async function copyText(text) {
  const t = String(text);
  try { await navigator.clipboard.writeText(t); return true; }
  catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch { return false; }
  }
}

/* --------------------------------- icons --------------------------------- */

const svg = (inner, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const I = {
  chevron: svg('<path d="M9.5 6.5 15 12l-5.5 5.5"/>', "ico ico-14"),
  users: svg('<circle cx="9.2" cy="8.2" r="3.4"/><path d="M3.6 19.4c.7-3.1 2.9-5 5.6-5s4.9 1.9 5.6 5"/><path d="M16.2 5.4a3.1 3.1 0 0 1 0 5.9"/><path d="M17.7 14.7c2 .6 3.3 2.2 3.8 4.7"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.3"/><path d="M12 7.4V12l3.1 1.9"/>'),
  term: svg('<rect x="3.4" y="4.6" width="17.2" height="14.8" rx="3"/><path d="M7.3 9.6l2.9 2.5-2.9 2.5"/><path d="M12.7 14.6h4.1"/>'),
  chat: svg('<path d="M4.2 7a2.8 2.8 0 0 1 2.8-2.8h10a2.8 2.8 0 0 1 2.8 2.8v6.4a2.8 2.8 0 0 1-2.8 2.8H9.1l-3.5 3a.55.55 0 0 1-.9-.43Z"/>'),
  search: svg('<circle cx="11" cy="11" r="6.4"/><path d="M15.6 15.6 19.6 19.6"/>'),
  check: svg('<circle cx="12" cy="12" r="8.4"/><path d="m8.6 12.3 2.3 2.3 4.5-4.9"/>'),
  warn: svg('<circle cx="12" cy="12" r="8.4"/><path d="M12 7.8v4.6"/><path d="M12 15.9h.01"/>'),
  info: svg('<circle cx="12" cy="12" r="8.4"/><path d="M12 11v4.4"/><path d="M12 8.1h.01"/>'),
  inbox: svg('<path d="M4.4 13.6 6.8 6.8A2.2 2.2 0 0 1 8.9 5.4h6.2a2.2 2.2 0 0 1 2.1 1.4l2.4 6.8"/><path d="M4.4 13.6h4.1l1 2h5l1-2h4.1v4a2.2 2.2 0 0 1-2.2 2.2H6.6a2.2 2.2 0 0 1-2.2-2.2Z"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.3"/><path d="M3.7 12h16.6"/><path d="M12 3.7c2.4 2.2 3.6 5 3.6 8.3 0 3.3-1.2 6.1-3.6 8.3-2.4-2.2-3.6-5-3.6-8.3 0-3.3 1.2-6.1 3.6-8.3Z"/>'),
  download: svg('<path d="M12 4v10.5"/><path d="m7.5 10.4 4.5 4.6 4.5-4.6"/><path d="M4.5 19.5h15"/>')
};

/* --------------------------------- state --------------------------------- */

const state = {
  devices: [],
  records: [],
  totalRecords: 0,
  lastUpdated: 0,
  loading: false,
  connected: false,
  serverUrl: "",
  view: "overview",
  agg: null,
  filters: {
    playersQ: "",
    sessions: { player: "", q: "" },
    commands: { player: "", type: "commands", q: "" },
    worlds: { player: "", q: "" }
  },
  expanded: new Set()
};

const CAP = 400; /* max rows rendered per list */

/* ------------------------------- aggregation ------------------------------- */

function computeAgg() {
  const players = new Map();

  /* single-player world summaries (one entry per player + world) */
  const worldsMap = new Map();
  const ensureWorld = (pid, pname, name) => {
    const key = pid + "|" + name;
    let w = worldsMap.get(key);
    if (!w) {
      w = {
        key, playerId: pid, player: pname, name,
        gameMode: "", hardcore: false,
        firstPlayed: "", lastPlayed: "",
        sessions: 0, commands: 0, chats: 0, playtimeMs: 0
      };
      worldsMap.set(key, w);
    }
    return w;
  };

  const ensure = (id, name) => {
    let p = players.get(id);
    if (!p) {
      p = {
        id,
        name: name || id,
        uuid: "", version: "",
        device: null,
        lastSeenMs: 0,
        sessions: [], cmdCount: 0, chatCount: 0,
        worlds: new Set()
      };
      players.set(id, p);
    }
    return p;
  };

  /* devices first (so devices without telemetry still appear) */
  for (const d of state.devices) {
    const id = d.deviceId || d.id;
    if (!id) continue;
    const p = ensure(id, d.username);
    if (d.username && (!p.name || p.name === id)) p.name = d.username;
    p.device = d;
    if (d.minecraftVersion) p.version = d.minecraftVersion;
    p.lastSeenMs = Math.max(p.lastSeenMs, ts(d.lastSeenAt));
  }

  /* Session snapshots arrive oldest→newest (the mod re-uploads its full
     activity file on every save), so the newest snapshot of a session is
     the most complete one — dedupe by (player, server, joined), latest wins. */
  const sessionMap = new Map();

  for (const r of state.records) {
    const payload = (r && r.payload) || {};
    const rid = r.deviceId || payload.uuid || payload.player || "unknown";
    const p = ensure(rid, payload.player || r.username);

    if (payload.player && (!p.name || p.name === rid)) p.name = payload.player;
    if (payload.uuid) p.uuid = payload.uuid;
    if (payload.minecraftVersion) p.version = payload.minecraftVersion;

    p.lastSeenMs = Math.max(p.lastSeenMs, ts(r.receivedAt));

    const rootWorlds = Array.isArray(payload.singlePlayerWorlds) ? payload.singlePlayerWorlds : [];
    for (const w of rootWorlds) {
      if (!w || !w.name) continue;
      const worldName = String(w.name);
      p.worlds.add(worldName);
      const entry = ensureWorld(p.id, p.name, worldName);
      if (w.gameMode) entry.gameMode = String(w.gameMode);
      if (w.hardcore === true) entry.hardcore = true;
      if (w.firstPlayed && ts(w.firstPlayed) && (!ts(entry.firstPlayed) || ts(w.firstPlayed) < ts(entry.firstPlayed))) entry.firstPlayed = w.firstPlayed;
      if (w.lastPlayed && ts(w.lastPlayed) > ts(entry.lastPlayed)) entry.lastPlayed = w.lastPlayed;
    }

    const list = Array.isArray(payload.sessions) ? payload.sessions : [];
    for (const s of list) {
      const cmds = Array.isArray(s.commands) ? s.commands : [];
      const msgs = Array.isArray(s.chats) ? s.chats
                 : Array.isArray(s.messages) ? s.messages : [];
      const key = `${p.id}|${s.server || "unknown"}|${s.joined || ""}`;
      const world = s.world && typeof s.world === "object" && s.world.name
        ? { name: String(s.world.name), gameMode: s.world.gameMode || "", hardcore: s.world.hardcore === true }
        : null;
      if (world) p.worlds.add(world.name);
      sessionMap.set(key, {
        playerId: p.id,
        player: p.name,
        server: s.server || "unknown",
        joined: s.joined || "",
        left: s.left || "",
        singleplayer: s.singleplayer === true || !!world,
        world,
        commands: cmds,
        chats: msgs,
        cmdCount: cmds.length,
        chatCount: msgs.length
      });
    }
  }

  const sessions = [...sessionMap.values()];
  const commands = [];
  const chats = [];

  for (const sess of sessions) {
    const p = players.get(sess.playerId);
    if (p) {
      sess.player = p.name;
      p.sessions.push(sess);
    }

    if (sess.world && sess.world.name) {
      const entry = ensureWorld(sess.playerId, sess.player, sess.world.name);
      if (sess.world.gameMode && !entry.gameMode) entry.gameMode = sess.world.gameMode;
      if (sess.world.hardcore) entry.hardcore = true;
      entry.sessions += 1;
      entry.commands += sess.cmdCount;
      entry.chats += sess.chatCount;

      const joinedAt = ts(sess.joined);
      const leftAt = ts(sess.left);
      if (joinedAt && leftAt && leftAt >= joinedAt) entry.playtimeMs += (leftAt - joinedAt);
      if (joinedAt && (!ts(entry.firstPlayed) || joinedAt < ts(entry.firstPlayed))) entry.firstPlayed = sess.joined;
      const lastAt = sess.left || sess.joined;
      if (ts(lastAt) > ts(entry.lastPlayed)) entry.lastPlayed = lastAt;
    }

    for (const c of sess.commands) {
      commands.push({
        time: c.time || c.timestamp || "",
        text: c.command || c.text || "",
        player: sess.player, playerId: sess.playerId, server: sess.server
      });
    }
    for (const c of sess.chats) {
      chats.push({
        time: c.time || c.timestamp || c.sent || "",
        text: c.message || c.text || c.content || "",
        sender: c.sender || null,
        direction: c.direction || null,
        player: sess.player, playerId: sess.playerId, server: sess.server
      });
    }
  }

  for (const p of players.values()) {
    p.cmdCount = p.sessions.reduce((a, s) => a + s.cmdCount, 0);
    p.chatCount = p.sessions.reduce((a, s) => a + s.chatCount, 0);
  }

  const byTimeDesc = (k) => (a, b) => ts(b[k]) - ts(a[k]);
  sessions.sort(byTimeDesc("joined"));
  commands.sort(byTimeDesc("time"));
  chats.sort(byTimeDesc("time"));

  return {
    players: [...players.values()],
    sessions, commands, chats,
    worlds: [...worldsMap.values()].sort((a, b) => ts(b.lastPlayed) - ts(a.lastPlayed)),
    totals: {
      players: players.size,
      sessions: sessions.length,
      commands: commands.length,
      chats: chats.length
    }
  };
}

function statusOf(p) {
  if (!p.lastSeenMs) return { cls: "offline", label: "No data" };
  const ago = Date.now() - p.lastSeenMs;
  if (ago < 5 * 60 * 1000) return { cls: "online", label: "Online" };
  if (ago < 60 * 60 * 1000) return { cls: "idle", label: "Idle" };
  return { cls: "offline", label: "Offline" };
}

/* -------------------------------- filtering -------------------------------- */

function sessionsFiltered() {
  const f = state.filters.sessions;
  let rows = state.agg ? state.agg.sessions : [];
  if (f.player) rows = rows.filter((s) => s.playerId === f.player);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((s) => s.server.toLowerCase().includes(q) || shortServer(s.server).toLowerCase().includes(q));
  }
  return rows;
}

function commandsFiltered() {
  const f = state.filters.commands;
  if (!state.agg) return [];
  let rows = f.type === "chats" ? state.agg.chats : state.agg.commands;
  if (f.player) rows = rows.filter((c) => c.playerId === f.player);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((c) => c.text.toLowerCase().includes(q));
  }
  return rows;
}

function worldsFiltered() {
  const f = state.filters.worlds;
  if (!state.agg) return [];
  let rows = state.agg.worlds;
  if (f.player) rows = rows.filter((w) => w.playerId === f.player);
  if (f.q) {
    const q = f.q.toLowerCase();
    rows = rows.filter((w) => w.name.toLowerCase().includes(q) || w.player.toLowerCase().includes(q));
  }
  return rows;
}

/* --------------------------------- pieces --------------------------------- */

function badge(text, cls = "") {
  return `<span class="badge ${cls}" title="${esc(text)}">${esc(text)}</span>`;
}
function serverBadge(s) {
  return `<span class="badge server ${isLocalServer(s) ? "local" : ""}" title="${esc(s)}">${esc(shortServer(s))}</span>`;
}

function emptyState(icon, title, hint = "") {
  return `<div class="empty"><span class="empty-ico">${icon}</span><p>${esc(title)}</p>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>`;
}

function skeletons(n = 6) {
  return `<div class="skel-wrap">${Array.from({ length: n }, () => '<div class="skel"></div>').join("")}</div>`;
}

function capRows(rows, cap = CAP) {
  const shown = rows.slice(0, cap);
  const rest = rows.length - shown.length;
  return { shown, rest };
}

const countNote = (rest) => rest > 0 ? `<div class="evt-more">+ ${rest.toLocaleString()} more — refine filters to narrow down.</div>` : "";

/* ------------------------------- nav / chips ------------------------------- */

function updateNavCounts() {
  const t = state.agg ? state.agg.totals : null;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = t ? String(v) : ""; };
  set("nc-players", t ? t.players : 0);
  set("nc-sessions", t ? t.sessions : 0);
  set("nc-commands", t ? t.commands : 0);
  set("nc-worlds", state.agg ? state.agg.worlds.length : 0);
}

function updateChip() {
  const el = $("last-updated");
  if (!el) return;
  if (!state.lastUpdated) { el.innerHTML = '<span class="chip-dot"></span>Not loaded'; return; }
  const dot = Date.now() - state.lastUpdated < 2 * 60 * 1000 ? "" : "stale";
  el.innerHTML = `<span class="chip-dot ${dot}"></span>Updated ${esc(rel(state.lastUpdated))}`;
  el.title = new Date(state.lastUpdated).toLocaleString();
}

function setConn(text, cls = "") {
  const t = $("conn-text"); if (t) t.textContent = text;
  const d = $("conn-dot"); if (d) d.className = "conn-dot " + cls;
}

/* ------------------------------- rendering ------------------------------- */

function renderAll() {
  fillSelects();
  updateNavCounts();
  renderOverview();
  renderPlayers();
  renderSessions();
  renderCommands();
  renderWorlds();
}

/* selects are rebuilt but keep the current choice when possible */
function fillSelects() {
  if (!state.agg) return;
  const pl = [...state.agg.players].sort((a, b) => a.name.localeCompare(b.name));
  for (const [id, key] of [["session-player", "sessions"], ["command-player", "commands"], ["worlds-player", "worlds"]]) {
    const sel = $(id);
    if (!sel) continue;
    const prev = state.filters[key].player;
    sel.innerHTML = '<option value="">All players</option>' +
      pl.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
    if (prev && pl.some((p) => p.id === prev)) sel.value = prev;
    else if (prev) state.filters[key].player = "";
  }
}

/* ------------------------------- overview ------------------------------- */

function renderOverview() {
  const agg = state.agg;
  if (!agg) return;

  $("stat-players").textContent = agg.totals.players;
  $("stat-sessions").textContent = agg.totals.sessions;
  $("stat-commands").textContent = agg.totals.commands;
  const chatsEl = $("stat-chats");
  if (chatsEl) chatsEl.textContent = agg.totals.chats;
  const sub = $("stat-players-sub");
  if (sub) sub.textContent = state.devices.length ? `${state.devices.length} registered devices` : "players seen";

  /* recent sessions */
  const recent = agg.sessions.slice(0, 8);
  $("recent").innerHTML = recent.length ? recent.map((s) => `
    <button class="recent-item" data-goto-player="${esc(s.playerId)}" title="Show this player's sessions">
      ${avatar(s.player)}
      <span class="recent-main">
        <span class="name">${esc(s.player)}</span>
        <span class="sub">${esc(serverLabel(s))} · ${esc(fmtDate(s.joined))}</span>
      </span>
      <span class="recent-side">
        <span class="rel" data-ts="${esc(s.joined)}">${esc(rel(s.joined))}</span>
        <span class="dur">${esc(durOf(s) || (s.left ? "—" : "active"))}</span>
      </span>
    </button>`).join("")
    : emptyState(I.clock, "No sessions recorded yet", "Sessions appear here once a Fern client uploads activity.");

  /* top players by commands */
  const top = [...agg.players].filter((p) => p.cmdCount > 0).sort((a, b) => b.cmdCount - a.cmdCount).slice(0, 6);
  const max = top.length ? top[0].cmdCount : 1;
  $("top-players").innerHTML = top.length ? top.map((p, i) => `
    <button class="top-item" data-goto-player="${esc(p.id)}" title="Show this player's sessions">
      <span class="rank">${i + 1}</span>
      ${avatar(p.name)}
      <span class="top-main">
        <span class="name">${esc(p.name)}</span>
        <span class="top-bar"><i style="width:${Math.max(4, Math.round((p.cmdCount / max) * 100))}%"></i></span>
      </span>
      <span class="top-count">${p.cmdCount} cmds</span>
    </button>`).join("")
    : emptyState(I.term, "No commands recorded yet");
}

/* ------------------------------- players ------------------------------- */

function renderPlayers() {
  const agg = state.agg;
  if (!agg) return;

  const q = state.filters.playersQ.toLowerCase();
  const all = [...agg.players].sort((a, b) => b.lastSeenMs - a.lastSeenMs);
  const rows = q
    ? all.filter((p) => `${p.name} ${p.uuid} ${p.id} ${(p.device && p.device.username) || ""}`.toLowerCase().includes(q))
    : all;

  $("players-count").textContent = all.length ? `${rows.length} of ${all.length} shown` : "";

  $("players-list").innerHTML = rows.length ? rows.map((p) => {
    const st = statusOf(p);
    const last = p.lastSeenMs ? `Last seen ${rel(new Date(p.lastSeenMs).toISOString())}` : "Never seen";
    return `
    <div class="player">
      <div class="player-top">
        ${avatar(p.name, "avatar-lg")}
        <div class="player-id">
          <h3>${esc(p.name)}</h3>
          <div class="sub">Minecraft ${esc(p.version || "unknown")} · ${esc(last)}</div>
        </div>
        <span class="badge status ${st.cls}"><i></i>${esc(st.label)}</span>
      </div>
      <div class="kv"><span class="k">UUID</span><button class="v copy" data-copy="${esc(p.uuid)}" title="Click to copy">${esc(p.uuid || "unavailable")}</button></div>
      <div class="kv"><span class="k">Device</span><button class="v copy" data-copy="${esc(p.id)}" title="Click to copy">${esc(p.id)}</button></div>
      <div class="player-stats">
        <span><b>${p.sessions.length}</b> ${p.sessions.length === 1 ? "session" : "sessions"}</span>
        <span><b>${p.cmdCount}</b> ${p.cmdCount === 1 ? "cmd" : "cmds"}</span>
        <span><b>${p.chatCount}</b> ${p.chatCount === 1 ? "chat" : "chats"}</span>
        ${p.worlds && p.worlds.size ? `<span title="${esc([...p.worlds].join(", "))}"><b>${p.worlds.size}</b> ${p.worlds.size === 1 ? "world" : "worlds"}</span>` : ""}
      </div>
    </div>`;
  }).join("")
    : emptyState(I.users, "No players found", q ? "Try a different search term." : "Players appear once a Fern client registers or uploads telemetry.");
}

/* ------------------------------- sessions ------------------------------- */

function sessionEvents(s) {
  const evts = [
    ...s.commands.map((c) => ({ t: ts(c.time || c.timestamp), text: c.command || c.text || "", cls: "cmd" })),
    ...s.chats.map((c) => ({ t: ts(c.time || c.timestamp || c.sent), text: c.message || c.text || c.content || "", sender: c.sender || null, cls: "chat" }))
  ].sort((a, b) => a.t - b.t);
  return evts;
}

function sessionDetailHtml(s) {
  const evts = sessionEvents(s);
  if (!evts.length) return `<div class="detail-empty">No commands or chat messages in this session.</div>`;
  const cap = 80;
  const show = evts.slice(0, cap);
  return `<div class="timeline">` + show.map((e) => {
    const who = e.cls === "chat" && e.sender ? `<b class="sender">${esc(e.sender)}:</b> ` : "";
    return `
    <div class="evt ${e.cls === "chat" ? "evt-chat" : "evt-cmd"}">
      <span class="evt-time">${esc(fmtTime(e.t))}</span>
      <span class="evt-text ${e.cls}">${who}${esc(e.text)}</span>
    </div>`;
  }).join("") + `</div>`
    + (evts.length > cap ? `<div class="evt-more">+ ${evts.length - cap} more events</div>` : "");
}

function sidOf(s) { return `${s.playerId}|${s.joined}|${s.server}`; }

function renderSessions() {
  const agg = state.agg;
  if (!agg) return;

  const f = state.filters.sessions;
  const rows = sessionsFiltered();
  const { shown, rest } = capRows(rows);

  const base = f.player ? agg.sessions.filter((s) => s.playerId === f.player) : agg.sessions;
  $("sessions-count").textContent = agg.sessions.length ? (f.q ? `${rows.length} of ${base.length} shown` : `${rows.length} shown`) : "";

  $("sessions-list").innerHTML = shown.length ? shown.map((s) => {
    const sid = sidOf(s);
    const open = state.expanded.has(sid);
    const dur = durOf(s);
    return `
    <div class="session ${open ? "open" : ""}" data-sid="${esc(sid)}">
      <button class="session-head" data-toggle="${esc(sid)}" title="Click to ${open ? "collapse" : "expand"} session details">
        <span class="sess-player">${avatar(s.player)}<span class="sess-name">${esc(s.player)}</span></span>
        ${s.world ? worldBadge(s) : serverBadge(s.server)}
        <span class="sess-join">
          <span class="rel" data-ts="${esc(s.joined)}">${esc(rel(s.joined))}</span>
          <span class="sub">${esc(fmtDate(s.joined))}</span>
        </span>
        <span class="sess-dur">${s.left ? esc(dur || "—") : '<span class="live">active</span>'}</span>
        <span class="sess-counts"><span><b>${s.cmdCount}</b> ${s.cmdCount === 1 ? "cmd" : "cmds"}</span><span><b>${s.chatCount}</b> ${s.chatCount === 1 ? "chat" : "chats"}</span></span>
        <span class="chev">${I.chevron}</span>
      </button>
      ${open ? `<div class="session-detail">${sessionDetailHtml(s)}</div>` : ""}
    </div>`;
  }).join("") + countNote(rest)
    : emptyState(I.clock,
        f.player || f.q ? "No sessions match these filters" : "No sessions recorded yet",
        f.player || f.q ? "Try a different player or search term." : "Sessions appear here once a Fern client uploads activity.");

  /* re-sync select (in case filter was reset) */
  const sel = $("session-player");
  if (sel && sel.value !== f.player) sel.value = f.player;
}

/* ------------------------------- commands ------------------------------- */

function segCounts() {
  const agg = state.agg;
  const f = state.filters.commands;
  let cmds = agg ? agg.commands : [], chats = agg ? agg.chats : [];
  if (f.player) {
    cmds = cmds.filter((c) => c.playerId === f.player);
    chats = chats.filter((c) => c.playerId === f.player);
  }
  $("seg-count-commands").textContent = cmds.length;
  $("seg-count-chats").textContent = chats.length;
}

function renderCommands() {
  const agg = state.agg;
  if (!agg) return;

  const f = state.filters.commands;
  segCounts();

  document.querySelectorAll("#command-type .seg").forEach((b) => {
    const on = b.dataset.type === f.type;
    b.classList.toggle("active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  $("command-search").placeholder = f.type === "chats" ? "Filter chat messages…" : "Filter commands…";

  const rows = commandsFiltered();
  const { shown, rest } = capRows(rows);
  const base = f.player
    ? (f.type === "chats" ? agg.chats : agg.commands).filter((c) => c.playerId === f.player)
    : (f.type === "chats" ? agg.chats : agg.commands);
  $("commands-count").textContent = base.length ? (f.q ? `${rows.length} of ${base.length} shown` : `${rows.length} shown`) : "";

  const isChats = f.type === "chats";
  $("commands-list").innerHTML = shown.length ? shown.map((c) => `
    <div class="row cmd">
      <div class="row-main">
        <div class="cmd-text ${isChats ? "chat" : ""}">${isChats && c.sender ? `<b class="sender">${esc(c.sender)}:</b> ` : ""}${esc(c.text)}</div>
        <div class="row-meta">
          <span class="badge" title="${esc(c.player)}">${esc(c.player)}</span>
          <span class="dot-sep">·</span>
          ${serverBadge(c.server)}
        </div>
      </div>
      <div class="row-side">
        <span class="rel" data-ts="${esc(c.time)}">${esc(rel(c.time))}</span>
        <span class="abs" title="${esc(fmtDate(c.time))}">${esc(fmtTime(c.time))}</span>
      </div>
    </div>`).join("") + countNote(rest)
    : emptyState(
        isChats ? I.chat : I.term,
        isChats
          ? (f.player || f.q ? "No chat logs match these filters" : "No chat logs recorded yet")
          : (f.player || f.q ? "No commands match these filters" : "No commands recorded yet"),
        isChats
          ? "Chat logs appear here as soon as a player's telemetry includes chat messages."
          : "Commands appear here once a Fern client uploads activity.");

  const sel = $("command-player");
  if (sel && sel.value !== f.player) sel.value = f.player;
}

/* ------------------------------- worlds ------------------------------- */

function renderWorlds() {
  const agg = state.agg;
  if (!agg) return;

  const f = state.filters.worlds;
  const rows = worldsFiltered();
  const { shown, rest } = capRows(rows, 200);

  const base = f.player ? agg.worlds.filter((w) => w.playerId === f.player) : agg.worlds;
  $("worlds-count").textContent = base.length ? (f.q ? `${rows.length} of ${base.length} shown` : `${rows.length} shown`) : "";

  $("worlds-list").innerHTML = shown.length ? shown.map((w) => {
    const meta = [];
    if (w.gameMode) meta.push(esc(w.gameMode));
    if (w.firstPlayed) meta.push("first played " + esc(fmtDate(w.firstPlayed)));
    return `
    <div class="world-row">
      <span class="world-ico">${I.globe}</span>
      <div class="world-main">
        <div class="world-name">${esc(w.name)}${w.hardcore ? ' <span class="badge hard">hardcore</span>' : ""}</div>
        <div class="world-sub">${avatar(w.player, "xs")}<span>${esc(w.player)}${meta.length ? " · " + meta.join(" · ") : ""}</span></div>
      </div>
      <div class="world-stats">
        <span><b>${w.sessions}</b> ${w.sessions === 1 ? "session" : "sessions"}</span>
        <span><b>${esc(fmtDur(w.playtimeMs) || "0s")}</b> played</span>
        <span><b>${w.commands}</b> ${w.commands === 1 ? "cmd" : "cmds"}</span>
        <span><b>${w.chats}</b> ${w.chats === 1 ? "chat" : "chats"}</span>
      </div>
      <div class="row-side">
        <span class="rel" data-ts="${esc(w.lastPlayed)}">${esc(w.lastPlayed ? rel(w.lastPlayed) : "—")}</span>
        <span class="abs">${esc(w.lastPlayed ? fmtDate(w.lastPlayed) : "")}</span>
      </div>
    </div>`;
  }).join("") + countNote(rest)
    : emptyState(I.globe,
        f.player || f.q ? "No single-player worlds match these filters" : "No single-player worlds recorded yet",
        f.player || f.q ? "Try a different player or search term." : "Worlds appear here once a Fern client plays in a single-player world.");

  const sel = $("worlds-player");
  if (sel && sel.value !== f.player) sel.value = f.player;
}

async function downloadWorlds() {
  const rows = worldsFiltered();
  if (!rows.length) { toast("Nothing to download — no worlds in the current view", "error"); return; }

  const f = state.filters.worlds;
  const playerLabel = f.player ? ((rows[0] && rows[0].player) || "player") : "all-players";
  const stamp = new Date().toISOString().slice(0, 10);
  const filename = "fern-worlds-" + playerLabel.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() + "-" + stamp + ".json";

  const payload = {
    export: "fern-singleplayer-worlds",
    generatedAt: new Date().toISOString(),
    server: state.serverUrl || "",
    filter: { player: f.player || null, search: f.q || null },
    count: rows.length,
    worlds: rows.map((w) => ({
      player: w.player,
      world: w.name,
      gameMode: w.gameMode || null,
      hardcore: w.hardcore === true,
      firstPlayed: w.firstPlayed || null,
      lastPlayed: w.lastPlayed || null,
      sessions: w.sessions,
      playtimeSeconds: Math.round(w.playtimeMs / 1000),
      commands: w.commands,
      chats: w.chats
    }))
  };

  const content = JSON.stringify(payload, null, 2);

  try {
    if (window.fern && typeof window.fern.saveFile === "function") {
      const res = await window.fern.saveFile({ filename, content });
      if (res && res.ok) toast("Saved to " + res.path, "ok");
      else if (!(res && res.canceled)) toast("Save failed", "error");
    } else {
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast("Download started", "ok");
    }
  } catch (e) {
    toast("Download failed: " + cleanErr(e), "error");
  }
}

/* ------------------------------- view switch ------------------------------- */

const VIEW_TITLES = { overview: "Overview", players: "Players", sessions: "Sessions", commands: "Commands", worlds: "Worlds" };

function show(view) {
  state.view = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  const el = $("view-" + view);
  if (el) {
    el.classList.remove("hidden");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
  }
  document.querySelectorAll(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  $("page-title").textContent = VIEW_TITLES[view] || view;
}

/* --------------------------------- toasts --------------------------------- */

function toast(msg, kind = "ok") {
  const wrap = $("toast-wrap");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const ico = kind === "error" ? I.warn : kind === "info" ? I.info : I.check;
  el.innerHTML = `${ico}<span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

/* ---------------------------------- load ---------------------------------- */

function showSkeletons() {
  $("recent").innerHTML = skeletons(4);
  $("top-players").innerHTML = skeletons(4);
  $("sessions-list").innerHTML = skeletons(6);
  $("commands-list").innerHTML = skeletons(6);
  $("worlds-list").innerHTML = skeletons(5);
}

function renderLoadError(msg) {
  const retry = "Retry";
  const withRetry = (title, hint) => `<div class="empty"><span class="empty-ico">${I.warn}</span><p>${esc(title)}</p><span class="hint">${esc(hint)}</span><button class="btn primary" style="width:auto;margin-top:6px" id="retry-btn">${retry}</button></div>`;
  $("recent").innerHTML = withRetry("Could not load telemetry", msg);
  $("top-players").innerHTML = withRetry("Could not load data", msg);
  $("sessions-list").innerHTML = withRetry("Could not load sessions", msg);
  $("commands-list").innerHTML = withRetry("Could not load commands", msg);
  $("players-list").innerHTML = withRetry("Could not load players", msg);
  $("worlds-list").innerHTML = withRetry("Could not load worlds", msg);
}

async function load(opts = {}) {
  if (state.loading) return;
  state.loading = true;
  document.body.classList.add("busy");
  setConn("Syncing…", "busy");
  if (!state.agg) showSkeletons();

  try {
    const [d, t] = await Promise.all([window.fern.getDevices(), window.fern.getTelemetry()]);

    state.devices = d && Array.isArray(d.devices) ? d.devices : Array.isArray(d) ? d : [];
    const recs = t && Array.isArray(t.records) ? t.records : Array.isArray(t) ? t : [];
    state.records = recs.filter(Boolean);
    state.totalRecords = t && typeof t.total === "number" ? t.total : state.records.length;

    state.lastUpdated = Date.now();
    state.agg = computeAgg();
    renderAll(); updateChip();
    setConn("Connected", "");
    if (!opts.silent) toast("Telemetry refreshed", "ok");
  } catch (e) {
    const msg = cleanErr(e);
    toast("Refresh failed — " + msg, "error");
    setConn("Connection issue", "err");
    if (!state.agg) renderLoadError(msg);
    else updateChip();
  } finally {
    state.loading = false;
    document.body.classList.remove("busy");
  }
}

/* ------------------------------ ticker (rel) ------------------------------ */

setInterval(() => {
  document.querySelectorAll(".rel[data-ts]").forEach((el) => {
    const v = el.dataset.ts;
    el.textContent = rel(v);
  });
  updateChip();
}, 5000);

/* ------------------------------ interactions ------------------------------ */

document.addEventListener("click", (e) => {
  const nav = e.target.closest(".nav-item");
  if (nav) { show(nav.dataset.view); return; }

  if (e.target.closest("#refresh") || e.target.closest("#refresh-top")) { load(); return; }

  if (e.target.closest("#disconnect")) {
    (async () => {
      try { await window.fern.clearToken(); } catch {}
      location.reload();
    })();
    return;
  }

  if (e.target.closest("#retry-btn")) { load(); return; }

  if (e.target.closest("#worlds-download")) { downloadWorlds(); return; }

  const goto = e.target.closest("[data-goto-player]");
  if (goto) {
    const pid = goto.dataset.gotoPlayer;
    state.filters.sessions.player = pid;
    const sel = $("session-player");
    if (sel) sel.value = pid;
    show("sessions");
    renderSessions();
    return;
  }

  const toggle = e.target.closest("[data-toggle]");
  if (toggle) {
    const sid = toggle.dataset.toggle;
    const wrapEl = toggle.closest(".session");
    if (state.expanded.has(sid)) {
      state.expanded.delete(sid);
      wrapEl.classList.remove("open");
      const d = wrapEl.querySelector(".session-detail");
      if (d) d.remove();
    } else {
      state.expanded.add(sid);
      wrapEl.classList.add("open");
      const s = (state.agg ? state.agg.sessions : []).find((x) => sidOf(x) === sid);
      if (s) {
        const div = document.createElement("div");
        div.className = "session-detail";
        div.innerHTML = sessionDetailHtml(s);
        wrapEl.appendChild(div);
      }
    }
    return;
  }

  const seg = e.target.closest("#command-type .seg");
  if (seg) {
    state.filters.commands.type = seg.dataset.type;
    renderCommands();
    return;
  }

  const cp = e.target.closest("[data-copy]");
  if (cp) {
    const v = cp.dataset.copy;
    if (v) {
      copyText(v).then((ok) => toast(ok ? "Copied to clipboard" : "Copy failed", ok ? "info" : "error"));
    }
    return;
  }
});

/* debounced text inputs */
function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
const onPlayersQ = debounce(() => { state.filters.playersQ = $("player-search").value.trim(); renderPlayers(); });
const onSessionsQ = debounce(() => { state.filters.sessions.q = $("session-search").value.trim(); renderSessions(); });
const onCommandsQ = debounce(() => { state.filters.commands.q = $("command-search").value.trim(); renderCommands(); });
const onWorldsQ = debounce(() => { state.filters.worlds.q = $("worlds-search").value.trim(); renderWorlds(); });

$("player-search").addEventListener("input", onPlayersQ);
$("session-search").addEventListener("input", onSessionsQ);
$("command-search").addEventListener("input", onCommandsQ);
$("worlds-search").addEventListener("input", onWorldsQ);

$("session-player").addEventListener("change", (e) => {
  state.filters.sessions.player = e.target.value;
  renderSessions();
});
$("command-player").addEventListener("change", (e) => {
  state.filters.commands.player = e.target.value;
  renderCommands();
});
$("worlds-player").addEventListener("change", (e) => {
  state.filters.worlds.player = e.target.value;
  renderWorlds();
});

/* -------------------------------- login -------------------------------- */

const hostOf = (u) => { try { return new URL(u).host; } catch { return String(u || ""); } };

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("login-error");
  err.textContent = "";
  const btn = $("connect");
  const label = btn.querySelector(".btn-label");

  const baseUrl = $("server-url").value.trim();
  const token = $("token").value;
  if (!baseUrl) { err.textContent = "Enter your telemetry server URL."; return; }
  if (!/^https?:\/\//i.test(baseUrl)) { err.textContent = "Server URL must start with http:// or https://"; return; }
  if (!token.trim()) { err.textContent = "Enter your master token."; return; }

  btn.classList.add("loading"); btn.disabled = true;
  label.textContent = "Connecting…";

  try {
    const res = await window.fern.setToken({ token, baseUrl });
    state.serverUrl = (res && res.baseUrl) || baseUrl;
    const host = hostOf(state.serverUrl);
    const cs = $("conn-server");
    if (cs) { cs.textContent = host; cs.title = state.serverUrl; }
    state.connected = true;
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
    await load({ silent: true });
    toast("Connected to " + host, "ok");
  } catch (x) {
    err.textContent = cleanErr(x);
    setConn("Not connected", "err");
  } finally {
    btn.classList.remove("loading"); btn.disabled = false;
    label.textContent = "Connect";
  }
});

window.addEventListener("focus", () => {
  if (!$("login").classList.contains("hidden")) $("token").focus();
});

/* boot */
$("token").focus();
