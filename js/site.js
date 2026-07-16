/* JR Fine Wood LLC — shared behaviour */
(function () {
  'use strict';

  // Scroll reveal
  document.body.classList.add('reveal-ready');
  var els = Array.prototype.slice.call(document.querySelectorAll('[data-reveal]'));
  if (!('IntersectionObserver' in window) || !els.length) {
    document.body.classList.remove('reveal-ready');
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach(function (el) { io.observe(el); });
  }

  // Mobile nav
  var nav = document.querySelector('.nav');
  var toggle = document.querySelector('.nav-toggle');
  if (nav && toggle) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('.nav-links a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Instagram embed (home page)
  if (document.querySelector('.instagram-media')) {
    var tries = 0;
    (function processInstagram() {
      if (window.instgrm && window.instgrm.Embeds) { window.instgrm.Embeds.process(); return; }
      if (tries++ < 20) setTimeout(processInstagram, 300);
    })();
  }

  // Contact form — composes an email to the workshop
  var form = document.getElementById('enquiry-form');
  if (form) {
    var note = document.getElementById('form-note');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var name = form.elements.name.value.trim();
      var email = form.elements.email.value.trim();
      var need = form.elements.need.value.trim();
      var details = form.elements.details.value.trim();

      if (!name || !email || !need) {
        note.textContent = 'Please fill in your name, email and what you need — then send again.';
        note.classList.add('error');
        return;
      }

      var subject = 'Commission enquiry — ' + need;
      var body = 'Name: ' + name + '\nEmail: ' + email + '\nPiece: ' + need + '\n\n' + (details || '(no further details yet)');
      window.location.href = 'mailto:hello@jrfinewood.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);

      note.classList.remove('error');
      note.textContent = 'Opening your email app… If nothing happens, write to hello@jrfinewood.com directly.';
    });
  }
})();
