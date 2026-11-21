import React, { useState } from 'react'
import {
  actions, explain, fmt, fmtMon, short, addrUrl, loadAgent, localSigner, COL,
  sleep, isLocal,
} from '../chain.js'
import { Rolling, Bars, Receipt, describe, tone } from '../ui.jsx'

const LOW_GAS = 6n * 10n ** 16n

function Stat({ label, value, hint }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value"><Rolling value={value} /></div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </div>
  )
}

function AgentCard({ v, mine, busy, now, onAct, canLiquidate }) {
  const overdue = v.hasOpenLoan && Number(v.due) < now
  const cooling = v.defaults > 0 && now < Number(v.lastDefault) + 7 * 86400
  const discounted = v.priceOk && v.price < 10_000n * 10n ** 18n
  const lowGas = mine && v.gasBalance < LOW_GAS
  return (
    <article className={`agent ${tone(v.score)} ${mine ? 'mine' : ''}`}>
      <div className="face">
        <div className="face-top">
          <span className="face-name">{v.name || '未命名'}</span>
          <span className="face-kind">{v.defaults > 0 ? '有违约记录' : v.periods > 0 ? '已有还款记录' : '新开副卡'}</span>
        </div>
        <div className="face-score">
          {v.quoteOk ? <Rolling value={v.score} /> : '—'}
          <small>分</small>
        </div>
        <div className="face-no">
          {addrUrl(v.agent)
            ? <a href={addrUrl(v.agent)} target="_blank" rel="noreferrer">{v.agent.slice(0, 6)} •••• •••• {v.agent.slice(-4)}</a>
            : <>{v.agent.slice(0, 6)} •••• •••• {v.agent.slice(-4)}</>}
          <span>主人 {short(v.owner)}</span>
        </div>
      </div>

      <div className="money">
        <div><span>额度 · USD</span><b><Rolling value={Number(v.limit / 10n ** 18n)} /></b></div>
        <div>
          <span>服务价 · USD</span>
          <b>{v.priceOk ? <Rolling value={Number(v.price / 10n ** 18n)} /> : '拒绝服务'}{discounted ? <em>八折</em> : null}</b>
        </div>
      </div>

      <details className="breakdown"><summary>查看五项评分依据</summary><Bars parts={v.parts} />
      <p className="second">第二意见（神经网络）{v.neuralScore} 分 · 已记录 {v.periods} 期 · 违约 {v.defaults} 次</p></details>

      <div className="state">
        {v.hasOpenLoan
          ? <span className={overdue ? 'chip bad' : 'chip'}>{overdue ? '已逾期' : '待还'} {fmt(v.debt)} · 锁定押金 {fmt(v.locked)}</span>
          : <span className="chip quiet">无欠款</span>}
        {cooling ? <span className="chip bad">冷却期：额度砍半，暂停用卡</span> : null}
        {v.defaults > 0 && !cooling && <span className="chip bad">违约后额度减半</span>}
        {lowGas ? <span className="chip bad">gas 只剩 {fmtMon(v.gasBalance)} MON</span> : null}
      </div>

      <div className="acts">
        {mine && !v.hasOpenLoan && (
          <>
            <button className="btn primary" disabled={busy || cooling} onClick={() => onAct('swipe', v)}>刷卡买服务</button>
          </>
        )}
        {mine && v.hasOpenLoan && !overdue && <button className="btn primary" disabled={busy} onClick={() => onAct('repay', v)}>还款 {fmt(v.debt)}</button>}
        {canLiquidate && v.hasOpenLoan && overdue && <button className="btn danger" disabled={busy} onClick={() => onAct('liquidate', v)}>到期未还 → 清算</button>}
        {mine && v.hasOpenLoan && overdue && <button className="btn ghost" disabled={busy} onClick={() => onAct('repay', v)}>逾期还款</button>}
      </div>
    </article>
  )
}

export default function Cards({ board, refresh, agentKeys, anySigner, busy, setBusy }) {
  const [receipt, setReceipt] = useState(null)
  if (!board) return <div className="empty"><p>正在读取链上数据…</p></div>
  const { list, pool } = board
  const now = Number(pool.blockTime)
  const keyOf = (a) => agentKeys.find((k) => k.address.toLowerCase() === a.toLowerCase())
  async function act(kind, v) {
    if (busy) return
    setBusy(true)
    setReceipt({ title: '正在提交交易 · '+v.name })
    const k = keyOf(v.agent)
    const titles = { swipe: '刷卡买服务', repay: '还款', liquidate: '清算' }
    try {
      let r
      if (kind === 'swipe' || kind === 'repay') {
        const agent = localSigner(k.privateKey, k.name)
        if (v.poolAllowance < (kind === 'repay' ? v.debt : COL)) {
          setReceipt({ title: '正在授权资金池使用 USD' })
          const approval = await actions.approvePool(agent)
          setReceipt({ title: '授权成功，正在提交'+titles[kind], hash: approval.hash })
          if (!isLocal) await sleep(1500)
        }
        if (kind === 'repay') r = await actions.repay(agent, v.openLoanId, v.debt)
        else r = await actions.swipe(agent, 1)
      } else if (kind === 'liquidate') {
        if (!anySigner) throw new Error('需要一个有 MON 的钱包来付这笔 gas：请到后台准备')
        r = await actions.liquidate(anySigner, v.openLoanId)
      }
      const after = await loadAgent(v.agent).catch(() => null)
      const swiped = r.events.find((e) => e.name === 'Swiped')
      let change = ''
      if (swiped) change = `商户当场到账 ${fmt(swiped.args.price - swiped.args.interchange)} USD；${v.name} 欠 ${fmt(swiped.args.price)}，1 天内还`
      else if (after) change = `${v.name}：${v.score} 分 → ${after.score} 分，额度 ${fmt(v.limit)} → ${fmt(after.limit)}，服务价 ${fmt(v.price)} → ${fmt(after.price)}`
      setReceipt({ title: `${titles[kind]} · ${v.name}`, hash: r.hash, gas: r.gas, ms: r.ms, lines: describe(r.events), change })
    } catch (e) {
      setReceipt({ title: `${titles[kind]} · ${v.name}`, error: explain(e) })
    }
    await refresh()
    setBusy(false)
  }

  return (
    <>
      <Receipt item={receipt} />

      <section className="grid">
        {list.map((v) => (
          <AgentCard key={v.agent} v={v} mine={Boolean(keyOf(v.agent))} busy={busy} now={now} onAct={act} canLiquidate={Boolean(anySigner)} />
        ))}
        {!list.length ? <div className="empty"><p>这座资金池还没有发出副卡。</p></div> : null}
      </section>

      <section className="stats">
        <Stat label="已发卡" value={Number(pool.agentCount)} hint="张" />
        <Stat label="资金池可用" value={Number(pool.liquidity / 10n ** 18n)} hint="USD" />
        <Stat label="在贷欠款" value={Number(pool.outstanding / 10n ** 18n)} hint="USD" />
        <Stat label="商户已收" value={Number(pool.merchantBalance / 10n ** 18n)} hint={`${pool.purchases} 笔`} />
        <Stat label="池内累计手续费" value={Number(pool.earned / 10n ** 18n)} hint="每笔刷卡 1% 手续费" />
      </section>

    </>
  )
}
