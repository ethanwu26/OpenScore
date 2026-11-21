import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'

async function api(endpoint, data) {
  const response = await fetch('/api/audience/admin/' + endpoint, {
    method: data ? 'POST' : 'GET', cache:'no-store',
    headers:data ? {'Content-Type':'application/json'} : {},
    body:data ? JSON.stringify(data) : undefined,
  })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error),{status:response.status})
  return result
}

function Settings() {
  const [view,setView] = useState('loading')
  const [key,setKey] = useState('')
  const [config,setConfig] = useState(null)
  const [client,setClient] = useState('')
  const [secret,setSecret] = useState('')
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [error,setError] = useState('')
  function lock() {
    setConfig(null); setKey(''); setClient(''); setSecret(''); setView('login')
  }
  async function load() {
    const next = await api('config')
    setConfig(next); setClient(next.clientId); setView('settings')
  }
  async function run(fn) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await fn() }
    catch (e) {
      if (e.status === 401) lock()
      setError(e.status ? e.message : '连接失败，请稍后重试。')
    } finally { setBusy(false) }
  }
  useEffect(() => {
    load().catch(e => {
      lock()
      if (e.status !== 401) setError('无法连接配置服务，请刷新重试。')
    })
  },[])
  const secretRequired = !config?.hasSecret || client.trim() !== config.clientId
  return <div className="app guest settings"><header className="top">
    <a className="brand" href="./"><span className="brand-symbol" aria-hidden="true"/><b>明码分</b><span>OpenScore</span></a>
    {view === 'settings' && <button className="linkish" disabled={busy} onClick={()=>run(async()=>{await api('logout',{});lock()})}>退出管理</button>}
  </header><main><h1>管理员配置</h1>
    {error && <p className="banner" role="alert">{error}</p>}
    {view === 'loading' ? <p role="status">正在检查登录状态…</p> : view === 'login' ?
      <form className="panel" onSubmit={e=>{e.preventDefault();run(async()=>{await api('login',{key:key.trim()});setKey('');await load()})}}>
        <h2>使用管理密钥登录</h2><label>管理密钥<input autoComplete="current-password" type="password" required value={key} onChange={e=>setKey(e.target.value)}/></label>
        <button className="btn primary" disabled={busy || !key.trim()}>登录管理页</button>
      </form> :
      <form className="panel" onSubmit={e=>{e.preventDefault();run(async()=>{
        const next = await api('config',{clientId:client.trim(),secret:secret.trim()})
        setConfig(next);setClient(next.clientId);setSecret('');setMessage('已保存，观众登录页已应用新配置。')
      })}}>
        <h2>GitHub 登录</h2><p>{config.hasSecret ? '已配置应用凭据。可打开观众登录页验证授权。' : '将下方回调地址填入 GitHub OAuth App，再保存该应用的凭据。'}</p>
        <label>Authorization callback URL<input value={config.callback} readOnly onFocus={e=>e.target.select()}/></label>
        <label>Client ID<input required value={client} maxLength={128} onChange={e=>setClient(e.target.value)} spellCheck={false} autoComplete="off"/></label>
        <label>Client Secret<input required={secretRequired} type="password" value={secret} maxLength={256} autoComplete="new-password" onChange={e=>setSecret(e.target.value)} placeholder={secretRequired ? '填写该应用的 Client Secret' : '已保存，留空沿用'}/></label>
        <div className="row"><button className="btn primary" disabled={busy}>保存配置</button><a href="./wallet.html" target="_blank" rel="noreferrer">打开观众登录页 ↗</a></div>
        {message && <p role="status">{message}</p>}
      </form>}
  </main></div>
}
createRoot(document.getElementById('root')).render(<Settings/>)
