# Lanqing's Website

Personal academic website built with Jekyll and hosted on GitHub Pages.

## Local development

This site needs Ruby 3.0+. macOS ships with Ruby 2.6, which is too old, so a Homebrew Ruby is installed (keg-only).

Every shell session needs the PATH export:

```bash
export PATH="/opt/homebrew/opt/ruby/bin:$PATH"
```

Then from the project root:

```bash
bundle install            # first time only
bundle exec jekyll serve  # start dev server at http://127.0.0.1:4000
```

## Editing content

- `index.md` — home page (About, Education, Publications)
- `research.md` — Research page (interests + publications)
- `travel.md` — Travel page (map + page text)
- `_data/travel.yml` — list of cities + photos for the Travel map
- `_config.yml` — site title, URL, and nav links

## Updating travel photos

Travel lives at `/travel/`; the original `/travel.html` URL redirects there. Destination albums, the US National Park series, and the map use `_data/travel.yml`.

The photo importer generates optimized full-size JPEGs, thumbnails, and album pages from the curated `World photos` folder. See [_tools/travel/README.md](_tools/travel/README.md) for the import command, destination metadata, and cover selections. The original photos are never modified.

## Original theme

Based on [Bay Jekyll Theme](https://github.com/eliottvincent/bay), with the same customizations as [JLiangHe/jlianghe.github.io](https://github.com/JLiangHe/jlianghe.github.io).
