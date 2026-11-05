// vale-counter — cliente.
// El anfitrión (?host&room=XXXX) ejecuta el juego y hace de servidor vía PeerJS (WebRTC).
// Los asistentes (?room=XXXX) se conectan a él. No hace falta backend.

(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  const IS_HOST = params.has('host');
  let room = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const PEER_PREFIX = 'valecounter-v1-';

  let state = null;
  let myId = localStorage.getItem('vale-id');
  if (!myId) {
    myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('vale-id', myId);
  }
  let myName = localStorage.getItem('vale-name') || '';
  let lastCount = 0;
  let send = () => {};

  // ---------- Pantalla de inicio (sin sala) ----------
  if (!room) {
    show('landing');
    $('#create').onclick = () => {
      const code = randomRoom();
      location.search = `?host&room=${code}`;
    };
    $('#room-form').onsubmit = (e) => {
      e.preventDefault();
      const code = $('#room-input').value.trim().toUpperCase();
      if (code) location.search = `?room=${code}`;
    };
    return;
  }

  function randomRoom() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
  }

  const joinUrl = `${location.origin}${location.pathname}?room=${room}`;

  // ---------- Red ----------
  if (IS_HOST) startHost();
  else startPlayer();

  function setConn(ok, label) {
    $('#conn').classList.toggle('ok', ok);
    $('#conn').title = label;
  }

  function startHost() {
    document.body.classList.add('host');
    document.querySelectorAll('.host-box').forEach((d) => (d.open = true));
    $('#host-panel').classList.remove('hidden');
    $('#url').textContent = joinUrl.replace(/^https?:\/\//, '');
    $('#room-code').textContent = room;
    $('#qr').src = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(joinUrl)}`;

    const storeKey = `vale-host-${room}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey)); } catch {}
    if (saved) for (const u of Object.values(saved.users || {})) u.online = false;

    const conns = new Set();
    const broadcast = (msg) => { for (const c of conns) if (c.open) c.send(msg); };

    const game = new ValeGame.Game({
      state: saved || undefined,
      onEvent: (event) => { broadcast({ type: 'event', event }); onEvent(event); },
      onChange: (st) => {
        localStorage.setItem(storeKey, JSON.stringify(st));
        broadcast({ type: 'state', state: st });
        render(st);
      },
    });
    setInterval(() => game.tick(), 5000);

    // El anfitrión también puede manejar los botones de control.
    send = (msg) => handle(null, msg);

    function handle(conn, msg) {
      switch (msg.type) {
        case 'join': if (conn) { conn.userId = msg.id; game.join(msg.id, msg.name); } break;
        case 'bet': if (conn) game.bet(conn.userId, msg.n); break;
        case 'tap': if (conn) game.tap(conn.userId); break;
        case 'start': game.start(msg.speaker); break;
        case 'finish': {
          const report = game.finish();
          if (report) saveHistory(report);
          break;
        }
        case 'reset': game.reset(); break;
      }
    }

    let retry = 0;
    function open() {
      const peer = new Peer(PEER_PREFIX + room);
      peer.on('open', () => { retry = 0; setConn(true, 'Sala abierta'); });
      peer.on('connection', (conn) => {
        conns.add(conn);
        conn.on('open', () => conn.send({ type: 'state', state: game.publicState() }));
        conn.on('data', (msg) => handle(conn, msg));
        conn.on('close', () => {
          conns.delete(conn);
          if (conn.userId && ![...conns].some((c) => c.userId === conn.userId)) game.setOnline(conn.userId, false);
        });
      });
      peer.on('disconnected', () => { setConn(false, 'Reconectando…'); peer.reconnect(); });
      peer.on('error', (err) => {
        setConn(false, err.type);
        if (err.type === 'unavailable-id') {
          // Tras recargar, el servidor de señalización tarda unos segundos en liberar el id.
          peer.destroy();
          setTimeout(open, Math.min(10000, 2000 * ++retry));
          if (retry === 3) toast('<b>La sala ya está abierta</b> en otra pestaña o aún se está liberando. Reintentando…');
        }
      });
    }
    open();
    render(game.publicState());
  }

  function startPlayer() {
    let conn = null;
    let peer = null;
    const outbox = [];
    send = (msg) => (conn && conn.open ? conn.send(msg) : outbox.push(msg));

    function connect() {
      if (!peer || peer.destroyed) {
        peer = new Peer();
        peer.on('open', dial);
        peer.on('error', (err) => {
          setConn(false, err.type);
          if (err.type === 'peer-unavailable') {
            $('#join-hint').textContent = `No encuentro la sala ${room}. ¿Está abierta la pantalla del anfitrión? Reintentando…`;
            setTimeout(dial, 3000);
          }
        });
        peer.on('disconnected', () => peer.reconnect());
      } else dial();
    }

    function dial() {
      conn = peer.connect(PEER_PREFIX + room, { reliable: true });
      conn.on('open', () => {
        setConn(true, 'Conectado');
        $('#join-hint').textContent = '';
        if (myName) conn.send({ type: 'join', id: myId, name: myName });
        while (outbox.length) conn.send(outbox.shift());
      });
      conn.on('data', (msg) => {
        if (msg.type === 'state') render(msg.state);
        if (msg.type === 'event') onEvent(msg.event);
      });
      conn.on('close', () => { setConn(false, 'Reconectando…'); setTimeout(dial, 1500); });
    }
    connect();

    $('#join-form').onsubmit = (e) => {
      e.preventDefault();
      myName = $('#name').value.trim().slice(0, 24);
      if (!myName) return;
      localStorage.setItem('vale-name', myName);
      send({ type: 'join', id: myId, name: myName });
      if (state) render(state);
    };
    $('#name').value = myName;

    const tap = () => {
      if (!state || state.phase !== 'live') return;
      send({ type: 'tap' });
      if (navigator.vibrate) navigator.vibrate(30);
      const b = $('#tap');
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 120);
    };
    $('#tap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); tap(); }
    });

    $('#bet-form').onsubmit = (e) => {
      e.preventDefault();
      send({ type: 'bet', n: $('#bet').value });
    };
  }

  // ---------- Controles comunes ----------
  $('#start-form').onsubmit = (e) => { e.preventDefault(); send({ type: 'start', speaker: $('#speaker-input').value }); };
  $('#finish').onclick = () => { if (confirm('¿Terminar la charla y generar el informe?')) send({ type: 'finish' }); };
  $('#reset').onclick = () => send({ type: 'reset' });
  $('#copy').onclick = async () => {
    if (!state?.report) return;
    const md = reportMarkdown(state.report);
    try { await navigator.clipboard.writeText(md); toast('<b>Informe copiado</b> en Markdown.'); }
    catch { prompt('Copia el informe:', md); }
  };

  // ---------- Render ----------
  function show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== `screen-${name}`);
  }

  function render(st) {
    state = st;
    const users = Object.values(st.users);
    const me = st.users[myId];
    $('#speaker').textContent = st.speaker ? `🎤 ${st.speaker}` : '';
    $('#phase').textContent = { lobby: 'Apuestas abiertas', live: 'En directo', finished: 'Terminada' }[st.phase];
    $('#online').textContent = `👥 ${users.filter((u) => u.online).length}`;
    $('#room-chip').textContent = `Sala ${room}`;

    if (!IS_HOST && (!myName || !me)) { show('join'); return; }

    if (st.phase === 'lobby') {
      show('lobby');
      const list = users.slice().sort((a, b) => a.name.localeCompare(b.name));
      $('#bets').innerHTML = list.length
        ? list.map((u) => `<li class="${u.id === myId ? 'you' : ''} ${u.online ? '' : 'offline'}"><span>${esc(u.name)}</span><span class="n">${u.bet == null ? '—' : '🎲 apostado'}</span></li>`).join('')
        : '<li class="muted">Nadie aún. Escanead el QR.</li>';
      $('#my-bet').textContent = me && me.bet != null ? `Tu apuesta: ${me.bet}` : '';
      if (me && me.bet != null && document.activeElement !== $('#bet')) $('#bet').value = me.bet;
      lastCount = 0;
    }

    if (st.phase === 'live') {
      show('live');
      const n = st.vales.length;
      const c = $('#count');
      c.textContent = n;
      if (n !== lastCount) { c.classList.add('bump'); setTimeout(() => c.classList.remove('bump'), 160); lastCount = n; }

      const recent = st.vales.filter((v) => Date.now() - v.t <= 10000).length;
      $('#streak').classList.toggle('hidden', recent < 2);
      $('#streak').textContent = `🔥 ${recent} en 10 s`;

      renderAchievements($('#achievements'), st.achievements);
      const rank = users.filter((u) => u.firsts > 0).sort((a, b) => b.firsts - a.firsts);
      $('#ranking').innerHTML = rank.length
        ? rank.map((u) => `<li class="${u.id === myId ? 'you' : ''}"><span>${esc(u.name)}</span><span class="n">${u.firsts} ⚡</span></li>`).join('')
        : '<li class="muted">Nadie ha sido el primero aún.</li>';
      drawLive();
    }

    if (st.phase === 'finished' && st.report) {
      show('report');
      renderReport(st.report);
    }
  }

  function renderAchievements(el, list) {
    el.innerHTML = list.length
      ? list.slice().reverse().map((a) => `<li><span class="badge">🏆 ${esc(a.title)}${a.user ? ` · ${esc(a.user)}` : ''}</span><span class="desc">${esc(a.desc)}</span></li>`).join('')
      : '<li class="muted">Todavía ninguno…</li>';
  }

  function renderReport(r) {
    $('#report-headline').textContent = headline(r);
    $('#r-total').textContent = r.total;
    $('#r-duration').textContent = fmtDur(r.durationMs);
    $('#r-rate').textContent = r.secondsPerVale ? `${r.secondsPerVale} s` : '—';
    $('#r-peak').textContent = r.peak.count ? `min ${r.peak.minute}` : '—';
    $('#r-peak').title = r.peak.count ? `${r.peak.count} vales` : '';

    const winners = r.betWinners.map((w) => w.name);
    $('#r-betwinner').textContent = winners.length
      ? `🎯 ${winners.join(' y ')} ${winners.length > 1 ? 'ganan' : 'gana'} (apostó ${r.betWinners[0].bet}, ${r.betWinners[0].diff === 0 ? '¡exacto!' : `a ${r.betWinners[0].diff} de distancia`})`
      : 'Nadie apostó.';
    $('#r-bets').innerHTML = r.bets
      .slice().sort((a, b) => Math.abs(a.bet - r.total) - Math.abs(b.bet - r.total))
      .map((b) => `<li><span>${esc(b.name)}</span><span class="n">${b.bet} (${b.bet - r.total >= 0 ? '+' : ''}${b.bet - r.total})</span></li>`).join('');
    $('#r-podium').innerHTML = r.podium.length
      ? r.podium.map((p, i) => `<li><span>${['🥇', '🥈', '🥉'][i]} ${esc(p.name)}</span><span class="n">${p.firsts} veces primero</span></li>`).join('')
      : '<li class="muted">Sin datos.</li>';
    renderAchievements($('#r-achievements'), r.achievements);
    drawChart($('#chart-report'), $('#tooltip-report'), r.perMinute);
  }

  function headline(r) {
    if (!r.total) return `${r.speaker} no dijo ni un solo «vale». Increíble.`;
    return `${r.speaker} dijo «vale» ${r.total} ${r.total === 1 ? 'vez' : 'veces'}: uno cada ${r.secondsPerVale} segundos.`;
  }

  function reportMarkdown(r) {
    const lines = [
      `## 🎤 ${r.speaker} — ${new Date(r.date).toLocaleDateString('es-ES')}`,
      '',
      `**${headline(r)}**`,
      '',
      `| Total | Duración | Un vale cada | Minuto más intenso |`,
      `|---|---|---|---|`,
      `| ${r.total} | ${fmtDur(r.durationMs)} | ${r.secondsPerVale ?? '—'} s | ${r.peak.count ? `min ${r.peak.minute} (${r.peak.count})` : '—'} |`,
      '',
      `**Apuesta ganadora:** ${r.betWinners.length ? r.betWinners.map((w) => `${w.name} (${w.bet})`).join(', ') : 'nadie apostó'}`,
      '',
      `**Podio de reflejos:** ${r.podium.map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} (${p.firsts})`).join(' · ') || '—'}`,
      '',
      `**Logros:** ${r.achievements.map((a) => `🏆 ${a.title}${a.user ? ` (${a.user})` : ''}`).join(' · ') || '—'}`,
      '',
      `**Vales por minuto:** ${r.perMinute.join(' ')}`,
    ];
    return lines.join('\n');
  }

  function saveHistory(report) {
    const h = JSON.parse(localStorage.getItem('vale-history') || '[]');
    h.push(report);
    localStorage.setItem('vale-history', JSON.stringify(h));
  }

  // ---------- Eventos ----------
  let heardTimer = null;
  function onEvent(ev) {
    if (ev.kind === 'vale') {
      beep(880);
      confetti(ev.n % 10 === 0 ? 180 : 60);
      $('#heard').classList.add('hidden');
    }
    if (ev.kind === 'heard') {
      const el = $('#heard');
      el.classList.remove('hidden');
      el.querySelector('.heard-text').textContent =
        ev.userId === myId ? `Has oído un «vale»… ¡falta ${ev.need} más!` : `${ev.user} ha oído un «vale». ¿Lo confirmas?`;
      const bar = el.querySelector('.heard-bar i');
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = `shrink ${ev.windowMs}ms linear forwards`;
      clearTimeout(heardTimer);
      heardTimer = setTimeout(() => el.classList.add('hidden'), ev.windowMs);
    }
    if (ev.kind === 'achievement') {
      const a = ev.achievement;
      toast(`🏆 <b>${esc(a.title)}</b>${a.user ? ` · ${esc(a.user)}` : ''}<br><span class="muted">${esc(a.desc)}</span>`);
      beep(1320);
    }
  }

  function toast(html) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = html;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }

  let audio;
  function beep(freq) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.15, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.25);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + 0.25);
    } catch {}
  }

  // ---------- Confetti ----------
  const cv = $('#confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  const COLORS = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9'];
  function confetti(n) {
    cv.width = innerWidth; cv.height = innerHeight;
    for (let i = 0; i < n; i++) {
      parts.push({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 14, vy: Math.random() * -12 - 2, r: Math.random() * 6 + 3, c: COLORS[i % COLORS.length], life: 90 });
    }
    if (parts.length === n) requestAnimationFrame(stepConfetti);
  }
  function stepConfetti() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter((p) => p.life-- > 0);
    for (const p of parts) {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy;
      cx.fillStyle = p.c; cx.globalAlpha = Math.min(1, p.life / 30);
      cx.fillRect(p.x, p.y, p.r, p.r * 0.6);
    }
    cx.globalAlpha = 1;
    if (parts.length) requestAnimationFrame(stepConfetti);
    else cx.clearRect(0, 0, cv.width, cv.height);
  }

  // ---------- Gráfica de barras por minuto ----------
  function drawLive() {
    if (!state || state.phase !== 'live') return;
    const bins = ValeGame.perMinute(state.vales, state.startedAt, Date.now());
    drawChart($('#chart'), $('#tooltip'), bins);
    $('#timer').textContent = `⏱ ${fmtDur(Date.now() - state.startedAt)}`;
  }
  setInterval(drawLive, 1000);

  function drawChart(canvas, tip, bins) {
    const css = getComputedStyle(document.documentElement);
    const color = css.getPropertyValue('--series-1').trim();
    const grid = css.getPropertyValue('--border').trim();
    const muted = css.getPropertyValue('--text-muted').trim();
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = 160;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);

    const padL = 28, padB = 22, padT = 8;
    const max = Math.max(3, ...bins);
    const step = max <= 5 ? 1 : Math.ceil(max / 4);
    const plotH = H - padB - padT, plotW = W - padL - 4;
    const y = (v) => padT + plotH - (v / max) * plotH;

    g.font = '11px system-ui, sans-serif';
    g.fillStyle = muted; g.strokeStyle = grid; g.lineWidth = 1;
    for (let v = 0; v <= max; v += step) {
      g.beginPath(); g.moveTo(padL, Math.round(y(v)) + 0.5); g.lineTo(W - 4, Math.round(y(v)) + 0.5); g.stroke();
      g.textAlign = 'right'; g.fillText(v, padL - 6, y(v) + 4);
    }

    const shown = bins.slice(-30); // últimos 30 minutos
    const offset = bins.length - shown.length;
    const slot = plotW / Math.max(shown.length, 10);
    const bw = Math.max(4, Math.min(36, slot - 2));
    const bars = [];
    shown.forEach((v, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      const top = y(v), h = padT + plotH - top;
      if (v > 0) {
        g.fillStyle = color;
        const r = Math.min(4, bw / 2, h);
        g.beginPath();
        g.moveTo(x, padT + plotH); g.lineTo(x, top + r);
        g.quadraticCurveTo(x, top, x + r, top); g.lineTo(x + bw - r, top);
        g.quadraticCurveTo(x + bw, top, x + bw, top + r); g.lineTo(x + bw, padT + plotH);
        g.fill();
      }
      const minute = offset + i + 1;
      if (shown.length <= 12 || minute % 5 === 0 || i === 0) {
        g.fillStyle = muted; g.textAlign = 'center'; g.fillText(minute, x + bw / 2, H - 6);
      }
      bars.push({ x: padL + i * slot, w: slot, v, minute, top });
    });

    canvas.onpointermove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const b = bars.find((b) => px >= b.x && px < b.x + b.w);
      if (!b) { tip.classList.add('hidden'); return; }
      tip.classList.remove('hidden');
      tip.innerHTML = `<b>Minuto ${b.minute}</b> · ${b.v} ${b.v === 1 ? 'vale' : 'vales'}`;
      tip.style.left = `${b.x + b.w / 2}px`;
      tip.style.top = `${Math.min(b.top, padT + plotH - 4)}px`;
    };
    canvas.onpointerleave = () => tip.classList.add('hidden');
  }

  // ---------- util ----------
  function fmtDur(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
