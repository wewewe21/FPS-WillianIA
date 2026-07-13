import sys
import os
import time
from playwright.sync_api import sync_playwright

PORT = 3195
URL = f"http://localhost:{PORT}/"
SHOTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "screenshots")
os.makedirs(SHOTS_DIR, exist_ok=True)

CHROME_ARGS = [
    '--no-sandbox', 
    '--disable-dev-shm-usage', 
    '--enable-unsafe-swiftshader',
    '--use-gl=angle', 
    '--use-angle=swiftshader', 
    '--mute-audio'
]

print("Iniciando testes exploratórios automatizados via Playwright...")

with sync_playwright() as p:
    print("Iniciando navegador Chromium (Headless)...")
    browser = p.chromium.launch(channel='chrome', headless=True, args=CHROME_ARGS)
    context = browser.new_context(viewport={'width': 1280, 'height': 720})
    page = context.new_page()

    # Captura logs do console
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    
    # Captura erros de script na página
    page_errors = []
    page.on("pageerror", lambda err: page_errors.append(err.message))

    print(f"Navegando para {URL}...")
    try:
        page.goto(URL, wait_until="domcontentloaded")
        
        # Espera as variáveis globais de inicialização do jogo estarem prontas
        print("Aguardando inicialização do motor de jogo (Three.js/Socket.io)...")
        page.wait_for_function(
            "!!window.__game && !!window.__MP", 
            timeout=30000
        )
        
        # Tira screenshot do lobby inicial
        lobby_shot_path = os.path.join(SHOTS_DIR, "lobby_initial.png")
        page.screenshot(path=lobby_shot_path)
        print(f"Screenshot do lobby inicial salvo em: {lobby_shot_path}")

        # Insere um Nickname para entrar no Lobby/Sala
        print("Inserindo nickname do jogador...")
        page.wait_for_selector("#brNick", timeout=10000)
        page.fill("#brNick", "QABotIA")
        
        # Aguarda um pequeno tempo para a rede registrar a entrada
        time.sleep(2)
        
        # Tira screenshot pós-identificação
        post_hello_shot_path = os.path.join(SHOTS_DIR, "lobby_connected.png")
        page.screenshot(path=post_hello_shot_path)
        print(f"Screenshot conectado salvo em: {post_hello_shot_path}")

        # Força o início do jogo localmente (para fins de teste solo/exploratório)
        print("Forçando início de jogo exploratório local (forceStart)...")
        page.evaluate("window.__game.forceStart()")
        
        # Espera 5 segundos para o jogo rodar alguns frames
        time.sleep(5)
        
        # Captura screenshot da gameplay
        gameplay_shot_path = os.path.join(SHOTS_DIR, "gameplay_exploratoria.png")
        page.screenshot(path=gameplay_shot_path)
        print(f"Screenshot da gameplay salvo em: {gameplay_shot_path}")

        # Verifica logs de erro
        print("\n=== Resultados da Coleta de Erros ===")
        print(f"Erros de Script na Página (Page errors): {len(page_errors)}")
        for err in page_errors:
            print(f"  - 🔴 {err}")
            
        print(f"Erros no Console (Console errors): {len(console_errors)}")
        for err in console_errors:
            # Ignora erros benignos de WebGL/GPU
            if not any(k in err.lower() for k in ["webgl", "gpu", "swiftshader", "favicon"]):
                print(f"  - 🟠 {err}")
                
    except Exception as e:
        print(f"Ocorreu um erro durante a execução do teste: {e}", file=sys.stderr)
    finally:
        browser.close()
        print("Teste exploratório finalizado e navegador fechado.")
