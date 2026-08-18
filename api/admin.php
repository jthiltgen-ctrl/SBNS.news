<?php
/**
 * admin.php
 * Password-protected editorial queue. Session-based login form.
 * Credentials from ADMIN_USERNAME / ADMIN_PASSWORD env vars.
 * Shows pending stories newest-first; each has an editable FML kicker, Approve, and Reject button.
 * Approve → prepends to published.json. Reject → discards from pending.json.
 */

session_start();

// ── Load credentials from config file above public_html ───────────────────────
$configFile = __DIR__ . '/../../sbns-config.php';
if (file_exists($configFile)) require_once $configFile;

$expectedUser = getenv('ADMIN_USERNAME') ?: '';
$expectedPass = getenv('ADMIN_PASSWORD') ?: '';

// ── Logout ────────────────────────────────────────────────────────────────────
if (isset($_GET['logout'])) {
    session_destroy();
    header('Location: admin.php');
    exit;
}

// ── Login form submission ─────────────────────────────────────────────────────
$loginError = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['login'])) {
    $user = $_POST['username'] ?? '';
    $pass = $_POST['password'] ?? '';
    if ($expectedUser !== ''
        && hash_equals($expectedUser, $user)
        && hash_equals($expectedPass, $pass)
    ) {
        $_SESSION['sbns_authed'] = true;
        header('Location: admin.php');
        exit;
    }
    $loginError = 'Invalid credentials.';
}

// ── Gate ──────────────────────────────────────────────────────────────────────
if (empty($_SESSION['sbns_authed'])) {
?><!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SBNS Admin — Login</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lora:ital,wght@0,400;0,600;1,400&family=Special+Elite&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --paper:      #f2ede3;
    --paper-dark: #e6dfd0;
    --ink:        #1a1714;
    --red:        #b91c1c;
    --red-dark:   #7f1d1d;
    --gray:       #6b6560;
    --border:     #c8bcaa;
    --kicker-bg:  #141210;
  }
  body {
    font-family: 'Lora', Georgia, serif;
    background: var(--paper);
    color: var(--ink);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }
  .login-header {
    background: var(--ink);
    border-bottom: 5px solid var(--red);
  }
  .login-dateline {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: rgba(242,237,227,0.45);
    padding: 8px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    justify-content: space-between;
  }
  .login-nameplate {
    padding: 18px 18px 6px;
    text-align: center;
  }
  .login-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: clamp(28px, 7vw, 64px);
    color: var(--paper);
    letter-spacing: 1px;
    line-height: 0.95;
  }
  .login-title em { color: var(--red); font-style: normal; }
  .login-tagline {
    font-family: 'Special Elite', monospace;
    font-size: 12px;
    color: rgba(242,237,227,0.5);
    padding: 8px 18px 18px;
    text-align: center;
    font-style: italic;
  }
  .login-wrap {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }
  .login-box {
    width: 100%;
    max-width: 360px;
    border: 1.5px solid var(--border);
    background: var(--paper);
  }
  .login-box-head {
    background: var(--paper-dark);
    border-bottom: 2px solid var(--border);
    padding: 12px 18px;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--gray);
  }
  .login-form { padding: 22px 18px 18px; }
  .login-field { margin-bottom: 16px; }
  .login-label {
    display: block;
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gray);
    margin-bottom: 6px;
  }
  .login-input {
    width: 100%;
    border: 1.5px solid var(--border);
    background: var(--paper);
    color: var(--ink);
    font-family: 'Lora', Georgia, serif;
    font-size: 15px;
    padding: 9px 12px;
    -webkit-appearance: none;
  }
  .login-input:focus {
    outline: none;
    border-color: var(--red);
  }
  .login-error {
    font-family: 'Special Elite', monospace;
    font-size: 12px;
    color: var(--red);
    margin-bottom: 14px;
    text-align: center;
  }
  .login-btn {
    width: 100%;
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    background: var(--red);
    color: var(--paper);
    border: none;
    padding: 11px 20px;
    cursor: pointer;
    transition: background 0.12s;
    -webkit-tap-highlight-color: transparent;
  }
  .login-btn:hover { background: var(--red-dark); }
  .login-footer {
    background: var(--ink);
    border-top: 4px double var(--border);
    padding: 18px 20px;
    text-align: center;
    font-family: 'Special Elite', monospace;
    font-size: 11px;
    color: rgba(242,237,227,0.4);
  }
</style>
</head>
<body>
<header class="login-header">
  <div class="login-dateline">
    <span>Editorial Dashboard</span>
    <span><?= date('D, F j, Y') ?></span>
  </div>
  <div class="login-nameplate">
    <div class="login-title">SBNS <em>Admin</em></div>
  </div>
  <div class="login-tagline">Restricted access. Operators only.</div>
</header>

<div class="login-wrap">
  <div class="login-box">
    <div class="login-box-head">Sign In</div>
    <form class="login-form" method="POST" action="admin.php">
      <input type="hidden" name="login" value="1">
      <?php if ($loginError): ?>
      <div class="login-error"><?= htmlspecialchars($loginError, ENT_QUOTES, 'UTF-8') ?></div>
      <?php endif; ?>
      <div class="login-field">
        <label class="login-label" for="username">Username</label>
        <input class="login-input" type="text" id="username" name="username"
               autocomplete="username" autocorrect="off" autocapitalize="none"
               spellcheck="false" required autofocus>
      </div>
      <div class="login-field">
        <label class="login-label" for="password">Password</label>
        <input class="login-input" type="password" id="password" name="password"
               autocomplete="current-password" required>
      </div>
      <button class="login-btn" type="submit">Enter Queue &#8594;</button>
    </form>
  </div>
</div>

<footer class="login-footer">
  Shocked But Not Surprised &mdash; Editorial Queue
</footer>
</body>
</html>
<?php
    exit;
}

// ── Paths ─────────────────────────────────────────────────────────────────────
define('DATA_DIR',       __DIR__ . '/../data/');
define('PENDING_FILE',   DATA_DIR . 'pending.json');
define('PUBLISHED_FILE', DATA_DIR . 'published.json');

if (!is_dir(DATA_DIR)) {
    mkdir(DATA_DIR, 0755, true);
    file_put_contents(DATA_DIR . '.htaccess', "Order deny,allow\nDeny from all\n");
}
if (!file_exists(PENDING_FILE))   file_put_contents(PENDING_FILE,   '[]');
if (!file_exists(PUBLISHED_FILE)) file_put_contents(PUBLISHED_FILE, '[]');

// ── File helpers ──────────────────────────────────────────────────────────────
function readJson(string $file): array {
    $fp = fopen($file, 'r');
    flock($fp, LOCK_SH);
    $data = json_decode(file_get_contents($file), true) ?: [];
    flock($fp, LOCK_UN);
    fclose($fp);
    return $data;
}

function writeJson(string $file, array $data): void {
    $fp = fopen($file, 'c+');
    flock($fp, LOCK_EX);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    flock($fp, LOCK_UN);
    fclose($fp);
}

// ── Handle POST actions ───────────────────────────────────────────────────────
$flash = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action  = $_POST['action'] ?? '';
    $index   = filter_input(INPUT_POST, 'index', FILTER_VALIDATE_INT);
    $pending = readJson(PENDING_FILE);

    if ($action === 'approve' && $index !== false && isset($pending[$index])) {
        $story = $pending[$index];
        $kicker = trim($_POST['kicker'] ?? '');
        if ($kicker !== '') $story['fml_kicker'] = $kicker;
        $story['published_at'] = date('c');

        $published = readJson(PUBLISHED_FILE);
        array_unshift($published, $story);   // newest first
        writeJson(PUBLISHED_FILE, $published);

        array_splice($pending, $index, 1);
        writeJson(PENDING_FILE, $pending);
        $flash = 'approved';

    } elseif ($action === 'reject' && $index !== false && isset($pending[$index])) {
        array_splice($pending, $index, 1);
        writeJson(PENDING_FILE, $pending);
        $flash = 'rejected';
    }

    header('Location: admin.php?flash=' . $flash);
    exit;
}

if (isset($_GET['flash'])) {
    $flash = $_GET['flash'];
}

// ── Build display list (newest first = reverse index order) ───────────────────
$pending = readJson(PENDING_FILE);
$total   = count($pending);
$display = [];
foreach (array_reverse(array_keys($pending)) as $origIdx) {
    $display[] = ['index' => $origIdx, 'story' => $pending[$origIdx]];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function h(?string $s): string {
    return htmlspecialchars($s ?? '', ENT_QUOTES, 'UTF-8');
}
function sevDots(int $sev): string {
    $out = '';
    for ($i = 1; $i <= 5; $i++) {
        $cls = $i <= $sev ? ' on' : '';
        $out .= "<span class=\"sev-dot{$cls}\"></span>";
    }
    return $out;
}
function fmtDate(string $iso): string {
    $ts = strtotime($iso);
    return $ts ? date('M j, g:ia', $ts) : $iso;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SBNS Admin — Pending Queue</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lora:ital,wght@0,400;0,600;1,400&family=Special+Elite&family=Barlow+Condensed:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --paper:      #f2ede3;
    --paper-dark: #e6dfd0;
    --ink:        #1a1714;
    --red:        #b91c1c;
    --red-dark:   #7f1d1d;
    --gray:       #6b6560;
    --border:     #c8bcaa;
    --kicker-bg:  #141210;
    --green:      #166534;
  }

  body {
    font-family: 'Lora', Georgia, serif;
    background: var(--paper);
    color: var(--ink);
    min-height: 100vh;
  }

  /* ── HEADER ── */
  .admin-header {
    background: var(--ink);
    border-bottom: 5px solid var(--red);
  }
  .admin-dateline {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: rgba(242,237,227,0.45);
    padding: 8px 18px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    display: flex;
    justify-content: space-between;
  }
  .admin-nameplate {
    padding: 18px 18px 6px;
    text-align: center;
  }
  .admin-title {
    font-family: 'Bebas Neue', sans-serif;
    font-size: clamp(28px, 7vw, 64px);
    color: var(--paper);
    letter-spacing: 1px;
    line-height: 0.95;
  }
  .admin-title em { color: var(--red); font-style: normal; }
  .admin-tagline {
    font-family: 'Special Elite', monospace;
    font-size: 12px;
    color: rgba(242,237,227,0.5);
    padding: 8px 18px 18px;
    text-align: center;
    font-style: italic;
  }

  /* ── TOOLBAR ── */
  .admin-toolbar {
    background: var(--paper-dark);
    border-bottom: 2px solid var(--border);
    padding: 10px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .admin-count {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 13px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--gray);
  }
  .admin-count strong { color: var(--ink); font-size: 16px; }
  .toolbar-right { display: flex; gap: 8px; align-items: center; }
  .admin-published-link {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--gray);
    text-decoration: none;
    border: 1px solid var(--border);
    padding: 4px 12px;
  }
  .admin-published-link:hover { color: var(--ink); border-color: var(--ink); }
  .logout-btn {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--red);
    text-decoration: none;
    border: 1px solid var(--red);
    padding: 4px 12px;
    background: transparent;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .logout-btn:hover { background: var(--red); color: var(--paper); }

  /* ── FLASH MESSAGE ── */
  .flash {
    padding: 12px 18px;
    text-align: center;
    font-family: 'Special Elite', monospace;
    font-size: 13px;
    border-bottom: 2px solid transparent;
  }
  .flash.approved { background: var(--ink); color: var(--paper); border-color: var(--green); }
  .flash.rejected { background: var(--ink); color: var(--paper); border-color: var(--red); }

  /* ── EMPTY STATE ── */
  .admin-empty {
    padding: 70px 20px;
    text-align: center;
  }
  .admin-empty-head {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 52px;
    color: var(--border);
    margin-bottom: 10px;
  }
  .admin-empty-sub {
    font-family: 'Special Elite', monospace;
    font-size: 13px;
    color: var(--gray);
    max-width: 320px;
    margin: 0 auto;
    line-height: 1.6;
  }

  /* ── STORY CARDS ── */
  .admin-grid {
    padding: 18px 14px 40px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 22px;
    max-width: 720px;
    margin: 0 auto;
  }

  .story-card {
    border: 1.5px solid var(--border);
    background: var(--paper);
  }

  .card-body { padding: 14px 16px 12px; }

  .card-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 10px;
  }
  .cat-badge {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    background: var(--ink);
    color: var(--paper);
    padding: 2px 8px;
  }
  .sev-dots { display: flex; gap: 3px; align-items: center; }
  .sev-dot  { width: 7px; height: 7px; border-radius: 50%; background: var(--border); }
  .sev-dot.on { background: var(--red); }

  .card-headline {
    font-family: 'Bebas Neue', sans-serif;
    font-size: 24px;
    line-height: 1.08;
    letter-spacing: 0.3px;
    color: var(--ink);
    margin-bottom: 9px;
  }
  .card-summary {
    font-size: 13px;
    line-height: 1.65;
    color: var(--gray);
  }
  .card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 10px;
  }
  .tag {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    border: 1px solid var(--border);
    padding: 1px 6px;
    color: var(--gray);
  }

  /* ── KICKER EDIT ── */
  .card-kicker-edit {
    background: var(--kicker-bg);
    border-top: 3px solid var(--red);
    padding: 12px 16px;
  }
  .kicker-label {
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--red);
    margin-bottom: 6px;
  }
  .kicker-input {
    width: 100%;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(200,188,170,0.25);
    color: rgba(242,237,227,0.9);
    font-family: 'Special Elite', monospace;
    font-size: 13px;
    line-height: 1.55;
    padding: 8px 10px;
    font-style: italic;
    resize: vertical;
    min-height: 56px;
  }
  .kicker-input:focus { outline: none; border-color: rgba(185,28,28,0.5); }

  /* ── SOURCE + FETCH DATE ── */
  .card-source {
    padding: 5px 16px 6px;
    background: var(--paper-dark);
    border-top: 1px solid var(--border);
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--gray);
  }
  .card-fetched {
    padding: 3px 16px 7px;
    background: var(--paper-dark);
    font-family: 'Barlow Condensed', sans-serif;
    font-size: 9px;
    letter-spacing: 1px;
    color: var(--border);
  }

  /* ── ACTIONS ── */
  .card-actions {
    padding: 12px 16px;
    display: flex;
    gap: 10px;
    border-top: 1px solid var(--border);
    background: var(--paper-dark);
  }
  .btn-approve {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: var(--ink);
    color: var(--paper);
    border: none;
    padding: 9px 20px;
    cursor: pointer;
    flex: 1;
    transition: background 0.12s;
    -webkit-tap-highlight-color: transparent;
  }
  .btn-approve:hover { background: var(--green); }

  .btn-reject {
    font-family: 'Barlow Condensed', sans-serif;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    background: transparent;
    color: var(--red);
    border: 2px solid var(--red);
    padding: 9px 20px;
    cursor: pointer;
    flex: 1;
    transition: all 0.12s;
    -webkit-tap-highlight-color: transparent;
  }
  .btn-reject:hover { background: var(--red); color: var(--paper); }

  /* ── FOOTER ── */
  .admin-footer {
    background: var(--ink);
    border-top: 4px double var(--border);
    padding: 22px 20px;
    text-align: center;
    font-family: 'Special Elite', monospace;
    font-size: 11px;
    color: rgba(242,237,227,0.4);
    line-height: 1.9;
  }
</style>
</head>
<body>

<header class="admin-header">
  <div class="admin-dateline">
    <span>Editorial Dashboard</span>
    <span><?= date('D, F j, Y') ?></span>
  </div>
  <div class="admin-nameplate">
    <div class="admin-title">SBNS <em>Admin</em></div>
  </div>
  <div class="admin-tagline">Review pending stories before they reach readers.</div>
</header>

<div class="admin-toolbar">
  <div class="admin-count"><strong><?= $total ?></strong> pending</div>
  <div class="toolbar-right">
    <a class="admin-published-link" href="published.php">View published JSON ↗</a>
    <a class="logout-btn" href="admin.php?logout=1">Log out</a>
  </div>
</div>

<?php if ($flash === 'approved'): ?>
<div class="flash approved">Story approved and published.</div>
<?php elseif ($flash === 'rejected'): ?>
<div class="flash rejected">Story rejected and discarded.</div>
<?php endif; ?>

<?php if (empty($display)): ?>
<div class="admin-empty">
  <div class="admin-empty-head">Queue is clear.</div>
  <div class="admin-empty-sub">
    No stories awaiting review. The fetch job runs 4&times; daily — check back later.
  </div>
</div>
<?php else: ?>
<div class="admin-grid">
  <?php foreach ($display as $item):
    $i = $item['index'];
    $s = $item['story'];
  ?>
  <div class="story-card">
    <div class="card-body">
      <div class="card-meta">
        <span class="cat-badge"><?= h($s['category'] ?? 'Unknown') ?></span>
        <div class="sev-dots" title="Severity: <?= (int)($s['severity'] ?? 1) ?>/5">
          <?= sevDots((int)($s['severity'] ?? 1)) ?>
        </div>
      </div>
      <div class="card-headline"><?= h($s['headline'] ?? '') ?></div>
      <div class="card-summary"><?= h($s['summary'] ?? '') ?></div>
      <?php if (!empty($s['topic_tags'])): ?>
      <div class="card-tags">
        <?php foreach ((array)$s['topic_tags'] as $tag): ?>
        <span class="tag"><?= h($tag) ?></span>
        <?php endforeach; ?>
      </div>
      <?php endif; ?>
    </div>

    <form method="POST" action="admin.php">
      <input type="hidden" name="index" value="<?= $i ?>">

      <div class="card-kicker-edit">
        <div class="kicker-label">&#128128; FML Kicker — edit before approving</div>
        <textarea class="kicker-input" name="kicker"><?= h($s['fml_kicker'] ?? '') ?></textarea>
      </div>

      <div class="card-source">via <?= h($s['source'] ?? '') ?></div>

      <?php if (!empty($s['fetched_at'])): ?>
      <div class="card-fetched">Fetched <?= h(fmtDate($s['fetched_at'])) ?></div>
      <?php endif; ?>

      <div class="card-actions">
        <button type="submit" name="action" value="approve" class="btn-approve">&#10003; Approve</button>
        <button type="submit" name="action" value="reject" class="btn-reject"
          onclick="return confirm('Discard this story permanently?')">&#10005; Reject</button>
      </div>
    </form>
  </div>
  <?php endforeach; ?>
</div>
<?php endif; ?>

<footer class="admin-footer">
  Shocked But Not Surprised &mdash; Editorial Queue<br>
  Approve to publish &middot; Reject to discard &middot; Kicker is editable before approving
</footer>

</body>
</html>
