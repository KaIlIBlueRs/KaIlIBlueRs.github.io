---
layout: default
title: Travel
slug: /travel
---

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css" />
<link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css" />

<h1 class="page-heading" style="font-size: 28px; margin-bottom: 10px;">Travel</h1>

<p style="margin-bottom: 20px;">
Places I've been and photos from along the way. Click a marker to see photos from that city.
</p>

<div id="travel-map"
     style="height: 600px; width: 100%; border: 1px solid #e5e5e5; border-radius: 8px; margin-bottom: 30px; z-index: 0;">
</div>

<script id="travel-data" type="application/json">{{ site.data.travel | jsonify }}</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>
<script src="https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"></script>
<script src="{{ '/assets/js/travel-map.js' | absolute_url }}"></script>
