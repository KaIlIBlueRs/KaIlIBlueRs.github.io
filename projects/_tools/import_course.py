"""Import only Lanqing's work and an explicit allowlist of shared dependencies.

Usage: python3 projects/_tools/import_course.py '/path/to/Fall 2026 Text Mining'
Does not execute notebooks or deserialize pickle files.
"""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]).resolve()
records = []
excluded = []


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy(source, target, compress=False):
    src, dst = SOURCE / source, ROOT / target
    dst.parent.mkdir(parents=True, exist_ok=True)
    change = None
    if compress:
        with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            archive.write(src, src.name)
        change = 'Lossless ZIP; extract before use.'
    elif src.suffix == '.ipynb':
        notebook = json.loads(src.read_text())
        changed = False
        for cell in notebook['cells']:
            text = ''.join(cell.get('source', []))
            if re.search(r'sk-[A-Za-z0-9_-]{20,}', text):
                text = re.sub(r'OpenAIKey\s*=\s*["\']sk-[A-Za-z0-9_-]+["\']',
                              'import os\nOpenAIKey = os.environ["OPENAI_API_KEY"]', text)
                text = re.sub(r'sk-[A-Za-z0-9_-]{20,}', '[REDACTED]', text)
                cell['source'] = text.splitlines(keepends=True)
                cell['outputs'] = []
                cell['execution_count'] = None
                changed = True
        if changed:
            # Also redact any key echoed in other outputs or metadata.
            serialized = re.sub(r'sk-[A-Za-z0-9_-]{20,}', '[REDACTED]', json.dumps(notebook, ensure_ascii=False, indent=1))
            dst.write_text(serialized + '\n')
            change = 'Removed embedded API credential; use OPENAI_API_KEY. Cleared the affected cell output.'
        else:
            shutil.copyfile(src, dst)
    else:
        shutil.copyfile(src, dst)
    records.append(dict(source=str(source), path=target, source_sha256=digest(src),
                        published_sha256=digest(dst), change=change))


for week in sorted(SOURCE.iterdir()):
    match = re.fullmatch(r'week\s+(\d+)', week.name.strip(), re.I)
    if not match or not week.is_dir():
        continue
    number = int(match[1])
    for folder in week.iterdir():
        if not folder.is_dir() or folder.name.strip().lower() not in ('lanqing', 'lanqing jia'):
            continue
        for src in sorted(folder.rglob('*')):
            if not src.is_file() or src.name.startswith('.'):
                continue
            rel = src.relative_to(SOURCE)
            if src.suffix.lower() in ('.ppt', '.pptx', '.key') or src.name in ('MyNN.pdf', 'Textual_Analysis_Presentation.pdf', 'slides.pdf'):
                excluded.append(dict(source=str(rel), reason='Presentation slides (PDF slides identified from their content).'))
                continue
            target = f'weeks/week-{number:02d}/{src.relative_to(folder).as_posix()}'
            compress = src.suffix == '.pkl'
            copy(rel, target + ('.zip' if compress else ''), compress)

# Shared resources are selected from week roots, never from another student's folder.
shared = [
    ('week 01/company.idx', 'shared/company.idx.zip', True),
    ('week 03/NegativeWords.txt', 'shared/NegativeWords.txt', False),
    ('week 03/cleanText.txt', 'shared/cleanText.txt', False),
    ('week 04/cmudict.txt', 'shared/cmudict.txt', False),
    ('week 01/Week 01 Assignment.docx', 'assignments/week-01.docx', False),
    ('week 02/Coding Assignment_ due week 03.docx', 'assignments/week-02.docx', False),
    ('week 03/coding assignment.docx', 'assignments/week-03.docx', False),
    ('week 04/week 04 assignment.docx', 'assignments/week-04.docx', False),
    ('week 05 /Assignment.docx', 'assignments/week-05.docx', False),
    ('week 06/download earnings calls assignment.docx', 'assignments/week-06.docx', False),
    ('week 09/Assignment.docx', 'assignments/week-09.docx', False),
]
for source, target, compress in shared:
    copy(source, target, compress)

(ROOT / '_inventory.json').write_text(json.dumps(dict(files=records, excluded=excluded), ensure_ascii=False, indent=2) + '\n')
print(f'Imported {len(records)} files; excluded {len(excluded)} slide decks.')
