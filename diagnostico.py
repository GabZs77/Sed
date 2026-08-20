"""Script de diagnóstico - testa login e mostra tudo que encontra."""
import time
import json
from playwright.sync_api import sync_playwright

SITE = "https://saladofuturo.educacao.sp.gov.br"
BFF = "https://sedintegracoes.educacao.sp.gov.br/saladofuturobffapi"
KEY = "d701a2043aa24d7ebb37e9adf60d043b"

ra = input("RA (sem digito/SP): ").strip()
digito = input("Dígito: ").strip()
senha = input("Senha: ").strip()

ra_completo = ra + digito + "SP"
print(f"\n=== Testando login com RA={ra_completo} ===\n")

pw = sync_playwright().start()
browser = pw.chromium.launch(headless=False, args=[
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-dev-shm-usage",
])
ctx = browser.new_context(
    viewport={"width": 1280, "height": 720},
    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale="pt-BR",
)
page = ctx.new_page()

print("[1] Acessando login...")
page.goto(f"{SITE}/login-alunos", wait_until="domcontentloaded", timeout=60000)
time.sleep(5)

print(f"[2] URL atual: {page.url}")

# Preencher campos
print(f"[3] Preenchendo RA={ra}, digito={digito}")
try:
    page.fill("#input-usuario-sed", ra, timeout=10000)
    print("    RA preenchido OK")
except Exception as e:
    print(f"    ERRO fill RA: {e}")

if digito:
    selectors = [
        'input[name="digito-ra"]',
        '#input-digito',
        'input[placeholder*="dígito"]',
        'input[placeholder*="digito"]',
        'input[maxlength="2"]',
    ]
    filled = False
    for sel in selectors:
        try:
            digs = page.query_selector_all(sel)
            for d in digs:
                if d.is_visible():
                    d.fill(digito)
                    print(f"    Digito preenchido OK (seletor: {sel})")
                    filled = True
                    break
        except Exception:
            continue
        if filled:
            break
    if not filled:
        print("    AVISO: Campo de dígito não encontrado")

try:
    page.fill("#input-senha", senha, timeout=5000)
    print("    Senha preenchida OK")
except Exception as e:
    print(f"    ERRO fill senha: {e}")

time.sleep(1)

# Clicar Acessar
print("[4] Clicando Acessar...")
clicked = False
for sel in ['button:has-text("Acessar")', 'button:has-text("Entrar")', 'button:has-text("Login")']:
    try:
        page.click(sel, timeout=3000)
        print(f"    Botao clicado OK ({sel})")
        clicked = True
        break
    except Exception:
        continue
if not clicked:
    try:
        page.evaluate("""() => {
            const btns = document.querySelectorAll('button, input[type="submit"]');
            for (const b of btns) {
                const t = b.textContent.toLowerCase();
                if (t.includes('acessar') || t.includes('entrar') || t.includes('login')) {
                    b.click(); return true;
                }
            }
            return false;
        }""")
        print("    Botao clicado via JS OK")
    except Exception as e:
        print(f"    ERRO click: {e}")

# Esperar
print("[5] Aguardando resultado...")
has_dashboard = False
for i in range(45):
    time.sleep(1)
    url = page.url
    try:
        body = page.inner_text("body")[:3000]
    except Exception:
        body = ""
    login_indicators = [
        "Tarefa SP", "Boletim", "Home", "Presença", "Agenda",
        "Perfil", "Materiais", "Redação", "Provas", "Carteirinha",
    ]
    has_text = any(x in body for x in login_indicators)
    url_changed = "/login" not in url.lower() and url != f"{SITE}/login-alunos"
    has_dashboard = has_text or url_changed
    print(f"    [{i+1}s] URL={url.split('/')[-1] or url.split('/')[-2]} dashboard={has_dashboard}")
    if has_dashboard:
        break

if not has_dashboard:
    print("\n[ERRO] Login falhou! Texto da pagina:")
    try:
        print(page.inner_text("body")[:500])
    except Exception:
        print("(nao foi possivel ler o texto)")
    page.close()
    ctx.close()
    browser.close()
    pw.stop()
    exit(1)

time.sleep(2)

print("\n[6] === LOGIN OK! ===")

# Nome da pagina
try:
    body = page.inner_text("body")[:2000]
    print(f"\n[7] Primeiras linhas da pagina:")
    for line in body.split("\n")[:20]:
        line = line.strip()
        if line:
            print(f"    | {line}")
except Exception:
    print("\n[7] Nao foi possivel ler o texto da pagina")

# localStorage
print("\n[8] localStorage:")
try:
    ls_data = page.evaluate("""() => {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            try { data[k] = localStorage.getItem(k); } catch(e) {}
        }
        return data;
    }""")
    for k, v in ls_data.items():
        val = v[:100] if len(str(v)) > 100 else v
        print(f"    {k} = {val}")
except Exception as e:
    print(f"    ERRO: {e}")

# sessionStorage
print("\n[9] sessionStorage:")
try:
    ss_data = page.evaluate("""() => {
        const data = {};
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            try { data[k] = sessionStorage.getItem(k); } catch(e) {}
        }
        return data;
    }""")
    for k, v in ss_data.items():
        val = v[:100] if len(str(v)) > 100 else v
        print(f"    {k} = {val}")
except Exception as e:
    print(f"    ERRO: {e}")

# Cookies
print("\n[10] Cookies:")
for c in ctx.cookies():
    print(f"    {c['name']} = {c['value'][:60]}")

# Testar API
print("\n[11] Testando API BFF...")
body_js = f"""async () => {{
    try {{
        const resp = await fetch('{BFF}/apiboletim/api/Boletim/GetBoletimCompleto', {{
            method: 'POST',
            credentials: 'include',
            headers: {{
                'Content-Type': 'application/json',
                'Ocp-Apim-Subscription-Key': '{KEY}',
                'Origin': '{SITE}',
                'Referer': '{SITE}/'
            }},
            body: JSON.stringify({{ra: '{ra_completo}'}}),
        }});
        const text = await resp.text();
        return {{ status: resp.status, body: text.substring(0, 500) }};
    }} catch(e) {{
        return {{ error: e.toString() }};
    }}
}}"""
result = page.evaluate(body_js)
print(f"    Status: {result.get('status')}")
print(f"    Body: {result.get('body', result.get('error', ''))[:300]}")

# Manter aberto para inspecionar
print("\n=== Pressione ENTER para fechar ===")
input()

page.close()
ctx.close()
browser.close()
pw.stop()
