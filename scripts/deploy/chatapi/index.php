<?php
/*
 * The API's front door on chatapi.crishub.com.
 *
 * The Node process listens on 127.0.0.1:8000 and nothing on this plan could
 * reach it: a `RewriteRule ... [P]` answers 503 because mod_proxy is not
 * permitted, and the host's Node application manager can only be set up
 * through its control panel. PHP can open a loopback socket, so this does the
 * one thing that was missing — carry a request in and the answer back out.
 *
 * It is a forwarder and deliberately not a gateway. It adds no headers of its
 * own, makes no decisions about who may call, and rewrites nothing: the API
 * behind it already does CORS, sessions and authentication, and a proxy that
 * had opinions about those would be a second place for them to disagree.
 *
 * The destination is fixed in this file. It cannot be pointed anywhere by a
 * request, so it can never be used as an open proxy.
 */

declare(strict_types=1);

const UPSTREAM = 'http://127.0.0.1:8000';

/*
 * The ceiling on any single request through this gateway.
 *
 * It has to stay above the API's own timeouts, not below them. The API gives
 * up on a provider at AI_REQUEST_TIMEOUT_MS (15s by default) and answers with
 * a timeout the interface can explain. If this cut in first, the browser would
 * get a gateway failure instead — the same wait, and nothing to say about it.
 *
 * So: raising AI_REQUEST_TIMEOUT_MS above about 28s means raising this too, or
 * the longer allowance does not exist. That is the trap this comment is for.
 */
const TIMEOUT_SECONDS = 30;

/* Request headers worth carrying. Hop-by-hop and host headers are not. */
const FORWARD_REQUEST = [
    'CONTENT_TYPE'    => 'Content-Type',
    'HTTP_ACCEPT'     => 'Accept',
    'HTTP_COOKIE'     => 'Cookie',
    'HTTP_ORIGIN'     => 'Origin',
    'HTTP_REFERER'    => 'Referer',
    'HTTP_USER_AGENT' => 'User-Agent',
    'HTTP_ACCESS_CONTROL_REQUEST_METHOD'  => 'Access-Control-Request-Method',
    'HTTP_ACCESS_CONTROL_REQUEST_HEADERS' => 'Access-Control-Request-Headers',
];

/*
 * Response headers that belong to this hop rather than to the answer.
 * Content-Length is dropped because PHP may re-encode the body; passing the
 * upstream length would truncate it. Transfer-Encoding likewise.
 */
const DROP_RESPONSE = ['transfer-encoding', 'content-length', 'connection', 'keep-alive'];

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$query = $_SERVER['QUERY_STRING'] ?? '';
$target = UPSTREAM . $path . ($query !== '' ? '?' . $query : '');

$requestHeaders = [];
foreach (FORWARD_REQUEST as $server => $header) {
    if (!empty($_SERVER[$server])) {
        $requestHeaders[] = $header . ': ' . $_SERVER[$server];
    }
}

/*
 * The caller's address, so rate limiting counts people rather than counting
 * this script once. Everything arrives from the loopback otherwise.
 */
if (!empty($_SERVER['REMOTE_ADDR'])) {
    $requestHeaders[] = 'X-Forwarded-For: ' . $_SERVER['REMOTE_ADDR'];
    $requestHeaders[] = 'X-Forwarded-Proto: ' . (empty($_SERVER['HTTPS']) ? 'http' : 'https');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$body = in_array($method, ['GET', 'HEAD', 'OPTIONS'], true) ? null : file_get_contents('php://input');

$curl = curl_init($target);
curl_setopt_array($curl, [
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $requestHeaders,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HEADER         => false,
    CURLOPT_TIMEOUT        => TIMEOUT_SECONDS,
    CURLOPT_CONNECTTIMEOUT => 5,
    /* Redirects are the API's answer to give, not this script's to follow. */
    CURLOPT_FOLLOWLOCATION => false,
]);
if ($body !== null && $body !== '') {
    curl_setopt($curl, CURLOPT_POSTFIELDS, $body);
}

/*
 * Headers are sent as they arrive rather than collected, so multiple
 * Set-Cookie lines survive — array-collecting them and re-emitting is where
 * the second cookie usually goes missing.
 */
curl_setopt($curl, CURLOPT_HEADERFUNCTION, static function ($_curl, string $line): int {
    $length = strlen($line);
    $trimmed = trim($line);
    if ($trimmed === '' || stripos($trimmed, 'HTTP/') === 0) {
        return $length;
    }
    $colon = strpos($trimmed, ':');
    if ($colon === false) {
        return $length;
    }
    $name = strtolower(trim(substr($trimmed, 0, $colon)));
    if (in_array($name, DROP_RESPONSE, true)) {
        return $length;
    }
    header($trimmed, false);
    return $length;
});

$response = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);

if ($response === false || $status === 0) {
    /*
     * The API is not answering. Said in the API's own shape, because the thing
     * reading this is the web app's error handling and not a person.
     */
    http_response_code(502);
    header('Content-Type: application/json');
    error_log('chatapi gateway: upstream unreachable: ' . $error);
    echo json_encode(['error' => 'The API is not responding. Please try again shortly.']);
    return;
}

http_response_code($status);
echo $response;
