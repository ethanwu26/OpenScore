import { createHash, timingSafeEqual, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'

const digest = text => createHash('sha256').update(text).digest()
const sessionCookie = (token, seconds) =>
  `__Host-os-admin=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${seconds}`

export function adminSettings({db, origin, defaultId, defaultSecret, adminHash, encryptionKey}) {
  db.exec('CREATE TABLE IF NOT EXISTS oauth_config(id INTEGER PRIMARY KEY CHECK(id=1), client TEXT NOT NULL, ciphertext TEXT NOT NULL)')
  const key = Buffer.from(encryptionKey || '', 'base64')
  const expected = Buffer.from(adminHash || '', 'hex')
  const available = expected.length === 32 && key.length === 32
  const sessions = new Map()
  function encrypt(secret) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm',key,iv)
    const body = Buffer.concat([cipher.update(secret,'utf8'),cipher.final()])
    return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64')
  }
  function configuration() {
    const row = db.prepare('SELECT client,ciphertext FROM oauth_config WHERE id=1').get()
    if (!row) return {clientId:defaultId || '',secret:defaultSecret || ''}
    const blob = Buffer.from(row.ciphertext,'base64')
    const cipher = createDecipheriv('aes-256-gcm',key,blob.subarray(0,12))
    cipher.setAuthTag(blob.subarray(12,28))
    return {clientId:row.client,secret:Buffer.concat([cipher.update(blob.subarray(28)),cipher.final()]).toString('utf8')}
  }
  let config = configuration()
  let failures = 0
  let windowEnd = 0
  async function handle({req,res,json,path,readCookie,readBody}) {
    if (!available) return json(503,{error:'管理员入口尚未配置。'})
    if (req.method === 'POST' && req.headers.origin !== origin) return json(403,{error:'请从本站设置页提交。'})
    const now = Date.now()
    const session = digest(readCookie(req,'admin')).toString('hex')
    for (const [entry,expires] of sessions) if (expires <= now) sessions.delete(entry)
    if (path === '/api/audience/admin/login' && req.method === 'POST') {
      if (now >= windowEnd) { failures = 0; windowEnd = now + 60000 }
      if (failures >= 12) return json(429,{error:'尝试过于频繁，请稍后再试。'})
      const data = await readBody(req)
      if (typeof data.key !== 'string' || !timingSafeEqual(digest(data.key),expected)) {
        failures++
        return json(401,{error:'管理密钥不正确。'})
      }
      const token = randomBytes(32).toString('base64url')
      sessions.delete(session)
      sessions.set(digest(token).toString('hex'), now+4*3600000)
      res.setHeader('Set-Cookie',sessionCookie(token,4*3600))
      failures = 0
      return json(200,{ok:true})
    }
    if (!sessions.has(session)) return json(401,{error:'请使用管理密钥登录。'})
    if (path === '/api/audience/admin/logout' && req.method === 'POST') {
      sessions.delete(session)
      res.setHeader('Set-Cookie',sessionCookie('',0))
      return json(200,{ok:true})
    }
    if (path !== '/api/audience/admin/config') return json(404,{error:'入口不存在。'})
    if (req.method === 'POST') {
      const data = await readBody(req)
      if (typeof data.clientId !== 'string' || !/^[a-zA-Z0-9_-]{5,128}$/.test(data.clientId))
        return json(400,{error:'请填写有效的 GitHub Client ID。'})
      if (typeof data.secret !== 'string' || data.secret.length > 256 || /\s/.test(data.secret))
        return json(400,{error:'请检查 Client Secret 格式。'})
      const secret = data.secret || (data.clientId === config.clientId ? config.secret : '')
      if (!secret) return json(400,{error:'首次配置或更换 Client ID 时，需要同时填写对应的 Client Secret。'})
      const encrypted = encrypt(secret)
      db.prepare('INSERT OR REPLACE INTO oauth_config VALUES(1,?,?)').run(data.clientId,encrypted)
      config = {clientId:data.clientId,secret}
    } else if (req.method !== 'GET') {
      return json(405,{error:'不支持的操作。'})
    }
    return json(200,{clientId:config.clientId,hasSecret:Boolean(config.secret),callback:origin+'/api/audience/callback'})
  }
  return {get:()=>config,handle}
}
