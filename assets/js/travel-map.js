(function () {
  const dataEl = document.getElementById('travel-data');
  if (!dataEl) return;

  let cities = [];
  try {
    cities = JSON.parse(dataEl.textContent);
  } catch (e) {
    console.error('travel-map: failed to parse data', e);
    return;
  }

  const map = L.map('travel-map', {
    worldCopyJump: true,
    scrollWheelZoom: true,
  }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 18,
  }).addTo(map);

  const cluster = L.markerClusterGroup({
    showCoverageOnHover: false,
    spiderfyOnMaxZoom: true,
    maxClusterRadius: 40,
  });

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function buildPopup(c) {
    let html = '<div class="travel-popup" style="font-family: \'Palatino Linotype\', Palatino, Georgia, serif;">';
    html += '<h4 style="margin: 0 0 6px; font-size: 16px; color: #00356b; font-family: \'Futura\', sans-serif;">'
      + escapeHtml(c.city)
      + (c.country ? ', ' + escapeHtml(c.country) : '')
      + '</h4>';

    if (c.date) {
      html += '<p style="margin: 0 0 6px; color: #888; font-size: 12px;">'
        + escapeHtml(c.date) + '</p>';
    }

    if (c.notes) {
      html += '<p style="margin: 0 0 8px; font-size: 13px; line-height: 1.4;">'
        + escapeHtml(c.notes) + '</p>';
    }

    if (c.photos && c.photos.length) {
      const cols = c.photos.length === 1 ? 1 : 2;
      html += '<div class="travel-photos" style="display: grid; grid-template-columns: repeat('
        + cols + ', 1fr); gap: 6px; max-width: 260px;">';

      c.photos.forEach(function (p) {
        const src = escapeHtml(p.src);
        const caption = escapeHtml(p.caption || '');
        html += '<a href="' + src + '" target="_blank" rel="noopener" title="' + caption + '">';
        html += '<img src="' + src + '" alt="' + caption
          + '" style="width: 100%; height: 90px; object-fit: cover; border-radius: 4px; display: block;" />';
        html += '</a>';
      });

      html += '</div>';
    } else {
      html += '<p style="margin: 0; font-size: 12px; color: #aaa; font-style: italic;">Photos coming soon.</p>';
    }

    html += '</div>';
    return html;
  }

  cities.forEach(function (c) {
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
    const marker = L.marker([c.lat, c.lng]);
    marker.bindPopup(buildPopup(c), { maxWidth: 280 });
    cluster.addLayer(marker);
  });

  map.addLayer(cluster);

  if (cities.length > 1) {
    const bounds = L.latLngBounds(cities.map(function (c) { return [c.lat, c.lng]; }));
    map.fitBounds(bounds.pad(0.3));
  } else if (cities.length === 1) {
    map.setView([cities[0].lat, cities[0].lng], 5);
  }
})();
