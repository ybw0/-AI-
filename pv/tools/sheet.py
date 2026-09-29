# usage: sheet.py out.png cols file1 label1 file2 label2 ...   -> contact sheet with labels
import sys
from PIL import Image, ImageDraw
out, cols = sys.argv[1], int(sys.argv[2]); items = list(zip(sys.argv[3::2], sys.argv[4::2]))
ims = [(Image.open(f).convert('RGB'), l) for f, l in items]
tw = 640; th = int(tw * ims[0][0].height / ims[0][0].width)
rows = (len(ims) + cols - 1) // cols
S = Image.new('RGB', (cols * tw + (cols + 1) * 6, rows * th + (rows + 1) * 6), (24, 24, 30))
for i, (im, lab) in enumerate(ims):
    r, c = divmod(i, cols); im = im.resize((tw, th), Image.LANCZOS)
    d = ImageDraw.Draw(im); d.rectangle([0, 0, 8 * len(lab) + 10, 16], fill=(0, 0, 0)); d.text((5, 3), lab, fill=(255, 255, 0))
    S.paste(im, (6 + c * (tw + 6), 6 + r * (th + 6)))
S.save(out)
