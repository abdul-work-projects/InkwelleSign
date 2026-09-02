import test from 'node:test';
import assert from 'node:assert/strict';
import { useTempStore } from './helpers.mjs';
useTempStore('crypto');

const {
  sha256, hashPassword, verifyPassword, canonicalJson,
  generateKeyPair, signPayload, verifySignature, hmacSha256, randomToken,
} = await import('../lib/crypto.js');

test('password hashing uses a per-user salt and verifies correctly', () => {
  const a = hashPassword('correct-horse-battery');
  const b = hashPassword('correct-horse-battery');
  assert.notEqual(a, b, 'identical passwords must not produce identical digests');
  assert.ok(a.startsWith('scrypt$'));
  assert.equal(verifyPassword('correct-horse-battery', a), true);
  assert.equal(verifyPassword('correct-horse-batteryX', a), false);
  assert.equal(verifyPassword('', a), false);
});

test('verifyPassword rejects malformed stored values without throwing', () => {
  for (const bad of ['', 'nonsense', 'scrypt$x$y$z$q$r', null, undefined]) {
    assert.equal(verifyPassword('anything', bad), false);
  }
});

test('canonicalJson is key-order independent', () => {
  assert.equal(canonicalJson({ b: 1, a: [3, { z: 1, y: 2 }] }), canonicalJson({ a: [3, { y: 2, z: 1 }], b: 1 }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
});

test('evidence signatures verify and reject tampering', () => {
  const { privateKey, publicKey } = generateKeyPair();
  const payload = canonicalJson({ envelopeId: 'env_1', headHash: sha256('x') });
  const sig = signPayload(privateKey, payload);
  assert.equal(verifySignature(publicKey, payload, sig), true);
  assert.equal(verifySignature(publicKey, `${payload} `, sig), false);
  const other = generateKeyPair();
  assert.equal(verifySignature(other.publicKey, payload, sig), false);
});

test('tokens are high entropy and unique', () => {
  const seen = new Set();
  for (let i = 0; i < 500; i++) {
    const t = randomToken(32);
    assert.equal(seen.has(t), false);
    assert.ok(t.length >= 42);
    seen.add(t);
  }
});

test('webhook HMAC matches the documented construction', () => {
  const sig = hmacSha256('whsec_abc', '1700000000.{"a":1}');
  assert.match(sig, /^[0-9a-f]{64}$/);
  assert.equal(sig, hmacSha256('whsec_abc', '1700000000.{"a":1}'));
  assert.notEqual(sig, hmacSha256('whsec_abd', '1700000000.{"a":1}'));
});
