(function () {
  'use strict';
  const dataEl = document.getElementById('travel-data');
  if (!dataEl) return;
  const places = JSON.parse(dataEl.textContent);
  const baseurl = document.currentScript.dataset.baseurl || '';
  const filters = document.querySelector('.travel-filters');
  const cards = Array.from(document.querySelectorAll('.travel-card'));
  const results = document.getElementById('travel-results');
  let map;
  let markers;

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function popup(place) {
    let html = '<div class="travel-popup"><h3>' + escapeHtml(place.city) + '</h3><p>' + escapeHtml(place.country) + '</p>';
    if (place.kind) html += '<p>' + escapeHtml(place.kind) + '</p>';
    if (place.notes) html += '<p>' + escapeHtml(place.notes) + '</p>';
    if (place.photos && place.photos.length) {
      html += '<a href="' + escapeHtml(baseurl + place.url) + '"><img src="' + escapeHtml(baseurl + place.cover) + '" alt="' + escapeHtml(place.city) + '" loading="lazy">View ' + place.photos.length + ' photographs &rarr;</a>';
    }
    return html + '</div>';
  }
  function updateMap(filter) {
    if (!map) return;
    markers.clearLayers();
    const visible = places.filter(function (place) {
      return (filter === 'all' || place.region === filter) && Number.isFinite(place.lat) && Number.isFinite(place.lng);
    });
    visible.forEach(function (place) {
      L.marker([place.lat, place.lng]).bindPopup(popup(place), { maxWidth: 250 }).addTo(markers);
    });
    if (visible.length) map.fitBounds(L.latLngBounds(visible.map(function (place) { return [place.lat, place.lng]; })).pad(0.15), { maxZoom: 6 });
  }
  // Album browsing works even if the external map library cannot load.
  filters.hidden = false;
  filters.addEventListener('click', function (event) {
    const button = event.target.closest('button[data-filter]');
    if (!button) return;
    const filter = button.dataset.filter;
    filters.querySelectorAll('button').forEach(function (item) { item.setAttribute('aria-pressed', String(item === button)); });
    let count = 0;
    cards.forEach(function (card) {
      card.hidden = filter !== 'all' && card.dataset.region !== filter;
      if (!card.hidden) count += 1;
    });
    results.textContent = count + ' albums';
    updateMap(filter);
  });
  if (!window.L) return;
  document.querySelector('.travel-map-fallback').remove();
  map = L.map('travel-map', { worldCopyJump: true, scrollWheelZoom: false }).setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxZoom: 18
  }).addTo(map);
  markers = typeof L.markerClusterGroup === 'function'
    ? L.markerClusterGroup({ showCoverageOnHover: false, spiderfyOnMaxZoom: true, maxClusterRadius: 35 })
    : L.layerGroup();
  map.addLayer(markers);
  updateMap('all');
})();
