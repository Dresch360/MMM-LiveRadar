"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Feed } = require("./lib/feed");
const port = Number(process.env.PORT || 8099);
const clients = new Set();
let lastPacket;
function broadcast(notification, payload) {
  if (notification === "LIVE_RADAR_DATA") lastPacket = payload;
  for (const client of clients) client.write(`data: ${JSON.stringify({ notification, payload })}\n\n`);
}
const feed = new Feed({}, packet => broadcast("LIVE_RADAR_DATA", packet), status => broadcast("LIVE_RADAR_STATUS", status));
const files = new Set(["preview.html", "MMM-LiveRadar.js", "MMM-LiveRadar.css", "vendor/leaflet.js", "vendor/leaflet.css"]);
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
    res.write(": connected\n\n");
    clients.add(res);
    if (lastPacket) res.write(`data: ${JSON.stringify({ notification: "LIVE_RADAR_DATA", payload: lastPacket })}\n\n`);
    feed.start();
    const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000);
    req.on("close", () => { clearInterval(heartbeat); clients.delete(res); if (!clients.size) feed.stop(); });
    return;
  }
  const file = url.pathname === "/" ? "preview.html" : url.pathname.slice(1);
  if (!files.has(file)) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(file)], "Cache-Control": "no-store" });
  fs.createReadStream(path.join(__dirname, file)).pipe(res);
});
server.listen(port, "127.0.0.1", () => console.log(`Preview: http://127.0.0.1:${port} (Ctrl+C to stop)`));
process.on("SIGINT", () => { feed.stop(); for (const c of clients) c.end(); server.close(); });
