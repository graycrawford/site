#!/usr/bin/env python3
"""Write the work pages: work/<slug>/index.html for each project in stage/projects.json (now only
St. John's). Each is a small shell; stage/work.js fills it in.

  python3 stage/make-work.py
"""
import html
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
projects = json.load(open(os.path.join(ROOT, 'stage', 'projects.json')))

def page(title, slug=''):
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>{html.escape(title)}</title>
  <link rel="stylesheet" href="/stage/work.css">
</head>
<body data-project="{slug}">
  <div class="page">
    <a href="/" class="name">Gray Crawford</a>
    <main></main>
  </div>
  <script type="module" src="/stage/work.js"></script>
  <script type="module" src="/stage/visits.js"></script>
</body>
</html>
'''

for slug, p in projects.items():
    d = os.path.join(ROOT, 'work', slug)
    os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(page(f"{p['title']} — Gray Crawford", slug))
print('wrote', ', '.join(f'work/{s}/' for s in projects))
