/*
 * PostHog Paddock — Frontend
 *
 * IMPORTANT: This JavaScript does NOT evaluate feature flags.
 * All flag evaluation happens on the Python backend.
 *
 * This file does three things:
 *   1. Initializes posthog-js for events, errors, and user identification
 *   2. Fetches flag values from the Python backend and displays them
 *   3. Sends override requests to the Python backend when you click variants
 *
 * The flow for feature flags:
 *   Browser clicks "sonic" button
 *     → JS sends POST /api/flags/override {key: "hog-dance", value: "sonic"}
 *     → Python backend stores the override and returns updated flag values
 *     → JS receives the response and updates the display
 */


// ─────────────────────────────────────────────
// GIF URLs — one for each flag variant
// ─────────────────────────────────────────────

const GIFS = {
  // hog-spin: boolean flag — only one GIF (for true)
  spin: "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExcnFhd2Y2NjlyazY0dHduNWphZHMxN3A0bnA5b3l3Mjhha2Q2c2Q1bSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/oNGwPFSB1GPwebIFnb/giphy.gif",

  // hog-dance: multivariate flag — three GIFs
  dance: {
    sonic:  "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExb3lqaDZlb3U1aGlwaDh1dThvY2V4bG1jNDlnemRtdzljNDl2MDQwNyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ng2FnI4Mg33bOqGaFO/giphy.gif",
    cgi:    "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaDV4YnI0bXNtM2EzNGNkYTRueGYzdzg1ajMwbzlqMWQxYW9kcThlZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/EWIiv7izSd4J51tntS/giphy.gif",
    triple: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExaHV4Y3BpemFhdGhzOGd5NjlvdGd2NWJyNDU4aDhycXN1bGU1ZGZzbiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/26u47KZgV82BHdXgc/giphy.gif",
  },

  // hog-action: multivariate flag — three GIFs
  action: {
    run:   "https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNm40bjEyMHpqYmc1ZGhyd3h2ZDVzNWRrdHYzd3llYXNzeWlmYW43cyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3ohrysN9ge0eqKphCM/giphy.gif",
    sleep: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExZXR1OXhsczFyc3JpOGRtYWkxNWd1b2VqM3FldXc0eWJmZGZ0MHc2YiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/mZtd62JFmSz4z7eU1W/giphy.gif",
    swim:  "https://media0.giphy.com/media/v1.Y2lkPTc5MGI3NjExeHJ4NDk4b3QyaHJwamp5dHMzNmlmZTRqdHNqbzZ2czF6d21lMGhwciZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/yzvVXSvrg7JxC/giphy.gif",
  },
};


// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────

let posthogReady = false;  // true once posthog-js is initialized
const eventLog = [];       // in-memory log of actions taken in the UI
let allFlagsData = {};     // all project flags from the backend
let currentOverrides = {}; // which flags are currently overridden on the backend

// Current values of the three demo flags (used to highlight active buttons)
let currentHogFlags = {
  "hog-spin": null,
  "hog-dance": null,
  "hog-action": null,
};


// ─────────────────────────────────────────────
// DOM Helpers
// ─────────────────────────────────────────────

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
  eventLog.unshift({
    time: new Date().toLocaleTimeString(),
    type,
    name,
    props: props || {},
  });
  if (eventLog.length > 100) eventLog.pop();
  renderLog();
}

function renderLog() {
  const list = $("#event-log-list");
  if (eventLog.length === 0) {
    list.innerHTML = `<p class="text-sm text-muted">No events yet. Start interacting!</p>`;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/** Get the current user's distinct ID for flag evaluation. */
function getDistinctId() {
  try {
    return posthogReady ? posthog.get_distinct_id() || "anonymous" : "anonymous";
  } catch {
    return "anonymous";
  }
}


// ─────────────────────────────────────────────
// Session Persistence (localStorage)
// Saves the user's identity so it survives page refreshes.
// Does NOT save API keys — those come from the server's .env.
// ─────────────────────────────────────────────

const STORAGE_KEY = "paddock_session";

function saveSession() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    distinctId: $("#distinct-id").value.trim(),
    email: $("#person-email").value.trim(),
    personName: $("#person-name").value.trim(),
  }));
}

function restoreSession() {
  let session;
  try {
    session = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return;
  }
  if (!session) return;

  // Restore form fields
  if (session.distinctId) $("#distinct-id").value = session.distinctId;
  if (session.email) $("#person-email").value = session.email;
  if (session.personName) $("#person-name").value = session.personName;

  // Re-identify the user with posthog-js if we have a saved identity
  if (session.distinctId && posthogReady) {
    const properties = {};
    if (session.email) properties.email = session.email;
    if (session.personName) properties.name = session.personName;
    posthog.identify(session.distinctId, properties);
    $("#current-distinct-id").textContent = session.distinctId;
    $("#user-display").textContent = session.personName || session.email || session.distinctId;
  }
}


// ─────────────────────────────────────────────
// PostHog JS Initialization
//
// posthog-js is used ONLY for events, errors, and identification.
// Feature flags are disabled on the JS side — they come from Python.
// ─────────────────────────────────────────────

function initPostHog() {
  const config = window.PADDOCK_CONFIG || {};

  if (!config.apiKey) {
    $("#status-dot").className = "status-dot err";
    $("#status-text").textContent = "No API key in .env";
    return;
  }

  // Initialize posthog-js with feature flags DISABLED.
  // We set advanced_disable_feature_flags to true because
  // all flag evaluation is done on the Python backend instead.
  posthog.init(config.apiKey, {
    api_host: config.apiHost || "https://us.i.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
    advanced_disable_feature_flags: true,  // <-- flags come from Python, not JS
  });

  posthogReady = true;
  $("#status-dot").className = "status-dot ok";
  $("#status-text").textContent = "Connected";
  $("#current-distinct-id").textContent = posthog.get_distinct_id();
  addLog("event", "PostHog Initialized", { host: config.apiHost });
}


// ─────────────────────────────────────────────
// FEATURE FLAGS — Fetching from Python Backend
//
// The Python backend evaluates flags locally using the PostHog
// Python SDK. We fetch the results via HTTP and display them.
// ─────────────────────────────────────────────

/**
 * Fetch the three demo flag values from the Python backend.
 *
 * Calls: GET /api/flags?distinct_id=...
 * The backend evaluates each flag locally using:
 *   posthog.get_feature_flag(key, distinct_id, only_evaluate_locally=True)
 * and returns the results (with any overrides applied).
 */
async function fetchFlags() {
  try {
    const url = `/api/flags?distinct_id=${encodeURIComponent(getDistinctId())}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      toast(data.error, "error");
      return;
    }

    // data.flags = {"hog-spin": true, "hog-dance": "sonic", "hog-action": null}
    // data.overrides = {"hog-spin": true}  (flags that have been manually overridden)
    currentOverrides = data.overrides || {};
    renderFlags(data.flags);

    $("#cache-info").textContent =
      `Cache age: ${data.cache_age_seconds ?? "–"}s · Evaluated for: ${data.distinct_id}`;
    addLog("flag", "Flags fetched from Python backend", data.flags);
  } catch (err) {
    toast("Failed to fetch flags from server.", "error");
    console.error(err);
  }
}

/**
 * Force the Python backend to re-fetch flag definitions from PostHog,
 * clear all overrides, and re-evaluate everything.
 *
 * Calls: POST /api/flags/reload
 */
async function reloadFlags() {
  try {
    const response = await fetch("/api/flags/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distinct_id: getDistinctId() }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      toast(errData.error || `Server error ${response.status}`, "error");
      return;
    }

    const data = await response.json();
    currentOverrides = {};  // overrides were cleared on the backend
    renderFlags(data.flags);

    $("#cache-info").textContent = `Cache age: 0s · Evaluated for: ${data.distinct_id}`;
    toast("Flags reloaded from PostHog! Overrides cleared.", "success");
    addLog("flag", "Flags reloaded from PostHog", data.flags);
  } catch (err) {
    toast("Failed to reload flags: " + err.message, "error");
    console.error(err);
  }
}

/**
 * Send a flag override to the Python backend.
 * Called when the user clicks a variant button (e.g., "sonic", "true", "off").
 *
 * Calls: POST /api/flags/override {key: "hog-dance", value: "sonic"}
 * The Python backend stores this override and returns updated flag values.
 */
async function setFlagVariant(flagKey, value) {
  try {
    const response = await fetch("/api/flags/override", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: flagKey,
        value: value,
        distinct_id: getDistinctId(),
      }),
    });

    const data = await response.json();

    if (data.error) {
      toast(data.error, "error");
      return;
    }

    // Update the display with the new flag values from Python
    currentOverrides = data.overrides || {};
    renderFlags(data.flags);

    // Also update the "All Project Flags" section if it has this flag
    if (flagKey in allFlagsData) {
      allFlagsData[flagKey] = value;
      renderAllFlags(allFlagsData);
    }

    const displayValue = value === true ? "true" : value === false ? "false" : value;
    toast(`${flagKey} → ${displayValue}`, "success");
    addLog("flag", `Override sent to Python: ${flagKey}`, { value: displayValue });
  } catch (err) {
    toast("Failed to set override: " + err.message, "error");
    console.error(err);
  }
}


// ─────────────────────────────────────────────
// FEATURE FLAGS — Rendering the Three Demo Cards
//
// Each flag is checked with simple if/else statements.
// The value comes from the Python backend — we just pick
// which GIF to show based on it.
// ─────────────────────────────────────────────

function renderFlags(flags) {
  // Store current values for button highlighting
  currentHogFlags["hog-spin"] = flags["hog-spin"];
  currentHogFlags["hog-dance"] = flags["hog-dance"];
  currentHogFlags["hog-action"] = flags["hog-action"];

  // ── hog-spin (boolean flag) ──
  // Simple: true shows the spinning hedgehog, anything else shows disabled.
  const spinValue = flags["hog-spin"];

  if (spinValue === true) {
    $("#flag-spin-display").innerHTML = `<img src="${GIFS.spin}" alt="Spinning hedgehog" class="flag-img">`;
    $("#flag-spin-badge").innerHTML = `<span class="badge badge-true">true</span>`;
  } else {
    $("#flag-spin-display").innerHTML = `<div class="flag-disabled">🦔</div>`;
    $("#flag-spin-badge").innerHTML = `<span class="badge badge-false">${spinValue === false ? "false" : "not set"}</span>`;
  }

  // Show whether this value came from local evaluation or an override
  if ("hog-spin" in currentOverrides) {
    $("#flag-spin-source").innerHTML = `<span class="badge-local">PYTHON OVERRIDE</span>`;
  } else {
    $("#flag-spin-source").innerHTML = `<span class="badge-server">PYTHON LOCAL EVAL</span>`;
  }


  // ── hog-dance (multivariate flag: sonic, cgi, or triple) ──
  // Each variant shows a different hedgehog dance GIF.
  const danceValue = flags["hog-dance"];

  if (danceValue === "sonic") {
    $("#flag-dance-display").innerHTML = `<img src="${GIFS.dance.sonic}" alt="Sonic dance" class="flag-img">`;
    $("#flag-dance-badge").innerHTML = `<span class="badge badge-variant">sonic</span>`;
  } else if (danceValue === "cgi") {
    $("#flag-dance-display").innerHTML = `<img src="${GIFS.dance.cgi}" alt="CGI dance" class="flag-img">`;
    $("#flag-dance-badge").innerHTML = `<span class="badge badge-variant">cgi</span>`;
  } else if (danceValue === "triple") {
    $("#flag-dance-display").innerHTML = `<img src="${GIFS.dance.triple}" alt="Triple dance" class="flag-img">`;
    $("#flag-dance-badge").innerHTML = `<span class="badge badge-variant">triple</span>`;
  } else {
    $("#flag-dance-display").innerHTML = `<div class="flag-disabled">🦔</div>`;
    $("#flag-dance-badge").innerHTML = `<span class="badge badge-false">${danceValue === false ? "false" : "not set"}</span>`;
  }

  if ("hog-dance" in currentOverrides) {
    $("#flag-dance-source").innerHTML = `<span class="badge-local">PYTHON OVERRIDE</span>`;
  } else {
    $("#flag-dance-source").innerHTML = `<span class="badge-server">PYTHON LOCAL EVAL</span>`;
  }


  // ── hog-action (multivariate flag: run, sleep, or swim) ──
  // Each variant shows a different hedgehog action GIF.
  const actionValue = flags["hog-action"];

  if (actionValue === "run") {
    $("#flag-action-display").innerHTML = `<img src="${GIFS.action.run}" alt="Running hedgehog" class="flag-img">`;
    $("#flag-action-badge").innerHTML = `<span class="badge badge-variant">run</span>`;
  } else if (actionValue === "sleep") {
    $("#flag-action-display").innerHTML = `<img src="${GIFS.action.sleep}" alt="Sleeping hedgehog" class="flag-img">`;
    $("#flag-action-badge").innerHTML = `<span class="badge badge-variant">sleep</span>`;
  } else if (actionValue === "swim") {
    $("#flag-action-display").innerHTML = `<img src="${GIFS.action.swim}" alt="Swimming hedgehog" class="flag-img">`;
    $("#flag-action-badge").innerHTML = `<span class="badge badge-variant">swim</span>`;
  } else {
    $("#flag-action-display").innerHTML = `<div class="flag-disabled">🦔</div>`;
    $("#flag-action-badge").innerHTML = `<span class="badge badge-false">${actionValue === false ? "false" : "not set"}</span>`;
  }

  if ("hog-action" in currentOverrides) {
    $("#flag-action-source").innerHTML = `<span class="badge-local">PYTHON OVERRIDE</span>`;
  } else {
    $("#flag-action-source").innerHTML = `<span class="badge-server">PYTHON LOCAL EVAL</span>`;
  }

  // Highlight the active variant button for each flag
  highlightActiveButtons();
}

/**
 * For each variant button, check if it matches the current flag value.
 * If yes, add the "active" CSS class to highlight it.
 */
function highlightActiveButtons() {
  $$(".variant-btn").forEach((btn) => {
    // Parse the flag key and value from the onclick attribute
    // e.g., onclick="setFlagVariant('hog-dance', 'sonic')"
    const onclick = btn.getAttribute("onclick") || "";
    const match = onclick.match(/setFlagVariant\('([^']+)',\s*(.+)\)/);
    if (!match) return;

    const flagKey = match[1];        // e.g., "hog-dance"
    let buttonValue = match[2].trim(); // e.g., "'sonic'" or "true" or "false"

    // Convert the string to the actual JS value
    if (buttonValue === "true") buttonValue = true;
    else if (buttonValue === "false") buttonValue = false;
    else buttonValue = buttonValue.replace(/^'|'$/g, ""); // strip quotes → "sonic"

    // Compare with the current flag value
    if (currentHogFlags[flagKey] === buttonValue) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}


// ─────────────────────────────────────────────
// ALL PROJECT FLAGS — Shows every flag on the project
// ─────────────────────────────────────────────

/**
 * Fetch all flags from the Python backend (not just the three demo ones).
 * Calls: GET /api/flags/all?distinct_id=...
 */
async function fetchAllFlags() {
  try {
    const url = `/api/flags/all?distinct_id=${encodeURIComponent(getDistinctId())}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      toast(data.error, "error");
      return;
    }

    allFlagsData = data.flags || {};
    currentOverrides = data.overrides || {};
    renderAllFlags(allFlagsData);
  } catch (err) {
    console.error("Failed to fetch all flags:", err);
  }
}

/** Render the list of all project flags with toggle switches. */
function renderAllFlags(flags) {
  const container = $("#all-flags-list");
  const keys = Object.keys(flags);

  if (keys.length === 0) {
    container.innerHTML = `<p class="text-sm text-muted">No flags found. Check your PostHog configuration in .env.</p>`;
    return;
  }

  container.innerHTML = keys
    .sort()
    .map((key) => {
      const value = flags[key];

      // A flag is "applied" if it has a truthy value (not false/null/undefined)
      const isApplied = value !== false && value !== null && value !== undefined;

      // Format the value for display
      let displayValue;
      if (value === true) displayValue = "true";
      else if (value === false) displayValue = "false";
      else if (value === null) displayValue = "null";
      else displayValue = String(value);

      // Show whether the value is from local evaluation or an override
      const isOverridden = key in currentOverrides;
      const sourceBadge = isOverridden
        ? `<span class="badge-local">OVERRIDE</span>`
        : `<span class="badge-server">LOCAL EVAL</span>`;

      return `
        <div class="flag-row ${isApplied ? "active" : ""}">
          <span class="flag-key">${escapeHtml(key)}</span>
          <span class="flag-value">
            ${isApplied
              ? `<span class="badge badge-true">${escapeHtml(displayValue)}</span>`
              : `<span class="badge badge-false">${escapeHtml(displayValue)}</span>`
            }
            ${sourceBadge}
          </span>
          <span class="flag-status text-xs ${isApplied ? "" : "text-muted"}">
            ${isApplied ? "Applied" : "Not applied"}
          </span>
          <label class="toggle" title="Toggle this flag via Python backend override">
            <input type="checkbox"
                   data-flag-key="${escapeHtml(key)}"
                   ${isApplied ? "checked" : ""}
                   onchange="toggleFlagOverride(this)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
    })
    .join("");
}

/**
 * Called when a toggle switch is flipped in the "All Project Flags" list.
 * Sends an override to the Python backend to enable or disable the flag.
 */
async function toggleFlagOverride(checkbox) {
  const flagKey = checkbox.dataset.flagKey;
  const currentValue = allFlagsData[flagKey];

  // Determine what value to set
  let newValue;
  if (checkbox.checked) {
    // Turning ON: use true for boolean flags, or keep the current variant value
    newValue = (currentValue === false || currentValue === null) ? true : currentValue;
  } else {
    // Turning OFF: set to false
    newValue = false;
  }

  // Send the override to the Python backend and refresh the display
  await setFlagVariant(flagKey, newValue);
  await fetchAllFlags();
}


// ─────────────────────────────────────────────
// People & Identification (uses posthog-js)
// ─────────────────────────────────────────────

function identifyUser() {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

  const distinctId = $("#distinct-id").value.trim();
  if (!distinctId) { toast("Enter a Distinct ID.", "error"); return; }

  const properties = {};
  const email = $("#person-email").value.trim();
  const name = $("#person-name").value.trim();
  if (email) properties.email = email;
  if (name) properties.name = name;

  // posthog.identify links this browser to a known user
  posthog.identify(distinctId, properties);

  $("#current-distinct-id").textContent = distinctId;
  $("#user-display").textContent = name || email || distinctId;
  toast(`Identified as ${distinctId}`, "success");
  addLog("identify", `Identified: ${distinctId}`, properties);

  saveSession();

  // Re-fetch flags for the new user identity
  fetchFlags();
  fetchAllFlags();
}

function resetUser() {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

  // posthog.reset() generates a new anonymous distinct ID
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
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

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


// ─────────────────────────────────────────────
// Events (uses posthog-js)
// ─────────────────────────────────────────────

function sendQuickEvent(event, props) {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }
  posthog.capture(event, props);
  toast(`Event: ${event}`, "success");
  addLog("event", event, props);
}

function sendCustomEvent() {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

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


// ─────────────────────────────────────────────
// Error Tracking (uses posthog-js)
// ─────────────────────────────────────────────

function sendException() {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

  const message = $("#error-message").value.trim() || "Unknown error";
  const type = $("#error-type").value.trim() || "Error";
  const source = $("#error-source").value.trim() || "unknown";

  // Create an Error object and use posthog.captureException()
  // This properly formats the $exception_list that PostHog expects
  const error = new Error(message);
  error.name = type;
  posthog.captureException(error, { source });

  toast(`Exception sent: ${message}`, "error");
  addLog("error", `Exception: ${type}`, { message, source });
}

function throwRealError() {
  if (!posthogReady) { toast("PostHog not connected.", "error"); return; }

  const message = $("#error-message").value.trim() || "Paddock error!";

  // Actually throw and catch a real JS error to get a real stack trace
  try {
    throw new Error(message);
  } catch (err) {
    posthog.captureException(err);
    toast(`Real error thrown & captured: ${err.message}`, "error");
    addLog("error", `Thrown: ${err.name}`, { message: err.message, stack: err.stack });
  }
}


// ─────────────────────────────────────────────
// Startup — runs when the page loads
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  // 1. Initialize posthog-js (for events/errors/identify — NOT flags)
  initPostHog();

  // 2. Restore saved user identity from localStorage
  restoreSession();

  // 3. Fetch flag values from the Python backend
  fetchFlags();
  fetchAllFlags();

  // ── Wire up button click handlers ──

  // People & Identification
  $("#btn-identify").addEventListener("click", identifyUser);
  $("#btn-reset").addEventListener("click", resetUser);
  $("#btn-set-props").addEventListener("click", setPersonProperties);

  // Feature flags (reload from Python backend)
  $("#btn-reload-flags").addEventListener("click", () => {
    reloadFlags();
    fetchAllFlags();
  });
  $("#btn-refresh-all-flags").addEventListener("click", fetchAllFlags);

  // Quick event buttons
  $$(".quick-event").forEach((btn) => {
    btn.addEventListener("click", () => {
      sendQuickEvent(btn.dataset.event, JSON.parse(btn.dataset.props || "{}"));
    });
  });

  // Custom event
  $("#btn-send-event").addEventListener("click", sendCustomEvent);

  // Error tracking
  $("#btn-send-error").addEventListener("click", sendException);
  $("#btn-throw-error").addEventListener("click", throwRealError);

  // Clear event log
  $("#btn-clear-log").addEventListener("click", () => {
    eventLog.length = 0;
    renderLog();
  });
});
