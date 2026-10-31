# GeoFS Holding Pattern

**Fly a proper ICAO racetrack hold in GeoFS, hands-off.** Pick an FMC waypoint, set the inbound course, and the autopilot flies the entry, the turns, the legs and the exit, wind included.

[**Install (one click)**](https://raw.githubusercontent.com/nafeesnazzim/geofs-holding-pattern/main/geofs-holding-pattern.user.js) · needs [Tampermonkey](https://www.tampermonkey.net/) (or another userscript manager)

![A British Airways Landor 747-8i in a clean side profile at sunrise](docs/closeup-side-profile.jpg)

![The same jet flying away over the English countryside](docs/closeup-landor-over-countryside.jpg)

**The panel in action:** inside the 747-8i cockpit mid-hold, then after a clean exit.

![Cockpit view of the 747-8i in the hold, with the Hold panel open](docs/cockpit-hold.jpg)

![Hold panel after a clean exit: Left the hold at HOLDX, NAV to next waypoint](docs/hud-clean-exit.jpg)

## Features

- **Any FMC waypoint** as the hold fix, chosen from a dropdown. It defaults to the next waypoint ahead and stays on your pick if you edit the plan.
- **Chart courses as printed:** the inbound course is magnetic. A built-in World Magnetic Model (WMM2025) converts it to the true headings GeoFS flies, and shows the true value beside it.
- **Auto inbound course:** filled in from the route's track into the fix (marked RTE). Type over it whenever ATC gives you something else.
- **Presets:** STD (ICAO timing, right turns), 2' and 5NM in one tap.
- **All three entries:** direct, teardrop and parallel, picked automatically from your arrival track. Left- and right-hand holds.
- **Standard-rate turns** (3°/s, or 25° bank if that is lower) by steering the heading bug.
- **Follows your route:** with the autopilot on NAV it keeps flying the flight plan and takes over on HDG just before GeoFS would move NAV on to the next waypoint (inside about 30 s or 1.5 NM at low level, about 7 NM at FL350). Waypoints on the way are not skipped, and the distance and ETA are measured along the route.
- **Wind drift correction** on every leg, with the outbound time trimmed from the measured inbound leg so you actually arrive on time.
- **Leg:** AUTO (1 min up to 14 000 ft, 1.5 min above), 0.5-5 min, or a distance such as `5NM`.
- **EFC time (UTC HHMM):** optional expect-further-clearance clock.
- **ICAO maximum holding speed** shown, and applied about 3 minutes before the fix (230 kt up to 14 000 ft, 240 kt to 20 000 ft, 265 kt to 34 000 ft, M0.83 above). Your old speed is restored on exit. Under **More options** you can enter the chart's own **MAX SPD** (it can only lower the ICAO limit) and a **MIN ALT** (FL90 or 9000) that warns you if you are below it.
- **Hold here:** pick **Present position** in the fix list to hold right where you are. The course defaults to your heading.
- **Remembers each fix:** course, turns, leg, speed and altitude are refilled when you pick the fix again (marked MEM).
- **Live AP ALT and AP SPEED** while holding, with − / + steppers. Click a number to type it (9000 or FL90, 220 or M.78).
- **Lap counter and time in the hold**, and the **hold drawn on the GeoFS map**.
- **EFC warning:** amber 5 minutes before, red at EFC.
- **GeoFS-proof altitude and speed:** GeoFS copies a waypoint's altitude and speed into the autopilot whenever NAV moves on, a waypoint is clicked or one is deleted. The hold puts them back at once. When you leave, a next waypoint at 0 ft (usually the airport) does not send you into the ground: your altitude is kept and you are told to set the descent.
- **Amber warnings** for a fix behind you, an autopilot speed that is not in knots (your speed mode is never changed), and flying below the minimum altitude.
- **Clean exit:** crosses the fix inbound, then re-engages NAV to the next waypoint with no speed dip. Pressed EXIT by mistake? Press it again to cancel. **LEAVE NOW** leaves straight away, direct to the next waypoint.
- **Sleek avionics-style panel** with a live racetrack diagram that tracks your aircraft. Three sizes (S, M, L) and soft chimes with a mute button. Drag it anywhere. Units: kt, ft, NM.
- **Keys:** **Shift+J** enters the hold, arms the exit or cancels it. **Shift+H** cycles full panel, slim pill and hidden (the hold keeps running). GeoFS never sees these keys, so they do not trigger its own H and J.

## Install

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Click **[this link](https://raw.githubusercontent.com/nafeesnazzim/geofs-holding-pattern/main/geofs-holding-pattern.user.js)** and press **Install**.
3. Open [GeoFS](https://www.geo-fs.com/geofs.php). A **HOLD** panel appears on the right.

Updates arrive automatically through Tampermonkey.

## How to use

1. Load a flight plan in the GeoFS FMC and turn the autopilot on.
2. In the HOLD panel, choose the **FIX** (a waypoint from your plan).
3. Check the **INBOUND °M** course (the course you fly *to* the fix, magnetic, as on the chart). It is pre-filled from your route; type over it if ATC or the chart says otherwise.
4. Choose **R** or **L** turns.
5. Tap a preset, or leave **LEG** empty for AUTO, or type minutes (0.5-5) or a distance such as `5NM`.
6. Optionally enter the **EFC** as UTC HHMM.
7. Press **ENTER HOLD** (or Shift+J). Keep the autopilot on NAV: the panel shows "Armed, following route" and an ETA until the fix, then flies the hold. The panel shows status, timer, wind correction, speed and EFC.
8. Press **EXIT HOLD** (the same button, or Shift+J) when you are cleared. You leave the hold at the fix and NAV resumes towards the next waypoint. **LEAVE NOW** goes straight to the next waypoint instead.

Turning the autopilot off cancels the hold.

## Entry types

![Entry sectors for a right-hand hold](docs/entry-sectors.svg)

- **Direct:** turn onto the hold outbound at the fix.
- **Teardrop:** fly outbound 30° off the outbound track, then turn back to the inbound course.
- **Parallel:** fly the outbound track, then turn back and rejoin the inbound course.

## Tested

Flown live in GeoFS and simulated (thousands of randomised runs plus edge cases):

| Aircraft | Notes |
|---|---|
| Boeing 737-700 | direct entry, 39 kt crosswind with turbulence |
| Airbus A380 | left teardrop at FL280 |
| Airbus A350 | Mach mode at FL360, left parallel |
| Boeing 777-300ER, 787-8 | right entries |
| Boeing 747-8i | hold flown after a livery swap, clean exit |
| Embraer E190 | left teardrop |
| Cessna 172 | low and slow |

Max bank stayed at or under about 24° in all flights.

Version 1.6.0 was also flown in real GeoFS (its own physics and autopilot, driven headless) through a NAV approach, a 0 ft / 160 kt airport waypoint, a waypoint deleted mid-hold, LEAVE NOW, a reset mid-hold, simulation speed x2 and a magnetic present-position hold.

## Known limits

- Courses are magnetic (chart) courses. The GeoFS flight plan list shows true tracks: if you copy a number from there, it will be off by the local variation (about 2° around Sri Lanka, 1° around London, up to 15° or more elsewhere).
- The magnetic model (WMM2025) is valid until 2030.

- Tested with winds up to about 40 kt, the most the GeoFS slider allows.
- Sluggish heavy aircraft (such as the A380) take about 30 s to roll into the turn. This is deliberate, to keep bank safe.
- Editing the flight plan while the hold is still armed (before the fix) can confuse the route distance: press EXIT HOLD and enter it again. Edits during the hold are fine, the exit finds the fix again.
- The NAV to HDG handover uses the waypoint-switching rule read from the GeoFS code and was verified in simulation; please report any aircraft where it turns early or late.
- Not every aircraft was re-flown on the latest version.
- Written for GeoFS as it is today. A GeoFS update may break it; please open an issue if so.

## Feedback

Found a bug? [Open an issue](https://github.com/nafeesnazzim/geofs-holding-pattern/issues) with your aircraft, altitude, wind and what happened.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## Licence

[MIT](LICENSE) © Nuffy. Not affiliated with GeoFS.
