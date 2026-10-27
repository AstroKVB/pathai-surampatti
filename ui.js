/* UI polish only: sliding tab indicator and button ripples. Touches no simulation state. */
(function () {
  'use strict';
  const nav = document.querySelector('.tabs');
  if (nav) {
    const ind = document.createElement('span'); ind.className = 'tab-ind'; nav.prepend(ind);
    const place = () => {
      const a = nav.querySelector('.tab.active'); if (!a) return;
      ind.style.width = a.offsetWidth + 'px'; ind.style.transform = `translateX(${a.offsetLeft}px)`;
    };
    nav.addEventListener('click', () => requestAnimationFrame(place));
    window.addEventListener('resize', place);
    place(); setTimeout(place, 150);
  }
  document.addEventListener('pointerdown', e => {
    const b = e.target.closest && e.target.closest('.btn'); if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2, s = document.createElement('span');
    s.className = 'ripple'; s.style.width = s.style.height = d + 'px';
    s.style.left = (e.clientX - r.left - d / 2) + 'px'; s.style.top = (e.clientY - r.top - d / 2) + 'px';
    b.appendChild(s); setTimeout(() => s.remove(), 700);
  });
})();
