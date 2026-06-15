// audio.js — procedural Web Audio SFX. No assets.
//
// One AudioContext, one master gain. All sounds synthesised on demand from
// short noise buffers + oscillators + biquad filters. Browser policy needs
// a user gesture before audio plays, so call prime() from onPointerDown
// before any sound.
//
// Sounds:
//   ambience(on)   gentle filtered low-noise water hush (loop)
//   boostOn/Off()  hi-passed noise whoosh while riding the current lane
//   stroke()       single paddle-dip thwack — fire once per row cycle
//   impact(mag)    wood thud + spray for a rock hit (mag in [1..20])
//   pickup()       two-note bell for apple collect
//   capsize()      big splash + low wood creak on death
//
// All methods are no-ops if the context isn't ready or the audio module is
// muted. Callers don't need to guard.

export function createAudio() {
  let ctx = null;
  let master = null;
  let ambSources = null;     // {flowSrc, flowGain, flowBp, lfo, lfoGain, rumbleSrc, rumbleGain}
  let boostGain = null;
  let boostSrc = null;
  let muted = false;

  function ensureCtx() {
    if (ctx) return ctx;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    try {
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = 0.55;
      master.connect(ctx.destination);
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function prime() {
    const c = ensureCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  }

  function _noiseBuffer(duration = 0.3) {
    const c = ensureCtx();
    if (!c) return null;
    const len = Math.max(1, Math.floor(c.sampleRate * duration));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function stroke() {
    const c = ensureCtx();
    if (!c || muted) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = _noiseBuffer(0.18);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 880 + Math.random() * 200;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.20);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 0.22);
  }

  function impact(mag) {
    const c = ensureCtx();
    if (!c || muted) return;
    const m = Math.min(1, Math.max(0.3, (mag || 5) / 10));
    const t = c.currentTime;
    // wood thud — low sine sweep
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170 * (0.8 + m * 0.5), t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.20);
    const gT = c.createGain();
    gT.gain.setValueAtTime(0.36 * m, t);
    gT.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
    o.connect(gT).connect(master);
    o.start(t); o.stop(t + 0.28);
    // splash transient — hipass noise
    const src = c.createBufferSource();
    src.buffer = _noiseBuffer(0.34);
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 620;
    const gS = c.createGain();
    gS.gain.setValueAtTime(0.22 * m, t);
    gS.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
    src.connect(hp).connect(gS).connect(master);
    src.start(t); src.stop(t + 0.34);
  }

  function pickup() {
    const c = ensureCtx();
    if (!c || muted) return;
    const t = c.currentTime;
    for (const [f, delay, dur] of [[880, 0, 0.30], [1320, 0.06, 0.34]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.18, t + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
      o.connect(g).connect(master);
      o.start(t + delay); o.stop(t + delay + dur + 0.02);
    }
  }

  function capsize() {
    const c = ensureCtx();
    if (!c || muted) return;
    const t = c.currentTime;
    // big splash
    const src = c.createBufferSource();
    src.buffer = _noiseBuffer(0.85);
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1200; bp.Q.value = 0.6;
    const g = c.createGain();
    g.gain.setValueAtTime(0.38, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.78);
    src.connect(bp).connect(g).connect(master);
    src.start(t); src.stop(t + 0.85);
    // wood creak — slow descending sawtooth through lowpass
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.55);
    const gW = c.createGain();
    gW.gain.setValueAtTime(0.18, t);
    gW.gain.exponentialRampToValueAtTime(0.001, t + 0.62);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 480;
    o.connect(lp).connect(gW).connect(master);
    o.start(t); o.stop(t + 0.68);
  }

  // Ambience = two layered loops:
  //   flow     bandpassed noise around 1100 Hz with a slow LFO on the cutoff
  //            → reads as running water, not just a hum.
  //   rumble   lowpassed noise around 380 Hz for the river-bed underbelly.
  // Both fade in/out on toggle. setFlow(speedNorm) modulates the flow layer
  // so the rushing rises with boat speed.
  function ambience(on) {
    const c = ensureCtx();
    if (!c) return;
    if (on && !ambSources) {
      const flowSrc = c.createBufferSource();
      flowSrc.buffer = _noiseBuffer(3);
      flowSrc.loop = true;
      const flowBp = c.createBiquadFilter();
      flowBp.type = 'bandpass';
      flowBp.frequency.value = 1100;
      flowBp.Q.value = 0.85;
      // LFO modulates the bandpass center so the texture moves
      const lfo = c.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.32;
      const lfoGain = c.createGain();
      lfoGain.gain.value = 260;
      lfo.connect(lfoGain).connect(flowBp.frequency);
      lfo.start();
      const flowGain = c.createGain();
      flowGain.gain.value = 0;
      flowSrc.connect(flowBp).connect(flowGain).connect(master);
      flowSrc.start();
      flowGain.gain.linearRampToValueAtTime(0.10, c.currentTime + 1.0);

      const rumbleSrc = c.createBufferSource();
      rumbleSrc.buffer = _noiseBuffer(3);
      rumbleSrc.loop = true;
      const rumbleLp = c.createBiquadFilter();
      rumbleLp.type = 'lowpass';
      rumbleLp.frequency.value = 380;
      const rumbleGain = c.createGain();
      rumbleGain.gain.value = 0;
      rumbleSrc.connect(rumbleLp).connect(rumbleGain).connect(master);
      rumbleSrc.start();
      rumbleGain.gain.linearRampToValueAtTime(0.045, c.currentTime + 1.0);

      ambSources = { flowSrc, flowGain, flowBp, lfo, lfoGain, rumbleSrc, rumbleGain };
    } else if (!on && ambSources) {
      const a = ambSources; ambSources = null;
      a.flowGain.gain.cancelScheduledValues(c.currentTime);
      a.flowGain.gain.setValueAtTime(a.flowGain.gain.value, c.currentTime);
      a.flowGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
      a.rumbleGain.gain.cancelScheduledValues(c.currentTime);
      a.rumbleGain.gain.setValueAtTime(a.rumbleGain.gain.value, c.currentTime);
      a.rumbleGain.gain.linearRampToValueAtTime(0, c.currentTime + 0.4);
    }
  }

  // 0..1, modulates flow loudness + cutoff so a fast boat audibly carves water
  function setFlow(speedNorm) {
    if (!ctx || !ambSources || muted) return;
    const s = Math.max(0, Math.min(1, speedNorm));
    const t = ctx.currentTime;
    ambSources.flowGain.gain.setTargetAtTime(0.10 + s * 0.10, t, 0.20);
    ambSources.flowBp.frequency.setTargetAtTime(1050 + s * 500, t, 0.20);
  }

  function boostOn() {
    const c = ensureCtx();
    if (!c || muted || boostGain) return;
    boostSrc = c.createBufferSource();
    boostSrc.buffer = _noiseBuffer(2);
    boostSrc.loop = true;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 1300;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 4400;
    boostGain = c.createGain();
    boostGain.gain.value = 0.0;
    boostSrc.connect(hp).connect(lp).connect(boostGain).connect(master);
    boostSrc.start();
    boostGain.gain.linearRampToValueAtTime(0.13, c.currentTime + 0.18);
  }

  function boostOff() {
    if (!ctx || !boostGain) return;
    const g = boostGain; const s = boostSrc;
    boostGain = null; boostSrc = null;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.50);
    setTimeout(() => { try { s.stop(); } catch (e) { /* */ } }, 650);
  }

  function setMute(m) {
    muted = !!m;
    if (muted) boostOff();
  }

  return { prime, stroke, impact, pickup, capsize, ambience, setFlow, boostOn, boostOff, setMute };
}
