#!/usr/bin/env python3
"""Check which links in the CV can be shown inside the page.

Reads every link in index-columns.html, fetches each URL's headers (following redirects, as a
browser would), and writes stage/frameable.json: { url: { ok, status, final, frame, why } }.
A site can't be framed if it sends X-Frame-Options DENY/SAMEORIGIN or a CSP frame-ancestors
that doesn't allow graycrawford.com. Links on graycrawford.com itself are always frameable.

  python3 stage/check-frames.py
"""
import concurrent.futures as cf
import html
import json
import os
import re
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'index-columns.html')
OUT = os.path.join(ROOT, 'stage', 'frameable.json')
SITE = 'https://graycrawford.com'
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'


def links():
    page = open(SOURCE).read()
    found = []
    for href in re.findall(r'<a [^>]*href="([^"]+)"', page):
        href = html.unescape(href)
        if href.startswith(('mailto:', '#')):
            continue
        url = SITE + href if href.startswith('/') else href
        if url not in found:
            found.append(url)
    return found


def frame_policy(headers):
    xfo = (headers.get('X-Frame-Options') or '').strip().upper()
    if xfo in ('DENY', 'SAMEORIGIN'):
        return False, f'X-Frame-Options {xfo}'
    csp = headers.get('Content-Security-Policy') or ''
    m = re.search(r'frame-ancestors([^;]*)', csp, re.I)
    if m:
        sources = m.group(1).split()
        if '*' in sources or any('graycrawford.com' in s for s in sources):
            return True, 'frame-ancestors allows it'
        return False, f"frame-ancestors {' '.join(sources) or 'none'}"
    return True, 'no framing restriction'


def check(url):
    if url.startswith(SITE):
        return url, {'ok': True, 'status': 200, 'final': url, 'frame': True, 'why': 'own site'}
    for method in ('HEAD', 'GET'):  # some servers reject HEAD
        try:
            req = urllib.request.Request(url, method=method, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=15) as r:
                frame, why = frame_policy(r.headers)
                return url, {'ok': True, 'status': r.status, 'final': r.url, 'frame': frame, 'why': why}
        except urllib.error.HTTPError as e:
            if method == 'HEAD' and e.code in (403, 405, 501):
                continue
            frame, why = frame_policy(e.headers)
            return url, {'ok': False, 'status': e.code, 'final': url, 'frame': False, 'why': f'HTTP {e.code}'}
        except Exception as e:
            if method == 'HEAD':
                continue
            return url, {'ok': False, 'status': None, 'final': url, 'frame': False, 'why': type(e).__name__}
    return url, {'ok': False, 'status': None, 'final': url, 'frame': False, 'why': 'unreachable'}


if __name__ == '__main__':
    urls = links()
    with cf.ThreadPoolExecutor(12) as pool:
        results = dict(pool.map(check, urls))
    results = {u: results[u] for u in urls}
    json.dump(results, open(OUT, 'w'), indent=1)
    frameable = [u for u, r in results.items() if r['frame']]
    broken = [u for u, r in results.items() if not r['ok']]
    print(f'{len(urls)} links: {len(frameable)} can be shown in the page, {len(urls) - len(frameable)} cannot, {len(broken)} broken')
    for u, r in results.items():
        print(f"{'FRAME' if r['frame'] else '  -  '}  {str(r['status']):>4}  {u[:70]:70}  {r['why']}")
