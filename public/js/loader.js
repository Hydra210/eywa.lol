(function () {
  const loader = document.createElement('div');
  loader.id = 'page-loader';
  loader.innerHTML = `
    <div class="loader-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
    <div class="loader-label" id="loaderLabel">Loading</div>
    <div class="loader-dots"><span></span><span></span><span></span></div>
  `;
  document.body.prepend(loader);

  const bar = document.createElement('div');
  bar.className = 'loader-bar';
  bar.id = 'loaderBar';
  document.body.prepend(bar);

  document.body.classList.add('page-entering');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.remove('page-entering');
      document.body.classList.add('page-ready');
    });
  });
})();

let _barTimer = null;
let _barVal = 0;

function showLoader(label) {
  label = label || 'Loading';
  var el = document.getElementById('page-loader');
  var bar = document.getElementById('loaderBar');
  var lbl = document.getElementById('loaderLabel');
  if (lbl) lbl.textContent = label;
  if (el) el.classList.add('visible');
  _barVal = 0;
  if (bar) { bar.style.width = '0%'; bar.style.opacity = '1'; }
  clearInterval(_barTimer);
  _barTimer = setInterval(function() {
    _barVal += (85 - _barVal) * 0.08;
    if (bar) bar.style.width = _barVal + '%';
  }, 60);
}

function hideLoader() {
  var el = document.getElementById('page-loader');
  var bar = document.getElementById('loaderBar');
  clearInterval(_barTimer);
  if (bar) {
    bar.style.width = '100%';
    setTimeout(function() { bar.style.opacity = '0'; bar.style.width = '0%'; }, 300);
  }
  if (el) setTimeout(function() { el.classList.remove('visible'); }, 120);
}

function navigateTo(url, label) {
  showLoader(label || 'Loading');
  setTimeout(function() { window.location.href = url; }, 380);
}
