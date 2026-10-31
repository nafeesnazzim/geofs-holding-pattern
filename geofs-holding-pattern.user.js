// ==UserScript==
// @name         GeoFS Holding Pattern
// @namespace    nuffy.geofs.hold
// @author       Nuffy
// @license      MIT
// @icon         https://www.geo-fs.com/images/icons/favicon.ico
// @icon64       https://www.geo-fs.com/images/icons/apple-touch-icon.png
// @homepageURL  https://github.com/nafeesnazzim/geofs-holding-pattern
// @supportURL   https://github.com/nafeesnazzim/geofs-holding-pattern/issues
// @updateURL    https://raw.githubusercontent.com/nafeesnazzim/geofs-holding-pattern/main/geofs-holding-pattern.user.js
// @downloadURL  https://raw.githubusercontent.com/nafeesnazzim/geofs-holding-pattern/main/geofs-holding-pattern.user.js
// @version      1.6.0
// @description  Flies a real ICAO racetrack hold on any FMC waypoint: sector-based entries, standard-rate turns, wind-corrected tracks, magnetic chart courses, outbound timing trimmed from the inbound leg, NAV re-engaged on exit.
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://geo-fs.com/geofs.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  /* ================= maths ================= */
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const norm360 = a => ((a % 360) + 360) % 360;
  const norm180 = a => { const x = norm360(a); return x > 180 ? x - 360 : x; };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function gcDistNM(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dp = p2 - p1, dl = (lon2 - lon1) * D2R;
    const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * 3440.065 * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function gcBearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return norm360(Math.atan2(y, x) * R2D);
  }
  // flat-earth offset (NM) of a point from a reference; accurate at hold scale
  function localNM(lat, lon, refLat, refLon) {
    return { e: norm180(lon - refLon) * 60 * Math.cos(refLat * D2R), n: (lat - refLat) * 60 };
  }
  // ISA true airspeed from indicated
  function tasFromKias(kias, altFt) {
    const h = altFt * 0.3048;
    const sigma = h < 11000 ? Math.pow(1 - 2.25577e-5 * h, 4.25588) : 0.29708 * Math.exp(-(h - 11000) / 6341.6);
    return kias / Math.sqrt(sigma);
  }

  /* ================= magnetic variation ================= */
  // Charts give magnetic courses; GeoFS flies true headings. WMM2025 (NOAA World Magnetic Model, valid 2025 to 2030), degree 12.
  const WMM = { epoch: 2025.0, c: [-29351.8,0,12,0,-1410.8,4545.4,9.7,-21.5,-2556.6,0,-11.6,0,2951.1,-3133.6,-5.2,-27.7,1649.3,-815.1,-8,-12.1,1361,0,-1.3,0,-2404.1,-56.6,-4.2,4,1243.8,237.5,0.4,-0.3,453.6,-549.5,-15.6,-4.1,895,0,-1.6,0,799.5,278.6,-2.4,-1.1,55.7,-133.9,-6,4.1,-281.1,212,5.6,1.6,12.1,-375.6,-7,-4.4,-233.2,0,0.6,0,368.9,45.4,1.4,-0.5,187.2,220.2,0,2.2,-138.7,-122.9,0.6,0.4,-142,43,2.2,1.7,20.9,106.1,0.9,1.9,64.4,0,-0.2,0,63.8,-18.4,-0.4,0.3,76.9,16.8,0.9,-1.6,-115.7,48.8,1.2,-0.4,-40.9,-59.8,-0.9,0.9,14.9,10.9,0.3,0.7,-60.7,72.7,0.9,0.9,79.5,0,-0,0,-77,-48.9,-0.1,0.6,-8.8,-14.4,-0.1,0.5,59.3,-1,0.5,-0.8,15.8,23.4,-0.1,0,2.5,-7.4,-0.8,-1,-11.1,-25.1,-0.8,0.6,14.2,-2.3,0.8,-0.2,23.2,0,-0.1,0,10.8,7.1,0.2,-0.2,-17.5,-12.6,0,0.5,2,11.4,0.5,-0.4,-21.7,-9.7,-0.1,0.4,16.9,12.7,0.3,-0.5,15,0.7,0.2,-0.6,-16.8,-5.2,-0,0.3,0.9,3.9,0.2,0.2,4.6,0,-0,0,7.8,-24.8,-0.1,-0.3,3,12.2,0.1,0.3,-0.2,8.3,0.3,-0.3,-2.5,-3.3,-0.3,0.3,-13.1,-5.2,0,0.2,2.4,7.2,0.3,-0.1,8.6,-0.6,-0.1,-0.2,-8.7,0.8,0.1,0.4,-12.9,10,-0.1,0.1,-1.3,0,0.1,0,-6.4,3.3,0,0,0.2,0,0.1,-0,2,2.4,0.1,-0.2,-1,5.3,-0,0.1,-0.6,-9.1,-0.3,-0.1,-0.9,0.4,0,0.1,1.5,-4.2,-0.1,0,0.9,-3.8,-0.1,-0.1,-2.7,0.9,-0,0.2,-3.9,-9.1,-0,-0,2.9,0,0,0,-1.5,0,-0,-0,-2.5,2.9,0,0.1,2.4,-0.6,0,-0,-0.6,0.2,0,0.1,-0.1,0.5,-0.1,-0,-0.6,-0.3,0,-0,-0.1,-1.2,-0,0.1,1.1,-1.7,-0.1,-0,-1,-2.9,-0.1,0,-0.2,-1.8,-0.1,0,2.6,-2.3,-0.1,0,-2,0,0,0,-0.2,-1.3,0,-0,0.3,0.7,-0,0,1.2,1,-0,-0.1,-1.3,-1.4,-0,0.1,0.6,-0,-0,-0,0.6,0.6,0.1,-0,0.5,-0.1,-0,-0,-0.1,0.8,0,0,-0.4,0.1,0,-0,-0.2,-1,-0.1,-0,-1.3,0.1,-0,0,-0.7,0.2,-0.1,-0.1] };
  // declination in degrees, + = east (true = magnetic + variation)
  function magVar(latDeg, lonDeg, altKm, year) {
    const N = 12, a = 6371.2, A = 6378.137, fl = 1 / 298.257223563, e2 = fl * (2 - fl), dt = year - WMM.epoch;
    const phi = latDeg * D2R, lam = lonDeg * D2R;
    const Rc = A / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);   // geodetic to geocentric
    const p = (Rc + altKm) * Math.cos(phi), z = (Rc * (1 - e2) + altKm) * Math.sin(phi);
    const r = Math.hypot(p, z), phis = Math.asin(z / r), x = Math.sin(phis), cx = Math.cos(phis);
    const P = [], dP = [];
    for (let n = 0; n <= N; n++) { P.push(new Array(N + 1).fill(0)); dP.push(new Array(N + 1).fill(0)); }
    P[0][0] = 1;
    for (let n = 1; n <= N; n++) for (let m = 0; m <= n; m++) {   // Schmidt semi-normalised Legendre functions
      if (n === m) {
        const k = n === 1 ? 1 : Math.sqrt((2 * n - 1) / (2 * n));
        P[n][m] = k * cx * P[n - 1][m - 1]; dP[n][m] = k * (cx * dP[n - 1][m - 1] + x * P[n - 1][m - 1]);
      } else {
        const k1 = (2 * n - 1) / Math.sqrt(n * n - m * m), k2 = n - 2 >= m ? Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m)) : 0;
        P[n][m] = k1 * x * P[n - 1][m] - (k2 ? k2 * P[n - 2][m] : 0);
        dP[n][m] = k1 * (x * dP[n - 1][m] - cx * P[n - 1][m]) - (k2 ? k2 * dP[n - 2][m] : 0);
      }
    }
    let Bx = 0, By = 0, Bz = 0, i = 0;
    for (let n = 1; n <= N; n++) {
      const ar = Math.pow(a / r, n + 2);
      for (let m = 0; m <= n; m++, i++) {
        const g = WMM.c[i * 4] + dt * WMM.c[i * 4 + 2], h = WMM.c[i * 4 + 1] + dt * WMM.c[i * 4 + 3];
        const cm = Math.cos(m * lam), sm = Math.sin(m * lam);
        Bx += ar * (g * cm + h * sm) * dP[n][m]; By += ar * m * (g * sm - h * cm) * P[n][m]; Bz -= (n + 1) * ar * (g * cm + h * sm) * P[n][m];
      }
    }
    if (Math.abs(cx) > 1e-10) By /= cx;
    const psi = phis - phi;
    return Math.atan2(By, Bx * Math.cos(psi) - Bz * Math.sin(psi)) * R2D;
  }
  const decYear = d => { const y = d.getUTCFullYear(), s = Date.UTC(y, 0, 1); return y + (d.getTime() - s) / (Date.UTC(y + 1, 0, 1) - s); };

  /* ================= ICAO tables ================= */
  // PANS-OPS Doc 8168: maximum IAS in the hold, normal conditions
  function maxHoldSpeed(altFt) {
    if (altFt <= 14000) return { kt: 230, label: '230 kt' };
    if (altFt <= 20000) return { kt: 240, label: '240 kt' };
    if (altFt <= 34000) return { kt: 265, label: '265 kt' };
    return { kt: null, label: 'M0.83' };
  }
  // 1 min up to and including 14 000 ft, 1.5 min above
  const legTimeAuto = altFt => (altFt > 14000 ? 90 : 60);

  // Entry sector from the track flown into the fix. Right-hand pattern:
  // direct 290..110 (180 deg), teardrop 110..180 (70 deg), parallel 180..290 (110 deg).
  // Left-hand patterns are the mirror image.
  function classifyEntry(arrivalTrack, ic, dir) {
    const th = norm360(dir > 0 ? arrivalTrack - ic : ic - arrivalTrack);
    if (th <= 110 || th >= 290) return 'DIRECT';
    if (th <= 180) return 'TEARDROP';
    return 'PARALLEL';
  }

  /* ================= hold engine (pure logic, no GeoFS calls) ================= */
  class HoldCore {
    constructor(io) { this.io = io; this.reset(); }

    reset() {
      this.phase = 'IDLE'; this.entry = null; this.fix = null; this.ic = 0; this.dir = 1;
      this.legOverrideS = null; this.exitRequested = false; this.msg = '';
      this.outTime = 60; this.timerStart = 0; this.timerRunning = false; this.establishedAt = 0;
      this.trimPrev = null; this.bankPerDeg = 1; this.bankRate = 0; this.prevBank = null; this.rateGain = 1; this.speedModeSet = null; this.inStart = 0; this.inboundTimed = false; this.entryPending = false; this.turnInDir = 1;
      this.samples = []; this.trk = null; this.gs = 0; this.rate = 0; this.prevHdg = null;
      this.lastT = null; this.dt = 0; this.lead = 12; this.tas = 150;
      this.wind = { e: 0, n: 0, valid: false };
      this.approachTrack = null; this.lastAlong = null; this.lastInboundErr = null;
      this.outGs = { s: 0, t: 0 }; this.inGs = { s: 0, t: 0 };   // ground-speed integrals for the timing trim
      this.leadPhase = null; this.phaseT = 0; this.baseLeg = 0; this.lastSetSpeed = 0;
      this.savedSpeed = 0; this.speedChanged = false; this.speedNote = ''; this.lastSpeedT = -99;
      this.s = null; this.geo = null; this.cmdHdg = null;
      this.navApproach = false; this.warn = ''; this.route = null;
      this.maxKt = null; this.minAltFt = null; this.minAltLabel = ''; this.legNM = null; this.speedWarn = ''; this.altWarn = '';
      this.holdAlt = null; this.altNote = ''; this.altNoteT = -1e9; this.trackedPrev = null; this.trackChangeT = -1e9;
      this.laps = 0; this.holdStartT = null; this.lastPos = null; this.ownSelect = false; this.magVar = 0;
    }

    trackedNow() { return this.io.trackedObj ? this.io.trackedObj() : (this.io.tracked ? this.io.tracked() : null); }

    // UI events (chimes); the panel drains this queue
    emit(e) { (this.events || (this.events = [])).push(e); }

    // seconds to the fix at the current ground speed (true airspeed until the ground speed is measured), along the route when it is known
    etaFix() { const d = this.route && this.route.known ? this.route.dist : this.geo.d; return d / (this.gs > 15 ? this.gs : (this.tas || 150)) * 3600; }

    // Where the aircraft is on the flight plan: the distance to the fix along the route, and whether the fix is already behind.
    // GeoFS's own NAV flies to trackedWaypoint and moves on to the next one when it is closer than switchNM.
    routeInfo() {
      const io = this.io, g = this.geo, none = { known: false, dist: g.d, behind: false, tracked: -1, idx: -1 };
      if (!io.tracked || !io.plan || this.fix.ppos) return none;
      const idx = io.findFix ? io.findFix(this.fix) : this.fix.index, tr = io.tracked(), plan = io.plan();
      if (idx < 0 || tr < 0 || !plan[tr] || !plan[idx]) return none;
      if (tr > idx) return { known: true, dist: g.d, behind: true, tracked: tr, idx };
      let dist = gcDistNM(this.s.lat, this.s.lon, plan[tr].lat, plan[tr].lon);
      for (let i = tr; i < idx; i++) dist += gcDistNM(plan[i].lat, plan[i].lon, plan[i + 1].lat, plan[i + 1].lon);
      return { known: true, dist, behind: false, tracked: tr, idx };
    }

    // ICAO table, lowered to the chart's own limit when one was entered
    speedLimit(altFt) {
      const m = maxHoldSpeed(altFt), user = this.maxKt;
      const kt = m.kt == null ? user : (user ? Math.min(m.kt, user) : m.kt);
      return { kt, label: kt != null ? kt + ' kt' : m.label };
    }

    legTime(altFt) { return this.legOverrideS || legTimeAuto(altFt); }

    start(cfg) {
      if (this.phase !== 'IDLE') return { ok: false, err: 'Hold already active: press EXIT HOLD first' };
      const ap = this.io.ap();
      if (!ap.on) return { ok: false, err: 'Engage the autopilot first' };
      if (!cfg.fix) return { ok: false, err: 'No holding fix selected' };
      const s = this.io.read();
      this.reset();
      this.fix = cfg.fix; this.ic = norm360(cfg.ic); this.dir = cfg.dir >= 0 ? 1 : -1; this.magVar = cfg.magVar || 0;
      this.legOverrideS = cfg.legOverrideS || null;
      this.legNM = cfg.legNM || null; this.maxKt = cfg.maxKt || null;
      this.minAltFt = cfg.minAltFt || null; this.minAltLabel = cfg.minAltLabel || (cfg.minAltFt ? cfg.minAltFt + ' ft' : '');
      this.savedSpeed = ap.speed || 0; this.savedMode = ap.speedMode;
      const ppos = !!this.fix.ppos;   // "hold here": the fix is where the aircraft is now
      // NAV only leads to the fix when it is flying the flight plan, not a radio beacon tuned by hand
      const navPlan = ap.mode === 'NAV' && (!this.io.navIsPlan || this.io.navIsPlan());
      if (navPlan && !ppos) {
        // refuse a fix that is already behind the aircraft on the route
        if (this.io.tracked && this.io.plan) {
          const idx = this.io.findFix ? this.io.findFix(this.fix) : this.fix.index;
          if (idx >= 0 && this.io.tracked() > idx) { this.reset(); return { ok: false, err: 'That fix is behind you on the route: pick a waypoint ahead' }; }
        }
        // keep following the flight plan: HDG is taken over only just before the fix
        this.navApproach = true;
      } else {
        this.io.setCourse(Math.round(s.hdg));
        this.io.setMode('HDG');
        if (this.io.ap().mode !== 'HDG') { this.reset(); return { ok: false, err: 'Could not switch autopilot to HDG' }; }
        if (!ppos) this.warn = ap.mode === 'NAV' ? 'NAV is on a radio beacon, not the flight plan: flying direct to the fix' : 'Autopilot was not on NAV: flying direct to the fix';
        this.lockAlt(s, ap.vnav);
      }
      this.outTime = this.legTime(s.altFt);
      this.baseLeg = this.outTime;
      this.phase = 'APPROACH';
      if (ppos) {   // already at the fix: go straight into the entry for the heading we are flying
        this.entry = classifyEntry(s.hdg, this.ic, this.dir);
        this.entryPending = this.entry !== 'DIRECT';
        this.phase = { DIRECT: 'TURN_OUT', TEARDROP: 'TD_TURN', PARALLEL: 'PAR_TURN' }[this.entry];
        this.holdStartT = this.io.now(); this.emit('enter');
      }
      this.trackedPrev = this.trackedNow();   // a waypoint change before this is not GeoFS moving on
      return { ok: true };
    }

    // GeoFS's selectWaypoint() copies the waypoint's altitude and speed into the autopilot. The glue calls these two around every
    // call: while the hold owns the aircraft (or the route is about to move past the fix), whatever GeoFS changed is put back.
    beforeSelect(i) {
      if (this.phase === 'IDLE' || this.ownSelect) return null;
      if (this.phase === 'APPROACH' && this.navApproach && !this.fix.ppos) {
        const idx = this.io.findFix ? this.io.findFix(this.fix) : this.fix.index;
        if (!(idx >= 0 && i > idx)) return null;   // waypoints before the fix: the route's own altitudes and speeds apply
      }
      const ap = this.io.ap();
      return { alt: this.io.apAlt ? this.io.apAlt() : null, spd: ap.speed, mode: ap.speedMode };
    }
    afterSelect(g) {
      if (!g) return;
      const ap = this.io.ap();
      if (this.io.apAlt && this.io.setAlt && g.alt > 0 && this.io.apAlt() !== g.alt) {
        this.io.setAlt(g.alt);
        this.altNote = 'GeoFS changed the altitude: kept ' + Math.round(g.alt) + ' ft'; this.altNoteT = this.lastT == null ? 0 : this.lastT; this.emit('alt');
      }
      if (this.io.setSpeedMode && g.mode && ap.speedMode !== g.mode) this.io.setSpeedMode(g.mode);
      if (g.spd > 0 && this.io.ap().speed !== g.spd) this.io.setSpeed(g.spd);
    }

    requestExit() {
      if (this.phase === 'IDLE') return;
      if (this.phase === 'APPROACH') { // not yet in the hold
        if (this.navApproach) this.finish('Hold cancelled, still following the route');
        else if (this.fix.ppos) this.finish('Hold cancelled, autopilot left on HDG');
        else {
          this.io.setMode('NAV');
          this.finish(this.io.ap().mode === 'NAV' ? 'Hold cancelled, NAV direct to ' + (this.fix.ident || 'fix') : 'Hold cancelled. NAV would not engage (no NAV source): autopilot left on HDG');
        }
        return;
      }
      this.exitRequested = !this.exitRequested;   // pressing again cancels an armed exit
      if (!this.exitRequested) this.msg = '';
    }

    // ATC "leave the hold now": straight on to the next waypoint from wherever the aircraft is
    leaveNow() {
      if (this.phase === 'IDLE') return;
      if (this.phase === 'APPROACH') return this.requestExit();
      this.finishExit(true);
    }

    abort(msg) { this.finish(msg); }

    finish(msg) {
      // give the pilot their speed back, unless they have changed it themselves since we lowered it
      if (this.speedChanged && this.savedSpeed > 0 && this.io.ap().speed === this.lastSetSpeed && this.io.ap().speedMode === this.speedModeSet && this.savedMode === this.speedModeSet) this.io.setSpeed(this.savedSpeed);
      const was = this.phase, ev = this.events;
      this.reset();
      this.events = ev; if (was !== 'APPROACH' && was !== 'IDLE') this.emit('exit');
      this.msg = msg;
    }

    // altitude and speed from the panel: the pilot's own choice, so it becomes the hold's
    setHoldAlt(ft) {
      if (!this.io.setAlt) return;
      ft = clamp(Math.round(ft / 100) * 100, 100, 60000);
      this.io.setAlt(ft); if (this.holdAlt != null) this.holdAlt = ft;
    }
    setHoldSpeed(v) {
      const ap = this.io.ap();
      if (ap.speedMode === 'mach') v = clamp(Math.round(v * 100) / 100, 0.3, 0.99); else v = clamp(Math.round(v), 80, 450);
      this.io.setSpeed(v);
      this.speedChanged = false;   // the pilot set it: do not hand back the old speed on exit
    }

    /* ---- kinematics ---- */
    update(s, t) {
      this.s = s;
      this.dt = this.lastT == null ? 0 : clamp(t - this.lastT, 0, 1);
      this.lastT = t;
      if (this.prevHdg != null && this.dt > 0) {
        const inst = norm180(s.hdg - this.prevHdg) / this.dt;
        this.rate += (inst - this.rate) * Math.min(1, this.dt / 1.0);
      }
      this.prevHdg = s.hdg;
      this.tas = Math.max(60, Number.isFinite(s.tas) ? s.tas : tasFromKias(Number.isFinite(s.kias) ? s.kias : 150, s.altFt));

      this.samples.push({ t, lat: s.lat, lon: s.lon });
      while (this.samples.length > 2 && t - this.samples[1].t >= 1.5) this.samples.shift();
      const old = this.samples[0];
      this.trk = null; this.gs = 0;
      if (t - old.t >= 1.5) {
        const p = localNM(s.lat, s.lon, old.lat, old.lon);
        const dist = Math.hypot(p.e, p.n);
        this.gs = dist / (t - old.t) * 3600;
        if (this.gs > 15 && dist > 0.001) this.trk = norm360(Math.atan2(p.e, p.n) * R2D);
      }
      // wind = ground velocity minus air velocity, only while flying straight
      if (this.trk != null && Math.abs(this.rate) < 1.0 && this.dt > 0) {
        const wE = this.gs * Math.sin(this.trk * D2R) - this.tas * Math.sin(s.hdg * D2R);
        const wN = this.gs * Math.cos(this.trk * D2R) - this.tas * Math.cos(s.hdg * D2R);
        if (!this.wind.valid) this.wind = { e: wE, n: wN, valid: true };
        else {
          const a = Math.min(1, this.dt / 20);
          this.wind.e += (wE - this.wind.e) * a; this.wind.n += (wN - this.wind.n) * a;
        }
      }
      const f = this.fix;
      const d = gcDistNM(s.lat, s.lon, f.lat, f.lon), b = gcBearing(s.lat, s.lon, f.lat, f.lon);
      const p = localNM(s.lat, s.lon, f.lat, f.lon), th = this.ic * D2R;
      this.geo = {
        d, b,
        along: p.e * Math.sin(th) + p.n * Math.cos(th),   // + = beyond the fix on the inbound course
        cross: p.e * Math.cos(th) - p.n * Math.sin(th)    // + = right of the inbound course
      };
      this.route = this.phase === 'APPROACH' ? this.routeInfo() : null;
    }

    // wind correction angle for a desired ground track
    wca(track) {
      if (!this.wind.valid) return 0;
      const th = track * D2R;
      const cross = this.wind.e * Math.cos(th) - this.wind.n * Math.sin(th);
      return Math.asin(clamp(-cross / this.tas, -0.7, 0.7)) * R2D;
    }
    trackHdg(track) { return norm360(track + this.wca(track)); }

    inboundHdg() {
      const ia = clamp(-40 * this.geo.cross, -45, 45);   // intercept angle scales with cross-track error
      return this.trackHdg(this.ic + ia);
    }

    // Slews the heading bug so the actual turn rate is standard rate (3 deg/s),
    // capped at 25 deg bank, whichever needs the lesser bank. Returns degrees still to turn.
    steer(target, forced) {
      const h = this.s.hdg;
      let rem, sign;
      if (forced) { rem = ((forced * (target - h)) % 360 + 360) % 360; if (rem > 340) rem -= 360; sign = forced; }
      else { const e = norm180(target - h); rem = Math.abs(e); sign = e >= 0 ? 1 : -1; }
      const targetRate = Math.min(3, 1091 * Math.tan(25 * D2R) / this.tas);
      // integral action on the measured turn rate. GeoFS banks about 2 deg per deg of heading error (targetBankAngleRatio),
      // so the lead has to be allowed to reach the mid 20s to get standard rate at airliner speeds.
      const bank = this.s.bank, bankKnown = Number.isFinite(bank);
      // only adapt while the aircraft is really moving: a paused sim must not wind the lead up
      // bank trend: the autopilot's roll response lags by a few seconds, so judge the bank the aircraft is heading for
      if (bankKnown && this.dt > 0) {
        const br = this.prevBank == null ? 0 : (bank - this.prevBank) / this.dt;
        this.bankRate += (br - this.bankRate) * Math.min(1, this.dt / 0.8);
        this.prevBank = bank;
      }
      if (this.gs > 15 && rem > this.lead) {
        if (bankKnown) {
          // GeoFS reports the real bank: regulate it directly. Standard rate needs bank = atan(rate*TAS/1091), never more than 23.5 deg (ICAO 25).
          // The look-ahead term cancels the roll lag, so the lead settles without hunting, whatever the aircraft's roll response.
          // learn how much turn rate this aircraft really gives per degree of bank (GeoFS is not exactly the textbook 1091*tan(bank)/TAS), once the bank has settled
          if (Math.abs(this.bankRate) < 1.5 && bank > 8 && Math.abs(this.rate) > 0.5 && this.dt > 0) {
            const phys = 1091 * Math.tan(bank * D2R) / this.tas;
            this.rateGain += (clamp(Math.abs(this.rate) / phys, 0.6, 1.6) - this.rateGain) * Math.min(1, this.dt / 5);
          }
          const bankTarget = Math.min(23.5, Math.atan(targetRate * this.tas / (1091 * this.rateGain)) * R2D);
          const pred = bank + 2.5 * this.bankRate;
          this.lead = clamp(this.lead + 0.05 * (bankTarget - pred) * this.dt, 3, 35);
          if (bank + 1.2 * Math.max(0, this.bankRate) > 24) this.lead = clamp(this.lead * 24 / (bank + 1.2 * Math.max(0, this.bankRate)), 3, 35);
        } else {
          // no bank angle available: integral action on the measured turn rate
          const err = targetRate - sign * this.rate, settled = this.io.now() - this.phaseT > 8;
          if (err < 0 || settled) this.lead = clamp(this.lead + 0.8 * err * this.dt, 3, 35);
        }
      }
      const cmd = rem <= this.lead ? target : h + sign * this.lead;
      this.cmdHdg = norm360(cmd);
      this.io.setCourse(this.cmdHdg);
      return rem;
    }

    // Altitude lock. GeoFS copies each waypoint's altitude into the autopilot as it moves on to it, and the waypoint after the
    // hold fix is often 0 (the airport), which sends the aircraft into the ground. Remember the altitude when the hold takes
    // over and put it back whenever GeoFS changes it; a change the pilot makes by hand becomes the new hold altitude.
    lockAlt(s, vnav) {
      if (!this.io.apAlt || !this.io.setAlt) return;
      const a = this.io.apAlt();
      // under GeoFS VNAV (a glide path to the destination) the altitude setting is stale: hold the level actually flown
      if (a > 0 && !vnav) this.holdAlt = a;
      else { this.holdAlt = Math.max(0, Math.round(s.altFt / 100) * 100); if (this.holdAlt > 0) this.io.setAlt(this.holdAlt); }
    }

    keepAlt(t) {
      if (!this.holdAlt || !this.io.apAlt) return;
      const cur = this.io.apAlt();
      if (!(Math.abs(cur - this.holdAlt) >= 1)) return;
      if (!(cur > 0) || t - this.trackChangeT < 4) {   // GeoFS moved on to the next waypoint (or sent it to 0): put it back
        this.io.setAlt(this.holdAlt);
        this.altNote = 'GeoFS changed the altitude: kept ' + Math.round(this.holdAlt) + ' ft'; this.altNoteT = t; this.emit('alt');
      } else this.holdAlt = cur;   // the pilot changed it
    }

    manageSpeed(s, t) {
      if (t - this.lastSpeedT < 2) return;
      this.lastSpeedT = t;
      const m = this.speedLimit(s.altFt), ap = this.io.ap();
      this.speedNote = 'max ' + m.label; this.speedWarn = '';
      if (m.kt == null) {
        // above FL340 the ICAO limit is Mach 0.83: apply it when the autopilot holds Mach, otherwise leave the pilot to set it
        if (ap.speedMode === 'mach') {
          if (ap.speed > 0.83) { this.io.setSpeed(0.83); this.speedChanged = true; this.lastSetSpeed = 0.83; this.speedModeSet = 'mach'; }
        } else { this.speedNote += ' (set Mach by hand)'; this.speedWarn = 'Set the autopilot speed by hand: Mach 0.83 at most'; }
        return;
      }
      if (ap.speedMode !== 'knots') { this.speedNote += ' (AP not in knots)'; this.speedWarn = 'Autopilot speed is not in knots: set it to ' + m.kt + ' kt or less by hand'; return; }
      if (ap.speed > 0 && ap.speed > m.kt) { this.io.setSpeed(m.kt); this.speedChanged = true; this.lastSetSpeed = m.kt; this.speedModeSet = 'knots'; }
      else if (!(ap.speed > 0) && s.kias > m.kt + 2) { this.speedNote += ' (reduce by hand)'; this.speedWarn = 'Reduce speed to ' + m.kt + ' kt by hand'; }
    }

    /* ---- state machine ---- */
    tick() {
      if (this.phase === 'IDLE') return;
      const ap = this.io.ap();
      if (!ap.on) return this.abort('Autopilot off, hold cancelled');
      if (ap.mode !== (this.phase === 'APPROACH' && this.navApproach ? 'NAV' : 'HDG')) return this.abort('Autopilot mode changed, hold cancelled');
      const t = this.io.now(), s = this.io.read();
      // a reset, a new location or a slew moves the aircraft faster than any aeroplane flies: the hold no longer applies
      if (this.lastPos) {
        const jump = gcDistNM(this.lastPos.lat, this.lastPos.lon, s.lat, s.lon);
        if (jump > Math.max(2, 1500 * Math.max(0, t - this.lastPos.t) / 3600)) return this.abort('The aircraft was moved (reset or new location): hold cancelled');
      }
      this.lastPos = { lat: s.lat, lon: s.lon, t };
      this.update(s, t);
      if (this.dt === 0) return;
      // hold speed is applied about 3 minutes before the fix, like the real thing: no braking at the last moment
      if (this.phase !== 'APPROACH' || this.etaFix() <= 180) this.manageSpeed(s, t);
      else {
        const m = this.speedLimit(s.altFt);
        this.speedNote = 'max ' + m.label;
        this.speedWarn = m.kt != null && ap.speedMode !== 'knots' ? 'Autopilot speed is not in knots: set it to ' + m.kt + ' kt or less by hand' : '';
      }
      // the waypoint object, not its number: deleting or inserting waypoints renumbers them, and GeoFS re-selects on a delete
      { const tr = this.trackedNow(); if (tr !== this.trackedPrev) { this.trackedPrev = tr; this.trackChangeT = t; } }
      this.keepAlt(t);
      this.altWarn = this.minAltFt && s.altFt < this.minAltFt - 150 ? 'Below the minimum holding altitude, ' + this.minAltLabel : (t - this.altNoteT < 12 ? this.altNote : '');
      if (this.phase !== this.leadPhase) { this.leadPhase = this.phase; this.lead = clamp(0.7 * Math.atan(Math.min(3, 1091 * Math.tan(25 * D2R) / this.tas) * this.tas / 1091) * R2D, 3, Number.isFinite(s.bank) ? 8 : 35); this.phaseT = t; }   // every turn starts from a moderate lead
      // watchdog: no phase except the approach may drag on for more than 15 minutes
      if (this.phase !== 'APPROACH' && t - this.phaseT > 900) return this.abort('Hold stalled in ' + this.phase + ', autopilot left on HDG');
      // the leg time depends on the altitude band: rescale the trimmed outbound time if the band changes
      const base = this.legTime(s.altFt);
      if (this.baseLeg && base !== this.baseLeg) this.outTime = clamp(this.outTime * base / this.baseLeg, 5, 400);
      this.baseLeg = base;
      const g = this.geo, O = norm360(this.ic + 180), dir = this.dir;

      switch (this.phase) {
        case 'APPROACH': {
          if (this.navApproach) {
            // NAV flies the route. GeoFS moves NAV on to the next waypoint once it is closer than switchNM (DMEMargin x altitude),
            // so the hold has to take over before that: about 30 s out, or just outside that distance, whichever is first.
            const R = this.route, ref0 = this.trk != null ? this.trk : s.hdg;
            const passed = g.d < 6 && Math.abs(norm180(g.b - ref0)) > 90 && (!R.known || R.tracked >= R.idx);
            if (R.known && R.behind && !passed) return this.abort('The fix is behind you on the route, hold cancelled');
            const sw = this.io.switchNM ? this.io.switchNM() : 0;
            const near = R.known ? (R.tracked === R.idx && g.d <= sw + 0.7) : g.d <= 1.5;
            if (this.etaFix() > 30 && !near && !passed) break;
            this.io.setCourse(Math.round(s.hdg));
            this.io.setMode('HDG');
            if (this.io.ap().mode !== 'HDG') return this.abort('Could not switch autopilot to HDG, hold cancelled');
            this.navApproach = false;
            this.lockAlt(s, ap.vnav);
          }
          if (g.d > 0.5) this.approachTrack = g.b;
          const trk = this.approachTrack != null ? this.approachTrack : g.b;
          this.steer(this.trackHdg(trk), 0);
          const ref = this.trk != null ? this.trk : s.hdg;
          if (g.d < 1.5 && Math.abs(norm180(g.b - ref)) > 90) {
            this.entry = classifyEntry(ref, this.ic, dir);
            this.outTime = this.legTime(s.altFt);
            this.entryPending = this.entry !== 'DIRECT';
            this.phase = { DIRECT: 'TURN_OUT', TEARDROP: 'TD_TURN', PARALLEL: 'PAR_TURN' }[this.entry];
            this.timerRunning = false;
            this.holdStartT = t; this.emit('enter');
          }
          break;
        }
        case 'TURN_OUT': {
          if (this.steer(this.trackHdg(O), dir) <= 3) { this.phase = 'OUTBOUND'; this.timerRunning = false; this.establishedAt = t; }
          break;
        }
        case 'OUTBOUND': {
          this.steer(this.trackHdg(O), 0);
          if (!this.timerRunning) {
            // ICAO: start timing abeam the fix or wings level on the outbound heading, whichever is later
            if (g.along <= 0 || t - this.establishedAt > 45) { this.timerRunning = true; this.timerStart = t; this.outGs = { s: 0, t: 0 }; }
          } else {
            this.outGs.s += this.gs * this.dt; this.outGs.t += this.dt;
            if (this.legNM ? -g.along >= this.legNM : t - this.timerStart >= this.outTime) { this.phase = 'TURN_IN'; this.turnInDir = dir; }
          }
          break;
        }
        case 'TD_TURN': {
          if (this.steer(this.trackHdg(O - dir * 30), 0) <= 3) { this.phase = 'TD_OUT'; this.timerStart = t; this.timerRunning = true; }
          break;
        }
        case 'TD_OUT': {
          this.steer(this.trackHdg(O - dir * 30), 0);
          if (this.legNM ? -g.along >= this.legNM : t - this.timerStart >= this.legTime(s.altFt)) { this.phase = 'TURN_IN'; this.turnInDir = dir; }
          break;
        }
        case 'PAR_TURN': {
          if (this.steer(this.trackHdg(O), 0) <= 3) { this.phase = 'PAR_OUT'; this.timerStart = t; this.timerRunning = true; }
          break;
        }
        case 'PAR_OUT': {
          this.steer(this.trackHdg(O), 0);
          if (this.legNM ? -g.along >= this.legNM : t - this.timerStart >= this.legTime(s.altFt)) { this.phase = 'TURN_IN'; this.turnInDir = -dir; }
          break;
        }
        case 'TURN_IN': {
          if (this.steer(this.inboundHdg(), this.turnInDir) <= 3) {
            this.phase = 'INBOUND'; this.inStart = t; this.lastAlong = null; this.inboundTimed = !this.entryPending && !this.legNM;
            this.inGs = { s: 0, t: 0 };
          }
          break;
        }
        case 'INBOUND': {
          this.steer(this.inboundHdg(), 0);
          this.inGs.s += this.gs * this.dt; this.inGs.t += this.dt;
          const crossed = this.lastAlong == null ? g.along >= 0 : (this.lastAlong < 0 && g.along >= 0);
          this.lastAlong = g.along;
          if (crossed) {
            if (this.inboundTimed) {
              const measured = t - this.inStart, target = this.legTime(s.altFt);
              this.lastInboundErr = measured - target;
              // outbound time buys inbound time at the ratio of the two ground speeds, so scale the trim by it
              const gsOut = this.outGs.t > 5 ? this.outGs.s / this.outGs.t : 0;
              const gsIn = this.inGs.t > 5 ? this.inGs.s / this.inGs.t : 0;
              const ratio = gsOut > 30 && gsIn > 30 ? gsIn / gsOut : 1;
              // secant trim: learn how inbound time really responds to outbound time (turn geometry makes it
              // steeper than 1:1 at high TAS); fall back to a damped ground-speed ratio until two circuits exist
              const err = measured - target;
              let slope = 1 / ratio, gain = 1;
              if (this.trimPrev && Math.abs(this.outTime - this.trimPrev.out) > 4) {
                const sl = (err - this.trimPrev.err) / (this.outTime - this.trimPrev.out);
                if (sl > 0.4 && sl < 4) { slope = sl; gain = 1; }
              }
              this.trimPrev = { out: this.outTime, err };
              this.outTime = clamp(this.outTime - gain * err / slope, Math.max(5, this.outTime * 0.4), Math.min(400, this.outTime * 1.8));
            }
            this.entryPending = false; this.entry = null; this.laps++;
            if (this.exitRequested) return this.finishExit();
            this.phase = 'TURN_OUT'; this.timerRunning = false;
          }
          break;
        }
      }
    }

    // ICAO: leave the hold from the fix, on the inbound leg
    finishExit(now) {
      // find the fix in the flight plan as it is now: the pilot may have edited the plan during the hold
      const name = this.fix.ident || 'fix', where = now ? 'Left the hold' : 'Left the hold at ' + name;
      if (this.fix.ppos) return this.finish(where + ', autopilot left on HDG');
      const idx = this.io.findFix ? this.io.findFix(this.fix) : this.fix.index;
      if (idx < 0) return this.finish(where + ', but ' + name + ' is no longer in the flight plan: autopilot left on HDG');
      if (!this.io.hasNext(idx)) return this.finish(where + ', ' + name + ' was the last waypoint: autopilot left on HDG');
      const keep = this.holdAlt > 0 ? this.holdAlt : (this.io.apAlt ? this.io.apAlt() : 0);
      this.ownSelect = true;
      try { this.io.gotoNext(idx); } finally { this.ownSelect = false; }
      const plan = this.io.plan ? this.io.plan() : [], next = plan[idx + 1], nextName = (next && next.ident) || 'next waypoint';
      let note = '';
      // GeoFS copies the next waypoint's altitude into the autopilot. 0 ft, or text it cannot read, means "descend into the ground".
      if (this.io.apAlt && this.io.setAlt && !(this.io.apAlt() > 0) && keep > 0) {
        this.io.setAlt(keep);
        note = '. ' + nextName + ' has no usable altitude: kept ' + Math.round(keep) + ' ft, set your descent';
        this.emit('alt');
      }
      if (this.io.tracked && !(this.io.tracked() > idx)) note += '. GeoFS could not select ' + nextName + ' (check its altitude/speed entries)';
      this.io.setMode('NAV');
      if (this.io.ap().mode !== 'NAV') return this.finish(where + '. NAV would not engage: autopilot left on HDG' + note);
      this.finish(where + ', NAV to ' + nextName + note);
    }

    /* ---- for the panel ---- */
    status() {
      const idle = this.phase === 'IDLE';
      const out = { idle, msg: this.msg, phase: this.phase, entry: this.entry, exitPending: this.exitRequested };
      if (idle || !this.s || !this.geo) return out;
      const t = this.lastT;
      out.dist = this.geo.d; out.brg = this.geo.b;
      if (this.phase === 'APPROACH') {
        out.nav = this.navApproach; out.eta = this.etaFix(); out.warn = this.warn;
        if (this.route && this.route.known) out.routeDist = this.route.dist;
        if (this.navApproach && !this.fix.ppos && this.io.findFix && this.io.findFix(this.fix) < 0) out.warn = 'Fix is no longer in the flight plan';
      }
      out.speedWarn = this.speedWarn; out.altWarn = this.altWarn;
      out.wca = this.wind.valid ? this.wca(this.phase === 'INBOUND' || this.phase === 'TURN_IN' ? this.ic : norm360(this.ic + 180)) : null;
      out.speedNote = this.speedNote;
      out.cmdHdg = this.cmdHdg;
      if ((this.phase === 'OUTBOUND') || this.phase === 'TD_OUT' || this.phase === 'PAR_OUT') {
        const total = this.phase === 'OUTBOUND' ? this.outTime : this.legTime(this.s.altFt);
        out.timerLabel = 'OUTBOUND';
        out.timer = this.timerRunning ? Math.max(0, total - (t - this.timerStart)) : null;
        if (this.legNM) out.timerNM = this.timerRunning ? Math.max(0, this.legNM + this.geo.along) : null;   // distance legs count down in NM
      } else if (this.phase === 'INBOUND') {
        out.timerLabel = 'TO FIX';
        out.timer = this.gs > 20 ? Math.max(0, -this.geo.along / this.gs * 3600) : null;
      }
      out.dir = this.dir; out.gs = this.gs;
      out.along = this.geo.along; out.cross = this.geo.cross;
      { const rate = Math.min(3, 1091 * Math.tan(25 * D2R) / (this.tas || this.gs || 200)); out.turnR = this.gs > 20 ? (this.gs / 3600) / (rate * D2R) : null; }   // turn radius in NM, for the diagram
      out.legNM = this.legNM || (this.gs > 20 ? this.gs * (this.outTime || this.legTime(this.s.altFt)) / 3600 : null);
      out.lastInboundErr = this.lastInboundErr;
      out.outTime = this.outTime;
      out.inHold = this.phase !== 'APPROACH';
      out.laps = this.laps; out.held = this.holdStartT != null && t != null ? Math.max(0, t - this.holdStartT) : null;
      return out;
    }
  }

  /* ================= test export ================= */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HoldCore, classifyEntry, maxHoldSpeed, legTimeAuto, tasFromKias, gcBearing, gcDistNM, localNM, norm360, norm180, magVar, decYear };
    return;
  }

  /* ================= GeoFS glue ================= */
  // Simulation clock. GeoFS caps the time step of each frame at 0.1 s (so below 10 fps the aircraft flies in slow motion while the
  // wall clock keeps running) and multiplies it by its simulation speed. Every timer in the hold must follow the aircraft, so this
  // clock is built from GeoFS's own frame timestamps (geofs.lastTime), the way flight.tick gets its time step.
  function makeSimClock() {
    let lastF = null, lastW = null, simT = 0;
    return () => {
      const f = window.geofs && geofs.frameNumber;
      if (typeof f !== 'number') return performance.now() / 1000;
      const lt = geofs.lastTime;
      if (lt === null) { lastF = f; return simT; }   // just unpaused: GeoFS restarts its own clock
      const w = Number.isFinite(lt) ? lt / 1000 : performance.now() / 1000;   // no GeoFS timestamp at all: fall back to the wall clock
      if (lastF == null || lastW == null) { lastF = f; lastW = w; return simT; }
      if (f !== lastF) {
        const frames = f - lastF, sp = Number(geofs.preferences && geofs.preferences.simulationSpeed) || 1;
        const avg = Math.max(0, w - lastW) / Math.max(1, frames);
        if (frames > 0 && !geofs.pause) simT += frames * Math.min(avg * sp, 0.1);
        lastF = f; lastW = w;
      }
      return simT;
    };
  }
  function makeIO() {
    return {
      now: makeSimClock(),
      read: () => {
        const lla = geofs.aircraft.instance.llaLocation, av = geofs.animation.values;
        const htr = geofs.aircraft.instance.htr;   // [heading, pitch, roll] in degrees
        // GeoFS flies at the speed it displays: measured true airspeed equals the KIAS readout at every altitude (ground speed in still
        // air matches it too), so ISA density corrections would overstate TAS badly (x2 at FL350). Use the sim's own true airspeed.
        const tasKt = geofs.aircraft.instance.trueAirSpeed * 1.943844;
        return { lat: lla[0], lon: lla[1], altFt: av.altitude, hdg: av.heading360, kias: av.kias, tas: Number.isFinite(tasKt) && tasKt > 20 ? tasKt : av.kias, bank: htr ? Math.abs(htr[2]) : NaN };
      },
      ap: () => ({ on: !!geofs.autopilot.on, mode: geofs.autopilot.mode, speed: geofs.autopilot.values.speed, speedMode: geofs.autopilot.speedMode, vnav: !!geofs.autopilot.VNAV }),
      // second argument: without it GeoFS drops NAV to its armed "NOR" mode whenever the course is set
      setCourse: d => geofs.autopilot.setCourse(d, true),
      setMode: m => geofs.autopilot.setMode(m),
      setSpeed: v => geofs.autopilot.setSpeed(v, true),
      setSpeedMode: m => geofs.autopilot.setSpeedMode(m),
      apAlt: () => geofs.autopilot.values.altitude,
      setAlt: ft => geofs.autopilot.setAltitude(ft, true),
      hasNext: i => i + 1 < geofs.flightPlan.waypointArray.length,
      // the waypoint GeoFS's NAV is flying to now, and the distance at which it moves on to the next one (same formula as flightPlan.update)
      tracked: () => { const w = geofs.flightPlan.trackedWaypoint; return w && Number.isFinite(w.id) ? w.id : -1; },
      trackedObj: () => geofs.flightPlan.trackedWaypoint || null,
      // NAV leads to the fix only when it follows the flight plan (GeoFS marks those navaids fromFlightPlan)
      navIsPlan: () => { const u = geofs.nav && geofs.nav.currentNAVUnit; return !(u && u.navaid) || !!u.navaid.fromFlightPlan; },
      plan: () => geofs.flightPlan.waypointArray || [],
      switchNM: () => { const v = geofs.flightPlan.DMEMargin * geofs.aircraft.instance.llaLocation[2]; return Number.isFinite(v) ? clamp(v, 1, 100) : 1; },
      findFix: f => {
        const a = geofs.flightPlan.waypointArray || [];
        for (let i = 0; i < a.length; i++) if (a[i].ident === f.ident && Math.abs(a[i].lat - f.lat) < 1e-4 && Math.abs(a[i].lon - f.lon) < 1e-4) return i;
        return -1;
      },
      // Track waypoint i+1 with selectWaypoint(). Never gotoWaypoint(): in GeoFS that teleports the aircraft to the waypoint.
      gotoNext: i => { const fp = geofs.flightPlan; if (typeof fp.selectWaypoint === 'function') fp.selectWaypoint(i + 1); }
    };
  }

  // Every altitude and speed GeoFS pushes into the autopilot from the flight plan goes through selectWaypoint(): when NAV moves on,
  // when a waypoint is clicked, and when one is deleted (GeoFS re-selects there). Wrap it so the hold can put back what it changed.
  function hookSelect(core) {
    const fp = geofs.flightPlan, orig = fp.selectWaypoint;
    if (typeof orig !== 'function' || orig.__gholdHook) return;
    const wrapped = function (i) {
      let g = null;
      try { g = core.beforeSelect(+i); } catch (e) { g = null; }
      const r = orig.apply(this, arguments);
      try { core.afterSelect(g); } catch (e) { console.error('[GeoFS Hold]', e); }
      return r;
    };
    wrapped.__gholdHook = true;
    fp.selectWaypoint = wrapped;
  }

  const CSS = `
  #ghold{position:fixed;top:72px;right:84px;z-index:99999;user-select:none}
  #ghold>.gh-p{--c:#3ee6d6;--c2:rgba(62,230,214,.16);--am:#ffc24a;--rd:#ff5d5d;--tx:#e8f1f6;--dm:#7f93a3;--ln:rgba(140,200,215,.16);
    width:272px;box-sizing:border-box;color:var(--tx);font:12px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    background:linear-gradient(180deg,rgba(14,20,28,.88),rgba(7,11,17,.9));backdrop-filter:blur(10px) saturate(1.2);
    border:1px solid var(--ln);border-radius:14px;box-shadow:0 10px 34px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.05);
    transition:opacity .2s ease,border-color .3s ease,box-shadow .3s ease}
  #ghold.efc5>.gh-p{border-color:rgba(255,194,74,.55);box-shadow:0 10px 34px rgba(0,0,0,.55),0 0 0 1px rgba(255,194,74,.25)}
  #ghold.efc0>.gh-p{border-color:rgba(255,93,93,.6);box-shadow:0 10px 34px rgba(0,0,0,.55),0 0 0 1px rgba(255,93,93,.3)}
  #ghold.flash>.gh-p{animation:ghflash .9s ease 2}
  @keyframes ghflash{50%{box-shadow:0 10px 34px rgba(0,0,0,.55),0 0 0 3px var(--am),0 0 22px var(--am)}}
  #ghold *{box-sizing:border-box}
  #ghold .gh-num,#ghold input,#ghold select,#ghold .gh-pill b{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
  #ghold .gh-head{display:flex;align-items:center;gap:6px;padding:9px 8px 8px 12px;cursor:grab;border-bottom:1px solid var(--ln)}
  #ghold .gh-head:active{cursor:grabbing}
  #ghold .gh-dot{width:8px;height:8px;border-radius:50%;background:#46586a;box-shadow:0 0 0 3px rgba(70,88,106,.18);transition:background .25s,box-shadow .25s}
  #ghold.run .gh-dot{background:var(--c);box-shadow:0 0 0 3px var(--c2),0 0 10px var(--c)}
  #ghold.turn .gh-dot{background:var(--am);box-shadow:0 0 0 3px rgba(255,194,74,.18),0 0 10px var(--am)}
  #ghold .gh-title{font-weight:700;letter-spacing:.2em;font-size:11px;color:var(--c)}
  #ghold .gh-sp{flex:1}
  #ghold .gh-fixname{color:var(--dm);font-size:11px;letter-spacing:.04em;margin-right:2px}
  #ghold .gh-hb{width:22px;height:22px;display:grid;place-items:center;padding:0;border-radius:6px;background:transparent;border:1px solid transparent;color:var(--dm);cursor:pointer;font:inherit;font-size:10.5px;font-weight:700}
  #ghold .gh-hb:hover{color:var(--tx);background:rgba(255,255,255,.07)}
  #ghold .gh-hb svg{width:13px;height:13px;display:block}
  #ghold .gh-wrap{display:grid;grid-template-rows:1fr;transition:grid-template-rows .24s ease}
  #ghold .gh-wrap>div{overflow:hidden;min-height:0}
  #ghold.min .gh-wrap{grid-template-rows:0fr}
  #ghold .gh-body{padding:11px 12px 12px;display:flex;flex-direction:column;gap:11px;transition:opacity .2s ease}
  #ghold.min .gh-body{opacity:0}
  #ghold .gh-pill{display:none;align-items:center;gap:8px;padding:8px 12px;cursor:grab;white-space:nowrap}
  #ghold.min .gh-pill{display:flex}
  #ghold.min .gh-head{display:none}
  #ghold.off{display:none}
  #ghold.nt,#ghold.nt *{transition:none!important}
  #ghold.mv{transition:left .24s ease,top .24s ease}
  #ghold .gh-pill b{font-weight:600;color:var(--tx)}
  #ghold .gh-pill i{font-style:normal;color:var(--dm)}
  #ghold .gh-top{display:grid;grid-template-columns:104px 1fr;gap:12px;align-items:stretch}
  #ghold .gh-dia{position:relative;border:1px solid var(--ln);border-radius:10px;background:radial-gradient(circle at 50% 40%,rgba(62,230,214,.07),rgba(0,0,0,0) 70%),rgba(0,0,0,.28);overflow:hidden}
  #ghold .gh-dia svg{display:block;width:100%;height:104px}
  #ghold .gh-dia .gh-cap{position:absolute;left:0;right:0;bottom:3px;text-align:center;font-size:9px;letter-spacing:.06em;color:var(--dm)}
  #ghold .gh-info{display:flex;flex-direction:column;justify-content:space-between;gap:6px;min-width:0}
  #ghold .gh-lbl{font-size:9.5px;letter-spacing:.14em;color:var(--dm);text-transform:uppercase}
  #ghold #r-status{font-weight:700;font-size:13px;letter-spacing:.02em;margin-top:2px;transition:color .2s}
  #ghold .gh-chip{display:inline-block;margin-top:4px;padding:1px 7px;border-radius:99px;font-size:10px;font-weight:700;letter-spacing:.1em;color:var(--c);background:var(--c2);border:1px solid rgba(62,230,214,.3);white-space:nowrap}
  #ghold .gh-chip:empty{display:none}
  #ghold #r-timer{font-size:26px;font-weight:600;letter-spacing:-.01em;line-height:1.1;color:var(--tx)}
  #ghold .gh-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:9px 0 1px;border-top:1px solid var(--ln)}
  #ghold .gh-grid div span:last-child{display:block;font-size:12px;font-weight:600;margin-top:1px}
  #ghold .gh-live{display:none;grid-template-columns:1fr 1fr;gap:12px;padding:8px 0 0;border-top:1px solid var(--ln)}
  #ghold.run .gh-live{display:grid}
  #ghold .gh-stp{display:flex;align-items:center;gap:4px;margin-top:3px}
  #ghold .gh-stp button{width:22px;height:22px;flex:none;border-radius:6px;border:1px solid var(--ln);background:rgba(0,0,0,.3);color:var(--tx);font:inherit;font-weight:700;font-size:13px;line-height:1;cursor:pointer;padding:0}
  #ghold .gh-stp button:hover{border-color:var(--c);color:var(--c)}
  #ghold .gh-stp .gh-val{flex:1;text-align:center;font-weight:600;font-size:12px;cursor:text;border-bottom:1px dashed rgba(140,200,215,.28);padding:2px 0;white-space:nowrap;overflow:hidden}
  #ghold .gh-stp input{flex:1;min-width:0;text-align:center;padding:2px 0}
  #ghold .gh-form{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px;transition:opacity .2s}
  #ghold.run .gh-form .gh-lock,#ghold.run .gh-more,#ghold.run .gh-extra{display:none}
  #ghold.run .gh-form{grid-template-columns:1fr}
  #ghold .gh-f>.gh-lbl{white-space:nowrap;overflow:hidden}
  #ghold .gh-f{display:flex;flex-direction:column;gap:2px;min-width:0}
  #ghold .gh-f.wide{grid-column:1/-1}
  #ghold .gh-tag{margin-left:5px;padding:0 4px;border-radius:4px;font-size:8.5px;letter-spacing:.08em;color:var(--c);background:var(--c2)}
  #ghold .gh-tag:empty{display:none}
  #ghold .gh-in{position:relative;display:block}
  #ghold .gh-hint{position:absolute;right:0;bottom:5px;font-size:9.5px;color:var(--dm);pointer-events:none;font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}
  #ghold input,#ghold select{width:100%;font-size:12.5px;color:var(--tx);background:transparent;border:0;border-bottom:1px solid rgba(140,200,215,.28);border-radius:0;padding:3px 0 4px;outline:none;user-select:text;transition:border-color .15s}
  #ghold input.auto{color:#9fd9d2}
  #ghold select option{background:#0b1118;color:var(--tx)}
  #ghold input::placeholder{color:#4d5f6e}
  #ghold input:focus,#ghold select:focus{border-bottom-color:var(--c)}
  #ghold .gh-seg{display:flex;padding:2px;border-radius:8px;background:rgba(0,0,0,.35);border:1px solid var(--ln)}
  #ghold .gh-seg button{flex:1;font:inherit;font-size:11px;font-weight:700;letter-spacing:.08em;padding:4px 0;border:0;border-radius:6px;background:transparent;color:var(--dm);cursor:pointer;transition:background .15s,color .15s}
  #ghold .gh-seg button.on{background:var(--c);color:#04201d}
  #ghold .gh-presets{display:flex;gap:4px;padding:2px 0}
  #ghold .gh-presets button{flex:1;font:inherit;font-size:10.5px;font-weight:700;letter-spacing:.04em;padding:3px 0;border-radius:99px;border:1px solid var(--ln);background:transparent;color:var(--dm);cursor:pointer;transition:background .15s,color .15s,border-color .15s}
  #ghold .gh-presets button:hover{color:var(--tx);border-color:rgba(62,230,214,.45)}
  #ghold .gh-presets button.on{color:var(--c);border-color:rgba(62,230,214,.55);background:var(--c2)}
  #ghold .gh-btns{display:flex;gap:8px}
  #ghold .gh-btns button{font:inherit;font-weight:700;letter-spacing:.12em;font-size:12px;padding:9px 0;border-radius:9px;cursor:pointer;border:0;transition:transform .08s,filter .15s,background .2s,box-shadow .2s}
  #ghold .gh-btns button:hover{filter:brightness(1.08)}#ghold .gh-btns button:active{transform:translateY(1px)}
  #ghold #gh-enter{flex:1;color:#04201d;background:var(--c);box-shadow:0 4px 16px rgba(62,230,214,.22)}
  #ghold.run #gh-enter{color:#fff;background:#b8362f;box-shadow:0 4px 16px rgba(255,93,93,.2)}
  #ghold.run.armed #gh-enter{background:#4a2420;color:#ffb3ae;box-shadow:none}
  #ghold #gh-leave{display:none;flex:0 0 38%;color:var(--tx);background:rgba(255,255,255,.08);border:1px solid var(--ln)!important;letter-spacing:.08em}
  #ghold.inhold #gh-leave{display:block}
  #ghold #gh-msg{min-height:0;color:var(--am);font-size:11.5px;line-height:1.3}
  #ghold #gh-msg:empty{display:none}
  #ghold .amber{color:var(--am)!important}#ghold .red{color:var(--rd)!important}
  #ghold .gh-more{align-self:flex-start;margin:-4px 0 -2px;padding:0;border:0;background:none;color:var(--dm);font:inherit;font-size:10.5px;letter-spacing:.06em;cursor:pointer}
  #ghold .gh-more:hover{color:var(--c)}
  #ghold .gh-extra{display:none}
  #ghold.more .gh-extra{display:grid}
  `;

  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
  const hdg3 = d => pad(norm360(Math.round(d)) === 0 ? 360 : norm360(Math.round(d)), 3);
  const mmss = s => (s == null || !Number.isFinite(s) ? '--:--' : pad(Math.floor(s / 60), 2) + ':' + pad(Math.floor(s % 60), 2));
  const hms = s => (!Number.isFinite(s) ? '--:--' : s >= 3600 ? Math.floor(s / 3600) + ':' + pad(Math.floor(s % 3600 / 60), 2) + ':' + pad(Math.floor(s % 60), 2) : mmss(s));
  const PHASE_TXT = {
    APPROACH: 'Direct to fix', TURN_OUT: 'Turn outbound', OUTBOUND: 'Outbound', TURN_IN: 'Turn inbound', INBOUND: 'Inbound',
    TD_TURN: 'Teardrop turn', TD_OUT: 'Teardrop out', PAR_TURN: 'Parallel turn', PAR_OUT: 'Parallel out'
  };
  const PHASE_PILL = {
    APPROACH: 'TO FIX', TURN_OUT: 'TURN', OUTBOUND: 'OUT', TURN_IN: 'TURN', INBOUND: 'IN',
    TD_TURN: 'TURN', TD_OUT: 'OUT', PAR_TURN: 'TURN', PAR_OUT: 'OUT'
  };
  const TURN_PH = { TURN_OUT: 1, TURN_IN: 1, TD_TURN: 1, PAR_TURN: 1 };
  const SIZES = [{ k: 'S', z: 0.86 }, { k: 'M', z: 1 }, { k: 'L', z: 1.2 }];
  const ICON_SND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z"/><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.6a6 6 0 0 1 0 8.8"/></svg>';
  const ICON_MUTE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z"/><path d="M11 6l4 4M15 6l-4 4"/></svg>';

  // Racetrack geometry in NM: fix at the origin, inbound course points up, +x is to the right.
  function racetrack(dir, r, L) {
    const x2 = 2 * r * dir, sw = dir > 0 ? 0 : 1;   // the group is y-flipped, so the sweep flag is mirrored
    return {
      inb: `M0,${-L} L0,0`,
      top: `M0,0 A${r},${r} 0 0 ${sw} ${x2},0`,
      out: `M${x2},0 L${x2},${-L}`,
      bot: `M${x2},${-L} A${r},${r} 0 0 ${sw} 0,${-L}`
    };
  }
  // the same racetrack as lat/lon points, for the GeoFS map (ic = true inbound course)
  function racetrackLatLon(fix, ic, dir, r, L) {
    const pts = [], th = ic * D2R, k = 60 * Math.cos(fix.lat * D2R) || 1e-6;
    const put = (x, y) => { const e = x * Math.cos(th) + y * Math.sin(th), n = -x * Math.sin(th) + y * Math.cos(th); pts.push([fix.lat + n / 60, fix.lon + e / k]); };
    put(0, -L); put(0, 0);
    for (let i = 1; i <= 18; i++) { const a = Math.PI * i / 18; put(dir * r * (1 - Math.cos(a)), r * Math.sin(a)); }
    put(2 * r * dir, -L);
    for (let i = 1; i <= 18; i++) { const a = Math.PI * i / 18; put(dir * r * (1 + Math.cos(a)), -L - r * Math.sin(a)); }
    return pts;
  }

  function buildUI(core) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'ghold';
    root.innerHTML = `<div class="gh-p">
      <div class="gh-head"><span class="gh-dot"></span><span class="gh-title">HOLD</span><span class="gh-sp"></span><span class="gh-fixname" id="gh-hfix"></span>
        <button class="gh-hb" id="gh-size" title="Panel size">M</button><button class="gh-hb" id="gh-snd" title="Sound on/off"></button><button class="gh-hb gh-min" id="gh-min" title="Collapse (Shift+H cycles panel, pill, hidden)">&ndash;</button></div>
      <div class="gh-pill"><span class="gh-dot"></span><span class="gh-title">HOLD</span><i id="gh-pfix"></i><b id="gh-pst">IDLE</b><b id="gh-ptm"></b></div>
      <div class="gh-wrap"><div><div class="gh-body">
        <div class="gh-top">
          <div class="gh-dia">
            <svg viewBox="0 0 104 104" aria-label="Hold pattern">
              <g id="gh-g" fill="none" stroke-linecap="round" stroke-width="2.2">
                <path id="gp-inb" stroke="#4b6376"/><path id="gp-top" stroke="#4b6376"/><path id="gp-out" stroke="#4b6376"/><path id="gp-bot" stroke="#4b6376"/>
              </g>
              <circle id="gd-fix" r="3" fill="#0b1118" stroke="#e8f1f6" stroke-width="1.6"/>
              <circle id="gd-ac-halo" r="7" fill="rgba(62,230,214,.18)" style="display:none"/>
              <circle id="gd-ac" r="3.4" fill="#3ee6d6" style="display:none"/>
            </svg>
            <div class="gh-cap" id="r-fix">---</div>
          </div>
          <div class="gh-info">
            <div><div class="gh-lbl">Status</div><div id="r-status">Idle</div><span class="gh-chip" id="r-entry"></span></div>
            <div><div class="gh-lbl" id="r-tl">Timer</div><div class="gh-num" id="r-timer">--:--</div></div>
          </div>
        </div>
        <div class="gh-grid">
          <div><span class="gh-lbl">Wind corr</span><span class="gh-num" id="r-wca">---</span></div>
          <div><span class="gh-lbl">Max spd</span><span class="gh-num" id="r-spd">---</span></div>
          <div><span class="gh-lbl">EFC</span><span class="gh-num" id="r-efc">---</span></div>
        </div>
        <div class="gh-live">
          <div><span class="gh-lbl">AP alt</span><div class="gh-stp"><button id="gh-am" title="-1000 ft">&minus;</button><span class="gh-val gh-num" id="gh-av" title="Click to type (9000 or FL90)">---</span><button id="gh-ap" title="+1000 ft">+</button></div></div>
          <div><span class="gh-lbl">AP speed</span><div class="gh-stp"><button id="gh-sm" title="-10 kt">&minus;</button><span class="gh-val gh-num" id="gh-sv" title="Click to type (220 or M.78)">---</span><button id="gh-sp" title="+10 kt">+</button></div></div>
        </div>
        <div class="gh-form">
          <label class="gh-f gh-lock"><span class="gh-lbl">Fix</span><select id="gh-fix"></select></label>
          <label class="gh-f gh-lock"><span class="gh-lbl">Inbound &deg;M<span class="gh-tag" id="gh-crstag"></span></span><span class="gh-in"><input id="gh-crs" inputmode="numeric" maxlength="3" placeholder="270"><span class="gh-hint" id="gh-crshint"></span></span></label>
          <div class="gh-f gh-lock"><span class="gh-lbl">Turns</span><span class="gh-seg"><button data-dir="1" class="on">R</button><button data-dir="-1">L</button></span></div>
          <div class="gh-f gh-lock"><span class="gh-lbl">Preset</span><span class="gh-presets"><button data-p="std" title="ICAO standard: 1 min up to FL140, 1.5 min above, right turns">STD</button><button data-p="2" title="2 minute legs">2'</button><button data-p="5NM" title="5 NM legs (RNAV)">5NM</button></span></div>
          <label class="gh-f gh-lock"><span class="gh-lbl">Leg (min or NM)</span><input id="gh-leg" placeholder="AUTO, 2 or 5NM"></label>
          <label class="gh-f"><span class="gh-lbl">EFC (UTC)</span><input id="gh-efc" inputmode="numeric" maxlength="4" placeholder="HHMM"></label>
        </div>
        <button class="gh-more" id="gh-more" type="button">More options</button>
        <div class="gh-form gh-extra">
          <label class="gh-f gh-lock"><span class="gh-lbl">Max spd (kt)</span><input id="gh-mspd" inputmode="numeric" maxlength="3" placeholder="AUTO"></label>
          <label class="gh-f gh-lock"><span class="gh-lbl">Min alt</span><input id="gh-malt" placeholder="FL90 or 9000"></label>
        </div>
        <div class="gh-btns"><button id="gh-enter">ENTER HOLD</button><button id="gh-leave" title="Leave the hold now, direct to the next waypoint">LEAVE NOW</button></div>
        <div id="gh-msg"></div>
      </div></div></div></div>`;
    document.body.appendChild(root);
    const $ = id => root.querySelector(id);
    const panel = $('.gh-p');

    // keep every keystroke away from GeoFS controls while typing
    root.querySelectorAll('input,select').forEach(el => ['keydown', 'keyup', 'keypress'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation())));

    // remembered position, display mode, size, sound and per-fix settings (per browser; falls back silently)
    const KEY = 'geofsHoldPanel';
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) { /* storage unavailable */ } };
    function place(x, y, dims) {
      const w = dims ? dims.w : root.offsetWidth || 272, h = dims ? dims.h : root.offsetHeight || 60;
      x = clamp(x, 4, Math.max(4, innerWidth - w - 4)); y = clamp(y, 4, Math.max(4, innerHeight - h - 4));
      root.style.left = x + 'px'; root.style.top = y + 'px'; root.style.right = 'auto';
    }

    // panel size: CSS zoom on the inner panel, so the outer box (and its position) stays in screen pixels
    let size = SIZES.findIndex(z => z.k === saved.size); if (size < 0) size = 1;
    function applySize() { panel.style.zoom = SIZES[size].z; $('#gh-size').textContent = SIZES[size].k; }
    applySize();

    if (typeof saved.x === 'number') place(saved.x, saved.y);
    // display mode: 0 = panel, 1 = slim pill, 2 = hidden (the hold keeps running)
    let mode = saved.mode === 0 || saved.mode === 1 || saved.mode === 2 ? saved.mode : (saved.min ? 1 : 0);
    addEventListener('resize', () => { if (root.style.left) place(parseFloat(root.style.left), parseFloat(root.style.top)); });

    // drag (header or pill); a click without movement on the pill expands it
    let drag = null;
    function down(e) {
      if (e.target.closest('button')) return;
      const r = root.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top, sx: e.clientX, sy: e.clientY, moved: false };
      e.preventDefault();
    }
    $('.gh-head').addEventListener('mousedown', down); $('.gh-pill').addEventListener('mousedown', down);
    addEventListener('mousemove', e => {
      if (!drag) return;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
      if (drag.moved) place(e.clientX - drag.x, e.clientY - drag.y);
    });
    addEventListener('mouseup', () => {
      if (!drag) return;
      if (drag.moved) { saved.x = parseFloat(root.style.left); saved.y = parseFloat(root.style.top); save(); }
      else if (mode === 1) setMode(0);
      drag = null;
    });
    // Changing the size must not push the panel off screen: the edge nearest to the screen edge stays where it is.
    let lastRect = null, mvTimer = 0;
    // The panel's height is animated, so measure the size it will end up with, not the size it has right now.
    function finalSize(m) {
      const was = root.classList.contains('min');
      root.classList.add('nt'); root.classList.toggle('min', m === 1);
      const sz = { w: root.offsetWidth, h: root.offsetHeight };
      root.classList.toggle('min', was); void root.offsetWidth; root.classList.remove('nt');
      return sz;
    }
    function reanchor(before, sz) {
      root.classList.add('mv'); clearTimeout(mvTimer); mvTimer = setTimeout(() => root.classList.remove('mv'), 320);
      place(before.left + before.width / 2 > innerWidth / 2 ? before.right - sz.w : before.left,
            before.top + before.height / 2 > innerHeight / 2 ? before.bottom - sz.h : before.top, sz);
      saved.x = parseFloat(root.style.left); saved.y = parseFloat(root.style.top);
    }
    function setMode(m, initial) {
      const before = mode !== 2 && root.offsetWidth ? root.getBoundingClientRect() : lastRect;
      mode = m; saved.mode = m; saved.min = m === 1;
      if (m === 2) { lastRect = before; root.classList.remove('min'); root.classList.add('off'); save(); return; }
      root.classList.remove('off');
      const sz = finalSize(m);
      if (!initial && before) reanchor(before, sz);
      root.classList.toggle('min', m === 1);
      save();
    }
    if (mode === 2) setMode(2, true); else { root.classList.toggle('min', mode === 1); if (typeof saved.x === 'number') place(saved.x, saved.y, finalSize(mode)); }
    if (mode === 2 && typeof saved.x === 'number') place(saved.x, saved.y);
    $('#gh-min').addEventListener('click', () => setMode(1));
    $('#gh-size').addEventListener('click', () => {
      const before = root.getBoundingClientRect();
      size = (size + 1) % SIZES.length; saved.size = SIZES[size].k; applySize();
      reanchor(before, finalSize(mode)); save();
    });

    // sound: short sine chimes, made on the spot (no files). Browsers only allow audio after a click or key press, so the
    // audio context is created on the first one.
    let actx = null, muted = !!saved.mute;
    function audio() {
      try { if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) { actx = null; }
      return actx;
    }
    function chime(kind) {
      if (muted) return;
      const seq = { enter: [660, 880], exit: [880, 660], alt: [740], efc5: [587, 587], efc0: [880, 880, 880] }[kind];
      const a = seq && audio(); if (!a) return;
      try {
        const t0 = a.currentTime + 0.02;
        seq.forEach((f, i) => {
          const o = a.createOscillator(), g = a.createGain(), ts = t0 + i * 0.17;
          o.type = 'sine'; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, ts); g.gain.exponentialRampToValueAtTime(0.16, ts + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, ts + 0.34);
          o.connect(g); g.connect(a.destination); o.start(ts); o.stop(ts + 0.36);
        });
      } catch (e) { /* audio unavailable */ }
    }
    function setMute(m) { muted = m; saved.mute = m; save(); $('#gh-snd').innerHTML = m ? ICON_MUTE : ICON_SND; $('#gh-snd').title = m ? 'Sound off (click for on)' : 'Sound on (click for off)'; }
    setMute(muted);
    $('#gh-snd').addEventListener('click', () => { setMute(!muted); if (!muted) chime('alt'); });
    root.addEventListener('pointerdown', () => { if (!muted) audio(); });

    let dir = 1;
    function setDir(d) { dir = d; root.querySelectorAll('.gh-seg button').forEach(x => x.classList.toggle('on', +x.dataset.dir === d)); }
    root.querySelectorAll('.gh-seg button').forEach(b => b.addEventListener('click', () => setDir(+b.dataset.dir)));

    // leg presets: STD is the ICAO default (auto time, right turns); the others only set the leg
    function markPreset() {
      const v = $('#gh-leg').value.trim().toUpperCase().replace(/\s+/g, '');
      root.querySelectorAll('.gh-presets button').forEach(b => {
        const p = b.dataset.p;
        b.classList.toggle('on', p === 'std' ? (v === '' || v === 'AUTO') && dir === 1 : v === p || (p === '2' && /^2(\.0+)?$/.test(v)));
      });
    }
    root.querySelectorAll('.gh-presets button').forEach(b => b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (p === 'std') { $('#gh-leg').value = ''; setDir(1); } else $('#gh-leg').value = p;
      markPreset();
    }));
    $('#gh-leg').addEventListener('input', markPreset);
    root.querySelectorAll('.gh-seg button').forEach(b => b.addEventListener('click', markPreset));

    // "More options" row (max speed, min altitude), remembered
    function setMore(on) { root.classList.toggle('more', on); $('#gh-more').textContent = on ? 'Fewer options' : 'More options'; saved.more = on; save(); }
    $('#gh-more').addEventListener('click', () => setMore(!root.classList.contains('more')));
    if (saved.more) setMore(true);

    // magnetic variation at a point, at the aircraft's altitude, today
    function varAt(lat, lon) {
      try { const v = magVar(lat, lon, (geofs.animation.values.altitude || 0) * 0.0003048, decYear(new Date())); return Number.isFinite(v) ? v : 0; } catch (e) { return 0; }
    }

    // fix selection is kept by identity (ident and position), not by its number in the plan, so editing the plan keeps the pick
    const wkey = w => (w.ident || 'WPT') + '@' + (+w.lat).toFixed(3) + ',' + (+w.lon).toFixed(3);
    let selKey = null;
    function selFix() {
      const v = $('#gh-fix').value, arr = geofs.flightPlan.waypointArray || [];
      if (v === 'here') return { here: true };
      const i = +v, w = v === '' ? null : arr[i];
      return w ? { i, w } : null;
    }
    function memKey() { const f = selFix(); return f && f.w ? wkey(f.w) : null; }

    // inbound course: the course the route arrives at the fix on (magnetic), until the pilot types one
    let crsAuto = true;
    function autoCourse() {
      const f = selFix(); if (!f) return null;
      const l = geofs.aircraft.instance.llaLocation;
      if (f.here) return norm360(geofs.animation.values.heading360 - varAt(l[0], l[1]));
      const arr = geofs.flightPlan.waypointArray || [], prev = arr[f.i - 1];
      let from = prev && gcDistNM(prev.lat, prev.lon, f.w.lat, f.w.lon) > 0.5 ? [prev.lat, prev.lon] : [l[0], l[1]];
      if (gcDistNM(from[0], from[1], f.w.lat, f.w.lon) < 0.5) return null;
      const tru = norm360(gcBearing(f.w.lat, f.w.lon, from[0], from[1]) + 180);
      return norm360(tru - varAt(f.w.lat, f.w.lon));
    }
    function fillAuto() {
      if (!crsAuto || core.phase !== 'IDLE') return;
      const c = autoCourse(), inp = $('#gh-crs');
      const txt = c == null ? '' : hdg3(c);
      if (inp.value !== txt && document.activeElement !== inp) inp.value = txt;
      inp.classList.toggle('auto', !!txt);
      $('#gh-crstag').textContent = txt ? (selFix() && selFix().here ? 'HDG' : 'RTE') : '';
    }
    $('#gh-crs').addEventListener('input', () => {
      crsAuto = !$('#gh-crs').value.trim();
      $('#gh-crs').classList.remove('auto'); $('#gh-crstag').textContent = '';
      if (crsAuto) fillAuto();
    });
    function recall() {
      if (core.phase !== 'IDLE') return;
      const k = memKey(), m = k && saved.fixes && saved.fixes[k];
      if (m) {
        if (m.crs) { crsAuto = false; $('#gh-crs').value = m.crs; $('#gh-crs').classList.remove('auto'); $('#gh-crstag').textContent = 'MEM'; }
        else { crsAuto = true; fillAuto(); }
        setDir(m.dir >= 0 ? 1 : -1);
        $('#gh-leg').value = m.leg || ''; $('#gh-mspd').value = m.spd || ''; $('#gh-malt').value = m.alt || '';
        if (m.spd || m.alt) setMore(true);
      } else { crsAuto = true; fillAuto(); }
      markPreset();
    }
    $('#gh-fix').addEventListener('change', () => { const f = selFix(); selKey = f && f.here ? 'here' : memKey(); recall(); });
    function remember(k, v) {
      if (!k) return;
      saved.fixes = saved.fixes || {}; delete saved.fixes[k]; saved.fixes[k] = v;
      const keys = Object.keys(saved.fixes); while (keys.length > 40) delete saved.fixes[keys.shift()];
      save();
    }

    // FMC waypoint dropdown, rebuilt only when the flight plan changes
    let sig = null;
    function refreshFixes() {
      const arr = geofs.flightPlan.waypointArray || [];
      const s2 = arr.map(w => w.ident + w.lat + w.lon).join('|');
      if (s2 === sig) return; sig = s2;
      const sel = $('#gh-fix');
      sel.innerHTML = '';
      arr.forEach((w, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '  ' + (w.ident || 'WPT'); sel.appendChild(o); });
      const here = document.createElement('option'); here.value = 'here'; here.textContent = 'Present position'; sel.appendChild(here);
      let pick = selKey === 'here' ? 'here' : (selKey ? arr.findIndex(w => wkey(w) === selKey) : -1);
      if (pick === -1) {
        // nothing picked yet, or the picked waypoint was deleted: default to the next waypoint ahead
        const tw = geofs.flightPlan.trackedWaypoint, ti = tw && Number.isFinite(tw.id) ? tw.id : 0;
        pick = arr.length ? clamp(ti, 0, arr.length - 1) : 'here';
      }
      sel.value = String(pick);
      const f = selFix(), k = f && f.here ? 'here' : memKey();
      if (k !== selKey) { selKey = k; recall(); } else fillAuto();
    }

    function efcMs() {
      const v = $('#gh-efc').value.trim();
      if (!/^\d{4}$/.test(v)) return null;
      const hh = +v.slice(0, 2), mm = +v.slice(2);
      if (hh > 23 || mm > 59) return null;
      const now = new Date();
      let d = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm) - now.getTime();
      // the EFC is the nearest such time: at most 12 h ahead or 12 h ago
      if (d > 12 * 3600e3) d -= 86400e3; else if (d < -12 * 3600e3) d += 86400e3;
      return d;
    }

    function enterHold() {
      const arr = geofs.flightPlan.waypointArray || [], f = selFix();
      const crsTxt = $('#gh-crs').value.trim(), crs = +crsTxt;
      if (!f) return setMsg('Pick a holding fix from the flight plan');
      if (!/^\d{1,3}$/.test(crsTxt) || crs > 360) return setMsg('Inbound course must be 0 to 360');
      const legTxt = $('#gh-leg').value.trim(), spdTxt = $('#gh-mspd').value.trim(), altTxt = $('#gh-malt').value.trim().toUpperCase().replace(/\s+/g, '');
      let legS = null, legNM = null, maxKt = null, minAltFt = null, minAltLabel = '';
      if (legTxt && legTxt.toUpperCase() !== 'AUTO') {
        const nm = /^(\d+(?:\.\d+)?)\s*NM$/i.exec(legTxt);
        if (nm) { legNM = parseFloat(nm[1]); if (!(legNM >= 1 && legNM <= 30)) return setMsg('Leg distance: 1 to 30 NM'); }
        else { const m = /^\d+(?:\.\d+)?$/.test(legTxt) ? parseFloat(legTxt) : NaN; if (!(m >= 0.5 && m <= 5)) return setMsg('Leg: AUTO, 0.5 to 5 min, or a distance such as 5NM'); legS = m * 60; }
      }
      if (spdTxt && spdTxt.toUpperCase() !== 'AUTO') { maxKt = /^\d{3}$/.test(spdTxt) ? +spdTxt : NaN; if (!(maxKt >= 100 && maxKt <= 400)) return setMsg('Max speed: 100 to 400 kt, or leave empty'); }
      if (altTxt) {
        let m;
        if ((m = /^(?:FL)?(\d{2,3})$/.exec(altTxt))) { minAltFt = +m[1] * 100; minAltLabel = 'FL' + m[1]; }
        else if (/^\d{4,5}$/.test(altTxt)) { minAltFt = +altTxt; minAltLabel = altTxt + ' ft'; }
        else return setMsg('Min altitude: FL90 or 9000, or leave empty');
      }
      let fix;
      if (f.here) { const l = geofs.aircraft.instance.llaLocation; fix = { index: -1, ident: 'PPOS', ppos: true, lat: l[0], lon: l[1] }; }
      else fix = { index: f.i, ident: f.w.ident, lat: f.w.lat, lon: f.w.lon };
      const mv = varAt(fix.lat, fix.lon);
      const r = core.start({ fix, ic: norm360(crs + mv), magVar: mv, dir, legOverrideS: legS, legNM, maxKt, minAltFt, minAltLabel });
      setMsg(r.ok ? '' : r.err);
      if (r.ok && !crsAuto) remember(memKey(), { crs: crsTxt, dir, leg: legTxt, spd: spdTxt, alt: $('#gh-malt').value.trim() });
      else if (r.ok && (legTxt || spdTxt || altTxt || dir < 0)) remember(memKey(), { crs: '', dir, leg: legTxt, spd: spdTxt, alt: $('#gh-malt').value.trim() });
    }
    // one context-aware button: ENTER HOLD when idle, EXIT HOLD while holding (press again to cancel an armed exit)
    function mainAction() { if (core.phase === 'IDLE') enterHold(); else core.requestExit(); }
    $('#gh-enter').addEventListener('click', mainAction);
    $('#gh-leave').addEventListener('click', () => core.leaveNow());

    function setMsg(m) { core.msg = m; }

    // Hotkeys. GeoFS reads its own keys without looking at Shift (H cycles its interface, J switches the controls to joystick),
    // so these are taken in the capture phase and never reach GeoFS.
    const typing = t => t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
    const ours = e => e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.code === 'KeyH' || e.code === 'KeyJ') && !typing(e.target);
    addEventListener('keydown', e => {
      if (!ours(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      if (!muted) audio();
      if (e.code === 'KeyH') setMode((mode + 1) % 3);
      else { mainAction(); if (mode === 2) setMode(1); }   // show at least the pill, so the result is visible
    }, true);
    addEventListener('keyup', e => { if (ours(e)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);

    // autopilot altitude and speed, live, with steppers; click the number to type one
    const apv = () => geofs.autopilot.values;
    function fmtAlt(a) { return Number.isFinite(a) ? Math.round(a) + ' ft' : '---'; }
    function fmtSpd(v) { return !Number.isFinite(v) ? '---' : geofs.autopilot.speedMode === 'mach' ? 'M' + v.toFixed(2).replace(/^0/, '') : Math.round(v) + ' kt'; }
    function speedLimitNow() { return core.speedLimit(geofs.animation.values.altitude || 0); }
    function applySpeed(v) {
      if (geofs.autopilot.speedMode !== 'mach') {
        const lim = speedLimitNow();
        if (core.phase !== 'IDLE' && lim.kt && v > lim.kt) { v = lim.kt; setMsg('Holding speed is limited to ' + lim.kt + ' kt here'); }
      } else if (core.phase !== 'IDLE' && (geofs.animation.values.altitude || 0) > 34000 && v > 0.83) { v = 0.83; setMsg('Holding speed is limited to M0.83 here'); }
      core.setHoldSpeed(v);
    }
    $('#gh-am').addEventListener('click', () => { const a = apv().altitude || 0; core.setHoldAlt(Math.ceil(a / 1000 - 1e-6) * 1000 - 1000); });
    $('#gh-ap').addEventListener('click', () => { const a = apv().altitude || 0; core.setHoldAlt(Math.floor(a / 1000 + 1e-6) * 1000 + 1000); });
    const sStep = d => { const v = apv().speed || 0; if (geofs.autopilot.speedMode === 'mach') applySpeed(Math.round(v * 100 + d) / 100); else applySpeed(d > 0 ? Math.floor(v / 10 + 1e-6) * 10 + 10 : Math.ceil(v / 10 - 1e-6) * 10 - 10); };
    $('#gh-sm').addEventListener('click', () => sStep(-1)); $('#gh-sp').addEventListener('click', () => sStep(1));
    let editing = null;
    function editVal(which) {
      if (editing) return;
      const span = $(which === 'alt' ? '#gh-av' : '#gh-sv'), inp = document.createElement('input');
      inp.value = which === 'alt' ? String(Math.round(apv().altitude || 0)) : (geofs.autopilot.speedMode === 'mach' ? (apv().speed || 0).toFixed(2) : String(Math.round(apv().speed || 0)));
      inp.className = 'gh-num'; span.style.display = 'none'; span.after(inp); editing = which; inp.focus(); inp.select();
      const done = ok => {
        if (!editing) return; editing = null;
        const t = inp.value.trim().toUpperCase().replace(/\s+/g, ''); inp.remove(); span.style.display = '';
        if (!ok || !t) return;
        if (which === 'alt') {
          const m = /^FL(\d{2,3})$/.exec(t), n = m ? +m[1] * 100 : (/^\d{3,5}$/.test(t) ? +t : NaN);
          if (n >= 100 && n <= 60000) core.setHoldAlt(n); else setMsg('Altitude: 9000 or FL90');
        } else {
          const m = /^M?0?\.(\d{2})$/.exec(t);
          if (m && geofs.autopilot.speedMode === 'mach') applySpeed(+('0.' + m[1]));
          else if (/^\d{2,3}$/.test(t) && geofs.autopilot.speedMode !== 'mach') applySpeed(+t);
          else setMsg(geofs.autopilot.speedMode === 'mach' ? 'Speed: Mach, such as M.78' : 'Speed: knots, such as 220');
        }
      };
      ['keydown', 'keyup', 'keypress'].forEach(ev => inp.addEventListener(ev, e => e.stopPropagation()));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => done(false));
    }
    $('#gh-av').addEventListener('click', () => editVal('alt')); $('#gh-sv').addEventListener('click', () => editVal('spd'));

    const P = { inb: $('#gp-inb'), top: $('#gp-top'), out: $('#gp-out'), bot: $('#gp-bot') };
    const ac = $('#gd-ac'), halo = $('#gd-ac-halo'), fixDot = $('#gd-fix');
    let lastGeom = '';

    function drawDiagram(s) {
      // scale the pattern into the 104 x 104 box
      const d = s.idle ? dir : s.dir;
      const r = s.idle || !s.turnR ? 1 : clamp(s.turnR, 0.4, 8);
      const L = s.idle || !s.legNM ? 1.05 : clamp(s.legNM, 0.8, 12);
      const m = 21, k = Math.min((104 - 2 * m) / (2 * r), (104 - 2 * m) / (L + 2 * r));
      const cx = 52 - r * d * k, cy = 52 - (L / 2) * k;       // centre the pattern in the box
      const g = $('#gh-g'), key = [d, r.toFixed(2), L.toFixed(2)].join('|');
      if (key !== lastGeom) {
        lastGeom = key; const t = racetrack(d, r, L);
        P.inb.setAttribute('d', t.inb); P.top.setAttribute('d', t.top); P.out.setAttribute('d', t.out); P.bot.setAttribute('d', t.bot);
        const tf = `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${k.toFixed(3)} ${(-k).toFixed(3)})`;
        g.setAttribute('transform', tf); g.setAttribute('stroke-width', (2.2 / k).toFixed(3));
        fixDot.setAttribute('cx', cx.toFixed(2)); fixDot.setAttribute('cy', cy.toFixed(2));
        P.inb.dataset.k = k; P.inb.dataset.cx = cx; P.inb.dataset.cy = cy;
      }
      const K = +P.inb.dataset.k, CX = +P.inb.dataset.cx, CY = +P.inb.dataset.cy;
      // highlight the leg being flown
      const ph = s.idle ? '' : s.phase, on = '#3ee6d6', off = '#4b6376', am = '#ffc24a';
      P.inb.setAttribute('stroke', ph === 'INBOUND' || ph === 'PAR_OUT' ? on : off);   // a parallel entry flies outbound alongside the inbound leg
      P.out.setAttribute('stroke', ph === 'OUTBOUND' || ph === 'TD_OUT' ? on : off);
      P.top.setAttribute('stroke', ph === 'TURN_OUT' || ph === 'TD_TURN' || ph === 'PAR_TURN' ? am : off);
      P.bot.setAttribute('stroke', ph === 'TURN_IN' ? am : off);
      if (s.idle || s.along == null) { ac.style.display = halo.style.display = 'none'; return; }
      let x = CX + s.cross * K, y = CY - s.along * K, out = false;
      const lim = 7; const cxp = clamp(x, lim, 104 - lim), cyp = clamp(y, lim, 104 - lim);
      if (cxp !== x || cyp !== y) out = true;
      ac.style.display = halo.style.display = '';
      ac.setAttribute('cx', cxp.toFixed(1)); ac.setAttribute('cy', cyp.toFixed(1));
      halo.setAttribute('cx', cxp.toFixed(1)); halo.setAttribute('cy', cyp.toFixed(1));
      ac.setAttribute('opacity', out ? '.55' : '1'); halo.setAttribute('opacity', out ? '.4' : '1');
    }

    // the hold on GeoFS's own map (Leaflet), once the aircraft is in it, scaled to the real turn radius and leg length
    let mapLine = null, mapDot = null, mapKey = '';
    function clearMap() { try { if (mapLine) mapLine.remove(); if (mapDot) mapDot.remove(); } catch (e) { /* map gone */ } mapLine = mapDot = null; mapKey = ''; }
    function drawMap(s) {
      const m = window.L && geofs.api && geofs.api.map && geofs.api.map._map;
      if (s.idle || !s.inHold || !m || !core.fix) return clearMap();
      const r = s.turnR ? clamp(s.turnR, 0.3, 10) : 1.5, Lg = s.legNM ? clamp(s.legNM, 0.5, 30) : 4;
      const key = [core.fix.lat, core.fix.lon, core.ic, core.dir, r.toFixed(1), Lg.toFixed(1)].join('|');
      if (key === mapKey && mapLine && mapLine._map === m) return;
      clearMap(); mapKey = key;
      try {
        mapLine = L.polyline(racetrackLatLon(core.fix, core.ic, core.dir, r, Lg), { color: '#3ee6d6', weight: 3, opacity: 0.9, interactive: false }).addTo(m);
        mapDot = L.circleMarker([core.fix.lat, core.fix.lon], { radius: 5, color: '#e8f1f6', weight: 2, fillColor: '#0b1118', fillOpacity: 1, interactive: false }).addTo(m);
      } catch (e) { clearMap(); }
    }

    // the panel's content (and so its height) can change: pull it back on screen if it has grown past an edge
    function keepOnScreen() {
      if (drag || mode === 2 || !root.offsetWidth) return;
      const r = root.getBoundingClientRect();
      if (r.bottom > innerHeight - 3 || r.right > innerWidth - 3 || r.top < 3 || r.left < 3) place(parseFloat(root.style.left) || r.left, parseFloat(root.style.top) || r.top);
    }

    let efcSeen = '', efcStage = 0, flashT = 0;
    function flash() { root.classList.remove('flash'); void root.offsetWidth; root.classList.add('flash'); clearTimeout(flashT); flashT = setTimeout(() => root.classList.remove('flash'), 2000); }

    function render() {
      refreshFixes(); keepOnScreen();
      if (core.phase === 'IDLE') fillAuto();
      // chimes queued by the hold engine
      if (core.events && core.events.length) { const ev = core.events.splice(0); ev.forEach(k => chime(k)); }
      const s = core.status(), active = !s.idle;
      root.classList.toggle('run', active);
      root.classList.toggle('inhold', active && !!s.inHold);
      root.classList.toggle('turn', active && !!TURN_PH[s.phase]);
      root.classList.toggle('armed', active && !!s.exitPending);
      $('#gh-enter').textContent = !active ? 'ENTER HOLD' : (s.exitPending ? 'EXIT ARMED' : 'EXIT HOLD');
      $('#gh-enter').title = !active ? 'Shift+J' : (s.exitPending ? 'Click to cancel the exit and keep holding' : 'Leave at the fix, on the inbound leg (Shift+J)');
      let idleWarn = '';
      if (!active) {
        const arr = geofs.flightPlan.waypointArray || [], f = selFix(), tw = geofs.flightPlan.trackedWaypoint;
        if (f && f.w && tw && Number.isFinite(tw.id) && f.i < tw.id && geofs.autopilot.mode === 'NAV') idleWarn = 'This fix is behind you on the route';
        else if (f && f.w && f.i === arr.length - 1) idleWarn = 'Last waypoint in the plan: after the exit you stay on HDG';
      }
      $('#gh-msg').textContent = s.msg || (s.exitPending ? 'Exit armed: will leave from the fix on the inbound leg' : (s.warn || s.altWarn || s.speedWarn || idleWarn));
      const armed = active && s.phase === 'APPROACH' && s.nav;   // still following the route, hold not started
      const stTxt = s.idle ? 'Idle' : (armed ? 'Armed, following route' : (PHASE_TXT[s.phase] || s.phase));
      $('#r-status').textContent = stTxt;
      $('#r-status').style.color = active && TURN_PH[s.phase] ? 'var(--am)' : '';
      const lap = s.inHold && s.held != null ? 'LAP ' + (s.laps + 1) + ' · ' + hms(s.held) : '';
      $('#r-entry').textContent = active && s.phase === 'APPROACH' && s.eta != null ? 'ETA ' + hms(s.eta) : (s.entry || lap);
      let tl = 'Timer', tv = '--:--';
      if (active) {
        if (s.timerLabel) { tl = s.timerLabel; tv = s.timerNM !== undefined ? (s.timerNM == null ? '-- NM' : s.timerNM.toFixed(1) + ' NM') : mmss(s.timer); }
        else if (s.dist != null) { tl = 'To fix'; tv = (s.routeDist != null ? s.routeDist : s.dist).toFixed(1) + ' NM'; }
      }
      $('#r-tl').textContent = tl; $('#r-timer').textContent = tv;
      let cap = '---';
      try {
        const l = geofs.aircraft.instance.llaLocation, f = !active ? selFix() : null;
        if (f && f.w && l) cap = (f.w.ident || 'FIX') + '  ' + gcDistNM(l[0], l[1], f.w.lat, f.w.lon).toFixed(1) + ' NM';
        else if (active && s.dist != null) cap = s.dist.toFixed(1) + ' NM  ' + hdg3(s.brg - core.magVar) + '°M';
      } catch (e) { cap = '---'; }
      $('#r-fix').textContent = cap;
      $('#gh-hfix').textContent = active && core.fix ? (core.fix.ident || '') : '';
      $('#r-wca').textContent = s.idle || s.wca == null ? '---' : (Math.abs(s.wca) < 0.5 ? '0°' : Math.abs(s.wca).toFixed(0) + '° ' + (s.wca > 0 ? 'R' : 'L'));
      $('#r-spd').textContent = s.idle ? '---' : (s.speedNote || '---').replace(/^max\s*/i, '');
      $('#r-spd').className = 'gh-num' + (!s.idle && s.speedWarn ? ' amber' : '');
      // course hint: what the typed magnetic course is in GeoFS's true terms
      if (!active) {
        const f = selFix(), c = $('#gh-crs').value.trim();
        let hint = '';
        if (f && /^\d{1,3}$/.test(c) && +c <= 360) {
          const l = geofs.aircraft.instance.llaLocation, v = f.here ? varAt(l[0], l[1]) : varAt(f.w.lat, f.w.lon);
          hint = '= ' + hdg3(+c + v) + '°T';
          $('#gh-crs').title = 'Magnetic variation here ' + Math.abs(v).toFixed(1) + '° ' + (v > 0 ? 'E' : 'W') + ': GeoFS flies ' + hdg3(+c + v) + '° true';
        }
        $('#gh-crshint').textContent = hint;
      }
      // live autopilot values
      if (active) {
        if (editing !== 'alt') $('#gh-av').textContent = fmtAlt(apv().altitude);
        if (editing !== 'spd') $('#gh-sv').textContent = fmtSpd(apv().speed);
        const mach = geofs.autopilot.speedMode === 'mach';
        $('#gh-sm').title = mach ? '-M.01' : '-10 kt'; $('#gh-sp').title = mach ? '+M.01' : '+10 kt';
      }
      // EFC: amber from 5 minutes before, red at EFC, with a chime and a flash at each stage
      const ms = efcMs(), e = $('#r-efc'), efcTxt = $('#gh-efc').value.trim();
      e.className = 'gh-num';
      if (efcTxt !== efcSeen) { efcSeen = efcTxt; efcStage = ms == null ? 0 : ms <= 0 ? 2 : ms <= 300e3 ? 1 : 0; }   // a time typed late does not chime
      let stage = 0;
      if (ms == null) e.textContent = '---';
      else {
        const sec = Math.floor(Math.abs(ms) / 1000);
        e.textContent = (ms < 0 ? '+' : 'T-') + hms(sec);
        stage = ms <= 0 ? 2 : ms <= 300e3 ? 1 : 0;
        if (stage === 2) e.className = 'gh-num red'; else if (stage === 1) e.className = 'gh-num amber';
        if (stage > efcStage) { efcStage = stage; chime(stage === 2 ? 'efc0' : 'efc5'); flash(); }
      }
      root.classList.toggle('efc5', stage === 1); root.classList.toggle('efc0', stage === 2);
      // slim pill
      $('#gh-pfix').textContent = active && core.fix ? (core.fix.ident || 'FIX') : '';
      $('#gh-pst').textContent = !active ? 'IDLE' : (armed ? 'ARMED' : (PHASE_PILL[s.phase] || '')) + (s.entry ? ' · ' + s.entry.slice(0, 3) : (s.inHold ? ' · L' + (s.laps + 1) : ''));
      $('#gh-ptm').textContent = active && (s.timerLabel ? (s.timerNM !== undefined ? (s.timerNM == null ? '-- NM' : s.timerNM.toFixed(1) + ' NM') : mmss(s.timer)) : (s.dist != null ? (s.routeDist != null ? s.routeDist : s.dist).toFixed(1) + ' NM' : ''));
      drawDiagram(s);
      drawMap(s);
    }
    markPreset();
    return render;
  }

  function init() {
    if (window.__geofsHold) return;   // installed twice (two script managers): run one copy only
    const core = new HoldCore(makeIO());
    window.__geofsHold = core;
    hookSelect(core);
    const render = buildUI(core);
    setInterval(() => {
      try { hookSelect(core); core.tick(); render(); } catch (err) { console.error('[GeoFS Hold]', err); }
    }, 250);
  }

  const wait = setInterval(() => {
    if (window.geofs && geofs.autopilot && geofs.flightPlan && geofs.animation && geofs.animation.values &&
        geofs.aircraft && geofs.aircraft.instance && geofs.aircraft.instance.llaLocation && document.body) {
      clearInterval(wait); init();
    }
  }, 1000);
})();
