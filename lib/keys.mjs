import { randomBytes, createHash } from 'node:crypto'

/** @returns {string} a fresh 32-byte API key, hex encoded */
export function generateKey() {
  return randomBytes(32).toString('hex')
}

/**
 * Unsalted SHA-256 is CORRECT here — do not "upgrade" this to bcrypt/argon2.
 * Salting + stretching exist to defend human-chosen passwords, whose input
 * space is small enough to guess or dictionary-attack; a key from
 * generateKey() is 256 bits of CSPRNG output, already unguessable and unique
 * per call, so salting adds nothing and a KDF would just tax every API
 * request for zero extra security. Unsalted SHA-256 of a high-entropy random
 * token is the standard construction (same reasoning as GitHub/Stripe-style
 * API tokens). Storing only this hash (api_keys.hash, unique-indexed) is what
 * makes the plaintext unrecoverable from the database.
 *
 * @param {string} key @returns {string} SHA-256 of the key, hex encoded
 */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex')
}
