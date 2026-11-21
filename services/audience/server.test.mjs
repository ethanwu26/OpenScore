import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { audienceServer } from './server.mjs'
import { generateProfile } from '../../web/src/creditProfile.mjs'

test('verified GitHub identities own separate cards across sessions',async t => {
  const origin = 'https://openscore.test'
  let identity = 12
  const server = audienceServer({origin,dbPath:':memory:',clientId:'test',secret:'fixture',
    request: async (url, options) => {
      if (url.endsWith('/access_token')) {
        assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge)
        return Response.json({access_token:'fixture'})
      }
      assert.equal(url,'https://api.github.com/user')
      return Response.json({id:identity, login:'user-'+identity})
    }})
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  t.after(()=>new Promise(r=>server.close(r)))
  const base = 'http://127.0.0.1:'+server.address().port+'/api/audience/'
  let challenge
  const get = (path,cookie='') => fetch(base+path,{redirect:'manual',headers:{cookie}})
  async function login(){
    const start = await get('login')
    const url = new URL(start.headers.get('location'))
    challenge = url.searchParams.get('code_challenge')
    const flow = start.headers.getSetCookie()[0].split(';')[0]
    const path = 'callback?code=test&state='+url.searchParams.get('state')
    assert.match((await get(path)).headers.get('location'),/retry/)
    const end = await get(path,flow)
    assert.equal(end.headers.get('location'),'/wallet.html')
    assert.match((await get(path,flow)).headers.get('location'),/retry/)
    return end.headers.getSetCookie()[0].split(';')[0]
  }
  const first = await login()
  const account = String(identity)
  const send = (data,cookie=first,site=origin) => fetch(base+'card',{method:'POST',headers:{origin:site,cookie,'Content-Type':'application/json'},body:JSON.stringify({account,...data})})
  const issue = {revision:0,action:'issue',profile:generateProfile('low'),name:'卡主'}
  assert.equal((await send(issue,first,'https://elsewhere.test')).status,403)
  const card = (await (await send(issue)).json()).card
  assert.equal(card.profile.tier,'low')
  const second = await login()
  assert.equal((await (await get('session',second)).json()).card.id,card.id)
  const swipe = {action:'swipe',revision:1}
  const results = await Promise.all([send(swipe),send(swipe,second)])
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409])
  assert.equal((await send({...issue,action:'rebind',revision:2})).status,400)
  assert.equal((await send({action:'repay',revision:2})).status,200)
  assert.equal((await send({...issue,action:'rebind',revision:3,profile:generateProfile('high')})).status,200)
  identity++
  const other = await login()
  assert.equal((await (await get('session',other)).json()).card,null)
  assert.equal((await send(swipe,other)).status,409)
  await fetch(base+'logout',{method:'POST',headers:{origin,cookie:first}})
  assert.equal((await send(swipe)).status,401)
})

test('admin settings are private, take effect immediately and survive restart',async t => {
  const {mkdtemp,rm,readFile} = await import('node:fs/promises')
  const {tmpdir} = await import('node:os')
  const {join} = await import('node:path')
  const {randomBytes} = await import('node:crypto')
  const dir = await mkdtemp(join(tmpdir(),'openscore-config-test-'))
  const origin = 'https://openscore.test'
  const adminKey = randomBytes(32).toString('hex')
  const secret = randomBytes(20).toString('hex')
  const options = {origin,dbPath:join(dir,'accounts.sqlite'),adminHash:createHash('sha256').update(adminKey).digest('hex'),encryptionKey:randomBytes(32).toString('base64')}
  let server
  async function start() {
    server = audienceServer(options)
    await new Promise(r=>server.listen(0,'127.0.0.1',r))
  }
  const close = () => new Promise(r=>server.close(r))
  await start()
  t.after(async()=>{await close();await rm(dir,{recursive:true,force:true})})
  const request = (path,body,session='',site=origin) => fetch('http://127.0.0.1:'+server.address().port+'/api/audience/'+path,{
    method:body ? 'POST' : 'GET',redirect:'manual',headers:{origin:site,cookie:session,'Content-Type':'application/json'},body:body ? JSON.stringify(body) : undefined,
  })
  const form = {clientId:'siteAppId',secret}
  assert.equal((await request('admin/config')).status,401)
  assert.equal((await request('admin/config',form)).status,401)
  assert.equal((await request('admin/login',{key:'wrong'})).status,401)
  const login = await request('admin/login',{key:adminKey})
  const session = login.headers.getSetCookie()[0].split(';')[0]
  assert.equal((await request('admin/config',form,session,'https://elsewhere.test')).status,403)
  const saved = await (await request('admin/config',form,session)).json()
  assert.deepEqual(saved,{clientId:form.clientId,hasSecret:true,callback:origin+'/api/audience/callback'})
  assert.equal((await request('admin/config',{...form,secret:''},session)).status,200)
  assert.equal((await request('admin/config',{clientId:'otherId',secret:''},session)).status,400)
  assert.equal((await (await request('session')).json()).enabled,true)
  assert.equal(new URL((await request('login')).headers.get('location')).searchParams.get('client_id'),form.clientId)
  await request('admin/logout',{},session)
  assert.equal((await request('admin/config',undefined,session)).status,401)
  await close()
  assert.equal((await readFile(options.dbPath)).includes(Buffer.from(secret)),false)
  await start()
  assert.equal((await (await request('session')).json()).enabled,true)
})
