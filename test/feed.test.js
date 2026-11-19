"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { config, normalize, distanceMiles, retryDelay, Feed, endpoint } = require("../lib/feed");
const now = 1795077504001;
const settings = config({});
const heli = { hex: "a1f48f", category: "A7", t: "AS50", flight: "N225LA  ", lat: 34.251572, lon: -118.44366, seen_pos: 0.384, alt_baro: 1500, gs: 100, track: 350 };
const plane = { ...heli, hex: "abcdef", category: "A3", t: "B738" };

test("source milliseconds, aircraft age, helicopter classification and units", () => {
  const p = normalize({ now, ac: [heli, plane] }, settings, now + 1000);
  assert.equal(p.aircraft.length, 2);
  assert.equal(p.aircraft[0].helicopter, true);
  assert.equal(p.aircraft[1].helicopter, false);
  assert.equal(p.aircraft[0].callsign, "N225LA");
  assert.equal(p.aircraft[0].positionAt, now - 384);
  assert.equal(p.aircraft[0].altitude, 1500);
  assert.equal(p.aircraft[0].speed, 100);
  assert.ok(p.aircraft[0].distance > 10 && p.aircraft[0].distance < 12);
});

test("supports seconds timestamps and alternate array; fallback needs absent category", () => {
  const p = normalize({ now: now / 1000, aircraft: [{ ...heli, category: undefined }, { ...plane, t: "AS50" }] }, settings, now);
  assert.equal(p.sourceTime, now);
  assert.equal(p.aircraft[0].helicopter, true);
  assert.equal(p.aircraft[1].helicopter, false);
});

test("retains aircraft database details and optional flight fields for the hover card", () => {
  const report = { ...plane, r: " N123AB ", desc: "BOEING 737-800", ownOp: "EXAMPLE OPERATOR", year: "2006", baro_rate: -500, squawk: "1200" };
  const a = normalize({ now, ac: [report] }, settings, now).aircraft[0];
  assert.equal(a.registration, "N123AB");
  assert.equal(a.description, "BOEING 737-800");
  assert.equal(a.operator, "EXAMPLE OPERATOR");
  assert.equal(a.year, "2006");
  assert.equal(a.verticalRate, -500);
  assert.equal(a.squawk, "1200");
  const missing = normalize({ now, ac: [plane] }, settings, now).aircraft[0];
  assert.equal(missing.description, "");
  assert.equal(missing.operator, "");
  assert.equal(missing.year, null);
  assert.equal(missing.squawk, null);
});

test("rejects stale, missing position age, invalid coordinates, distant and ground reports", () => {
  const reports = [
    { ...heli, seen_pos: 61 }, { ...heli, seen_pos: undefined }, { ...heli, lat: "34" },
    { ...heli, lat: 95 }, { ...heli, lat: 40 }, { ...heli, alt_baro: "ground" },
    { ...heli, hex: '<script>' }, { ...heli, seen_pos: -1 }
  ];
  assert.equal(normalize({ now, ac: reports }, settings, now).aircraft.length, 0);
  assert.equal(normalize({ now: now - 70000, ac: [heli] }, settings, now).aircraft.length, 0);
  assert.throws(() => normalize({ ac: [] }, settings, now), /timestamp/);
  assert.throws(() => normalize({ now: now + 120000, ac: [] }, settings, now), /clock/);
});

test("validates configuration, enforces rate floor and converts range to nautical miles", () => {
  assert.equal(config({ updateInterval: 1 }).updateInterval, 1500);
  assert.throws(() => config({ latitude: 91 }), /latitude/);
  assert.throws(() => config({ rangeMiles: -1 }), /rangeMiles/);
  assert.throws(() => config({ updateInterval: "x" }), /numbers/);
  assert.ok(endpoint(settings).endsWith("/dist/21.72"));
  assert.ok(Math.abs(distanceMiles(0, 0, 0, 1) - 69.093) < 0.01);
});

test("respects Retry-After and backs off on rate limits", () => {
  const response = value => ({ status: 429, headers: { get: () => value } });
  assert.equal(retryDelay(response("120"), 1), 120000);
  assert.equal(retryDelay(response(null), 1), 60000);
});

test("polling stops without overlapping requests; 403 stops and 429 waits", async () => {
  for (const status of [403, 429]) {
    const events = [];
    let calls = 0;
    const feed = new Feed(settings, () => assert.fail("unexpected data"), state => events.push(state), async () => {
      calls++;
      return { ok: false, status, headers: { get: () => "120" } };
    });
    feed.running = true;
    await feed.poll();
    assert.equal(calls, 1);
    assert.equal(events[0].state, status === 403 ? "stopped" : "retry");
    if (status === 429) assert.ok(events[0].nextRetryAt - Date.now() > 118000);
    else assert.equal(feed.running, false);
    feed.stop();
  }
});

test("a stopped feed does not publish a late response", async () => {
  let resolve;
  let published = false;
  const feed = new Feed(settings, () => { published = true; }, () => {}, () => new Promise(r => { resolve = r; }));
  feed.running = true;
  const pending = feed.poll();
  feed.stop();
  resolve({ ok: true, text: async () => JSON.stringify({ now: Date.now(), ac: [heli] }) });
  await pending;
  assert.equal(published, false);
});
