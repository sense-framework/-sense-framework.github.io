(() => {
  const body = document.body;
  const sidebar = document.getElementById('sidebar');
  const desktopToggle = document.getElementById('menuToggle');
  const mobileToggle = document.getElementById('mobileMenu');
  const navLinks = document.querySelectorAll('.nav-item');
  const year = document.getElementById('year');

  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

  const setSidebar = (open) => {
    sidebar.classList.toggle('open', open);

    if (isMobile()) {
      body.classList.toggle('nav-open', open);
      body.classList.remove('sidebar-expanded');
    } else {
      body.classList.toggle('sidebar-expanded', open);
      body.classList.remove('nav-open');
    }

    desktopToggle?.setAttribute('aria-expanded', String(open));
    mobileToggle?.setAttribute('aria-expanded', String(open));
  };

  desktopToggle?.addEventListener('click', () => {
    setSidebar(!sidebar.classList.contains('open'));
  });

  mobileToggle?.addEventListener('click', () => {
    setSidebar(!sidebar.classList.contains('open'));
  });

  navLinks.forEach((link) => {
    link.addEventListener('click', () => {
      navLinks.forEach((item) => item.classList.remove('active'));
      link.classList.add('active');

      if (isMobile()) {
        setSidebar(false);
      }
    });
  });

  document.addEventListener('click', (event) => {
    if (!isMobile() || !body.classList.contains('nav-open')) return;
    if (sidebar.contains(event.target) || mobileToggle?.contains(event.target)) return;
    setSidebar(false);
  });

  window.addEventListener('resize', () => {
    if (isMobile()) {
      body.classList.remove('sidebar-expanded');
      if (!body.classList.contains('nav-open')) {
        sidebar.classList.remove('open');
      }
    } else {
      body.classList.remove('nav-open');
    }
  });

  if (year) {
    year.textContent = new Date().getFullYear();
  }
})();
