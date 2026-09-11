import { requireCaller, isResponse, json, bad } from '../_util'
import { TOOL_MANIFEST, callTool } from './tools'

/**
 * MCP over streamable HTTP, so any MCP client can drive this tracker as
 * tools instead of shelling out to curl:
 *
 *   claude mcp add --transport http tasktracker \
 *     https://<host>/api/mcp --header "x-api-key: <key>"
 *
 * Hand-rolled rather than wired to @modelcontextprotocol/sdk. A tools-only
 * server answers exactly the four methods below; the SDK's
 * StreamableHTTPServerTransport wants Node's IncomingMessage/ServerResponse,
 * which the App Router doesn't hand out, so adopting it would mean a
 * dependency plus an adapter to bridge Request/Response — more moving parts
 * than the protocol it would be implementing.
 *
 * Stateless: no session is created and no Mcp-Session-Id is returned, which
 * the spec permits and which is what lets this run on however many instances
 * the deployment happens to have. Authorization is the same `x-api-key` (or
 * browser session cookie) every other route takes, resolved by the same
 * resolveCaller — MCP gets no door of its own.
 */

// Versions this server can speak. The client's request is echoed back when we
// know it (the spec's negotiation), otherwise it gets our newest.
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST = SUPPORTED[0]

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: unknown }

const result = (id: Rpc['id'], value: unknown) =>
  json({ jsonrpc: '2.0', id, result: value })

const error = (id: Rpc['id'], code: number, message: string) =>
  json({ jsonrpc: '2.0', id, error: { code, message } })

export async function POST(req: Request) {
  const caller = await requireCaller(req)
  if (isResponse(caller)) return caller

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return bad('body must be JSON-RPC')

  // A batch is a JSON array. Nothing this server implements needs one, and
  // 2025-06-18 removed batching from the spec, so it is refused rather than
  // half-supported.
  if (Array.isArray(body)) return error(null, -32600, 'batch requests are not supported')

  const { id = null, method, params } = body as Rpc

  switch (method) {
    case 'initialize': {
      const asked = (params as { protocolVersion?: string } | undefined)?.protocolVersion
      return result(id, {
        protocolVersion: asked && SUPPORTED.includes(asked) ? asked : LATEST,
        capabilities: { tools: {} },
        serverInfo: { name: 'tasktracker', title: 'Task Tracker', version: '1.0.0' },
        instructions:
          'A kanban board shared with a human. Call get_board first — it is an index of open work, and its "keep in mind" section carries caveats learned on other tasks; read the one task you are about to work on with get_task. As you work, move it and record what you tried in the same call: update_task(id, status, result, log). The human reads that log stream in the UI, dead ends included.',
      })
    }

    // Notifications carry no id and take no response body.
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return new Response(null, { status: 202 })

    case 'ping':
      return result(id, {})

    case 'tools/list':
      return result(id, { tools: TOOL_MANIFEST })

    case 'tools/call': {
      const p = (params ?? {}) as { name?: unknown; arguments?: unknown }
      return result(id, await callTool(p.name, p.arguments))
    }

    default:
      return error(id, -32601, `method not found: ${String(method)}`)
  }
}

/**
 * The spec lets a server that offers no server-to-client stream refuse the
 * SSE channel outright; clients fall back to plain request/response POSTs.
 * Answering it explicitly beats letting Next return its own 405 with no
 * indication of why.
 */
export async function GET() {
  return bad('this MCP server is stateless: POST JSON-RPC here, no SSE stream is offered', 405)
}
