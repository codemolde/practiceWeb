// Instant Desktop Environment Detection (macOS & Electron)
(function () {
  try {
    var isElectron = /Electron/i.test(navigator.userAgent) || window.location.search.indexOf('electron=1') !== -1;
    var isMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
    if (isElectron) {
      document.documentElement.classList.add('is-electron');
      if (isMac) document.documentElement.classList.add('is-mac');
    }
  } catch (e) { }
})();

