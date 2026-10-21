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
// @version      1.2.2
// @description  Flies a real ICAO racetrack hold on any FMC waypoint: sector-based entries, standard-rate turns, wind-corrected tracks, outbound timing trimmed from the inbound leg, NAV re-engaged on exit.
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
    }

    legTime(altFt) { return this.legOverrideS || legTimeAuto(altFt); }

    start(cfg) {
      if (this.phase !== 'IDLE') return { ok: false, err: 'Hold already active: press EXIT HOLD first' };
      const ap = this.io.ap();
      if (!ap.on) return { ok: false, err: 'Engage the autopilot first' };
      if (!cfg.fix) return { ok: false, err: 'No holding fix selected' };
      const s = this.io.read();
      this.reset();
      this.fix = cfg.fix; this.ic = norm360(cfg.ic); this.dir = cfg.dir >= 0 ? 1 : -1;
      this.legOverrideS = cfg.legOverrideS || null;
      this.savedSpeed = ap.speed || 0; this.savedMode = ap.speedMode;
      this.io.setCourse(Math.round(s.hdg));
      this.io.setMode('HDG');
      if (this.io.ap().mode !== 'HDG') { this.reset(); return { ok: false, err: 'Could not switch autopilot to HDG' }; }
      this.outTime = this.legTime(s.altFt);
      this.baseLeg = this.outTime;
      this.phase = 'APPROACH';
      return { ok: true };
    }

    requestExit() {
      if (this.phase === 'IDLE') return;
      if (this.phase === 'APPROACH') { // not yet in the hold: resume NAV to the fix itself
        this.io.setMode('NAV');
        this.finish('Hold cancelled, NAV direct to ' + (this.fix.ident || 'fix'));
        return;
      }
      this.exitRequested = true;
    }

    abort(msg) { this.finish(msg); }

    finish(msg) {
      // give the pilot their speed back, unless they have changed it themselves since we lowered it
      if (this.speedChanged && this.savedSpeed > 0 && this.io.ap().speed === this.lastSetSpeed && this.io.ap().speedMode === this.speedModeSet && this.savedMode === this.speedModeSet) this.io.setSpeed(this.savedSpeed);
      this.reset();
      this.msg = msg;
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
      // integral action on the measured turn rate. GeoFS banks roughly 1 deg per deg of heading error,
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

    manageSpeed(s, t) {
      if (t - this.lastSpeedT < 2) return;
      this.lastSpeedT = t;
      const m = maxHoldSpeed(s.altFt), ap = this.io.ap();
      this.speedNote = 'max ' + m.label;
      if (m.kt == null) {
        // above FL340 the ICAO limit is Mach 0.83: apply it when the autopilot holds Mach, otherwise leave the pilot to set it
        if (ap.speedMode === 'mach') {
          if (ap.speed > 0.83) { this.io.setSpeed(0.83); this.speedChanged = true; this.lastSetSpeed = 0.83; this.speedModeSet = 'mach'; }
        } else this.speedNote += ' (set Mach by hand)';
        return;
      }
      if (ap.speedMode !== 'knots') { this.speedNote += ' (AP not in knots)'; return; }
      if (ap.speed > 0 && ap.speed > m.kt) { this.io.setSpeed(m.kt); this.speedChanged = true; this.lastSetSpeed = m.kt; this.speedModeSet = 'knots'; }
      else if (!(ap.speed > 0) && s.kias > m.kt + 2) this.speedNote += ' (reduce by hand)';
    }

    /* ---- state machine ---- */
    tick() {
      if (this.phase === 'IDLE') return;
      const ap = this.io.ap();
      if (!ap.on) return this.abort('Autopilot off, hold cancelled');
      if (ap.mode !== 'HDG') return this.abort('Autopilot mode changed, hold cancelled');
      const t = this.io.now(), s = this.io.read();
      this.update(s, t);
      if (this.dt === 0) return;
      this.manageSpeed(s, t);
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
            if (t - this.timerStart >= this.outTime) { this.phase = 'TURN_IN'; this.turnInDir = dir; }
          }
          break;
        }
        case 'TD_TURN': {
          if (this.steer(this.trackHdg(O - dir * 30), 0) <= 3) { this.phase = 'TD_OUT'; this.timerStart = t; this.timerRunning = true; }
          break;
        }
        case 'TD_OUT': {
          this.steer(this.trackHdg(O - dir * 30), 0);
          if (t - this.timerStart >= this.legTime(s.altFt)) { this.phase = 'TURN_IN'; this.turnInDir = dir; }
          break;
        }
        case 'PAR_TURN': {
          if (this.steer(this.trackHdg(O), 0) <= 3) { this.phase = 'PAR_OUT'; this.timerStart = t; this.timerRunning = true; }
          break;
        }
        case 'PAR_OUT': {
          this.steer(this.trackHdg(O), 0);
          if (t - this.timerStart >= this.legTime(s.altFt)) { this.phase = 'TURN_IN'; this.turnInDir = -dir; }
          break;
        }
        case 'TURN_IN': {
          if (this.steer(this.inboundHdg(), this.turnInDir) <= 3) {
            this.phase = 'INBOUND'; this.inStart = t; this.lastAlong = null; this.inboundTimed = !this.entryPending;
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
            this.entryPending = false; this.entry = null;
            if (this.exitRequested) return this.finishExit();
            this.phase = 'TURN_OUT'; this.timerRunning = false;
          }
          break;
        }
      }
    }

    // ICAO: leave the hold from the fix, on the inbound leg
    finishExit() {
      // find the fix in the flight plan as it is now: the pilot may have edited the plan during the hold
      const name = this.fix.ident || 'fix';
      const idx = this.io.findFix ? this.io.findFix(this.fix) : this.fix.index;
      if (idx < 0) this.finish('Left the hold at ' + name + ', but it is no longer in the flight plan: autopilot left on HDG');
      else if (this.io.hasNext(idx)) {
        this.io.gotoNext(idx);
        this.io.setMode('NAV');
        this.finish('Left the hold at ' + name + ', NAV to next waypoint');
      } else {
        this.finish('Left the hold at ' + name + ', it was the last waypoint: autopilot left on HDG');
      }
    }

    /* ---- for the panel ---- */
    status() {
      const idle = this.phase === 'IDLE';
      const out = { idle, msg: this.msg, phase: this.phase, entry: this.entry, exitPending: this.exitRequested };
      if (idle || !this.s || !this.geo) return out;
      const t = this.lastT;
      out.dist = this.geo.d; out.brg = this.geo.b;
      out.wca = this.wind.valid ? this.wca(this.phase === 'INBOUND' || this.phase === 'TURN_IN' ? this.ic : norm360(this.ic + 180)) : null;
      out.speedNote = this.speedNote;
      out.cmdHdg = this.cmdHdg;
      if ((this.phase === 'OUTBOUND') || this.phase === 'TD_OUT' || this.phase === 'PAR_OUT') {
        const total = this.phase === 'OUTBOUND' ? this.outTime : this.legTime(this.s.altFt);
        out.timerLabel = 'OUTBOUND';
        out.timer = this.timerRunning ? Math.max(0, total - (t - this.timerStart)) : null;
      } else if (this.phase === 'INBOUND') {
        out.timerLabel = 'TO FIX';
        out.timer = this.gs > 20 ? Math.max(0, -this.geo.along / this.gs * 3600) : null;
      }
      out.lastInboundErr = this.lastInboundErr;
      out.outTime = this.outTime;
      return out;
    }
  }

  /* ================= test export ================= */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { HoldCore, classifyEntry, maxHoldSpeed, legTimeAuto, tasFromKias, gcBearing, gcDistNM, localNM, norm360, norm180 };
    return;
  }

  /* ================= GeoFS glue ================= */
  // Simulation clock. GeoFS caps the time step of each frame at 0.1 s, so below 10 fps the aircraft flies in slow motion
  // while the wall clock keeps running. Every timer in the hold must follow the aircraft, not the wall clock.
  function makeSimClock() {
    let lastF = null, lastW = 0, simT = 0;
    return () => {
      const w = performance.now() / 1000, f = window.geofs && geofs.frameNumber;
      if (typeof f !== 'number') return w;
      if (lastF == null) { lastF = f; lastW = w; return simT; }
      if (f !== lastF) {
        const frames = f - lastF, avg = (w - lastW) / frames;
        if (frames > 0 && !geofs.pause) simT += frames * Math.min(avg, 0.1);
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
      ap: () => ({ on: !!geofs.autopilot.on, mode: geofs.autopilot.mode, speed: geofs.autopilot.values.speed, speedMode: geofs.autopilot.speedMode }),
      setCourse: d => geofs.autopilot.setCourse(d),
      setMode: m => geofs.autopilot.setMode(m),
      setSpeed: kt => geofs.autopilot.setSpeed(kt),
      hasNext: i => i + 1 < geofs.flightPlan.waypointArray.length,
      findFix: f => {
        const a = geofs.flightPlan.waypointArray || [];
        for (let i = 0; i < a.length; i++) if (a[i].ident === f.ident && Math.abs(a[i].lat - f.lat) < 1e-4 && Math.abs(a[i].lon - f.lon) < 1e-4) return i;
        return -1;
      },
      // Track waypoint i+1. gotoWaypoint() also resets the autopilot PIDs, which in GeoFS
      // causes a sudden speed/altitude loss, so use selectWaypoint() when available.
      gotoNext: i => {
        const fp = geofs.flightPlan;
        if (typeof fp.selectWaypoint === 'function') fp.selectWaypoint(i + 1);
        else fp.gotoWaypoint(i);
      }
    };
  }

  const CSS = `
  #ghold{position:fixed;top:84px;right:12px;width:268px;z-index:99999;font:12px/1.35 ui-monospace,Menlo,Consolas,monospace;color:#dfe7ef;
    background:rgba(10,14,20,.84);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.5);user-select:none}
  #ghold .gh-head{display:flex;justify-content:space-between;align-items:center;padding:7px 10px;cursor:move;border-bottom:1px solid rgba(255,255,255,.1);letter-spacing:.14em;font-weight:700;color:#5be3a1}
  #ghold button{font:inherit;color:#dfe7ef;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:5px 8px;cursor:pointer}
  #ghold button:hover{background:rgba(255,255,255,.16)}
  #ghold .gh-body{padding:10px;display:flex;flex-direction:column;gap:7px}
  #ghold.min .gh-body{display:none}
  #ghold label{display:flex;justify-content:space-between;align-items:center;gap:8px;color:#8fa0b3;font-size:11px;letter-spacing:.06em}
  #ghold input,#ghold select{width:118px;font:inherit;color:#fff;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.2);border-radius:5px;padding:4px 6px;box-sizing:border-box;user-select:text}
  #ghold .gh-row{display:flex;gap:6px}
  #ghold .gh-row button{flex:1}
  #ghold .gh-seg button.on{background:#5be3a1;color:#06150d;border-color:#5be3a1;font-weight:700}
  #ghold #gh-enter{background:#1f6f4a;border-color:#2fa56f;font-weight:700}
  #ghold #gh-exit{background:#6f2f1f;border-color:#a5502f;font-weight:700}
  #ghold .gh-read{border-top:1px solid rgba(255,255,255,.1);padding-top:7px;display:grid;grid-template-columns:auto 1fr;gap:2px 10px}
  #ghold .gh-read span:nth-child(odd){color:#8fa0b3}
  #ghold .gh-read span:nth-child(even){text-align:right;color:#fff}
  #ghold #gh-msg{min-height:15px;color:#ffcf5a}
  #ghold .amber{color:#ffcf5a!important}#ghold .red{color:#ff6b6b!important}`;

  const pad = (n, w) => String(Math.round(n)).padStart(w, '0');
  const hdg3 = d => pad(norm360(d) === 0 ? 360 : norm360(d), 3);
  const mmss = s => (s == null ? '--:--' : pad(Math.floor(s / 60), 2) + ':' + pad(Math.floor(s % 60), 2));
  const PHASE_TXT = {
    APPROACH: 'DIRECT TO FIX', TURN_OUT: 'TURN OUTBOUND', OUTBOUND: 'OUTBOUND', TURN_IN: 'TURN INBOUND', INBOUND: 'INBOUND',
    TD_TURN: 'TEARDROP: TURN', TD_OUT: 'TEARDROP: OUT', PAR_TURN: 'PARALLEL: TURN', PAR_OUT: 'PARALLEL: OUT'
  };

  function buildUI(core) {
    const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'ghold';
    root.innerHTML = `
      <div class="gh-head"><span>HOLD</span><button class="gh-min" title="Minimise">&ndash;</button></div>
      <div class="gh-body">
        <label>FIX <select id="gh-fix"></select></label>
        <label>INBOUND CRS <input id="gh-crs" inputmode="numeric" maxlength="3" placeholder="270"></label>
        <label>TURNS <span class="gh-row gh-seg" style="width:118px"><button data-dir="1" class="on">RIGHT</button><button data-dir="-1">LEFT</button></span></label>
        <label>LEG (min) <input id="gh-leg" placeholder="AUTO"></label>
        <label>EFC (UTC) <input id="gh-efc" inputmode="numeric" maxlength="4" placeholder="HHMM"></label>
        <div class="gh-row"><button id="gh-enter">ENTER HOLD</button><button id="gh-exit">EXIT HOLD</button></div>
        <div id="gh-msg"></div>
        <div class="gh-read">
          <span>STATUS</span><span id="r-status">IDLE</span>
          <span id="r-tl">TIMER</span><span id="r-timer">--:--</span>
          <span>FIX</span><span id="r-fix">---</span>
          <span>WIND CORR</span><span id="r-wca">---</span>
          <span>SPEED</span><span id="r-spd">---</span>
          <span>EFC</span><span id="r-efc">---</span>
        </div>
      </div>`;
    document.body.appendChild(root);
    const $ = id => root.querySelector(id);

    // keep every keystroke away from GeoFS controls while typing
    root.querySelectorAll('input,select').forEach(el => ['keydown', 'keyup', 'keypress'].forEach(ev => el.addEventListener(ev, e => e.stopPropagation())));

    // drag + minimise
    const head = $('.gh-head'); let drag = null;
    head.addEventListener('mousedown', e => { if (e.target.closest('button')) return; const r = root.getBoundingClientRect(); drag = { x: e.clientX - r.left, y: e.clientY - r.top }; });
    window.addEventListener('mousemove', e => { if (!drag) return; root.style.left = (e.clientX - drag.x) + 'px'; root.style.top = (e.clientY - drag.y) + 'px'; root.style.right = 'auto'; });
    window.addEventListener('mouseup', () => { drag = null; });
    $('.gh-min').addEventListener('click', () => root.classList.toggle('min'));

    let dir = 1;
    root.querySelectorAll('.gh-seg button').forEach(b => b.addEventListener('click', () => {
      dir = +b.dataset.dir; root.querySelectorAll('.gh-seg button').forEach(x => x.classList.toggle('on', x === b));
    }));

    // FMC waypoint dropdown, rebuilt only when the flight plan changes
    let sig = '';
    function refreshFixes() {
      const arr = geofs.flightPlan.waypointArray || [];
      const s2 = arr.map(w => w.ident + w.lat + w.lon).join('|');
      if (s2 === sig) return; sig = s2;
      const sel = $('#gh-fix'), keep = sel.value;
      sel.innerHTML = arr.length ? '' : '<option value="">no flight plan</option>';
      arr.forEach((w, i) => { const o = document.createElement('option'); o.value = i; o.textContent = (i + 1) + '  ' + (w.ident || 'WPT'); sel.appendChild(o); });
      if (keep !== '' && arr[keep]) sel.value = keep;
    }

    function efcMs() {
      const v = $('#gh-efc').value.trim();
      if (!/^\d{4}$/.test(v)) return null;
      const hh = +v.slice(0, 2), mm = +v.slice(2);
      if (hh > 23 || mm > 59) return null;
      const now = new Date();
      let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm);
      if (t - now.getTime() < -6 * 3600e3) t += 86400e3;
      return t - now.getTime();
    }

    $('#gh-enter').addEventListener('click', () => {
      const arr = geofs.flightPlan.waypointArray || [], idx = +$('#gh-fix').value, w = arr[idx];
      const crsTxt = $('#gh-crs').value.trim(), crs = +crsTxt;
      if (!w) return setMsg('Pick a holding fix from the flight plan');
      if (!/^\d{1,3}$/.test(crsTxt) || crs > 360) return setMsg('Inbound course must be 0 to 360');
      const legTxt = $('#gh-leg').value.trim();
      let legS = null;
      if (legTxt && legTxt.toUpperCase() !== 'AUTO') { const m = parseFloat(legTxt); if (!(m >= 0.5 && m <= 5)) return setMsg('Leg time: AUTO or 0.5 to 5 min'); legS = m * 60; }
      const r = core.start({ fix: { index: idx, ident: w.ident, lat: w.lat, lon: w.lon }, ic: crs, dir, legOverrideS: legS });
      setMsg(r.ok ? '' : r.err);
    });
    $('#gh-exit').addEventListener('click', () => { core.requestExit(); });

    function setMsg(m) { core.msg = m; }

    function render() {
      refreshFixes();
      const s = core.status();
      $('#gh-msg').textContent = s.msg || (s.exitPending ? 'Exit armed: will leave from the fix on the inbound leg' : '');
      $('#r-status').textContent = s.idle ? 'IDLE' : (PHASE_TXT[s.phase] || s.phase) + (s.entry ? ' / ' + s.entry : '');
      $('#r-tl').textContent = s.timerLabel || 'TIMER';
      $('#r-timer').textContent = s.idle ? '--:--' : mmss(s.timer);
      $('#r-fix').textContent = s.idle ? '---' : s.dist.toFixed(1) + ' NM  ' + hdg3(s.brg) + '\u00B0';
      $('#r-wca').textContent = s.idle || s.wca == null ? '---' : (Math.abs(s.wca) < 0.5 ? '0\u00B0' : Math.abs(s.wca).toFixed(0) + '\u00B0 ' + (s.wca > 0 ? 'R' : 'L'));
      $('#r-spd').textContent = s.idle ? '---' : s.speedNote || '---';
      const ms = efcMs(), e = $('#r-efc');
      e.className = '';
      if (ms == null) e.textContent = '---';
      else {
        const sec = Math.abs(ms) / 1000;
        e.textContent = (ms < 0 ? '+' : 'T-') + (sec >= 3600 ? Math.floor(sec / 3600) + ':' + pad(Math.floor(sec % 3600 / 60), 2) + ':' + pad(sec % 60, 2) : mmss(sec));
        if (ms < 0) e.className = 'red'; else if (ms < 300e3) e.className = 'amber';
      }
    }
    return render;
  }

  function init() {
    const core = new HoldCore(makeIO());
    const render = buildUI(core);
    setInterval(() => { try { core.tick(); render(); } catch (err) { console.error('[GeoFS Hold]', err); } }, 250);
    window.__geofsHold = core;
  }

  const wait = setInterval(() => {
    if (window.geofs && geofs.autopilot && geofs.flightPlan && geofs.animation && geofs.animation.values &&
        geofs.aircraft && geofs.aircraft.instance && geofs.aircraft.instance.llaLocation && document.body) {
      clearInterval(wait); init();
    }
  }, 1000);
})();
