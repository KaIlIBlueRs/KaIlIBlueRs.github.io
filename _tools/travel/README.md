# Travel photo import

The galleries are generated from the curated `World photos` folder. Originals are never modified. Web copies are sRGB JPEGs (up to 1920px) with separate 640px thumbnails, correct EXIF orientation, and no embedded GPS/camera metadata.

Run with Python 3 and Pillow installed (HEIC also needs `pillow-heif` or macOS `sips`):

```sh
python3 _tools/travel/import_photos.py '/path/to/World photos'
```

- `destinations.json`: source folder, display name, country, region, approximate latitude/longitude, optional place type. Folder spelling stays unchanged; display names fix Grand Canyon and Provence and add accents.
- `covers.json`: preferred cover filename for each source folder.
- `manifest.json`: hashes and output dimensions for incremental imports.
- `_data/travel.yml`: generated catalog (JSON syntax, valid YAML).
- `travel/<destination>/index.html`: generated album pages.
- `travel/us-national-parks/index.html`: authored collection page, not generated.

Add a destination row before importing a new folder. Imports update the catalog and add assets; they intentionally do not delete orphaned assets/pages. Review removals manually when retiring an album. Keep the three original personal map locations unless their content is deliberately revised. Dates and specific landmark captions are not inferred from image filenames.

The US series separates the 10 national parks represented in the folder from three other stops. Classification references: [NPS park system](https://www.nps.gov/aboutus/national-park-system.htm) and [Navajo Nation Parks](https://navajonationparks.org/navajo-tribal-parks/monument-valley/).

Validate with `bundle exec jekyll build` and `node --check assets/js/travel-map.js` / `node --check assets/js/travel-gallery.js`. Preview `/travel/`, an album, and `/travel/us-national-parks/` on desktop and mobile.
