# usage: analyze.py DIR FPS  -> per-frame luminance / motion stats, flags pops & blown-out frames, writes DIR/analysis.png + analysis.json
import sys, json, glob, os
import numpy as np
from PIL import Image, ImageDraw
d, fps = sys.argv[1], float(sys.argv[2])
files = sorted(glob.glob(os.path.join(d, 'f_*.png')))
lum, diff, blown, black, sat = [], [], [], [], []
prev = None
for f in files:
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float32)
    y = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    lum.append(float(y.mean())); blown.append(float((y > 250).mean())); black.append(float((y < 6).mean()))
    mx, mn = a.max(-1), a.min(-1); sat.append(float(((mx - mn) / (mx + 1e-3)).mean()))
    diff.append(float(np.abs(y - prev).mean()) if prev is not None else 0.0); prev = y
diff = np.array(diff); med = float(np.median(diff[1:])) if len(diff) > 2 else 0
flags = []
for i in range(1, len(diff)):
    if diff[i] > max(4 * med, 6.0): flags.append({'t': round(i / fps, 2), 'kind': 'motion-spike', 'diff': round(float(diff[i]), 2), 'median': round(med, 2)})
    if blown[i] > 0.35: flags.append({'t': round(i / fps, 2), 'kind': 'blown-out', 'frac': round(blown[i], 3)})
    if black[i] > 0.985 and i > 2: flags.append({'t': round(i / fps, 2), 'kind': 'nearly-black', 'frac': round(black[i], 3)})
lum_a = np.array(lum)
for i in range(1, len(lum_a)):
    if abs(lum_a[i] - lum_a[i - 1]) > 25: flags.append({'t': round(i / fps, 2), 'kind': 'luminance-jump', 'from': round(float(lum_a[i - 1]), 1), 'to': round(float(lum_a[i]), 1)})
res = {'frames': len(files), 'fps': fps, 'mean_luma_avg': round(float(lum_a.mean()), 2), 'mean_luma_min': round(float(lum_a.min()), 2), 'mean_luma_max': round(float(lum_a.max()), 2),
       'median_frame_diff': round(med, 3), 'mean_saturation': round(float(np.mean(sat)), 3), 'flags': flags}
json.dump({**res, 'luma': [round(x, 2) for x in lum], 'diff': [round(float(x), 2) for x in diff]}, open(os.path.join(d, 'analysis.json'), 'w'))
# plot
Wd, Hd = 1200, 360; im = Image.new('RGB', (Wd, Hd), (14, 14, 20)); g = ImageDraw.Draw(im)
n = max(1, len(lum)); 
def pl(vals, mx, col, y0, hh):
    pts = [(40 + i * (Wd - 60) / max(1, n - 1), y0 + hh - min(1, v / mx) * hh) for i, v in enumerate(vals)]
    if len(pts) > 1: g.line(pts, fill=col, width=2)
g.text((40, 6), 'mean luma (0-255, green)   frame diff (orange)   blown fraction x100 (red)   -- x axis: seconds', fill=(200, 200, 200))
pl(lum, 255, (90, 255, 140), 24, 150); pl(list(diff), max(10, float(diff.max())), (255, 170, 60), 190, 150); pl([b * 100 for b in blown], 100, (255, 80, 80), 24, 150)
for s in range(0, int(len(lum) / fps) + 1):
    x = 40 + s * fps * (Wd - 60) / max(1, n - 1); g.line([(x, 345), (x, 352)], fill=(120, 120, 130)); g.text((x - 4, 353 - 2), str(s), fill=(150, 150, 160))
im.save(os.path.join(d, 'analysis.png'))
print(json.dumps(res, indent=1, ensure_ascii=False))
