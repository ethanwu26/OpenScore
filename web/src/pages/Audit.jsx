import React, { useCallback, useEffect, useState } from 'react'
import { actions, loadAudit, explain, D, fmt, short, addrUrl } from '../chain.js'
import { Receipt, describe } from '../ui.jsx'

export default function Audit({ anySigner: fallback, operator, busy, setBusy }) {
  const anySigner = operator || fallback
  const [a, setA] = useState(null)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)

  const load = useCallback(async () => { try { setA(await loadAudit()); setError('') } catch { setError('注册表读取失败，正在重试。') } }, [])
  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load() }, 3000); return () => clearInterval(t) }, [load])

  async function run(title, fn) {
    if (busy) return
    setBusy(true)
    setReceipt({ title: title + ' · 等待上链' })
    try {
      const r = await fn(anySigner)
      setReceipt({ title, hash: r.hash, gas: r.gas, ms: r.ms, lines: describe(r.events) })
    } catch (e) { setReceipt({ title, error: explain(e) }) }
    await load()
    setBusy(false)
  }

  if (!a) return <div className="empty"><p>{error || '正在读取注册表…'}</p></div>
  const d = a.decoy
  const frozen = d.round > 0 && !d.usable

  return (
    <>
      {error && <p className="banner">{error}</p>}
      <Receipt item={receipt} />

      <div className="audit">
        <section className="panel model good">
          <span className="chip">诚实</span>
          <h3>五因子评分卡</h3>
          <p className="muted">编号 {D.scoreCardId} · {addrUrl(D.scoreCard) ? <a href={addrUrl(D.scoreCard)} target="_blank" rel="noreferrer">{short(D.scoreCard)}</a> : short(D.scoreCard)} · 资金池已订阅</p>
          <div className={'verdict '+(a.honest.failed ? 'no' : 'ok')}>{a.honest.failed ? '已冻结' : '可用'}</div>
          <p>已通过抽检 <b>{a.honest.passed}</b> 次，登记样本 {a.honest.n} 个</p>
          {anySigner ? <button className="btn primary" disabled={busy || a.honest.failed} onClick={() => run('抽检 · 评分卡', (s) => actions.audit(s, D.scoreCardId, a.honest.n))}>抽检评分卡</button> : null}
        </section>

        <section className={`panel model ${frozen ? 'bad' : 'mid'}`}>
          <span className="chip bad">被篡改</span>
          <h3>评分卡（押金每一档偷偷多给 10 分）</h3>
          <p className="muted">第 {d.round} 轮 · 编号 {d.id} · {short(D.scoreCardAlt)} · 用诚实模型的分数登记</p>
          <div className={`verdict ${frozen ? 'no' : 'warn'}`}>{d.round === 0 ? '尚未布置' : frozen ? '永久冻结' : '尚未被发现'}</div>
          <p>
            测试资金池当前状态：
            {d.lends ? <b> 允许放款（给全新地址打 {d.score} 分，额度 {fmt(d.limit)}）</b> : <b className="bad-text"> 拒绝一切放款</b>}
          </p>
          {anySigner ? <div className="row">
            <button className="btn danger" disabled={busy || frozen || d.round === 0} onClick={() => run('抽检 · 被篡改的评分卡', (s) => actions.audit(s, d.id, d.info?.n || 4))}>抽检被篡改的模型</button>
          </div> : null}
        </section>
      </div>

      <section className="panel">
        <h3>为什么这次抽检会拦住放款</h3>
        <p className="muted">每次抽到的样本都必须和登记分数一致。这个演示模型改了每档押金的分值，因此每个样本都会暴露偏差。神经网络（编号 {D.neuralId}）也在同一个注册表里，已通过 {a.neural.passed} 次抽检。注册表记录抽检结果，资金池在放款前检查模型状态。</p>
      </section>
    </>
  )
}
