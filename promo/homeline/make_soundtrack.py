"""홈라인 소개 영상 사운드트랙 합성기.

화면 타임라인(index.html)이 내보낸 효과음 큐(sfx.json)에 맞춰
120BPM, D장조 피아노 곡과 효과음을 numpy로 직접 합성해 WAV로 쓴다.
  0–5초   레드라인 : 엔진 회전음과 낮은 드론(단조), 한계선에서 끊김
  5–12초  길이 집으로 휜다 : 피아노가 D장조로 들어온다
  12–28초 두 아들·아버지 : 하프타임 비트
  28–50초 앱 소개 : 팝 비트, 효과음이 멜로디를 얹는다
  50–56초 하루 마치기 : 드럼을 빼고 감정을 올린다
  56–66초 끝 : 다시 비트, G→D 로 닫는다

사용법: python3 make_soundtrack.py sfx.json soundtrack.wav
"""
import json
import sys
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48000
cues = json.load(open(sys.argv[1]))
DUR = cues["dur"]
N = int(SR * (DUR + 2.0))
rs = np.random.RandomState(20261010)

music = np.zeros((2, N))   # 사이드체인이 걸리는 버스
drums = np.zeros((2, N))
fxbus = np.zeros((2, N))
verb = np.zeros((2, N))


def tt(d):
    return np.arange(int(d * SR)) / SR


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def put(buf, x, t0, g=1.0, pan=0.0, send=0.0):
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
    k_n = int(min(kmax, (SR / 2.2) / f))
    y = np.zeros_like(t)
    for k in range(1, k_n + 1):
        a = 1.0 / k
        if decay is not None:
            a = a * np.exp(-t * (decay[0] + decay[1] * k))
        y += a * np.sin(2 * np.pi * k * f * t + phase * k)
    return y * 0.6


# ---------------------------------------------------------------- 악기
def piano(m, d=2.0, vel=0.6):
    """펠트 피아노 느낌: 배음마다 따로 사라지고, 두 현이 살짝 어긋난다."""
    t = tt(d)
    f = midi(m)
    B = 0.0004
    y = np.zeros_like(t)
    bright = 0.6 + 0.6 * vel
    for k in range(1, 14):
        fk = k * f * np.sqrt(1 + B * k * k)
        if fk > SR / 2.3:
            break
        a = (1.0 / k ** (1.6 - 0.5 * bright)) * np.exp(-t * (0.5 + 0.42 * k * (1.3 - 0.4 * vel)))
        y += a * (np.sin(2 * np.pi * fk * t) + 0.6 * np.sin(2 * np.pi * fk * 1.0012 * t + k))
    ham = filt(noise(0.01), "lp", 2500) * np.exp(-tt(0.01) / 0.002) * 0.15
    y[:len(ham)] += ham
    return fade(y * vel * 0.35, 0.002, 0.08)


def bell(m, d=1.2, idx=2.0, ratio=3.5, dec=0.5):
    t = tt(d)
    f = midi(m)
    mod = np.sin(2 * np.pi * f * ratio * t) * idx * np.exp(-t / 0.15)
    return fade(np.sin(2 * np.pi * f * t + mod) * np.exp(-t / dec), 0.001, 0.05)


def supersaw(m, d, voices=5, spread=0.16, k=30):
    t = tt(d)
    y = np.zeros_like(t)
    for v in range(voices):
        det = (v - (voices - 1) / 2) / ((voices - 1) / 2) * spread
        y += saw_add(midi(m + det), t, kmax=k, phase=rs.uniform(0, 6.28))
    return y / voices


def pad(notes, d, cutoff=1400, att=0.8, rel=1.0):
    t = tt(d)
    y = sum(supersaw(m, d, 4, 0.12, 12) for m in notes)
    y += 0.4 * sum(np.sin(2 * np.pi * midi(m + 12) * t) for m in notes[:2])
    y = filt(y, "lp", cutoff)
    e = np.minimum(1, t / att) * np.minimum(1, np.maximum(0, d - t) / rel)
    return y * e * 0.35


def pluck(m, d=0.5, bright=1.0):
    t = tt(d)
    y = saw_add(midi(m), t, kmax=40, decay=(5.0, 2.2 / bright))
    return fade(y * np.exp(-t / 0.35), 0.002, 0.03)


def bass_note(m, d):
    t = tt(d)
    f = midi(m)
    y = saw_add(f, t, kmax=10, decay=(2.0, 1.0)) * 0.7 + np.sin(2 * np.pi * f * t) * 1.0
    return fade(np.tanh(1.3 * y), 0.004, 0.04)


def kick(g=1.0, soft=False):
    d = 0.5
    t = tt(d)
    f = 48 + (90 if soft else 120) * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.22 if soft else 0.26))
    click = filt(noise(0.01), "hp", 2500) * np.exp(-tt(0.01) / 0.002)
    y = np.tanh(1.4 * body)
    y[:len(click)] += (0.15 if soft else 0.3) * click
    return fade(y, 0.0008, 0.02) * g


def clap():
    d = 0.4
    n = filt(noise(d), "bp", (900, 2600))
    t = tt(d)
    e = np.zeros_like(t)
    for o in (0, 0.011, 0.022):
        e += np.where(t >= o, np.exp(-(t - o) / 0.007), 0)
    e += np.where(t >= 0.03, 0.55 * np.exp(-(t - 0.03) / 0.12), 0)
    return n * e


def rim():
    t = tt(0.12)
    return (np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.012) + 0.6 * filt(noise(0.12), "bp", (1500, 5000)) * np.exp(-t / 0.02))


def hat(open_=False, d=None):
    d = d or (0.3 if open_ else 0.07)
    n = filt(noise(d), "hp", 7500, 3)
    return n * np.exp(-tt(d) / (0.11 if open_ else 0.02))


def shaker():
    d = 0.08
    t = tt(d)
    return filt(noise(d), "bp", (4000, 11000)) * np.minimum(1, t / 0.012) * np.exp(-t / 0.025)


def snare(g=1.0, tone=190):
    d = 0.3
    t = tt(d)
    n = filt(noise(d), "bp", (1200, 7000)) * np.exp(-t / 0.1)
    b = np.sin(2 * np.pi * tone * t) * np.exp(-t / 0.06)
    return (0.8 * n + 0.6 * b) * g


def crash(d=2.4, soft=False):
    t = tt(d)
    L = filt(noise(d, 11), "hp", 5000, 2)
    R = filt(noise(d, 13), "hp", 5000, 2)
    e = np.minimum(1, t / (0.03 if soft else 0.002)) * np.exp(-t / 1.0)
    return np.stack([L * e, R * e])


# ---------------------------------------------------------------- 화성
CH = {"D": [50, 57, 62, 66], "A": [52, 57, 61, 64], "Bm": [50, 54, 59, 62], "G": [50, 55, 59, 62]}
ROOT = {"D": 38, "A": 33, "Bm": 35, "G": 31}
PROG = [(5.5, "D"), (8, "A"), (10, "G"), (12, "Bm"), (14, "G"), (16, "D"), (18, "A"), (20, "Bm"), (22, "G"), (24, "D"), (26, "A"),
        (28, "D"), (30, "A"), (32, "Bm"), (34, "G"), (36, "D"), (38, "A"), (40, "Bm"), (42, "G"), (44, "D"), (46, "A"), (48, "Bm"),
        (50, "G"), (52, "A"), (54, "D"), (56, "D"), (58, "A"), (60, "G"), (62, "D")]


def chord_at(t):
    c = None
    for s, n in PROG:
        if t + 1e-6 >= s:
            c = n
    return c


def seg_end(i):
    return PROG[i + 1][0] if i + 1 < len(PROG) else DUR + 1


def in_(t, a, b):
    return a <= t < b


VERSE, CHORUS, BREAK, FINAL = (12, 28), (28, 50), (50, 56), (56, 62)

# 패드
for i, (s, c) in enumerate(PROG):
    e = seg_end(i)
    g = 0.16 if s < 12 else 0.10 if s < 28 else 0.10 if s < 50 else 0.18 if s < 56 else 0.12
    if s >= 62:
        g = 0.13
    put(music, pad(CH[c], e - s + 0.6, 1500 if s >= 28 else 1000), s, g, send=0.5)

# 피아노
for i, (s, c) in enumerate(PROG):
    e = seg_end(i)
    tones = CH[c] + [CH[c][1] + 12, CH[c][2] + 12]
    if s < 12:                                     # 굴려 치는 화음
        for j, m in enumerate(CH[c]):
            put(music, piano(m + 12, 3.0, 0.55), s + j * 0.03, 0.9, pan=-0.2 + 0.13 * j, send=0.45)
        if s >= 8:
            for k, x in enumerate(np.arange(s, e, 0.25)):
                put(music, piano(tones[[0, 2, 4, 2, 1, 3, 5, 3][k % 8]] + 12, 1.2, 0.3), x, 0.6, pan=0.25 * np.sin(k), send=0.4)
    elif in_(s, *VERSE) or in_(s, *BREAK):          # 8분 분산화음
        vel = 0.32 if in_(s, *VERSE) else 0.42
        for k, x in enumerate(np.arange(s, e, 0.25)):
            put(music, piano(tones[[0, 2, 4, 5, 3, 4, 2, 1][k % 8]] + 12, 1.4, vel), x, 0.42 if in_(s, *VERSE) else 0.5, pan=0.3 * np.sin(k * 0.9), send=0.45)
        put(music, piano(ROOT[c] + 12, 2.2, 0.5), s, 0.5, send=0.3)
    else:                                          # 후렴: 리듬 있는 코드
        for st in (0, 3, 6, 10, 12):
            x = s + st * 0.125
            if x >= e:
                continue
            for j, m in enumerate(CH[c]):
                put(music, piano(m + 12, 0.9, 0.5), x + j * 0.004, 0.7, pan=-0.2 + 0.13 * j, send=0.3)
        for k, x in enumerate(np.arange(s, e, 0.25)):
            if k % 2:
                put(music, piano(tones[[3, 4, 5, 4][k // 2 % 4]] + 24, 0.8, 0.3), x, 0.35, pan=0.4, send=0.4)

# 마지막 화음
for j, m in enumerate([50, 57, 62, 66, 69, 74]):
    put(music, piano(m + 12, 4.5, 0.7), 62.0 + j * 0.05, 0.5, pan=-0.3 + 0.12 * j, send=0.6)

# 베이스
for i, (s, c) in enumerate(PROG):
    e = seg_end(i)
    if s < 12:
        continue
    if in_(s, *VERSE) or in_(s, *BREAK) or s >= 62:
        put(music, bass_note(ROOT[c] + 12, min(e - s, 4.0) - 0.05), s, 0.24)
    else:
        for k, x in enumerate(np.arange(s, e, 0.25)):
            m = ROOT[c] + 12 + (12 if k % 4 == 3 else 0)
            put(music, bass_note(m, 0.2), x, 0.30)

# 드럼
KICKS = []
for bar in np.arange(12, 28, 2.0):                 # 하프타임
    for off in (0, 0.75):
        KICKS.append(bar + off)
        put(drums, kick(0.8, soft=True), bar + off)
    put(drums, rim(), bar + 1.0, 0.35, send=0.3)
    for x in np.arange(bar, bar + 2, 0.25 if bar < 20 else 0.125):
        put(drums, shaker(), x, 0.10 if ((x - bar) % 0.5) < 0.01 else 0.06, pan=0.3)
for bars in ((28, 50), (56, 62)):                    # 팝 비트
    for bar in np.arange(bars[0], bars[1], 2.0):
        for st in (0, 6, 8):
            KICKS.append(bar + st * 0.125)
            put(drums, kick(0.95), bar + st * 0.125)
        for st in (4, 12):
            put(drums, clap(), bar + st * 0.125, 0.4, send=0.25)
        for st in range(0, 16, 2):
            put(drums, hat(st == 14), bar + st * 0.125, 0.14 if st == 14 else 0.09, pan=-0.2)
        for st in range(1, 16, 2):
            put(drums, shaker(), bar + st * 0.125, 0.05, pan=0.3)
for a, b in ((27.0, 28.0), (49.5, 50.0), (55.0, 56.0)):    # 필인
    xs = list(np.arange(a, b, 0.125 if b - a > 0.6 else 0.0625))
    if b - a > 0.6:
        xs = list(np.arange(a, a + 0.5, 0.125)) + list(np.arange(a + 0.5, b, 0.0625))
    for i, x in enumerate(xs):
        put(drums, snare(0.15 + 0.55 * (x - a) / (b - a), 190 + 90 * (x - a) / (b - a)), x, 0.6, send=0.25)
put(drums, crash(soft=True), 28.0, 0.16, send=0.3)
put(drums, crash(soft=True), 56.0, 0.16, send=0.3)
put(drums, crash(3.5, soft=True), 62.0, 0.12, send=0.4)

# ---------------------------------------------------------------- 효과음
PENTA = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86, 88, 90, 93, 95]


def s_pop(n):
    m = PENTA[min(n, len(PENTA) - 1)] + 12
    t = tt(0.16)
    f = midi(m) * (0.55 + 0.45 * (1 - np.exp(-t / 0.012)))
    return fade(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.05), 0.001, 0.02)


def s_tick(hi=False):
    t = tt(0.05)
    return np.sin(2 * np.pi * (3400 if hi else 2500) * t) * np.exp(-t / 0.008) + 0.4 * filt(noise(0.05), "hp", 4000) * np.exp(-t / 0.002)


def s_click():
    t = tt(0.06)
    return (filt(noise(0.06), "bp", (1500, 6000)) * np.exp(-t / 0.003) + 0.5 * np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.01))


def s_whoosh(d=0.36, up=True, peak=0.62):
    t = tt(d)
    u = t / d
    fc = np.where(u < peak, 400 * (6.0 ** (u / peak)), 2400 * (0.4 ** ((u - peak) / (1 - peak))))
    return svf(noise(d), fc, 1.8, "bp") * np.sin(np.pi * np.clip(u, 0, 1)) ** 1.6 * 1.5


def s_riser(d):
    t = tt(d)
    u = t / d
    y = svf(noise(d), 300 * (25 ** u), 3.0, "bp") * (u ** 2) * 1.3
    return fade(y, 0.01, 0.02)


def s_swell(d, c):
    """거꾸로 감긴 패드: 점점 커지다 끝에서 멈춘다."""
    t = tt(d)
    u = t / d
    y = sum(np.sin(2 * np.pi * midi(m + 12) * t + rs.uniform(0, 6)) for m in CH[c]) * 0.3
    y += 0.5 * svf(noise(d), 800 + 4000 * u, 1.5, "bp")
    return fade(y * u ** 2.2, 0.01, 0.03)


def s_rev(d, lo=False, limiter=0):
    dl = 0.75 if limiter else 0
    t = tt(d + dl)
    u = np.clip(t / d, 0, 1)
    f0, f1 = (30, 70) if lo else (36, 118)
    f = f0 + (f1 - f0) * u ** 1.4
    gate = np.ones_like(t)
    if limiter:
        tl = t - d
        ph = (tl % 0.125) / 0.125
        on = (tl >= 0) & (ph < 0.55)
        gate = np.where(tl >= 0, on * (1 - 0.6 * np.clip(tl / dl, 0, 1)), 1.0)
        f = np.where(tl >= 0, f1 * (0.93 + 0.07 * (ph < 0.55)), f)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = 0.6 * ((ph / (2 * np.pi)) % 1 * 2 - 1) + 0.5 * np.sign(np.sin(ph)) + 0.3 * np.sin(ph / 2)
    y = np.tanh(2.4 * y * (1 + 0.35 * np.sin(ph * 0.5)))
    y = svf(y, 500 + 2600 * u, 0.9, "lp")
    amp = signal.lfilter([0.02], [1, -0.98], (0.25 + 0.75 * u) * gate)
    return fade(y * amp, 0.04, 0.03) * 1.3


def s_boom(d=1.4, depth=1.0):
    t = tt(d)
    f = 34 + 110 * np.exp(-t / 0.06)
    y = np.tanh(1.3 * np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.55)) + 0.35 * filt(noise(d), "lp", 2500) * np.exp(-t / 0.15)
    return fade(y * depth, 0.002, 0.05)


def s_redhit():
    d = 1.6
    t = tt(d)
    st = sum(supersaw(m, d, 4, 0.25, 30) for m in (50, 51, 57, 62))
    return s_boom(d) + 0.45 * np.tanh(3 * st) * np.exp(-t / 0.4)


def s_seq(times, maker):
    y = np.zeros(int((max(times) + 0.6) * SR))
    for x in times:
        z = maker(x)
        i = int(x * SR)
        y[i:i + len(z)] += z[: len(y) - i]
    return y


for c in cues["sfx"]:
    t0, ty = c["t"], c["type"]
    if ty == "drone":
        t = tt(c["d"] + 0.4)
        y = (np.sin(2 * np.pi * 36.7 * t) + 0.5 * filt(saw_add(73.4, t, 12), "lp", 300) + 0.3 * np.sin(2 * np.pi * 55 * t))
        y *= np.minimum(1, t / 1.5) * np.where(t < c["d"] - 0.3, 1, np.exp(-(t - c["d"] + 0.3) / 0.15))
        put(music, y, t0, 0.22)
    elif ty == "rev":
        put(fxbus, s_rev(c["d"], c.get("lo", False)), t0, 0.26 if c.get("lo") else 0.34)
    elif ty == "tickbuild":
        ts, x, iv = [], 0.0, 0.25
        while x < c["d"]:
            ts.append(x)
            x += iv
            iv = max(0.0625, iv * 0.9)
        put(drums, s_seq(ts, lambda q: hat(False) * (0.3 + 0.7 * q / c["d"])), t0, 0.22)
    elif ty == "redhit":
        put(fxbus, s_redhit(), t0, 0.5, send=0.4)
    elif ty == "limiter":
        put(fxbus, s_rev(0.001, False, limiter=1)[int(0.001 * SR):], t0, 0.3)
    elif ty == "cut":
        put(fxbus, filt(noise(0.25), "lp", 900) * np.exp(-tt(0.25) / 0.05), t0, 0.25, send=0.6)
    elif ty == "chime":
        put(fxbus, bell(81, 2.0, 1.6, 3.5, 0.7) + 0.6 * bell(88, 2.0, 1.4, 3.5, 0.6), t0, 0.12, send=0.6)
    elif ty == "shimmer":
        for k, m in enumerate([74, 78, 81, 86, 90, 93]):
            put(fxbus, bell(m, 1.2, 1.2, 2.0, 0.4), t0 + k * 0.035, 0.05, pan=-0.5 + 0.2 * k, send=0.6)
    elif ty == "title":
        put(fxbus, s_boom(1.2, 0.7), t0, 0.3, send=0.3)
    elif ty == "lantern":
        n = c["n"]
        m = PENTA[min(14, round(n * 14 / 59))]
        put(fxbus, bell(m + 12, 0.6, 1.0, 2.0, 0.22), t0, 0.05 + 0.03 * (n / 59), pan=0.6 * np.sin(n * 0.7), send=0.45)
    elif ty == "bell":
        put(fxbus, bell(c["m"] + 12, 2.0, 1.6, 3.5, 0.8), t0, 0.12, send=0.6)
    elif ty == "slide":
        put(fxbus, s_whoosh(0.8, peak=0.7), t0 - 0.1, 0.16, send=0.4)
    elif ty == "meet":
        put(fxbus, bell(86, 1.5, 1.2, 3.5, 0.6) + bell(93, 1.5, 1.0, 3.5, 0.5) * 0.6, t0, 0.07, send=0.6)
    elif ty == "swell":
        put(fxbus, s_swell(c["d"], chord_at(t0 + c["d"]) or "D"), t0, 0.16, send=0.5)
    elif ty == "riser":
        put(fxbus, s_riser(c["d"]), t0, 0.2, send=0.3)
    elif ty == "drop":
        put(fxbus, s_boom(1.6), t0, 0.42, send=0.35)
        for k, m in enumerate([74, 78, 81, 86]):
            put(fxbus, bell(m, 1.6, 1.4, 3.5, 0.6), t0 + 0.02 * k, 0.06, pan=-0.3 + 0.2 * k, send=0.5)
    elif ty == "pop":
        put(fxbus, s_pop(c.get("n", 0)), t0, 0.26, pan=rs.uniform(-0.3, 0.3), send=0.25)
    elif ty in ("whoosh", "sweep"):
        put(fxbus, s_whoosh(0.4 if ty == "sweep" else 0.34), t0 - 0.06, 0.2, pan=-0.3, send=0.25)
    elif ty == "fill":
        ts = [c["d"] * i / 12 for i in range(12)]
        put(fxbus, s_seq(ts, lambda q: np.sin(2 * np.pi * (1500 + 1800 * q / c["d"]) * tt(0.03)) * np.exp(-tt(0.03) / 0.006)), t0, 0.1, send=0.2)
    elif ty == "ding":
        put(fxbus, bell(88, 1.4, 2.0, 3.5, 0.45) + bell(95, 1.4, 1.6, 3.5, 0.4) * 0.6, t0, 0.12, send=0.45)
    elif ty == "tick":
        put(fxbus, s_tick(), t0, 0.07 if c.get("soft") else 0.1)
    elif ty == "home":
        for k, m in enumerate([81, 86, 90, 93, 98]):
            put(fxbus, bell(m, 1.8, 1.2, 3.5, 0.6), t0 + 0.05 * k, 0.07, pan=-0.4 + 0.2 * k, send=0.6)
    elif ty == "select":
        put(fxbus, s_click(), t0, 0.18)
        put(fxbus, bell([71, 74, 81][c["n"]] + 12, 1.2, 1.3, 3.5, 0.5), t0, 0.09 if c["n"] < 2 else 0.13, send=0.5)
    elif ty == "climax":
        put(fxbus, s_boom(2.4, 0.6), t0, 0.32, send=0.5)
        for k, m in enumerate([74, 78, 81, 86, 90]):
            put(fxbus, bell(m, 2.6, 1.0, 3.5, 1.0), t0 + 0.06 * k, 0.06, pan=-0.4 + 0.2 * k, send=0.7)
    elif ty == "end":
        for k, m in enumerate([86, 90, 93]):
            put(fxbus, bell(m, 3.0, 1.0, 3.5, 1.2), t0 + 0.08 * k, 0.06, send=0.7)

# ---------------------------------------------------------------- 사이드체인 · 리버브 · 마스터
tN = np.arange(N) / SR
duck = np.ones(N)
for k in KICKS:
    if not (28 <= k < 50 or 56 <= k < 62):
        continue
    i = int(k * SR)
    seg = tN[i:i + int(0.4 * SR)] - k
    duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], 1 - 0.45 * np.exp(-seg / 0.12))
music *= duck


def ir(rt, seed):
    t = tt(rt)
    return filt(np.random.RandomState(seed).randn(len(t)) * np.exp(-t * 6.9 / rt), "lp", 5500) * 0.03


wet = np.stack([signal.fftconvolve(verb[0], ir(2.6, 1))[:N], signal.fftconvolve(verb[1], ir(2.6, 2))[:N]])
wet = filt(wet, "hp", 200)

mix = 0.8 * music + 0.62 * drums + 0.8 * fxbus + 0.55 * wet
mix = signal.sosfilt(sos("hp", 28), mix)
if len(sys.argv) > 3:
    def db(x):
        return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
    secs = ((0, 5), (5, 12), (12, 28), (28, 50), (50, 56), (56, 62), (62, 66))
    print("       " + " ".join("%5d-%-3d" % s for s in secs))
    for name, b in (("music", 0.8 * music), ("drums", 0.62 * drums), ("fx", 0.8 * fxbus), ("wet", 0.55 * wet), ("mix", mix)):
        print("%-6s" % name, " ".join("%8.1f" % db(b[:, int(a * SR):int(z * SR)]) for a, z in secs))


def lufs(x):
    k = signal.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1, -1.69065929318241, 0.73248077421585], x, axis=1)
    k = signal.lfilter([1.0, -2.0, 1.0], [1, -1.99004745483398, 0.99007225036621], k, axis=1)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    z = np.array([np.sum(np.mean(k[:, i:i + blk] ** 2, axis=1)) for i in range(0, k.shape[1] - blk, hop)])
    z = z[-0.691 + 10 * np.log10(z + 1e-12) > -70]
    rel = -0.691 + 10 * np.log10(np.mean(z)) - 10
    z = z[(-0.691 + 10 * np.log10(z)) > rel]
    return -0.691 + 10 * np.log10(np.mean(z))


end0 = int(DUR * SR)
mix *= 10 ** ((-14.0 - lufs(mix[:, :end0])) / 20)
CEIL = 0.84
g0 = np.minimum(1.0, CEIL / np.maximum(np.max(np.abs(mix), axis=0), 1e-9))
g = minimum_filter1d(g0, 2 * int(0.003 * SR) + 1)
g = signal.lfilter([1 - 0.9995], [1, -0.9995], g - 1) + 1
g = np.minimum(g, minimum_filter1d(g0, 2 * int(0.003 * SR) + 1))
mix *= g
print("loudness %.1f LUFS, max gain reduction %.1f dB" % (lufs(mix[:, :end0]), -20 * np.log10(np.min(g))))
fo = int(1.2 * SR)
mix[:, end0 - fo:end0] *= np.linspace(1, 0, fo) ** 2
mix = mix[:, :end0]
pcm = (np.clip(mix.T, -1, 1) * 32767).astype("<i2")
with wave.open(sys.argv[2], "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", sys.argv[2], mix.shape[1] / SR, "s")
