#!/usr/bin/env python3
# ---- suite kit (identical in every repo): 800x450, 15 fps, pure render(t) -> image ----
import os, sys, shutil, subprocess, tempfile, json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, S = 800, 450, 15, 2          # S = supersampling factor
BG, TEXT, MUTED = '#0d1117', '#e6edf3', '#8b949e'
ACCENT, OK, ERROR, WARN = '#58a6ff', '#3fb950', '#f85149', '#d29922'
FONT_DIRS = [Path.home() / '.local/share/fonts/JetBrainsMonoNerd']
FALLBACK = ['/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf']
FONT_FILES = {False: 'JetBrainsMonoNerdFont-Regular.ttf', True: 'JetBrainsMonoNerdFont-Bold.ttf'}


def rgb(h, a=1.0):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), round(255 * max(0, min(1, a))))


def clamp(x): return max(0.0, min(1.0, x))
def seg(t, a, b): return clamp((t - a) / (b - a))
def ease(x): x = clamp(x); return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2   # cubic in-out
def lerp(a, b, k): return a + (b - a) * k
def typed(s, t, t0, cps=55): return s[:max(0, int((t - t0) * cps))]


_fonts = {}
def font(size, bold=False):
    key = (size, bold)
    if key not in _fonts:
        cands = [d / FONT_FILES[bold] for d in FONT_DIRS] + [Path(p) for p in FALLBACK]
        path = next(p for p in cands if p.exists())
        _fonts[key] = ImageFont.truetype(str(path), round(size * S))
    return _fonts[key]


class Cv:
    def __init__(self):
        self.img = Image.new('RGB', (W * S, H * S), BG)
        self.d = ImageDraw.Draw(self.img, 'RGBA')

    def text(self, x, y, s, size=13, color=TEXT, a=1.0, bold=False, anchor='la'):
        if a > .01 and s:
            self.d.text((x * S, y * S), s, font=font(size, bold), fill=rgb(color, a), anchor=anchor)

    def width(self, s, size=13, bold=False): return font(size, bold).getlength(s) / S

    def box(self, x0, y0, x1, y1, outline=MUTED, a=1.0, fill=None, fa=1.0, r=6, w=1):
        self.d.rounded_rectangle([x0 * S, y0 * S, x1 * S, y1 * S], radius=r * S,
                                 outline=rgb(outline, a), width=round(w * S),
                                 fill=rgb(fill, fa) if fill else None)

    def line(self, x0, y0, x1, y1, color=MUTED, a=1.0, w=1, dash=0):
        if not dash:
            self.d.line([x0 * S, y0 * S, x1 * S, y1 * S], fill=rgb(color, a), width=round(w * S))
            return
        n = int(max(abs(x1 - x0), abs(y1 - y0)) // dash)
        for i in range(0, n, 2):
            p, q = i / n, min(1, (i + 1) / n)
            self.d.line([lerp(x0, x1, p) * S, lerp(y0, y1, p) * S, lerp(x0, x1, q) * S, lerp(y0, y1, q) * S],
                        fill=rgb(color, a), width=round(w * S))

    def arrow(self, x0, y0, x1, y1, color=MUTED, a=1.0):
        self.line(x0, y0, x1, y1, color, a)
        s = 1 if x1 > x0 else -1
        self.d.polygon([(x1 * S, y1 * S), ((x1 - 7 * s) * S, (y1 - 4) * S), ((x1 - 7 * s) * S, (y1 + 4) * S)], fill=rgb(color, a))

    def dot(self, x, y, color=ACCENT, a=1.0, r=4.5):
        self.d.ellipse([(x - r) * S, (y - r) * S, (x + r) * S, (y + r) * S], fill=rgb(color, a))
        self.d.ellipse([(x - r * 2) * S, (y - r * 2) * S, (x + r * 2) * S, (y + r * 2) * S], fill=rgb(color, a * .16))


def envelope(t, T, fade=.5):
    """Loop envelope: blank at t=0 and t=T, so the GIF loops seamlessly."""
    return ease(seg(t, 0, fade)) * (1 - ease(seg(t, T - fade, T)))


def finish(cv, t, T):
    blank = Image.new('RGB', cv.img.size, BG)
    img = Image.blend(blank, cv.img, envelope(t, T))
    return img.resize((W, H), Image.LANCZOS)


def build(render, T, out, frame=None):
    if frame is not None:
        render(frame).save(out); return
    n = round(T * FPS)
    with tempfile.TemporaryDirectory() as tmp:
        for i in range(n):
            render(i / FPS).save(f'{tmp}/f{i:04d}.png')
        pal = f'{tmp}/pal.png'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png',
                        '-vf', 'palettegen=max_colors=128:stats_mode=full', pal], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(FPS), '-i', f'{tmp}/f%04d.png', '-i', pal,
                        '-lavfi', 'paletteuse=dither=none', '-loop', '0', str(out)], check=True)
    print(f'{out}: {n} frames, {T}s, {Path(out).stat().st_size / 1e6:.2f} MB')


def cli(render, T, default_out):
    a = sys.argv[1:]
    if a[:1] == ['--frame']:          # python demo.py --frame 5.5 out.png
        build(render, T, a[2], float(a[1]))
    else:
        build(render, T, a[0] if a else default_out)
# ---- end kit ----

# ---- local helpers (per-demo): terminal panel, node boxes ----
HERE = Path(__file__).resolve().parent
PANEL, LINE = '#161b22', '#30363d'


def header(cv, title, subtitle):
    cv.text(32, 20, title, 22, ACCENT)
    cv.text(32, 52, subtitle, 13, MUTED)
    cv.line(32, 82, W - 32, 82, LINE)


def panel(cv, box, label):
    x0, y0, x1, y1 = box
    cv.box(x0, y0, x1, y1, LINE, 1, fill=PANEL, r=8)
    cv.text(x0 + 14, y0 + 8, label, 11, MUTED)


def node(cv, x0, y0, x1, y1, label, sub, color, idle=False):
    cv.box(x0, y0, x1, y1, LINE if idle else color, 1, fill=PANEL, r=6, w=2)
    cx = (x0 + x1) / 2
    cy = (y0 + y1) / 2
    cv.text(cx, cy - 10, label, 13, MUTED if idle else TEXT, anchor='mm')
    if sub:
        cv.text(cx, cy + 12, sub, 12, MUTED if idle else color, anchor='mm')


def _plain(cv, x, y, s, size, color, a):
    """terminal text without programming ligatures (so '<!--' stays literal)"""
    if a <= .01 or not s:
        return
    try:
        cv.d.text((x * S, y * S), s, font=font(size), fill=rgb(color, a), features=['-liga', '-calt'])
    except (KeyError, ValueError, OSError):
        cv.text(x, y, s, size, color, a)


def term(cv, t, lines, x, y, lh, size, cps=55, al=1.0):
    """lines: [{t, segs:[(text,color)], type?}]; typed lines reveal at cps with a block cursor."""
    cur = None
    for i, L in enumerate(lines):
        if t < L['t']:
            break
        segs = L['segs']
        n = sum(len(s) for s, _ in segs)
        k = n if not L.get('type') else min(n, max(0, int((t - L['t']) * cps)))
        if L.get('type') and k < n + 1:
            cur = (i, k)
        cx = x
        left = k
        for s, c in segs:
            if left <= 0:
                break
            part = s[:left]
            _plain(cv, cx, y + i * lh, part, size, c, al)
            cx += cv.width(part, size)
            left -= len(s)
    if cur and int(t * 2.5) % 2 == 0:
        i, k = cur
        cx = x + cv.width('M', size) * k
        cv.d.rectangle([(cx + 1) * S, (y + i * lh + 1) * S, (cx + 8) * S, (y + i * lh + size + 3) * S], fill=rgb(TEXT, .8 * al))


def window(t, a, b, f=.35):
    return ease(seg(t, a, a + f)) * (1 - ease(seg(t, b - f, b)))


def wrap(s, cols):
    out, cur = [], ''
    for w in s.split(' '):
        if cur and len(cur) + 1 + len(w) > cols:
            out.append(cur); cur = w
        else:
            cur = (cur + ' ' + w).strip()
    return out + [cur]

# ---------------------------------------------------------------------------
# enlace demo.
#   python3 docs/media/demo.py capture   -> drives a REAL `enlace session` against a local test server,
#                                           writes capture.json (raw requests/responses; only the random
#                                           local port is normalised to 8080)
#   python3 docs/media/demo.py [out.gif] -> renders docs/media/demo.gif from capture.json
#   python3 docs/media/demo.py --frame 5.5 out.png   (single frame)
# render(t) is a pure function of time; no randomness, no wall clock.
# ---------------------------------------------------------------------------
import http.server, threading
CAP = HERE / 'capture.json'
CLI = HERE.parent.parent / 'src' / 'cli.mjs'
T = 12.0
EX0 = 1.4          # first exchange starts
STEP = 2.2         # seconds per exchange
LABELS = ['capabilities', 'research', 'plan', 'execute']
NODE_SUB = ['what exists', 'read the docs', 'pick a route', 'run once']


def capture():
    root = Path(tempfile.mkdtemp(prefix='enlace-demo-'))
    (root / 'docs.html').write_text('<html><body><h1>Items API</h1><p>GET /items.json returns a JSON list of items with id and name.</p></body></html>')
    (root / 'items.json').write_text('[{"id":1,"name":"widget"},{"id":2,"name":"gadget"}]')

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(s, *a, **k): super().__init__(*a, directory=str(root), **k)
        def log_message(s, *a): pass
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    base = f'http://127.0.0.1:{port}/'
    reqs = [{'id': 1, 'method': 'capabilities', 'params': {}},
            {'id': 2, 'method': 'research', 'params': {'adapter': 'http-json', 'operation': 'request', 'target': base + 'items.json',
                                                       'sourceUrls': [base + 'docs.html'], 'reason': 'Docs say GET /items.json returns a list of items.'}},
            {'id': 3, 'method': 'plan', 'params': {'operation': 'request', 'input': {'url': base + 'items.json'}}}]
    p = subprocess.Popen(['node', str(CLI), 'session', '--allow-local'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
    pairs = []

    def ask(r):
        p.stdin.write(json.dumps(r) + '\n'); p.stdin.flush()
        resp = json.loads(p.stdout.readline())
        pairs.append({'request': r, 'response': resp})
        return resp
    for r in reqs:
        resp = ask(r)
    ask({'id': 4, 'method': 'execute', 'params': {'planId': resp['result']['planId']}})
    p.stdin.close(); p.wait(); srv.shutdown()
    norm = lambda o: json.loads(json.dumps(o).replace(f'127.0.0.1:{port}', '127.0.0.1:8080'))
    CAP.write_text(json.dumps(norm(pairs), indent=1) + '\n')
    shutil.rmtree(root)


def short(s, n):
    return s if len(s) <= n else s[:n - 1] + '…'


def req_line(r):
    return short('> ' + json.dumps(r, separators=(',', ':')), 100)


def res_line(r):
    """one-line projection of the real JSON response (fields named as in the response)"""
    x = r['result']
    if 'adapters' in x:
        return '< adapters: ' + ', '.join(f"{a['id']} ({a['kind']}, cost {a['capabilities'][0]['cost']})" for a in x['adapters'])
    if 'receipt' in x:
        k = x['receipt']
        return f"< state: {x['state']}  receipt: {k['id'][:8]}…  grantsPermissions: {str(k['grantsPermissions']).lower()}  provesOfficialSource: {str(k['provesOfficialSource']).lower()}"
    if 'planId' in x:
        return f"< adapter: {x['adapter']}  effect: {x['effect']}  alternatives: {len(x['alternatives'])}  planId: {x['planId'][:8]}…"
    d = x['data']
    return short(f"< ok: {str(x['ok']).lower()}  status: {d['status']}  untrusted: {str(x['untrusted']).lower()}  data: {json.dumps(d['data'], separators=(',', ':'))}", 100)


def render(t, cap=None):
    cap = cap or json.loads(CAP.read_text())
    cv = Cv()
    header(cv, 'enlace', 'research first, then plan, then execute: application connections for agents')
    panel(cv, (32, 96, 768, 292), 'enlace session --allow-local   JSON Lines, real responses')
    lines = [{'t': 0.4, 'type': True, 'segs': [('$ ', OK), ('enlace session --allow-local', TEXT)]}]
    for i, pr in enumerate(cap):
        t0 = EX0 + i * STEP
        lines.append({'t': t0, 'type': True, 'segs': [(req_line(pr['request']), ACCENT)]})
        lines.append({'t': t0 + 0.9, 'segs': [(res_line(pr['response']), OK if i else TEXT)]})
    term(cv, t, lines, 46, 122, 18, 11, cps=110)
    dy = 308
    xs = [32, 224, 416, 608]
    for i, x in enumerate(xs):
        t0 = EX0 + i * STEP
        sent, done = t >= t0, t >= t0 + 0.9
        col = ACCENT if not done else OK
        node(cv, x, dy, x + 160, dy + 80, LABELS[i], 'done' if done else NODE_SUB[i], col, idle=not sent)
        if i:
            a = t0 - 0.35
            p = ease(seg(t, a, a + 0.35))
            px = xs[i - 1] + 160
            if p > 0:
                cv.arrow(px, dy + 40, px + 32 * max(p, .05), dy + 40, OK)
            if 0 < p < 1:
                cv.dot(px + 32 * p, dy + 40, OK)
    cv.text(32, 402, 'plans expire after 5 minutes and run once; research grants no permissions', 12, MUTED)
    cv.text(32, 424, 'Node.js >= 22  |  SDK, CLI, JSON Lines and MCP over one core  |  no LLM, no account', 12, MUTED)
    return finish(cv, t, T)


if __name__ == '__main__':
    if sys.argv[1:2] == ['capture']:
        capture()
    else:
        cli(render, T, HERE / 'demo.gif')
