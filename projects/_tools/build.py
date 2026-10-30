"""Generate static project and notebook pages, without executing coursework.

Run from the repository root using its existing Ruby/Bundler environment:
  PATH=/opt/homebrew/opt/ruby/bin:$PATH python3 projects/_tools/build.py
Only this authoring step uses Kramdown. Published pages need no build or JS.
"""
import base64
from html import escape
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
catalog = json.loads((ROOT / '_catalog.json').read_text())


def url(path):
    return quote(path, safe='/#')


def size(path):
    n = (ROOT / path).stat().st_size
    if n == 0:
        return '0 bytes'
    return f'{n / 1_000_000:.1f} MB' if n >= 1_000_000 else f'{max(1, round(n / 1000))} KB'


def document(title, content, prefix='', notebook=False):
    home = '../../../' if notebook else '../'
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="{escape(title)} — Lanqing Jia’s Fall 2026 Text Mining coursework, notebooks, and data.">
  <title>{escape(title)} | Lanqing Jia</title>
  <link rel="stylesheet" href="{prefix}assets/projects.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="shell header-inner">
  <a class="brand" href="{home}">Lanqing Jia</a>
  <nav class="site-nav" aria-label="Main navigation">
    <a href="{home}">Home</a><a href="{home}research">Research</a><a href="{home}travel">Travel</a><a href="{prefix or './'}" aria-current="{'true' if notebook else 'page'}">Projects</a>
  </nav>
</div></header>
<main id="main" class="shell{' notebook' if notebook else ''}">
{content}
</main>
<footer><div class="shell footer-inner"><span>Lanqing Jia · Fall 2026 Text Mining</span><a href="#main">Back to top ↑</a></div></footer>
</body></html>
'''


def resources(project):
    items = ''.join(f'<li><a href="{url(path)}" download>{escape(label)}</a><span class="file-size">{size(path)}</span></li>' for path, label in project['resources'])
    return '<details><summary>Files &amp; notes</summary>' + (f'<ul class="resources">{items}</ul>' if items else '') + f'<p class="run-note">{escape(project["note"])}</p></details>'


notebooks = []
markdown = []
for project in catalog:
    folder = ROOT / 'weeks' / f'week-{project["week"]}'
    notebook = json.loads((folder / project['notebook']).read_text())
    notebooks.append((project, folder, notebook))
    markdown.extend(''.join(cell.get('source', [])) for cell in notebook['cells'] if cell['cell_type'] == 'markdown')

# Reuse Jekyll's already installed markdown engine rather than adding dependencies.
ruby = 'require "json"; require "kramdown"; print JSON.generate(JSON.parse(STDIN.read).map { |s| Kramdown::Document.new(s, syntax_highlighter: nil).to_html })'
result = subprocess.run(['bundle', 'exec', 'ruby', '-e', ruby], input=json.dumps(markdown), text=True,
                        capture_output=True, check=True, cwd=ROOT.parent)
rendered = iter(json.loads(result.stdout))

for project, folder, notebook in notebooks:
    cells = []
    for i, cell in enumerate(notebook['cells'], 1):
        source = ''.join(cell.get('source', []))
        if cell['cell_type'] == 'markdown':
            cells.append(f'<section class="cell markdown-cell">{next(rendered)}</section>')
            continue
        if not source.strip() and not cell.get('outputs'):
            continue
        outputs = []
        for output in cell.get('outputs', []):
            data = output.get('data', {})
            text = ''.join(output.get('text', [])) or ''.join(data.get('text/plain', []))
            if output.get('output_type') == 'error':
                text = output.get('ename', 'Error') + ': ' + output.get('evalue', '')
            if text:
                text = re.sub(r'\x1b\[[0-9;]*m', '', text)
                outputs.append(f'<pre>{escape(text)}</pre>')
            if 'image/png' in data:
                image = ''.join(data['image/png']).replace('\n', '')
                base64.b64decode(image, validate=True)
                outputs.append(f'<img src="data:image/png;base64,{image}" alt="Saved notebook figure from cell {i}" loading="lazy">')
        saved = '<details class="cell-output"><summary>Saved output</summary>' + ''.join(outputs) + '</details>' if outputs else ''
        cells.append(f'<section class="cell"><div class="notebook-label">Cell {i}</div><pre><code>{escape(source)}</code></pre>{saved}</section>')
    content = f'''<p class="eyebrow"><a href="../../#week-{project['week']}">← All projects</a> / Week {project['week']}</p>
<h1>{escape(project['title'])}</h1><p class="intro">{escape(project['description'])}</p>
<div class="actions"><a href="{url(project['notebook'])}" download>Download notebook (.ipynb)</a></div>
<p class="run-note">Static notebook reader. Code and saved outputs are displayed without running them. {escape(project['note'])}</p>
{''.join(cells)}'''
    (folder / 'notebook.html').write_text(document(project['title'], content, prefix='../../', notebook=True))

cards = []
for project in catalog:
    week = project['week']
    path = f'weeks/week-{week}/'
    actions = f'<a href="{path}notebook.html">Read notebook →</a><a href="{url(path + project["notebook"])}" download>Download .ipynb</a>'
    if project.get('demo'):
        actions = f'<a href="{project["demo"]}">Open interactive demo →</a>' + actions
    tags = ''.join(f'<span class="tag">{escape(tag)}</span>' for tag in project['tags'])
    cards.append(f'''<article class="project" id="week-{week}" aria-labelledby="title-{week}">
<div class="week">Week<strong>{week}</strong></div>
<div><h3 id="title-{week}">{escape(project['title'])}</h3><p>{escape(project['description'])}</p>
<div class="tags">{tags}</div><div class="actions">{actions}</div>{resources(project)}</div></article>''')

navigation = ''.join(f'<a href="#week-{p["week"]}">Week {p["week"]}</a>' for p in catalog)
content = f'''<p class="eyebrow">Coursework / Fall 2026</p>
<h1>Projects</h1>
<p class="intro">Exploring how code turns text into evidence. A collection of my Text Mining coursework, from Python fundamentals to financial language and explainable classification.</p>
<div class="overview"><span><strong>8</strong> weekly projects</span><span><strong>8</strong> readable notebooks</span><span><strong>1</strong> interactive demo</span></div>
<section class="featured" aria-labelledby="featured-title">
<div><p class="eyebrow">Featured / Week 09</p><h2 id="featured-title">Remarks Lab</h2>
<p>Prepared statement or answer to a question? Explore the words behind an earnings-call classifier’s decision.</p>
<a class="button" href="weeks/week-09/index.html">Try the classifier ↗</a></div>
<div class="feature-preview"><span class="eyebrow">Try a sentence</span><blockquote>“Revenue increased year over year, and operating margin expanded during the quarter.”</blockquote><div class="prediction">Explore class scores &amp; word contributions →</div></div>
</section>
<section aria-labelledby="course-title"><div class="section-top"><h2 id="course-title">The weekly collection</h2><span class="section-label">Notebooks, data &amp; assignment briefs</span></div>
<nav class="week-nav" aria-label="Jump to a project">{navigation}</nav>
{''.join(cards)}
</section>
<p class="course-note">Projects are organized by their submission folders; assignment briefs may come from the preceding week. Week 8 contained presentation slides only. No project files were supplied in my folders for Week 10. Presentation slides are omitted throughout.</p>'''
(ROOT / 'index.html').write_text(document('Projects', content))
print(f'Built Projects index and {len(notebooks)} notebook readers.')
