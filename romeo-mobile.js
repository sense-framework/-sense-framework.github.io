(() => {
  'use strict';

  function init() {
    const shell = document.getElementById('romeoShell');
    const sidebar = document.getElementById('romeoSidebar');
    const inspector = document.getElementById('romeoInspector');
    const settings = document.getElementById('romeoSettingsButton');
    const sessions = document.getElementById('romeoSessionsButton');
    const close = document.getElementById('romeoClose');
    if (!shell || !sidebar || !inspector || !settings || !sessions || !close) return false;

    const style = document.createElement('style');
    style.id = 'romeoMobileDrawers';
    style.textContent = `
      @media(max-width:1100px){
        .romeo-inspector{display:block!important;position:fixed!important;z-index:2147483645!important;top:calc(74px + var(--romeo-safe-t))!important;right:0!important;bottom:0!important;width:min(92vw,370px)!important;border-left:1px solid var(--romeo-line)!important;transform:translateX(105%);transition:transform .24s ease;box-shadow:-26px 0 70px rgba(0,0,0,.58)}
        .romeo-inspector.drawer-open{transform:none}
      }
      @media(max-width:760px){
        #romeoSettingsButton{display:grid!important}
        .romeo-sidebar{display:flex!important;position:fixed!important;z-index:2147483644!important;top:calc(58px + var(--romeo-safe-t))!important;bottom:0!important;left:0!important;width:min(88vw,320px)!important;transform:translateX(-105%);transition:transform .24s ease;box-shadow:26px 0 70px rgba(0,0,0,.58)}
        .romeo-sidebar.drawer-open{transform:none}
      }
    `;
    document.head.appendChild(style);

    settings.addEventListener('click', () => {
      inspector.classList.toggle('drawer-open');
      sidebar.classList.remove('drawer-open');
      if (inspector.classList.contains('drawer-open')) {
        setTimeout(() => document.getElementById('romeoConnectionCard')?.scrollIntoView({ block: 'start' }), 40);
      }
    });

    sessions.addEventListener('click', () => {
      sidebar.classList.toggle('drawer-open');
      inspector.classList.remove('drawer-open');
    });

    sidebar.addEventListener('click', event => {
      if (event.target.closest('[data-session-id],#romeoNew')) sidebar.classList.remove('drawer-open');
    });

    close.addEventListener('click', () => {
      sidebar.classList.remove('drawer-open');
      inspector.classList.remove('drawer-open');
    });

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (sidebar.classList.contains('drawer-open') || inspector.classList.contains('drawer-open')) {
        event.stopImmediatePropagation();
        sidebar.classList.remove('drawer-open');
        inspector.classList.remove('drawer-open');
      }
    }, true);

    return true;
  }

  if (!init()) {
    const observer = new MutationObserver(() => {
      if (init()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 10000);
  }
})();
