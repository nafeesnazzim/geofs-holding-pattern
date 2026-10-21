# Changelog

## 1.2.2
- Added the GeoFS icon to the Tampermonkey script entry.

## 1.2.1
- Above FL340 in Mach mode the hold now sets M0.83 (ICAO max holding speed).
- The entry label (direct / teardrop / parallel) clears after the first circuit.

## 1.2.0
- Bank-regulated turn controller with a learned turn-rate gain (fixes over-fast turns in light aircraft such as the Cessna 172).
- Smoother, safer roll-in on slow-rolling aircraft (E190, A380).

## 1.1.x
- Reads true airspeed from the sim (GeoFS "kias" is not ISA-correct).
- Exit re-engages NAV with selectWaypoint (no speed dip).
- Outbound-time trim from measured inbound error.

## 1.0
- First release: ICAO racetrack hold from any FMC waypoint, all entries, wind correction, HUD panel.
