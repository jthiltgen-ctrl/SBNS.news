<?php
/**
 * fetch-stories.php
 * Called by the GitHub Actions scheduled job 4x/day.
 * Protected by X-Fetch-Token header matching FETCH_SECRET_TOKEN env var.
 * Fetches AI story candidates from Anthropic, deduplicates, appends to data/pending.json.
 */

header('Content-Type: application/json');

// ── Load credentials from config file above public_html ───────────────────────
$configFile = __DIR__ . '/../../sbns-config.php';
if (file_exists($configFile)) require_once $configFile;

// ── Auth ─────────────────────────────────────────────────────────────────────
$expectedToken = getenv('FETCH_SECRET_TOKEN');
$providedToken = $_SERVER['HTTP_X_FETCH_TOKEN'] ?? '';

if (!$expectedToken || !hash_equals($expectedToken, $providedToken)) {
    http_response_code(401);
    exit(json_encode(['error' => 'Unauthorized']));
}

// ── Paths ─────────────────────────────────────────────────────────────────────
define('DATA_DIR',       __DIR__ . '/../data/');
define('PENDING_FILE',   DATA_DIR . 'pending.json');
define('PUBLISHED_FILE', DATA_DIR . 'published.json');

// Create data directory + deny-all .htaccess on first run
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

// ── Deduplication ─────────────────────────────────────────────────────────────
function normalizeHeadline(string $text): string {
    $text = strtolower($text);
    $text = preg_replace('/[^a-z0-9\s]/', '', $text);
    return trim(preg_replace('/\s+/', ' ', $text));
}

function isDuplicate(string $headline, array $existingStories): bool {
    $normalized = normalizeHeadline($headline);
    foreach ($existingStories as $story) {
        if (empty($story['headline'])) continue;
        similar_text($normalized, normalizeHeadline($story['headline']), $pct);
        if ($pct >= 80) return true;
    }
    return false;
}

// ── Anthropic API call ────────────────────────────────────────────────────────
$apiKey = getenv('ANTHROPIC_API_KEY');
if (!$apiKey) {
    http_response_code(500);
    exit(json_encode(['error' => 'ANTHROPIC_API_KEY not configured']));
}

$systemPrompt = 'You are the editorial AI for "Shocked But Not Surprised" — a news aggregator covering systems, institutions, and structures failing the people they\'re supposed to serve.

Search for 6 recent, real news stories about institutional failures, governmental shortcomings, corporate malfeasance, environmental injustice, or social systems letting people down. Mix categories.

Return ONLY a valid JSON array with no markdown, no backticks, no preamble — just the raw JSON:

[
  {
    "headline": "Direct, serious headline, max 12 words",
    "summary": "2-3 sentence factual summary of what happened and who was harmed or affected.",
    "fml_kicker": "One darkly humorous, FML-style line capturing the absurdity. Punch UP at power, never DOWN at victims. Think: weary sigh, not cruelty.",
    "category": "International or National or Local",
    "source": "Publication or outlet name",
    "topic_tags": ["tag1", "tag2"],
    "severity": 3
  }
]

Rules:
- severity is 1-5: 1=frustrating, 3=serious harm, 5=catastrophic
- Stories must be real and recent (past 2-3 weeks ideally)
- No partisan framing — focus on accountability, impact, and affected people
- Vary topics: health, housing, environment, criminal justice, education, infrastructure, finance, etc.
- FML kickers should feel like something a burned-out policy analyst would mutter under their breath';

$payload = json_encode([
    'model'      => 'claude-sonnet-4-20250514',
    'max_tokens' => 2048,
    'system'     => $systemPrompt,
    'tools'      => [['type' => 'web_search_20250305', 'name' => 'web_search']],
    'messages'   => [['role' => 'user', 'content' => 'Find 6 recent stories about systems failing people. Mix international, national, and local.']],
]);

$ch = curl_init('https://api.anthropic.com/v1/messages');
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER     => [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey,
        'anthropic-version: 2023-06-01',
    ],
    CURLOPT_POSTFIELDS => $payload,
    CURLOPT_TIMEOUT    => 120,
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode !== 200) {
    http_response_code(502);
    exit(json_encode(['error' => 'Anthropic API error', 'status' => $httpCode, 'body' => $response]));
}

// ── Parse response ────────────────────────────────────────────────────────────
$data       = json_decode($response, true);
$textBlocks = array_filter($data['content'] ?? [], function($b) { return $b['type'] === 'text'; });
$fullText   = implode('', array_column(array_values($textBlocks), 'text'));

if (!preg_match('/\[[\s\S]*\]/u', $fullText, $matches)) {
    http_response_code(502);
    exit(json_encode(['error' => 'No JSON array found in Anthropic response']));
}

$incoming = json_decode($matches[0], true);
if (!is_array($incoming)) {
    http_response_code(502);
    exit(json_encode(['error' => 'Invalid JSON from AI']));
}

// ── Deduplicate and append ────────────────────────────────────────────────────
$pending   = readJson(PENDING_FILE);
$published = readJson(PUBLISHED_FILE);
$existing  = array_merge($pending, $published);

$added     = 0;
$skipped   = 0;
$timestamp = date('c');

foreach ($incoming as $story) {
    if (empty($story['headline'])) { $skipped++; continue; }
    if (isDuplicate($story['headline'], $existing)) { $skipped++; continue; }

    $story['fetched_at'] = $timestamp;
    $pending[]  = $story;
    $existing[] = $story; // prevent intra-batch dupes
    $added++;
}

writeJson(PENDING_FILE, $pending);

echo json_encode([
    'added'         => $added,
    'skipped'       => $skipped,
    'total_pending' => count($pending),
]);
