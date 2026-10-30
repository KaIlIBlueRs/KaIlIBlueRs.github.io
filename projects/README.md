# Projects module

Self-contained Fall 2026 Text Mining coursework portfolio for Lanqing Jia.
Open `/projects/` on the website. The HTML, styles, notebook readers, demo,
notebooks, and data all live under this directory. It uses no shared layouts,
includes, scripts, stylesheets, Jekyll collections, plugins, or external services.
The main website links here through one entry in `_config.yml`.

## Remove after the course

1. Remove the `projects/` directory.
2. Remove the `Projects` entry and its `slug: /projects/` line from
   `header.pages` in `_config.yml`.
3. Rebuild and publish the website normally.

There are no other integration changes to undo. Home, Research, and Travel
do not depend on this module. Normal navigation links point back to those pages.

## Content and provenance

- Eight projects from Weeks 1–7 and 9. Only `Lanqing` or `Lanqing Jia`
  subfolders were imported, plus explicitly selected shared resources.
- All eight slide decks are excluded, including the three PDF slide decks.
- Week 8 contains only slides. Weeks 9 and 10 have shared course files, but
  only Week 9 has project work in Lanqing's supplied folders.
- `_catalog.json` contains descriptions, resource links, and dependency notes.
- `_inventory.json` records source-relative paths, checksums, transformations,
  and excluded presentations. No personal absolute source paths are published.
- `weeks/` contains submitted notebooks, readable HTML copies, results, and
  the original standalone Week 9 demo. The demo is copied byte for byte.
- `shared/` contains the SEC company index, negative word lists, and CMU
  pronunciation dictionary. Their origins remain in the inventory.
- `assignments/` contains the relevant original course briefs, linked to the
  projects they describe, even when assigned in the preceding week.

The company index and Week 6 pickle are stored in lossless ZIP files for smaller
downloads. Extract them to recover the original filenames. The notebook readers
show source, text outputs, and saved PNG figures; they do not execute Python or
render arbitrary HTML output. Open “Saved output” to inspect each result.

## Credential removal and reproducibility

The Week 1 notebook copy replaces an embedded API credential with
`os.environ["OPENAI_API_KEY"]` and clears that cell's output. The source file in
Downloads is untouched. The original credential should be revoked or rotated.

Other notebooks retain their original code and outputs, including Google Drive
paths and exploratory errors. These are coursework artifacts, not newly verified
analysis results. Expand “Files & notes” on each project for rerun requirements.
In particular:

- MNIST CSVs and the author's handwriting images were not supplied.
- The raw 100-filing corpus was not supplied. The shared sample SEC submission
  is zero bytes and is not presented as a usable dependency.
- Week 2 references `data_list` before its definition; Week 4 accumulates
  sentiment counters across filings. These are documented, not silently changed.
- Week 7's generated DF1/DF2 CSVs and transcript files were not supplied.
- Week 9's `corpus.json` is missing, so its training notebook cannot be rerun
  from this export alone. Its browser demo includes the trained model and runs
  independently; embedded source samples are not a replacement training corpus.

## Updating

Edit `_catalog.json` for descriptions, tags, notes, and resource links.
Edit `assets/projects.css` for module-only styling. To regenerate the index and
notebook readers from the repository root (uses the existing Jekyll gems):

```sh
PATH=/opt/homebrew/opt/ruby/bin:$PATH python3 projects/_tools/build.py
PATH=/opt/homebrew/opt/ruby/bin:$PATH bundle exec jekyll build
```

To reimport the same coursework export, use
`python3 projects/_tools/import_course.py '/path/to/Fall 2026 Text Mining'`
before rebuilding. Importing never executes notebooks or loads pickle objects.
It uses a strict author-folder filter and a small shared-file allowlist. The
underscored authoring files and tools are ignored by Jekyll; they remain available
in the repository. Serving the existing generated HTML needs no generator.
