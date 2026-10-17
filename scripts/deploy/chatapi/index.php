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

/*
 * Waking the API when it is not there.
 *
 * Shared hosting reaps a Node process it did not start itself, and on this
 * plan there is no Node application manager to start it instead. PHP is the
 * one thing that is always running here, because the web server runs it for
 * every request — so when a request finds nobody listening, this starts the
 * API rather than answering 502 and waiting for the cron job.
 *
 * It runs the same `keepalive.sh` the cron does, under the same lock, so the
 * two can never start the API twice: whichever arrives second sees the lock
 * held and does nothing.
 *
 * PRIVATE_DIR is rewritten by remote-install.sh when DEPLOY_PRIVATE differs.
 * If it is wrong, or the host does not let PHP start processes, nothing breaks:
 * the request is answered with the same 502 as before.
 */
const PRIVATE_DIR = '/home/u471078694/domains/reflections.crishub.com/private/chat_app';
const NODE_BIN_DIR = '/opt/alt/alt-nodejs22/root/usr/bin';

/*
 * How long a request waits for the API to come up. The API binds in one or two
 * seconds; the margin is for a slow disk. Kept well inside PHP's own execution
 * limit, and the retry still has TIMEOUT_SECONDS after it.
 */
const WAKE_WAIT_SECONDS = 15;

/*
 * After a wake that did not bring the API up, stop making every request wait
 * for it. An API that fails on boot would otherwise cost each visitor fifteen
 * seconds before the same 502; within this window they get the 502 at once.
 */
const WAKE_BACKOFF_SECONDS = 60;

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

/*
 * One attempt at the upstream. Headers are emitted as they arrive, so on a
 * connection that was refused nothing has been sent yet and the attempt can be
 * made again.
 */
function forward(string $target, string $method, array $requestHeaders, ?string $body): array
{
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
    $result = [
        'response' => $response,
        'status'   => (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE),
        'errno'    => curl_errno($curl),
        'error'    => curl_error($curl),
    ];
    curl_close($curl);
    return $result;
}

function upstream_listening(): bool
{
    $parts = parse_url(UPSTREAM);
    $socket = @fsockopen($parts['host'], (int) $parts['port'], $_errno, $_error, 1.0);
    if ($socket === false) {
        return false;
    }
    fclose($socket);
    return true;
}

function can_start_processes(): bool
{
    if (!function_exists('proc_open')) {
        return false;
    }
    $disabled = array_map('trim', explode(',', (string) ini_get('disable_functions')));
    return !in_array('proc_open', $disabled, true);
}

/*
 * Start keepalive.sh detached and return at once. It outlives this request:
 * `setsid` (when present) and `nohup` keep the web server's end of the request
 * from taking the API down with it.
 *
 * `flock -w`, not the cron's `-n`. A keepalive run holds the lock for up to
 * 20s while it waits for the API to answer, and if the API died inside that
 * window, giving up on the lock meant nobody started it — found by killing
 * the API seconds after a restart. Waiting for the lock and then asking again
 * costs nothing when the API is already back: keepalive.sh exits on a healthy
 * check.
 */
function start_keepalive(): bool
{
    $keepalive = PRIVATE_DIR . '/current/scripts-deploy/keepalive.sh';
    if (!can_start_processes() || !is_file($keepalive)) {
        return false;
    }
    $command = sprintf(
        'cd %1$s && export PATH=%2$s:/usr/local/bin:/usr/bin:/bin; '
        . 'S=; command -v setsid >/dev/null 2>&1 && S=setsid; '
        . '$S nohup /usr/bin/flock -w 30 %3$s /usr/bin/bash %4$s >/dev/null 2>&1 &',
        escapeshellarg(PRIVATE_DIR),
        escapeshellarg(NODE_BIN_DIR),
        escapeshellarg(PRIVATE_DIR . '/keepalive.lock'),
        escapeshellarg($keepalive),
    );
    $process = @proc_open(['/bin/sh', '-c', $command], [
        0 => ['file', '/dev/null', 'r'],
        1 => ['file', '/dev/null', 'w'],
        2 => ['file', '/dev/null', 'w'],
    ], $_pipes);
    if (!is_resource($process)) {
        return false;
    }
    proc_close($process);
    return true;
}

/*
 * Bring the API up, or wait for a wake another request already started.
 * Returns whether it is listening afterwards.
 */
function wake_upstream(): bool
{
    $marker = PRIVATE_DIR . '/logs/gateway-wake.last';
    $since = is_file($marker) ? time() - (int) filemtime($marker) : PHP_INT_MAX;

    if ($since >= WAKE_WAIT_SECONDS && $since < WAKE_BACKOFF_SECONDS) {
        // A recent wake did not work. Answer now rather than wait again.
        return false;
    }
    if ($since >= WAKE_BACKOFF_SECONDS) {
        if (!start_keepalive()) {
            return false;
        }
        @touch($marker);
        error_log('chatapi gateway: API was not listening; started keepalive');
        $since = 0;
    }

    $deadline = microtime(true) + max(1, WAKE_WAIT_SECONDS - $since);
    while (microtime(true) < $deadline) {
        if (upstream_listening()) {
            return true;
        }
        usleep(250000);
    }
    return upstream_listening();
}

$result = forward($target, $method, $requestHeaders, $body);

/*
 * Retried only on a refused connection: the request provably never reached the
 * API, so sending it again cannot do anything twice. A timeout is not retried —
 * the API may have acted on it.
 */
if ($result['errno'] === CURLE_COULDNT_CONNECT && wake_upstream()) {
    $result = forward($target, $method, $requestHeaders, $body);
}

$response = $result['response'];
$status = $result['status'];
$error = $result['error'];

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
