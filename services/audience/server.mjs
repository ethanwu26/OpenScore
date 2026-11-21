import { adminSettings } from './admin.mjs'
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { changeCard } from '../../web/src/creditProfile.mjs'

const digest = value => createHash('sha256').update(value).digest('base64url')
const nonce = () => randomBytes(32).toString('base64url')
const cookie = (name, value, seconds) => `__Host-os-${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`
function readCookie(req, name) {
  const prefix = '__Host-os-' + name + '='
  return (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(prefix))?.slice(prefix.length) || ''
}

async function readBody(req) {
  const chunks = []
  let length = 0
  for await (const chunk of req) {
    length += chunk.length
    if (length > 4096) throw Object.assign(new Error('提交的数据过长。'),{status:413})
    chunks.push(chunk)
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error()
    return data
  } catch { throw Object.assign(new Error('请重新提交。'),{status:400}) }
}

export function audienceServer({ dbPath, origin, clientId: defaultId, secret: defaultSecret, adminHash, encryptionKey, request = fetch }) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, login TEXT NOT NULL, card TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pending(state TEXT PRIMARY KEY, browser TEXT NOT NULL, verifier TEXT NOT NULL, expires INTEGER NOT NULL);
  `)
  const callback = origin + '/api/audience/callback'
  const settings = adminSettings({db,origin,defaultId,defaultSecret,adminHash,encryptionKey})
  function collect() {
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now())
    db.prepare('DELETE FROM pending WHERE expires <= ?').run(Date.now())
  }
  const timer = setInterval(collect, 600000).unref()
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const json = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    const redirect = location => { res.writeHead(303, { Location: location }); res.end() }
    try {
      const url = new URL(req.url, origin)
      const path = url.pathname
      if (path.startsWith('/api/audience/admin/')) return await settings.handle({req,res,json,path,readCookie,readBody})
      const {clientId,secret} = settings.get()
      const enabled = Boolean(clientId && secret)
      const token = digest(readCookie(req, 'session'))
      const user = db.prepare('SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account WHERE s.token=? AND s.expires>?').get(token, Date.now())
      if (req.method === 'GET' && path === '/api/audience/session') {
        return json(200, { enabled, user: user ? { id:user.id, login:user.login } : null, card: user?.card ? JSON.parse(user.card) : null })
      }
      if (req.method === 'GET' && path === '/api/audience/login') {
        if (!enabled) return redirect('/wallet.html?auth=unavailable')
        const state = nonce(), browser = nonce(), verifier = nonce()
        db.prepare('INSERT INTO pending VALUES(?,?,?,?)').run(state, digest(browser), verifier, Date.now() + 600000)
        res.setHeader('Set-Cookie', cookie('flow', browser, 600))
        const params = new URLSearchParams({client_id:clientId, redirect_uri:callback, scope:'', state, code_challenge:digest(verifier), code_challenge_method:'S256'})
        return redirect('https://github.com/login/oauth/authorize?' + params)
      }
      if (req.method === 'GET' && path === '/api/audience/callback') {
        const flow = db.prepare('DELETE FROM pending WHERE state=? AND browser=? AND expires>? RETURNING verifier')
          .get(url.searchParams.get('state'), digest(readCookie(req, 'flow')), Date.now())
        res.setHeader('Set-Cookie', cookie('flow', '', 0))
        if (!enabled || !flow || !url.searchParams.get('code')) return redirect('/wallet.html?auth=retry')
        try {
          const exchange = await request('https://github.com/login/oauth/access_token', { method:'POST', headers:{Accept:'application/json'},
            body:new URLSearchParams({client_id:clientId, client_secret:secret, code:url.searchParams.get('code'), redirect_uri:callback, code_verifier:flow.verifier}), signal:AbortSignal.timeout(10000) })
          const auth = await exchange.json()
          if (!exchange.ok || !auth.access_token) throw new Error('exchange')
          const response = await request('https://api.github.com/user', {headers:{Authorization:'Bearer '+auth.access_token, Accept:'application/vnd.github+json', 'User-Agent':'OpenScore'}, signal:AbortSignal.timeout(10000)})
          const identity = await response.json()
          if (!response.ok || !Number.isSafeInteger(identity.id) || !identity.login) throw new Error('identity')
          const id = String(identity.id)
          db.prepare('INSERT INTO accounts(id,login) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET login=excluded.login').run(id,identity.login)
          const sid = nonce(), days = 7 * 86400
          db.prepare('DELETE FROM sessions WHERE token=?').run(token)
          db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(sid), id, Date.now()+days*1000)
          res.setHeader('Set-Cookie', [cookie('session',sid,days),cookie('flow','',0)])
          return redirect('/wallet.html')
        } catch { return redirect('/wallet.html?auth=retry') }
      }
      if (req.method !== 'POST') return json(404,{error:'入口不存在。'})
      if (req.headers.origin !== origin) return json(403,{error:'请从明码分页面重试。'})
      if (!user) return json(401,{error:'登录已过期，请重新登录。'})
      if (path === '/api/audience/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(token)
        res.setHeader('Set-Cookie', cookie('session','',0))
        return json(200,{ok:true})
      }
      if (path !== '/api/audience/card') return json(404,{error:'入口不存在。'})
      const data = await readBody(req)
      if (!data || data.account !== user.id) return json(409,{error:'登录账户已切换，请刷新。'})
      const current = db.prepare('SELECT card FROM accounts WHERE id=?').get(user.id).card
      const card = current ? JSON.parse(current) : null
      if (data.revision !== (card?.revision || 0)) return json(409,{error:'卡片已更新，请核对当前状态。'})
      let next
      try { next = changeCard(card,data.action,{name:data.name,profile:data.profile}) } catch (e) { return json(400,{error:e.message}) }
      db.prepare('UPDATE accounts SET card=? WHERE id=?').run(JSON.stringify(next),user.id)
      return json(200,{card:next})
    } catch (e) {
      if (e.status && !res.headersSent) return json(e.status,{error:e.message})
      if (!res.headersSent) json(500,{error:'暂时无法保存，请稍后重试。'})
      else res.end()
    }
  })
  server.on('close', () => { clearInterval(timer); db.close() })
  return server
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  audienceServer({dbPath:process.env.AUDIENCE_DB || '/var/lib/openscore-audience/accounts.sqlite',
    origin:process.env.AUDIENCE_ORIGIN || 'https://openscore.angelonelog.com',
    adminHash:process.env.ADMIN_KEY_HASH, encryptionKey:process.env.ADMIN_ENCRYPTION_KEY,
    clientId:process.env.GITHUB_CLIENT_ID, secret:process.env.GITHUB_CLIENT_SECRET})
    .listen(Number(process.env.AUDIENCE_PORT || 18743),'127.0.0.1')
}
