"use strict";
const { config, endpoint, normalize } = require("./lib/feed");
async function main() {
  const settings = config({ latitude: process.argv[2], longitude: process.argv[3], rangeMiles: process.argv[4] });
  const response = await fetch(endpoint(settings), { signal: AbortSignal.timeout(15000), headers: { Accept: "application/json", "User-Agent": "MMM-LiveRadar/0.1 feed check" } });
  if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}. Avoid repeated requests; try again later.`);
  const packet = normalize(await response.json(), settings);
  console.log(JSON.stringify({ fetchedAt: new Date(packet.receivedAt).toISOString(), sourceAgeSeconds: (packet.receivedAt - packet.sourceTime) / 1000, aircraft: packet.aircraft.length, helicopters: packet.aircraft.filter(a => a.helicopter).map(a => ({ callsign: a.callsign || a.registration || a.hex, type: a.type, positionAgeSeconds: Math.round((packet.receivedAt - a.positionAt) / 1000) })) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
