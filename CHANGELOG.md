# Changelog

## 1.6.0
Fixes (found by reading GeoFS's own code and flying the script in real GeoFS):
- Fixed: pressing EXIT before a waypoint with altitude 0 (usually the airport) sent the autopilot to 0 ft, and the aircraft started to descend. The exit now keeps the hold altitude and tells you to set your descent. Real altitudes on the next waypoint are still followed. Text GeoFS cannot read in the altitude box is treated the same as 0.
- Fixed: Shift+H also triggered GeoFS's own H key, which cycles the whole GeoFS interface. GeoFS ignores Shift, so the script now catches its keys first and GeoFS never sees them.
- Fixed: a waypoint's speed (for example 160 kt on the airport) was copied into the autopilot during the hold. Altitude, speed and speed mode are now all put back immediately.
- Fixed: deleting or inserting a waypoint during the hold could let GeoFS change the altitude without the hold noticing. GeoFS renumbers waypoints and re-selects one on a delete, so the hold now follows the waypoint itself, not its number.
- Fixed: "NAV to next waypoint" was shown even when GeoFS could not engage NAV and stayed on HDG. The message now says what really happened.
- Fixed: setting the course while NAV was on quietly dropped GeoFS to its armed "NOR" mode.
- Fixed: with NAV tuned to a radio beacon rather than the flight plan, the hold waited for a fix NAV was not flying to. It now flies direct to the fix, with a warning.
- Fixed: starting from a GeoFS glide path (VNAV) held a stale altitude. The hold now keeps the level you are actually flying.
- Fixed: timings ignored GeoFS's simulation speed. The clock now uses GeoFS's own frame times.
- Fixed: a reset or new location during the hold left it steering for the old fix. The hold now cancels with a message.
- Fixed: the EFC countdown could show 60 seconds, and an EFC just before midnight counted almost a day ahead.
- Removed an unused fallback that would have teleported the aircraft (GeoFS's gotoWaypoint).
- Installing the script twice no longer gives two panels.

New:
- **Magnetic courses:** type the chart course as printed. A built-in World Magnetic Model (WMM2025) converts it to GeoFS's true headings, and the true value is shown next to it.
- **Auto inbound course:** filled in from the route's track into the fix (RTE), or your heading for present position (HDG). Type over it at any time.
- **Smarter fix pick:** defaults to the next waypoint ahead and stays on your waypoint when the plan is edited.
- **Presets:** STD (ICAO auto timing, right turns), 2' and 5NM.
- **Shift+J** enters the hold, arms the exit, or cancels an armed exit.
- **LEAVE NOW:** leave the hold straight away, NAV direct to the next waypoint.
- **EXIT armed by mistake?** Press it again to cancel.
- **Live AP ALT and AP SPEED** with − / + steppers (1 000 ft, 10 kt or M.01). Click the number to type one. Speed is capped at the holding limit.
- **Lap counter and time in the hold.**
- **The hold is drawn on the GeoFS map,** scaled to your real turn radius and leg length.
- **EFC warning:** amber at 5 minutes to go, red at EFC, with a flash and a chime.
- **Chimes** for entering and leaving the hold, GeoFS altitude changes being put back, and EFC. A speaker button mutes them.
- **Panel size:** S, M or L, from the header.
- While holding, the setup fields are hidden, so the panel is shorter.

## 1.5.1
- Fixed: the aircraft could dive into the ground when the hold fix was followed by a waypoint with altitude 0 (the airport). GeoFS copies each waypoint's altitude into the autopilot as it moves on. The hold now remembers the autopilot altitude when it takes over and puts it back whenever GeoFS changes it, with an amber note. An altitude you set by hand during the hold becomes the new hold altitude.

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
