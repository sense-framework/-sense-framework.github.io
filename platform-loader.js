(() => {
  'use strict';
  const VERSION = '1.0.2';
  const load = src => new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.body.appendChild(script);
  });
  Promise.resolve()
    .then(() => load(`./business-preload.js?v=${VERSION}`))
    .then(() => load(`./business.js?v=${VERSION}`))
    .catch(() => window.SENSE_APP?.toast?.('Business modules could not start'));
})();
