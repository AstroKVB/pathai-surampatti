"""Render the three Slide 4 screenshots straight from the web app (headless Edge).

usage: python tools/capture.py <out_dir> [seed] [seconds] [--ui]
"""
import base64
import pathlib
import sys

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
out = pathlib.Path(sys.argv[1]).resolve()
seed = int(sys.argv[2]) if len(sys.argv) > 2 else 1
seconds = int(sys.argv[3]) if len(sys.argv) > 3 else 780
ui = "--ui" in sys.argv
out.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    # software WebGL, so the 3D view renders the same on any machine (and without a GPU)
    browser = p.chromium.launch(channel="msedge", args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
    page = browser.new_page(viewport={"width": 1600, "height": 1000}, device_scale_factor=1)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto((ROOT / "index.html").as_uri())
    page.wait_for_function("window.PATHAI_APP !== undefined")
    if not page.evaluate("!!(window.PATHAI3D && window.PATHAI3D.ready)"):
        sys.exit("3D view did not start (no WebGL) - screenshots would fall back to 2D")
    info = page.evaluate(f"window.PATHAI_APP.prepareSnapshot({seed}, {seconds})")
    print("snapshot", info)
    shots = page.evaluate("window.PATHAI_APP.exportSlides(false)")
    for name, url in shots.items():
        (out / name).write_bytes(base64.b64decode(url.split(",", 1)[1]))
        print("wrote", out / name)
    if ui:
        page.screenshot(path=str(out / "ui_full.png"), full_page=True)
        for tab in ("map", "results", "data"):
            page.evaluate(f"window.PATHAI_APP.showTab('{tab}')")
            page.wait_for_timeout(300)
            page.screenshot(path=str(out / f"ui_{tab}.png"), full_page=True)
    if errors:
        print("PAGE ERRORS:", errors)
    browser.close()
