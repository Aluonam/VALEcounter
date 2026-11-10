// Lógica del juego. Se ejecuta en el navegador del anfitrión (pantalla ?host).
// Sin dependencias, para poder probarla también en Node.

(function (root) {
  const ACHIEVEMENTS = {
    'primera-sangre': { title: 'Primera sangre', desc: 'El primer «vale» de la charla.' },
    metralleta: { title: 'Metralleta', desc: '3 «vales» en 10 segundos.' },
    'minuto-de-oro': { title: 'Minuto de oro', desc: '5 «vales» en un minuto.' },
    decena: { title: 'Decena', desc: '10 «vales».' },
    'medio-centenar': { title: 'Medio centenar', desc: '50 «vales».' },
    centenar: { title: 'Centenar', desc: '100 «vales». Leyenda.' },
    'silencio-sepulcral': { title: 'Silencio sepulcral', desc: '2 minutos sin un solo «vale». ¡Bravo, ponente!' },
    'reflejos-felinos': { title: 'Reflejos felinos', desc: 'Primero en pulsar 5 veces.' },
    oraculo: { title: 'Oráculo', desc: 'Clavó la apuesta exacta.' },
  };

  // maxMs: duración máxima de la charla (2 h 10 min); al llegar se cierra sola.
  const DEFAULTS = { consensus: 2, windowMs: 2000, cooldownMs: 900, silenceMs: 120000, maxMs: 130 * 60000 };

  class Game {
    constructor(opts = {}) {
      this.cfg = { ...DEFAULTS, ...(opts.config || {}) };
      this.now = opts.now || (() => Date.now());
      this.onEvent = opts.onEvent || (() => {});
      this.onChange = opts.onChange || (() => {});
      this.state = opts.state || this._fresh({});
      this.pending = [];
      this.lastValeAt = 0;
      this.silenceAwarded = false;
    }

    _fresh(prevUsers) {
      const users = {};
      for (const u of Object.values(prevUsers)) users[u.id] = { ...u, bet: null, firsts: 0, taps: 0 };
      return {
        phase: 'lobby', // lobby | live | finished
        speaker: '',
        startedAt: null,
        finishedAt: null,
        users,
        vales: [],
        achievements: [],
        report: null,
        config: { consensus: this.cfg.consensus, windowMs: this.cfg.windowMs, maxMs: this.cfg.maxMs },
      };
    }

    publicState() {
      const t = this.now();
      return { ...this.state, pendingCount: this.pending.filter((p) => t - p.t <= this.cfg.windowMs).length };
    }

    _changed() {
      this.onChange(this.publicState());
    }

    // ---- acciones ----

    join(id, name) {
      id = String(id || '').slice(0, 40);
      if (!id) return;
      name = String(name || '').trim().slice(0, 24) || 'Anónimo';
      const u = this.state.users[id] || { id, name, bet: null, firsts: 0, taps: 0 };
      u.name = name;
      u.online = true;
      this.state.users[id] = u;
      this._changed();
    }

    setOnline(id, online) {
      if (this.state.users[id]) {
        this.state.users[id].online = online;
        this._changed();
      }
    }

    bet(id, n) {
      const u = this.state.users[id];
      if (!u || this.state.phase !== 'lobby') return;
      n = parseInt(n, 10);
      u.bet = Number.isInteger(n) && n >= 0 ? Math.min(n, 9999) : null;
      this._changed();
    }

    start(speaker) {
      if (this.state.phase === 'finished') this.state = this._fresh(this.state.users);
      if (this.state.phase !== 'lobby') return;
      this.state.phase = 'live';
      this.state.speaker = String(speaker || '').trim().slice(0, 60) || 'Ponente misterioso';
      this.state.startedAt = this.now();
      this.pending = [];
      this.lastValeAt = 0;
      this.silenceAwarded = false;
      this._changed();
    }

    tap(id) {
      const s = this.state;
      const user = s.users[id];
      if (s.phase !== 'live' || !user) return;
      const t = this.now();
      if (t - s.startedAt >= this.cfg.maxMs) return this.tick();
      user.taps++;

      // Rezagado de un vale que ya se contó.
      if (t - this.lastValeAt < this.cfg.cooldownMs) return this._changed();

      this.pending = this.pending.filter((p) => t - p.t <= this.cfg.windowMs);
      if (this.pending.some((p) => p.userId === id)) return this._changed();
      this.pending.push({ userId: id, t });

      if (this.pending.length >= this.cfg.consensus) {
        const by = this.pending.map((p) => p.userId);
        const first = by[0];
        this.pending = [];
        this.lastValeAt = t;
        this.silenceAwarded = false;
        s.vales.push({ t, first, by });
        s.users[first].firsts++;
        this.onEvent({ kind: 'vale', n: s.vales.length, first: s.users[first].name, by: by.map((u) => s.users[u].name) });
        this._checkAchievements(first);
      } else {
        this.onEvent({ kind: 'heard', user: user.name, userId: id, need: this.cfg.consensus - this.pending.length, windowMs: this.cfg.windowMs });
      }
      this._changed();
    }

    // Llamar periódicamente (p. ej. cada 5 s) para el logro de silencio.
    tick() {
      const s = this.state;
      if (s.phase !== 'live') return;
      if (this.now() - s.startedAt >= this.cfg.maxMs) {
        this.onEvent({ kind: 'timeout', maxMs: this.cfg.maxMs });
        return this.finish();
      }
      if (this.silenceAwarded) return;
      const since = s.vales.length ? s.vales[s.vales.length - 1].t : s.startedAt;
      if (this.now() - since >= this.cfg.silenceMs) {
        this.silenceAwarded = true;
        this._unlock('silencio-sepulcral');
        this._changed();
      }
    }

    finish() {
      const s = this.state;
      if (s.phase !== 'live') return;
      s.phase = 'finished';
      s.finishedAt = Math.min(this.now(), s.startedAt + this.cfg.maxMs);
      s.report = this._report();
      for (const w of s.report.betWinners) if (w.diff === 0) this._unlock('oraculo', w.id);
      s.report.achievements = s.achievements.slice();
      this._changed();
      return s.report;
    }

    reset() {
      this.state = this._fresh(this.state.users);
      this.pending = [];
      this._changed();
    }

    // ---- interno ----

    _unlock(key, userId = null) {
      const id = userId ? `${key}:${userId}` : key;
      if (this.state.achievements.some((a) => a.id === id)) return;
      const def = ACHIEVEMENTS[key];
      const a = { id, key, title: def.title, desc: def.desc, t: this.now(), user: userId ? this.state.users[userId]?.name || null : null };
      this.state.achievements.push(a);
      this.onEvent({ kind: 'achievement', achievement: a });
    }

    _checkAchievements(firstId) {
      const s = this.state;
      const n = s.vales.length;
      const t = this.now();
      const inLast = (ms) => s.vales.filter((v) => t - v.t <= ms).length;
      if (n === 1) this._unlock('primera-sangre');
      if (n === 10) this._unlock('decena');
      if (n === 50) this._unlock('medio-centenar');
      if (n === 100) this._unlock('centenar');
      if (inLast(10000) >= 3) this._unlock('metralleta');
      if (inLast(60000) >= 5) this._unlock('minuto-de-oro');
      if (s.users[firstId].firsts >= 5) this._unlock('reflejos-felinos', firstId);
    }

    _report() {
      const s = this.state;
      const total = s.vales.length;
      const durationMs = s.finishedAt - s.startedAt;
      const bins = perMinute(s.vales, s.startedAt, s.finishedAt);
      let peak = { minute: 0, count: 0 };
      bins.forEach((c, i) => { if (c > peak.count) peak = { minute: i + 1, count: c }; });

      const bettors = Object.values(s.users).filter((u) => Number.isInteger(u.bet));
      let betWinners = [];
      if (bettors.length) {
        const ranked = bettors.map((u) => ({ id: u.id, name: u.name, bet: u.bet, diff: Math.abs(u.bet - total) })).sort((a, b) => a.diff - b.diff);
        betWinners = ranked.filter((r) => r.diff === ranked[0].diff);
      }

      const podium = Object.values(s.users)
        .filter((u) => u.firsts > 0)
        .sort((a, b) => b.firsts - a.firsts || b.taps - a.taps)
        .slice(0, 3)
        .map((u) => ({ name: u.name, firsts: u.firsts, taps: u.taps }));

      return {
        speaker: s.speaker,
        date: new Date(s.startedAt).toISOString(),
        total,
        durationMs,
        secondsPerVale: total ? Math.round(durationMs / 1000 / total) : null,
        peak,
        perMinute: bins,
        bets: bettors.map((u) => ({ name: u.name, bet: u.bet })),
        betWinners,
        podium,
        achievements: [],
      };
    }
  }

  function perMinute(vales, startedAt, endAt) {
    const minutes = Math.max(1, Math.ceil((endAt - startedAt) / 60000));
    const bins = new Array(minutes).fill(0);
    for (const v of vales) bins[Math.min(minutes - 1, Math.max(0, Math.floor((v.t - startedAt) / 60000)))]++;
    return bins;
  }

  const api = { Game, perMinute, ACHIEVEMENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ValeGame = api;
})(typeof window !== 'undefined' ? window : globalThis);
