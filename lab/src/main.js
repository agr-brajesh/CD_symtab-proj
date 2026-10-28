/* main.js - tab navigation, theme, engine switch, bridge detection */
(function () {
'use strict';
let saved = null; try { saved = localStorage.getItem('symlab-theme'); } catch (e) { /* ignore */ }
document.documentElement.dataset.theme = saved || (matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
$('#themeBtn').addEventListener('click', () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
function show(tab) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + tab));
  try { history.replaceState(null, '', '#' + tab); } catch (e) { /* file:// in some browsers */ }
  App.charts.forEach(c => c.chart && c.chart.resize());
}
App.show = show;
$$('.tab').forEach(t => t.addEventListener('click', () => show(t.dataset.tab)));
const start = (location.hash || '').slice(1); if (['home', 'viz', 'bench', 'comp', 'hash', 'tests', 'guide'].includes(start)) show(start);
})();
