/**
 * dsh-api-balance — Host half.
 *
 * Serves the browser chip over one loopback HTTP route:
 *
 *   GET /dsh-api-balance/snapshot?sessionId=<id>[&force=1]
 *     -> { ok, updatedAt, balance, usage }
 *
 * `balance` is the DeepSeek account balance (`/user/balance`), `usage` is this
 * session's folded provider usage plus current context pressure.
 *
 * The API key is resolved from the credentials service on every query and is
 * never returned, logged, or written to disk. Nothing here runs a shell: the
 * request goes out over node:http(s) directly.
 *
 * @module dsh-api-balance
 */

const ROUTE_PATH = '/dsh-api-balance'
/** One balance reply per TTL, so several open windows cannot multiply API calls. */
const BALANCE_TTL_MS = 15000
const REQUEST_TIMEOUT_MS = 20000
const DEFAULT_API_KEY_REF = 'DEEPSEEK_API_KEY'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'
const SETTINGS_NS = 'llm-deepseek'

export const name = 'dsh-api-balance'
export const inject = ['webServer']

let balanceCache = null

function asNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asText(value) {
  return typeof value === 'string' ? value : ''
}

function errorText(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message !== '') return error.message
  return String(error)
}

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/u, '')
}

/** The apiKeyEnv and baseURL the mounted DeepSeek route uses, else shipped defaults. */
function endpointInfo(ctx) {
  let ref = DEFAULT_API_KEY_REF
  let base = DEFAULT_BASE_URL
  const settings = ctx.get('settings')
  if (settings !== undefined && settings !== null) {
    try {
      const section = settings.get(SETTINGS_NS)
      if (section !== null && typeof section === 'object') {
        if (typeof section.apiKeyEnv === 'string' && section.apiKeyEnv !== '') ref = section.apiKeyEnv
        if (typeof section.baseURL === 'string' && section.baseURL !== '') base = section.baseURL
      }
    } catch (error) {
      // No llm-deepseek section configured: the shipped defaults already apply.
    }
  }
  return { ref, base: trimTrailingSlashes(base) }
}

async function resolveApiKey(ctx, ref) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined || credentials === null) return undefined
  try {
    // A plain string is a valid CredentialRef at runtime; branding is types-only.
    const resolved = await credentials.resolve(ref)
    if (resolved !== null && resolved !== undefined && typeof resolved.value === 'string' && resolved.value !== '') return resolved.value
  } catch (error) {
    // Reported by the caller as a missing credential.
  }
  return undefined
}

/** One GET with no third-party dependency, so it works on any Node/Electron build. */
async function httpGet(url, headers) {
  const target = new URL(url)
  const transport = target.protocol === 'http:' ? await import('node:http') : await import('node:https')
  return await new Promise((resolve, reject) => {
    const request = transport.request(target, { method: 'GET', headers, timeout: REQUEST_TIMEOUT_MS }, (response) => {
      const chunks = []
      response.on('data', (chunk) => { chunks.push(chunk) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    request.on('timeout', () => { request.destroy(new Error('请求超时')) })
    request.on('error', (error) => { reject(error) })
    request.end()
  })
}

async function fetchBalance(ctx, info) {
  const key = await resolveApiKey(ctx, info.ref)
  if (key === undefined) return { ok: false, error: '未找到凭据 ' + info.ref + '，无法查询余额' }

  let response
  try {
    response = await httpGet(info.base + '/user/balance', {
      authorization: 'Bearer ' + key,
      accept: 'application/json',
    })
  } catch (error) {
    return { ok: false, error: errorText(error) }
  }
  if (response.status !== 200) return { ok: false, error: '余额接口返回 HTTP ' + String(response.status) }

  let parsed
  try {
    parsed = JSON.parse(response.body)
  } catch (error) {
    return { ok: false, error: '余额响应不是合法 JSON' }
  }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, error: '余额响应格式异常' }

  const infos = Array.isArray(parsed.balance_infos) ? parsed.balance_infos : []
  const first = infos.length > 0 && infos[0] !== null && typeof infos[0] === 'object' ? infos[0] : {}
  return {
    ok: true,
    at: Date.now(),
    available: parsed.is_available === true,
    currency: asText(first.currency),
    total: asText(first.total_balance),
    granted: asText(first.granted_balance),
    toppedUp: asText(first.topped_up_balance),
    host: info.base,
    ref: info.ref,
  }
}

async function readBalance(ctx, force) {
  const now = Date.now()
  if (force !== true && balanceCache !== null && now - balanceCache.at < BALANCE_TTL_MS) return balanceCache.value
  const value = await fetchBalance(ctx, endpointInfo(ctx))
  balanceCache = { at: Date.now(), value }
  return value
}

function findSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return undefined
  const sessions = ctx.get('sessions')
  if (sessions === undefined || sessions === null) return undefined
  try {
    const session = sessions.get(sessionId)
    return session === null || session === undefined ? undefined : session
  } catch (error) {
    return undefined
  }
}

/** Fold this session's logged provider usage plus current context pressure. */
function readUsage(ctx, session) {
  const totals = { calls: 0, input: 0, output: 0, cacheRead: 0, reasoning: 0, lastInput: 0, lastOutput: 0, turn: 0 }
  let events = []
  try {
    events = session.snapshotEvents()
  } catch (error) {
    events = []
  }
  if (Array.isArray(events)) {
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index]
      if (event === null || typeof event !== 'object' || event.type !== 'assistant/message') continue
      const data = event.data
      if (data === null || data === undefined || typeof data !== 'object') continue
      if (typeof data.turn === 'number') totals.turn = data.turn
      const usage = data.usage
      if (usage === null || usage === undefined || typeof usage !== 'object') continue
      totals.calls += 1
      totals.input += asNumber(usage.inputTokens)
      totals.output += asNumber(usage.outputTokens)
      totals.cacheRead += asNumber(usage.cacheReadTokens)
      totals.reasoning += asNumber(usage.reasoningTokens)
      totals.lastInput = asNumber(usage.inputTokens)
      totals.lastOutput = asNumber(usage.outputTokens)
    }
  }

  let provider = ''
  let model = ''
  let contextWindow = 0
  try {
    const route = session.requestContext()
    if (route !== null && route !== undefined && typeof route === 'object') {
      provider = asText(route.provider)
      model = asText(route.model)
      contextWindow = asNumber(route.contextWindow)
    }
  } catch (error) {
    provider = ''
    model = ''
    contextWindow = 0
  }

  let contextTokens = 0
  const meter = ctx.get('tokenMeter')
  if (meter !== undefined && meter !== null) {
    try {
      const measurement = meter.measure(session)
      if (measurement !== null && measurement !== undefined && typeof measurement === 'object') contextTokens = asNumber(measurement.totalTokens)
    } catch (error) {
      contextTokens = 0
    }
  }

  return {
    turn: totals.turn,
    calls: totals.calls,
    input: totals.input,
    output: totals.output,
    cacheRead: totals.cacheRead,
    reasoning: totals.reasoning,
    total: totals.input + totals.output,
    lastInput: totals.lastInput,
    lastOutput: totals.lastOutput,
    provider,
    model,
    contextWindow,
    contextTokens,
  }
}

/** Everything the chip renders, as lossless JSON. */
export async function collectSnapshot(ctx, sessionId, force) {
  const session = findSession(ctx, sessionId)
  let usage = null
  if (session !== undefined) {
    try {
      usage = readUsage(ctx, session)
    } catch (error) {
      usage = null
    }
  }
  let balance
  try {
    balance = await readBalance(ctx, force === true)
  } catch (error) {
    balance = { ok: false, error: errorText(error) }
  }
  return { ok: true, updatedAt: Date.now(), balance, usage }
}

function respond(res, status, payload) {
  let body
  try {
    body = JSON.stringify(payload)
  } catch (error) {
    body = JSON.stringify({ ok: false, error: errorText(error) })
    status = 500
  }
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(body)
}

async function handleRequest(ctx, req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const action = url.pathname.slice(ROUTE_PATH.length).replace(/^\/+/u, '')
    if (action !== 'snapshot') {
      respond(res, 404, { ok: false, error: 'unknown action: ' + action })
      return
    }
    const sessionId = url.searchParams.get('sessionId') ?? ''
    const force = url.searchParams.get('force') === '1'
    respond(res, 200, await collectSnapshot(ctx, sessionId, force))
  } catch (error) {
    respond(res, 500, { ok: false, error: errorText(error) })
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PATH,
    handler: (req, res) => { void handleRequest(ctx, req, res) },
  }), 'dsh-api-balance: snapshot route')
}
