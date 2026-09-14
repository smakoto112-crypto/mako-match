let token = localStorage.getItem("mako_token") || "";
let mode = "login";
let currentMatch = null;
let meId = null;

const $ = id => document.getElementById(id);

async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json"
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  const r = await fetch(url, options);
  const data = await r.json().catch(() => ({}));

  if (!r.ok) {
    throw new Error(data.error || "エラーが発生しました");
  }

  return data;
}


/* =========================
   ログイン・登録
========================= */

function setMode(next) {
  mode = next;

  const loginForm = $("loginForm");
  const registerForm = $("registerForm");

  if (mode === "login") {
    loginForm.hidden = false;
    registerForm.hidden = true;
  } else {
    loginForm.hidden = true;
    registerForm.hidden = false;
  }

  $("authMessage").textContent = "";
}


/* =========================
   ログイン
========================= */

async function login() {
  $("authMessage").textContent = "";

  try {
    const email = $("loginUsername").value.trim();
    const password = $("loginPassword").value;

    if (!email || !password) {
      throw new Error("メールアドレスとパスワードを入力してください");
    }

    const r = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password
      })
    });

    token = r.token;
    localStorage.setItem("mako_token", token);

    await showApp();

  } catch (e) {
    $("authMessage").textContent = e.message;
  }
}


/* =========================
   新規登録
========================= */

async function register() {
  $("authMessage").textContent = "";

  try {
    const email = $("registerUsername").value.trim();
    const password = $("registerPassword").value;
    const age = Number($("registerAge").value);
    const gender = $("registerGender").value;
    const area = $("registerArea").value;
    const agreed = $("agreeTerms").checked;

    if (!email || !password) {
      throw new Error("メールアドレスとパスワードを入力してください");
    }

    if (password.length < 8) {
      throw new Error("パスワードは8文字以上にしてください");
    }

    if (age < 18) {
      throw new Error("18歳以上のみ登録できます");
    }

    if (!gender) {
      throw new Error("性別を選択してください");
    }

    if (!area) {
      throw new Error("地域を選択してください");
    }

    if (!agreed) {
      throw new Error("利用規約とプライバシーポリシーに同意してください");
    }

    /* 年齢から誕生日を作成 */
    const today = new Date();
    const birthYear = today.getFullYear() - age;
    const birthDate =
      birthYear +
      "-" +
      String(today.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(today.getDate()).padStart(2, "0");

    const r = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        nickname: email.split("@")[0],
        birthDate,
        gender,
        area,
        bio: "",
        agreed: true
      })
    });

    token = r.token;
    localStorage.setItem("mako_token", token);

    await showApp();

  } catch (e) {
    $("authMessage").textContent = e.message;
  }
}


/* =========================
   アプリ表示
========================= */

async function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;

  try {
    const me = await api("/api/me");

    meId = me.id;

    $("meInfo").textContent =
      `${me.nickname} / ${age(me.birth_date)}歳`;

    fillProfile(me);

    await searchUsers();
    await loadMatches();

  } catch (e) {
    token = "";
    localStorage.removeItem("mako_token");
    $("auth").hidden = false;
    $("app").hidden = true;
  }
}


/* =========================
   プロフィール
========================= */

function fillProfile(me) {
  $("profileName").value = me.nickname || "";
  $("profileAge").value = age(me.birth_date);
  $("profileGender").value = me.gender || "";
  $("profileArea").value = me.area || "";
  $("profileBio").value = me.bio || "";
}

async function saveProfile() {
  $("profileMessage").textContent = "";

  try {
    const me = await api("/api/me", {
      method: "PUT",
      body: JSON.stringify({
        nickname: $("profileName").value.trim(),
        gender: $("profileGender").value,
        area: $("profileArea").value,
        bio: $("profileBio").value.trim()
      })
    });

    $("meInfo").textContent =
      `${me.nickname} / ${age(me.birth_date)}歳`;

    $("profileMessage").textContent =
      "プロフィールを保存しました！";

    await searchUsers();

  } catch (e) {
    $("profileMessage").textContent = e.message;
  }
}


/* =========================
   ユーザー検索
========================= */

async function searchUsers() {
  try {
    const q = $("searchText").value.trim();
    const gender = $("searchGender").value;
    const area = $("searchArea").value;

    const url =
      `/api/users?q=${encodeURIComponent(q)}` +
      `&gender=${encodeURIComponent(gender)}` +
      `&area=${encodeURIComponent(area)}`;

    const users = await api(url);

    if (!users.length) {
      $("users").innerHTML =
        `<div class="card">条件に合う人が見つかりませんでした。</div>`;
      return;
    }

    $("users").innerHTML = users.map(u => `
      <article class="user card">

        <div class="avatar">💕</div>

        <h3>${esc(u.nickname)}</h3>

        <div class="small">
          ${age(u.birth_date)}歳
          ${u.gender ? " ・ " + esc(u.gender) : ""}
          ${u.area ? " ・ " + esc(u.area) : ""}
        </div>

        <p>
          ${esc(u.bio || "自己紹介はまだありません。")}
        </p>

        <div class="actions">

          <button
            class="primary"
            onclick="${u.liked_by_me ? "unlikeUser" : "likeUser"}(${u.id})">
            ${u.liked_by_me ? "💔 いいね解除" : "❤️ いいね"}
          </button>

          <button
            onclick="blockUser(${u.id})">
            🚫 ブロック
          </button>

          <button
            onclick="reportUser(${u.id})">
            ⚠️ 通報
          </button>

        </div>

      </article>
    `).join("");

  } catch (e) {
    $("users").innerHTML =
      `<div class="card">${esc(e.message)}</div>`;
  }
}


/* =========================
   いいね
========================= */

async function likeUser(id) {
  try {
    const r = await api(`/api/users/${id}/like`, {
      method: "POST"
    });

    if (r.matched) {
      alert("🎉 マッチしました！💕");
    } else {
      alert("❤️ いいねしました！");
    }

    await searchUsers();
    await loadMatches();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   いいね解除
========================= */

async function unlikeUser(id) {
  try {
    await api(`/api/users/${id}/like`, {
      method: "DELETE"
    });

    alert("いいねを解除しました");

    await searchUsers();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   ブロック
========================= */

async function blockUser(id) {
  if (!confirm("このユーザーをブロックしますか？")) {
    return;
  }

  try {
    await api(`/api/users/${id}/block`, {
      method: "POST"
    });

    alert("ブロックしました");

    await searchUsers();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   通報
========================= */

async function reportUser(id) {
  const reason = prompt("通報理由を入力してください");

  if (!reason) return;

  try {
    await api(`/api/users/${id}/report`, {
      method: "POST",
      body: JSON.stringify({
        reason
      })
    });

    alert("通報を受け付けました。");

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   マッチ一覧
========================= */

async function loadMatches() {
  try {
    const rows = await api("/api/matches");

    if (!rows.length) {
      $("matches").innerHTML =
        `<div>まだマッチしていません。</div>`;
      return;
    }

    $("matches").innerHTML = rows.map(m => `
      <div
        class="match card"
        onclick="openChat(${m.id}, '${esc(m.nickname)}')">

        <strong>
          💕 ${esc(m.nickname)}
        </strong>

        <div class="small">
          ${m.unread_count > 0
            ? `未読 ${m.unread_count}件 ・ `
            : ""}
          チャットする →
        </div>

      </div>
    `).join("");

  } catch (e) {
    $("matches").innerHTML =
      `<div>${esc(e.message)}</div>`;
  }
}


/* =========================
   チャットを開く
========================= */

async function openChat(id, name) {
  currentMatch = id;

  $("chatTitle").textContent =
    `💕 ${name} さんとのチャット`;

  await loadMessages();
}


/* =========================
   メッセージ読み込み
========================= */

async function loadMessages() {
  if (!currentMatch) return;

  try {
    const rows =
      await api(`/api/matches/${currentMatch}/messages`);

    if (!rows.length) {
      $("messages").innerHTML =
        `<div class="small">まだメッセージはありません。</div>`;
      return;
    }

    $("messages").innerHTML = rows.map(m => `
      <div class="msg ${m.sender_id === Number(meId) ? "mine" : ""}">
        <div>${esc(m.body)}</div>
        <small>
          ${new Date(m.created_at).toLocaleString("ja-JP")}
        </small>
      </div>
    `).join("");

  } catch (e) {
    $("messages").innerHTML =
      `<div>${esc(e.message)}</div>`;
  }
}


/* =========================
   メッセージ送信
========================= */

async function sendMessage() {
  if (!currentMatch) {
    alert("先にマッチした相手を選んでください");
    return;
  }

  const input = $("messageText");
  const body = input.value.trim();

  if (!body) return;

  try {
    await api(`/api/matches/${currentMatch}/messages`, {
      method: "POST",
      body: JSON.stringify({
        body
      })
    });

    input.value = "";

    await loadMessages();
    await loadMatches();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   アカウント削除
========================= */

async function deleteAccount() {
  const password = prompt(
    "現在のパスワードを入力してください。\n" +
    "アカウントは元に戻せません。"
  );

  if (password === null) return;

  if (!confirm(
    "本当にアカウントを削除しますか？\n" +
    "プロフィールやマッチなども削除されます。"
  )) {
    return;
  }

  try {
    await api("/api/me", {
      method: "DELETE",
      body: JSON.stringify({
        password
      })
    });

    token = "";
    localStorage.removeItem("mako_token");

    alert("アカウントを削除しました。");

    location.reload();

  } catch (e) {
    alert(e.message);
  }
}


/* =========================
   ログアウト
========================= */

async function logout() {
  try {
    await api("/api/logout", {
      method: "POST"
    });
  } catch {}

  token = "";
  localStorage.removeItem("mako_token");

  location.reload();
}


/* =========================
   年齢計算
========================= */

function age(date) {
  if (!date) return "";

  const d = new Date(date + "T00:00:00");
  const n = new Date();

  let a =
    n.getFullYear() -
    d.getFullYear();

  if (
    n.getMonth() < d.getMonth() ||
    (
      n.getMonth() === d.getMonth() &&
      n.getDate() < d.getDate()
    )
  ) {
    a--;
  }

  return a;
}


/* =========================
   HTMLエスケープ
========================= */

function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c])
  );
}


/* =========================
   起動
========================= */

(async () => {
  if (!token) return;

  try {
    await showApp();
  } catch {}
})();
