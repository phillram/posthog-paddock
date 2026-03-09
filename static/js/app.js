/* ── PostHog Paddock – Frontend Logic ── */

// ── GIF URLs for feature flag variants ──

const GIFS = {
  spin: "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcnFhd2Y2NjlyazY0dHduNWphZHMxN3A0bnA5b3l3Mjhha2Q2c2Q1bSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/oNGwPFSB1GPwebIFnb/giphy.gif",
  dance: {
    sonic:  "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExb3lqaDZlb3U1aGlwaDh1dThvY2V4bG1jNDlnemRtdzljNDl2MDQwNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ng2FnI4Mg33bOqGaFO/giphy.gif",
    cgi:    "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDV4YnI0bXNtM2EzNGNkYTRueGYzdzg1ajMwbzlqMWQxYW9kcThlZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/EWIiv7izSd4J51tntS/giphy.gif",
    triple: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaHV4Y3BpemFhdGhzOGd5NjlvdGd2NWJyNDU4aDhycXN1bGU1ZGZzbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26u47KZgV82BHdXgc/giphy.gif",
  },
  action: {
    run:   "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNm40bjEyMHpqYmc1ZGhyd3h2ZDVzNWRrdHYzd3llYXNzeWlmYW43cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3ohrysN9ge0eqKphCM/giphy.gif",
    sleep: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExZXR1OXhsczFyc3JpOGRtYWkxNWd1b2VqM3FldXc0eWJmZGZ0MHc2YiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mZtd62JFmSz4z7eU1W/giphy.gif",
    swim:  "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExeHJ4NDk4b3QyaHJwamp5dHMzNmlmZTRqdHNqbzZ2czF6d21lMGhwciZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/yzvVXSvrg7JxC/giphy.gif",
  },
};

// ── State ──

let posthogReady = false;
const eventLog = [];
let allFlagsData = {}; // all project flags and their current values
let flagOverrides = {}; // client-side overrides

// ── DOM helpers ──

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = msg;
  $("#toast-container").appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

function addLog(type, name, props) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    type,
    name,
    props: props || {},
  };
  eventLog.unshift(entry);
  if (eventLog.length > 100) eventLog.pop();
  renderLog();
}

function renderLog() {
  const list = $("#event-log-list");
  if (eventLog.length === 0) {
    list.innerHTML = `<p class="text-sm text-muted">No events yet. Connect and start interacting!</p>`;
    return;
  }

  list.innerHTML = eventLog
    .map((e) => {
      const propsStr = Object.keys(e.props).length
        ? `<div class="log-props">${JSON.stringify(e.props)}</div>`
        : "";
      return `
        <div class="log-entry">
          <span class="log-time">${e.time}</span>
          <span class="log-type ${e.type}">${e.type}</span>
          <span class="log-name">${e.name}${propsStr}</span>
        </div>`;
    })
    .join("");
}

// ── localStorage persistence ──

const STORAGE_KEY = "paddock_session";

function saveSession() {
  const data = {
    apiKey: $("#api-key").value.trim(),
    apiHost: $("#api-host").value,
    distinctId: $("#distinct-id").value.trim(),
    email: $("#person-email").value.trim(),
    personName: $("#person-name").value.trim(),
    connected: posthogReady,
    flagOverrides,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function restoreSession() {
  const session = loadSession();
  if (!session) return;

  if (session.apiKey) $("#api-key").value = session.apiKey;
  if (session.apiHost) $("#api-host").value = session.apiHost;
  if (session.distinctId) $("#distinct-id").value = session.distinctId;
  if (session.email) $("#person-email").value = session.email;
  if (session.personName) $("#person-name").value = session.personName;
  if (session.flagOverrides) flagOverrides = session.flagOverrides;

  // Auto-reconnect if previously connected
  if (session.connected && session.apiKey) {
    initPostHog(true); // silent = true, no duplicate toasts
    // Re-identify if there was a distinct ID
    if (session.distinctId) {
      setTimeout(() => {
        const properties = {};
        if (session.email) properties.email = session.email;
        if (session.personName) properties.name = session.personName;
        posthog.identify(session.distinctId, properties);
        $("#current-distinct-id").textContent = session.distinctId;
        $("#user-display").textContent = session.personName || session.email || session.distinctId;
      }, 500);
    }
  }
}

// ── PostHog JS init ──

function initPostHog(silent) {
  const apiKey = $("#api-key").value.trim();
  const apiHost = $("#api-host").value;
  if (!apiKey) {
    toast("Enter a Project API Key first.", "error");
    return;
  }

  posthog.init(apiKey, {
    api_host: apiHost,
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  });

  posthogReady = true;
  $("#status-dot").className = "status-dot ok";
  $("#status-text").textContent = "Connected";
  $("#btn-disconnect").classList.remove("hidden");
  $("#current-distinct-id").textContent = posthog.get_distinct_id();

  if (!silent) {
    toast("PostHog connected!", "success");
    addLog("event", "PostHog Initialized", { host: apiHost });
  }

  saveSession();
  fetchFlags();
  fetchAllFlags();
}

function disconnectPostHog() {
  if (posthogReady) {
    posthog.reset();
  }
  posthogReady = false;
  flagOverrides = {};
  allFlagsData = {};

  clearSession();

  $("#status-dot").className = "status-dot err";
  $("#status-text").textContent = "Disconnected";
  $("#btn-disconnect").classList.add("hidden");
  $("#current-distinct-id").textContent = "–";
  $("#user-display").textContent = "Not identified";
  $("#distinct-id").value = "";
  $("#person-email").value = "";
  $("#person-name").value = "";

  renderAllFlags({});
  toast("Disconnected. Saved session cleared.", "info");
  addLog("event", "Disconnected", {});
}

// ── Feature Flags (fetched from Python backend cache) ──

async function fetchFlags() {
  let distinctId = "anonymous";
  try { distinctId = posthogReady ? posthog.get_distinct_id() || "anonymous" : "anonymous"; } catch {}
  try {
    const res = await fetch(`/api/flags?distinct_id=${encodeURIComponent(distinctId)}`);
    const data = await res.json();

    if (data.error) {
      toast(data.error, "error");
      return;
    }

    renderFlags(data.flags);
    $("#cache-info").textContent = `Cache age: ${data.cache_age_seconds ?? "–"}s · Evaluated for: ${data.distinct_id}`;
    addLog("flag", "Flags Loaded", data.flags);
  } catch (err) {
    toast("Failed to fetch flags from server.", "error");
    console.error(err);
  }
}

async function reloadFlags() {
  let distinctId = "anonymous";
  try { distinctId = posthogReady ? posthog.get_distinct_id() || "anonymous" : "anonymous"; } catch {}
  try {
    const res = await fetch("/api/flags/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distinct_id: distinctId }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      toast(errData.error || `Server error ${res.status}`, "error");
      return;
    }
    const data = await res.json();
    renderFlags(data.flags);
    $("#cache-info").textContent = `Cache age: 0s · Evaluated for: ${data.distinct_id}`;
    toast("Flags reloaded!", "success");
    addLog("flag", "Flags Reloaded", data.flags);
  } catch (err) {
    toast("Failed to reload flags: " + err.message, "error");
    console.error("Reload flags error:", err);
  }
}

// Track current hedgehog flag values so variant buttons can reference them
let currentHogFlags = { "hog-spin": null, "hog-dance": null, "hog-action": null };

function renderFlags(flags) {
  currentHogFlags = {
    "hog-spin": flags["hog-spin"],
    "hog-dance": flags["hog-dance"],
    "hog-action": flags["hog-action"],
  };

  // ── hog-spin: boolean ──
  const spinValue = flags["hog-spin"];
  let spinHtml;
  let spinBadge;

  if (spinValue === true) {
    spinHtml = `<img src="${GIFS.spin}" alt="Spinning hedgehog" class="flag-img">`;
    spinBadge = `<span class="badge badge-true">true</span>`;
  } else {
    spinHtml = `<div class="flag-disabled">🦔</div>`;
    spinBadge = `<span class="badge badge-false">${spinValue === false ? "false" : "not set"}</span>`;
  }

  $("#flag-spin-display").innerHTML = spinHtml;
  $("#flag-spin-badge").innerHTML = spinBadge;

  // ── hog-dance: multivariate ──
  const danceValue = flags["hog-dance"];
  let danceHtml;
  let danceBadge;

  if (danceValue === "sonic") {
    danceHtml = `<img src="${GIFS.dance.sonic}" alt="Sonic dance" class="flag-img">`;
    danceBadge = `<span class="badge badge-variant">sonic</span>`;
  } else if (danceValue === "cgi") {
    danceHtml = `<img src="${GIFS.dance.cgi}" alt="CGI dance" class="flag-img">`;
    danceBadge = `<span class="badge badge-variant">cgi</span>`;
  } else if (danceValue === "triple") {
    danceHtml = `<img src="${GIFS.dance.triple}" alt="Triple dance" class="flag-img">`;
    danceBadge = `<span class="badge badge-variant">triple</span>`;
  } else {
    danceHtml = `<div class="flag-disabled">🦔</div>`;
    danceBadge = `<span class="badge badge-false">${danceValue === false ? "false" : "not set"}</span>`;
  }

  $("#flag-dance-display").innerHTML = danceHtml;
  $("#flag-dance-badge").innerHTML = danceBadge;

  // ── hog-action: multivariate ──
  const actionValue = flags["hog-action"];
  let actionHtml;
  let actionBadge;

  if (actionValue === "run") {
    actionHtml = `<img src="${GIFS.action.run}" alt="Running hedgehog" class="flag-img">`;
    actionBadge = `<span class="badge badge-variant">run</span>`;
  } else if (actionValue === "sleep") {
    actionHtml = `<img src="${GIFS.action.sleep}" alt="Sleeping hedgehog" class="flag-img">`;
    actionBadge = `<span class="badge badge-variant">sleep</span>`;
  } else if (actionValue === "swim") {
    actionHtml = `<img src="${GIFS.action.swim}" alt="Swimming hedgehog" class="flag-img">`;
    actionBadge = `<span class="badge badge-variant">swim</span>`;
  } else {
    actionHtml = `<div class="flag-disabled">🦔</div>`;
    actionBadge = `<span class="badge badge-false">${actionValue === false ? "false" : "not set"}</span>`;
  }

  $("#flag-action-display").innerHTML = actionHtml;
  $("#flag-action-badge").innerHTML = actionBadge;

  // Highlight active variant buttons
  highlightVariantButtons();
}

function highlightVariantButtons() {
  $$(".variant-btn").forEach((btn) => {
    const onclick = btn.getAttribute("onclick") || "";
    // Parse the flag key and value from the onclick attribute
    const match = onclick.match(/setFlagVariant\('([^']+)',\s*(.+)\)/);
    if (!match) return;

    const key = match[1];
    let btnValue = match[2].trim();
    // Convert string representations to actual values
    if (btnValue === "true") btnValue = true;
    else if (btnValue === "false") btnValue = false;
    else btnValue = btnValue.replace(/^'|'$/g, ""); // strip quotes

    const currentValue = currentHogFlags[key];

    if (currentValue === btnValue) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function setFlagVariant(flagKey, value) {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  // Override the flag client-side
  posthog.featureFlags.override({ [flagKey]: value });
  flagOverrides[flagKey] = value;

  // Update the display immediately
  currentHogFlags[flagKey] = value;
  renderFlags(currentHogFlags);

  // Also update the all-flags list if it has this key
  if (flagKey in allFlagsData) {
    allFlagsData[flagKey] = value;
    renderAllFlags(allFlagsData);
  }

  const displayValue = value === true ? "true" : value === false ? "false" : value;
  toast(`${flagKey} → ${displayValue}`, "success");
  addLog("flag", `Set ${flagKey}`, { value: displayValue });
  saveSession();
}

// ── All Project Flags ──

async function fetchAllFlags() {
  let distinctId = "anonymous";
  try { distinctId = posthogReady ? posthog.get_distinct_id() || "anonymous" : "anonymous"; } catch {}
  try {
    const res = await fetch(`/api/flags/all?distinct_id=${encodeURIComponent(distinctId)}`);
    const data = await res.json();
    if (data.error) {
      toast(data.error, "error");
      return;
    }
    allFlagsData = data.flags || {};
    renderAllFlags(allFlagsData);
  } catch (err) {
    console.error("Failed to fetch all flags:", err);
  }
}

function renderAllFlags(flags) {
  const container = $("#all-flags-list");
  const keys = Object.keys(flags);

  if (keys.length === 0) {
    container.innerHTML = `<p class="text-sm text-muted">No flags found. Connect and check your PostHog configuration.</p>`;
    return;
  }

  container.innerHTML = keys
    .sort()
    .map((key) => {
      const value = flags[key];
      const isActive = value !== false && value !== null && value !== undefined;
      const displayValue = value === true ? "true" : value === false ? "false" : value === null ? "null" : String(value);
      const isOverridden = key in flagOverrides;

      return `
        <div class="flag-row ${isActive ? "active" : ""}">
          <span class="flag-key">${escapeHtml(key)}</span>
          <span class="flag-value">
            ${isActive
              ? `<span class="badge badge-true">${escapeHtml(displayValue)}</span>`
              : `<span class="badge badge-false">${escapeHtml(displayValue)}</span>`
            }
            ${isOverridden ? `<span class="badge badge-cache">overridden</span>` : ""}
          </span>
          <span class="flag-status text-xs ${isActive ? "" : "text-muted"}">${isActive ? "Applied" : "Not applied"}</span>
          <label class="toggle" title="Toggle override for this flag">
            <input type="checkbox" data-flag-key="${escapeHtml(key)}" ${isActive ? "checked" : ""} onchange="toggleFlagOverride(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
    })
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function toggleFlagOverride(checkbox) {
  if (!posthogReady) {
    toast("Connect PostHog first.", "error");
    checkbox.checked = !checkbox.checked;
    return;
  }

  const key = checkbox.dataset.flagKey;
  const currentValue = allFlagsData[key];

  if (checkbox.checked) {
    // Enable: override to true (for boolean flags) or restore previous value
    const overrideValue = (currentValue === false || currentValue === null) ? true : currentValue;
    posthog.featureFlags.override({ [key]: overrideValue });
    flagOverrides[key] = overrideValue;
    allFlagsData[key] = overrideValue;
    toast(`Flag "${key}" overridden to: ${overrideValue}`, "success");
    addLog("flag", `Override: ${key}`, { value: overrideValue });
  } else {
    // Disable: override to false
    posthog.featureFlags.override({ [key]: false });
    flagOverrides[key] = false;
    allFlagsData[key] = false;
    toast(`Flag "${key}" overridden to: false`, "info");
    addLog("flag", `Override: ${key}`, { value: false });
  }

  saveSession();
  renderAllFlags(allFlagsData);
  // Also refresh the hedgehog flag cards if one of the three was toggled
  if (["hog-spin", "hog-dance", "hog-action"].includes(key)) {
    renderFlags(allFlagsData);
  }
}

// ── Identify / Reset ──

function identifyUser() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  const distinctId = $("#distinct-id").value.trim();
  if (!distinctId) { toast("Enter a Distinct ID.", "error"); return; }

  const properties = {};
  const email = $("#person-email").value.trim();
  const name = $("#person-name").value.trim();
  if (email) properties.email = email;
  if (name) properties.name = name;

  posthog.identify(distinctId, properties);
  $("#current-distinct-id").textContent = distinctId;
  $("#user-display").textContent = name || email || distinctId;
  toast(`Identified as ${distinctId}`, "success");
  addLog("identify", `Identified: ${distinctId}`, properties);

  saveSession();
  fetchFlags();
  fetchAllFlags();
}

function resetUser() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  posthog.reset();
  const newId = posthog.get_distinct_id();
  $("#current-distinct-id").textContent = newId;
  $("#user-display").textContent = "Not identified";
  $("#distinct-id").value = "";
  $("#person-email").value = "";
  $("#person-name").value = "";
  toast("Person reset. New anonymous ID generated.", "info");
  addLog("identify", "Person Reset", { new_distinct_id: newId });

  saveSession();
  fetchFlags();
  fetchAllFlags();
}

function setPersonProperties() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  const properties = {};
  const email = $("#person-email").value.trim();
  const name = $("#person-name").value.trim();
  if (email) properties.email = email;
  if (name) properties.name = name;

  if (Object.keys(properties).length === 0) {
    toast("Fill in at least one property.", "error");
    return;
  }

  posthog.setPersonProperties(properties);
  toast("Person properties set!", "success");
  addLog("identify", "Set Person Properties", properties);
  saveSession();
}

// ── Events ──

function sendQuickEvent(event, props) {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  posthog.capture(event, props);
  toast(`Event: ${event}`, "success");
  addLog("event", event, props);
}

function sendCustomEvent() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  const name = $("#custom-event-name").value.trim();
  if (!name) { toast("Enter an event name.", "error"); return; }

  let props = {};
  try {
    const raw = $("#custom-event-props").value.trim();
    if (raw) props = JSON.parse(raw);
  } catch {
    toast("Invalid JSON in properties.", "error");
    return;
  }

  posthog.capture(name, props);
  toast(`Event: ${name}`, "success");
  addLog("event", name, props);
}

// ── Error Tracking ──

function sendException() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  const message = $("#error-message").value.trim() || "Unknown error";
  const type = $("#error-type").value.trim() || "Error";
  const source = $("#error-source").value.trim() || "unknown";

  posthog.capture("$exception", {
    $exception_message: message,
    $exception_type: type,
    $exception_source: source,
    $exception_lineno: 1,
    $exception_colno: 1,
  });

  toast(`Exception sent: ${message}`, "error");
  addLog("error", `Exception: ${type}`, { message, source });
}

function throwRealError() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  const message = $("#error-message").value.trim() || "Paddock error!";
  try {
    throw new Error(message);
  } catch (err) {
    posthog.capture("$exception", {
      $exception_message: err.message,
      $exception_type: err.name,
      $exception_stack_trace_raw: err.stack,
    });
    toast(`Real error thrown & captured: ${err.message}`, "error");
    addLog("error", `Thrown: ${err.name}`, { message: err.message, stack: err.stack });
  }
}

// ── Event listeners ──

document.addEventListener("DOMContentLoaded", () => {
  // Setup
  $("#btn-connect").addEventListener("click", () => initPostHog(false));
  $("#btn-disconnect").addEventListener("click", disconnectPostHog);

  // Identify
  $("#btn-identify").addEventListener("click", identifyUser);
  $("#btn-reset").addEventListener("click", resetUser);
  $("#btn-set-props").addEventListener("click", setPersonProperties);

  // Feature flags
  $("#btn-reload-flags").addEventListener("click", () => { reloadFlags(); fetchAllFlags(); });

  // All flags
  $("#btn-refresh-all-flags").addEventListener("click", fetchAllFlags);

  // Quick events
  $$(".quick-event").forEach((btn) => {
    btn.addEventListener("click", () => {
      const event = btn.dataset.event;
      const props = JSON.parse(btn.dataset.props || "{}");
      sendQuickEvent(event, props);
    });
  });

  // Custom event
  $("#btn-send-event").addEventListener("click", sendCustomEvent);

  // Error tracking
  $("#btn-send-error").addEventListener("click", sendException);
  $("#btn-throw-error").addEventListener("click", throwRealError);

  // Clear log
  $("#btn-clear-log").addEventListener("click", () => {
    eventLog.length = 0;
    renderLog();
  });

  // Restore saved session (auto-reconnect if previously connected)
  restoreSession();

  // Fetch flags on load from server
  fetchFlags();
  fetchAllFlags();
});
