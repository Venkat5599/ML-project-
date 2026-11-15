/* ChainSleuth site behaviour: reveal, hero carousel, tabs, carousels, FAQ, menus. */
(function () {
  "use strict";
  var doc = document.documentElement;
  doc.classList.add("js");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function swap(el, from, to) {
    from.split(" ").forEach(function (c) { if (c) el.classList.remove(c); });
    to.split(" ").forEach(function (c) { if (c) el.classList.add(c); });
  }

  /* ---------- reveal on view ---------- */
  var reveals = $$("[data-reveal]");
  function showAll() { reveals.forEach(function (el) { el.classList.add("is-in"); }); }
  if (!("IntersectionObserver" in window) || reduce) {
    showAll();
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    reveals.forEach(function (el) { io.observe(el); });
    // a page that fits the viewport never scrolls anything into view
    setTimeout(function () {
      var sc = $("[data-scroller]") || document.scrollingElement;
      if (sc.scrollHeight <= sc.clientHeight + 4) showAll();
    }, 400);
  }
  window.addEventListener("beforeprint", showAll);

  /* ---------- hero product views ---------- */
  var hero = $("[data-hero]");
  if (hero) {
    var slides = $$("[data-hero-slide]", hero);
    var dots = $$("[data-hero-dot]", hero);
    var DUR = 6000, cur = 0, bar = null, heroVisible = true;
    function playState() {
      if (bar) bar.style.animationPlayState = (heroVisible && !document.hidden) ? "running" : "paused";
    }
    function go(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        swap(s, k === cur ? "opacity-0" : "opacity-100", k === cur ? "opacity-100" : "opacity-0");
        s.setAttribute("aria-hidden", k === cur ? "false" : "true");
      });
      dots.forEach(function (d, k) {
        var pill = d.firstElementChild;
        d.setAttribute("aria-current", k === cur ? "true" : "false");
        swap(pill, k === cur ? "w-1" : "w-8.5", k === cur ? "w-8.5" : "w-1");
        if (k !== cur) pill.replaceChildren();
      });
      var pill = dots[cur].firstElementChild;
      pill.replaceChildren();
      bar = document.createElement("span");
      bar.className = "absolute inset-0 origin-left animate-[cs-slide-progress_linear] rounded-full bg-white motion-reduce:animate-none";
      bar.style.animationDuration = DUR + "ms";
      bar.addEventListener("animationend", function () { go(cur + 1); });
      pill.appendChild(bar);
      playState();
    }
    dots.forEach(function (d, k) { d.addEventListener("click", function () { go(k); }); });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (es) { heroVisible = es[0].isIntersecting; playState(); }).observe(hero);
    }
    document.addEventListener("visibilitychange", playState);
    if (reduce) { setInterval(function () { go(cur + 1); }, DUR); }
    go(0);
  }

  /* ---------- audience tabs ---------- */
  $$("[data-tabs]").forEach(function (root) {
    var tabs = $$("[role=tab]", root);
    var panels = tabs.map(function (t) { return document.getElementById(t.getAttribute("aria-controls")); });
    function select(i, focus) {
      tabs.forEach(function (t, k) {
        var on = k === i;
        t.setAttribute("aria-selected", on ? "true" : "false");
        t.setAttribute("data-state", on ? "active" : "inactive");
        t.tabIndex = on ? 0 : -1;
        var p = panels[k];
        if (!p) return;
        p.setAttribute("data-state", on ? "active" : "inactive");
        p.hidden = !on;
        if (on && !reduce) {
          $$("article", p).forEach(function (a, n) {
            a.style.transition = "none";
            a.style.opacity = "0"; a.style.transform = "translateX(24px)";
            void a.offsetWidth;
            a.style.transition = "opacity 450ms ease-out " + (n * 70) + "ms, transform 450ms cubic-bezier(.2,.7,.2,1) " + (n * 70) + "ms";
            a.style.opacity = "1"; a.style.transform = "translateX(0px)";
          });
        }
      });
      if (focus) tabs[i].focus();
    }
    tabs.forEach(function (t, k) {
      t.addEventListener("click", function () { select(k); });
      t.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight") { e.preventDefault(); select((k + 1) % tabs.length, true); }
        if (e.key === "ArrowLeft") { e.preventDefault(); select((k - 1 + tabs.length) % tabs.length, true); }
      });
    });
    // horizontal tab strip arrows (narrow screens)
    var list = $("[role=tablist]", root);
    var prev = $("[data-tabs-prev]", root), next = $("[data-tabs-next]", root);
    function edges() {
      if (!prev || !next) return;
      var max = list.scrollWidth - list.clientWidth;
      prev.disabled = list.scrollLeft <= 2;
      next.disabled = list.scrollLeft >= max - 2;
    }
    if (prev && next) {
      prev.addEventListener("click", function () { list.scrollBy({ left: -160, behavior: "smooth" }); });
      next.addEventListener("click", function () { list.scrollBy({ left: 160, behavior: "smooth" }); });
      list.addEventListener("scroll", edges, { passive: true });
      window.addEventListener("resize", edges);
      edges();
    }
    select(0);
  });

  /* ---------- card carousel ---------- */
  $$("[data-cards]").forEach(function (root) {
    var ul = $("ul", root);
    var prev = $("[data-cards-prev]", root), next = $("[data-cards-next]", root);
    if (!ul || !prev || !next) return;
    function step() {
      var li = ul.children[0];
      if (!li) return 0;
      var gap = parseFloat(getComputedStyle(ul).columnGap) || 24;
      return li.getBoundingClientRect().width + gap;
    }
    function edges() {
      var max = ul.scrollWidth - ul.clientWidth;
      prev.disabled = ul.scrollLeft <= 2;
      next.disabled = ul.scrollLeft >= max - 2;
    }
    prev.addEventListener("click", function () { ul.scrollBy({ left: -step(), behavior: reduce ? "auto" : "smooth" }); });
    next.addEventListener("click", function () { ul.scrollBy({ left: step(), behavior: reduce ? "auto" : "smooth" }); });
    ul.addEventListener("scroll", edges, { passive: true });
    window.addEventListener("resize", edges);
    edges();
  });

  /* ---------- FAQ accordion ---------- */
  var qs = $$("[data-faq] [aria-controls]");
  function setQ(b, open) {
    var a = document.getElementById(b.getAttribute("aria-controls"));
    b.setAttribute("aria-expanded", open ? "true" : "false");
    b.classList.toggle("pb-2.5", open);
    var bar = b.querySelector("span[aria-hidden] span:last-child");
    if (bar) bar.classList.toggle("rotate-90", open);
    if (a) {
      swap(a, open ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0");
      a.setAttribute("aria-hidden", open ? "false" : "true");
    }
  }
  qs.forEach(function (b) {
    b.addEventListener("click", function () {
      var open = b.getAttribute("aria-expanded") !== "true";
      qs.forEach(function (o) { if (o !== b) setQ(o, false); });
      setQ(b, open);
    });
  });

  /* ---------- header: more menu ---------- */
  $$("[data-menu]").forEach(function (wrap) {
    var btn = $("button", wrap), pop = $("[data-menu-pop]", wrap);
    if (!btn || !pop) return;
    var t;
    function set(open) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("data-state", open ? "open" : "closed");
      pop.setAttribute("data-state", open ? "open" : "closed");
    }
    wrap.addEventListener("mouseenter", function () { clearTimeout(t); set(true); });
    wrap.addEventListener("mouseleave", function () { t = setTimeout(function () { set(false); }, 120); });
    btn.addEventListener("click", function () { set(btn.getAttribute("aria-expanded") !== "true"); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
    document.addEventListener("click", function (e) { if (!wrap.contains(e.target)) set(false); });
  });

  /* ---------- mobile menu ---------- */
  var mBtn = $("[data-mobile-open]"), mPanel = $("[data-mobile-panel]");
  if (mBtn && mPanel) {
    function setM(open) {
      mPanel.setAttribute("data-state", open ? "open" : "closed");
      mBtn.setAttribute("aria-expanded", open ? "true" : "false");
      doc.classList.toggle("menu-open", open);
    }
    mBtn.addEventListener("click", function () { setM(mPanel.getAttribute("data-state") !== "open"); });
    $$("[data-mobile-close], [data-mobile-panel] a", mPanel).forEach(function (el) {
      el.addEventListener("click", function () { setM(false); });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setM(false); });
  }

  /* ---------- "/" focuses repository search ---------- */
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || /input|textarea/i.test((e.target || {}).tagName || "")) return;
    var s = $("[data-search]");
    if (s && s.offsetParent) { e.preventDefault(); s.focus(); }
  });

  /* ---------- in-page anchors inside the scroll container ---------- */
  var scroller = $("[data-scroller]");
  if (scroller) {
    $$('a[href^="#"]').forEach(function (a) {
      a.addEventListener("click", function (e) {
        var id = a.getAttribute("href").slice(1);
        var el = id && document.getElementById(id);
        if (!el) return;
        e.preventDefault();
        var top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 16;
        scroller.scrollTo({ top: top, behavior: reduce ? "auto" : "smooth" });
        history.replaceState(null, "", "#" + id);
      });
    });
  }
})();
