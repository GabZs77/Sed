"""
Flash v1.0 — Login com progresso em tempo real (SSE)
"""

import json
import re
import time
import uuid
import traceback
import threading
import requests
import os
from datetime import datetime
from queue import Queue

from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from playwright.sync_api import sync_playwright

app = Flask(__name__, static_folder="frontend")
CORS(app)

BFF = "https://sedintegracoes.educacao.sp.gov.br/saladofuturobffapi"
SITE = "https://saladofuturo.educacao.sp.gov.br"
KEY = "d701a2043aa24d7ebb37e9adf60d043b"
CMSP_API = "https://edusp-api.ip.tv"
CMSP_SITE = "https://cmsp.ip.tv"

sessoes = {}
sessoes_lock = threading.Lock()
SESSION_TTL = 3600
login_jobs = {}

# ── Navegador em thread unica ──────────────────────────────────────
# O Playwright NÃO é thread-safe: todos os acessos ao navegador devem
# acontecer numa única thread (worker). Usamos uma fila de trabalhos.
browser_queue = Queue()
browser_ready = threading.Event()
_worker_thread_id = None
pw_browser = None
pw_instance = None


def _log_error(msg, exc=None):
    """Grava erros num arquivo flash.log para diagnostico."""
    try:
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "flash.log"), "a", encoding="utf-8") as f:
            f.write(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
            if exc:
                f.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)) + "\n")
    except Exception:
        pass


def _browser_worker():
    """Thread unica que possui o navegador. Executa os trabalhos da fila."""
    global _worker_thread_id, pw_instance, pw_browser
    _worker_thread_id = threading.get_ident()
    try:
        pw_instance = sync_playwright().start()
        pw_browser = pw_instance.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
            ]
        )
        browser_ready.set()
    except Exception as e:
        _log_error("Falha ao iniciar navegador", e)
        browser_ready.set()
        return

    while True:
        job = browser_queue.get()
        if job is None:
            break
        func, res_q = job
        try:
            res_q.put(("ok", func()))
        except Exception as e:
            res_q.put(("error", e))


def browser_run(func, *args, timeout=180):
    """Executa uma funcao dentro da thread dona do navegador.
    Se ja estiver nessa thread, executa direto (evita deadlock)."""
    if threading.get_ident() == _worker_thread_id:
        return func(*args), None
    browser_ready.wait(timeout=30)
    res_q = Queue(maxsize=1)

    def _job():
        return func(*args)

    browser_queue.put((_job, res_q))
    try:
        tag, payload = res_q.get(timeout=timeout)
    except Exception:
        return None, "Timeout na operacao do navegador"
    if tag == "ok":
        return payload, None
    _log_error("Erro no browser_run", payload)
    return None, str(payload)


threading.Thread(target=_browser_worker, daemon=True).start()


def _get_browser():
    return pw_browser


def cleanup_expired_sessions():
    while True:
        time.sleep(120)
        now = time.time()
        expired = []
        with sessoes_lock:
            for sid, s in list(sessoes.items()):
                if now - s.get("created_at", 0) > SESSION_TTL:
                    expired.append(sid)
            for sid in expired:
                s = sessoes.pop(sid, None)
                if s:
                    browser_run(_close_session_resources, s, timeout=60)


threading.Thread(target=cleanup_expired_sessions, daemon=True).start()


def _close_session_resources(s):
    try:
        s["page"].close()
    except Exception:
        pass
    try:
        s["ctx"].close()
    except Exception:
        pass


def _visible_error_toast(page):
    """Retorna o texto de um aviso de erro VISIVEL na tela (toast/alert),
    ou '' se nao houver. Ignora elementos escondidos (que causavam
    falso positivo de 'RA ou senha invalidos')."""
    try:
        return page.evaluate("""() => {
            const sels = '[role="alert"], .toast, .alert, .error, .error-message, .mensagem-erro, .erro, .notification';
            const els = document.querySelectorAll(sels);
            for (const el of els) {
                try {
                    const style = window.getComputedStyle(el);
                    if (style.display === 'none' || style.visibility === 'hidden') continue;
                    const r = el.getBoundingClientRect();
                    if (r.width < 10 || r.height < 10) continue;
                    const t = (el.innerText || '').trim();
                    if (t.length > 3 && t.length < 300) return t;
                } catch(e) {}
            }
            return '';
        }""") or ""
    except Exception:
        return ""


def _parse_ra(ra_input):
    raw = ra_input.strip().upper().replace(" ", "")
    clean = raw.replace("SP", "")
    digito = ""
    if len(clean) >= 10 and clean[-1].isdigit():
        digito = clean[-1]
        clean = clean[:-1]
    if not clean.isdigit() and len(clean) > 1:
        digits_only = re.sub(r"[^0-9]", "", clean)
        if digits_only:
            clean = digits_only
    completo = clean + digito + "SP"
    return clean, digito, completo


def _fill_field(page, selector, value):
    try:
        page.fill(selector, value, timeout=8000)
        return True
    except Exception:
        pass
    try:
        el = page.query_selector(selector)
        if el:
            el.click()
            el.fill(value)
            return True
    except Exception:
        pass
    try:
        page.evaluate(f"document.querySelector('{selector}').value = ''")
        page.type(selector, value, delay=20)
        return True
    except Exception:
        pass
    return False


def _fill_digit_field(page, digito):
    selectors = [
        'input[name="digito-ra"]',
        '#input-digito',
        'input[placeholder*="dígito"]',
        'input[placeholder*="digito"]',
        'input[maxlength="2"]',
    ]
    for sel in selectors:
        try:
            els = page.query_selector_all(sel)
            for el in els:
                if el.is_visible():
                    el.fill(digito)
                    return True
        except Exception:
            continue
    return False


def _click_acessar(page):
    for sel in ['button:has-text("Acessar")', 'button:has-text("Entrar")', 'button:has-text("Login")']:
        try:
            page.click(sel, timeout=4000)
            return True
        except Exception:
            continue
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
        return True
    except Exception:
        pass
    return False


def _extract_name_from_page(page):
    try:
        return page.evaluate("""() => {
            const body = document.body.innerText;
            const lines = body.split('\\n').map(l => l.trim()).filter(l => l.length > 3);
            const skip = ['Tarefa', 'Home', 'Boletim', 'Agenda', 'Presença',
                'Perfil', 'Materiais', 'Redação', 'Provas', 'Pesquisa',
                'Carteirinha', 'Conquistas', 'Copa', 'Inscrição',
                'Avaliação', 'Plataformas', 'Mensagens', 'Minhas',
                'Sala do Futuro', 'logout', 'Sair', 'Configurações'];
            for (const line of lines) {
                if (line.includes(' ') && line.length > 5 && line.length < 60
                    && /^[A-ZÀ-Ú]/.test(line)
                    && line.split(' ').length >= 2
                    && !skip.some(s => line.includes(s))) {
                    return line;
                }
            }
            return '';
        }""")
    except Exception:
        return ''


def _extract_storage_data(page):
    try:
        return page.evaluate("""() => {
            const data = {};
            const tryParse = (v) => {
                if (typeof v !== 'string' || v.length < 5) return v;
                if (v[0] === '{' || v[0] === '[') {
                    try { return JSON.parse(v); } catch(e) { return v; }
                }
                const m = v.match(/\\{.*\\}|\\[.*\\]/s);
                if (m) {
                    try { return JSON.parse(m[0]); } catch(e) { return v; }
                }
                return v;
            };
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                try { data['ls_' + k] = tryParse(localStorage.getItem(k)); } catch(e) {}
            }
            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                try { data['ss_' + k] = tryParse(sessionStorage.getItem(k)); } catch(e) {}
            }
            return data;
        }""")
    except Exception:
        return {}


def _find_in_tree(obj, needle, path=""):
    found = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = k.lower()
            if needle in kl and isinstance(v, str) and len(v) > 10:
                found.append(v)
            found.extend(_find_in_tree(v, needle, path + "/" + k))
    elif isinstance(obj, list):
        for item in obj:
            found.extend(_find_in_tree(item, needle, path))
    return found


def _find_sed_token(all_data):
    for k, v in all_data.items():
        kl = k.lower()
        if "tokensed" in kl or "sed_token" in kl or "token_sed" in kl:
            if isinstance(v, str) and len(v) > 10:
                return v
    found = []
    for v in all_data.values():
        found.extend(_find_in_tree(v, "tokensed"))
        found.extend(_find_in_tree(v, "token_sed"))
        found.extend(_find_in_tree(v, "sed_token"))
    if found:
        return max(found, key=len)
    for k, v in all_data.items():
        kl = k.lower()
        if "token" in kl and isinstance(v, str) and len(v) > 10:
            return v
    for v in all_data.values():
        found = _find_in_tree(v, "token")
        if found:
            return max(found, key=len)
    return ""


def _find_token(all_data):
    for k, v in all_data.items():
        if "token" in k.lower() and isinstance(v, str) and len(v) > 20:
            return v
    found = []
    for v in all_data.values():
        found.extend(_find_in_tree(v, "token"))
    if found:
        return max(found, key=len)
    return ""


def _find_iptv_token(all_data):
    for k, v in all_data.items():
        kl = k.lower()
        if "iptvtoken" in kl or "iptv_token" in kl:
            if isinstance(v, str) and len(v) > 10:
                return v
    found = []
    for v in all_data.values():
        found.extend(_find_in_tree(v, "iptvtoken"))
        found.extend(_find_in_tree(v, "iptv_token"))
    if found:
        return max(found, key=len)
    return ""


def _find_secure_token(all_data):
    for k, v in all_data.items():
        kl = k.lower()
        if "securetoken" in kl or "secure_token" in kl:
            if isinstance(v, str) and len(v) > 10:
                return v
    found = []
    for v in all_data.values():
        found.extend(_find_in_tree(v, "securetoken"))
        found.extend(_find_in_tree(v, "secure_token"))
    if found:
        return max(found, key=len)
    return ""


def _find_codigo_aluno(all_data):
    needles = ["codigoaluno", "codigo_aluno", "cdaluno", "cd_aluno", "codaluno"]
    for k, v in all_data.items():
        kl = k.lower()
        if any(n in kl for n in needles) and isinstance(v, str) and len(v) >= 4:
            return v
    found = []
    for v in all_data.values():
        for n in needles:
            found.extend(_find_in_tree(v, n))
    if found:
        return max(found, key=len)
    return ""


def _find_ra_usuario(all_data, ra_clean, digito):
    for k, v in all_data.items():
        kl = k.lower()
        if isinstance(v, str) and len(v) >= 5:
            if any(x in kl for x in ["rausuario", "ra_usuario", "cdusuario", "cd_usuario"]):
                return v
    for k, v in all_data.items():
        kl = k.lower()
        if isinstance(v, str) and "ra" in kl and len(v) >= 8:
            return v
    return ra_clean + digito + "SP"


def _find_nome_from_storage(all_data):
    for k, v in all_data.items():
        if "nome" in k.lower() and isinstance(v, str) and len(v) > 3:
            return v
    return ""


def _find_profile(all_data):
    """Procura o objeto de perfil do aluno (com codigoAluno, nome, escola) no state do app."""
    profile_keys = ["codigoaluno", "cdaluno", "cd_aluno", "codigo_aluno"]
    for k, v in all_data.items():
        if isinstance(v, dict) and any(pk in k.lower() for pk in profile_keys):
            return v
        if isinstance(v, list):
            for item in v:
                if isinstance(item, dict) and any(pk in k.lower() for pk in profile_keys):
                    return item
    for k, v in all_data.items():
        if not isinstance(v, (dict, list)):
            continue
        stack = [v]
        while stack:
            node = stack.pop()
            if isinstance(node, dict):
                keys = {str(x).lower() for x in node.keys()}
                if any(pk in keys for pk in profile_keys):
                    return node
                stack.extend(node.values())
            elif isinstance(node, list):
                stack.extend(node)
    return {}


def login_sed_progress(ra_input, senha, q):
    # Toda a operacao com o navegador roda na thread dona do browser
    result, err = browser_run(_login_flow, ra_input, senha, q, timeout=180)
    if err:
        _log_error(f"browser_run do login falhou: {err}")
        q.put({"step": "error", "msg": "Nao foi possivel iniciar o navegador. Tente novamente."})


def _login_flow(ra_input, senha, q):
    try:
        q.put({"step": "browser", "msg": "Iniciando navegador...", "pct": 5})

        browser = _get_browser()
        if not browser:
            q.put({"step": "error", "msg": "Navegador indisponivel."})
            return
        ctx = browser.new_context(
            viewport={"width": 1280, "height": 720},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            locale="pt-BR",
        )
        page = ctx.new_page()

        q.put({"step": "site", "msg": "Acessando Sala do Futuro...", "pct": 10})

        try:
            page.goto(f"{SITE}/login-alunos", wait_until="domcontentloaded", timeout=30000)
        except Exception:
            try:
                page.goto(f"{SITE}/login-alunos", wait_until="commit", timeout=20000)
            except Exception:
                _close_session_resources({"page": page, "ctx": ctx})
                q.put({"step": "error", "msg": "Nao foi possivel acessar o site. Tente novamente."})
                return

        time.sleep(3)

        q.put({"step": "fill", "msg": "Preenchendo credenciais...", "pct": 25})

        ra_clean, digito, ra_completo = _parse_ra(ra_input)

        filled_ra = _fill_field(page, "#input-usuario-sed", ra_clean)
        if not filled_ra:
            _close_session_resources({"page": page, "ctx": ctx})
            q.put({"step": "error", "msg": "Campo RA nao encontrado na pagina."})
            return

        if digito:
            q.put({"step": "fill", "msg": "Preenchendo digito...", "pct": 35})
            _fill_digit_field(page, digito)

        q.put({"step": "fill", "msg": "Preenchendo senha...", "pct": 40})
        filled_senha = _fill_field(page, "#input-senha", senha)
        if not filled_senha:
            _close_session_resources({"page": page, "ctx": ctx})
            q.put({"step": "error", "msg": "Campo senha nao encontrado na pagina."})
            return

        time.sleep(0.5)

        q.put({"step": "auth", "msg": "Autenticando...", "pct": 50})
        clicked = _click_acessar(page)
        if not clicked:
            _close_session_resources({"page": page, "ctx": ctx})
            q.put({"step": "error", "msg": "Botao de login nao encontrado."})
            return

        q.put({"step": "wait", "msg": "Aguardando autenticacao...", "pct": 60})

        logged_in = False
        login_error_msg = ""
        for i in range(45):
            time.sleep(1)
            pct = 60 + int((i / 45) * 30)
            q.put({"step": "wait", "msg": f"Autenticando... ({i+1}s)", "pct": min(pct, 88)})

            try:
                current_url = page.url
            except Exception:
                current_url = ""
            try:
                page_text = page.inner_text("body")[:3000]
            except Exception:
                page_text = ""

            login_indicators = [
                "Tarefa SP", "Boletim", "Home", "Presença",
                "Agenda", "Perfil", "Materiais", "Redação",
                "Provas", "Carteirinha", "Conquistas",
            ]
            has_text = any(x in page_text for x in login_indicators)
            url_changed = "/login" not in current_url.lower()
            on_dashboard = "/home" in current_url.lower() or current_url.rstrip("/") == SITE

            # 1) Sucesso primeiro — evita falso positivo de erro
            if has_text or url_changed or on_dashboard:
                logged_in = True
                break

            # 2) So acusa erro se houver um aviso VISIVEL na tela
            if not login_error_msg:
                err_toast = _visible_error_toast(page)
                if err_toast:
                    low_t = err_toast.lower()
                    for kw in ["inválid", "incorret", "senha errada", "credenciais",
                               "dados incorretos", "não encontrado", "usuario ou senha",
                               "usuário ou senha", "bloquead"]:
                        if kw in low_t:
                            login_error_msg = "RA ou senha invalidos."
                            break

        if not logged_in and not login_error_msg:
            error_text = ""
            try:
                error_text = page.inner_text("body")[:1000].lower()
            except Exception:
                pass
            toast = _visible_error_toast(page)
            if toast:
                low_t = toast.lower()
                if "bloquead" in low_t:
                    login_error_msg = "Conta bloqueada. Tente mais tarde."
                elif "inválid" in low_t or "incorret" in low_t or "senha errada" in low_t:
                    login_error_msg = "RA ou senha invalidos."
            elif "bloquead" in error_text:
                login_error_msg = "Conta bloqueada. Tente mais tarde."

        if not logged_in:
            _close_session_resources({"page": page, "ctx": ctx})
            q.put({"step": "error", "msg": login_error_msg or "Falha no login. Verifique RA e senha."})
            return

        q.put({"step": "token", "msg": "Coletando dados da sessao...", "pct": 90})

        # Pequena espera para a tela inicial montar (sem paginas extras)
        time.sleep(2)

        all_data = {}
        token = ""
        sed_token = ""
        iptv_token = ""
        secure_token = ""
        codigo_aluno = ""
        # 1 tentativa: o state do app e criptografado, entao nao perde
        # tempo com retries — login tem que ser RAPIDO
        all_data = _extract_storage_data(page)
        token = _find_token(all_data)
        sed_token = _find_sed_token(all_data)
        iptv_token = _find_iptv_token(all_data)
        secure_token = _find_secure_token(all_data)
        codigo_aluno = _find_codigo_aluno(all_data)

        nome = _extract_name_from_page(page)
        ra_usuario = _find_ra_usuario(all_data, ra_clean, digito)

        if not nome:
            nome = _find_nome_from_storage(all_data)

        if not (token or sed_token):
            _log_error("[login-aviso] nenhum token encontrado no storage. chaves: "
                       + json.dumps(list(all_data.keys()), ensure_ascii=False))

        # Perfil do aluno direto do state do app (nome, codigo, escola, serie)
        profile = _find_profile(all_data)
        if profile:
            _log_error("[login-aviso] perfil do aluno encontrado: "
                       + json.dumps(profile, ensure_ascii=False)[:800])
        if not codigo_aluno and profile:
            for pk in ["codigoAluno", "cdAluno", "codigo_aluno", "cd_aluno"]:
                val = profile.get(pk)
                if isinstance(val, (str, int)) and str(val).strip():
                    codigo_aluno = str(val)
                    break

        # Dump completo para analise (sem valores sensiveis grandes)
        try:
            safe_dump = {}
            for k, v in all_data.items():
                try:
                    s = json.dumps(v, ensure_ascii=False)
                except Exception:
                    s = str(v)
                if len(s) > 200:
                    s = s[:200] + "...[truncado]"
                safe_dump[k] = s
            with open("sdf_state_dump.json", "w", encoding="utf-8") as f:
                json.dump(safe_dump, f, ensure_ascii=False, indent=1)
        except Exception as e:
            _log_error("dump de state falhou", e)

        cookies = ctx.cookies()
        cookies_dict = {c["name"]: c["value"] for c in cookies}

        sid = f"{ra_clean}_{int(time.time())}"
        session_data = {
            "page": page,
            "ctx": ctx,
            "token": token,
            "sed_token": sed_token,
            "iptv_token": iptv_token,
            "secure_token": secure_token,
            "codigo_aluno": codigo_aluno,
            "cookies": cookies_dict,
            "all_data": all_data,
            "profile": profile,
            "ra_usuario": ra_usuario,
            "ra_completo": ra_completo,
            "ra_clean": ra_clean,
            "digito": digito,
            "nome": nome,
            "created_at": time.time(),
            "page_lock": threading.Lock(),
            "robo_cache": None,
            "api_capture": None,
            "last_heartbeat": time.time(),
        }

        with sessoes_lock:
            sessoes[sid] = session_data

        # Coleta AO VIVO durante o login: ja deixa tudo pronto para
        # o aluno entrar e ver tudo instantaneo
        try:
            q.put({"step": "collect", "msg": "Pegando boletim...", "pct": 91})
            results = {}
            for route, frags, key, msg in [
                ("/boletim", ["GetBoletimCompleto"], "boletim", "boletim"),
                ("/presenca", ["GetFrequenciaBimestreAtual", "GetFaltasBimestreAtual",
                               "ConsultaFrequenciaBimestre"], "presenca", "presenca"),
                ("/agenda", ["GetAgendaDia", "GetAgendaPeriodoEscola"], "agenda", "agenda"),
                ("/tarefas", ["/tms/task/todo", "/tms/task/"], "tarefas", "tarefas"),
            ]:
                q.put({"step": "collect", "msg": f"Coletando {msg} da sua conta...", "pct": 92})
                cap, cap_err = capture_sed(sid, route, frags, wait_ms=2500)
                if cap:
                    best = _pick_real_response(cap)
                    if best is not None:
                        results[key] = best
                        inner = best.get("data") if isinstance(best, dict) else None
                        _log_error(f"[collect-detail] {key}: envelope_keys={list(best.keys()) if isinstance(best, dict) else type(best).__name__}"
                                   f" data_tipo={type(inner).__name__}"
                                   f" data_keys={list(inner.keys()) if isinstance(inner, dict) else 'n/a'}"
                                   f" data_len={len(inner) if isinstance(inner, (list, dict)) else 'n/a'}"
                                   f" amostra={json.dumps(inner if not isinstance(inner, list) else inner[:1], ensure_ascii=False)[:400]}")
            if results:
                sessoes[sid]["api_capture"] = results
                _log_error("[collect-login] " + json.dumps(
                    {k: (len(v) if isinstance(v, list) else type(v).__name__) for k, v in results.items()},
                    ensure_ascii=False))
        except Exception as e:
            _log_error("coleta durante login", e)

        # Diagnostico: testa a API real na hora e guarda no flash.log
        try:
            cod = session_data.get("codigo_aluno") or ""
            cookie_nomes = list((session_data.get("cookies_dict") or {}).keys())
            _log_error(f"[login-aviso] cookies da sessao: {json.dumps(cookie_nomes, ensure_ascii=False)}")
            test_resp, test_err = fetch_sed(sid, "GET", "/api/Aluno/ObterAlunoPorCodigo",
                                            None, {"codigoAluno": cod} if cod else None)
            _log_error(f"[login-ok] sid={sid} token={len(token)} sed_token={len(sed_token)} "
                       f"iptv={len(iptv_token)} secure={len(secure_token)} codigo_aluno={cod!r} "
                       f"api_aluno={'OK' if test_resp is not None else ('ERRO: ' + str(test_err))}")
            if isinstance(test_resp, (dict, list)):
                try:
                    _log_error("[login-ok] ObterAlunoPorCodigo => " + json.dumps(test_resp, ensure_ascii=False)[:1500])
                except Exception:
                    pass
        except Exception as e:
            _log_error("teste de API no login falhou", e)

        # O robo entra e FICA na Sala do Futuro, pegando tudo sozinho
        threading.Thread(target=_robo_loop, args=(sid,), daemon=True).start()

        q.put({"step": "done", "msg": "Login concluido!", "pct": 100, "data": {
            "session_id": sid,
            "nome": nome,
            "ra": ra_completo,
        }})

    except Exception as e:
        _log_error("Erro no login", e)
        traceback.print_exc()
        q.put({"step": "error", "msg": f"Erro interno do servidor: {type(e).__name__}: {e}"})


def fetch_sed(sid, method, path, body=None, params=None):
    """Chama a API do Sala do Futuro. Tenta direto via requests (rapido)
    e, se falhar, usa a pagina logada (fallback)."""
    s = sessoes.get(sid)
    if not s:
        return None, "Sessao expirada"
    token = s.get("sed_token") or s.get("token") or ""

    headers = {
        "Content-Type": "application/json",
        "Ocp-Apim-Subscription-Key": KEY,
        "Authorization": f"Bearer {token}",
        "Origin": SITE,
        "Referer": SITE + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    # Cookies reais da sessao SED — a autenticacao pode ser via cookie
    cookies = {}
    for name, value in (s.get("cookies_dict") or {}).items():
        if isinstance(value, str) and value.strip() and value not in ("<null>", "null"):
            cookies[name] = value

    direct_err = None
    try:
        if method == "GET":
            r = requests.get(BFF + path, headers=headers, params=params, cookies=cookies, timeout=6)
        else:
            r = requests.post(BFF + path, headers=headers, json=body, params=params, cookies=cookies, timeout=6)
        if r.status_code in (200, 201, 202, 204):
            try:
                result = r.json()
            except Exception:
                result = r.text
            # Se a API respondeu SEM DADOS (envelope de erro/200 vazio),
            # tenta pela pagina logada — que tem a AUTENTICACAO REAL do app
            vazio = isinstance(result, dict) and result.get("data") in (None, [], {})
            if not vazio:
                return result, None
            page_result, page_err = browser_run(_fetch_sed_page, sid, method, path, body, params, timeout=90)
            if page_err is None and page_result is not None:
                return page_result, None
            return result, direct_err
        if r.status_code in (401, 403):
            direct_err = "Sessao expirada"
        else:
            direct_err = f"HTTP {r.status_code}"
    except Exception as e:
        direct_err = f"requests: {e}"

    # Fallback via pagina (cookies reais) — roda na thread do navegador
    result, err = browser_run(_fetch_sed_page, sid, method, path, body, params, timeout=90)
    if err:
        return None, direct_err or err
    return result, None


def _fetch_sed_page(sid, method, path, body, params):
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    token = s.get("sed_token") or s.get("token") or ""
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=60):
            return None
    try:
        body_json = json.dumps(body) if body else "null"
        params_str = ""
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            params_str = "?" + qs
        js = f"""async () => {{
            try {{
                const resp = await fetch('{BFF}{path}{params_str}', {{
                    method: '{method}',
                    credentials: 'include',
                    headers: {{
                        'Content-Type': 'application/json',
                        'Ocp-Apim-Subscription-Key': '{KEY}',
                        'Authorization': 'Bearer {token}',
                        'Origin': '{SITE}',
                        'Referer': '{SITE}/'
                    }},
                    body: {body_json},
                }});
                const text = await resp.text();
                try {{ return {{ ok: true, status: resp.status, data: JSON.parse(text) }}; }}
                catch(e) {{ return {{ ok: true, status: resp.status, data: text }}; }}
            }} catch(e) {{
                return {{ ok: false, error: e.toString() }};
            }}
        }}"""
        result = page.evaluate(js)
        if not result or not result.get("ok"):
            return None
        status = result.get("status", 0)
        data = result.get("data")
        if status in (401, 403):
            return None
        if isinstance(data, str) and "<!DOCTYPE" in data[:100].upper():
            return None
        return data
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


def capture_sed(sid, route, url_fragments, wait_ms=6000):
    """Navega para a pagina real do app (ex.: /boletim) e captura as
    respostas JSON das chamadas que o proprio app faz (auth real)."""
    s = sessoes.get(sid)
    if not s:
        return None, "Sessao expirada"
    result, err = browser_run(_capture_sed_flow, sid, route, url_fragments, wait_ms, timeout=120)
    if err:
        return None, err
    return result, None


def _capture_sed_flow(sid, route, url_fragments, wait_ms):
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=90):
            return None
    captured = {}

    def on_response(resp):
        try:
            url = resp.url
            if any(f in url for f in url_fragments):
                ct = resp.headers.get("content-type", "")
                if "json" in ct:
                    captured.setdefault(url, []).append(resp.json())
        except Exception:
            pass

    try:
        page.on("response", on_response)
        try:
            page.goto(SITE + route, wait_until="domcontentloaded", timeout=40000)
            page.wait_for_timeout(wait_ms)
        except Exception:
            return None
        finally:
            try:
                page.remove_listener("response", on_response)
            except Exception:
                pass
        return captured
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


def scrape_sed(sid, route, wait_ms=9000, extra_js=""):
    """ROBOZINHO: navega logado na pagina real (ex.: /boletim) e extrai
    o conteudo que esta RENDERIZADO na tela (tabelas, textos, links).
    E o que o aluno ve de verdade na Sala do Futuro."""
    s = sessoes.get(sid)
    if not s:
        return None, "Sessao expirada"
    result, err = browser_run(_scrape_sed_flow, sid, route, wait_ms, extra_js, timeout=150)
    if err:
        return None, err
    return result, None


def _scrape_sed_flow(sid, route, wait_ms, extra_js):
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=90):
            return None
    try:
        try:
            page.goto(SITE + route, wait_until="domcontentloaded", timeout=40000)
        except Exception as e:
            return None

        # Espera o app renderizar de verdade (tabelas aparecerem)
        loaded = False
        for _ in range(20):
            page.wait_for_timeout(500)
            try:
                check = page.evaluate("""() => {
                    const tables = document.querySelectorAll('table');
                    const text = document.body ? document.body.innerText : '';
                    return {
                        hasTable: tables.length > 0,
                        textLen: text ? text.length : 0,
                        onLogin: location.pathname.includes('login'),
                    };
                }""")
            except Exception:
                continue
            if check.get("onLogin"):
                return None
            if check.get("hasTable") or check.get("textLen", 0) > 500:
                loaded = True
                break

        if not loaded:
            page.wait_for_timeout(wait_ms)

        js = """() => {
            const out = { url: location.href, tables: [], text: '', html: '', cards: [] };

            // Todas as tabelas renderizadas na tela
            document.querySelectorAll('table').forEach(t => {
                const rows = [];
                t.querySelectorAll('tr').forEach(tr => {
                    const cells = [];
                    tr.querySelectorAll('th, td').forEach(c => {
                        const txt = (c.innerText || '').trim();
                        cells.push(txt);
                    });
                    if (cells.length) rows.push(cells);
                });
                if (rows.length) out.tables.push({ rows });
            });

            // Cards / blocos de conteudo (agenda, tarefas, materiais)
            document.querySelectorAll('[role="button"], .card, article, li').forEach(el => {
                const txt = (el.innerText || '').trim();
                if (txt && txt.length > 4 && txt.length < 300) {
                    if (out.cards.length < 60 && !out.cards.includes(txt)) out.cards.push(txt);
                }
            });

            const body = document.body;
            out.text = body ? body.innerText.slice(0, 60000) : '';
            out.html = body ? body.innerHTML.slice(0, 300000) : '';
            return out;
        }"""
        if extra_js:
            js = "async () => {" + extra_js + " return (() => { const out = {}; return out; })(); }"
        result = page.evaluate(js)
        return result
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


def capture_multi(sid, routes, url_fragments, wait_ms=6000):
    """Captura respostas navegando em varias rotas do app real."""
    results = {}
    errors = []
    for route in routes:
        cap, err = capture_sed(sid, route, url_fragments, wait_ms)
        if cap:
            results.update(cap)
        if err:
            errors.append(err)
    if not results:
        return None, "; ".join(errors) or "Nenhuma resposta capturada"
    return results, None


def fetch_cmsp(sid, method, path, body=None, params=None):
    """Chama a API do gerenciador de tarefas (TarefaSP / CMSP).
    Tenta direto via requests e, se falhar, usa a pagina logada."""
    s = sessoes.get(sid)
    if not s:
        return None, "Sessao expirada"
    auth_token = s.get("iptv_token") or s.get("secure_token") or s.get("token") or ""
    secure_token = s.get("secure_token") or ""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}",
        "_auth_token": auth_token,
        "secure_token": secure_token,
        "x-api-platform": "web",
        "x-captcha-token": "",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    }

    # Cookies da sessao CMSP (auth real do gerenciador)
    cookies = {}
    for name, value in (s.get("cookies_dict") or {}).items():
        if isinstance(value, str) and value.strip() and value not in ("<null>", "null"):
            cookies[name] = value

    direct_err = None
    try:
        if method == "GET":
            r = requests.get(CMSP_API + path, headers=headers, params=params, cookies=cookies, timeout=6)
        else:
            r = requests.post(CMSP_API + path, headers=headers, params=params, json=body, cookies=cookies, timeout=6)
        if r.status_code in (200, 201, 202, 204):
            try:
                result = r.json()
            except Exception:
                result = r.text
            vazio = isinstance(result, dict) and result.get("data") in (None, [], {})
            if not vazio:
                return result, None
            page_result, page_err = browser_run(_fetch_cmsp_page, sid, method, path, body, params, timeout=90)
            if page_err is None and page_result is not None:
                return page_result, None
            return result, direct_err
        if r.status_code in (401, 403):
            direct_err = "Sessao expirada"
        else:
            direct_err = f"HTTP {r.status_code}"
    except Exception as e:
        direct_err = f"requests: {e}"

    # Fallback via pagina logada no CMSP — roda na thread do navegador
    result, err = browser_run(_fetch_cmsp_page, sid, method, path, body, params, timeout=90)
    if err:
        return None, direct_err or err
    return result, None


def _fetch_cmsp_page(sid, method, path, body, params):
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=90):
            return None
    try:
        if not page.url.startswith(CMSP_SITE):
            try:
                page.goto(f"{CMSP_SITE}?realm=edusp&provider=seducsp_token&token={s.get('sed_token') or s.get('token') or ''}", wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(2500)
            except Exception:
                pass

        auth_token = s.get("iptv_token") or s.get("secure_token") or s.get("token") or ""
        secure_token = s.get("secure_token") or ""

        body_json = json.dumps(body) if body else "null"
        params_str = ""
        if params:
            qs = "&".join(f"{k}={v}" for k, v in params.items())
            params_str = "?" + qs

        js = f"""async () => {{
            try {{
                const resp = await fetch('{CMSP_API}{path}{params_str}', {{
                    method: '{method}',
                    credentials: 'include',
                    headers: {{
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer {auth_token}',
                        '_auth_token': '{auth_token}',
                        'secure_token': '{secure_token}',
                        'x-api-platform': 'web',
                        'x-captcha-token': '',
                    }},
                    body: {body_json},
                }});
                const text = await resp.text();
                try {{ return {{ ok: true, status: resp.status, data: JSON.parse(text) }}; }}
                catch(e) {{ return {{ ok: true, status: resp.status, data: text }}; }}
            }} catch(e) {{
                return {{ ok: false, error: e.toString() }};
            }}
        }}"""
        result = page.evaluate(js)
        if not result or not result.get("ok"):
            return None
        status = result.get("status", 0)
        data = result.get("data")
        if status in (401, 403):
            return None
        if isinstance(data, str) and "<!DOCTYPE" in data[:100].upper():
            return None
        return data
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


# ── Frontend ──────────────────────────────────────────────────────────
@app.route("/")
def idx():
    return send_from_directory("frontend", "index.html")

@app.route("/<path:p>")
def snd(p):
    return send_from_directory("frontend", p)


# ── Login SSE ─────────────────────────────────────────────────────────
@app.route("/api/login", methods=["POST"])
def do_login():
    data = request.get_json()
    ra = data.get("ra", "").strip()
    senha = data.get("senha", "").strip()
    if not ra or not senha:
        return jsonify({"ok": False, "error": "Preencha RA e senha."}), 400

    job_id = str(uuid.uuid4())
    q = Queue()
    login_jobs[job_id] = q

    t = threading.Thread(target=login_sed_progress, args=(ra, senha, q), daemon=True)
    t.start()

    def generate():
        while True:
            try:
                msg = q.get(timeout=120)
            except Exception:
                yield f"data: {json.dumps({'step': 'error', 'msg': 'Timeout no servidor.'})}\n\n"
                break

            yield f"data: {json.dumps(msg, ensure_ascii=False)}\n\n"

            if msg.get("step") in ("done", "error"):
                break

        login_jobs.pop(job_id, None)

    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ── Logout ────────────────────────────────────────────────────────────
@app.route("/api/logout", methods=["POST"])
def do_logout():
    d = request.get_json()
    sid = d.get("session_id", "")
    with sessoes_lock:
        s = sessoes.pop(sid, None)
    if s:
        browser_run(_close_session_resources, s, timeout=60)
    return jsonify({"ok": True})


# ── Heartbeat: o robo so funciona enquanto o site esta aberto ────────
@app.route("/api/heartbeat", methods=["POST"])
def do_heartbeat():
    try:
        d = request.get_json() or {}
        sid = d.get("session_id", "")
        closing = d.get("closing", False)
        with sessoes_lock:
            s = sessoes.get(sid)
        if s:
            s["last_heartbeat"] = time.time()
            if closing:
                # Navegador fechado / logout: o robo PARA de vez
                with sessoes_lock:
                    sessoes.pop(sid, None)
                browser_run(_close_session_resources, s, timeout=60)
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"ok": False})


# ── Helper ────────────────────────────────────────────────────────────
def get_user_ra(sid):
    with sessoes_lock:
        s = sessoes.get(sid)
    if not s:
        return None, "Sessao expirada"
    ra = s.get("ra_usuario") or s.get("ra_completo") or ""
    if not ra:
        ra = s.get("ra_clean", "") + s.get("digito", "") + "SP"
    return ra, None


# ── Escola / Serie / Ano do aluno (100% real) ─────────────────────────
@app.route("/api/aluno-info", methods=["POST"])
def do_aluno_info():
    """Retorna escola, serie, turma e ano letivo do aluno direto do SED."""
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401
        s = sessoes.get(sid)
        if not s:
            return jsonify({"ok": False, "error": "Sessao expirada"}), 401
        cod = s.get("codigo_aluno") or ""
        profile = s.get("profile") or {}

        aluno = None
        turmas = None
        if cod:
            aluno, _ = fetch_sed(sid, "GET", "/api/Aluno/ObterAlunoPorCodigo",
                                 None, {"codigoAluno": cod})
            turmas, _ = fetch_sed(sid, "GET", "/apihubintegracoes/api/v2/Turma/ListarTurmasPorAluno",
                                  None, {"codigoAluno": cod})
        if aluno is None:
            aluno, _ = fetch_sed(sid, "GET", "/api/Aluno/ObterAlunoPorCodigo",
                                 None, {"ra": ra} if not cod else None)

        escola = _find_escola_nome(aluno, turmas, s.get("all_data"), profile)
        serie = _find_serie(aluno, turmas, s.get("all_data"), profile)
        ano = _find_ano(aluno, turmas, s.get("all_data"), profile)

        # Escola/serie/ano REAIS vindos da agenda ja capturada do app
        agenda_cap = (s.get("api_capture") or {}).get("agenda")
        if isinstance(agenda_cap, dict):
            agenda_inner = agenda_cap.get("data")
            if isinstance(agenda_inner, dict):
                for chave in ("agendaAluno", "agendaEscola"):
                    lista = agenda_inner.get(chave)
                    if not (isinstance(lista, list) and lista):
                        continue
                    item = lista[0]
                    if not serie:
                        dt = item.get("descricaoTurma") or ""
                        if "serie" in dt.lower():
                            serie = dt.split("SERIE")[0].strip() + " SERIE"
                    if not ano:
                        al = item.get("anoLetivo")
                        if al:
                            ano = str(al)
                    if not escola:
                        eid = item.get("escolaId")
                        if eid:
                            esc, _ = fetch_sed(sid, "GET", "/apihubintegracoes/api/v2/Escola/ObterEscolaPorCodigo",
                                               None, {"codigoEscola": eid})
                            escola = _find_escola_nome(esc) or escola
                    if escola and serie and ano:
                        break

        info = {
            "escola": escola,
            "serie": serie,
            "turma": _find_turma(turmas, s.get("all_data"), profile, agenda_cap),
            "ano": ano,
            "nome": s.get("nome") or "",
            "aluno_raw": aluno if isinstance(aluno, (dict, list)) else None,
            "profile": profile if profile else None,
        }
        _log_error(f"[aluno-info] escola={escola!r} serie={serie!r} ano={ano!r}")
        return jsonify({"ok": True, "info": info})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


def _flatten_items(obj):
    """Achata objetos/listas numa lista de dicts para buscar campos."""
    items = []
    if isinstance(obj, dict):
        items.append(obj)
        for v in obj.values():
            items.extend(_flatten_items(v))
    elif isinstance(obj, list):
        for v in obj:
            items.extend(_flatten_items(v))
    return items


def _find_escola_nome(*sources):
    for src in sources:
        if src is None:
            continue
        for d in _flatten_items(src):
            if not isinstance(d, dict):
                continue
            for k, v in d.items():
                kl = k.lower()
                if ("escola" in kl or "instituicao" in kl or "unidade" in kl) and isinstance(v, str) and len(v) > 3:
                    return v
    return ""


def _find_serie(*sources):
    for src in sources:
        if src is None:
            continue
        for d in _flatten_items(src):
            if not isinstance(d, dict):
                continue
            for k, v in d.items():
                kl = k.lower()
                if ("serie" in kl or "anoescolar" in kl or "grau" in kl or "ano_letivo" in kl) and isinstance(v, str) and len(v) > 1:
                    return v
    return ""


def _find_turma(*sources):
    for src in sources:
        if src is None:
            continue
        for d in _flatten_items(src):
            if not isinstance(d, dict):
                continue
            for k, v in d.items():
                kl = k.lower()
                if "turma" in kl and isinstance(v, str) and len(v) > 0:
                    return v
    # Da descricaoTurma real ("1ª SERIE A TARDE ANUAL" => turma "A")
    for src in sources:
        if src is None:
            continue
        for d in _flatten_items(src):
            if not isinstance(d, dict):
                continue
            dt = d.get("descricaoTurma") or ""
            if "SERIE" in dt.upper():
                partes = dt.split()
                if len(partes) >= 3:
                    return partes[2]
    return ""


def _find_ano(*sources):
    for src in sources:
        if src is None:
            continue
        for d in _flatten_items(src):
            if not isinstance(d, dict):
                continue
            for k, v in d.items():
                kl = k.lower()
                if kl in ("ano", "anoletivo", "ano_letivo") and isinstance(v, (str, int)) and str(v).isdigit():
                    return str(v)
    return ""


# ── Boletim ───────────────────────────────────────────────────────────
@app.route("/api/boletim", methods=["POST"])
def do_boletim():
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401

        # 0) Resposta REAL capturada do proprio app (auth verdadeira)
        apc = (sessoes.get(sid) or {}).get("api_capture") or {}
        if apc.get("boletim") is not None:
            return jsonify({"ok": True, "data": apc["boletim"], "source": "app"})

        # 1) API REAL direta (instantanea) — e o que o app oficial usa
        cod = (sessoes.get(sid) or {}).get("codigo_aluno") or ""
        data, err2 = fetch_sed(sid, "POST", "/apiboletim/api/Boletim/GetBoletimCompleto",
                               {"ra": ra} if not cod else None,
                               {"codigoAluno": cod} if cod else None)
        if data is not None and isinstance(data, (dict, list)) and not str(data).startswith("<!"):
            return jsonify({"ok": True, "data": data, "source": "direct"})

        # 2) Captura as respostas REAIS do app logado
        cap, cap_err = capture_sed(sid, "/boletim", ["GetBoletimCompleto"], wait_ms=8000)
        if cap:
            data = list(cap.values())[0][0] if cap else None
            return jsonify({"ok": True, "data": data, "source": "app"})

        # 3) Ultimo recurso: robozinho extrai o que esta na tela
        scraped, scrape_err = scrape_sed(sid, "/boletim", wait_ms=9000)
        if scraped and (scraped.get("tables") or scraped.get("cards")):
            return jsonify({"ok": True, "data": scraped, "source": "scrape",
                            "scrape_err": scrape_err})

        return jsonify({"ok": True, "data": None, "note": (err2 or cap_err or scrape_err or "Dados indisponiveis")})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


# ── Frequencia ────────────────────────────────────────────────────────
@app.route("/api/frequencia", methods=["POST"])
def do_freq():
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401

        # 0) Resposta REAL capturada do proprio app (auth verdadeira)
        apc = (sessoes.get(sid) or {}).get("api_capture") or {}
        if apc.get("presenca") is not None:
            return jsonify({"ok": True, "data": apc["presenca"], "source": "app"})

        # 1) API REAL direta (instantanea)
        cod = (sessoes.get(sid) or {}).get("codigo_aluno") or ""
        data, err2 = fetch_sed(sid, "POST", "/apiboletim/api/Frequencia/GetFrequenciaBimestreAtual",
                               {"ra": ra} if not cod else None,
                               {"codigoAluno": cod} if cod else None)
        if data is not None and isinstance(data, (dict, list)):
            return jsonify({"ok": True, "data": data, "source": "direct"})

        # 2) Captura as respostas REAIS do app logado
        cap, cap_err = capture_sed(sid, "/presenca",
                                   ["GetFrequenciaBimestreAtual", "GetFaltasBimestreAtual",
                                    "ConsultaFrequenciaBimestre"], wait_ms=8000)
        if cap:
            data = list(cap.values())[0][0] if cap else None
            return jsonify({"ok": True, "data": data, "source": "app"})

        # 3) Ultimo recurso: robozinho extrai o que esta na tela
        scraped, scrape_err = scrape_sed(sid, "/presenca", wait_ms=9000)
        if scraped and (scraped.get("tables") or scraped.get("cards")):
            return jsonify({"ok": True, "data": scraped, "source": "scrape",
                            "scrape_err": scrape_err})

        return jsonify({"ok": True, "data": None, "note": (err2 or cap_err or scrape_err or "Dados indisponiveis")})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


# ── Tarefas ───────────────────────────────────────────────────────────
@app.route("/api/tarefas", methods=["POST"])
def do_tarefas():
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401

        # 0) Resposta REAL capturada do proprio app (auth verdadeira)
        apc = (sessoes.get(sid) or {}).get("api_capture") or {}
        if apc.get("tarefas") is not None:
            return jsonify({"ok": True, "data": apc["tarefas"], "source": "app"})

        # 1) API real do TarefaSP (gerenciador de tarefas do CMSP)
        tf3, _ = fetch_cmsp(sid, "GET", "/tms/task/todo", None, {"expired_only": "false"})
        count, _ = fetch_cmsp(sid, "GET", "/tms/task/todo/count", None)
        cats, _ = fetch_cmsp(sid, "GET", "/tms/category", None, {"realm": "edusp"})

        # 2) Robozinho entra no gerenciador REAL e captura as respostas /tms
        cap, cap_err = browser_run(_capture_cmsp_tasks, sid, timeout=150)

        # 3) Cards de tarefas renderizados de verdade na tela do CMSP
        scraped, scrape_err = browser_run(_scrape_cmsp_tasks, sid, timeout=150)

        return jsonify({"ok": True, "data": {
            "tarefasPendentes3": tf3,
            "tarefasCount": count,
            "categorias": cats,
            "captured": cap,
            "captured_err": cap_err,
            "scraped": scraped,
            "scrape_err": scrape_err,
        }})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


def _goto_task_manager(s, page):
    """Navega para o gerenciador de tarefas REAL do CMSP com o token SED."""
    token = s.get("sed_token") or s.get("token") or ""
    if not token:
        return False
    try:
        page.goto(f"{CMSP_SITE}?realm=edusp&provider=seducsp_token&token={token}",
                  wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(2500)
        return True
    except Exception:
        return False


def _capture_cmsp_tasks(sid):
    """Abre o gerenciador de tarefas real (CMSP) e captura as respostas
    JSON das chamadas /tms que o proprio app faz (dados 100% reais)."""
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=120):
            return None
    captured = {}

    def on_response(resp):
        try:
            url = resp.url
            if "/tms/" in url:
                ct = resp.headers.get("content-type", "")
                if "json" in ct:
                    captured.setdefault(url, []).append(resp.json())
        except Exception:
            pass

    try:
        _goto_task_manager(s, page)
        page.on("response", on_response)
        try:
            page.goto(f"{CMSP_SITE}?realm=edusp&provider=seducsp_token&token={s.get('sed_token') or s.get('token') or ''}",
                      wait_until="domcontentloaded", timeout=45000)
            page.wait_for_timeout(12000)
        except Exception:
            pass
        finally:
            try:
                page.remove_listener("response", on_response)
            except Exception:
                pass

        # Pega os tokens REAIS que o CMSP guarda no navegador
        try:
            ls = page.evaluate("""() => {
                const out = {};
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && (k.toLowerCase().includes('token') ||
                              k.toLowerCase().includes('auth') ||
                              k.toLowerCase().includes('secure'))) {
                        out[k] = localStorage.getItem(k);
                    }
                }
                return out;
            }""")
            if isinstance(ls, dict):
                s["iptv_token"] = s.get("iptv_token") or (ls.get("autenticacao.iptvToken") or "")
                s["secure_token"] = s.get("secure_token") or (ls.get("secure_token") or "")
                s["_auth_token"] = s.get("_auth_token") or (ls.get("_auth_token") or "")
                s["codigo_aluno"] = s.get("codigo_aluno") or (ls.get("codigoAluno") or "")
        except Exception:
            pass
        return captured
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


def _scrape_cmsp_tasks(sid, wait_ms=12000):
    """Extrai os cards de tarefas RENDERIZADOS no gerenciador real (CMSP),
    filtrando itens de navegacao/menu que pareciam dados simulados."""
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=120):
            return None
    try:
        _goto_task_manager(s, page)
        page.wait_for_timeout(wait_ms)
        js = """() => {
            const out = { url: location.href, tasks: [], text: '' };
            const seen = new Set();
            const navWords = ['inicio','início','boletim','presen','agenda','tarefas',
                'materiais','perfil','sair','logout','home','reda','provas',
                'carteirinha','conquistas','voltar','configura','ajuda','perguntas'];
            document.querySelectorAll('article, .MuiCard-root, [class*="card"], [class*="Card"], li, [role="button"]').forEach(el => {
                const txt = (el.innerText || '').trim();
                if (!txt || txt.length < 5 || txt.length > 400) return;
                if (seen.has(txt)) return;
                const low = txt.toLowerCase();
                if (navWords.some(w => low === w || low.startsWith(w + '\\n'))) return;
                seen.add(txt);
                out.tasks.push(txt);
            });
            const body = document.body;
            out.text = body ? body.innerText.slice(0, 80000) : '';
            return out;
        }"""
        return page.evaluate(js)
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


# ── Robo: compartilhamento de tela da Sala do Futuro ────────────────
ROBO_ROUTES = ["/home", "/boletim", "/presenca", "/agenda", "/tarefas", "/materiais"]


@app.route("/api/robo-data", methods=["POST"])
def do_robo_data():
    """Retorna os dados que o robo ja pegou da Sala do Futuro.
    Nunca bloqueia: se ainda nao pegou, devolve 'pending' e o robo
    preenche sozinho em segundo plano (sem travar as consultas)."""
    try:
        sid = request.get_json().get("session_id", "")
        s = sessoes.get(sid)
        if not s:
            return jsonify({"ok": False, "error": "Sessao expirada"}), 401
        cache = s.get("robo_cache")
        if cache and isinstance(cache, dict) and cache.get("pages"):
            return jsonify({"ok": True, "pages": cache["pages"], "ts": cache.get("ts", 0)})
        return jsonify({"ok": True, "pages": None, "pending": True})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/robo-trigger", methods=["POST"])
def do_robo_trigger():
    """Manda o robo entrar agora (usado no login, logout e ao fechar a pagina)."""
    try:
        d = request.get_json() or {}
        sid = d.get("session_id", "")
        s = sessoes.get(sid)
        if s:
            threading.Thread(target=_robo_refresh_now, args=(sid,), daemon=True).start()
        return jsonify({"ok": True})
    except Exception:
        return jsonify({"ok": False})


def _robo_refresh_now(sid):
    s = sessoes.get(sid)
    if not s:
        return
    try:
        pages, err = robo_snapshot(sid, ROBO_ROUTES)
        if not err and pages:
            s["robo_cache"] = {"pages": pages, "ts": time.time()}
    except Exception as e:
        _log_error("robo_refresh_now", e)


def _capture_all_pages(sid):
    """Navega nas paginas reais do app e guarda as respostas JSON que o
    proprio app recebe (auth real). E a reserva garantida de dados."""
    s = sessoes.get(sid)
    if not s:
        return
    try:
        results = {}
        for route, frags, key in [
            ("/boletim", ["GetBoletimCompleto"], "boletim"),
            ("/presenca", ["GetFrequenciaBimestreAtual", "GetFaltasBimestreAtual",
                           "ConsultaFrequenciaBimestre"], "presenca"),
            ("/agenda", ["GetAgendaDia", "GetAgendaPeriodoEscola"], "agenda"),
            ("/tarefas", ["/tms/task/todo", "/tms/task/"], "tarefas"),
        ]:
            cap, err = capture_sed(sid, route, frags, wait_ms=7000)
            if cap:
                best = _pick_real_response(cap)
                if best is not None:
                    results[key] = best
        if results:
            s["api_capture"] = results
            _log_error("[capture-ok] " + json.dumps(
                {k: (type(v).__name__ if not isinstance(v, (dict, list)) else (len(v) if isinstance(v, list) else list(v.keys())))
                 for k, v in results.items()}, ensure_ascii=False))
    except Exception as e:
        _log_error("capture_all_pages", e)


def _pick_real_response(captured):
    """Escolhe a primeira resposta capturada que tenha dados de verdade."""
    for url, items in captured.items():
        for item in items:
            data = item
            if isinstance(item, dict):
                data = item.get("data", item.get("Data", item))
            if isinstance(data, list) and len(data):
                return item
            if isinstance(data, dict) and data:
                return item
    return None


def _robo_loop(sid):
    """O robo visita as paginas e guarda tudo ENQUANTO o site do aluno
    estiver aberto e logado. Se o site fechar (sem heartbeat), o robo
    para para nao ficar em conflito."""
    while True:
        time.sleep(60)
        s = sessoes.get(sid)
        if not s:
            return
        # Sem batimento do site por >2 min => navegador fechou => robo para
        if time.time() - s.get("last_heartbeat", 0) > 120:
            with sessoes_lock:
                sessoes.pop(sid, None)
            browser_run(_close_session_resources, s, timeout=60)
            return
        cache = s.get("robo_cache")
        if cache and time.time() - cache.get("ts", 0) < 150:
            continue
        _robo_refresh_now(sid)


@app.route("/api/robo-snapshot", methods=["POST"])
def do_robo_snapshot():
    """Robozinho entra na Sala do Futuro REAL e manda um print + conteudo
    de cada pagina, como se estivesse compartilhando a tela."""
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401
        pages, err2 = robo_snapshot(sid, ROBO_ROUTES)
        if err2:
            return jsonify({"ok": False, "error": err2})
        s = sessoes.get(sid)
        if s:
            s["robo_cache"] = {"pages": pages, "ts": time.time()}
        return jsonify({"ok": True, "pages": pages})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


def robo_snapshot(sid, routes):
    result, err = browser_run(_robo_snapshot_flow, sid, routes, timeout=420)
    if err:
        return None, err
    return result, None


def _robo_snapshot_flow(sid, routes):
    """Navega nas paginas REAIS da Sala do Futuro, tira print de cada uma
    e extrai tudo que esta renderizado (tabelas, cards, links, texto)."""
    import base64
    s = sessoes.get(sid)
    if not s:
        return None
    page = s["page"]
    lock = s.get("page_lock")
    if lock:
        if not lock.acquire(timeout=300):
            return None
    pages = []
    try:
        for route in routes:
            try:
                page.goto(SITE + route, wait_until="domcontentloaded", timeout=45000)
            except Exception:
                pass
            page.wait_for_timeout(7000)

            info = {"route": route, "url": "", "title": "", "onLogin": False,
                    "screenshot_b64": "", "tables": [], "cards": [], "links": [],
                    "text": ""}
            try:
                info.update(page.evaluate("""() => {
                    const out = {
                        url: location.href,
                        title: document.title,
                        onLogin: location.pathname.includes('login'),
                        tables: [], cards: [], links: [],
                        text: document.body ? document.body.innerText.slice(0, 80000) : ''
                    };
                    document.querySelectorAll('table').forEach(t => {
                        const rows = [];
                        t.querySelectorAll('tr').forEach(tr => {
                            const cells = [];
                            tr.querySelectorAll('th, td').forEach(c => cells.push((c.innerText || '').trim()));
                            if (cells.length) rows.push(cells);
                        });
                        if (rows.length) out.tables.push(rows);
                    });
                    const seen = new Set();
                    document.querySelectorAll('article, .MuiCard-root, [class*="card"], [class*="Card"], li, [role="button"]').forEach(el => {
                        const txt = (el.innerText || '').trim();
                        if (!txt || txt.length < 4 || txt.length > 400 || seen.has(txt)) return;
                        seen.add(txt);
                        out.cards.push(txt);
                    });
                    document.querySelectorAll('a').forEach(a => {
                        const t = (a.innerText || '').trim();
                        const h = a.href || '';
                        if (t && t.length < 120 && h) out.links.push({ text: t, href: h });
                    });
                    return out;
                }"""))
            except Exception:
                pass
            try:
                shot = page.screenshot(type="jpeg", quality=70)
                info["screenshot_b64"] = base64.b64encode(shot).decode()
            except Exception:
                pass
            pages.append(info)
        return pages
    except Exception:
        return None
    finally:
        if lock:
            lock.release()


# ── Agenda ────────────────────────────────────────────────────────────
@app.route("/api/agenda", methods=["POST"])
def do_agenda():
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401

        # 0) Resposta REAL capturada do proprio app (auth verdadeira)
        apc = (sessoes.get(sid) or {}).get("api_capture") or {}
        if apc.get("agenda") is not None:
            return jsonify({"ok": True, "data": apc["agenda"], "source": "app"})

        # 1) API REAL direta (instantanea)
        cod = (sessoes.get(sid) or {}).get("codigo_aluno") or ""
        data, err2 = fetch_sed(sid, "POST", "/apiboletim/api/Agenda/GetAgendaDia",
                               {"ra": ra} if not cod else None,
                               {"codigoAluno": cod} if cod else None)
        if data is not None and isinstance(data, (dict, list)):
            return jsonify({"ok": True, "data": data, "source": "direct"})

        # 2) Captura as respostas REAIS do app logado
        cap, cap_err = capture_sed(sid, "/agenda",
                                   ["GetAgendaDia", "GetAgendaPeriodoEscola"], wait_ms=8000)
        if cap:
            data = list(cap.values())[0][0] if cap else None
            return jsonify({"ok": True, "data": data, "source": "app"})

        # 3) Ultimo recurso: robozinho extrai o que esta na tela
        scraped, scrape_err = scrape_sed(sid, "/agenda", wait_ms=9000)
        if scraped and (scraped.get("tables") or scraped.get("cards")):
            return jsonify({"ok": True, "data": scraped, "source": "scrape",
                            "scrape_err": scrape_err})

        return jsonify({"ok": True, "data": None, "note": (err2 or cap_err or scrape_err or "Dados indisponiveis")})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


# ── Materiais ─────────────────────────────────────────────────────────
@app.route("/api/materiais", methods=["POST"])
def do_materiais():
    try:
        sid = request.get_json().get("session_id", "")
        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401
        # Materiais Digitais = Repositorio (abre com o token SED real)
        s = sessoes.get(sid)
        token = (s or {}).get("sed_token") or (s or {}).get("token") or ""
        data, _ = fetch_sed(sid, "GET", "/muralavisosapi/api/conteudo-digital/listar-qtde-subcategoria?", None)
        return jsonify({"ok": True, "data": data,
                        "repositorio_url": "https://repositorio.educacao.sp.gov.br/Autenticacao?t=" + token})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


# ── Resolver Tarefa ───────────────────────────────────────────────────
@app.route("/api/resolver-tarefa", methods=["POST"])
def do_resolver_tarefa():
    try:
        req = request.get_json() or {}
        sid = req.get("session_id", "")
        tarefa_id = req.get("tarefa_id")
        rascunho = req.get("rascunho", False)

        ra, err = get_user_ra(sid)
        if not ra:
            return jsonify({"ok": False, "error": err}), 401

        # 1) Tenta a API real do TarefaSP (CMSP Task Manager)
        status = "draft" if rascunho else "submitted"
        s = sessoes.get(sid)
        nick = (s or {}).get("ra_usuario") or ra

        cmsp_data, cmsp_err = fetch_cmsp(sid, "POST", "/tms/answer",
                                         {
                                             "task_id": str(tarefa_id),
                                             "status": status,
                                             "answers": {},
                                         },
                                         {"nick": str(nick)})
        if cmsp_data is not None:
            return jsonify({"ok": True, "data": cmsp_data, "source": "cmsp", "error": cmsp_err})

        # 2) Fallback: endpoint do BFF do Sala do Futuro
        endpoint = "/apihubintegracoes/api/v2/Tarefa/SalvarResposta" if rascunho else "/apihubintegracoes/api/v2/Tarefa/FinalizarTarefa"
        data, err = fetch_sed(sid, "POST", endpoint, {
            "ra": ra,
            "tarefaId": tarefa_id,
            "rascunho": rascunho
        })

        return jsonify({"ok": data is not None, "data": data, "source": "bff", "error": err or cmsp_err})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)})


# ── Debug ─────────────────────────────────────────────────────────────
@app.route("/api/debug", methods=["POST"])
def do_debug():
    sid = request.get_json().get("session_id", "")
    with sessoes_lock:
        s = sessoes.get(sid)
    if not s:
        return jsonify({"ok": False})
    return jsonify({"ok": True, "data": {
        "nome": s.get("nome"),
        "ra_usuario": s.get("ra_usuario"),
        "ra_completo": s.get("ra_completo"),
        "token": (s.get("token") or "")[:50],
        "sed_token": (s.get("sed_token") or "")[:50],
        "iptv_token": (s.get("iptv_token") or "")[:50],
        "secure_token": (s.get("secure_token") or "")[:50],
        "all_data_keys": list(s.get("all_data", {}).keys()),
        "cookies": list(s.get("cookies", {}).keys()),
    }})


@app.route("/api/health")
def health():
    with sessoes_lock:
        n = len(sessoes)
    return jsonify({"ok": True, "v": "1.0", "sessions": n})


if __name__ == "__main__":
    import socket
    try:
        ip = socket.gethostbyname(socket.gethostname())
    except Exception:
        ip = "localhost"
    print("=" * 50)
    print("  Flash v1.0 — Login com progresso em tempo real")
    print(f"  http://localhost:5000")
    print(f"  http://{ip}:5000")
    print("=" * 50)
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
