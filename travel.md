---
layout: default
title: Travel
slug: /travel
permalink: /travel/
---

<link rel="stylesheet" href="{{ '/assets/css/travel.css' | relative_url }}" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />

<div class="travel-page">
  <header class="travel-intro">
    <p class="travel-eyebrow">A photo journal</p>
    <h1>Travel</h1>
    <p>Places I've been and moments from along the way.</p>
    {% assign albums = site.data.travel | where_exp: 'place', 'place.photos.size > 0' %}
    {% assign photo_count = 0 %}
    {% for place in albums %}{% assign photo_count = photo_count | plus: place.photos.size %}{% endfor %}
    <p class="travel-meta">{{ albums.size }} destinations <span aria-hidden="true">&middot;</span> {{ photo_count }} photographs</p>
  </header>

  {% assign parks = albums | where: 'region', 'us-parks' %}
  {% assign national_parks = parks | where: 'kind', 'National park' %}
  {% assign park_cover = parks | where: 'city', 'Grand Teton' | first %}
  <a class="travel-feature" href="{{ '/travel/us-national-parks/' | relative_url }}">
    <img src="{{ park_cover.cover | replace: "/thumbs/", "/" | relative_url }}" alt="{{ park_cover.city }}" width="960" height="420" fetchpriority="high" />
    <div class="travel-feature-copy">
      <span class="travel-eyebrow">Featured collection</span>
      <h2>US National Park series</h2>
      <p>{{ national_parks.size }} national parks &amp; {{ parks.size | minus: national_parks.size }} nearby stops</p>
      <span class="travel-feature-link">Explore the series <span aria-hidden="true">&rarr;</span></span>
    </div>
  </a>

  <section class="travel-map-section" aria-labelledby="map-heading">
    <div class="travel-section-heading"><h2 id="map-heading">On the map</h2><a href="#destinations">Browse the albums &darr;</a></div>
    <p class="travel-muted">Choose a marker to open an album. Markers show approximate destination locations.</p>
    <div id="travel-map" aria-label="Map of travel destinations"><p class="travel-map-fallback">Explore every photo album below. The interactive map loads when available.</p></div>
  </section>

  <section id="destinations" aria-labelledby="destinations-heading">
    <h2 id="destinations-heading">The albums</h2>
    <div class="travel-filters" aria-label="Filter destinations" hidden>
      <button type="button" data-filter="all" aria-pressed="true">All destinations</button>
      <button type="button" data-filter="us-parks" aria-pressed="false">US National Park series</button>
      <button type="button" data-filter="americas" aria-pressed="false">Latin America</button>
      <button type="button" data-filter="europe" aria-pressed="false">Europe</button>
    </div>
    <p id="travel-results" class="travel-muted" aria-live="polite">{{ albums.size }} albums</p>
    <div class="travel-cards">
      {% for place in albums %}{% include travel-card.html place=place %}{% endfor %}
    </div>
  </section>
</div>
<script id="travel-data" type="application/json">{{ site.data.travel | jsonify }}</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script src="{{ '/assets/js/travel-map.js' | relative_url }}" data-baseurl="{{ site.baseurl }}"></script>
