import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { actions, explain, fmt, fmtMon, short, localSigner, injectedSigner, keys, normalizeKey, sendMon, AGENT_GAS, currentRpc, setRpc, deployed, loadAudit, loadBench, balanceOf, COL } from './chain.js'
import { Receipt, Tx, describe } from './ui.jsx'
import useSession from './useSession.js'
import './styles.css'

function Admin() {
  const { board, refresh, err, operator, setOperator, agentKeys, reloadKeys, anySigner, busy, setBusy } = useSession()
  const [audit, setAudit] = useState(null)
  const [auditErr, setAuditErr] = useState('')
  const [balance, setBalance] = useState(null)
  const [bench, setBench] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [steps, setSteps] = useState([])
  const [name, setName] = useState('害羞的松鼠二号')
  const [showKeys, setShowKeys] = useState(true)
  const [pk, setPk] = useState('')
  const [demo, setDemo] = useState('')
  const [rpc, setRpcText] = useState(currentRpc)
  const [note, setNote] = useState('')


  async function checkAudit() {
    if (!deployed) return
    try { setAudit(await loadAudit()); setAuditErr('') }
    catch { setAuditErr('读取模型状态失败。') }
  }
  useEffect(() => {
    let stopped = false
    let timer
    async function check() {
      if (!document.hidden && deployed) {
        await Promise.all([
          checkAudit(),
          loadBench().then(b => { if (!stopped) setBench(b) }).catch(() => {}),
          operator && balanceOf(operator.address).then(b => { if (!stopped) setBalance(b) }).catch(() => {}),
        ])
      }
      if (!stopped) timer = setTimeout(check, 5000)
    }
    setBalance(null)
    check()
    return () => { stopped = true; clearTimeout(timer) }
  }, [operator])
  async function run(title, fn) {
    if (busy) return
    setBusy(true)
    try {
      const r = await fn()
      setReceipt({ title, hash: r.hash, lines: describe(r.events) })
    } catch (e) { setReceipt({ title, error: explain(e) }) }
    await Promise.all([refresh(), checkAudit()])
    setBusy(false)
  }
  async function issue() {
    if (busy || !operator || balance == null || balance < AGENT_GAS) return
    setBusy(true)
    setSteps([])
    const log = []
    try {
      const agent = await actions.issue(operator, name.trim() || '未命名', (s) => {
        const i = log.findIndex((x) => x.label === s.label)
        if (i >= 0) log[i] = s; else log.push(s)
        setSteps([...log])
      })
      reloadKeys()
      setReceipt({ title: `发卡 · ${name}`, lines: [`新 Agent 地址 ${agent.address}`, '密钥只存在本浏览器里，由 Agent 自己签名用卡'], change: '新卡 288 分起步，额度 28,800：没有任何还款记录时，合约只认押金。' })
    } catch (e) {
      reloadKeys()
      setReceipt({ title: `发卡 · ${name}`, error: explain(e) })
    }
    await refresh()
    setBusy(false)
  }

  async function connect() {
    try { setOperator(await injectedSigner()); setNote('') } catch (e) { setNote(explain(e)) }
  }
  function usePk() {
    try { const k = normalizeKey(pk); const signer = localSigner(k, '操作钱包'); keys.setOperatorKey(k); setOperator(signer); setPk(''); setNote('已保存在本浏览器') } catch { setNote('请输入有效的 64 位十六进制测试私钥。') }
  }
  function importDemo() {
    try { const n = keys.importDemo(demo); reloadKeys(); setDemo(''); setNote(`已导入 ${n} 把 Agent 密钥`) } catch (e) { setNote('导入失败。请检查 JSON 数组和每个 Agent 的测试密钥格式。') }
  }

  return <main className="app admin"><header className="top"><h1>演示准备</h1><a href="./settings.html">管理员配置</a><a href="./">进入演示 →</a></header>
      <p>先连接操作钱包并导入 Agent，再检查新卡和抽检模型。</p>
      {!deployed && <p className="banner">还没有部署。运行 node scripts/deploy.mjs 后重新构建。</p>}
      {err && <p className="banner">{err}</p>}
      <section className="panel"><h2>上台前检查</h2><dl className="preflight">
        <dt>副卡数据</dt><dd>{err || (board ? '已读到 '+board.list.length+' 张卡' : '等待链上数据')}</dd>
        <dt>操作钱包</dt><dd>{!operator ? '待连接' : balance == null ? '正在读取余额' : fmtMon(balance)+' MON'+(balance < AGENT_GAS ? ' · 余额不足以给新卡转入 0.5 MON' : balance < 10n**18n ? ' · 建议补至 1 MON 以支付手续费' : '')}</dd>
        <dt>现场用卡</dt><dd>{board?.list.find(v => v.quoteOk && v.score === 288 && !v.hasOpenLoan && v.gasBalance >= 6n*10n**16n && agentKeys.some(k => k.address.toLowerCase() === v.agent.toLowerCase()))?.name || '请准备一张有密钥和 gas 的新卡'}</dd>
        <dt>抽检模型</dt><dd>{auditErr || (!audit ? '正在读取' : audit.decoy.usable ? '可以现场抽检' : '请重新布置')}</dd>
        <dt>月结账本</dt><dd>{!bench ? '等待读取' : bench.dense.n && bench.scattered.n ? '两种布局均有实测数据' : '请用 bench.mjs 铺账本'}</dd>
      </dl></section>
      <Receipt item={receipt} />
      <section className="panel">
        <button className="linkish" onClick={() => setShowKeys(!showKeys)}>{showKeys ? '收起钥匙与设置' : '钥匙与设置'}</button>
        {showKeys ? (
          <div className="keys">
            <div>
              <h4>主人 / 操作钱包 {operator ? <span className="chip">{operator.name} {short(operator.address)}</span> : <span className="chip quiet">未连接</span>}</h4>
              <div className="row">
                <button className="btn" onClick={connect}>连接浏览器钱包</button>
                <input type="password" aria-label="操作钱包测试私钥" value={pk} onChange={(e) => setPk(e.target.value)} placeholder="或粘贴只放测试币的私钥" />
                <button className="btn" disabled={!pk.trim()} onClick={usePk}>使用</button>
                {operator ? <button className="btn ghost" onClick={() => { keys.setOperatorKey(''); setOperator(null) }}>断开</button> : null}
              </div>
            </div>
            <div>
              <h4>Agent 密钥（本浏览器持有 {agentKeys.length} 把）</h4>
              <input type="password" autoComplete="off" aria-label="Agent 密钥 JSON" value={demo} onChange={(e) => setDemo(e.target.value)} placeholder="粘贴 deployments/demo-keys.<链ID>.json 的全部内容，导入脚本铺好的三个 Agent" />
              <div className="row"><button className="btn" onClick={importDemo} disabled={!demo.trim()}>导入演示密钥</button></div>
            </div>
            <div>
              <h4>RPC 节点</h4>
              <div className="row">
                <input aria-label="RPC 节点" value={rpc} onChange={(e) => setRpcText(e.target.value)} />
                <button className="btn" onClick={() => setRpc(rpc.trim())}>切换</button>
                <button className="btn ghost" onClick={() => setRpc('')}>恢复默认</button>
              </div>
            </div>
            {note ? <p className="muted">{note}</p> : null}
            <p className="muted small">私钥只保存在这台电脑的浏览器本地存储里，不会上传。请只使用测试网钱包。</p>
          </div>
        ) : null}
      </section>
      <section className="panel">
        <h3>给一个新 Agent 发卡</h3>
        <p className="muted">主人付一次押金；Agent 的密钥在浏览器里生成，之后每一笔都由 Agent 自己签名。</p>
        <div className="row">
          <input aria-label="新卡名称" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent 的名字" maxLength={24} />
          <button className="btn primary" disabled={busy || !operator || !deployed || balance == null || balance <= AGENT_GAS} onClick={issue}>发卡</button>
          {!operator ? <span className="muted small">先在"钥匙"里连接主人的钱包</span> : <span className="muted small">主人 {short(operator.address)}</span>}
        </div>
        {steps.length ? (
          <ol className="steps">
            {steps.map((s) => <li key={s.label} className={s.state}>{s.label} {s.hash ? <Tx hash={s.hash} /> : s.state === 'run' ? '…' : ''}</li>)}
          </ol>
        ) : null}
      </section>


      <section className="panel"><h3>彩排用卡</h3>
        {board?.list.map(v => {
          const k = agentKeys.find(k => k.address.toLowerCase() === v.agent.toLowerCase())
          const signer = () => localSigner(k.privateKey, k.name)
          return <div className="admin-card" key={v.agent}><b>{v.name} · {v.score} 分</b>
            <p>{k ? '已持有密钥' : '未导入密钥'} · {fmtMon(v.gasBalance)} MON · 余额 {fmt(v.balance)} tUSD · {v.hasOpenLoan ? '待还 '+fmt(v.debt) : '无欠款'}</p>
            <div className="row"><button className="btn" disabled={busy || !operator} onClick={() => run('补 gas', () => sendMon(operator, v.agent, AGENT_GAS))}>补 0.5 MON</button>
            <button className="btn" disabled={busy || !k || v.poolAllowance >= COL+v.debt} onClick={() => run('授权资金池', () => actions.approvePool(signer()))}>授权资金池</button>
            <button className="btn" disabled={busy || !k || v.hasOpenLoan} onClick={() => run('创建到期账单', () => actions.swipe(signer(), 0))}>刷卡并立即到期</button></div>
          </div>
        })}
      </section>
      <section className="panel"><h3>抽检布置</h3><p>{auditErr || (!audit ? '正在读取模型状态…' : audit.decoy.usable ? '演示模型可抽检' : '演示模型需要重新布置')}</p>
      <button className="btn" disabled={!anySigner || busy || !audit || audit.decoy.usable} onClick={() => run('重新布置', () => actions.arm(anySigner))}>重新布置演示模型</button></section>
    </main>
}
createRoot(document.getElementById('root')).render(<Admin />)
