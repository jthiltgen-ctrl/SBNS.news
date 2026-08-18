<?php
/**
 * published.php
 * Public endpoint — serves published stories to the React frontend.
 * Returns data/published.json, newest-first, capped at 50 stories.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: no-cache');

define('PUBLISHED_FILE', __DIR__ . '/../data/published.json');

if (!file_exists(PUBLISHED_FILE)) {
    echo '[]';
    exit;
}

$fp      = fopen(PUBLISHED_FILE, 'r');
flock($fp, LOCK_SH);
$content = file_get_contents(PUBLISHED_FILE);
flock($fp, LOCK_UN);
fclose($fp);

$stories = json_decode($content, true);
if (!is_array($stories)) {
    echo '[]';
    exit;
}

// Already newest-first (admin prepends on approve). Cap at 50.
echo json_encode(array_slice($stories, 0, 50));
