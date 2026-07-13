import os
from playwright.sync_api import sync_playwright

PORT = 3195
URL = f"http://localhost:{PORT}/"

CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-dev-shm-usage', 
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', 
    '--use-angle=swiftshader', 
    '--mute-audio'
]

print("Iniciando varredura detalhada de toda a vegetação (InstancedMeshes) no cliente...")

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    page = browser.new_page()

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("!!window.__game && !!window.__MP", timeout=30000)

    stats = page.evaluate('''() => {
        const MP = window.__MP;
        const G = window.__game;
        const THREE = MP.THREE;

        const CITY = { x: -340, z: 130, r: 92 }; // Perímetro urbano (asfalto)
        const VOLCANO = { x: 420, z: -420, r: 114 }; // Cone do vulcão

        const results = {
            trees: { name: "Árvores", city: 0, volcano: 0 },
            rocks: { name: "Pedras", city: 0, volcano: 0 },
            flowers: { name: "Flores", city: 0, volcano: 0 },
            cacti: { name: "Cactos", city: 0, volcano: 0 }
        };

        const m4 = new THREE.Matrix4();
        const pos = new THREE.Vector3();
        const q = new THREE.Quaternion();
        const sc = new THREE.Vector3();

        MP.scene.traverse(o => {
            if (!o.isInstancedMesh) return;

            let cat = null;
            // Identifica a categoria pelo material ou geometria
            if (o.geometry.attributes.aPhase) {
                // Grama: já tratada no outro teste, ignora aqui
                return;
            }

            const geoName = o.geometry.constructor.name;
            const matColor = o.material.color ? o.material.color.getHexString() : '';

            // Mapeamento por heurística
            if (o.count === 533 || o.count === 534 || (o.geometry.index && o.geometry.attributes.color)) {
                // Árvores (têm cores de vértice e 2 LODs com mesmo count)
                cat = 'trees';
            } else if (o.material.flatShading && matColor === '8d929c') {
                cat = 'rocks';
            } else if (o.geometry.index && o.geometry.attributes.position && o.count === 160) {
                cat = 'cacti';
            } else if (o.count === MP.CFG.FLOWER_COUNT) {
                cat = 'flowers';
            }

            if (!cat) return;

            // Para os LODs da árvore, vamos contar apenas uma vez para não duplicar
            if (cat === 'trees' && o.count === 533 && o.name === 'treeLoMesh') {
                // Ignora o LOD baixo para não contar árvores duplicadas
                return;
            }

            for (let i = 0; i < o.count; i++) {
                o.getMatrixAt(i, m4);
                m4.decompose(pos, q, sc);

                // Converte posição local da instância para coordenada de mundo
                const wx = o.position.x + pos.x;
                const wz = o.position.z + pos.z;

                const dCity = Math.hypot(wx - CITY.x, wz - CITY.z);
                const dVolc = Math.hypot(wx - VOLCANO.x, wz - VOLCANO.z);

                if (dCity < CITY.r) {
                    results[cat].city++;
                }
                if (dVolc < VOLCANO.r) {
                    results[cat].volcano++;
                }
            }
        });

        return results;
    }''')

    print("\n=== Relatório de Invasão de Vegetação ===")
    print(f"{'Categoria':<12} | {'Na Cidade (Asfalto)':<20} | {'No Vulcão (Rocha)':<20}")
    print("-" * 58)
    for cat, data in stats.items():
        city_str = f"❌ {data['city']} detectado(s)" if data['city'] > 0 else "✅ Zero"
        volc_str = f"❌ {data['volcano']} detectado(s)" if data['volcano'] > 0 else "✅ Zero"
        print(f"{data['name']:<12} | {city_str:<20} | {volc_str:<20}")

    browser.close()
