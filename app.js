// vale-counter — cliente.
// Sala de grupo: quien la crea juega como uno más, pero su navegador guarda el
// estado y reparte las actualizaciones vía PeerJS (WebRTC). No hay backend.

(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const PEER_PREFIX = 'valecounter-v1-';
  const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^[A-Z0-9]{4}$/;
  const AVATAR_COLORS = ['#7b2ff7', '#ff4fa3', '#ff7a1a', '#00b894', '#4cc9f0', '#e0a800', '#ff4d5e', '#3d5afe'];
  const VALE_WORDS = ['¡VALE!', '¿Vale? ¡VALE!', '¡Otro más!', 'Vale, vale…', '¡Valeeee!', '¡Toma vale!', '¡Cazado!', '¡Pillado!'];
  const ACH_ICONS = {
    'primera-sangre': '🩸', metralleta: '🔫', 'minuto-de-oro': '🥇', decena: '🔟', 'medio-centenar': '🎖️',
    centenar: '💯', 'silencio-sepulcral': '🤫', 'reflejos-felinos': '🐱', oraculo: '🔮',
  };

  const params = new URLSearchParams(location.search);
  const rawRoom = params.get('room');
  const room = normalizeCode(rawRoom || '');

  let myId = localStorage.getItem('vale-id');
  if (!myId) {
    myId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('vale-id', myId);
  }
  let myName = localStorage.getItem('vale-name') || '';
  let state = null;
  let lastCount = null;
  let send = () => {};
  let isHost = false;
  let currentScreen = null;

  // ---------- Inicio ----------
  function goLanding(message, prefill) {
    if (prefill != null) sessionStorage.setItem('vale-prefill', prefill);
    if (message) sessionStorage.setItem('vale-landing-error', message);
    location.href = location.pathname;
  }

  if (rawRoom === null) {
    showLanding();
    return;
  }
  if (!CODE_RE.test(room)) {
    showLanding(
      rawRoom.trim()
        ? `El enlace trae un código raro («${rawRoom.slice(0, 12)}»). Los códigos son 4 letras o números, por ejemplo K7PX.`
        : 'Este enlace no trae código de sala. Pídeselo a quien creó la sala o escanea su QR 📷'
    );
    return;
  }

  function showLanding(error) {
    show('landing');
    const input = $('#room-input');
    const err = $('#room-error');
    const prefill = sessionStorage.getItem('vale-prefill');
    const storedErr = sessionStorage.getItem('vale-landing-error');
    sessionStorage.removeItem('vale-prefill');
    sessionStorage.removeItem('vale-landing-error');
    if (prefill) input.value = prefill;
    if (error || storedErr) fieldError(input, err, error || storedErr);
    input.addEventListener('input', () => clearFieldError(input, err));

    $('#room-form').onsubmit = (e) => {
      e.preventDefault();
      const raw = input.value.trim();
      const code = normalizeCode(raw);
      if (!raw) return fieldError(input, err, 'Necesitas un código para entrar. Pídeselo a quien creó la sala o escanea su QR 📷');
      if (!CODE_RE.test(code)) return fieldError(input, err, `«${raw}» no es un código válido. Son 4 letras o números, por ejemplo K7PX.`);
      location.search = `?room=${code}`;
    };
    $('#create').onclick = () => {
      const code = Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
      localStorage.setItem('vale-hosting', code);
      location.search = `?room=${code}`;
    };
  }

  function normalizeCode(s) {
    return String(s).toUpperCase().replace(/[\s\-_.]/g, '').slice(0, 8);
  }

  // ---------- Sala ----------
  const joinUrl = `${location.origin}${location.pathname}?room=${room}`;
  for (const img of $$('.qr')) img.src = `https://api.qrserver.com/v1/create-qr-code/?size=264x264&margin=10&data=${encodeURIComponent(joinUrl)}`;
  for (const el of $$('.room-code')) el.textContent = room;
  for (const b of $$('.copy-link')) b.onclick = () => copy(joinUrl, '🔗', 'Enlace copiado', 'Pásalo por el chat del equipo.');
  $('#room-chip').textContent = `🔑 ${room}`;
  $('#room-chip').classList.remove('hidden');
  $('#room-chip').onclick = () => $('#invite-dialog').showModal();

  if (localStorage.getItem('vale-hosting') === room) startHost();
  else startPlayer();

  function setConn(ok, label) {
    $('#conn').classList.toggle('ok', ok);
    $('#conn').title = label;
  }
  function banner(text, bad = false) {
    const b = $('#banner');
    b.textContent = text || '';
    b.classList.toggle('bad', bad);
    b.classList.toggle('hidden', !text);
  }
  function connecting(title, text = '') {
    $('#connecting-title').textContent = title;
    $('#connecting-text').textContent = text;
    show('connecting');
  }
  function showError(kind) {
    const E = {
      notfound: ['🤔', `No existe la sala ${room}`, 'Revisa el código o pide el QR a quien creó la sala. Si la acaban de crear, espera unos segundos y reintenta.'],
      closed: ['🚪', `La sala ${room} se ha cerrado`, 'Quien la creó ha cerrado su pestaña o se ha quedado sin conexión. Pedidle que la vuelva a abrir y reintentad.'],
      nat: ['📡', 'Encontré la sala pero no consigo conectar', 'Algunas redes bloquean la conexión directa entre móviles. Probad todos en la misma wifi y reintentad.'],
      server: ['🔌', 'Sin conexión', 'No consigo hablar con el servidor de salas. Revisa tu conexión a internet y reintenta.'],
      browser: ['🧓', 'Navegador no compatible', 'Este navegador no soporta conexiones en tiempo real. Prueba con Chrome, Safari o Firefox actualizados.'],
    }[kind];
    $('#err-emoji').textContent = E[0];
    $('#err-title').textContent = E[1];
    $('#err-text').textContent = E[2];
    banner('');
    setConn(false, E[1]);
    show('error');
  }
  $('#err-retry').onclick = () => location.reload();
  $('#err-other').onclick = () => goLanding(null, room);

  // --- Quien crea la sala: guarda el estado y reparte ---
  function startHost(retry = 0) {
    isHost = true;
    connecting('Abriendo la sala…', `Código ${room}`);
    const storeKey = `vale-host-${room}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storeKey)); } catch {}
    if (saved) for (const u of Object.values(saved.users || {})) u.online = u.id === myId;

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

    const me = { userId: myId };
    send = (msg) => handle(me, msg);
    function handle(conn, msg) {
      switch (msg.type) {
        case 'join': conn.userId = msg.id; game.join(msg.id, msg.name); break;
        case 'bet': game.bet(conn.userId, msg.n); break;
        case 'tap': game.tap(conn.userId); break;
        case 'start': game.start(msg.speaker); break;
        case 'finish': game.finish(); break;
        case 'reset': game.reset(); break;
      }
    }

    window.addEventListener('beforeunload', (e) => {
      if (state && state.phase !== 'finished' && Object.keys(state.users).length > 1) { e.preventDefault(); e.returnValue = ''; }
    });

    const peer = new Peer(PEER_PREFIX + room);
    peer.on('open', () => {
      setConn(true, 'Sala abierta');
      banner('');
      if (myName) game.join(myId, myName);
      render(game.publicState());
    });
    peer.on('connection', (conn) => {
      conns.add(conn);
      conn.on('open', () => conn.send({ type: 'state', state: game.publicState() }));
      conn.on('data', (msg) => handle(conn, msg));
      conn.on('close', () => {
        conns.delete(conn);
        if (conn.userId && ![...conns].some((c) => c.userId === conn.userId)) game.setOnline(conn.userId, false);
      });
    });
    peer.on('disconnected', () => {
      setConn(false, 'Reconectando…');
      banner('Se ha cortado la conexión con el servidor de salas. Reconectando…');
      setTimeout(() => !peer.destroyed && peer.reconnect(), 2000);
    });
    peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        peer.destroy();
        // Tras recargar, el servidor tarda unos segundos en liberar el código.
        if (retry < 4) {
          connecting('Abriendo la sala…', 'Recuperando tu sala, un momento…');
          setTimeout(() => startHost(retry + 1), 2500);
        } else {
          // Otra pestaña o dispositivo ya la tiene abierta: entra como uno más.
          isHost = false;
          startPlayer();
        }
      } else if (err.type === 'browser-incompatible') showError('browser');
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        setConn(false, 'Sin conexión');
        if (state) banner('Sin conexión con el servidor de salas. Reintentando…', true);
        else showError('server');
      }
    });
  }

  // --- Resto de personas ---
  function startPlayer() {
    connecting(`Buscando la sala ${room}…`);
    let conn = null;
    let everConnected = false;
    let misses = 0;
    let openTimer = null;
    const outbox = [];
    send = (msg) => (conn && conn.open ? conn.send(msg) : outbox.push(msg));

    // PeerJS solo avisa una vez de «peer-unavailable» por cliente: cada reintento usa uno nuevo.
    let peer = null;
    function makePeer() {
      if (peer) peer.destroy();
      const pr = (peer = new Peer());
      pr.on('open', dial);
      pr.on('disconnected', () => setTimeout(() => pr === peer && !pr.destroyed && pr.reconnect(), 2000));
      pr.on('error', onPeerError);
    }
    makePeer();
    function onPeerError(err) {
      if (err.type === 'peer-unavailable') {
        clearTimeout(openTimer);
        misses++;
        if (!everConnected && misses >= 2) return showError('notfound');
        if (everConnected && misses >= 10) return showError('closed');
        if (everConnected) banner('Se ha perdido la conexión con la sala. Reconectando…', true);
        else connecting(`Buscando la sala ${room}…`, 'Todavía no la encuentro, sigo intentándolo.');
        setTimeout(makePeer, 2500);
      } else if (err.type === 'browser-incompatible') showError('browser');
      else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        setConn(false, 'Sin conexión');
        if (everConnected) banner('Sin conexión a internet. Reintentando…', true);
        else showError('server');
      }
    }

    function dial() {
      if (peer.destroyed || peer.disconnected) return setTimeout(dial, 1500);
      if (conn) { conn.removeAllListeners(); conn.close(); }
      const c = (conn = peer.connect(PEER_PREFIX + room, { reliable: true, serialization: 'json' }));
      clearTimeout(openTimer);
      // El servidor solo avisa una vez de que una sala no existe: si ya avisó y el
      // reintento no responde, la sala no está. Si nunca avisó, es la red.
      openTimer = setTimeout(() => {
        if (c.open) return;
        if (!everConnected) return showError(misses > 0 ? 'notfound' : 'nat');
        onPeerError({ type: 'peer-unavailable' });
      }, misses > 0 ? 6000 : 15000);
      c.on('open', () => {
        clearTimeout(openTimer);
        everConnected = true;
        misses = 0;
        setConn(true, 'Conectado');
        banner('');
        if (myName) c.send({ type: 'join', id: myId, name: myName });
        while (outbox.length) c.send(outbox.shift());
      });
      c.on('data', (msg) => {
        if (msg.type === 'state') render(msg.state);
        if (msg.type === 'event') onEvent(msg.event);
      });
      c.on('close', () => {
        if (c !== conn) return;
        setConn(false, 'Reconectando…');
        banner('Se ha perdido la conexión con la sala. Reconectando…', true);
        setTimeout(dial, 1500);
      });
    }
  }

  // ---------- Formularios ----------
  $('#name').value = myName;
  $('#name').addEventListener('input', () => clearFieldError($('#name'), $('#name-error')));
  $('#join-form').onsubmit = (e) => {
    e.preventDefault();
    const name = $('#name').value.trim().slice(0, 24);
    if (!name) return fieldError($('#name'), $('#name-error'), 'Pon un nombre (o un mote) para que sepamos quién caza más «vales» 😄');
    const taken = state && Object.values(state.users).some((u) => u.id !== myId && u.name.toLowerCase() === name.toLowerCase());
    if (taken) return fieldError($('#name'), $('#name-error'), `Ya hay alguien llamado «${name}». Añade una inicial o un mote.`);
    myName = name;
    localStorage.setItem('vale-name', myName);
    send({ type: 'join', id: myId, name: myName });
  };

  $('#bet').addEventListener('input', () => clearFieldError($('#bet'), $('#bet-error')));
  $('#bet-form').onsubmit = (e) => {
    e.preventDefault();
    const raw = $('#bet').value.trim();
    const n = Number(raw);
    if (!raw) return fieldError($('#bet'), $('#bet-error'), 'Escribe un número antes de apostar 🎲');
    if (!Number.isInteger(n) || n < 0 || n > 999) return fieldError($('#bet'), $('#bet-error'), 'La apuesta tiene que ser un número entero entre 0 y 999.');
    send({ type: 'bet', n });
    toastMsg('🎲', `Apuesta: ${n}`, 'Puedes cambiarla hasta que empiece la charla.');
  };

  $('#speaker-input').addEventListener('input', () => clearFieldError($('#speaker-input'), $('#start-error')));
  $('#start-form').onsubmit = (e) => {
    e.preventDefault();
    const sp = $('#speaker-input').value.trim();
    if (!sp) return fieldError($('#speaker-input'), $('#start-error'), '¿Quién va a hablar? Escribe su nombre para el informe 🎤');
    send({ type: 'start', speaker: sp });
  };

  $('#finish').onclick = () => { if (confirm('¿Terminar la charla y ver el informe?')) send({ type: 'finish' }); };
  $('#reset').onclick = () => send({ type: 'reset' });
  $('#copy').onclick = () => state?.report && copy(reportMarkdown(state.report), '📋', 'Informe copiado', 'Pégalo en el chat del equipo.');

  const tap = () => {
    if (!state || state.phase !== 'live' || !state.users[myId]) return;
    send({ type: 'tap' });
    if (navigator.vibrate) navigator.vibrate(30);
    const b = $('#tap');
    b.classList.add('pressed');
    setTimeout(() => b.classList.remove('pressed'), 120);
  };
  $('#tap').addEventListener('pointerdown', (e) => { e.preventDefault(); tap(); });
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !['INPUT', 'BUTTON'].includes(document.activeElement.tagName)) { e.preventDefault(); tap(); }
  });

  function fieldError(input, el, text) {
    el.textContent = text;
    el.classList.remove('hidden');
    input.classList.remove('invalid');
    void input.offsetWidth;
    input.classList.add('invalid');
    input.focus();
  }
  function clearFieldError(input, el) {
    input.classList.remove('invalid');
    el.classList.add('hidden');
  }

  // ---------- Render ----------
  function show(name) {
    if (name === currentScreen) return;
    currentScreen = name;
    for (const s of $$('.screen')) s.classList.toggle('hidden', s.id !== `screen-${name}`);
    window.scrollTo(0, 0);
  }

  function avatar(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `<span class="avatar" style="background:${AVATAR_COLORS[h % AVATAR_COLORS.length]}">${esc(name.slice(0, 1).toUpperCase())}</span>`;
  }
  const who = (u) => `<span class="who">${avatar(u.name)}${esc(u.name)}</span>`;

  function render(st) {
    state = st;
    const users = Object.values(st.users);
    const me = st.users[myId];
    $('#speaker').textContent = st.speaker && st.phase !== 'lobby' ? `🎤 ${st.speaker}` : '';
    $('#online').textContent = users.filter((u) => u.online).length;

    if (!myName || !me) {
      show('join');
      if (!$('#name').value) $('#name').focus();
      return;
    }

    if (st.phase === 'lobby') {
      show('lobby');
      $('#host-note').classList.toggle('hidden', !isHost);
      const list = users.slice().sort((a, b) => a.name.localeCompare(b.name));
      $('#bets').innerHTML = list
        .map((u) => `<li class="${u.id === myId ? 'you' : ''} ${u.online ? '' : 'offline'}">${who(u)}<span class="tag ${u.bet == null ? '' : 'done'}">${u.bet == null ? 'pensando… 🤔' : 'apostado ✓'}</span></li>`)
        .join('');
      $('#my-bet').textContent = me.bet != null ? `Tu apuesta: ${me.bet} «vales» 🤞` : '';
      lastCount = null;
    }

    if (st.phase === 'live') {
      show('live');
      const n = st.vales.length;
      const c = $('#count');
      c.textContent = n;
      if (lastCount !== null && n > lastCount) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      lastCount = n;

      const recent = st.vales.filter((v) => Date.now() - v.t <= 10000).length;
      $('#streak').classList.toggle('hidden', recent < 2);
      $('#streak').textContent = `🔥 ¡${recent} en 10 s!`;

      renderStickers($('#achievements'), st.achievements, 'Aún ninguno. ¡A cazar «vales»!');
      const rank = users.filter((u) => u.firsts > 0).sort((a, b) => b.firsts - a.firsts);
      $('#ranking').innerHTML = rank.length
        ? rank.map((u) => `<li class="${u.id === myId ? 'you' : ''}">${who(u)}<span class="n">${u.firsts} ⚡</span></li>`).join('')
        : '<li class="muted">Nadie ha sido el primero todavía.</li>';
      drawLive();
    }

    if (st.phase === 'finished' && st.report) {
      show('report');
      renderReport(st.report);
    }
  }

  function renderStickers(el, list, emptyText) {
    el.innerHTML = list.length
      ? list.slice().reverse().map((a) => `<li class="sticker"><div class="ico">${ACH_ICONS[a.key] || '🏆'}</div><div class="ttl">${esc(a.title)}</div>${a.user ? `<span class="usr">${esc(a.user)}</span>` : ''}<div class="dsc">${esc(a.desc)}</div></li>`).join('')
      : `<li class="empty">${emptyText}</li>`;
  }

  function renderReport(r) {
    $('#report-headline').textContent = headline(r);
    $('#r-total').textContent = r.total;
    $('#r-duration').textContent = fmtDur(r.durationMs);
    $('#r-rate').textContent = r.secondsPerVale ? `${r.secondsPerVale} s` : '—';
    $('#r-peak').textContent = r.peak.count ? `min ${r.peak.minute}` : '—';

    const w = r.betWinners;
    $('#r-betwinner').textContent = w.length
      ? `🏅 ${w.map((x) => x.name).join(' y ')} ${w.length > 1 ? 'ganan' : 'gana'}: apostó ${w[0].bet} ${w[0].diff === 0 ? '¡y la clavó! 🔮' : `y se quedó a ${w[0].diff}`}`
      : 'Nadie apostó esta vez 🤷';
    $('#r-bets').innerHTML = r.bets
      .slice().sort((a, b) => Math.abs(a.bet - r.total) - Math.abs(b.bet - r.total))
      .map((b) => { const d = b.bet - r.total; return `<li>${who(b)}<span class="n">${b.bet} <span class="muted">(${d >= 0 ? '+' : ''}${d})</span></span></li>`; })
      .join('');
    $('#r-podium').innerHTML = r.podium.length
      ? r.podium.map((p, i) => `<li>${who(p)}<span class="n">${['🥇', '🥈', '🥉'][i]} ${p.firsts} ${p.firsts === 1 ? 'vez' : 'veces'} primero</span></li>`).join('')
      : '<li class="muted">Sin datos.</li>';
    renderStickers($('#r-achievements'), r.achievements, 'Ningún logro esta vez.');
    drawChart($('#chart-report'), $('#tooltip-report'), r.perMinute);
  }

  function headline(r) {
    if (!r.total) return `${r.speaker} no dijo ni un solo «vale». ¡Leyenda! 👏`;
    return `${r.speaker} dijo «vale» ${r.total} ${r.total === 1 ? 'vez' : 'veces'}: uno cada ${r.secondsPerVale} segundos.`;
  }

  function reportMarkdown(r) {
    return [
      `## 🎤 ${r.speaker} · ${new Date(r.date).toLocaleDateString('es-ES')}`,
      '',
      `**${headline(r)}**`,
      '',
      '| Total | Duración | Un vale cada | Minuto más intenso |',
      '|---|---|---|---|',
      `| ${r.total} | ${fmtDur(r.durationMs)} | ${r.secondsPerVale ?? '—'} s | ${r.peak.count ? `min ${r.peak.minute} (${r.peak.count})` : '—'} |`,
      '',
      `**🎯 Apuesta ganadora:** ${r.betWinners.length ? r.betWinners.map((w) => `${w.name} (${w.bet})`).join(', ') : 'nadie apostó'}`,
      `**⚡ Podio de reflejos:** ${r.podium.map((p, i) => `${['🥇', '🥈', '🥉'][i]} ${p.name} (${p.firsts})`).join(' · ') || '—'}`,
      `**🏆 Logros:** ${r.achievements.map((a) => `${ACH_ICONS[a.key] || '🏆'} ${a.title}${a.user ? ` (${a.user})` : ''}`).join(' · ') || '—'}`,
      `**📊 Vales por minuto:** ${r.perMinute.join(' ')}`,
    ].join('\n');
  }

  // ---------- Eventos ----------
  let heardTimer = null;
  function onEvent(ev) {
    if (ev.kind === 'vale') {
      beep(660, 0.12); setTimeout(() => beep(990, 0.18), 90);
      confetti(ev.n % 10 === 0 ? 220 : 70);
      popWord(ev.n % 10 === 0 ? `¡${ev.n} VALES!` : VALE_WORDS[Math.floor(Math.random() * VALE_WORDS.length)]);
      $('#heard').classList.add('hidden');
    }
    if (ev.kind === 'heard') {
      const el = $('#heard');
      el.classList.remove('hidden');
      el.querySelector('.heard-text').textContent =
        ev.userId === myId ? `👂 ¡Lo has oído! Falta ${ev.need} persona más para confirmarlo…` : `👂 ${ev.user} ha oído un «vale»… ¿lo confirmas? ¡PULSA!`;
      const bar = el.querySelector('.heard-bar i');
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = `shrink ${ev.windowMs}ms linear forwards`;
      clearTimeout(heardTimer);
      heardTimer = setTimeout(() => el.classList.add('hidden'), ev.windowMs);
    }
    if (ev.kind === 'achievement') {
      const a = ev.achievement;
      toastMsg(ACH_ICONS[a.key] || '🏆', `${a.title}${a.user ? ` · ${a.user}` : ''}`, a.desc);
      setTimeout(() => { beep(784, 0.1); setTimeout(() => beep(1046, 0.1), 100); setTimeout(() => beep(1318, 0.2), 200); }, 250);
    }
  }

  function popWord(text) {
    const p = $('#pop');
    p.textContent = text;
    p.style.background = AVATAR_COLORS[Math.floor(Math.random() * 4)];
    p.classList.remove('show');
    void p.offsetWidth;
    p.classList.add('show');
  }

  function toastMsg(ico, title, text) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<span class="ico">${ico}</span><div><b>${esc(title)}</b><small>${esc(text)}</small></div>`;
    const box = $('#toasts');
    box.appendChild(t);
    while (box.children.length > 2) box.firstElementChild.remove();
    setTimeout(() => t.remove(), 4500);
  }

  async function copy(text, ico, title, sub) {
    try { await navigator.clipboard.writeText(text); toastMsg(ico, title, sub); }
    catch { prompt('Copia esto:', text); }
  }

  let audio;
  function beep(freq, dur = 0.2) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'triangle';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.18, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + dur);
      o.connect(g).connect(audio.destination);
      o.start();
      o.stop(audio.currentTime + dur);
    } catch {}
  }

  // ---------- Confetti ----------
  const cv = $('#confetti');
  const cx = cv.getContext('2d');
  let parts = [];
  const CONFETTI = ['#7b2ff7', '#ff4fa3', '#ff7a1a', '#00b894', '#4cc9f0', '#ffd23f'];
  function confetti(n) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    cv.width = innerWidth; cv.height = innerHeight;
    const running = parts.length > 0;
    for (let i = 0; i < n; i++) {
      parts.push({ x: innerWidth / 2, y: innerHeight / 3, vx: (Math.random() - 0.5) * 16, vy: Math.random() * -14 - 3, r: Math.random() * 8 + 4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4, c: CONFETTI[i % CONFETTI.length], life: 100 });
    }
    if (!running) requestAnimationFrame(stepConfetti);
  }
  function stepConfetti() {
    cx.clearRect(0, 0, cv.width, cv.height);
    parts = parts.filter((p) => p.life-- > 0);
    for (const p of parts) {
      p.vy += 0.38; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.rot);
      cx.fillStyle = p.c; cx.globalAlpha = Math.min(1, p.life / 30);
      cx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      cx.restore();
    }
    if (parts.length) requestAnimationFrame(stepConfetti);
    else cx.clearRect(0, 0, cv.width, cv.height);
  }

  // ---------- Gráfica de barras por minuto ----------
  function drawLive() {
    if (!state || state.phase !== 'live') return;
    drawChart($('#chart'), $('#tooltip'), ValeGame.perMinute(state.vales, state.startedAt, Date.now()));
    $('#timer').textContent = `⏱ ${fmtDur(Date.now() - state.startedAt)}`;
  }
  setInterval(drawLive, 1000);

  function drawChart(canvas, tip, bins) {
    const css = getComputedStyle(document.documentElement);
    const bar = css.getPropertyValue('--chart-bar').trim();
    const grid = css.getPropertyValue('--chart-grid').trim();
    const ink = css.getPropertyValue('--ink-soft').trim();
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = 160;
    if (!W) return;
    canvas.width = W * dpr; canvas.height = H * dpr;
    const g = canvas.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);

    const padL = 28, padB = 22, padT = 10;
    const max = Math.max(3, ...bins);
    const step = max <= 5 ? 1 : Math.ceil(max / 4);
    const plotH = H - padB - padT, plotW = W - padL - 4;
    const y = (v) => padT + plotH - (v / max) * plotH;

    g.font = '600 12px Fredoka, system-ui, sans-serif';
    g.strokeStyle = grid; g.lineWidth = 1; g.fillStyle = ink;
    for (let v = 0; v <= max; v += step) {
      g.beginPath(); g.moveTo(padL, Math.round(y(v)) + 0.5); g.lineTo(W - 4, Math.round(y(v)) + 0.5); g.stroke();
      g.textAlign = 'right'; g.fillText(v, padL - 6, y(v) + 4);
    }

    const shown = bins.slice(-30);
    const offset = bins.length - shown.length;
    const slot = plotW / Math.max(shown.length, 10);
    const bw = Math.max(4, Math.min(36, slot - 4));
    const bars = [];
    shown.forEach((v, i) => {
      const x = padL + i * slot + (slot - bw) / 2;
      const top = y(v), base = padT + plotH, h = base - top;
      if (v > 0) {
        const r = Math.min(6, bw / 2, h);
        g.fillStyle = bar;
        g.beginPath();
        g.moveTo(x, base); g.lineTo(x, top + r);
        g.quadraticCurveTo(x, top, x + r, top); g.lineTo(x + bw - r, top);
        g.quadraticCurveTo(x + bw, top, x + bw, top + r); g.lineTo(x + bw, base);
        g.fill();
      }
      const minute = offset + i + 1;
      if (shown.length <= 12 || minute % 5 === 0 || i === 0) {
        g.fillStyle = ink; g.textAlign = 'center'; g.fillText(minute, x + bw / 2, H - 5);
      }
      bars.push({ x: padL + i * slot, w: slot, v, minute, top });
    });

    canvas.onpointermove = (e) => {
      const px = e.clientX - canvas.getBoundingClientRect().left;
      const b = bars.find((b) => px >= b.x && px < b.x + b.w);
      if (!b) return tip.classList.add('hidden');
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
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
})();
