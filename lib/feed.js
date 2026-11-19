"use strict";

const ROTOR_TYPES = new Set([
  "AS50", "AS55", "AS65", "AS32", "AS3B", "EC20", "EC25", "EC30", "EC35", "EC45",
  "EC55", "EC75", "H160", "H60", "S70", "S76", "S92", "B06", "B06T", "B407",
  "B412", "B429", "B430", "B47G", "B505", "B212", "B222", "B230", "UH1", "UH60",
  "R22", "R44", "R66", "A109", "A119", "A139", "A169", "A189", "MD52", "MD60",
  "MD90", "HU50", "CH47", "CH53", "S64", "BK17", "BO105"
]);

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function config(input = {}) {
  const latitude = Number(input.latitude ?? 34.2098);
  const longitude = Number(input.longitude ?? -118.4900);
  const rangeMiles = Number(input.rangeMiles ?? 25);
  const updateInterval = Number(input.updateInterval ?? 2000);
  const maxPositionAge = Number(input.maxPositionAge ?? 60);
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
    throw new Error("Set valid latitude and longitude in config.js.");
  }
  if (!Number.isFinite(rangeMiles) || rangeMiles < 1 || rangeMiles > 250) {
    throw new Error("rangeMiles must be between 1 and 250.");
  }
  if (!Number.isFinite(updateInterval) || !Number.isFinite(maxPositionAge)) {
    throw new Error("updateInterval and maxPositionAge must be numbers.");
  }
  return {
    latitude, longitude, rangeMiles,
    updateInterval: Math.max(1500, updateInterval),
    maxPositionAge: Math.min(300, Math.max(10, maxPositionAge)),
    includeGround: input.includeGround === true
  };
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * r / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
  return 3958.7613 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function normalize(body, settings, receivedAt = Date.now()) {
  if (!body || (!Array.isArray(body.ac) && !Array.isArray(body.aircraft))) {
    throw new Error("Unexpected aircraft data format from adsb.fi.");
  }
  if (!numeric(body.now) || body.now <= 0) {
    throw new Error("Aircraft feed is missing its source timestamp.");
  }
  const sourceTime = body.now > 1e12 ? body.now : body.now * 1000;
  if (sourceTime > receivedAt + 60000) {
    throw new Error("Feed clock is ahead of this computer. Check the Pi's clock.");
  }
  const aircraft = [];
  for (const row of (body.ac || body.aircraft)) {
    if (!row || !numeric(row.lat) || !numeric(row.lon) || Math.abs(row.lat) > 90 ||
        Math.abs(row.lon) > 180 || !numeric(row.seen_pos) || row.seen_pos < 0 ||
        typeof row.hex !== "string" || !/^~?[a-f0-9]{6}$/i.test(row.hex)) continue;
    const positionAt = sourceTime - row.seen_pos * 1000;
    if (receivedAt - positionAt > settings.maxPositionAge * 1000) continue;
    if (!settings.includeGround && row.alt_baro === "ground") continue;
    const distance = distanceMiles(settings.latitude, settings.longitude, row.lat, row.lon);
    if (distance > settings.rangeMiles) continue;
    const type = String(row.t || "").trim().slice(0, 12);
    // ADS-B A7 is rotorcraft. The type fallback is used only when category is absent.
    const helicopter = row.category === "A7" || (!row.category && ROTOR_TYPES.has(type));
    aircraft.push({
      hex: row.hex.toLowerCase(), callsign: String(row.flight || "").trim().slice(0, 24),
      registration: String(row.r || "").trim().slice(0, 24), type, helicopter,
      description: String(row.desc || "").trim().slice(0, 160),
      operator: String(row.ownOp || "").trim().slice(0, 160),
      year: /^[12]\d{3}$/.test(String(row.year || "")) ? String(row.year) : null,
      verticalRate: numeric(row.baro_rate) ? row.baro_rate : (numeric(row.geom_rate) ? row.geom_rate : null),
      squawk: /^[0-7]{4}$/.test(String(row.squawk || "")) ? String(row.squawk) : null,
      category: String(row.category || "").slice(0, 8), lat: row.lat, lon: row.lon,
      altitude: numeric(row.alt_baro) ? row.alt_baro : (numeric(row.alt_geom) ? row.alt_geom : null),
      speed: numeric(row.gs) ? row.gs : null,
      heading: numeric(row.track) ? ((row.track % 360) + 360) % 360 : null,
      distance, positionAt,
      positionSource: Array.isArray(row.mlat) && row.mlat.includes("lat") ? "MLAT" : String(row.type || "unknown")
    });
  }
  aircraft.sort((a, b) => a.distance - b.distance);
  return { aircraft, receivedAt, sourceTime };
}

function endpoint(settings) {
  const nm = (settings.rangeMiles / 1.150779448).toFixed(2);
  return `https://opendata.adsb.fi/api/v3/lat/${settings.latitude}/lon/${settings.longitude}/dist/${nm}`;
}

function retryDelay(response, failures) {
  const retry = response.headers.get("retry-after");
  const seconds = retry && /^\d+(\.\d+)?$/.test(retry) ? Number(retry) : NaN;
  const headerDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry || "") - Date.now();
  return Math.max(response.status === 429 ? 60000 : 5000,
    Number.isFinite(headerDelay) ? headerDelay : 0, Math.min(60000, 2000 * 2 ** failures));
}

class Feed {
  constructor(settings, onData, onStatus, request = global.fetch) {
    this.settings = config(settings);
    this.onData = onData;
    this.onStatus = onStatus;
    this.request = request;
    this.failures = 0;
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.poll();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    if (this.controller) this.controller.abort();
  }

  async poll() {
    if (!this.running) return;
    let delay = this.settings.updateInterval;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller.abort(), 10000);
    try {
      const response = await this.request(endpoint(this.settings), {
        signal: this.controller.signal,
        headers: { "Accept": "application/json", "User-Agent": "MMM-LiveRadar/0.1 personal MagicMirror display" },
        cache: "no-store"
      });
      if (!this.running) return;
      if (!response.ok) {
        this.failures += 1;
        if ([400, 401, 403, 404].includes(response.status)) {
          this.onStatus({ state: "stopped", message: `Feed access error (${response.status}). Check access before restarting.` });
          this.running = false;
          return;
        }
        delay = retryDelay(response, this.failures);
        this.onStatus({ state: "retry", message: response.status === 429 ? "Feed rate limit; waiting before retry" : `Feed HTTP ${response.status}; retrying`, nextRetryAt: Date.now() + delay });
      } else {
        const raw = await response.text();
        if (raw.length > 8 * 1024 * 1024) throw new Error("Aircraft response is too large.");
        const result = normalize(JSON.parse(raw), this.settings);
        if (!this.running) return;
        this.failures = 0;
        this.onData(result);
        this.onStatus({ state: "connected", message: "Connected to adsb.fi" });
      }
    } catch (error) {
      if (!this.running) return;
      this.failures += 1;
      delay = Math.min(60000, 5000 * 2 ** Math.min(this.failures - 1, 4));
      this.onStatus({ state: "retry", message: error.name === "AbortError" ? "Feed timed out; retrying" : "Feed unavailable; retrying", nextRetryAt: Date.now() + delay });
    } finally {
      clearTimeout(timeout);
      // Always leave the full interval AFTER completion. A slow response must
      // never cause a burst of catch-up requests against the public API.
      if (this.running) this.timer = setTimeout(() => this.poll(), delay);
    }
  }
}

module.exports = { config, normalize, distanceMiles, endpoint, retryDelay, Feed };
