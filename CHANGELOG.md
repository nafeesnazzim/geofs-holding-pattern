# Changelog

## 1.3.0
- Redesigned HOLD panel: glass-cockpit look with a live racetrack diagram that tracks your aircraft and highlights the leg being flown.
- One context-aware button: ENTER HOLD turns into EXIT HOLD while holding.
- Slim status pill (Shift+H or the minus button), draggable, remembers its position.
- Hold logic is unchanged.

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
