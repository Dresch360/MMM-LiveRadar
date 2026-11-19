// Replace the EXISTING MMM-LiveRadar entry in config.js with this object.
// Keep MMM-LiveRadar in the existing MMM-pages Page 1 list.
{
 disabled: false,
 classes: "hide",
 module: "MMM-LiveRadar",
 position: "fullscreen_above",
 config: {
    latitude: 34.2098,
    longitude: -118.4900,
    locationLabel: "xxxx",
    rangeMiles: 25,
    updateInterval: 2000,
    layout: "portrait",
    fullscreen: true,
    fullscreenPadding: 24,
    startupZoomOffset: 1,
    zoomLevel: null, // Auto-fit; set an integer from 1 to 19 for a fixed starting zoom.
    maxFlights: 8,
    helicoptersOnly: false,
    showTrails: true,
    showLabels: true,
    useMapTiles: true,
 }
},
