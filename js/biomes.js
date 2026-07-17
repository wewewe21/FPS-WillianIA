/* Classificação CENTRAL de biomas — fonte única dos pesos/limiares que antes
   viviam espalhados em game.js (cores da malha), grass.js e scenery.js.
   Prioridade explícita: water → shore → volcanic → urban → alpine → ruído
   (desert/forest/prairie). Pesos ∈ [0,1] somando 1; transições por smoothstep.
   `biomeAt` (simplex cru) segue vivo no terrain como adaptador de IA/spawns. */

export function createBiomes(deps) {
  // slopeAt: gradiente SUAVIZADO (diferença central) — contínuo entre células;
  // o slope triangular exato fica pra física, aqui daria degrau de peso na
  // fronteira de cada triângulo.
  const { simplex, heightAt, slopeAt, WATER_LEVEL, CITY, VOLCANO, cityCategory,
    smoothstep, GRASS_FADE1 = 82, CORE_RADIUS = 58 } = deps;
  const RAD2DEG = 180 / Math.PI;

  // mesmos limiares do código antigo (paridade visual garantida):
  // deserto: smoothstep(-bio, 0.18, 0.45) | floresta: smoothstep(bio, 0.34, 0.62)
  // alpino: h 17..28 / neve 21..28 | vulcão: r*0.8..1.15 | margem: WL..WL+1.6
  function classifyAt(x, z, pre) {
    const h = pre ? pre.height : heightAt(x, z);
    const slope = Math.atan(slopeAt(x, z)) * RAD2DEG; // graus, contínuo
    const bio = simplex.noise(x * 0.0016 + 41.7, z * 0.0016 - 12.3); // == biomeAt
    const w = { prairie: 0, forest: 0, desert: 0, alpine: 0, volcanic: 0, urban: 0, shore: 0, water: 0 };

    // camadas de prioridade: cada uma toma a fração k do que RESTA
    let rest = 1;
    const take = (key, k) => { const v = Math.max(0, Math.min(1, k)) * rest; w[key] += v; rest -= v; };

    if (h < WATER_LEVEL) take('water', 1);
    else take('shore', 1 - smoothstep(h, WATER_LEVEL, WATER_LEVEL + 1.6));

    const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
    take('volcanic', 1 - smoothstep(dv, VOLCANO.r * 0.8, VOLCANO.r * 1.15));

    const dc = Math.hypot(x - CITY.x, z - CITY.z);
    const cat = dc < GRASS_FADE1 + 6 ? cityCategory(x, z) : null;
    take('urban', cat && cat !== 'green' ? 1 : 1 - smoothstep(dc, CORE_RADIUS, GRASS_FADE1));

    take('alpine', Math.max(smoothstep(h, 17, 26), smoothstep(slope, 38, 52)));

    const desertK = smoothstep(-bio, 0.18, 0.45);
    const forestK = smoothstep(bio, 0.34, 0.62);
    take('desert', desertK);
    take('forest', forestK);
    w.prairie += rest;

    // normaliza (soma exata 1, defende de acumulação numérica)
    let sum = 0;
    for (const k in w) sum += w[k];
    for (const k in w) w[k] /= sum;

    let id = 'prairie', best = w.prairie;
    for (const k in w) if (w[k] > best) { best = w[k]; id = k; }

    const surfaceType =
      w.water > 0.5 ? 'water' :
      cat === 'road' || cat === 'sidewalk' || cat === 'plaza' ? 'street' :
      cat === 'footprint' ? 'building' :
      w.volcanic > 0.6 ? 'rock' : 'terrain';

    // grama: fator 0..1 — some na água/rua/prédio/cone do vulcão; reduz no
    // deserto/alpino (curvas do grass.js antigo preservadas lá)
    const vegetationFactor =
      h < WATER_LEVEL + 0.25 ? 0 :
      (cat && cat !== 'green') ? 0 :
      dv < VOLCANO.r * 0.95 ? 0 :
      Math.max(0, 1 - w.alpine * 0.9);

    const driveable = w.water < 0.5 && surfaceType !== 'building' && slope <= 20;

    return { id, weights: w, surfaceType, vegetationFactor, driveable, desertK, forestK };
  }

  return { classifyAt };
}
