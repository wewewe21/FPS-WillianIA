import os
import time
from playwright.sync_api import sync_playwright

PORT = 3193
URL = f"http://localhost:{PORT}/"

CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-dev-shm-usage', 
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', 
    '--use-angle=swiftshader', 
    '--mute-audio'
]

print("Iniciando varredura sistemática de colisão do Vulcão...")

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    page = browser.new_page()

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("!!window.__game && !!window.__MP && !!window.__game.Volcano && window.__game.Volcano.modelReady", timeout=30000)

    scan_results = page.evaluate('''() => {
        const V = window.__game.Volcano;
        const v = V.VOLCANO;
        const MP = window.__MP;
        const THREE = MP.THREE;

        const raycaster = new THREE.Raycaster();
        const maxDist = v.r * 1.3;
        
        let maxMismatch = 0;
        let maxMismatchPt = null;
        let mismatches = [];

        // Varredura em grade polar (raio e ângulo) ao redor do centro do vulcão
        // Evita a pluma de fumaça central (raio < 20) pois ela não tem colisão física por design
        const radii = [25, 40, 55, 70, 85, 100, 115, 125, 135];
        const angles = [0, 45, 90, 135, 180, 225, 270, 315];

        for (const r of radii) {
            for (const deg of angles) {
                const rad = deg * Math.PI / 180;
                const px = v.x + Math.cos(rad) * r;
                const pz = v.z + Math.sin(rad) * r;

                // Raycast do céu para o chão
                raycaster.set(new THREE.Vector3(px, 200, pz), new THREE.Vector3(0, -1, 0));
                const intersects = raycaster.intersectObject(V.group, true);
                
                // Filtra para garantir que não estamos atingindo a pluma de fumaça central
                let visualY = null;
                for (const hit of intersects) {
                    if (hit.object.name.toLowerCase().includes("plume") || hit.object.name.toLowerCase().includes("smoke") || hit.object.name.toLowerCase().includes("erup")) {
                        continue;
                    }
                    visualY = hit.point.y;
                    break;
                }

                if (visualY === null && intersects.length > 0) {
                    visualY = intersects[0].point.y;
                }

                const physicalY = MP.heightAt(px, pz);
                
                if (visualY !== null) {
                    const diff = Math.abs(visualY - physicalY);
                    mismatches.push({ x: px, z: pz, r, deg, visualY, physicalY, diff });
                    if (diff > maxMismatch) {
                        maxMismatch = diff;
                        maxMismatchPt = { x: px, z: pz, r, deg, visualY, physicalY, diff };
                    }
                }
            }
        }

        return {
            maxMismatchPt,
            totalSampled: mismatches.length,
            mismatches: mismatches.sort((a, b) => b.diff - a.diff).slice(0, 15) // Top 15 maiores desvios
        };
    }''')

    print("\n=== TOP 15 MAIORES DESVIOS (VISUAL VS FÍSICO) INSPECIONADOS ===")
    print(f"{'Raio (m)':<8} | {'Ângulo (°)':<10} | {'X':<7} | {'Z':<7} | {'VisualY':<8} | {'FísicoY':<8} | {'Erro (m)':<8}")
    print("-" * 75)
    for m in scan_results['mismatches']:
        print(f"{m['r']:<8.1f} | {m['deg']:<10.1f} | {m['x']:<7.1f} | {m['z']:<7.1f} | {m['visualY']:<8.2f} | {m['physicalY']:<8.2f} | {m['diff']:<8.2f}")

    if scan_results['maxMismatchPt']:
        pt = scan_results['maxMismatchPt']
        print("\n🔍 CONCLUSAO DO DIAGNÓSTICO:")
        print(f"O maior desalinhamento de colisão está a {pt['r']:.1f} metros do centro, no ângulo {pt['deg']}°.")
        print(f"Coordenadas: ({pt['x']:.2f}, {pt['z']:.2f})")
        print(f"Visual: {pt['visualY']:.2f}m | Físico: {pt['physicalY']:.2f}m | Diferença: {pt['diff']:.2f}m")

    browser.close()
