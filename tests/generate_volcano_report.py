import os
import time
from playwright.sync_api import sync_playwright

PORT = 3191
URL = f"http://localhost:{PORT}/"

CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-dev-shm-usage', 
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', 
    '--use-angle=swiftshader', 
    '--mute-audio'
]

print("Gerando relatório detalhado do perfil do Vulcão...")

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    page = browser.new_page()

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("!!window.__game && !!window.__MP && !!window.__game.Volcano && window.__game.Volcano.modelReady", timeout=30000)

    # Imprime os nomes dos objetos no grupo do vulcão para diagnóstico
    objects = page.evaluate('''() => {
        const list = [];
        window.__game.Volcano.group.traverse(o => {
            if (o.isMesh) list.push({ name: o.name, parentName: o.parent ? o.parent.name : null });
        });
        return list;
    }''')
    print("Meshes encontradas no modelo do Vulcão:")
    for obj in objects:
        print(f" - Mesh: '{obj['name']}', Parent: '{obj['parentName']}'")

    report_data = page.evaluate('''() => {
        const V = window.__game.Volcano;
        const v = V.VOLCANO;
        const MP = window.__MP;
        const THREE = MP.THREE;

        const raycaster = new THREE.Raycaster();
        
        // Direções de perfil: X (Leste/Oeste), Z (Norte/Sul) e Diagonal (NE/SW)
        const profiles = {
            "Eixo X (Leste)": { dx: 1, dz: 0 },
            "Eixo X (Oeste)": { dx: -1, dz: 0 },
            "Eixo Z (Sul)": { dx: 0, dz: 1 },
            "Eixo Z (Norte)": { dx: 0, dz: -1 },
            "Diagonal NE": { dx: 0.7071, dz: -0.7071 },
            "Diagonal SW": { dx: -0.7071, dz: 0.7071 }
        };

        const radii = [0, 15, 30, 45, 60, 75, 90, 105, 115, 125, 135];
        const profileSamples = {};

        for (const [name, dir] of Object.entries(profiles)) {
            profileSamples[name] = [];
            for (const r of radii) {
                // Não testa centro r=0 para diagonal para não duplicar
                if (r === 0 && name !== "Eixo X (Leste)") continue;

                const px = v.x + dir.dx * r;
                const pz = v.z + dir.dz * r;

                raycaster.set(new THREE.Vector3(px, 200, pz), new THREE.Vector3(0, -1, 0));
                const intersects = raycaster.intersectObject(V.group, true);
                
                let visualY = null;
                for (const hit of intersects) {
                    if (hit.object.name.toLowerCase().includes("plume") || hit.object.name.toLowerCase().includes("smoke") || hit.object.name.toLowerCase().includes("erup")) {
                        continue; // ignora a fumaça
                    }
                    visualY = hit.point.y;
                    break;
                }

                if (visualY === null && intersects.length > 0) {
                    visualY = intersects[0].point.y;
                }

                const physicalY = MP.heightAt(px, pz);
                const diff = visualY !== null ? (visualY - physicalY) : 0;

                profileSamples[name].push({
                    r,
                    x: parseFloat(px.toFixed(1)),
                    z: parseFloat(pz.toFixed(1)),
                    visualY: visualY !== null ? parseFloat(visualY.toFixed(2)) : null,
                    physicalY: parseFloat(physicalY.toFixed(2)),
                    diff: parseFloat(diff.toFixed(2))
                });
            }
        }

        return profileSamples;
    }''')

    # Escreve o relatório em formato Markdown
    markdown_content = "# Perfil de Alturas do Vulcão — Diagnóstico Visual vs Físico\n\n"
    markdown_content += "Este documento compara as alturas entre a malha 3D visual e o terreno físico (colisor heightmap) do vulcão ao longo de seus eixos principais.\n\n"
    
    for axis_name, samples in report_data.items():
        markdown_content += f"## {axis_name}\n\n"
        markdown_content += "| Raio (m) | X | Z | VisualY (Mesh) | FísicoY (Heightmap) | Desalinhamento (m) |\n"
        markdown_content += "| :--- | :--- | :--- | :--- | :--- | :--- |\n"
        for s in samples:
            vis_y = f"{s['visualY']:.2f}" if s['visualY'] is not None else "N/A"
            diff_y = f"{s['diff']:.2f}" if s['visualY'] is not None else "N/A"
            
            # Formatação visual do desalinhamento
            if s['visualY'] is not None and abs(s['diff']) > 1.5:
                diff_str = f"🔴 **{diff_y}**"
            elif s['visualY'] is not None and abs(s['diff']) > 0.5:
                diff_str = f"🟡 *{diff_y}*"
            else:
                diff_str = f"🟢 {diff_y}"
                
            markdown_content += f"| {s['r']} | {s['x']} | {s['z']} | {vis_y} | {s['physicalY']:.2f} | {diff_str} |\n"
        markdown_content += "\n"

    # Salva como artefato para o usuário
    artifact_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "volcano_profile.md")
    with open(artifact_path, "w", encoding="utf-8") as f:
        f.write(markdown_content)
        
    print(f"Relatório gerado com sucesso em: {artifact_path}")
    browser.close()
