var express = require('express');
var fs = require('fs');
var path = require('path');

var app = express();
var PORT = process.env.PORT || 3000;
var PASSWORD = process.env.PASSWORD || 'siyueyue';
var DATA_DIR = path.join(__dirname, 'data');
var ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
var ARCHIVE_FILE = path.join(DATA_DIR, 'archive.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// Read data files
function readData(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      var raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch(e) {}
  return [];
}

function writeData(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// JSON body parser
app.use(express.json({ limit: '2mb' }));

// Auth middleware — check cookie
function checkAuth(req, res, next) {
  var cookie = req.headers.cookie || '';
  var match = cookie.match(/waimao_auth=([^;]+)/);
  if (match && match[1] === PASSWORD) {
    return next();
  }
  // API calls return 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '未登录' });
  }
  // Page visits redirect to login
  if (req.path === '/login.html') return next();
  return res.redirect('/login.html');
}

// ----- Login page -----
app.get('/login.html', function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ----- Login API -----
app.post('/api/login', function(req, res) {
  var pwd = req.body.password || '';
  if (pwd === PASSWORD) {
    // Set cookie, httpOnly for security, expires in 30 days
    res.setHeader('Set-Cookie', 'waimao_auth=' + PASSWORD + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax');
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: '密码错误' });
});

// ----- Logout API -----
app.post('/api/logout', function(req, res) {
  res.setHeader('Set-Cookie', 'waimao_auth=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ success: true });
});

// ----- Data APIs (all require auth) -----
app.get('/api/orders', checkAuth, function(req, res) {
  res.json(readData(ORDERS_FILE));
});

app.get('/api/archive', checkAuth, function(req, res) {
  res.json(readData(ARCHIVE_FILE));
});

app.post('/api/orders', checkAuth, function(req, res) {
  var data = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: '数据格式错误' });
  writeData(ORDERS_FILE, data);
  res.json({ success: true });
});

app.post('/api/archive', checkAuth, function(req, res) {
  var data = req.body;
  if (!Array.isArray(data)) return res.status(400).json({ error: '数据格式错误' });
  writeData(ARCHIVE_FILE, data);
  res.json({ success: true });
});

// Import — accept full backup including archive
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
  writeData(ORDERS_FILE, importOrders);
  writeData(ARCHIVE_FILE, importArchive);
  res.json({ success: true, ordersCount: importOrders.length, archiveCount: importArchive.length });
});

// ----- Workbench (auth required) -----
app.get('/', checkAuth, function(req, res) {
  res.sendFile(path.join(__dirname, 'public', 'workbench.html'));
});

// ----- Static files (CSS, JS, etc if any) -----
app.use(express.static(path.join(__dirname, 'public')));

// Start
app.listen(PORT, function() {
  console.log('外贸跟单工作台已启动：http://localhost:' + PORT);
});
