/* global Module, L */
Module.register("MMM-LiveRadar", {
  defaults: {
    latitude: 34.2098, longitude: -118.4900, locationLabel: "xxxx",
    rangeMiles: 25, updateInterval: 2000, maxPositionAge: 60, staleAfter: 15,
    width: 460, mapHeight: 380, maxFlights: 6, helicoptersOnly: false,
    showTrails: true, trailMinutes: 3, showLabels: true, maxLabels: 8,
    useMapTiles: true, includeGround: false,
    layout: "portrait", fullscreen: false, infoSide: "right", sidebarWidth: 430,
    fullscreenPadding: 24, startupZoomOffset: 1, zoomLevel: null
  },
  getScripts() { return [this.file("vendor/leaflet.js")]; },
  getStyles() { return [this.file("vendor/leaflet.css"), this.file("MMM-LiveRadar.css")]; },

  start() {
    this.packet = null;
    this.status = { state: "loading", message: "Connecting to live feed…" };
    this.markers = new Map();
    this.histories = new Map();
    this.trails = new Map();
    this.hoveredHex = null;
    this.pinnedHex = null;
    this.scrollSelection = false;
    this.helicoptersOnly = this.config.helicoptersOnly;
    this.clock = setInterval(() => { if (this.root) this.renderData(); }, 1000);
  },

  notificationReceived(notification) {
    if (notification === "LIVE_RADAR_HELICOPTERS" || notification === "LIVE_RADAR_ALL") {
      if (this.root) this.setFilter(notification === "LIVE_RADAR_HELICOPTERS");
      return;
    }
    if (notification !== "DOM_OBJECTS_CREATED") return;
    this.initMap();
    this.sendSocketNotification("LIVE_RADAR_SUBSCRIBE", { id: this.identifier, config: this.config });
  },

  socketNotificationReceived(notification, payload) {
    if (!payload || payload.id !== this.identifier) return;
    if (notification === "LIVE_RADAR_DATA") {
      this.packet = payload;
      this.recordTrails(payload.aircraft);
    } else if (notification === "LIVE_RADAR_STATUS") {
      this.status = payload;
    } else return;
    if (this.root) this.renderData();
  },

  element(tag, className, content) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (content !== undefined) el.textContent = content;
    return el;
  },

  getDom() {
    // Keep the Leaflet node alive across ordinary MagicMirror DOM refreshes.
    if (this.root) return this.root;
    const root = this.element("section", "lr-root");
    const landscape = this.config.layout === "landscape";
    root.classList.add(landscape ? "lr-layout-landscape" : "lr-layout-portrait");
    if (landscape && this.config.infoSide === "left") root.classList.add("lr-info-left");
    root.style.setProperty("--lr-sidebar-width", `${Math.max(340, Math.min(700, Number(this.config.sidebarWidth) || 430))}px`);
    if (this.config.fullscreen) {
      root.classList.add("lr-fullscreen");
      root.style.setProperty("--lr-fullscreen-padding", `${Math.max(0, Math.min(100, Number(this.config.fullscreenPadding) || 0))}px`);
    } else {
      root.style.width = `${Math.max(landscape ? 760 : 300, Math.min(2400, Number(this.config.width) || 460))}px`;
    }
    const top = this.element("div", "lr-top");
    top.append(this.element("div", "lr-eyebrow", this.config.locationLabel), this.element("div", "lr-title", "LOCAL AIRSPACE"));
    this.badge = this.element("span", "lr-badge", "CONNECTING");
    top.append(this.badge);
    root.append(top);

    const toolbar = this.element("div", "lr-toolbar");
    this.filterButton = this.element("button", "lr-filter", this.helicoptersOnly ? "HELICOPTERS ONLY" : "ALL AIRCRAFT");
    this.filterButton.type = "button";
    this.filterButton.setAttribute("aria-pressed", String(this.helicoptersOnly));
    this.filterButton.title = "Switch between all aircraft and helicopters";
    this.filterButton.onclick = () => this.setFilter(!this.helicoptersOnly);
    toolbar.append(this.filterButton, this.element("span", "lr-range", `${this.config.rangeMiles} MI RANGE`));
    root.append(toolbar);

    const content = this.element("div", "lr-content");
    const mapPanel = this.element("div", "lr-map-panel");
    const infoPanel = this.element("div", "lr-info-panel");
    content.append(mapPanel, infoPanel);
    root.append(content);

    this.mapNode = this.element("div", "lr-map");
    if (!this.config.fullscreen) this.mapNode.style.height = `${Math.max(240, Math.min(1600, Number(this.config.mapHeight) || 380))}px`;
    this.mapNode.setAttribute("aria-label", "Live local aircraft map. North is up.");
    mapPanel.append(this.mapNode);
    const legend = this.element("div", "lr-legend");
    legend.append(this.element("span", "lr-plane-key", "● AIRCRAFT"), this.element("span", "lr-heli-key", "● HELICOPTER"), this.element("span", "lr-stale-key", "FADED = OLDER POSITION"));
    infoPanel.append(legend);
    this.summary = this.element("div", "lr-summary");
    infoPanel.append(this.summary);
    this.rows = this.element("div", "lr-rows");
    infoPanel.append(this.rows);
    this.note = this.element("div", "lr-note", this.status.message);
    infoPanel.append(this.note);
    const credit = this.element("div", "lr-credit");
    const link = this.element("a", "", "Aircraft data: adsb.fi");
    link.href = "https://adsb.fi/";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    credit.append(link, document.createTextNode(" · Positions are received reports"));
    infoPanel.append(credit);
    this.root = root;
    return root;
  },

  initMap() {
    if (this.map || !this.mapNode || !this.mapNode.isConnected) return;
    if (typeof L === "undefined") {
      this.status = { state: "stopped", message: "Map library missing. Copy the complete module folder including vendor/." };
      this.renderData();
      return;
    }
    const center = [Number(this.config.latitude), Number(this.config.longitude)];
    this.map = L.map(this.mapNode, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, preferCanvas: true });
    this.map.on("click", () => {
      this.pinnedHex = null;
      this.hoveredHex = null;
      this.renderData();
    });
    if (this.config.useMapTiles) {
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
        maxZoom: 19, referrerPolicy: "strict-origin-when-cross-origin"
      });
      tiles.on("add", () => {
        // Style only the basemap. Aircraft, trails and attribution retain their colors.
        const container = tiles.getContainer();
        if (container) container.style.filter = "grayscale(1) invert(1) brightness(0.75) contrast(1.1)";
      });
      tiles.on("tileerror", () => { this.tileError = true; });
      tiles.addTo(this.map);
    }
    for (const fraction of [0.25, 0.5, 0.75, 1]) {
      L.circle(center, { radius: this.config.rangeMiles * 1609.344 * fraction, weight: 1, color: "#63b1ac", opacity: fraction === 1 ? 0.5 : 0.22, fill: false, interactive: false }).addTo(this.map);
    }
    L.circleMarker(center, { radius: 4, color: "#ffffff", weight: 1, fillColor: "#a9fff1", fillOpacity: 1, interactive: false }).addTo(this.map);
    this.bounds = L.latLng(center).toBounds(this.config.rangeMiles * 1609.344 * 2);
    this.fitMapRange(10);
    L.control.zoom({ position: "topright" }).addTo(this.map);
    L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(this.map);
    this.resizeObserver = new ResizeObserver(() => {
      this.map.invalidateSize({ animate: false });
      if (this.config.fullscreen) this.fitMapRange(16);
    });
    this.resizeObserver.observe(this.mapNode);
    this.renderData();
  },

  fitMapRange(padding = 16) {
    this.map.fitBounds(this.bounds, { padding: [padding, padding], animate: false });
    const zoom = Number(this.config.zoomLevel);
    if (this.config.zoomLevel != null && this.config.zoomLevel !== "" && Number.isFinite(zoom)) {
      this.map.setZoom(Math.max(1, Math.min(19, Math.round(zoom))), { animate: false });
      return;
    }
    const value = Number(this.config.startupZoomOffset);
    const offset = Number.isFinite(value) ? Math.max(-3, Math.min(3, Math.round(value))) : 1;
    if (offset) this.map.setZoom(this.map.getZoom() + offset, { animate: false });
  },

  setFilter(helicoptersOnly) {
    this.helicoptersOnly = helicoptersOnly;
    this.filterButton.textContent = helicoptersOnly ? "HELICOPTERS ONLY" : "ALL AIRCRAFT";
    this.filterButton.setAttribute("aria-pressed", String(helicoptersOnly));
    this.renderData();
  },

  recordTrails(aircraft) {
    const cutoff = Date.now() - (Number(this.config.trailMinutes) || 3) * 60000;
    for (const a of aircraft) {
      const history = this.histories.get(a.hex) || [];
      const previous = history[history.length - 1];
      if (!previous || (a.positionAt > previous.at && (a.lat !== previous.lat || a.lon !== previous.lon))) {
        history.push({ lat: a.lat, lon: a.lon, at: a.positionAt });
      }
      this.histories.set(a.hex, history);
    }
    for (const [hex, points] of this.histories) {
      const recent = points.filter(p => p.at >= cutoff);
      if (recent.length) this.histories.set(hex, recent);
      else this.histories.delete(hex);
    }
  },

  icon(aircraft, stale) {
    const heading = aircraft.heading ?? 0;
    const shape = aircraft.helicopter
      ? '<path d="M12 9V2M3 5h18M9 18h6M12 17v5M7 21h10"/><ellipse cx="12" cy="13" rx="3.2" ry="5"/><path d="M7 12h10"/>'
      : '<path d="M12 2l2 8 7 5v2l-7-2v5l2 2H8l2-2v-5l-7 2v-2l7-5z"/>';
    return L.divIcon({ className: `lr-icon ${aircraft.helicopter ? "lr-helicopter" : "lr-aircraft"}${stale ? " lr-old" : ""}`,
      html: `<svg viewBox="0 0 24 24" style="transform:rotate(${heading}deg)" aria-hidden="true">${shape}</svg>`, iconSize: [28, 28], iconAnchor: [14, 14] });
  },

  label(aircraft) { return aircraft.callsign || aircraft.registration || aircraft.hex.toUpperCase(); },

  setHoveredAircraft(hex) {
    if (this.hoveredHex === hex) return;
    this.hoveredHex = hex;
    this.scrollSelection = Boolean(hex);
    this.renderData();
  },

  aircraftCard(a, age) {
    const card = this.element("div", "lr-aircraft-card");
    card.append(this.element("strong", "lr-card-registration", a.registration || this.label(a)));
    if (a.callsign && a.callsign !== a.registration) card.append(this.element("div", "lr-card-callsign", `Callsign: ${a.callsign}`));
    card.append(this.element("div", "lr-card-model", a.description || a.type || (a.helicopter ? "Helicopter" : "Aircraft")));
    card.append(this.element("div", "lr-card-category", `${a.helicopter ? "Helicopter" : "Aircraft"}${a.type ? ` · ${a.type}` : ""}`));
    const alt = a.altitude === null ? "Altitude unavailable" : `${Math.round(a.altitude).toLocaleString()} ft`;
    const speed = a.speed === null ? "Speed unavailable" : `${Math.round(a.speed)} kt`;
    card.append(this.element("div", "lr-card-flight", `${alt} · ${speed} · ${a.distance.toFixed(1)} mi`));
    const movement = [];
    if (a.heading !== null) movement.push(`Track ${Math.round(a.heading)}°`);
    if (Number.isFinite(a.verticalRate)) movement.push(`${a.verticalRate > 0 ? "+" : ""}${Math.round(a.verticalRate)} ft/min`);
    if (movement.length) card.append(this.element("div", "lr-card-movement", movement.join(" · ")));
    if (a.operator) card.append(this.element("div", "lr-card-operator", `Listed owner/operator: ${a.operator}`));
    if (a.year) card.append(this.element("div", "lr-card-year", `Built: ${a.year}`));
    if (a.squawk) card.append(this.element("div", "lr-card-squawk", `Squawk: ${a.squawk}`));
    card.append(this.element("div", "lr-card-age", `Position ${Math.floor(age)}s old · ${a.positionSource}`));
    return card;
  },

  renderData() {
    const now = Date.now();
    const all = (this.packet?.aircraft || []).filter(a => (now - a.positionAt) / 1000 <= this.config.maxPositionAge);
    const visible = all.filter(a => !this.helicoptersOnly || a.helicopter);
    const visibleIds = new Set(visible.map(a => a.hex));
    if (this.hoveredHex && !visibleIds.has(this.hoveredHex)) this.hoveredHex = null;
    if (this.pinnedHex && !visibleIds.has(this.pinnedHex)) this.pinnedHex = null;
    const selectedHex = this.hoveredHex || this.pinnedHex;
    const feedAge = this.packet ? Math.max(0, (now - this.packet.sourceTime) / 1000) : Infinity;
    const connected = this.status.state === "connected";
    const live = connected && feedAge <= this.config.staleAfter;
    this.badge.textContent = live ? "LIVE FEED" : (this.status.state === "stopped" ? "STOPPED" : this.packet ? "FEED DELAYED" : "CONNECTING");
    this.badge.className = `lr-badge${live ? " lr-live" : " lr-delayed"}`;
    const helicount = all.filter(a => a.helicopter).length;
    this.summary.textContent = `${visible.length} ${this.helicoptersOnly ? "HELICOPTERS" : "AIRCRAFT"} IN RANGE${this.helicoptersOnly ? "" : ` · ${helicount} HELICOPTERS`}`;

    this.rows.replaceChildren();
    const maxRows = Math.max(0, Number(this.config.maxFlights) || 0);
    const tableAircraft = visible.slice(0, maxRows);
    const selectedAircraft = visible.find(a => a.hex === selectedHex);
    if (maxRows > 0 && selectedAircraft && !tableAircraft.some(a => a.hex === selectedHex)) {
      tableAircraft[maxRows - 1] = selectedAircraft;
    }
    for (const a of tableAircraft) {
      const age = Math.max(0, Math.floor((now - a.positionAt) / 1000));
      const row = this.element("div", `lr-row${a.helicopter ? " lr-row-heli" : ""}${age > this.config.staleAfter ? " lr-row-old" : ""}${a.hex === selectedHex ? " lr-row-selected" : ""}`);
      row.dataset.aircraft = a.hex;
      const identity = this.element("div", "lr-identity");
      identity.append(this.element("span", "lr-callsign", this.label(a)), this.element("span", "lr-type", `${a.helicopter ? "HELI · " : ""}${a.type || "TYPE UNKNOWN"}`));
      const alt = a.altitude === null ? "—" : `${Math.round(a.altitude).toLocaleString()} ft`;
      const speed = a.speed === null ? "—" : `${Math.round(a.speed)} kt`;
      row.append(identity, this.element("span", "lr-altitude", alt), this.element("span", "lr-speed", speed), this.element("span", "lr-distance", `${a.distance.toFixed(1)} mi`), this.element("span", "lr-age", `${age}s`));
      this.rows.append(row);
      if (a.hex === selectedHex && this.scrollSelection) {
        const rowTop = row.offsetTop - this.rows.offsetTop;
        if (rowTop < this.rows.scrollTop) this.rows.scrollTop = rowTop;
        else if (rowTop + row.offsetHeight > this.rows.scrollTop + this.rows.clientHeight) this.rows.scrollTop = Math.max(0, rowTop + row.offsetHeight - this.rows.clientHeight);
      }
    }
    this.scrollSelection = false;
    if (!visible.length) this.rows.append(this.element("div", "lr-empty", !this.packet ? "Waiting for aircraft data…" : "No recent positions in range"));
    const ageText = this.packet ? `Feed age ${Math.floor(feedAge)}s · Latest fetch ${Math.max(0, Math.floor((now - this.packet.receivedAt) / 1000))}s ago` : this.status.message;
    this.note.textContent = connected ? ageText : `${this.status.message}${this.packet ? ` · ${ageText}` : ""}`;
    if (this.tileError) this.note.textContent += " · Background map tiles unavailable";
    if (!this.map) return;

    const active = new Set(visible.map(a => a.hex));
    for (const [hex, marker] of this.markers) if (!active.has(hex)) { marker.remove(); this.markers.delete(hex); }
    for (const [hex, line] of this.trails) if (!active.has(hex)) { line.remove(); this.trails.delete(hex); }
    visible.forEach((a, index) => {
      const age = Math.max(0, (now - a.positionAt) / 1000);
      const stale = age > this.config.staleAfter;
      let marker = this.markers.get(a.hex);
      if (!marker) {
        marker = L.marker([a.lat, a.lon], { icon: this.icon(a, stale), keyboard: true }).addTo(this.map);
        marker.lrHelicopter = a.helicopter;
        this.markers.set(a.hex, marker);
        marker.on("mouseover", () => this.setHoveredAircraft(a.hex));
        marker.on("mouseout", () => { if (this.hoveredHex === a.hex) this.setHoveredAircraft(null); });
        marker.on("click", () => {
          this.pinnedHex = this.pinnedHex === a.hex ? null : a.hex;
          this.scrollSelection = Boolean(this.pinnedHex);
          this.renderData();
        });
      } else {
        marker.setLatLng([a.lat, a.lon]);
        if (marker.lrHelicopter !== a.helicopter) {
          marker.setIcon(this.icon(a, stale));
          marker.lrHelicopter = a.helicopter;
        }
      }
      const selected = a.hex === selectedHex;
      const markerNode = marker.getElement();
      if (markerNode) {
        markerNode.classList.toggle("lr-old", stale);
        markerNode.classList.toggle("lr-selected", selected);
        const svg = markerNode.querySelector("svg");
        if (svg) svg.style.transform = `rotate(${a.heading ?? 0}deg) scale(${selected ? 1.25 : 1})`;
      }
      marker.setZIndexOffset(selected ? 2000 : 0);
      const details = this.aircraftCard(a, age);
      if (marker.getPopup()) marker.setPopupContent(details);
      else marker.bindPopup(details, { className: "lr-map-popup", minWidth: 300, maxWidth: 460 });
      if (selected || (this.config.showLabels && index < this.config.maxLabels)) {
        const content = selected ? this.aircraftCard(a, age) : this.element("span", "", this.label(a));
        if (!marker.getTooltip()) marker.bindTooltip(content, { permanent: true, direction: "auto", offset: [10, 0], className: "lr-label" });
        else marker.setTooltipContent(content);
        const tooltipNode = marker.getTooltip().getElement();
        if (tooltipNode) {
          tooltipNode.classList.toggle("lr-old", stale);
          tooltipNode.classList.toggle("lr-hover-label", selected);
          tooltipNode.style.zIndex = selected ? "1000" : "";
        }
        const point = this.map.latLngToContainerPoint([a.lat, a.lon]);
        const edge = Math.max(180, (tooltipNode?.offsetHeight || 0) / 2 + 16);
        marker.getTooltip().options.direction = selected && point.y < edge ? "bottom" : selected && point.y > this.map.getSize().y - edge ? "top" : "auto";
        marker.getTooltip().update();
      } else if (marker.getTooltip()) marker.unbindTooltip();
      const points = (this.histories.get(a.hex) || []).filter(p => p.at >= now - (Number(this.config.trailMinutes) || 3) * 60000);
      if (this.config.showTrails && points.length > 1) {
        const coordinates = points.map(p => [p.lat, p.lon]);
        let line = this.trails.get(a.hex);
        if (!line) { line = L.polyline(coordinates, { weight: selected ? 3 : 1.5, color: a.helicopter ? "#ffbf69" : "#8cf1df", opacity: selected ? 0.9 : stale ? 0.2 : 0.5, interactive: false }).addTo(this.map); this.trails.set(a.hex, line); }
        else { line.setLatLngs(coordinates); line.setStyle({ weight: selected ? 3 : 1.5, opacity: selected ? 0.9 : stale ? 0.2 : 0.5 }); }
      } else if (this.trails.has(a.hex)) { this.trails.get(a.hex).remove(); this.trails.delete(a.hex); }
    });
  },

  suspend() { clearInterval(this.clock); },
  resume() {
    clearInterval(this.clock);
    this.clock = setInterval(() => { if (this.root) this.renderData(); }, 1000);
    if (this.map) this.map.invalidateSize({ animate: false });
  }
});
