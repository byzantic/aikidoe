#!/usr/bin/env python3
"""File planning/issues.md as GitHub issues, with milestones and labels.

  python3 tools/file-issues.py OWNER/REPO [--dry-run]

Issues are created in file order; '#slug' references are replaced by issue
numbers (forward references are fixed by a second edit pass). Idempotent by
title: an existing issue with the same title is reused, not duplicated.
"""
import json, re, subprocess, sys

repo = sys.argv[1]
dry = '--dry-run' in sys.argv
src = open('planning/issues.md', encoding='utf-8').read()
items = []
for block in re.split(r'^## ', src, flags=re.M)[1:]:
    head, _, body = block.partition('\n')
    slug, title, ms, labels = [p.strip() for p in head.split('|')]
    items.append(dict(slug=slug, title=title, milestone=ms,
                      labels=[l.strip() for l in labels.split(',')], body=body.strip()))

def api(method, path, data=None):
    cmd = ['gh', 'api', '-X', method, f'repos/{repo}/{path}']
    if data is not None:
        cmd += ['--input', '-']
    if dry and method != 'GET':
        print('DRY', method, path, (data or {}).get('title', ''))
        return {'number': 0}
    r = subprocess.run(cmd, input=json.dumps(data) if data is not None else None,
                       capture_output=True, text=True)
    if r.returncode:
        sys.exit(f'{method} {path}: {r.stderr or r.stdout}')
    return json.loads(r.stdout or 'null')

# milestones
have = {m['title']: m['number'] for m in api('GET', 'milestones?state=all&per_page=100')}
for ms in dict.fromkeys(i['milestone'] for i in items):
    if ms not in have:
        have[ms] = api('POST', 'milestones', {'title': ms})['number']

# labels
colours = dict(infra='bfbfbf', core='0e8a16', design='1d76db', analysis='5319e7',
               io='c5def5', ui='fbca04', process='d93f0b', simulation='006b75', docs='0075ca')
existing = {l['name'] for l in api('GET', 'labels?per_page=100')}
for l in sorted({l for i in items for l in i['labels']}):
    if l not in existing:
        api('POST', 'labels', {'name': l, 'color': colours.get(l, 'ededed')})

# issues
current = {i['title']: i['number'] for i in api('GET', 'issues?state=all&per_page=100')}
num = {}
for it in items:
    if it['title'] in current:
        num[it['slug']] = current[it['title']]
    else:
        num[it['slug']] = api('POST', 'issues', {'title': it['title'], 'body': it['body'],
                                                 'labels': it['labels'],
                                                 'milestone': have[it['milestone']]})['number']
    print(f"#{num[it['slug']]:<3} {it['slug']:<13} {it['title']}")

# resolve #slug references
for it in items:
    body = re.sub(r'#([a-z][a-z0-9-]*)', lambda m: f"#{num[m[1]]}" if m[1] in num else m[0], it['body'])
    if body != it['body']:
        api('PATCH', f"issues/{num[it['slug']]}", {'body': body})
