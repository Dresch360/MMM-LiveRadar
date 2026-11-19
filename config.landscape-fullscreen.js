// Replace the EXISTING MMM-LiveRadar entry in config.js with this object.
// Keep MMM-LiveRadar in the existing MMM-pages Page 1 list.
{
 disabled: false,
 classes: "hide",
 module: "MMM-LiveRadar",
 position: "fullscreen_above",
 config: {
    latitude: 34.1683,
    longitude: -118.6059,
    locationLabel: "WOODLAND HILLS",
    rangeMiles: 25,
    updateInterval: 2000,
    layout: "landscape",
    fullscreen: true,
    infoSide: "right", // Change to "left" to move the information panel.
    sidebarWidth: 430,
    fullscreenPadding: 24,
    startupZoomOffset: 1,
    zoomLevel: null, // Auto-fit; set an integer from 1 to 19 for a fixed starting zoom.
    maxFlights: 12,
    helicoptersOnly: false,
    showTrails: true,
    showLabels: true,
    useMapTiles: true,
 }
},
