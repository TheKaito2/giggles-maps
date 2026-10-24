# Renders the sky-and-clouds brand images from public/logo.svg and public/sky-day.svg with headless Chrome (Playwright):
#   python3 web/tools/brand_assets.py
# -> ios AppIcon (1024), iOS splash (2732), public/apple-touch-icon.png (180), public/og.png (1200x630 share card),
#    docs/assets/banner.png (README header).
import base64, pathlib
from playwright.sync_api import sync_playwright

WEB = pathlib.Path(__file__).resolve().parent.parent
IOS = WEB.parent / "ios/App/App/Assets.xcassets"
logo = (WEB / "public/logo.svg").read_text()
sky = (WEB / "public/sky-day.svg").read_text()
font = lambda f: "data:font/woff2;base64," + base64.b64encode((WEB / "public/fonts" / f).read_bytes()).decode()   # set_content pages can't load file: URLs
fonts = f"""@font-face {{ font-family: Mali; src: url({font('Mali-700-latin.woff2')}); font-weight: 700; }}
@font-face {{ font-family: Seed; src: url({font('LINESeedSansTH_A_Bd.woff2')}); font-weight: 700; }}"""
# a white rim and a soft shadow lift the blue pin off the blue sky
RIM = "filter:drop-shadow(0 0 0 #fff) drop-shadow(6px 0 0 #fff) drop-shadow(-6px 0 0 #fff) drop-shadow(0 6px 0 #fff) drop-shadow(0 -6px 0 #fff) drop-shadow(0 18px 24px rgb(14 60 120 / .35))"
BG = "linear-gradient(180deg, #3ea8ff 0%, #7cc6ff 45%, #cdeaff 100%)"

def page(w, h, body):
    return f"""<html><head><style>{fonts} html,body{{margin:0}} .s{{width:{w}px;height:{h}px;position:relative;overflow:hidden;background:{BG};
    display:grid;place-items:center;font-family:Mali}} .sky{{position:absolute;inset:0;width:100%;height:100%}} .sky svg{{width:100%;height:auto}}</style></head>
    <body><div class="s">{body}</div></body></html>"""

def clouds(top, scale=1.0, flip=False):
    return f'<div class="sky" style="top:{top}px;transform:scale({scale}){" scaleX(-1)" if flip else ""};transform-origin:top center">{sky}</div>'

shots = {
    IOS / "AppIcon.appiconset/icon-1024.png": (1024, 1024, clouds(560, 1.6, True) + f'<div style="width:660px;position:relative;margin-top:-30px;{RIM}">{logo}</div>'),
    WEB / "public/apple-touch-icon.png": (180, 180, clouds(95, .3, True) + f'<div style="width:120px;position:relative;margin-top:-4px;{RIM.replace("6px", "2px")}">{logo}</div>'),
    WEB.parent / "docs/assets/banner.png": (1280, 400, clouds(-90, 1.05) + f'''<div style="position:relative;display:flex;align-items:center;gap:30px">
        <div style="width:170px;{RIM.replace("6px", "3px")}">{logo}</div><div style="color:#0e2440"><div style="font-size:84px;line-height:1">giggles <span style="color:#0a72d6">maps</span></div>
        <div style="font:700 28px/1.3 Seed;margin-top:12px;color:#21456f">Extra time on your trip? Fill it with the best local stops in Thailand.</div></div></div>'''),
    WEB / "public/og.png": (1200, 630, clouds(-40, 1) + f'''<div style="position:relative;display:flex;align-items:center;gap:36px">
        <div style="width:250px;{RIM.replace("6px", "3px")}">{logo}</div><div style="color:#0e2440"><div style="font-size:96px;line-height:1">giggles <span style="color:#0a72d6">maps</span></div>
        <div style="font:700 34px/1.3 Seed;margin-top:14px;color:#21456f">Extra time on your trip? Fill it with<br>the best local stops in Thailand.</div></div></div>'''),
}
splash = page(2732, 2732, clouds(1700, 2.2) + clouds(-300, 2.2, True) + f'''<div style="position:relative;display:grid;justify-items:center;gap:40px">
    <div style="width:520px;{RIM.replace("6px", "5px")}">{logo}</div><div style="font-size:150px;color:#0e2440">giggles <span style="color:#0a72d6">maps</span></div></div>''')

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome")
    for path, (w, h, body) in shots.items():
        pg = b.new_page(viewport={"width": w, "height": h}); pg.set_content(page(w, h, body)); pg.wait_for_timeout(300)
        pg.screenshot(path=str(path)); pg.close(); print("wrote", path)
    pg = b.new_page(viewport={"width": 2732, "height": 2732}); pg.set_content(splash); pg.wait_for_timeout(300)
    for name in ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]:
        pg.screenshot(path=str(IOS / "Splash.imageset" / name)); print("wrote", name)
    b.close()
