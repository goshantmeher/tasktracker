import { Client } from 'node-appwrite'

export const DB = process.env.APPWRITE_DATABASE_ID!

function base() {
  return new Client()
    .setEndpoint(process.env.APPWRITE_ENDPOINT!)
    .setProject(process.env.APPWRITE_PROJECT_ID!)
}

/** Full-privilege client. Used by /api routes and anything key-authenticated. */
export function serverClient() {
  return base().setKey(process.env.APPWRITE_API_KEY!)
}

/** Acts as the logged-in human, using the session secret from their cookie. */
export function sessionClient(secret: string) {
  return base().setSession(secret)
}

/**
 * Admin client: project + API key, but no session. This is what creates a
 * session at login.
 *
 * It MUST carry the API key. Appwrite only returns `session.secret` to a
 * caller holding a server key — a keyless client gets a valid session object
 * whose `secret` is the empty string. That failure is silent: the cookie gets
 * set to "", every later `.setSession("")` is unauthenticated, and the app
 * behaves as though login simply never works. Verified against this project's
 * own Appwrite 1.9.0: keyless -> secret length 0, with key -> length 396.
 */
export function adminClient() {
  return base().setKey(process.env.APPWRITE_API_KEY!)
}
