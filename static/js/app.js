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
  const empty = $("#log-empty");
  if (eventLog.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");

  // Build HTML for all entries
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

// ── PostHog JS init ──

function initPostHog() {
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
  $("#current-distinct-id").textContent = posthog.get_distinct_id();
  toast("PostHog connected!", "success");
  addLog("event", "PostHog Initialized", { host: apiHost });

  // Fetch flags from server now that we're connected
  fetchFlags();
}

// ── Feature Flags (fetched from Python backend cache) ──

async function fetchFlags() {
  const distinctId = posthogReady ? posthog.get_distinct_id() : "anonymous";
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
  const distinctId = posthogReady ? posthog.get_distinct_id() : "anonymous";
  try {
    const res = await fetch("/api/flags/reload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ distinct_id: distinctId }),
    });
    const data = await res.json();
    renderFlags(data.flags);
    $("#cache-info").textContent = `Cache age: 0s · Evaluated for: ${data.distinct_id}`;
    toast("Flags reloaded!", "success");
    addLog("flag", "Flags Reloaded", data.flags);
  } catch (err) {
    toast("Failed to reload flags.", "error");
  }
}

function renderFlags(flags) {
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

  // Re-fetch flags for this user
  fetchFlags();
}

function resetUser() {
  if (!posthogReady) { toast("Connect PostHog first.", "error"); return; }

  posthog.reset();
  const newId = posthog.get_distinct_id();
  $("#current-distinct-id").textContent = newId;
  $("#user-display").textContent = "Not identified";
  toast("Person reset. New anonymous ID generated.", "info");
  addLog("identify", "Person Reset", { new_distinct_id: newId });

  fetchFlags();
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
  $("#btn-connect").addEventListener("click", initPostHog);

  // Identify
  $("#btn-identify").addEventListener("click", identifyUser);
  $("#btn-reset").addEventListener("click", resetUser);
  $("#btn-set-props").addEventListener("click", setPersonProperties);

  // Feature flags
  $("#btn-reload-flags").addEventListener("click", reloadFlags);

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
    $("#log-empty").classList.remove("hidden");
  });

  // Try to fetch flags on load (even before PostHog JS init, the server can evaluate)
  fetchFlags();
});
