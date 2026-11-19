"use strict";
const NodeHelper = require("node_helper");
const { Feed, config } = require("./lib/feed");

module.exports = NodeHelper.create({
  start() { this.clients = new Map(); this.feed = null; this.lastPacket = null; },
  socketNotificationReceived(notification, payload) {
    if (notification !== "LIVE_RADAR_SUBSCRIBE" || !payload || typeof payload.id !== "string") return;
    try {
      const settings = config(payload.config);
      const signature = JSON.stringify(settings);
      if (this.feed && this.signature !== signature) {
        this.sendSocketNotification("LIVE_RADAR_STATUS", { id: payload.id, state: "stopped", message: "Use the same location, range and feed settings for all LiveRadar instances." });
        return;
      }
      this.clients.set(payload.id, true);
      if (!this.feed) {
        this.signature = signature;
        this.feed = new Feed(settings,
          data => { this.lastPacket = data; this.broadcast("LIVE_RADAR_DATA", data); },
          status => this.broadcast("LIVE_RADAR_STATUS", status));
        this.feed.start();
      } else if (this.lastPacket) {
        this.sendSocketNotification("LIVE_RADAR_DATA", { id: payload.id, ...this.lastPacket });
      }
    } catch (error) {
      this.sendSocketNotification("LIVE_RADAR_STATUS", { id: payload.id, state: "stopped", message: error.message });
    }
  },
  broadcast(name, data) {
    for (const id of this.clients.keys()) this.sendSocketNotification(name, { id, ...data });
  },
  stop() { if (this.feed) this.feed.stop(); }
});
