<?php
declare(strict_types=1);

/**
 * Contract Test: Takeoff SSO Single-Use State & PKCE S256 Contract.
 * Task: TASK-0222
 *
 * Freezes the security contract for Takeoff SSO authentication flow:
 * 1. Single-use, short-lived, constant-time compared State eliminated after callback.
 * 2. High-entropy PKCE Code Verifier stored exclusively in session.
 * 3. PKCE Code Challenge computed as BASE64URL(SHA256(verifier)) with S256 method.
 * 4. Explicit rejection of 'plain' PKCE method.
 * 5. Deterministic, zero external dependencies (no network, no database).
 *
 * Expected failure when target core/auth/SsoFlow.php is absent or unimplemented.
 */

$targetFile = dirname(__DIR__) . '/core/auth/SsoFlow.php';

if (!file_exists($targetFile)) {
    fwrite(STDERR, "[RED] Contract target file missing: core/auth/SsoFlow.php\n");
    exit(1);
}

require_once $targetFile;

// Support both namespaced and global class declaration
$className = null;
if (class_exists('Takeoff\\Core\\Auth\\SsoFlow')) {
    $className = 'Takeoff\\Core\\Auth\\SsoFlow';
} elseif (class_exists('SsoFlow')) {
    $className = 'SsoFlow';
} else {
    fwrite(STDERR, "[RED] Class SsoFlow or Takeoff\\Core\\Auth\\SsoFlow not found in core/auth/SsoFlow.php\n");
    exit(1);
}

$passed = 0;
$failed = 0;

function assertContract(bool $condition, string $message): void {
    global $passed, $failed;
    if ($condition) {
        echo "  [PASS] {$message}\n";
        $passed++;
    } else {
        fwrite(STDERR, "  [FAIL] {$message}\n");
        $failed++;
    }
}

echo "=== TASK-0222: Takeoff SSO State & PKCE S256 Contract Test ===\n";

$flow = new $className();

// =========================================================================
// 1. STATE CONTRACT
// =========================================================================
echo "\n--- Section 1: State Generation & Entropy ---\n";

// State generation must produce random, high-entropy tokens
if (method_exists($flow, 'generateState')) {
    $state1 = $flow->generateState();
    $state2 = $flow->generateState();

    assertContract(is_string($state1) && strlen($state1) >= 32, "generateState returns string with >= 32 characters (>= 128-bit entropy)");
    assertContract($state1 !== $state2, "Consecutive states are unique and non-deterministic");
} else {
    assertContract(false, "Method generateState() exists on {$className}");
}

echo "\n--- Section 2: State Creation, Expiration & Secure Comparison ---\n";

$session = [];
$t0 = 1700000000;

if (method_exists($flow, 'createState') && method_exists($flow, 'validateAndConsumeState')) {
    // 2.1 Creation and storage in session
    $createdState = $flow->createState($session, 300, $t0);
    assertContract(is_string($createdState) && strlen($createdState) >= 32, "createState returns valid state token");
    assertContract(!empty($session), "createState stores state and metadata in session");

    // 2.2 Short expiration window (default TTL <= 600s, test at t0 + 299s valid, t0 + 301s expired)
    $validWithinTtl = $flow->validateAndConsumeState($session, $createdState, $t0 + 299);
    assertContract($validWithinTtl === true, "State is valid within short expiration TTL window (t0 + 299s)");

    // 2.3 Single-use consumption: second call must be rejected
    $replayAttempt = $flow->validateAndConsumeState($session, $createdState, $t0 + 299);
    assertContract($replayAttempt === false, "State is single-use: replay attempt is rejected");

    // 2.4 Elimination after callback: state must be cleared from session
    $sessionAfterUse = $session;
    $remainingStateValues = array_filter($sessionAfterUse, function ($val) use ($createdState) {
        return $val === $createdState || (is_array($val) && in_array($createdState, $val, true));
    });
    assertContract(empty($remainingStateValues), "State is completely eliminated from session after consumption");

    // 2.5 Expired state rejection
    $sessionExpired = [];
    $expiredState = $flow->createState($sessionExpired, 300, $t0);
    $expiredResult = $flow->validateAndConsumeState($sessionExpired, $expiredState, $t0 + 301);
    assertContract($expiredResult === false, "Expired state (t0 + 301s on 300s TTL) is strictly rejected");

    // 2.6 Secure constant-time comparison / tampered state rejection
    $sessionTampered = [];
    $goodState = $flow->createState($sessionTampered, 300, $t0);
    $tamperedState = $goodState . 'x';
    $tamperedResult = $flow->validateAndConsumeState($sessionTampered, $tamperedState, $t0 + 10);
    assertContract($tamperedResult === false, "Tampered state is rejected");

    // 2.7 Empty / invalid state rejection
    $emptyResult = $flow->validateAndConsumeState($sessionTampered, '', $t0 + 10);
    assertContract($emptyResult === false, "Empty state parameter is rejected");
} else {
    assertContract(false, "Methods createState() and validateAndConsumeState() exist on {$className}");
}

// =========================================================================
// 2. PKCE S256 CONTRACT
// =========================================================================
echo "\n--- Section 3: PKCE Verifier Entropy & Format (RFC 7636) ---\n";

if (method_exists($flow, 'generateCodeVerifier')) {
    $verifier1 = $flow->generateCodeVerifier();
    $verifier2 = $flow->generateCodeVerifier();

    assertContract(is_string($verifier1), "generateCodeVerifier returns string");
    assertContract(strlen($verifier1) >= 43 && strlen($verifier1) <= 128, "Verifier length is between 43 and 128 chars (RFC 7636)");
    assertContract((bool)preg_match('/^[A-Za-z0-9\-._~]+$/', $verifier1), "Verifier contains only unreserved RFC 7636 characters");
    assertContract($verifier1 !== $verifier2, "Consecutive code verifiers have high entropy and are unique");
} else {
    assertContract(false, "Method generateCodeVerifier() exists on {$className}");
}

echo "\n--- Section 4: PKCE Challenge S256 Calculation & Plain Rejection ---\n";

if (method_exists($flow, 'generateCodeChallenge')) {
    // 4.1 Canonical RFC 7636 Appendix B test vector
    $rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    $expectedRfcChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    $rfcChallengeResult = $flow->generateCodeChallenge($rfcVerifier, 'S256');
    assertContract(
        $rfcChallengeResult === $expectedRfcChallenge,
        "Challenge matches RFC 7636 Appendix B vector BASE64URL(SHA256(verifier))"
    );

    // 4.2 Dynamic challenge verification: BASE64URL without padding, '+', or '/'
    $dynamicVerifier = 'test-verifier-' . bin2hex(random_bytes(20));
    $expectedDynamicChallenge = rtrim(strtr(base64_encode(hash('sha256', $dynamicVerifier, true)), '+/', '-_'), '=');
    $dynamicChallengeResult = $flow->generateCodeChallenge($dynamicVerifier, 'S256');
    assertContract(
        $dynamicChallengeResult === $expectedDynamicChallenge,
        "Dynamic challenge equals BASE64URL(SHA256(verifier))"
    );
    assertContract(
        strpos($dynamicChallengeResult, '=') === false &&
        strpos($dynamicChallengeResult, '+') === false &&
        strpos($dynamicChallengeResult, '/') === false,
        "Challenge is URL-safe without padding '=' or '+' or '/'"
    );

    // 4.3 Explicit rejection of 'plain' PKCE method
    $plainRejected = false;
    try {
        $flow->generateCodeChallenge($rfcVerifier, 'plain');
    } catch (\InvalidArgumentException | \DomainException $e) {
        $plainRejected = true;
    } catch (\Throwable $e) {
        $plainRejected = true;
    }
    assertContract($plainRejected, "PKCE method 'plain' is strictly rejected with an exception");

    // 4.4 Unsupported / arbitrary methods rejected
    $unsupportedRejected = false;
    try {
        $flow->generateCodeChallenge($rfcVerifier, 'UNKNOWN_METHOD');
    } catch (\Throwable $e) {
        $unsupportedRejected = true;
    }
    assertContract($unsupportedRejected, "Unsupported PKCE methods are rejected");
} else {
    assertContract(false, "Method generateCodeChallenge() exists on {$className}");
}

echo "\n--- Section 5: PKCE Verifier Stored Exclusively in Session ---\n";

if (method_exists($flow, 'initiateAuth') && method_exists($flow, 'consumeCodeVerifier')) {
    $authSession = [];
    $authParams = $flow->initiateAuth($authSession);

    // 5.1 Public authorization parameters MUST include state, code_challenge, code_challenge_method=S256
    assertContract(isset($authParams['state']) && !empty($authParams['state']), "Auth request includes state");
    assertContract(isset($authParams['code_challenge']) && !empty($authParams['code_challenge']), "Auth request includes code_challenge");
    assertContract(isset($authParams['code_challenge_method']) && $authParams['code_challenge_method'] === 'S256', "Auth request specifies code_challenge_method = 'S256'");

    // 5.2 Public authorization parameters MUST NOT leak code_verifier
    assertContract(!isset($authParams['code_verifier']), "code_verifier is NEVER exposed in public auth parameters");

    // 5.3 code_verifier stored in session and consumable for token exchange
    $consumedVerifier = $flow->consumeCodeVerifier($authSession);
    assertContract(is_string($consumedVerifier) && strlen($consumedVerifier) >= 43, "consumeCodeVerifier retrieves verifier from session");

    // 5.4 One-time consumption: verifier removed from session after retrieval
    $secondConsume = $flow->consumeCodeVerifier($authSession);
    assertContract($secondConsume === null, "code_verifier is consumed and removed from session (cannot be re-consumed)");
} else {
    assertContract(false, "Methods initiateAuth() and consumeCodeVerifier() exist on {$className}");
}

echo "\n=============================================================\n";
echo "Results: {$passed} passed, {$failed} failed.\n";

if ($failed > 0) {
    exit(1);
}

exit(0);
