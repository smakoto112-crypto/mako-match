let token = localStorage.getItem("mako_token") || "";
let mode = "login";
let currentMatch = null;
const $ = id => document.getElementById(id);

async function api(url, options={}) {
  options.headers = { ...(options.headers || {}), "Content-Type":"application/json" };
  if (token) options.headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, options);
  const data = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(data.error || "エラーが発生しました");
  return data;
}

function setMode(next) {
  mode = next;
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active", b.dataset.mode===mode));
  $("registerFields").classList.toggle("hidden", mode !== "register");
  $("authSubmit").textContent = mode === "register" ? "18歳以上として登録" : "ログイン";
  $("password").autocomplete = mode === "register" ? "new-password" : "current-password";
}

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>setMode(b.dataset.mode));

$("authForm").onsubmit = async e => {
  e.preventDefault();
  $("authError").textContent = "";
  try {
    const body = { email:$("email").value, password:$("password").value };
    let data;
    if (mode === "register") {
      Object.assign(body,{nickname:$("nickname").value,birthDate:$("birthDate").value,bio:$("bio").value});
      data = await api("/api/register",{method:"POST",body:JSON.stringify(body)});
    } else {
      data = await api("/api/login",{method:"POST",body:JSON.stringify(body)});
    }
    token = data.token;
    localStorage.setItem("mako_token",token);
    await showApp();
  } catch(e) { $("authError").textContent = e.message; }
};

async function showApp() {
  try {
    const me = await api("/api/me");
    $("auth").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("logout").classList.remove("hidden");
    $("hello").textContent = `${me.nickname} さん`;
    $("pNickname").value = me.nickname;
    $("pBio").value = me.bio || "";
    await loadUsers();
  } catch {
    token = ""; localStorage.removeItem("mako_token");
    $("auth").classList.remove("hidden");
  }
}

async function loadUsers() {
  const q = $("search").value.trim();
  const users = await api("/api/users?q="+encodeURIComponent(q));
  $("users").innerHTML = users.length ? users.map(u => `
    <article class="user">
      <div class="avatar">💕</div>
      <h3>${esc(u.nickname)}</h3>
      <div class="small">${age(u.birth_date)}歳</div>
      <p>${esc(u.bio || "自己紹介はまだありません。")}</p>
      <div class="actions">
        <button class="like" onclick="likeUser(${u.id})">いいね</button>
        <button class="danger" onclick="blockUser(${u.id})">ブロック</button>
        <button onclick="reportUser(${u.id})">通報</button>
      </div>
    </article>`).join("") : `<div class="card">見つかりませんでした。</div>`;
}

async function likeUser(id) {
  try {
    const r = await api(`/api/users/${id}/like`,{method:"POST"});
    alert(r.matched ? "マッチしました！💕" : "いいねしました！");
    await loadUsers();
    await loadMatches();
  } catch(e){ alert(e.message); }
}
async function blockUser(id) {
  if (!confirm("このユーザーをブロックしますか？")) return;
  try { await api(`/api/users/${id}/block`,{method:"POST"}); await loadUsers(); }
  catch(e){ alert(e.message); }
}
async function reportUser(id) {
  const reason = prompt("通報理由を入力してください");
  if (!reason) return;
  try { await api(`/api/users/${id}/report`,{method:"POST",body:JSON.stringify({reason})}); alert("通報を受け付けました。"); }
  catch(e){ alert(e.message); }
}

async function loadMatches() {
  const rows = await api("/api/matches");
  $("matchList").innerHTML = rows.length ? rows.map(m=>`
    <div class="match" onclick="openChat(${m.id},'${esc(m.nickname)}')">
      <strong>💕 ${esc(m.nickname)}</strong><span>チャット →</span>
    </div>`).join("") : `<div class="card">まだマッチしていません。</div>`;
}

async function openChat(id,name) {
  currentMatch = id;
  $("chatTitle").textContent = name;
  $("chat").classList.remove("hidden");
  $("matchList").classList.add("hidden");
  await loadMessages();
}
async function loadMessages() {
  if (!currentMatch) return;
  const rows = await api(`/api/matches/${currentMatch}/messages`);
  $("messages").innerHTML = rows.map(m=>`<div class="msg ${m.sender_id === Number(window.meId) ? "mine":""}">${esc(m.body)}</div>`).join("");
  $("messages").scrollTop = $("messages").scrollHeight;
}
$("messageForm").onsubmit = async e => {
  e.preventDefault();
  const input = $("messageInput");
  try { await api(`/api/matches/${currentMatch}/messages`,{method:"POST",body:JSON.stringify({body:input.value})}); input.value=""; await loadMessages(); }
  catch(e){ alert(e.message); }
};
$("backMatches").onclick=()=>{$("chat").classList.add("hidden");$("matchList").classList.remove("hidden");};

document.querySelectorAll(".navbtn").forEach(b=>b.onclick=async()=>{
  document.querySelectorAll(".navbtn").forEach(x=>x.classList.remove("active")); b.classList.add("active");
  document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));
  $(b.dataset.page).classList.remove("hidden");
  if (b.dataset.page==="matches") await loadMatches();
});

$("searchBtn").onclick=loadUsers;
$("search").onkeydown=e=>{if(e.key==="Enter")loadUsers();};

$("profileForm").onsubmit=async e=>{
  e.preventDefault();
  try { const me=await api("/api/me",{method:"PUT",body:JSON.stringify({nickname:$("pNickname").value,bio:$("pBio").value})}); $("hello").textContent=`${me.nickname} さん`; $("profileMsg").textContent="保存しました。"; }
  catch(e){ $("profileMsg").textContent=e.message; }
};

$("logout").onclick=async()=>{
  try{await api("/api/logout",{method:"POST"});}catch{}
  token=""; localStorage.removeItem("mako_token"); location.reload();
};

function age(date){const d=new Date(date+"T00:00:00"),n=new Date();let a=n.getFullYear()-d.getFullYear();if(n.getMonth()<d.getMonth()||(n.getMonth()===d.getMonth()&&n.getDate()<d.getDate()))a--;return a;}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}

(async()=>{
  try{const me=await api("/api/me");window.meId=me.id;await showApp();}catch{}
})();