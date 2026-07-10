/* ================================================================
   Cliente multiplayer — roda por fora do jogo, sem tocar no loop dele.
   Espera window.__MP (exposto no fim do módulo do jogo) e a partir daí:
   avatares dos outros jogadores, PVP, placar, kill feed e respawn.
   ================================================================ */
(function () {
  'use strict';

  const poll = setInterval(() => {
    if (!window.__MP) return;
    clearInterval(poll);
    if (window.__MP.socket && window.__MP_init) boot(window.__MP);
    else console.log('[MP] sem servidor — jogo segue solo');
  }, 120);

  function boot(MP) {
    const socket = MP.socket;
    const THREE = MP.THREE;
    const myId = window.__MP_init.id;

    /* ---------- nick: ?nick=Fulano na URL > salvo > prompt > aleatório ---------- */
    let nick = (new URLSearchParams(location.search).get('nick')
      || localStorage.getItem('mp_nick') || '').trim().slice(0, 14);
    if (!nick) {
      let typed = null;
      try { typed = prompt('Seu nick pra sessão online:'); } catch (e) { /* ambiente sem prompt */ }
      nick = (typed || '').trim().slice(0, 14) || 'Recruta' + (100 + Math.floor(Math.random() * 900));
    }
    try { localStorage.setItem('mp_nick', nick); } catch (e) {}
    socket.emit('hello', { nick });

    const esc = s => String(s).replace(/[<>&"']/g, c =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

    /* ---------- avatares remotos ---------- */
    const remotes = new Map();          // id -> RemotePlayer
    window.__MP_remotePlayers = [];     // array varrido pelo fire() do jogo

    function nickSprite(name, cssColor) {
      const cv = document.createElement('canvas');
      cv.width = 256; cv.height = 64;
      const ctx = cv.getContext('2d');
      ctx.font = 'bold 34px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,.9)'; ctx.shadowBlur = 8;
      ctx.fillStyle = cssColor;
      ctx.fillText(name, 128, 32);
      const tex = new THREE.CanvasTexture(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
      spr.scale.set(2.8, 0.7, 1);
      spr.position.y = 2.25;
      return spr;
    }

    function makeRemote(id, nk, pos) {
      // cor estável por id (hash simples -> matiz)
      let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
      const hue = ((h >>> 0) % 360);
      const color = new THREE.Color(`hsl(${hue}, 75%, 55%)`);

      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.85, 4, 12), mat);
      body.position.y = 1.02;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 10),
        new THREE.MeshStandardMaterial({ color: 0xe8c9a0, roughness: 0.7 }));
      head.position.y = 1.72;
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.12),
        new THREE.MeshStandardMaterial({ color: 0x111418, roughness: 0.2, metalness: 0.6 }));
      visor.position.set(0, 1.74, -0.2);
      group.add(body, head, visor, nickSprite(nk, `hsl(${hue}, 85%, 70%)`));
      if (Array.isArray(pos)) group.position.set(pos[0], pos[1], pos[2]);
      MP.scene.add(group);

      const rp = {
        id, nick: nk, alive: true, group, mat,
        targetPos: group.position.clone(), yaw: 0, targetYaw: 0, hitT: 0,
        // mesmo contrato dos alvos do jogo: hitSpheres() + damage()
        sphCache: [
          { c: new THREE.Vector3(), r: 0.30, part: 'head' },
          { c: new THREE.Vector3(), r: 0.45, part: 'body' },
          { c: new THREE.Vector3(), r: 0.40, part: 'body' },
        ],
        hitSpheres() {
          const p = this.group.position;
          this.sphCache[0].c.set(p.x, p.y + 1.72, p.z);
          this.sphCache[1].c.set(p.x, p.y + 1.15, p.z);
          this.sphCache[2].c.set(p.x, p.y + 0.55, p.z);
          return this.sphCache;
        },
        damage(dmg) {
          // não aplica dano local: avisa o servidor, e o cliente da vítima
          // (que conhece armadura/invulnerabilidade) aplica de verdade
          socket.emit('shotHit', {
            targetId: this.id, dmg: Math.round(dmg),
            fromPos: [MP.player.pos.x, MP.player.pos.y + 1.5, MP.player.pos.z],
          });
          this.hitT = 0.3;
          return false; // a morte é confirmada pelo evento playerKilled
        },
      };
      remotes.set(id, rp);
      window.__MP_remotePlayers.push(rp);
      return rp;
    }

    function removeRemote(id) {
      const rp = remotes.get(id);
      if (!rp) return;
      MP.scene.remove(rp.group);
      remotes.delete(id);
      const i = window.__MP_remotePlayers.indexOf(rp);
      if (i >= 0) window.__MP_remotePlayers.splice(i, 1);
    }

    for (const p of window.__MP_init.players) makeRemote(p.id, p.nick, p.pos);

    /* ---------- placar ---------- */
    const sb = document.createElement('div');
    sb.style.cssText = 'position:fixed;top:120px;right:14px;z-index:150;background:rgba(8,12,18,.6);' +
      'border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:8px 12px;min-width:158px;' +
      'font:12px/1.75 system-ui,sans-serif;color:#e8f1f8;pointer-events:none;backdrop-filter:blur(4px)';
    document.body.appendChild(sb);
    function renderRoster(list) {
      list.sort((a, b) => b.kills - a.kills);
      sb.innerHTML =
        '<div style="opacity:.7;letter-spacing:2px;font-size:10px;margin-bottom:3px"><b>PLACAR ONLINE · ' +
        list.length + '</b></div>' +
        list.map(p =>
          `<div style="display:flex;justify-content:space-between;gap:14px${p.id === myId ? ';color:#7fd4ff' : ''}">` +
          `<span>${esc(p.nick)}</span><b>${p.kills}</b></div>`).join('');
    }

    /* ---------- eventos do servidor ---------- */
    let lastHit = null; // último atirador que me acertou (pra creditar o abate)

    socket.on('playerUpdate', d => {
      const rp = remotes.get(d.id) || makeRemote(d.id, d.nick || '???', d.pos);
      rp.targetPos.set(d.pos[0], d.pos[1], d.pos[2]);
      rp.targetYaw = d.rotY || 0;
      rp.alive = true;
    });

    socket.on('youWereHit', d => {
      lastHit = { shooterId: d.shooterId, t: Date.now() };
      const f = d.fromPos;
      MP.playerDamage(d.dmg, { x: f[0], y: f[1], z: f[2] }); // flash, seta de dano, armadura: tudo do jogo
    });

    socket.on('playerKilled', d => {
      if (d.victimId !== myId) {
        MP.addKillFeed(`<b>${esc(d.killerNick || 'O mundo')}</b> ▸ ${esc(d.victimNick)}`);
        const rp = remotes.get(d.victimId);
        if (rp) rp.hitT = 0.8;
      } else if (d.killerNick) {
        MP.addKillFeed(`<b>${esc(d.killerNick)}</b> te derrubou`);
      }
    });

    socket.on('roster', renderRoster);
    socket.on('playerLeft', d => removeRemote(d.id));

    /* ---------- respawn (chamado pelo playerDamage do jogo via __MP_respawn) ---------- */
    let mySpawn = MP.spawn || { x: 0, z: 0, face: 0 };

    function doRespawn(sp) {
      if (sp) mySpawn = sp;
      const P = MP.player, S = mySpawn;
      P.pos.set(S.x, MP.heightAt(S.x, S.z) + 0.6, S.z);
      if (P.vel && P.vel.set) P.vel.set(0, 0, 0);
      P.health = P.maxHealth || 100;
      P.armor = 0;
      P.healPool = 0;
      P.dead = false;
      P.invulnUntil = MP.state.gameTime + 2.5;
      MP.camera.rotation.x = 0;
      MP.camera.rotation.y = S.face || 0;
      MP.setTimeScale(1);
      const ds = document.getElementById('deathScreen');
      if (ds) ds.classList.remove('show');
      MP.updateHealthHUD(); MP.updateArmorHUD();
      MP.addKillFeed('<b>Você</b> voltou ao combate');
    }

    window.__MP_respawn = function () {
      let done = false;
      const go = sp => { if (!done) { done = true; doRespawn(sp); } };
      const killerId = lastHit && Date.now() - lastHit.t < 6000 ? lastHit.shooterId : null;
      try {
        socket.timeout(2000).emit('died', { killerId }, (err, newSpawn) => go(err ? null : newSpawn));
      } catch (e) { go(null); }
      setTimeout(() => go(null), 2600); // segurança: respawna mesmo sem resposta
    };

    const deathSub = document.getElementById('deathSub');
    if (deathSub) deathSub.textContent = 'respawnando...';

    // só ativa o modo online depois que o respawn está pronto — se algo acima
    // falhar, a morte continua caindo no location.reload() original (solo)
    window.__MP_active = true;

    /* ---------- ao começar a partida, teleporta pro spawn da sala ---------- */
    const startPoll = setInterval(() => {
      if (!MP.state.started) return;
      clearInterval(startPoll);
      setTimeout(() => { // depois do applySave, pra posição do save não sobrescrever
        const P = MP.player, S = mySpawn;
        P.pos.set(S.x, MP.heightAt(S.x, S.z) + 0.6, S.z);
        MP.camera.rotation.x = 0;
        MP.camera.rotation.y = S.face || 0;
        P.invulnUntil = MP.state.gameTime + 3;
        MP.addKillFeed('<b>Online</b> · sessão conectada');
      }, 400);
    }, 150);

    /* ---------- envia meu estado ~11x/s ---------- */
    setInterval(() => {
      if (!MP.state.started || MP.state.paused) return;
      const p = MP.player.pos;
      socket.volatile.emit('state', { pos: [p.x, p.y, p.z], rotY: MP.camera.rotation.y, nick });
    }, 90);

    /* ---------- interpolação suave dos avatares (loop próprio) ---------- */
    let lastT = performance.now();
    (function mpTick() {
      requestAnimationFrame(mpTick);
      const now = performance.now();
      const dt = Math.min((now - lastT) / 1000, 0.1);
      lastT = now;
      const k = 1 - Math.exp(-12 * dt);
      for (const rp of remotes.values()) {
        rp.group.position.lerp(rp.targetPos, k);
        let dy = rp.targetYaw - rp.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        rp.yaw += dy * k;
        rp.group.rotation.y = rp.yaw;
        if (rp.hitT > 0) {
          rp.hitT -= dt;
          rp.mat.emissive.setHex(0xff2222);
          rp.mat.emissiveIntensity = Math.max(0, rp.hitT * 4);
        }
      }
    })();

    console.log('[MP] conectado como', nick, '· id', myId);
  }
})();
