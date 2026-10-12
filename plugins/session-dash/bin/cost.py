#!/usr/bin/env python3
"""API-equivalent Claude Code cost from transcript token usage.

  cost.py session <transcript base path>   this session + its subagents
  cost.py month                            this calendar month (IST), all projects
  cost.py month-cache                      same, written atomically to
                                           ~/.claude/session-dash/month-cost.json

Prices are list API rates ($/MTok); cache writes are 1.25x (5m) / 2x (1h)
input, reads as listed. Each request is counted once (message id + request id).
On a subscription this is what the usage would cost at API prices, not a bill.
"""
import json, sys, glob, os, re
from datetime import datetime, timezone, timedelta
IST = timezone(timedelta(hours=5, minutes=30))
# $/MTok: input, output, cache read. Writes = 1.25x (5m) / 2x (1h) of input.
PRICE = {
  'opus-5-5': (4, 20, 0.20), 'opus-5': (5, 25, 0.50), 'opus-4-8': (5, 25, 0.50), 'opus-4-7': (5, 25, 0.50),
  'opus-4-6': (5, 25, 0.50), 'sonnet-5-5': (2, 10, 0.20), 'sonnet-5': (2, 10, 0.20), 'sonnet-4-6': (3, 15, 0.30),
  'haiku-5-5': (0.10, 0.50, 0.01), 'haiku-4-5': (1, 5, 0.10), 'fable-5-1': (10, 50, 0.25), 'fable-5': (10, 50, 1.0),
}
def price(model):
    for k in sorted(PRICE, key=len, reverse=True):
        if k in (model or ''): return PRICE[k]
    return None
def cost(u, model):
    p = price(model)
    if not p: return 0.0, model
    i, o, r = p
    cc = u.get('cache_creation') or {}
    w5 = cc.get('ephemeral_5m_input_tokens'); w1 = cc.get('ephemeral_1h_input_tokens')
    if w5 is None and w1 is None: w5, w1 = u.get('cache_creation_input_tokens', 0), 0
    return (u.get('input_tokens', 0)*i + u.get('output_tokens', 0)*o + u.get('cache_read_input_tokens', 0)*r
            + (w5 or 0)*i*1.25 + (w1 or 0)*i*2) / 1e6, None
def scan(files, since=None):
    seen = set(); total = 0.0; by = {}; unpriced = set(); n = 0
    for f in files:
        try: fh = open(f)
        except OSError: continue
        for line in fh:
            if '"usage"' not in line: continue
            try: e = json.loads(line)
            except ValueError: continue
            m = e.get('message') or {}
            u = m.get('usage'); mid = m.get('id')
            if not u or not mid or m.get('model') in (None, '<synthetic>'): continue
            key = (mid, e.get('requestId'))
            if key in seen: continue
            if since:
                ts = e.get('timestamp')
                if not ts or datetime.fromisoformat(ts.replace('Z', '+00:00')) < since: continue
            seen.add(key); n += 1
            c, miss = cost(u, m.get('model'))
            if miss: unpriced.add(miss)
            total += c; by[m.get('model')] = by.get(m.get('model'), 0) + c
    return total, by, n, unpriced
mode = sys.argv[1]
if mode == 'session':
    base = sys.argv[2]
    files = [base + '.jsonl'] + glob.glob(base + '/subagents/**/*.jsonl', recursive=True)
    t, by, n, un = scan(files)
    print(json.dumps({'usd': round(t, 4), 'requests': n, 'files': len(files), 'by_model': {k: round(v, 4) for k, v in by.items()}, 'unpriced': sorted(un)}))
else:
    now = datetime.now(IST); start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    files = [f for f in glob.glob(os.path.expanduser('~/.claude/projects/**/*.jsonl'), recursive=True)
             if os.path.getmtime(f) >= start.timestamp()]
    t, by, n, un = scan(files, since=start)
    body = json.dumps({'month': start.strftime('%Y-%m'), 'usd': round(t, 2), 'requests': n, 'files': len(files),
                      'by_model': {k: round(v, 2) for k, v in sorted(by.items(), key=lambda x: -x[1])}, 'unpriced': sorted(un),
                      'computed_at': now.isoformat(timespec='seconds')})
    if mode == 'month-cache':
        out = os.path.expanduser('~/.claude/session-dash/month-cost.json')
        tmp = out + '.%d.tmp' % os.getpid()
        with open(tmp, 'w') as fh: fh.write(body)
        os.replace(tmp, out)
    else:
        print(body)
