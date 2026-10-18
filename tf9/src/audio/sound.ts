/**
 * All sound is synthesised with Web Audio: no files to load.
 * - click(): the short metallic snap when a part seats
 * - release(): a soft servo hiss when a part comes off
 * - setEngine(): fan blade-pass tone, HP whine, broadband roar, combustion rumble
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private fanTone!: OscillatorNode;
  private fanGain!: GainNode;
  private fanTone2!: OscillatorNode;
  private fanGain2!: GainNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private roarGain!: GainNode;
  private rumbleGain!: GainNode;
  private lastClick = 0;
  enabled = false;

  get available() {
    return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
  }

  async enable() {
    if (!this.ctx) this.init();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume();
    this.enabled = true;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.05);
  }

  disable() {
    this.enabled = false;
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.04);
    window.setTimeout(() => { if (!this.enabled) ctx.suspend(); }, 300);
  }

  private init() {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b = 0.97 * b + 0.03 * w; // gently tilted toward low frequencies
      d[i] = w * 0.6 + b * 2.4;
    }

    const osc = (type: OscillatorType, f: number) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; };
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };

    this.fanTone = osc('sine', 60);
    this.fanGain = gain();
    this.fanTone.connect(this.fanGain).connect(this.master);
    this.fanTone2 = osc('triangle', 120);
    this.fanGain2 = gain();
    this.fanTone2.connect(this.fanGain2).connect(this.master);
    this.whine = osc('sine', 800);
    this.whineGain = gain();
    this.whine.connect(this.whineGain).connect(this.master);

    const roar = ctx.createBufferSource();
    roar.buffer = this.noise;
    roar.loop = true;
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarFilter.frequency.value = 200;
    this.roarGain = gain();
    roar.connect(this.roarFilter).connect(this.roarGain).connect(this.master);

    const rumble = ctx.createBufferSource();
    rumble.buffer = this.noise;
    rumble.loop = true;
    rumble.loopStart = 0.7;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 85;
    rf.Q.value = 0.9;
    this.rumbleGain = gain();
    rumble.connect(rf).connect(this.rumbleGain).connect(this.master);

    for (const n of [this.fanTone, this.fanTone2, this.whine, roar, rumble]) n.start();
  }

  /** n1, n2: 0..1 of 100 %; heat 0..1 */
  setEngine(n1: number, n2: number, heat: number) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const tc = 0.08;
    // fan blade-pass frequency: 18 blades x N1 rpm / 60 (about 1.2 kHz at 100 %)
    const bpf = 18 * (n1 * 3900) / 60;
    this.fanTone.frequency.setTargetAtTime(Math.max(20, bpf), t, tc);
    this.fanTone2.frequency.setTargetAtTime(Math.max(20, bpf * 0.5), t, tc);
    this.fanGain.gain.setTargetAtTime(0.035 * Math.min(1, n1 * 3), t, tc);
    this.fanGain2.gain.setTargetAtTime(0.02 * Math.min(1, n1 * 2), t, tc);
    this.whine.frequency.setTargetAtTime(400 + 2600 * n2, t, tc);
    this.whineGain.gain.setTargetAtTime(0.01 * Math.min(1, n2 * 1.5), t, tc);
    this.roarFilter.frequency.setTargetAtTime(160 + 2200 * n1 * n1, t, tc);
    this.roarGain.gain.setTargetAtTime(0.16 * Math.pow(n1, 1.3), t, tc);
    this.rumbleGain.gain.setTargetAtTime(0.5 * heat, t, 0.15);
  }

  click(heavy = false) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    // keep a hairline gap between clicks so a fast scroll reads as a ripple
    const t = Math.max(ctx.currentTime, this.lastClick + 0.04);
    this.lastClick = t;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = heavy ? 2200 : 3400;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(heavy ? 0.9 : 0.6, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5, 0.05);

    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(heavy ? 1500 : 2300, t);
    o.frequency.exponentialRampToValueAtTime(heavy ? 700 : 1300, t + 0.03);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(og).connect(this.master);
    o.start(t);
    o.stop(t + 0.04);

    if (heavy) {
      const th = ctx.createOscillator();
      th.type = 'sine';
      th.frequency.setValueAtTime(140, t);
      th.frequency.exponentialRampToValueAtTime(60, t + 0.12);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t);
      tg.gain.exponentialRampToValueAtTime(0.45, t + 0.004);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      th.connect(tg).connect(this.master);
      th.start(t);
      th.stop(t + 0.16);
    }
  }

  release() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(900, t);
    hp.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
    hp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    src.connect(hp).connect(g).connect(this.master);
    src.start(t, Math.random(), 0.3);
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 3200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.025);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.03);
  }
}
