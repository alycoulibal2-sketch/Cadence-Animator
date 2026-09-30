// Countdown to Cadence AI + subscriptions: 10 Oct 2026, 00:00 UAE = 20:00 UTC on the 9th.
// Without JS the band still reads "Launching 10 October".
(function () {
  var box = document.getElementById('launch');
  var count = document.getElementById('launch-count');
  if (!box || !count) return;
  var target = Date.parse(box.getAttribute('data-launch'));
  if (isNaN(target)) return;
  var cells = {};
  ['d', 'h', 'm', 's'].forEach(function (u) { cells[u] = count.querySelector('[data-u="' + u + '"]'); });
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function tick() {
    var left = Math.floor((target - Date.now()) / 1000);
    if (left <= 0) {
      document.getElementById('launch-badge').textContent = 'Launching today';
      count.hidden = true;
      return false;
    }
    cells.d.textContent = Math.floor(left / 86400);
    cells.h.textContent = pad(Math.floor(left % 86400 / 3600));
    cells.m.textContent = pad(Math.floor(left % 3600 / 60));
    cells.s.textContent = pad(left % 60);
    return true;
  }
  if (!tick()) return;
  var t = setInterval(function () { if (!tick()) clearInterval(t); }, 1000);
})();
