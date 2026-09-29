# usage: audio_analyze.py score.wav  -> loudness/peak/clipping, per-second RMS, anchor hit detection, spectrogram PNG next to the wav
import sys, wave, json, os, re, subprocess
import numpy as np
from PIL import Image, ImageDraw
p = sys.argv[1]
w = wave.open(p, 'rb'); ch, sr, n = w.getnchannels(), w.getframerate(), w.getnframes()
x = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0; x = x.reshape(-1, ch)
mono = x.mean(1); dur = n / sr
peak = float(np.abs(x).max()); clip = int((np.abs(x) > 0.999).sum())
rms = float(np.sqrt((mono ** 2).mean()))
sec = [float(np.sqrt((mono[int(i * sr):int((i + 1) * sr)] ** 2).mean() + 1e-12)) for i in range(int(dur))]
db = lambda v: round(20 * np.log10(max(v, 1e-9)), 1)
corr = float(np.corrcoef(x[:, 0], x[:, 1])[0, 1]) if ch == 2 else 1.0
# anchors from timeline.js (parse the scenes array with node)
anchors = []
try:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    js = "import('" + root + "/src/timeline.js').then(m=>console.log(JSON.stringify(m.allAnchors())))"
    anchors = json.loads(subprocess.check_output(['node', '-e', js]).decode())
except Exception as e:
    print('anchor parse failed', e)
def win(t0, t1):
    a, b = int(max(0, t0) * sr), int(min(dur, t1) * sr); seg = mono[a:b]
    return float(np.sqrt((seg ** 2).mean() + 1e-12)) if len(seg) else 0.0
hits = []
for a in anchors:
    before = win(a['t'] - 1.0, a['t'] - 0.1); after = win(a['t'] - 0.02, a['t'] + 0.5)
    hits.append({'t': a['t'], 'id': a['id'], 'name': a['name'], 'lift_db': round(db(after) - db(before), 1)})
# spectrogram
N = 2048; hop = 1024; win_ = np.hanning(N); frames = []
for i in range(0, len(mono) - N, hop): frames.append(np.abs(np.fft.rfft(mono[i:i + N] * win_)))
S = np.array(frames).T; S = 20 * np.log10(S + 1e-7); S = np.clip((S + 100) / 80, 0, 1)
S = S[:int(N / 2 * min(1.0, 12000 / (sr / 2)))][::-1]
img = Image.fromarray((S * 255).astype(np.uint8)).resize((1600, 500), Image.BILINEAR)
lut = np.array([[int(255 * min(1, max(0, 1.5 * v - 0.2))), int(255 * min(1, max(0, 2 * v - 0.9))), int(255 * (0.25 + 0.75 * np.sin(np.pi * min(1, v * 1.3))) * (v > 0.02))] for v in np.linspace(0, 1, 256)], dtype=np.uint8)
col = Image.fromarray(lut[np.asarray(img)]); d = ImageDraw.Draw(col)
for a in anchors:
    xx = int(a['t'] / dur * 1600); d.line([(xx, 0), (xx, 500)], fill=(255, 255, 0) if a['name'] == 'hero' else (90, 90, 120), width=1)
for s in range(0, int(dur) + 1, 5): d.text((int(s / dur * 1600) + 3, 486), f'{s}s', fill=(255, 255, 255))
png = os.path.splitext(p)[0] + '_spectrogram.png'; col.save(png)
res = {'duration_s': round(dur, 2), 'sr': sr, 'channels': ch, 'peak_dBFS': db(peak), 'rms_dBFS': db(rms), 'clipped_samples': clip, 'stereo_corr': round(corr, 3),
       'rms_dBFS_per_second': [db(v) for v in sec], 'anchor_hits(lift_db = level jump at anchor; hero anchors should be >= +4 dB)': hits, 'spectrogram': png}
print(json.dumps(res, indent=1))
