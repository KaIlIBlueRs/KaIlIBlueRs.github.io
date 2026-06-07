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

## Adding a travel city

Add an entry to `_data/travel.yml`:

```yaml
- city: Paris
  country: France
  lat: 48.8566
  lng: 2.3522
  date: "2025-08"
  notes: Optional one-line description.
  photos:
    - src: /assets/img/travel/paris/eiffel.jpg
      caption: Eiffel Tower at sunset
```

Drop the photos in `assets/img/travel/<city>/`. Coordinates: search the city on Google Maps, right-click, and the first menu item gives `lat, lng`.

## Original theme

Based on [Bay Jekyll Theme](https://github.com/eliottvincent/bay), with the same customizations as [JLiangHe/jlianghe.github.io](https://github.com/JLiangHe/jlianghe.github.io).
