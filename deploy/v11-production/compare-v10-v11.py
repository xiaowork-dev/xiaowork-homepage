#!/usr/bin/env python3
# Compare visible text of V1.0 (127.0.0.1:3100) and the V1.1 shadow (127.0.0.1:3110), both with Host: xiaoworks.com.
import html, re, sys, urllib.request

PAGES = ['/', '/projects/', '/about/', '/robots.txt', '/sitemap.xml']
def get(port, path):
    req = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers={'Host': 'xiaoworks.com', 'X-Real-IP': '198.51.100.250', 'X-Forwarded-Proto': 'https'})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return e.code, ''
def text(body):
    body = re.sub(r'(?is)<(script|style|noscript)[^>]*>.*?</\1>', ' ', body)
    title = re.search(r'(?is)<title>(.*?)</title>', body)
    body = re.sub(r'(?s)<[^>]+>', ' ', body)
    words = re.sub(r'\s+', ' ', html.unescape(body)).strip()
    return (html.unescape(title.group(1)).strip() if title else ''), words

same = True
for p in PAGES:
    s0, b0 = get(3100, p); s1, b1 = get(3110, p)
    if p.endswith(('.txt', '.xml')):
        eq = b0.strip() == b1.strip(); t0 = t1 = ''
        w0, w1 = b0.strip(), b1.strip()
    else:
        (t0, w0), (t1, w1) = text(b0), text(b1)
        eq = (t0, w0) == (t1, w1)
    same &= eq and s0 == s1 == 200
    print(f'{p:14} v1.0={s0} v1.1={s1} identical_text={eq} title_v10={t0[:40]!r} title_v11={t1[:40]!r}')
    if not eq:
        a, b = w0.split(' '), w1.split(' ')
        i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
        print('   first difference: v1.0=', ' '.join(a[i:i+12])[:160]); print('                     v1.1=', ' '.join(b[i:i+12])[:160])
print('CONTENT_IDENTICAL' if same else 'CONTENT_DIFFERS')
