/* Cobertura de céu — fonte central e BARATA de "está debaixo de teto?".
   Retângulos de telhado (prédios da cidade, torre, lajes, estruturas do
   campo) num hash espacial + um provider dinâmico (cabine da nave em
   movimento). Consulta O(1); zero raycast. Só APRESENTAÇÃO e áudio:
   nada aqui muda física, dano ou autoridade do servidor. */

export function createCover() {
  const CELL = 16;
  const grid = new Map(); // "gx_gz" -> [{x0,x1,z0,z1,roofY,sourceId}]
  const bySource = new Map();
  let dynamicProvider = null; // (x,y,z) => {covered,sourceId} | null  (nave)

  const key = (x, z) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;

  function addRoofRect(rect) {
    const r = { x0: rect.x0, x1: rect.x1, z0: rect.z0, z1: rect.z1,
      roofY: rect.roofY, sourceId: rect.sourceId || 'roof' };
    const list = bySource.get(r.sourceId) || [];
    list.push(r);
    bySource.set(r.sourceId, list);
    for (let gx = Math.floor(r.x0 / CELL); gx <= Math.floor(r.x1 / CELL); gx++)
      for (let gz = Math.floor(r.z0 / CELL); gz <= Math.floor(r.z1 / CELL); gz++) {
        const k = `${gx}_${gz}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(r);
      }
  }

  /* destruição (cidade caindo) tira o "telhado climático" junto do prédio */
  function removeBySource(sourceId) {
    const list = bySource.get(sourceId);
    if (!list) return;
    bySource.delete(sourceId);
    for (const cell of grid.values()) {
      for (let i = cell.length - 1; i >= 0; i--) if (list.includes(cell[i])) cell.splice(i, 1);
    }
  }

  function setDynamicProvider(fn) { dynamicProvider = fn; }

  function coverAt(x, y, z) {
    if (dynamicProvider) {
      const d = dynamicProvider(x, y, z);
      if (d && d.covered) return { covered: true, exposure: 0, roofY: Infinity, sourceId: d.sourceId || 'dynamic' };
    }
    const cell = grid.get(key(x, z));
    if (cell) {
      for (const r of cell) {
        if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1 && y < r.roofY)
          return { covered: true, exposure: 0, roofY: r.roofY, sourceId: r.sourceId };
      }
    }
    return { covered: false, exposure: 1, roofY: null, sourceId: null };
  }

  return { addRoofRect, removeBySource, setDynamicProvider, coverAt,
    get sources() { return [...bySource.keys()]; } };
}
