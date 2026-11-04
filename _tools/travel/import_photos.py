#!/usr/bin/env python3
"""Import a curated World photos folder; keep originals untouched.
Requires Pillow. macOS sips handles HEIC when pillow-heif is unavailable.
"""
import argparse
import hashlib
import io
import json
import re
import subprocess
import tempfile
import unicodedata
from pathlib import Path
from PIL import Image, ImageOps, ImageCms

ROOT = Path(__file__).resolve().parents[2]
META = Path(__file__).with_name('destinations.json')
COVERS = Path(__file__).with_name('covers.json')
EXTENSIONS = {'.jpg', '.jpeg', '.heic', '.png'}

def slug(value):
    value = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', value).strip('-')

def open_photo(path):
    if path.suffix.lower() == '.heic':
        try:
            import pillow_heif
            pillow_heif.register_heif_opener()
        except ImportError:
            with tempfile.TemporaryDirectory() as directory:
                converted = Path(directory) / 'photo.png'
                subprocess.run(['sips', '-s', 'format', 'png', str(path), '--out', str(converted)], check=True, capture_output=True)
                with Image.open(converted) as image:
                    return ImageOps.exif_transpose(image).copy()
    with Image.open(path) as image:
        return ImageOps.exif_transpose(image).copy()

def import_photos(source):
    covers = json.loads(COVERS.read_text()) if COVERS.exists() else {}
    manifest_path = Path(__file__).with_name('manifest.json')
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    manifest, destinations = {}, []
    for row in json.loads(META.read_text()):
        folder, city, country, region, lat, lng, *kind = row
        directory = source / folder
        if not directory.is_dir():
            raise FileNotFoundError(directory)
        place_id = slug(country + '-' + city)
        photos = []
        files = sorted((p for p in directory.iterdir() if p.suffix.lower() in EXTENSIONS), key=lambda p: p.name.lower())
        if not files:
            raise ValueError(f'No photos in {directory}')
        for path in files:
            relative = path.relative_to(source).as_posix()
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            name = slug(path.stem) + '-' + hashlib.sha256(path.name.encode()).hexdigest()[:6] + '.jpg'
            base = ROOT / 'assets/img/travel' / place_id
            full, thumb = base / name, base / 'thumbs' / name
            if previous.get(relative, {}).get('sha256') == digest and full.exists() and thumb.exists():
                width, height = previous[relative]['width'], previous[relative]['height']
            else:
                image = open_photo(path)
                profile = image.info.get('icc_profile')
                if profile:
                    image = ImageCms.profileToProfile(image, ImageCms.ImageCmsProfile(io.BytesIO(profile)), ImageCms.createProfile('sRGB'), outputMode='RGB')
                else:
                    image = image.convert('RGB')
                image.thumbnail((1920, 1920), Image.Resampling.LANCZOS)
                width, height = image.size
                # A fresh RGB image strips GPS, EXIF and other camera metadata.
                clean = Image.new('RGB', image.size)
                clean.paste(image)
                thumb.parent.mkdir(parents=True, exist_ok=True)
                clean.save(full, quality=85, optimize=True, progressive=True)
                clean.thumbnail((640, 640), Image.Resampling.LANCZOS)
                clean.save(thumb, quality=80, optimize=True, progressive=True)
            manifest[relative] = {'sha256': digest, 'width': width, 'height': height}
            photos.append({'src': '/' + full.relative_to(ROOT).as_posix(), 'thumb': '/' + thumb.relative_to(ROOT).as_posix(),
                           'caption': f'{city}, {country} · Photo {len(photos) + 1}', 'width': width, 'height': height, 'source': path.name})
        cover_name = covers.get(folder)
        cover = next((p for p in photos if p['source'] == cover_name), photos[0])
        place = {'id': place_id, 'city': city, 'country': country, 'region': region, 'lat': lat, 'lng': lng,
                 'kind': kind[0] if kind else '', 'url': f'/travel/{place_id}/', 'cover': cover['thumb'], 'photos': photos}
        destinations.append(place)
        page = ROOT / 'travel' / place_id / 'index.html'
        page.parent.mkdir(parents=True, exist_ok=True)
        page.write_text('---\nlayout: travel-album\ntitle: ' + json.dumps(city, ensure_ascii=False) + '\ndestination: ' + place_id + '\n---\n')
        print(f'{city}: {len(photos)} photos', flush=True)
    # Retain the original personal map locations, without inventing new photo albums.
    destinations.extend([
        {'city': 'New Brunswick', 'country': 'USA', 'lat': 40.4862, 'lng': -74.4518, 'date': '2026-09', 'notes': 'My new home for the next few years.', 'photos': []},
        {'city': 'Shanghai', 'country': 'China', 'lat': 31.2304, 'lng': 121.4737, 'date': '2022-2026', 'notes': 'Where I spent my undergrad years at Fudan.', 'photos': []},
        {'city': 'New Haven', 'country': 'USA', 'lat': 41.3083, 'lng': -72.9279, 'date': '2026', 'notes': 'Visiting my partner at Yale.', 'photos': []}
    ])
    # JSON is valid YAML, retaining the site's existing data filename and Liquid key.
    (ROOT / '_data/travel.yml').write_text(json.dumps(destinations, ensure_ascii=False, indent=2) + '\n')
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(f'Imported {len(manifest)} photos in {len(destinations) - 3} albums.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Path to World photos')
    import_photos(parser.parse_args().source)
