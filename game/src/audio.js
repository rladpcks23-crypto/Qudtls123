// Everything is synthesised with the WebAudio API - the game ships with no audio files.
import { clamp } from './util.js';

export class Audio {
  constructor() {
    this.ctx = null; this.ready = false; this.muted = false;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.55; this.master.connect(ctx.destination);

    // A short reverb tail gives the city some space.
    const conv = ctx.createConvolver();
    const len = ctx.sampleRate * 1.1, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    conv.buffer = buf;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.16;
    conv.connect(this.wet); this.wet.connect(this.master);
    this.reverb = conv;

    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    this.buildEngine();
    this.buildSiren();
    this.ready = true;
  }

  noise(dur = 0.2) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    s.start(); s.stop(this.ctx.currentTime + dur);
    return s;
  }

  // --- persistent engine sound, pitch follows rpm -------------------------
  buildEngine() {
    const ctx = this.ctx;
    const g = this.engGain = ctx.createGain(); g.gain.value = 0;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900; filt.Q.value = 3;
    const o1 = this.engOsc = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
    const o2 = this.engOsc2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const rumble = ctx.createBufferSource(); rumble.buffer = this.noiseBuf; rumble.loop = true;
    const rg = this.engNoise = ctx.createGain(); rg.gain.value = 0;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 220; rf.Q.value = 0.8;
    o1.connect(filt); o2.connect(g2); g2.connect(filt);
    rumble.connect(rf); rf.connect(rg); rg.connect(g);
    filt.connect(g); g.connect(this.master);
    this.engFilt = filt;
    o1.start(); o2.start(); rumble.start();
  }

  engine(rpm01, load) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const f = 42 + rpm01 * 210;
    this.engOsc.frequency.setTargetAtTime(f, t, 0.06);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.06);
    this.engFilt.frequency.setTargetAtTime(480 + rpm01 * 2100, t, 0.08);
    this.engGain.gain.setTargetAtTime(0.06 + 0.13 * load, t, 0.1);
    this.engNoise.gain.setTargetAtTime(0.05 + rpm01 * 0.1, t, 0.1);
  }
  engineOff() {
    if (!this.ready) return;
    this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
  }

  // --- police siren -------------------------------------------------------
  buildSiren() {
    const ctx = this.ctx;
    const g = this.sirGain = ctx.createGain(); g.gain.value = 0;
    const o = this.sirOsc = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 700;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.9;
    const lg = ctx.createGain(); lg.gain.value = 260;
    lfo.connect(lg); lg.connect(o.frequency);
    o.connect(g); g.connect(this.master); g.connect(this.reverb);
    o.start(); lfo.start();
  }
  siren(level) {
    if (!this.ready) return;
    this.sirGain.gain.setTargetAtTime(clamp(level, 0, 1) * 0.12, this.ctx.currentTime, 0.25);
  }

  // --- one-shots ----------------------------------------------------------
  blip(freq, dur, type = 'sine', vol = 0.3, slide = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.master); g.connect(this.reverb);
    o.start(t); o.stop(t + dur + 0.02);
  }

  gunshot(kind = 'pistol') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise(0.3);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(kind === 'rifle' ? 1500 : 950, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.16);
    f.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(kind === 'rifle' ? 0.5 : 0.42, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'rifle' ? 0.16 : 0.22));
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.reverb);
    this.blip(kind === 'rifle' ? 150 : 110, 0.09, 'square', 0.22, 0.35);
  }

  impact(vol = 0.4) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = this.noise(0.4);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t); f.frequency.exponentialRampToValueAtTime(140, t + 0.3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(clamp(vol, 0, 1) * 0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.34);
    src.connect(f); f.connect(g); g.connect(this.master); g.connect(this.reverb);
    this.blip(70, 0.22, 'sine', clamp(vol, 0, 1) * 0.35, 0.4);
  }

  skid(on) {
    if (!this.ready) return;
    if (on && !this.skidNode) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 5;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      g.gain.setTargetAtTime(0.13, ctx.currentTime, 0.05);
      this.skidNode = { src, g };
    } else if (!on && this.skidNode) {
      const { src, g } = this.skidNode; this.skidNode = null;
      g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      setTimeout(() => src.stop(), 400);
    }
  }

  horn(on) { if (this.ready) this.blip(on ? 330 : 300, 0.35, 'square', 0.18, 1); }
  pickup() { this.blip(660, 0.1, 'triangle', 0.3); setTimeout(() => this.blip(990, 0.16, 'triangle', 0.3), 90); }
  fail() { this.blip(220, 0.3, 'sawtooth', 0.22, 0.5); }
  hurt() { this.blip(180, 0.18, 'square', 0.2, 0.6); }
  step() { this.blip(120 + Math.random() * 40, 0.05, 'triangle', 0.06, 0.7); }
}
