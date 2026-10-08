#!/usr/bin/env python3
"""Synthesize the SwapFont demo soundtrack. Original work, generated locally.

Outputs (48 kHz, 16-bit WAV) into ../sfx/:
  music-bed.wav  24.0 s stereo instrumental, 120 BPM, C major (Am F C G)
  click.wav      punchy UI click for the cursor clicks
  swap-a.wav     two-note blip for a font swap over the A minor bar
  swap-f.wav     same, over the F bar
  swap-g.wav     same, over the G bar

Deterministic: fixed seed, no external samples. Needs only numpy.
Run:  python3 scripts/make_audio.py
"""
import os
import wave

import numpy as np

SR = 48000
DUR = 24.0
N = int(SR * DUR)
BEAT = 0.5  # 120 BPM
BAR = 2.0
rng = np.random.default_rng(424242)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "sfx")


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def noise_band(dur, lo, hi):
    n = int(dur * SR)
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    mask = 1 / (1 + (lo / np.maximum(f, 1)) ** 6) / (1 + (f / hi) ** 6)
    x = np.fft.irfft(spec * mask, n)
    return x / (np.max(np.abs(x)) + 1e-9)


def fade_edges(x, a=0.003, r=0.01):
    na, nr = int(a * SR), int(r * SR)
    x = x.copy()
    x[:na] *= np.linspace(0, 1, na)
    x[-nr:] *= np.linspace(1, 0, nr)
    return x


def pluck(freq, dur, nharm=10, bright=0.08, decay=0.25, detune=0.0):
    """Additive pluck: upper harmonics die first, so it opens bright and settles."""
    t = tt(dur)
    f = freq * 2 ** (detune / 1200)
    x = np.zeros_like(t)
    for k in range(1, nharm + 1):
        if k * f > 15000:
            break
        x += np.sin(2 * np.pi * k * f * t) / k * np.exp(-t * (k - 1) / (bright * 6))
    return fade_edges(x * np.exp(-t / decay))


def saw(freq, dur, nharm=10, tilt=1.3, detune=0.0):
    t = tt(dur)
    f = freq * 2 ** (detune / 1200)
    x = np.zeros_like(t)
    for k in range(1, nharm + 1):
        if k * f > 12000:
            break
        x += np.sin(2 * np.pi * k * f * t + k) / k**tilt
    return x


def kick():
    t = tt(0.4)
    f = 46 + 120 * np.exp(-t / 0.03)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.13)
    tick = noise_band(0.4, 2000, 9000) * np.exp(-t / 0.003) * 0.35
    return fade_edges(np.tanh(1.6 * body) + tick, 0.0005, 0.03)


def clap():
    t = tt(0.3)
    env = sum(np.where(t >= d, np.exp(-(t - d) / 0.008), 0) for d in (0, 0.011, 0.022))
    env = env * 0.5 + np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.07), 0)
    return fade_edges(noise_band(0.3, 900, 7000) * env)


def hat(open_=False):
    dur, tau = (0.28, 0.07) if open_ else (0.07, 0.014)
    return fade_edges(noise_band(dur, 7000, 17000) * np.exp(-tt(dur) / tau), 0.0005, 0.01)


def snare():
    t = tt(0.16)
    tone = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04) * 0.5
    return fade_edges(noise_band(0.16, 1500, 9000) * np.exp(-t / 0.035) + tone, 0.0005, 0.01)


def riser(dur):
    t = tt(dur)
    p = t / dur
    air = noise_band(dur, 2500, 13000) * p**2.6
    f = 280 * 2 ** (3.2 * p)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * p**2 * 0.25
    return fade_edges(air + tone, 0.01, 0.004)


def impact():
    t = tt(1.6)
    f = 34 + 40 * np.exp(-t / 0.08)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.35)
    crash = noise_band(1.6, 3500, 15000) * np.exp(-t / 0.45) * 0.4
    return fade_edges(boom, 0.001, 0.05), fade_edges(crash, 0.001, 0.05)


class Bus:
    def __init__(self):
        self.l = np.zeros(N + SR * 2)
        self.r = np.zeros(N + SR * 2)

    def add(self, x, t, gain=1.0, pan=0.0):
        i = int(round(t * SR))
        if i >= N:
            return
        gl = gain * np.cos((pan + 1) * np.pi / 4)
        gr = gain * np.sin((pan + 1) * np.pi / 4)
        self.l[i : i + len(x)] += x * gl * 1.4142
        self.r[i : i + len(x)] += x * gr * 1.4142

    def delay(self, time, fb, mix):
        """Ping-pong echo, two repeats."""
        d = int(time * SR)
        l, r = self.l.copy(), self.r.copy()
        self.l[d:] += r[:-d] * mix
        self.r[d:] += l[:-d] * mix
        self.l[2 * d :] += l[: -2 * d] * mix * fb
        self.r[2 * d :] += r[: -2 * d] * mix * fb

    def scale(self, env):
        self.l[:N] *= env
        self.r[:N] *= env


# Harmony: pad voicing, bass root, per bar
AM = ([57, 60, 64], 33)
F = ([53, 57, 60], 41)
C = ([55, 60, 64], 36)
G = ([55, 59, 62], 43)
BARS = [AM, F, C, G, AM, F, C, G, F, G]  # 0-20 s, then C to finish

drums, bass, pad, arp, lead, fx = Bus(), Bus(), Bus(), Bus(), Bus(), Bus()
K, CL, HC, HO, SN = kick(), clap(), hat(), hat(True), snare()

# Sections: intro 0-3, A 3-8, B 8-14, C 14-20, ending 20-24
DROPS = (3.0, 8.0, 14.0, 20.0)
kick_times = []
t = 3.0
while t < 20.0 - 1e-6:
    gap = (7.5 <= t < 8.0) or (13.5 <= t < 14.0) or (19.0 <= t < 20.0)
    if not gap:
        drums.add(K, t, 0.95)
        kick_times.append(t)
    beat_in_bar = round((t % BAR) / BEAT)
    if beat_in_bar in (1, 3) and not gap:
        drums.add(CL, t, 0.34, 0.05)
    # offbeat hats, 16ths from section B, open hats in C
    if t >= 14.0:
        drums.add(HO, t + 0.25, 0.11, 0.25)
    else:
        drums.add(HC, t + 0.25, 0.16, 0.25)
    if t >= 8.0:
        for off, g in ((0.0, 0.05), (0.125, 0.07), (0.375, 0.07)):
            drums.add(HC, t + off, g, -0.3)
    t += BEAT
for t in np.arange(1.0, 3.0, 0.25):  # intro hats
    drums.add(HC, t, 0.05 + 0.04 * (t - 1.0), 0.2)
for i, t in enumerate(np.arange(19.0, 20.0, 0.125)):  # roll into the ending
    drums.add(SN, t, 0.12 + 0.03 * i, 0.0)
for t in (19.75, 19.875, 19.9375):
    drums.add(SN, t + 0.0625 if t < 19.9 else t, 0.3)

# Bass: offbeat 8ths, extra 16th an octave up in section C
for b, (_, root) in enumerate(BARS):
    for beat in range(4):
        t = b * BAR + beat * BEAT
        if t < 3.0:
            continue
        bass.add(pluck(hz(root), 0.22, 12, 0.07, 0.16) + 0.6 * np.sin(2 * np.pi * hz(root) * tt(0.22)) * fade_edges(np.ones(int(0.22 * SR))), t + 0.25, 0.42)
        if t >= 14.0:
            bass.add(pluck(hz(root + 12), 0.11, 10, 0.06, 0.08), t + 0.375, 0.2)

# Pad: detuned saws per bar, pumped against the kick
for b, (notes, _) in enumerate(BARS):
    for m in notes:
        for det, pan in ((-6, -0.6), (6, 0.6)):
            x = saw(hz(m), BAR + 0.1, 9, 1.4, det)
            n = len(x)
            x[: int(0.06 * SR)] *= np.linspace(0, 1, int(0.06 * SR))
            x[-int(0.1 * SR) :] *= np.linspace(1, 0, int(0.1 * SR))
            pad.add(x, b * BAR, 0.05, pan)
pump = np.ones(N)
for kt in kick_times:
    i = int(kt * SR)
    n = int(0.36 * SR)
    seg = 0.22 + 0.78 * (np.arange(n) / n) ** 1.6
    pump[i : i + n] = np.minimum(pump[i : i + n], seg[: len(pump[i : i + n])])
swell = np.clip(np.arange(N) / (3.0 * SR), 0, 1) ** 1.5 * 0.9 + 0.1  # intro opens up
pad.scale(pump * np.where(np.arange(N) < 3.0 * SR, swell, 1.0))

# Arp: 16th plucks through the chord, brighter as the intro builds
ARP = [0, 1, 2, 3, 2, 1, 2, 3]
for b, (notes, _) in enumerate(BARS):
    tones = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[0] + 24]
    for s in range(16):
        t = b * BAR + s * 0.125
        open_ = min(1.0, 0.25 + t / 4.0)
        accent = 1.0 if s % 4 == 0 else 0.7
        arp.add(pluck(hz(tones[ARP[s % 8]]), 0.3, int(3 + 9 * open_), 0.03 + 0.05 * open_, 0.11), t, 0.13 * accent * (0.6 + 0.4 * open_), 0.55 if s % 2 else -0.55)

# Lead: enters at section B, doubled an octave down in C
E5, D5, C5, A4, G5, A5, F5, B5, C6, D6 = 76, 74, 72, 69, 79, 81, 77, 83, 84, 86
RHY = [(0.0, 0.5), (0.5, 0.25), (0.75, 0.5), (1.25, 0.25), (1.5, 0.5)]
MEL = {
    4: [E5, A5, G5, E5, D5],
    5: [C5, F5, E5, C5, A4],
    6: [E5, G5, E5, D5, C5],
    7: [D5, G5, B5, A5, G5],
    8: [A5, C6, A5, G5, F5],
    9: [G5, B5, D6, B5, D6],
}
for b, notes in MEL.items():
    for (off, ln), m in zip(RHY, notes):
        t = b * BAR + off
        x = pluck(hz(m), ln + 0.25, 14, 0.2, 0.28) + 0.35 * pluck(hz(m), ln + 0.25, 6, 0.3, 0.3, 9)
        lead.add(x, t, 0.17)
        if t >= 14.0:
            lead.add(pluck(hz(m - 12), ln + 0.25, 10, 0.15, 0.25), t, 0.09)

# Lifts into each section, impacts on each drop
for end, d in ((3.0, 1.0), (8.0, 1.0), (14.0, 1.0), (20.0, 2.0)):
    fx.add(riser(d), end - d, 0.2 if d == 1.0 else 0.26)
BOOM, CRASH = impact()
fx.add(BOOM, 0.0, 0.35)
for t in DROPS:
    fx.add(BOOM, t, 0.5 if t < 20 else 0.6)
    fx.add(CRASH, t, 0.16 if t < 20 else 0.22, 0.1)

# Ending: land on C major and let it ring
drums.add(K, 20.0, 0.95)
for i, m in enumerate([48, 55, 60, 64, 67, 72, 76]):
    arp.add(pluck(hz(m), 3.2, 12, 0.35, 1.1), 20.0 + 0.014 * i, 0.12, -0.5 + i / 6)
for m in (48, 55, 60, 64):
    for det, pan in ((-6, -0.6), (6, 0.6)):
        x = saw(hz(m), 3.6, 8, 1.5, det) * np.exp(-tt(3.6) / 1.1)
        pad.add(fade_edges(x, 0.02, 0.2), 20.0, 0.06, pan)
bass.add(fade_edges((np.sin(2 * np.pi * hz(36) * tt(2.5)) + 0.3 * saw(hz(36), 2.5, 6)) * np.exp(-tt(2.5) / 0.7), 0.004, 0.2), 20.0, 0.4)
for i, m in enumerate([84, 79, 76, 72]):
    lead.add(pluck(hz(m), 0.8, 12, 0.2, 0.35), 20.5 + 0.25 * i, 0.11 - 0.015 * i)

arp.delay(0.375, 0.45, 0.3)
lead.delay(0.375, 0.4, 0.26)

L = sum(b.l[:N] for b in (drums, bass, pad, arp, lead, fx))
R = sum(b.r[:N] for b in (drums, bass, pad, arp, lead, fx))
mix = np.stack([L, R], axis=1)
out_fade = np.ones(N)
a, z = int(22.6 * SR), int(23.8 * SR)
out_fade[a:z] = np.cos(np.linspace(0, np.pi / 2, z - a)) ** 2
out_fade[z:] = 0
mix *= out_fade[:, None]
mix[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))[:, None]
# Glue: gentle soft clip, then a fixed sample-peak ceiling of -2.5 dBFS
mix = np.tanh(mix * 1.15 / np.max(np.abs(mix)) * 1.25)
mix *= 10 ** (-2.5 / 20) / np.max(np.abs(mix))


def write(name, x):
    x = np.atleast_2d(x.T).T if x.ndim == 1 else x
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(os.path.join(OUT, name), "wb") as w:
        w.setnchannels(pcm.shape[1])
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"{name}: {len(pcm) / SR:.3f} s, peak {20 * np.log10(np.max(np.abs(x))):.1f} dBFS")


def click_sfx():
    t = tt(0.09)
    snap = noise_band(0.09, 2500, 14000) * np.exp(-t / 0.0025)
    f = 900 + 1500 * np.exp(-t / 0.006)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.014) * 0.8
    thump = np.sin(2 * np.pi * 170 * t) * np.exp(-t / 0.02) * 0.7
    x = fade_edges(snap + body + thump, 0.0003, 0.02)
    return x / np.max(np.abs(x)) * 10 ** (-4 / 20)


def swap_sfx(m1, m2):
    x = np.zeros(int(0.5 * SR))
    for m, at, g in ((m1, 0.0, 0.8), (m2, 0.07, 1.0)):
        p = pluck(hz(m), 0.4, 8, 0.12, 0.13) + 0.3 * pluck(hz(m + 12), 0.4, 4, 0.08, 0.07)
        i = int(at * SR)
        x[i : i + len(p)] += p * g
    air = noise_band(0.5, 4000, 14000) * np.exp(-((tt(0.5) - 0.06) ** 2) / 0.0012) * 0.25
    x = fade_edges(x + air, 0.001, 0.05)
    return x / np.max(np.abs(x)) * 10 ** (-5 / 20)


write("music-bed.wav", mix)
write("click.wav", click_sfx())
write("swap-a.wav", swap_sfx(88, 93))  # E6 A6
write("swap-f.wav", swap_sfx(84, 89))  # C6 F6
write("swap-g.wav", swap_sfx(86, 91))  # D6 G6
