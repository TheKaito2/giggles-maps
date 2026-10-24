# Cloud art for page tops: python3 gen.py <outdir>. Each cloud = overlapping puffs on a flat base; a blurred shade sits under it.
import random, sys
out = sys.argv[1]
def cloud(cx, cy, w, rnd):
    h = w * 0.34
    puffs = []
    n = 5
    for k in range(n):
        t = k / (n - 1)
        x = cx - w / 2 + w * (0.12 + 0.76 * t)
        hump = 1 - abs(t - 0.45) * 1.3          # tallest a little left of centre
        r = h * (0.42 + 0.5 * max(hump, 0.15)) * (0.9 + rnd.random() * 0.2)
        puffs.append((x, cy - r * 0.55, r))
    base = (cx - w / 2 + h * 0.3, cy - h * 0.32, w - h * 0.6, h * 0.62)
    return puffs, base
def shapes(puffs, base, dy=0):
    bx, by, bw, bh = base
    s = f'<rect x="{bx:.1f}" y="{by+dy:.1f}" width="{bw:.1f}" height="{bh:.1f}" rx="{bh/2:.1f}"/>'
    for x, y, r in puffs: s += f'<circle cx="{x:.1f}" cy="{y+dy:.1f}" r="{r:.1f}"/>'
    return s
def sky(fill, shade, extra, seed):
    rnd = random.Random(seed)
    clouds = [(140, 150, 230), (520, 95, 170), (900, 165, 260), (1130, 80, 140), (330, 250, 150), (720, 270, 120)]
    body = ''
    for cx, cy, w in clouds:
        p, b = cloud(cx, cy, w, rnd)
        body += f'<g fill="{shade}" filter="url(#soft)" opacity=".9">{shapes(p, b, 9)}</g>'
        body += f'<g fill="{fill}" filter="url(#edge)">{shapes(p, b)}</g>'
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 320" preserveAspectRatio="xMidYMin slice">
<defs><filter id="soft" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
<filter id="edge" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="1.2"/></filter></defs>
{extra}{body}</svg>'''
open(f'{out}/sky-day.svg', 'w').write(sky('#ffffff', '#cfe6ff', '<circle cx="1050" cy="70" r="34" fill="#ffd34d" opacity=".9" filter="url(#soft)"/><circle cx="1050" cy="70" r="26" fill="#ffd34d"/>', 7))
rnd = random.Random(3)
stars = ''.join(f'<circle cx="{rnd.uniform(0,1240):.0f}" cy="{rnd.uniform(0,300):.0f}" r="{rnd.choice([1,1,1.4,1.8])}" fill="#fff" opacity="{rnd.uniform(.35,.9):.2f}"/>' for _ in range(60))
moon = '<circle cx="1050" cy="72" r="30" fill="#ffe9a8"/><circle cx="1062" cy="62" r="27" fill="#142a63"/>'
open(f'{out}/sky-night.svg', 'w').write(sky('#2c4378', '#16264f', stars + moon, 7))
