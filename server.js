const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("./db");
const path = require("path");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET =
  process.env.SESSION_SECRET || "dev-only-change-me";

const sessions = new Map();

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(express.json({ limit: "20kb" }));

// APIへのアクセス制限
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/", apiLimiter);


// ==============================
// フロントエンド
// ==============================

// GitHubのルートに
// index.html
// app.js
// style.css
// がある構成に対応

app.get("/style.css", (req, res) => {
  res.sendFile(path.join(__dirname, "style.css"));
});

app.get("/app.js", (req, res) => {
  res.sendFile(path.join(__dirname, "app.js"));
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ==============================
// 共通関数
// ==============================

function ageAtLeast18(birthDate) {
  const d = new Date(`${birthDate}T00:00:00`);

  if (Number.isNaN(d.getTime())) {
    return false;
  }

  const now = new Date();

  let age = now.getFullYear() - d.getFullYear();

  const month =
    now.getMonth() - d.getMonth();

  if (
    month < 0 ||
    (month === 0 && now.getDate() < d.getDate())
  ) {
    age--;
  }

  return age >= 18;
}


function clean(value, max) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}


function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}


// ==============================
// セッション
// ==============================

function signSession(id) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(id)
    .digest("hex");
}


function makeSession(userId) {
  const id = crypto
    .randomBytes(32)
    .toString("hex");

  const sig = signSession(id);

  sessions.set(id, {
    userId,
    expires:
      Date.now() +
      7 * 24 * 60 * 60 * 1000
  });

  return `${id}.${sig}`;
}


function getUserFromSession(req) {
  const authorization =
    req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return null;
  }

  const token =
    authorization.slice(7);

  const [id, sig] =
    token.split(".");

  if (!id || !sig) {
    return null;
  }

  if (signSession(id) !== sig) {
    return null;
  }

  const session =
    sessions.get(id);

  if (!session) {
    return null;
  }

  if (session.expires < Date.now()) {
    sessions.delete(id);
    return null;
  }

  return db
    .prepare(
      `
      SELECT
        id,
        email,
        nickname,
        birth_date,
        bio,
        created_at
      FROM users
      WHERE id=?
      `
    )
    .get(session.userId);
}


function auth(req, res, next) {
  const user =
    getUserFromSession(req);

  if (!user) {
    return res
      .status(401)
      .json({
        error: "ログインが必要です"
      });
  }

  req.user = user;

  next();
}


// ==============================
// ブロック確認
// ==============================

function blockedEither(a, b) {
  return !!db
    .prepare(
      `
      SELECT 1
      FROM blocks
      WHERE
        (blocker_id=? AND blocked_id=?)
        OR
        (blocker_id=? AND blocked_id=?)
      `
    )
    .get(a, b, b, a);
}


// ==============================
// マッチ確認
// ==============================

function matchForUsers(a, b) {
  return db
    .prepare(
      `
      SELECT *
      FROM matches
      WHERE
        (user1_id=? AND user2_id=?)
        OR
        (user1_id=? AND user2_id=?)
      `
    )
    .get(a, b, b, a);
}


// ==============================
// 新規登録
// ==============================

app.post("/api/register", async (req, res) => {
  const email =
    clean(req.body.email, 200)
      .toLowerCase();

  const password =
    String(req.body.password || "");

  const nickname =
    clean(req.body.nickname, 30);

  const birthDate =
    clean(req.body.birthDate, 10);

  const bio =
    clean(req.body.bio, 500);


  if (
    !validEmail(email) ||
    password.length < 8 ||
    nickname.length < 1 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(
      birthDate
    )
  ) {
    return res
      .status(400)
      .json({
        error:
          "入力内容を確認してください（パスワードは8文字以上）"
      });
  }


  if (!ageAtLeast18(birthDate)) {
    return res
      .status(400)
      .json({
        error:
          "まこマッチは18歳以上のみ利用できます"
      });
  }


  try {
    const hash =
      await bcrypt.hash(
        password,
        12
      );


    const result =
      db
        .prepare(
          `
          INSERT INTO users
          (
            email,
            password_hash,
            nickname,
            birth_date,
            bio
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?
          )
          `
        )
        .run(
          email,
          hash,
          nickname,
          birthDate,
          bio
        );


    const token =
      makeSession(
        result.lastInsertRowid
      );


    res
      .status(201)
      .json({
        token
      });

  } catch (error) {

    if (
      String(error.message)
        .includes("UNIQUE")
    ) {
      return res
        .status(409)
        .json({
          error:
            "そのメールアドレスはすでに登録されています"
        });
    }


    console.error(error);

    res
      .status(500)
      .json({
        error:
          "登録に失敗しました"
      });
  }
});


// ==============================
// ログイン
// ==============================

app.post("/api/login", async (req, res) => {
  const email =
    clean(req.body.email, 200)
      .toLowerCase();

  const password =
    String(req.body.password || "");


  const user =
    db
      .prepare(
        "SELECT * FROM users WHERE email=?"
      )
      .get(email);


  if (
    !user ||
    !(await bcrypt.compare(
      password,
      user.password_hash
    ))
  ) {
    return res
      .status(401)
      .json({
        error:
          "メールアドレスまたはパスワードが違います"
      });
  }


  res.json({
    token:
      makeSession(user.id)
  });
});


// ==============================
// ログアウト
// ==============================

app.post("/api/logout", auth, (req, res) => {
  const raw =
    req.headers.authorization
      .slice(7);

  const id =
    raw.split(".")[0];

  sessions.delete(id);

  res.json({
    ok: true
  });
});


// ==============================
// 自分のプロフィール
// ==============================

app.get("/api/me", auth, (req, res) => {
  res.json(req.user);
});


app.put("/api/me", auth, (req, res) => {
  const nickname =
    clean(req.body.nickname, 30);

  const bio =
    clean(req.body.bio, 500);


  if (!nickname) {
    return res
      .status(400)
      .json({
        error:
          "ニックネームを入力してください"
      });
  }


  db
    .prepare(
      `
      UPDATE users
      SET nickname=?,
          bio=?
      WHERE id=?
      `
    )
    .run(
      nickname,
      bio,
      req.user.id
    );


  const user =
    db
      .prepare(
        `
        SELECT
          id,
          email,
          nickname,
          birth_date,
          bio,
          created_at
        FROM users
        WHERE id=?
        `
      )
      .get(req.user.id);


  res.json(user);
});


// ==============================
// ユーザー検索
// ==============================

app.get("/api/users", auth, (req, res) => {
  const q =
    clean(req.query.q, 50);


  let users;


  if (q) {

    users =
      db
        .prepare(
          `
          SELECT
            id,
            nickname,
            birth_date,
            bio,
            created_at
          FROM users
          WHERE
            id != ?
            AND
            (
              nickname LIKE ?
              OR
              bio LIKE ?
            )
          ORDER BY created_at DESC
          LIMIT 50
          `
        )
        .all(
          req.user.id,
          `%${q}%`,
          `%${q}%`
        );

  } else {

    users =
      db
        .prepare(
          `
          SELECT
            id,
            nickname,
            birth_date,
            bio,
            created_at
          FROM users
          WHERE id != ?
          ORDER BY created_at DESC
          LIMIT 50
          `
        )
        .all(req.user.id);
  }


  res.json(
    users.filter(
      user =>
        !blockedEither(
          req.user.id,
          user.id
        )
    )
  );
});


// ==============================
// いいね
// ==============================

app.post(
  "/api/users/:id/like",
  auth,
  (req, res) => {

    const target =
      Number(req.params.id);


    if (
      !Number.isInteger(target) ||
      target === req.user.id
    ) {
      return res
        .status(400)
        .json({
          error:
            "対象が不正です"
        });
    }


    const targetUser =
      db
        .prepare(
          "SELECT id FROM users WHERE id=?"
        )
        .get(target);


    if (!targetUser) {
      return res
        .status(404)
        .json({
          error:
            "ユーザーが見つかりません"
        });
    }


    if (
      blockedEither(
        req.user.id,
        target
      )
    ) {
      return res
        .status(403)
        .json({
          error:
            "このユーザーとは操作できません"
        });
    }


    db
      .prepare(
        `
        INSERT OR IGNORE INTO likes
        (
          from_user_id,
          to_user_id
        )
        VALUES
        (?,?)
        `
      )
      .run(
        req.user.id,
        target
      );


    const mutual =
      !!db
        .prepare(
          `
          SELECT 1
          FROM likes
          WHERE
            from_user_id=?
            AND
            to_user_id=?
          `
        )
        .get(
          target,
          req.user.id
        );


    if (mutual) {

      const a =
        Math.min(
          req.user.id,
          target
        );

      const b =
        Math.max(
          req.user.id,
          target
        );


      db
        .prepare(
          `
          INSERT OR IGNORE INTO matches
          (
            user1_id,
            user2_id
          )
          VALUES
          (?,?)
          `
        )
        .run(a, b);
    }


    res.json({
      liked: true,
      matched: mutual
    });
  }
);


// ==============================
// マッチ一覧
// ==============================

app.get("/api/matches", auth, (req, res) => {

  const rows =
    db
      .prepare(
        `
        SELECT
          m.id,

          CASE
            WHEN m.user1_id=?
            THEN m.user2_id
            ELSE m.user1_id
          END AS other_id,

          u.nickname

        FROM matches m

        JOIN users u
        ON u.id =
          CASE
            WHEN m.user1_id=?
            THEN m.user2_id
            ELSE m.user1_id
          END

        WHERE
          m.user1_id=?
          OR
          m.user2_id=?

        ORDER BY
          m.created_at DESC
        `
      )
      .all(
        req.user.id,
        req.user.id,
        req.user.id,
        req.user.id
      );


  res.json(rows);
});


// ==============================
// メッセージ一覧
// ==============================

app.get(
  "/api/matches/:id/messages",
  auth,
  (req, res) => {

    const match =
      db
        .prepare(
          "SELECT * FROM matches WHERE id=?"
        )
        .get(
          Number(req.params.id)
        );


    if (
      !match ||
      (
        match.user1_id !== req.user.id &&
        match.user2_id !== req.user.id
      )
    ) {
      return res
        .status(403)
        .json({
          error:
            "アクセスできません"
        });
    }


    const messages =
      db
        .prepare(
          `
          SELECT
            id,
            sender_id,
            body,
            created_at
          FROM messages
          WHERE match_id=?
          ORDER BY id ASC
          LIMIT 200
          `
        )
        .all(match.id);


    res.json(messages);
  }
);


// ==============================
// メッセージ送信
// ==============================

app.post(
  "/api/matches/:id/messages",
  auth,
  (req, res) => {

    const match =
      db
        .prepare(
          "SELECT * FROM matches WHERE id=?"
        )
        .get(
          Number(req.params.id)
        );


    if (
      !match ||
      (
        match.user1_id !== req.user.id &&
        match.user2_id !== req.user.id
      )
    ) {
      return res
        .status(403)
        .json({
          error:
            "アクセスできません"
        });
    }


    const body =
      clean(req.body.body, 1000);


    if (!body) {
      return res
        .status(400)
        .json({
          error:
            "メッセージを入力してください"
        });
    }


    const other =
      match.user1_id === req.user.id
        ? match.user2_id
        : match.user1_id;


    if (
      blockedEither(
        req.user.id,
        other
      )
    ) {
      return res
        .status(403)
        .json({
          error:
            "ブロック中です"
        });
    }


    const result =
      db
        .prepare(
          `
          INSERT INTO messages
          (
            match_id,
            sender_id,
            body
          )
          VALUES
          (?,?,?)
          `
        )
        .run(
          match.id,
          req.user.id,
          body
        );


    const message =
      db
        .prepare(
          `
          SELECT
            id,
            sender_id,
            body,
            created_at
          FROM messages
          WHERE id=?
          `
        )
        .get(
          result.lastInsertRowid
        );


    res
      .status(201)
      .json(message);
  }
);


// ==============================
// ブロック
// ==============================

app.post(
  "/api/users/:id/block",
  auth,
  (req, res) => {

    const target =
      Number(req.params.id);


    if (
      !Number.isInteger(target) ||
      target === req.user.id
    ) {
      return res
        .status(400)
        .json({
          error:
            "対象が不正です"
        });
    }


    db
      .prepare(
        `
        INSERT OR IGNORE INTO blocks
        (
          blocker_id,
          blocked_id
        )
        VALUES
        (?,?)
        `
      )
      .run(
        req.user.id,
        target
      );


    res.json({
      ok: true
    });
  }
);


// ==============================
// 通報
// ==============================

app.post(
  "/api/users/:id/report",
  auth,
  (req, res) => {

    const target =
      Number(req.params.id);

    const reason =
      clean(
        req.body.reason,
        500
      );


    if (
      !Number.isInteger(target) ||
      target === req.user.id ||
      !reason
    ) {
      return res
        .status(400)
        .json({
          error:
            "通報内容を確認してください"
        });
    }


    db
      .prepare(
        `
        INSERT INTO reports
        (
          reporter_id,
          reported_id,
          reason
        )
        VALUES
        (?,?,?)
        `
      )
      .run(
        req.user.id,
        target,
        reason
      );


    res
      .status(201)
      .json({
        ok: true
      });
  }
);


// ==============================
// フロントエンドのフォールバック
// ==============================

// 「*」ではなく正規表現を使用。
// Express / path-to-regexp の
// Missing parameter name エラーを回避。

app.get(
  /^(?!\/api(?:\/|$)).*/,
  (req, res) => {
    res.sendFile(
      path.join(
        __dirname,
        "index.html"
      )
    );
  }
);


// ==============================
// サーバー起動
// ==============================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `まこマッチ: http://localhost:${PORT}`
    );
  }
);
