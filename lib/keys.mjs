import { randomBytes, createHash } from 'node:crypto'

/** @returns {string} a fresh 32-byte API key, hex encoded */
export function generateKey() {
  return randomBytes(32).toString('hex')
}

/** @param {string} key @returns {string} SHA-256 of the key, hex encoded */
export function hashKey(key) {
  return createHash('sha256').update(key).digest('hex')
}
