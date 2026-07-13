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

print("Iniciando inspeção de vegetação (Árvores, Pedras e Flores) em áreas protegidas...")

with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    page = browser.new_page()

    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function("!!window.__game && !!window.__MP", timeout=30000)

    stats = page.evaluate('''() => {
        const MP = window.__MP;
        const G = window.__game;
        const VOLCANO = MP.CFG.VOLCANO || { x: 420, z: -420, r: 114 };
        const CITY = { x: -340, z: 130, r: 130 }; // Coordenadas corretas da cidade

        // Encontra corpos estáticos de árvores e pedras no Cannon.js
        const treeBodies = [];
        const rockBodies = [];

        // No Cannon, árvores têm forma de Box e pedras têm forma de Sphere
        for (const b of MP.world.bodies) {
            if (b.mass === 0 && b.shapes[0]) {
                const shape = b.shapes[0];
                const pos = b.position;
                if (shape.constructor.name === 'Box') {
                    treeBodies.push({ x: pos.x, z: pos.z, type: 'tree' });
                } else if (shape.constructor.name === 'Sphere') {
                    rockBodies.push({ x: pos.x, z: pos.z, type: 'rock' });
                }
            }
        }

        const volcanoTrees = treeBodies.filter(t => Math.hypot(t.x - 420, t.z - (-420)) < 114);
        const volcanoRocks = rockBodies.filter(r => Math.hypot(r.x - 420, r.z - (-420)) < 114);

        const cityTrees = treeBodies.filter(t => Math.hypot(t.x - (-340), t.z - 130) < 130);
        const cityRocks = rockBodies.filter(r => Math.hypot(r.x - (-340), r.z - 130) < 130);

        return {
            totalTrees: treeBodies.length,
            totalRocks: rockBodies.length,
            volcanoTrees: volcanoTrees.map(t => ({ x: +t.x.toFixed(1), z: +t.z.toFixed(1) })),
            volcanoRocks: volcanoRocks.map(r => ({ x: +r.x.toFixed(1), z: +r.z.toFixed(1) })),
            cityTrees: cityTrees.map(t => ({ x: +t.x.toFixed(1), z: +t.z.toFixed(1) })),
            cityRocks: cityRocks.map(r => ({ x: +r.x.toFixed(1), z: +r.z.toFixed(1) }))
        };
    }''')

    print(f"\nTotal de Árvores físicas: {stats['totalTrees']}")
    print(f"Total de Pedras físicas: {stats['totalRocks']}")

    print(f"\n=== Árvores/Pedras na Área do Vulcão (Centro: 420, -420, Raio: 114) ===")
    print(f"Árvores no vulcão ({len(stats['volcanoTrees'])}): {stats['volcanoTrees']}")
    print(f"Pedras no vulcão ({len(stats['volcanoRocks'])}): {stats['volcanoRocks']}")

    print(f"\n=== Árvores/Pedras na Área da Cidade (Centro: -340, 130, Raio: 130) ===")
    print(f"Árvores na cidade ({len(stats['cityTrees'])}): {stats['cityTrees']}")
    print(f"Pedras na cidade ({len(stats['cityRocks'])}): {stats['cityRocks']}")

    browser.close()
