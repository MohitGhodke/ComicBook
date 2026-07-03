(function () {
  'use strict';

  var NAV_H = 60;  // nav bar + gap
  var PAD   = 16;  // minimal breathing room

  // Image aspect ratio (h/w) — detected from page-01.png at runtime.
  // Falls back to a standard portrait comic ratio if the image can't load.
  var pageRatio = 1100 / 733; // fallback: classic portrait

  var prevBtn   = document.getElementById('prevBtn');
  var nextBtn   = document.getElementById('nextBtn');
  var closeBtn  = document.getElementById('closeBtn');
  var pageInfo  = document.getElementById('pageInfo');
  var jumpPanel = document.getElementById('jumpPanel');
  var jumpDots  = document.getElementById('jumpDots');

  var storytellerBtn     = document.getElementById('storytellerBtn');
  var storytellerOverlay = document.getElementById('storytellerOverlay');
  var storytellerLens    = document.getElementById('storytellerLens');
  var storytellerLensImg = document.getElementById('storytellerLensImg');
  var storytellerActive  = false;

  var LENS_RADIUS  = 210; // half of the 420px lens
  var ZOOM_FACTOR  = 1.5;

  var pageFlip    = null;
  var totalPages  = 0;
  var isFirstLoad = true;
  var openTimer   = null;

  var bookLoader  = document.getElementById('bookLoader');

  // Fade out the loading overlay, then remove it from the DOM.
  function hideLoader() {
    if (!bookLoader) return;
    var el = bookLoader;
    bookLoader = null;
    el.classList.add('hidden');
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 600); // slightly longer than the 0.5s CSS fade
  }

  // Snapshot of page data taken BEFORE StPageFlip touches the DOM.
  // We rebuild from this on every reinit so StPageFlip always gets fresh elements.
  var pageSnapshot = [];

  // ── Collect page data from HTML before first init ─────────────────────────
  function snapshotPages() {
    document.querySelectorAll('#book .page').forEach(function (div) {
      var img = div.querySelector('img');
      pageSnapshot.push({
        classes: div.className,
        src:     img ? img.getAttribute('src') : '',
        alt:     img ? (img.getAttribute('alt') || '') : ''
      });
    });
  }

  // Rebuild page elements fresh (StPageFlip modifies/removes them on destroy)
  function rebuildPages() {
    var book = document.getElementById('book');
    book.innerHTML = '';
    pageSnapshot.forEach(function (p) {
      var div = document.createElement('div');
      div.className = p.classes;
      if (p.src) {
        var img = document.createElement('img');
        img.src = p.src;
        img.alt = p.alt;
        div.appendChild(img);
      }
      book.appendChild(div);
    });
  }

  // ── Size calculation ───────────────────────────────────────────────────────
  // Derives page display dimensions in real CSS pixels from the viewport size
  // and the image aspect ratio. No CSS transform — StPageFlip renders at this
  // exact size, so mouse/touch coordinates are always correct.
  function calcPageSize() {
    var availW = window.innerWidth  - PAD;
    var availH = window.innerHeight - NAV_H - PAD;

    // Fit a double spread (2 pages wide × 1 page tall) into available space
    var pageW = Math.floor(availW / 2);
    var pageH = Math.round(pageW * pageRatio);

    if (pageH > availH) {
      pageH = availH;
      pageW = Math.round(pageH / pageRatio);
    }

    return { w: Math.max(pageW, 80), h: Math.max(pageH, 80) };
  }

  // ── Button pop animation ──────────────────────────────────────────────────
  function popBtn(btn) {
    btn.classList.remove('popped');
    void btn.offsetWidth; // reflow to restart animation
    btn.classList.add('popped');
    btn.addEventListener('animationend', function handler() {
      btn.classList.remove('popped');
      btn.removeEventListener('animationend', handler);
    });
  }

  // ── Storyteller mode ─────────────────────────────────────────────────────

  function setLensPosition(cx, cy) {
    document.documentElement.style.setProperty('--cx', cx + 'px');
    document.documentElement.style.setProperty('--cy', cy + 'px');
  }

  function updateMagnifier(cx, cy) {
    // Find the book page image under the cursor, looking through overlay/lens
    var els = document.elementsFromPoint(cx, cy);
    var pageImg = null;
    for (var i = 0; i < els.length; i++) {
      if (els[i].tagName === 'IMG' && els[i].closest('.page')) {
        pageImg = els[i];
        break;
      }
    }

    if (!pageImg) {
      storytellerLensImg.style.display = 'none';
      return;
    }

    var rect = pageImg.getBoundingClientRect();
    var scaledW = rect.width  * ZOOM_FACTOR;
    var scaledH = rect.height * ZOOM_FACTOR;

    // Shift the zoomed image so the point under the cursor maps to lens centre
    var imgLeft = LENS_RADIUS - (cx - rect.left)  * ZOOM_FACTOR;
    var imgTop  = LENS_RADIUS - (cy - rect.top)   * ZOOM_FACTOR;

    storytellerLensImg.src          = pageImg.src;
    storytellerLensImg.style.display = 'block';
    storytellerLensImg.style.width   = scaledW + 'px';
    storytellerLensImg.style.height  = scaledH + 'px';
    storytellerLensImg.style.left    = imgLeft + 'px';
    storytellerLensImg.style.top     = imgTop  + 'px';
  }

  function toggleStoryteller() {
    storytellerActive = !storytellerActive;
    if (storytellerActive) {
      closeJumpPanel();
      document.body.classList.add('storyteller-active');
      storytellerBtn.classList.add('active');
      storytellerOverlay.classList.add('active');
      storytellerLens.classList.add('active');
    } else {
      document.body.classList.remove('storyteller-active');
      storytellerBtn.classList.remove('active');
      storytellerOverlay.classList.remove('active');
      storytellerLens.classList.remove('active');
    }
  }

  // ── Jump panel ────────────────────────────────────────────────────────────
  var jumpOpen = false;

  function buildJumpDots(currentIndex) {
    jumpDots.innerHTML = '';
    for (var i = 0; i < totalPages; i++) {
      (function (idx) {
        var dot = document.createElement('button');
        dot.className = 'jump-dot' + (idx === currentIndex ? ' active' : '');
        dot.textContent = idx + 1;
        dot.setAttribute('aria-label', 'Jump to page ' + (idx + 1));
        dot.addEventListener('click', function () {
          popBtn(dot);
          closeJumpPanel();
          if (pageFlip) pageFlip.turnToPage(idx);
        });
        jumpDots.appendChild(dot);
      }(i));
    }
  }

  function openJumpPanel() {
    var current = pageFlip ? pageFlip.getCurrentPageIndex() : 0;
    buildJumpDots(current);
    jumpPanel.classList.add('open');
    jumpPanel.removeAttribute('aria-hidden');
    pageInfo.classList.add('open');
    jumpOpen = true;
  }

  function closeJumpPanel() {
    jumpPanel.classList.remove('open');
    jumpPanel.setAttribute('aria-hidden', 'true');
    pageInfo.classList.remove('open');
    jumpOpen = false;
  }

  function toggleJumpPanel() {
    if (jumpOpen) { closeJumpPanel(); } else { openJumpPanel(); }
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  function refreshUI(index) {
    pageInfo.textContent = (index + 1) + ' / ' + totalPages;
    prevBtn.disabled  = index <= 0;
    nextBtn.disabled  = index >= totalPages - 1;
    closeBtn.disabled = index <= 0;
    // keep active dot in sync if panel is open
    if (jumpOpen) {
      jumpDots.querySelectorAll('.jump-dot').forEach(function (d, i) {
        d.classList.toggle('active', i === index);
      });
    }
  }

  function onClose() {
    popBtn(closeBtn);
    closeJumpPanel();
    if (pageFlip) pageFlip.turnToPage(0);
  }

  function onNext() {
    if (pageFlip) { popBtn(nextBtn); pageFlip.flipNext(); }
  }

  function onPrev() {
    if (pageFlip) { popBtn(prevBtn); pageFlip.flipPrev(); }
  }

  // ── StPageFlip init ────────────────────────────────────────────────────────
  function initPageFlip(goToPage) {
    var size = calcPageSize();

    // destroy() calls block.remove() which pulls #book out of the DOM entirely,
    // so we must destroy before rebuilding — then re-insert a fresh #book.
    if (pageFlip) {
      try { pageFlip.destroy(); } catch (e) { /* ignore mid-animation errors */ }
      pageFlip = null;
      var scene = document.querySelector('.book-scene');
      var nav   = document.querySelector('.book-nav');
      var fresh = document.createElement('div');
      fresh.id  = 'book';
      scene.insertBefore(fresh, nav);
    }

    rebuildPages();

    pageFlip = new St.PageFlip(document.getElementById('book'), {
      width:               size.w,
      height:              size.h,
      showCover:           true,
      drawShadow:          true,
      flippingTime:        1000,
      usePortrait:         false,
      autoSize:            false,
      maxShadowOpacity:    0.4,
      mobileScrollSupport: false,
    });

    pageFlip.loadFromHTML(document.querySelectorAll('#book .page'));
    totalPages = pageFlip.getPageCount();

    var startPage = (goToPage > 0) ? goToPage : 0;
    refreshUI(startPage);

    pageFlip.on('flip', function (e) { refreshUI(e.data); });

    // Defer turnToPage so StPageFlip has painted its first frame
    if (startPage > 0) {
      setTimeout(function () {
        if (pageFlip) pageFlip.turnToPage(startPage);
      }, 50);
    }

    if (isFirstLoad) {
      isFirstLoad = false;
      // Auto-open: cover sweeps left over the logo
      openTimer = setTimeout(function () {
        if (pageFlip) pageFlip.flipNext('bottom');
      }, 600);
    }
  }

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    snapshotPages();

    nextBtn.addEventListener('click', onNext);
    prevBtn.addEventListener('click', onPrev);
    closeBtn.addEventListener('click', onClose);
    pageInfo.addEventListener('click', function () { popBtn(pageInfo); toggleJumpPanel(); });
    storytellerBtn.addEventListener('click', function () { popBtn(storytellerBtn); toggleStoryteller(); });
    document.getElementById('storytellerBlocker').addEventListener('click', toggleStoryteller);

    // Close jump panel when clicking outside it
    document.addEventListener('click', function (e) {
      if (jumpOpen && !jumpPanel.contains(e.target) && e.target !== pageInfo) {
        closeJumpPanel();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft')  onPrev();
      if (e.key === 'Escape') {
        closeJumpPanel();
        if (storytellerActive) toggleStoryteller();
      }
    });

    // Initialise CSS vars to viewport centre so first activation is centred
    setLensPosition(window.innerWidth / 2, window.innerHeight / 2);

    document.addEventListener('mousemove', function (e) {
      setLensPosition(e.clientX, e.clientY);
      if (storytellerActive) updateMagnifier(e.clientX, e.clientY);
    });

    // Preload every comic image, then init the book and reveal it. This keeps
    // the loader on screen until the pages are actually decoded, so the book
    // appears fully rendered rather than flashing in blank.
    var srcs = pageSnapshot
      .map(function (p) { return p.src; })
      .filter(Boolean);

    var booted = false;
    function boot() {
      if (booted) return;
      booted = true;
      initPageFlip(0);
      hideLoader();
    }

    if (srcs.length === 0) {
      boot();
    } else {
      var remaining = srcs.length;
      srcs.forEach(function (src) {
        var img = new Image();
        img.onload = function () {
          // Use the first interior page to detect the true aspect ratio
          if (/page-01\.png(\?|$)/.test(src)) {
            pageRatio = img.naturalHeight / img.naturalWidth;
          }
          if (--remaining <= 0) boot();
        };
        img.onerror = function () {
          // missing/renamed image — just don't let it block booting
          if (--remaining <= 0) boot();
        };
        img.src = src;
      });

      // Safety net: never trap the user behind the loader if an image stalls
      setTimeout(boot, 10000);
    }

    // Resize: destroy + reinit at new size, preserving current page
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      clearTimeout(openTimer);
      resizeTimer = setTimeout(function () {
        var current = pageFlip ? pageFlip.getCurrentPageIndex() : 0;
        initPageFlip(current);
      }, 250);
    });
  });

}());
