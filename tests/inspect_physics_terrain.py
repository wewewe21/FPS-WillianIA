import os
import time
from playwright.sync_api import sync_playwright

PORT = 3192
URL = f"http://localhost:{PORT}/"

CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-dev-shm-usage', 
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', 
    '--use-angle=swiftshader', 
    '--mute-audio'
]

print("Iniciando inspeção de alinhamento entre Física (Cannon.js) e Visual...")

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    page = browser.new_page()

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("!!window.__game && !!window.__MP", timeout=30000)

    comparison = page.evaluate('''() => {
        const G = window.__game;
        const MP = window.__MP;
        // Obter referências das variáveis globais

        // Acha o corpo do Heightfield no mundo físico
        const hfBody = MP.world.bodies.find(b => b.shapes[0] && b.shapes[0].constructor.name === 'Heightfield');
        if (!hfBody) {
            const types = MP.world.bodies.map(b => b.shapes[0] ? (b.shapes[0].constructor.name || b.shapes[0].type) : 'none');
            return { error: "Corpo do Heightfield não encontrado. Tipos de corpos no mundo: " + types.join(', ') };
        }

        const shape = hfBody.shapes[0];
        const data = shape.data;
        const elementSize = shape.elementSize;

        // Função para obter a altura física exata do corpo Cannon no mundo
        function getPhysicalHeightAt(x, z) {
            // Converte coordenada do mundo para coordenadas locais do Heightfield
            // hfBody.position = (-half, 0, half)
            // hfBody.quaternion = Euler(-PI/2, 0, 0)
            
            // local_x = x - hfBody.position.x
            // local_y = hfBody.position.z - z
            const localX = x - hfBody.position.x;
            const localY = hfBody.position.z - z;
            
            const i = Math.floor(localX / elementSize);
            const j = Math.floor(localY / elementSize);
            
            if (i < 0 || i >= data.length - 1 || j < 0 || j >= data[0].length - 1) {
                return null;
            }
            
            // Interpolação bilinear física do Cannon.js
            const tx = (localX / elementSize) - i;
            const ty = (localY / elementSize) - j;
            
            // Atenção: no Cannon.js, o array é data[i][j]
            const h00 = data[i][j];
            const h10 = data[i + 1][j];
            const h01 = data[i][j + 1];
            const h11 = data[i + 1][j + 1];
            
            const top = h00 + (h10 - h00) * tx;
            const bot = h01 + (h11 - h01) * tx;
            return top + (bot - top) * ty;
        }

        // Testamos vários pontos pelo mapa todo para ver se a física bate com o visual
        const points = [
            { name: "Spawn / Centro", x: 0, z: 0 },
            { name: "Canto do Vulcão (Centro)", x: 420, z: -420 },
            { name: "Canto do Vulcão (Encosta)", x: 380, z: -380 },
            { name: "Distrito Urbano", x: -340, z: 130 },
            { name: "Norte", x: 0, z: -300 },
            { name: "Sul", x: 0, z: 300 },
            { name: "Leste", x: 300, z: 0 },
            { name: "Oeste", x: -300, z: 0 },
            { name: "Diagonal SE", x: 350, z: 350 },
            { name: "Diagonal NW", x: -350, z: -350 }
        ];

        const results = [];
        for (const pt of points) {
            const visualY = MP.heightAt(pt.x, pt.z);
            const physicalY = getPhysicalHeightAt(pt.x, pt.z);
            const diff = physicalY !== null ? Math.abs(visualY - physicalY) : null;
            results.push({
                name: pt.name,
                x: pt.x,
                z: pt.z,
                visualY: parseFloat(visualY.toFixed(3)),
                physicalY: physicalY !== null ? parseFloat(physicalY.toFixed(3)) : null,
                diff: diff !== null ? parseFloat(diff.toFixed(3)) : null
            });
        }

        return {
            hfPos: { x: hfBody.position.x, y: hfBody.position.y, z: hfBody.position.z },
            hfQuat: { x: hfBody.quaternion.x, y: hfBody.quaternion.y, z: hfBody.quaternion.z, w: hfBody.quaternion.w },
            gridSize: { rows: data.length, cols: data[0].length },
            results
        };
    }''')

    if "error" in comparison:
        print(f"❌ ERRO: {comparison['error']}")
    else:
        print("\n=== Configurações do Heightfield de Física ===")
        print(f"Posição do Corpo: {comparison['hfPos']}")
        print(f"Rotação (Quat): {comparison['hfQuat']}")
        print(f"Grade física: {comparison['gridSize']['rows']}x{comparison['gridSize']['cols']}")

        print("\n=== Comparação de Altura: Visual vs Física (Cannon.js) ===")
        print(f"{'Região':<25} | {'X':<6} | {'Z':<6} | {'VisualY':<8} | {'FísicaY':<8} | {'Diferença':<10}")
        print("-" * 75)
        
        has_bug = False
        for r in comparison['results']:
            phys_y = f"{r['physicalY']:.3f}" if r['physicalY'] is not None else "FORA"
            diff = f"{r['diff']:.3f}" if r['diff'] is not None else "N/A"
            print(f"{r['name']:<25} | {r['x']:<6.1f} | {r['z']:<6.1f} | {r['visualY']:<8.3f} | {phys_y:<8} | {diff:<10}")
            if r['diff'] is not None and r['diff'] > 0.5:
                has_bug = True

        if has_bug:
            print("\n❌ ALERTA DE BUG CRÍTICO DETECTADO!")
            print("Há um desalinhamento significativo entre a altura que o jogador vê (visualY) e a altura da física (CANNON.js)!")
            print("Isso faz com que carros e helicópteros flutuem ou afundem no chão!")
        else:
            print("\n✅ Alinhamento entre Física e Visual está correto em todo o mapa (diferença < 0.5m).")

    browser.close()
