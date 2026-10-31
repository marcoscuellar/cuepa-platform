(function () {
  function update() {
    if (document.body.dataset.workspacePage !== 'hub') return;
    var selected = location.hash.slice(1) || 'today';
    document.querySelectorAll('[data-cuepa-view]').forEach(function (link) {
      if (link.dataset.cuepaView === selected) link.setAttribute('aria-current','page');
      else link.removeAttribute('aria-current');
    });
  }
  window.addEventListener('hashchange', update);
  document.querySelectorAll('.cuepa-more a').forEach(function (link) {
    link.addEventListener('click', function () { document.querySelector('.cuepa-more').open = false; });
  });
  update();
}());
