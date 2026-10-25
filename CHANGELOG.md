# Changelog

## 1.5.0
- The approach now follows GeoFS's own waypoint rule. NAV moves on to the next waypoint once it is closer than DMEMargin x altitude (about 6 NM at FL350), so the hold takes over just outside that distance, before NAV turns away from the fix.
- The distance and ETA to the fix are measured along the route, not in a straight line. A route that doubles back no longer hands over early.
- A fix that is already behind you on the route is refused. If the route moves past the fix while armed, the hold is cancelled with a message.
- New "More options": MAX SPD (a chart limit, which can only lower the ICAO limit) and MIN ALT (FL90 or 9000). An amber warning appears below the minimum altitude.
- Amber warning when the autopilot speed is not in knots. The hold never changes your speed mode.
- The leg can be a distance: type 5NM instead of minutes, and the panel counts down in NM.
- New "Present position" entry in the fix list: hold right here, right now. The course defaults to your heading.
- The settings you used for each fix are remembered and refilled when you pick it again.

## 1.4.0
- The hold now follows your flight plan: with the autopilot on NAV it stays on NAV until about 30 s before the fix, then takes over on HDG. It no longer flies straight to the fix and skips the waypoints in between. If the autopilot is not on NAV it still flies direct, with a warning.
- The ICAO hold speed limit is applied about 3 minutes before the fix instead of the moment you press the button.
- New status while approaching: "Armed, following route", with an ETA to the fix and an ARMED pill. A warning appears if the fix is no longer in the flight plan.
- Exiting before you reach the fix leaves the autopilot on NAV.
- Fixed: expanding the pill at the edge of the screen pushed the panel off screen. It now grows into the screen and shrinks back into the same corner, and it is pulled back on screen if it grows past an edge or the window shrinks.

## 1.3.1
- Shift+H now cycles panel, slim pill and hidden. The hold keeps running while hidden.
- The display state is remembered after a reload.
- Warns when the chosen fix is the last waypoint (you stay on HDG after the exit).
- Shows the distance to the chosen fix while idle.

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
