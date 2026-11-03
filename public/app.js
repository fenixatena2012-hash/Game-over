import { initGame } from './game.js';

const $ = id => document.getElementById(id);
let currentUser = null;
let authMode = 'login';
let game = null;
const modal = $('authModal');

function showToast(message) {
  const el = $('gameToast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 2300);
}
function showAuth(mode) {
  authMode = mode;
  $('authTitle').textContent = mode === 'login' ? 'Entre no seu universo' : 'Crie sua conta';
  $('authSubtitle').textContent = mode === 'login' ? 'Acesse seu perfil PlaySpace.' : 'Escolha um nome para suas aventuras.';
  $('authSubmit').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
  $('authSwitch').firstChild.textContent = mode === 'login' ? 'Não tem conta? ' : 'Já tem uma conta? ';
  $('switchMode').textContent = mode === 'login' ? 'Criar conta' : 'Entrar';
  $('authMessage').textContent = '';
  modal.classList.remove('hidden');
}
function updateAccount() {
  const area = $('accountArea');
  if (!currentUser) {
    area.innerHTML = '<button class="btn btn-ghost" id="loginOpen">Entrar</button><button class="btn btn-primary" id="registerOpen">Criar conta</button>';
    $('loginOpen').onclick = () => showAuth('login');
    $('registerOpen').onclick = () => showAuth('register');
  } else {
    area.innerHTML = `<span class="muted" style="align-self:center">${currentUser.avatar || '🧭'} ${escapeHtml(currentUser.username)}</span><button class="btn btn-ghost" id="logoutButton">Sair</button>`;
    $('logoutButton').onclick = async () => {
      await fetch('/api/auth/logout', { method: 'POST' });
      currentUser = null; updateAccount();
    };
  }
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
async function loadMe() {
  try { const r = await fetch('/api/me'); const d = await r.json(); currentUser = d.user; } catch {}
  updateAccount();
}
$('loginOpen').onclick = () => showAuth('login');
$('registerOpen').onclick = () => showAuth('register');
$('heroRegister').onclick = () => showAuth('register');
$('modalClose').onclick = () => modal.classList.add('hidden');
$('switchMode').onclick = () => showAuth(authMode === 'login' ? 'register' : 'login');
modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
$('authForm').addEventListener('submit', async e => {
  e.preventDefault();
  const button = $('authSubmit'); button.disabled = true;
  try {
    const response = await fetch(`/api/auth/${authMode}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ username: $('authUsername').value, password: $('authPassword').value })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível autenticar.');
    currentUser = data.user; updateAccount(); modal.classList.add('hidden');
    $('authPassword').value = '';
    if (data.warning) alert(data.warning);
  } catch (err) { $('authMessage').textContent = err.message; }
  finally { button.disabled = false; }
});

async function openGame() {
  $('homeView').classList.add('hidden'); $('gameView').classList.remove('hidden');
  if (!game) {
    game = await initGame({
      mount: $('gameCanvas'),
      socket: window.io({ transports: ['websocket', 'polling'] }),
      user: currentUser,
      onToast: showToast
    });
    $('playerName').textContent = currentUser?.username || 'Visitante';
    $('playerAvatar').textContent = currentUser?.avatar || '🧭';
    $('connectionState').textContent = 'Mundo público';
  }
}
$('playButton').onclick = openGame;
$('backHome').onclick = () => { $('gameView').classList.add('hidden'); $('homeView').classList.remove('hidden'); };
$('inventoryButton').onclick = () => game?.toggleInventory(true);
$('inventoryClose').onclick = () => game?.toggleInventory(false);
$('saveButton').onclick = () => game?.save();
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  const input = $('chatInput'); const message = input.value.trim();
  if (message) { game?.sendChat(message); input.value = ''; }
});
$('chatInput').addEventListener('focus', () => game?.setChatFocused(true));
$('chatInput').addEventListener('blur', () => game?.setChatFocused(false));
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'e' && !$('gameView').classList.contains('hidden')) game?.toggleInventory();
});
loadMe();
