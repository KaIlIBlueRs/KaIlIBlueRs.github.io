(function () {
  'use strict';
  const photos = Array.from(document.querySelectorAll('.travel-photo'));
  const dialog = document.querySelector('.travel-lightbox');
  if (!photos.length || !dialog || typeof dialog.showModal !== 'function') return;
  const image = document.getElementById('lightbox-image');
  const position = document.getElementById('photo-position');
  const caption = document.getElementById('photo-caption');
  let current = 0;
  let opener = null;

  function show(index) {
    current = (index + photos.length) % photos.length;
    const photo = photos[current];
    image.src = photo.href;
    image.alt = photo.dataset.caption;
    caption.textContent = photo.dataset.caption;
    position.textContent = (current + 1) + ' / ' + photos.length;
  }
  photos.forEach(function (photo, index) {
    photo.addEventListener('click', function (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      opener = photo;
      show(index);
      dialog.showModal();
      document.body.classList.add('travel-viewing');
      dialog.querySelector('.travel-close').focus();
    });
  });
  dialog.querySelector('.travel-close').addEventListener('click', function () { dialog.close(); });
  dialog.querySelector('.travel-previous').addEventListener('click', function () { show(current - 1); });
  dialog.querySelector('.travel-next').addEventListener('click', function () { show(current + 1); });
  dialog.addEventListener('keydown', function (event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + (event.key === 'ArrowRight' ? 1 : -1));
    }
  });
  dialog.addEventListener('close', function () {
    document.body.classList.remove('travel-viewing');
    if (opener) opener.focus();
  });
})();
