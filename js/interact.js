/* interação (tecla E): baús, bazuca, veículos — extraído de game.js; deps explícitas */
import { buildChest } from './chestmodel.js';

export function createInteract(deps) {
  const { heightAt, SFX, scene, csmMat, Structures, ui, centerMsg, arsenal, unlockWeapon, updateInvHUD, state, justPressed, player, inventory, Car, Heli, tryToggleCar, getCannon, getMapToys } = deps;
  for (const s of Structures.chestSpots) {
    // não nasce dentro de parede: empurra o spot pra fora de qualquer estrutura
    // (collide não consome rand — seguro na fase seedada). Mantém proximidade e
    // mesh coerentes mutando o próprio spot.
    const p = { x: s.x, y: heightAt(s.x, s.z) + 0.3, z: s.z };
    for (let i = 0; i < 4; i++) Structures.collide(p, 0.5, 0.6);
    s.x = p.x; s.z = p.z;
    const { group } = buildChest(csmMat);
    group.position.set(s.x, heightAt(s.x, s.z), s.z);
    scene.add(group);
  }
  const chest = { medkits: 0, nades: 0, meat: 0 };

  function chestSwap() {
    const stored = chest.medkits + chest.nades + chest.meat;
    if (stored > 0) {
      const tm = Math.min(inventory.medkitsMax - inventory.medkits, chest.medkits);
      inventory.medkits += tm; chest.medkits -= tm;
      const tn = Math.min(inventory.nadesMax - inventory.nades, chest.nades);
      inventory.nades += tn; chest.nades -= tn;
      const tc = Math.min(inventory.meatMax - inventory.meat, chest.meat);
      inventory.meat += tc; chest.meat -= tc;
      centerMsg('Baú: itens retirados', 1300);
    } else {
      const dm = Math.max(0, inventory.medkits - 1); chest.medkits += dm; inventory.medkits -= dm;
      const dn = Math.max(0, inventory.nades - 1); chest.nades += dn; inventory.nades -= dn;
      chest.meat += inventory.meat; inventory.meat = 0;
      centerMsg('Baú: excedente guardado (mantém 1 de cada)', 1600);
    }
    SFX.pickup();
    updateInvHUD();
  }
  function current() {
    if (state.flying) return { txt: 'SAIR DO HELICÓPTERO', fn: () => Heli.exit() };
    if (state.driving) return { txt: 'SAIR DO VEÍCULO', fn: tryToggleCar };
    // Canhão de Circo: vale no solo E no BR (a pé, longe de veículo/baú)
    const cannon = getCannon && getCannon();
    if (cannon) { const cp = cannon.prompt(player.pos); if (cp) return cp; }
    const toys = getMapToys && getMapToys();
    if (toys) { const tp = toys.prompt(player.pos); if (tp) return tp; }
    if (!window.__BR_active) { // BR: sem baú de guardar, sem bazuca grátis (loot vem dos baús BR)
      const bz = Structures.bazookaSpot;
      if (arsenal[3].locked && Math.hypot(player.pos.x - bz.x, player.pos.z - bz.z) < 2.8 && Math.abs(player.pos.y - bz.y) < 3.5)
        return { txt: 'PEGAR BAZUCA', fn: () => unlockWeapon(3, 'tecla 4 para equipar') };
      for (const s of Structures.chestSpots)
        if (Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < 2.4) return { txt: 'USAR BAÚ', fn: chestSwap };
    }
    if (player.pos.distanceTo(Heli.group.position) < 5) return { txt: 'PILOTAR HELICÓPTERO', fn: tryToggleCar };
    const near = Car.nearest(player.pos);
    if (near.d < 4.5) return { txt: 'ENTRAR — ' + near.v.cfg.name, fn: tryToggleCar };
    return null;
  }
  function update(dt, t) {
    // BR: na nave/queda/espectador (freeze) não existe interação com o mundo
    if (window.__BR_freeze) { ui.prompt.style.opacity = '0'; return; }
    const c = current();
    if (c) ui.prompt.innerHTML = `<b>E</b> &nbsp;${c.txt}`;
    ui.prompt.style.opacity = c ? '1' : '0';
    if (c && justPressed.has('KeyE') && !player.dead) c.fn();
  }
  function renderInv() {
    ui.invList.innerHTML =
      `<div class="invRow"><span>✚ Kit médico × ${inventory.medkits}</span><span class="k">[Q] usar</span></div>
       <div class="invRow"><span>● Granada × ${inventory.nades}</span><span class="k">[G] lançar</span></div>
       <div class="invRow"><span>🍖 Carne × ${inventory.meat}</span><span class="k">[F] comer</span></div>
       <div class="invRow"><span>🛡 Armadura ${Math.round(player.armor)}/${player.armorMax}</span><span class="k">do COLOSSO</span></div>
       <div class="invRow"><span>Arsenal ${arsenal.filter(w => !w.locked).length}/5</span><span class="k">[T] troca mira</span></div>
       <div class="invRow"><span>Baú: ${chest.medkits}✚ ${chest.nades}● ${chest.meat}🍖</span><span class="k">guarde em baús</span></div>`;
  }
  return { update, renderInv, chest };
}
