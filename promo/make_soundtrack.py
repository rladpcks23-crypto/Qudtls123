"""레드라인 소개 영상 사운드트랙 합성기.

화면 타임라인(index.html)이 내보낸 효과음 큐(sfx.json)에 맞춰
120BPM 하우스 비트 + 효과음을 numpy로 직접 합성해 WAV로 쓴다.

사용법: python3 make_soundtrack.py sfx.json soundtrack.wav
"""
import json
import sys
import wave

import numpy as np
from scipy import signal

SR = 48000
BPM = 120
BEAT = 60 / BPM
cues = json.load(open(sys.argv[1]))
DUR = cues["dur"]
N = int(SR * (DUR + 1.5))
rs = np.random.RandomState(20261009)

music = np.zeros((2, N))   # 사이드체인이 걸리는 버스
drums = np.zeros((2, N))
fxbus = np.zeros((2, N))
verb = np.zeros((2, N))    # 리버브 센드


def tt(d):
    return np.arange(int(d * SR)) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(buf, x, t0, g=1.0, pan=0.0, send=0.0):
    """모노/스테레오 신호를 t0초 위치에 더한다. pan: -1(왼) ~ 1(오)."""
    i = int(round(t0 * SR))
    if x.ndim == 1:
        th = (pan + 1) * np.pi / 4
        x = np.stack([x * np.cos(th), x * np.sin(th)]) * np.sqrt(2)
    if i < 0:
        x = x[:, -i:]
        i = 0
    n = min(x.shape[1], N - i)
    if n <= 0:
        return
    buf[:, i:i + n] += g * x[:, :n]
    if send:
        verb[:, i:i + n] += g * send * x[:, :n]


def sos(kind, f, order=2):
    if kind == "bp":
        return signal.butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], "bandpass", output="sos")
    return signal.butter(order, f / (SR / 2), kind, output="sos")


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x)


def noise(d, seed=None):
    r = np.random.RandomState(seed) if seed is not None else rs
    return r.uniform(-1, 1, int(d * SR))


def svf(x, fc, q=1.0, mode="bp"):
    """시변 상태변수 필터. fc는 샘플별 배열."""
    y = np.zeros_like(x)
    lp = bp = 0.0
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR / 6) / SR)
    dmp = 1.0 / q
    for i in range(len(x)):
        hp = x[i] - lp - dmp * bp
        bp += f[i] * hp
        lp += f[i] * bp
        y[i] = bp if mode == "bp" else lp if mode == "lp" else hp
    return y


def env_ad(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / max(a, 1e-4)) * np.exp(-np.maximum(0, t - a) / d)


def fade(x, a=0.003, r=0.01):
    n = len(x)
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    if na:
        e[:na] = np.linspace(0, 1, na)
    if nr:
        e[-nr:] *= np.linspace(1, 0, nr)
    return x * e


def saw_add(f, t, kmax=60, decay=None, phase=0.0):
    """가산 합성 톱니파. decay가 있으면 배음별로 빨리 줄어드는 플럭 필터 효과."""
    k_n = int(min(kmax, (SR / 2.2) / f))
    y = np.zeros_like(t)
    for k in range(1, k_n + 1):
        a = 1.0 / k
        if decay is not None:
            a = a * np.exp(-t * (decay[0] + decay[1] * k))
        y += a * np.sin(2 * np.pi * k * f * t + phase * k)
    return y * 0.6


# ---------------------------------------------------------------- 화성
CH = {  # 코드 구성음(MIDI)
    "Am": [57, 60, 64, 69], "F": [53, 57, 60, 65], "C": [55, 60, 64, 67], "G": [55, 59, 62, 67],
    "Dm": [53, 57, 62, 65], "E": [52, 56, 59, 64], "Cadd9": [55, 60, 62, 64, 67],
}
ROOT = {"Am": 33, "F": 29, "C": 36, "G": 31, "Dm": 38, "E": 28, "Cadd9": 36}
PROG = [(0, "Am"), (2, "Am"), (4, "F"), (6, "C"), (8, "G"), (10, "Am"), (12, "Dm"), (14, "E"),
        (16, "Am"), (18, "F"), (20, "C"), (22, "G"), (24, "F"), (25, "G"), (26, "Am"), (27, "F"), (28, "Cadd9")]


def chord_at(t):
    c = PROG[0][1]
    for s, n in PROG:
        if t + 1e-6 >= s:
            c = n
    return c


# ---------------------------------------------------------------- 드럼
def kick(g=1.0, big=False):
    d = 0.55 if not big else 0.9
    t = tt(d)
    f = 46 + 120 * np.exp(-t / 0.032) + 30 * np.exp(-t / 0.2)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / (0.26 if not big else 0.42))
    body = np.tanh(body * 1.6) / np.tanh(1.6)
    click = filt(noise(0.012), "hp", 2500) * np.exp(-tt(0.012) / 0.0025)
    y = body
    y[: len(click)] += 0.35 * click
    return fade(y, 0.0008, 0.02) * g


def clap():
    d = 0.4
    n = filt(noise(d), "bp", (900, 2600))
    t = tt(d)
    e = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        e += np.where(t >= o, np.exp(-(t - o) / 0.007), 0)
    e += np.where(t >= 0.03, 0.55 * np.exp(-(t - 0.03) / 0.11), 0)
    return n * e


def hat(open_=False):
    d = 0.3 if open_ else 0.08
    n = filt(noise(d), "hp", 7500, 3)
    return n * np.exp(-tt(d) / (0.11 if open_ else 0.022))


def snare(g=1.0, tone=190):
    d = 0.3
    t = tt(d)
    n = filt(noise(d), "bp", (1200, 7000)) * np.exp(-t / 0.1)
    b = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.06)
    return (0.8 * n + 0.6 * b) * g


def crash():
    d = 2.4
    t = tt(d)
    L = filt(noise(d, 11), "hp", 4200, 2) + 0.4 * filt(noise(d, 12), "bp", (3000, 9000)) * np.sin(2 * np.pi * 5230 * t)
    R = filt(noise(d, 13), "hp", 4200, 2) + 0.4 * filt(noise(d, 14), "bp", (3000, 9000)) * np.sin(2 * np.pi * 5170 * t)
    e = np.minimum(1, t / 0.002) * np.exp(-t / 0.9)
    return np.stack([L * e, R * e])


# ---------------------------------------------------------------- 신스
def supersaw(m, d, voices=5, spread=0.16, k=30):
    t = tt(d)
    y = np.zeros_like(t)
    for v in range(voices):
        det = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
        y += saw_add(midi(m + det), t, kmax=k, phase=rs.uniform(0, 6.28))
    return y / voices


def pad_chord(name, d):
    t = tt(d)
    y = sum(supersaw(m, d, 4, 0.12, 14) for m in CH[name][:4])
    y = filt(y, "lp", 1800)
    e = np.minimum(1, t / 0.25) * np.minimum(1, (d - t) / 0.3)
    return y * e * 0.5


def pluck(m, d=0.5, bright=1.0):
    t = tt(d)
    y = saw_add(midi(m), t, kmax=40, decay=(5.0, 2.2 / bright)) + 0.5 * saw_add(midi(m) * 1.003, t, kmax=30, decay=(5.0, 2.6 / bright))
    return fade(y * np.exp(-t / 0.35), 0.002, 0.03)


def bell(m, d=1.0, idx=2.5, ratio=3.5, dec=0.5):
    t = tt(d)
    f = midi(m)
    mod = np.sin(2 * np.pi * f * ratio * t) * idx * np.exp(-t / 0.15)
    y = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / dec)
    return fade(y, 0.001, 0.05)


def bass_note(m, d):
    t = tt(d)
    f = midi(m)
    y = saw_add(f, t, kmax=14, decay=(1.5, 0.9)) * 0.8 + np.sin(2 * np.pi * f * t) * 0.9
    y = np.tanh(1.4 * y)
    return fade(y, 0.004, 0.03)


# ---------------------------------------------------------------- 음악 배치
KICKS = [b for b in np.arange(2, 24, BEAT)] + [b for b in np.arange(26, 28.01, BEAT)]
for k in KICKS:
    put(drums, kick(0.95, big=(abs(k - 2) < 1e-6 or abs(k - 26) < 1e-6 or abs(k - 14) < 1e-6)), k)
for bar in np.arange(2, 24, 2.0):
    for off in (0.5, 1.5):
        put(drums, clap(), bar + off, 0.42, send=0.25)
for s in np.arange(2, 24, 0.125):
    step = int(round((s - 2) / 0.125)) % 4
    if step == 2:
        put(drums, hat(True), s, 0.15, pan=0.15)
    else:
        put(drums, hat(False), s, 0.10 if step == 0 else 0.07, pan=-0.2 + 0.1 * step)
for bar in (26.0,):
    for off in (0.5, 1.5):
        put(drums, clap(), bar + off, 0.42, send=0.25)
    for s in np.arange(bar, bar + 2, 0.125):
        step = int(round((s - bar) / 0.125)) % 4
        put(drums, hat(step == 2), s, 0.15 if step == 2 else 0.08)
# 필인
for i, s in enumerate(np.arange(13.5, 14.0, 0.0625)):
    put(drums, snare(0.25 + 0.5 * i / 8, 190 + 8 * i), s, send=0.2)
for i, s in enumerate(np.arange(23.5, 24.0, 0.0625)):
    put(drums, snare(0.25 + 0.5 * i / 8, 190 + 8 * i), s, send=0.2)

# 베이스: 오프비트 8분
for s in np.arange(2, 24, 0.5):
    put(music, bass_note(ROOT[chord_at(s)] + 12, 0.21), s + 0.25, 0.42)
for s in np.arange(26, 28, 0.5):
    put(music, bass_note(ROOT[chord_at(s)] + 12, 0.21), s + 0.25, 0.42)

# 코드 스탭: x..x..x...x.x...
STAB = [0, 3, 6, 10, 12]
for bar in list(np.arange(2, 24, 2.0)) + [26.0]:
    for st in STAB:
        s = bar + st * 0.125
        c = chord_at(s)
        for m in CH[c]:
            put(music, pluck(m + 12, 0.45, 1.0), s, 0.045, pan=rs.uniform(-0.3, 0.3), send=0.35)

# 패드: 처음부터 끝까지 깔린다(인트로·브레이크다운에서 더 크게)
for i, (s, c) in enumerate(PROG):
    e = PROG[i + 1][0] if i + 1 < len(PROG) else DUR + 0.5
    g = 0.22 if s < 2 else 0.34 if 24 <= s < 26 else (0.32 if s >= 28 else 0.10)
    put(music, pad_chord(c, e - s + 0.3), s, g, send=0.5)
# 인트로 서브 드론
t = tt(2.0)
put(music, np.sin(2 * np.pi * 55 * t) * np.minimum(1, t / 1.2) * 0.25, 0.0)

# 브레이크다운 플럭 멜로디
MEL = [(24.0, 77), (24.25, 76), (24.5, 72), (24.75, 69), (25.0, 79), (25.25, 77), (25.5, 74), (25.75, 71)]
for s, m in MEL:
    put(music, pluck(m, 0.6, 1.4), s, 0.16, pan=0.2 * np.sin(s * 5), send=0.6)

# 마지막 코드 히트
for m in CH["Cadd9"] + [72, 76]:
    put(music, supersaw(m + 12, 2.5, 5, 0.18, 24) * np.exp(-tt(2.5) / 1.1), 28.0, 0.07, pan=rs.uniform(-0.4, 0.4), send=0.6)

put(drums, crash(), 28.0, 0.2, send=0.3)
put(drums, kick(1.0, big=True), 28.0)

# ---------------------------------------------------------------- 효과음
PENTA = [57, 60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88]


def s_pop(n):
    m = PENTA[min(n, len(PENTA) - 1)] + 12
    d = 0.16
    t = tt(d)
    f = midi(m) * (0.55 + 0.45 * (1 - np.exp(-t / 0.012)))
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05)
    y[:60] += filt(noise(60 / SR), "hp", 3000) * np.linspace(1, 0, 60) * 0.3
    return fade(y, 0.001, 0.02)


def s_ping():
    t = tt(1.4)
    return (np.sin(2 * np.pi * 1760 * t) + 0.4 * np.sin(2 * np.pi * 2637 * t)) * np.exp(-t / 0.35) * np.minimum(1, t / 0.002)


def s_tick(hi=False):
    d = 0.05
    t = tt(d)
    f = 3400 if hi else 2500
    return (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.008) + 0.5 * filt(noise(d), "hp", 4000) * np.exp(-t / 0.002))


def s_click():
    d = 0.06
    t = tt(d)
    return (filt(noise(d), "bp", (1500, 6000)) * np.exp(-t / 0.003) + 0.6 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.01)
            + 0.6 * np.sin(2 * np.pi * 280 * t) * np.exp(-t / 0.02))


def s_whoosh(d=0.34, up=True, peak=0.62):
    t = tt(d)
    u = t / d
    fc = np.where(u < peak, 500 * (7.0 ** (u / peak)), 3500 * (0.35 ** ((u - peak) / (1 - peak))))
    if not up:
        fc = 5000 * (0.12 ** u)
    x = noise(d)
    y = svf(x, fc, 2.2, "bp") * np.sin(np.pi * np.clip(u, 0, 1)) ** 1.6
    return y * 1.6


def s_riser(d):
    t = tt(d)
    u = t / d
    fc = 300 * (30 ** u)
    y = svf(noise(d), fc, 3.5, "bp") * (u ** 1.8) * 1.4
    f = 220 * (4 ** u)
    y += 0.12 * np.sign(np.sin(2 * np.pi * np.cumsum(f) / SR)) * (u ** 2)
    return fade(y, 0.01, 0.015)


def s_down(d=0.55):
    t = tt(d)
    u = t / d
    y = svf(noise(d), 7000 * (0.04 ** u), 1.2, "lp") * (1 - u) ** 1.5
    f = 700 * (0.12 ** u)
    y += 0.5 * np.sin(2 * np.pi * np.cumsum(f) / SR) * (1 - u) ** 2
    return y


def s_rev(d, lo=False, limiter=0):
    """엔진 회전음. limiter>0이면 끝에서 레브 리미터로 끊어친다."""
    dl = 0.5 if limiter else 0
    t = tt(d + dl)
    u = np.clip(t / d, 0, 1)
    f0, f1 = (30, 72) if lo else (36, 118)
    f = f0 + (f1 - f0) * u ** 1.4
    gate = np.ones_like(t)
    if limiter:
        tl = t - d
        ph = (tl % 0.125) / 0.125
        on = (tl >= 0) & (ph < 0.55)
        gate = np.where(tl >= 0, on * 1.0, 1.0)
        f = np.where(tl >= 0, f1 * (0.93 + 0.07 * (ph < 0.55)), f)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = 0.6 * ((ph / (2 * np.pi)) % 1 * 2 - 1) + 0.5 * np.sign(np.sin(ph)) + 0.3 * np.sin(ph / 2)
    y *= 1 + 0.35 * np.sin(ph * 0.5)
    y = np.tanh(2.4 * y)
    y = svf(y, 500 + 2600 * u, 0.9, "lp")
    y += 0.15 * filt(noise(len(t) / SR), "bp", (400, 2500)) * u
    amp = (0.25 + 0.75 * u) * gate
    amp = signal.lfilter([0.02], [1, -0.98], amp)
    return fade(y * amp, 0.04, 0.03) * 1.3


def s_impact(big=False, red=False, end=False):
    d = 2.2 if (big or end) else 1.0
    t = tt(d)
    f = 34 + 140 * np.exp(-t / 0.05)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.7 if big else 0.32))
    nz = filt(noise(d), "lp", 3500) * np.exp(-t / (0.22 if big else 0.1))
    y = np.tanh(1.5 * boom) + 0.55 * nz
    if red:
        st = sum(supersaw(m, d, 4, 0.25, 30) for m in (40, 47, 52, 56))
        y += 0.5 * np.tanh(3 * st) * np.exp(-t / 0.35)
    return fade(y, 0.001, 0.05)


def s_hit():
    d = 0.5
    t = tt(d)
    f = 45 + 90 * np.exp(-t / 0.04)
    return (0.8 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.18)
            + 0.5 * filt(noise(d), "bp", (800, 6000)) * np.exp(-t / 0.05))


def s_ding(hi=False):
    base = 88 if hi else 84
    y = np.zeros(int(1.6 * SR))
    a = bell(base, 1.4, 2.0, 3.5, 0.45)
    b = bell(base + 7, 1.4, 2.0, 3.5, 0.5)
    y[: len(a)] += a
    o = int(0.07 * SR)
    y[o:o + len(b)] += b[: len(y) - o]
    return y


def s_seq(times, maker):
    d = max(times) + 0.3
    y = np.zeros(int(d * SR))
    for x in times:
        z = maker(x)
        i = int(x * SR)
        y[i:i + len(z)] += z[: len(y) - i]
    return y


bar_chord = chord_at
for c in cues["sfx"]:
    t0, ty = c["t"], c["type"]
    if ty == "ping":
        put(fxbus, s_ping(), t0, 0.32, send=0.6)
    elif ty == "pop":
        put(fxbus, s_pop(c.get("n", 0)), t0, 0.30, pan=rs.uniform(-0.35, 0.35), send=0.25)
    elif ty == "tick":
        put(fxbus, s_tick(c.get("hi")), t0, 0.22 if c.get("hi") else 0.16, send=0.15)
    elif ty == "riser":
        put(fxbus, s_riser(c["d"]), t0, 0.32, send=0.3)
    elif ty == "rev":
        put(fxbus, s_rev(c["d"], c.get("lo", False)), t0, 0.30 if c.get("lo") else 0.36)
    elif ty == "limiter":
        put(fxbus, s_rev(0.001, False, limiter=1)[int(0.001 * SR):], t0, 0.34)
    elif ty == "impact":
        put(fxbus, s_impact(c.get("big"), c.get("red"), c.get("end")), t0, 0.62 if c.get("big") else 0.42, send=0.35)
    elif ty == "crash":
        put(fxbus, crash(), t0, 0.22, send=0.3)
    elif ty == "hit":
        put(fxbus, s_hit(), t0, 0.32, send=0.2)
    elif ty == "whoosh":
        y = s_whoosh(0.36 if not c.get("soft") else 0.3)
        put(fxbus, y, t0 - 0.04, 0.30 if not c.get("soft") else 0.18, pan=-0.3, send=0.2)
    elif ty == "swoosh":
        put(fxbus, s_whoosh(0.24, up=not c.get("down")), t0 - 0.06, 0.13 if c.get("soft") else 0.2, pan=0.25, send=0.2)
    elif ty == "roll":
        ts, x, iv = [], 0.0, 0.028
        while x < c["d"]:
            ts.append(x)
            x += iv
            iv *= 1.09
        put(fxbus, s_seq(ts, lambda q: s_tick(False) * (0.5 + 0.5 * q / c["d"])), t0, 0.16)
        put(fxbus, filt(noise(c["d"]), "bp", (600, 3000)) * np.linspace(0.5, 0, int(c["d"] * SR)), t0, 0.06)
    elif ty == "type":
        n, d = c["n"], c["d"]
        ts = [d * i / n + rs.uniform(0, 0.01) for i in range(n)]
        put(fxbus, s_seq(ts, lambda q: filt(noise(0.012), "bp", (2000, 6000)) * np.exp(-tt(0.012) / 0.003) * rs.uniform(0.5, 1)), t0, 0.12)
    elif ty == "clock":
        tq = tt(0.12)
        put(fxbus, (np.sin(2 * np.pi * 1150 * tq) + 0.3 * np.sin(2 * np.pi * 2300 * tq)) * np.exp(-tq / 0.03), t0, 0.16, send=0.2)
    elif ty == "count":
        ts = [c["d"] * (1 - (1 - i / 18) ** 2) for i in range(18)]
        put(fxbus, s_seq(ts, lambda q: s_tick(True) * 0.5), t0, 0.12)
    elif ty == "ticks":
        n, d = c["n"], c["d"]
        ts = [d * i / n for i in range(n)]
        put(fxbus, s_seq(ts, lambda q: np.sin(2 * np.pi * (1500 + 2000 * q / d) * tt(0.03)) * np.exp(-tt(0.03) / 0.006)), t0, 0.12, send=0.2)
    elif ty == "arp":
        d = c["d"]
        notes = [69, 72, 76, 81, 84, 88, 93]
        ts = list(np.arange(0, d, 0.0625))
        for i, x in enumerate(ts):
            put(fxbus, bell(notes[i % len(notes)] + (12 if i >= len(notes) * 2 else 0), 0.5, 1.2, 2.0, 0.18),
                t0 + x, 0.06 + 0.04 * i / len(ts), pan=0.5 * np.sin(i * 1.3), send=0.45)
    elif ty == "glint":
        tq = tt(0.6)
        y = sum(np.sin(2 * np.pi * f * tq + rs.uniform(0, 6)) for f in (2900, 4350, 5800, 7250))
        y *= np.sin(np.pi * tq / 0.6) ** 2 * (0.6 + 0.4 * np.sin(2 * np.pi * 28 * tq))
        put(fxbus, y, t0, 0.025, pan=0.3, send=0.5)
    elif ty == "spin":
        d = c["d"]
        ts, x = [], 0.0
        while x < d:
            ts.append(x)
            u = x / d
            x += 0.09 - 0.07 * np.sin(np.pi * u)
        put(fxbus, s_seq(ts, lambda q: s_tick(False) * 0.6), t0, 0.15)
    elif ty == "click":
        put(fxbus, s_click(), t0, 0.28)
    elif ty == "ding":
        put(fxbus, s_ding(c.get("hi")), t0, 0.16, send=0.45)
    elif ty == "check":
        put(fxbus, s_click(), t0, 0.22)
        put(fxbus, pluck(PENTA[c["n"] + 5] + 12, 0.5, 1.5), t0, 0.12, pan=-0.2 + 0.1 * c["n"], send=0.35)
    elif ty == "pluck":
        tones = [67, 71, 74, 79, 83, 86, 91]
        put(fxbus, bell(tones[min(c["i"] + c["j"], 6)], 0.6, 1.5, 3.0, 0.22), t0, 0.07, pan=-0.4 + 0.4 * c["j"], send=0.4)
    elif ty == "draw":
        d = c["d"]
        y = svf(noise(d), 2500 + 1500 * np.sin(np.linspace(0, 6, int(d * SR))), 2.0, "bp") * np.sin(np.linspace(0, np.pi, int(d * SR)))
        put(fxbus, y, t0, 0.05, send=0.2)
    elif ty == "down":
        put(fxbus, s_down(), t0, 0.3, send=0.4)
    elif ty == "thump":
        tq = tt(0.4)
        f = 50 + 40 * np.exp(-tq / 0.04)
        put(fxbus, np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tq / 0.12), t0, 0.32)
    elif ty == "roll2":
        d = c["d"]
        ts = list(np.arange(0, 0.5, 0.125)) + list(np.arange(0.5, 0.75, 0.0625)) + list(np.arange(0.75, 1.0, 0.03125))
        for i, x in enumerate(ts):
            put(fxbus, snare(0.15 + 0.6 * (x / d) ** 1.5, 180 + 140 * x / d), t0 + x, 0.55, send=0.25)
    elif ty == "confetti":
        y = filt(noise(0.03), "bp", (800, 4000)) * np.exp(-tt(0.03) / 0.008) * 1.5
        put(fxbus, y, t0, 0.35)
        for k in range(28):
            x = rs.uniform(0.05, 0.9) ** 1.5
            put(fxbus, filt(noise(0.006), "hp", 3000) * rs.uniform(0.2, 0.7), t0 + x, 0.25 * (1 - x), pan=rs.uniform(-0.9, 0.9))

# ---------------------------------------------------------------- 사이드체인 + 리버브 + 마스터
tN = np.arange(N) / SR
duck = np.ones(N)
for k in KICKS:
    i = int(k * SR)
    seg = tN[i:i + int(0.4 * SR)] - k
    duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.7 * np.exp(-seg / 0.11))
music *= duck


def ir(rt, seed):
    t = tt(rt)
    y = np.random.RandomState(seed).randn(len(t)) * np.exp(-t * 6.9 / rt)
    return filt(y, "lp", 5000) * 0.03


wet = np.stack([signal.fftconvolve(verb[0], ir(2.2, 1))[:N], signal.fftconvolve(verb[1], ir(2.2, 2))[:N]])
wet = filt(wet, "hp", 250)
wet *= 0.5 + 0.5 * duck

mix = 0.72 * music + 0.42 * drums + 0.75 * fxbus + 0.8 * wet
if len(sys.argv) > 3:
    def db(x):
        return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    for name, b in (("music", 0.72 * music), ("drums", 0.42 * drums), ("fx", 0.75 * fxbus), ("wet", 0.8 * wet), ("mix", mix)):
        row = []
        for a0, a1 in ((0, 2), (2, 8), (8, 14), (14, 16), (16, 24), (24, 26), (26, 28), (28, 30)):
            row.append("%6.1f" % db(b[:, int(a0 * SR):int(a1 * SR)]))
        print("%-6s" % name, " ".join(row))
    print("peak pre-master", float(np.max(np.abs(mix))))
mix = signal.sosfilt(sos("hp", 28), mix)
# BS.1770 라우드니스로 -14 LUFS에 맞춘 뒤 룩어헤드 리미터로 피크를 잡는다
def lufs(x):
    k = signal.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x, axis=1)
    k = signal.lfilter([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621], k, axis=1)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.sum(np.mean(k[:, i:i + blk] ** 2, axis=1)) for i in range(0, k.shape[1] - blk, hop)])
    l = -0.691 + 10 * np.log10(z + 1e-12)
    z = z[l > -70]
    rel = -0.691 + 10 * np.log10(np.mean(z)) - 10
    z = z[(-0.691 + 10 * np.log10(z)) > rel]
    return -0.691 + 10 * np.log10(np.mean(z))


from scipy.ndimage import minimum_filter1d
end0 = int(DUR * SR)
mix *= 10 ** ((-14.0 - lufs(mix[:, :end0])) / 20)
CEIL = 0.84
g = np.minimum(1.0, CEIL / np.maximum(np.max(np.abs(mix), axis=0), 1e-9))
la = int(0.003 * SR)
g = minimum_filter1d(g, 2 * la + 1)
g = signal.lfilter([1 - 0.9995], [1, -0.9995], g - 1) + 1          # 릴리스 (약 40ms)
g = np.minimum(g, minimum_filter1d(np.minimum(1.0, CEIL / np.maximum(np.max(np.abs(mix), axis=0), 1e-9)), 2 * la + 1))
mix *= g
print("loudness after limit: %.1f LUFS, gain reduction max %.1f dB" % (lufs(mix[:, :end0]), -20 * np.log10(np.min(g))))
# 끝 페이드
end = int(DUR * SR)
fo = int(0.9 * SR)
mix[:, end - fo:end] *= np.linspace(1, 0, fo) ** 2
mix = mix[:, :end]

pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", sys.argv[2], mix.shape[1] / SR, "s; peak", float(np.max(np.abs(mix))))
