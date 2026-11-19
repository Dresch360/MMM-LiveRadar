// Add this object INSIDE the existing modules: [ ... ] array.
// Example map center: Van Nuys Airport. Set your preferred coordinates and label.
{
  module: "MMM-LiveRadar",
  position: "bottom_right",
  config: {
    latitude: 34.2098,
    longitude: -118.4900,
    locationLabel: "xxxx",
    rangeMiles: 25,
    updateInterval: 2000,
    width: 460,
    mapHeight: 380,
    maxFlights: 6,
    helicoptersOnly: false,
    showTrails: true,
    showLabels: true,
    useMapTiles: true
  }
},
