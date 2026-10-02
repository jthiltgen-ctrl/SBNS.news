#!/usr/bin/env php
<?php
// SBNS Story Queue mail pipe for GreenGeeks/cPanel.
// Reads one RFC 5322 message from STDIN, extracts bounded ordinary-email metadata
// and public HTTP(S) links, ignores attachments, then sends a signed JSON payload
// to the SBNS Newsroom bridge. No raw MIME or attachment bytes leave the mail host.

declare(strict_types=1);

const MAX_RAW_BYTES = 262144;
const MAX_TEXT_BYTES = 12000;
const MAX_URLS = 10;

function fail_temp(string $message): never {
    fwrite(STDERR, "SBNS Story Queue temporary failure: {$message}\n");
    exit(75);
}

function fail_perm(string $message): never {
    fwrite(STDERR, "SBNS Story Queue rejected: {$message}\n");
    exit(0);
}

function unfold_headers(string $headers): string {
    return preg_replace("/\r?\n[\t ]+/", ' ', $headers) ?? $headers;
}

function parse_headers(string $headers): array {
    $result = [];
    foreach (preg_split('/\r?\n/', unfold_headers($headers)) ?: [] as $line) {
        $pos = strpos($line, ':');
        if ($pos === false) continue;
        $name = strtolower(trim(substr($line, 0, $pos)));
        $value = trim(substr($line, $pos + 1));
        if ($name === '') continue;
        $result[$name] = isset($result[$name]) ? $result[$name] . ', ' . $value : $value;
    }
    return $result;
}

function decode_header_value(?string $value): ?string {
    if ($value === null || trim($value) === '') return null;
    if (function_exists('iconv_mime_decode')) {
        $decoded = @iconv_mime_decode($value, ICONV_MIME_DECODE_CONTINUE_ON_ERROR, 'UTF-8');
        if (is_string($decoded) && $decoded !== '') return trim($decoded);
    }
    return trim($value);
}

function email_from_header(?string $value): ?string {
    if (!$value) return null;
    if (preg_match('/<([^<>\s]+@[^<>\s]+)>/', $value, $m)) return strtolower($m[1]);
    if (preg_match('/\b([^\s<>(),;]+@[^\s<>(),;]+)\b/', $value, $m)) return strtolower($m[1]);
    return null;
}

function decode_body(string $body, array $headers): string {
    $encoding = strtolower(trim($headers['content-transfer-encoding'] ?? ''));
    if ($encoding === 'base64') {
        $decoded = base64_decode(preg_replace('/\s+/', '', $body) ?? $body, true);
        return is_string($decoded) ? $decoded : '';
    }
    if ($encoding === 'quoted-printable') return quoted_printable_decode($body);
    return $body;
}

function text_from_part(string $rawPart): array {
    $pieces = preg_split("/\r?\n\r?\n/", $rawPart, 2);
    if (!$pieces || count($pieces) < 2) return ['', 0];
    [$headerText, $body] = $pieces;
    $headers = parse_headers($headerText);
    $contentType = strtolower($headers['content-type'] ?? 'text/plain');
    $disposition = strtolower($headers['content-disposition'] ?? '');
    if (str_contains($disposition, 'attachment')) return ['', 1];
    if (!str_starts_with($contentType, 'text/plain')) return ['', 0];
    return [decode_body($body, $headers), 0];
}

function extract_plain_text(string $body, array $headers): array {
    $contentType = $headers['content-type'] ?? 'text/plain';
    $lower = strtolower($contentType);
    if (preg_match('/multipart\/[^;]+;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i', $contentType, $m)) {
        $boundary = $m[1] !== '' ? $m[1] : $m[2];
        $parts = preg_split('/--' . preg_quote($boundary, '/') . '(?:--)?\r?\n/', $body) ?: [];
        $texts = [];
        $attachments = 0;
        foreach ($parts as $part) {
            [$text, $count] = text_from_part($part);
            $attachments += $count;
            if ($text !== '') $texts[] = $text;
        }
        return [implode("\n\n", $texts), $attachments];
    }
    if (str_starts_with($lower, 'text/plain')) return [decode_body($body, $headers), 0];
    return ['', str_contains(strtolower($headers['content-disposition'] ?? ''), 'attachment') ? 1 : 0];
}

function clean_text(string $text): string {
    $text = str_replace("\0", ' ', $text);
    $text = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', ' ', $text) ?? $text;
    $text = trim($text);
    if (strlen($text) > MAX_TEXT_BYTES) $text = substr($text, 0, MAX_TEXT_BYTES);
    return $text;
}

function extract_urls(string $text): array {
    preg_match_all('~https?://[^\s<>"\'\)\]\}]+~i', $text, $matches);
    $urls = [];
    foreach ($matches[0] ?? [] as $url) {
        $url = rtrim($url, '.,;:!?');
        if (!filter_var($url, FILTER_VALIDATE_URL)) continue;
        if (!in_array($url, $urls, true)) $urls[] = $url;
        if (count($urls) >= MAX_URLS) break;
    }
    return $urls;
}

$configPath = getenv('SBNS_STORYQUEUE_CONFIG') ?: getenv('HOME') . '/.config/sbns/storyqueue.json';
$configRaw = @file_get_contents($configPath);
if ($configRaw === false) fail_temp('configuration file unavailable');
$config = json_decode($configRaw, true);
if (!is_array($config) || empty($config['endpoint']) || empty($config['token'])) fail_temp('configuration invalid');

$raw = stream_get_contents(STDIN, MAX_RAW_BYTES + 1);
if ($raw === false) fail_temp('unable to read message');
if (strlen($raw) > MAX_RAW_BYTES) fail_perm('message exceeds bounded intake size');

$parts = preg_split("/\r?\n\r?\n/", $raw, 2);
if (!$parts || count($parts) < 2) fail_perm('malformed email');
[$headerText, $body] = $parts;
$headers = parse_headers($headerText);
$sender = email_from_header($headers['from'] ?? null);
$recipient = email_from_header($headers['to'] ?? null) ?: 'storyqueue@shockedbutnotsurprised.news';
if (!$sender) fail_perm('sender address unavailable');

[$plainText, $attachmentCount] = extract_plain_text($body, $headers);
$plainText = clean_text($plainText);
$urls = extract_urls($plainText);
$receivedAt = null;
if (!empty($headers['date'])) {
    $timestamp = strtotime($headers['date']);
    if ($timestamp !== false) $receivedAt = gmdate('c', $timestamp);
}
if (!$receivedAt) $receivedAt = gmdate('c');

$payload = [
    'schema_version' => '1',
    'recipient' => strtolower($recipient),
    'sender' => strtolower($sender),
    'subject' => decode_header_value($headers['subject'] ?? null),
    'message_id' => trim($headers['message-id'] ?? '') ?: null,
    'received_at' => $receivedAt,
    'plain_text' => $plainText,
    'urls' => $urls,
    'attachment_count' => $attachmentCount,
];
$json = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
if ($json === false) fail_temp('payload encoding failed');

$headersOut = [
    'Content-Type: application/json',
    'Accept: application/json',
    'Authorization: Bearer ' . $config['token'],
    'User-Agent: SBNS-StoryQueue-GreenGeeks/1.0',
];

$status = 0;
$response = false;
if (function_exists('curl_init')) {
    $ch = curl_init($config['endpoint']);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $json,
        CURLOPT_HTTPHEADER => $headersOut,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 8,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_MAXREDIRS => 0,
    ]);
    $response = curl_exec($ch);
    $status = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
} else {
    $context = stream_context_create(['http' => [
        'method' => 'POST', 'header' => implode("\r\n", $headersOut), 'content' => $json,
        'timeout' => 20, 'ignore_errors' => true,
    ]]);
    $response = @file_get_contents($config['endpoint'], false, $context);
    foreach ($http_response_header ?? [] as $line) {
        if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $line, $m)) $status = (int)$m[1];
    }
}

if ($response === false || $status < 200 || $status >= 300) fail_temp('Newsroom bridge returned HTTP ' . $status);
exit(0);
