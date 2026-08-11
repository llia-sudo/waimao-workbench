var express = require('express');
var fs = require('fs');
var path = require('path');

var app = express();
var PORT = process.env.PORT || 3000;
var PASSWORD = process.env.PASSWORD || 'siyueyue';
var GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
var GIST_ID = process.env.GIST_ID || '';
var GIST_FILE = 'waimao-data.json';

// In-memory data (loaded from Gist on startup)
var orders = [];
var archiveOrders = [];

// Warn if token missing
if (!GITHUB_TOKEN) {
  console.warn('!!! GITHUB_TOKEN 未设置：数据不会持久化（Render 重启即丢）。请在环境变量配置 GITHUB_TOKEN !!!');
}

// ---------- GitHub Gist storage layer ----------
function ghHeaders() {
  return {
    'Authorization': 'Bearer ' + GITHUB_TOKEN,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'waimao-workbench',
    'Content-Type': 'application/json'
  };
}

function ghFetch(method, url, bodyObj) {
  var opts = { method: method, headers: ghHeaders() };
  if (bodyObj) opts.body = JSON.stringify(bodyObj);
  return fetch(url, opts).then(function(res) {
    return res.text().then(function(txt) {
      var data = null;
      try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
      if (!res.ok) {
        throw new Error('GitHub ' + method + ' ' + res.status + ' ' + (data && data.message ? data.message : txt));
      }
      return data;
    });
  });
}

function ensureGist(cb) {
  if (GIST_ID) { cb(null, GIST_ID); return; }
  // try cached config (survives restart only if disk persists)
  try {
    var cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'gist-config.json'), 'utf-8'));
    if (cfg && cfg.gistId) { GIST_ID = cfg.gistId; cb(null, GIST_ID); return; }
  } catch (e) {}
  // create a new private gist
  ghFetch('POST', 'https://api.github.com/gists', {
    description: 'waimao-workbench-data',
    public: false,
    files: {}
  }).then(function(data) {
    GIST_ID = data.id;
    try { fs.writeFileSync(path.join(__dirname, 'gist-config.json'), JSON.stringify({ gistId: GIST_ID })); } catch (e) {}
    console.log('=== NEW GIST CREATED: ' + GIST_ID + ' === 请把这个 ID 设为 GIST_ID 环境变量，否则重启后会新建 gist 导致数据分散');
    cb(null, GIST_ID);
  }).catch(function(err) {
    console.error('ensureGist failed:', err.message);
    cb(err);
  });
}

function loadFromGist(cb) {
  ensureGist(function(err) {
    if (err) { cb && cb(err); return; }
    ghFetch('GET', 'https://api.github.com/gists/' + GIST_ID).then(function(data) {
      var file = data && data.files && data.files[GIST_FILE];
      if (file && file.content) {
        try {
          var parsed = JSON.parse(file.content);
          orders = Array.isArray(parsed.orders) ? parsed.orders : [];
          archiveOrders = Array.isArray(parsed.archiveOrders) ? parsed.archiveOrders : [];
        } catch (e) { console.error('parse gist failed:', e.message); }
      }
      cb && cb(null);
    }).catch(function(err) {
      console.error('loadFromGist failed:', err.message);
      cb && cb(err);
    });
  });
}

function saveToGist() {
  return new Promise(function(resolve) {
    ensureGist(function(err) {
      if (err) { console.error('saveToGist: no gist available'); resolve(); return; }
      var payload = {};
      payload[GIST_FILE] = {
        content: JSON.stringify({ orders: orders, archiveOrders: archiveOrders }, null, 2)
      };
      ghFetch('PATCH', 'https://api.github.com/gists/' + GIST_ID, { files: payload })
        .then(function() { resolve(); })
        .catch(function(e) { console.error('saveToGist failed:', e.message); resolve(); });
    });
  });
}

// ---------- Middleware & routes ----------
app.use(express.json({ limit: '2mb' }));

// Pages are always served (the front-end login overlay handles auth UX).
// Only /api/* requires the auth cookie (except the auth endpoints themselves).
function checkAuth(req, res, next) {
  if (!req.path.startsWith('/api/')) return next();
  if (req.path === '/api/login' || req.path === '/api/logout') return next();
  var cookie = req.headers.cookie || '';
  var match = cookie.match(/waimao_auth=([^;]+)/);
  if (match && match[1] === PASSWORD) {
    return next();
  }
  return res.status(401).json({ error: '未登录' });
}

app.get('/login.html', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/login', function(req, res) {
  var pwd = req.body.password || '';
  if (pwd === PASSWORD) {
    res.setHeader('Set-Cookie', 'waimao_auth=' + PASSWORD + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax');
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: '密码错误' });
});

// Returns 200 if the auth cookie is valid (used by the client to skip the login overlay)
app.get('/api/me', checkAuth, function(req, res) {
  res.json({ authed: true });
});

app.post('/api/logout', function(req, res) {
  res.setHeader('Set-Cookie', 'waimao_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ success: true });
});

// Data APIs
app.get('/api/orders', checkAuth, function(req, res) {
  res.json(orders);
});

app.get('/api/archive', checkAuth, function(req, res) {
  res.json(archiveOrders);
});

app.post('/api/orders', checkAuth, function(req, res) {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: '数据格式错误' });
  orders = req.body;
  saveToGist().then(function() { res.json({ success: true }); });
});

app.post('/api/archive', checkAuth, function(req, res) {
  if (!Array.isArray(req.body)) return res.status(400).json({ error: '数据格式错误' });
  archiveOrders = req.body;
  saveToGist().then(function() { res.json({ success: true }); });
});

// Combined data endpoint (orders + archive) used by the latest workbench
app.get('/api/data', checkAuth, function(req, res) {
  res.json({ orders: orders, archiveOrders: archiveOrders });
});

app.post('/api/data', checkAuth, function(req, res) {
  var body = req.body || {};
  if (!Array.isArray(body.orders) || !Array.isArray(body.archiveOrders)) {
    return res.status(400).json({ error: '数据格式错误' });
  }
  orders = body.orders;
  archiveOrders = body.archiveOrders;
  saveToGist().then(function() { res.json({ success: true }); });
});

app.post('/api/import', checkAuth, function(req, res) {
  var data = req.body;
  var importOrders = [];
  var importArchive = [];
  if (Array.isArray(data)) {
    importOrders = data;
    importArchive = [];
  } else {
    importOrders = data.orders || [];
    importArchive = data.archiveOrders || [];
  }
  if (!Array.isArray(importOrders) || !Array.isArray(importArchive)) {
    return res.status(400).json({ error: '数据格式错误' });
  }
  orders = importOrders;
  archiveOrders = importArchive;
  saveToGist().then(function() {
    res.json({ success: true, ordersCount: importOrders.length, archiveCount: importArchive.length });
  });
});

app.get('/', checkAuth, function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'workbench.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, function() {
  console.log('外贸跟单工作台已启动：http://localhost:' + PORT);
  loadFromGist(function() {
    console.log('数据加载完成 → 订单数:' + orders.length + ' 归档数:' + archiveOrders.length);
  });
});
