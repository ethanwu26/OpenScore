import React, { useEffect, useRef, useState } from 'react'
import { txUrl, short, fmt, num } from './chain.js'

export const PARTS = [
  // Real maxima of the fitted tables in ScoreCard.sol (349 + 301 + 150 + 100 + 100 = 1000).
  { label: '还款历史', cap: 349 },
  { label: '欠款与使用率', cap: 301 },
  { label: '历史长度', cap: 150 },
  { label: '新增敞口', cap: 100 },
  { label: '押金规模', cap: 100 },
]

export const tone = (score) => (score >= 650 ? 'good' : score >= 400 ? 'mid' : 'bad')

/// Counts from the previous value to the new one, so a score change is seen, not just replaced.
export function Rolling({ value, format = num, ms = 900 }) {
  const [shown, setShown] = useState(Number(value))
  const from = useRef(Number(value))
  useEffect(() => {
    const a = from.current
    const b = Number(value)
    if (a === b) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      from.current = b
      setShown(b)
      return
    }
    const t0 = performance.now()
    let raf
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      const e = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (b - a) * e))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = b
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = b }
  }, [value, ms])
  return <span className="rolling">{format(shown)}</span>
}

export function Bars({ parts }) {
  return (
    <div className="bars">
      {PARTS.map((p, i) => {
        const v = Number(parts?.[i] ?? 0)
        return (
          <div className="bar" key={p.label}>
            <span className="bar-label">{p.label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, (v / p.cap) * 100)}%` }} /></span>
            <span className="bar-num">{v}<i>/{p.cap}</i></span>
          </div>
        )
      })}
    </div>
  )
}

export function Tx({ hash, children }) {
  if (!hash) return null
  const url = txUrl(hash)
  const text = children || `${hash.slice(0, 10)}…${hash.slice(-6)}`
  return url ? <a className="tx" href={url} target="_blank" rel="noreferrer">{text}</a> : <span className="tx">{text}</span>
}

/// Turns decoded events into the sentences a viewer should read.
export function describe(events) {
  const out = []
  for (const { name, args: a } of events || []) {
    if (name === 'Purchased') out.push(`商户读到 ${a.score} 分，报价 ${fmt(a.price)} USD`)
    else if (name === 'Scored') out.push(`资金池在同一笔交易里算分：${a.score} 分，额度 ${fmt(a.limit)}`)
    else if (name === 'Swiped') out.push(`商户到账 ${fmt(a.price - a.interchange)}，另有 ${fmt(a.interchange)} 手续费留给出资人`)
    else if (name === 'Borrowed') out.push(`欠款 ${fmt(a.amount)} 记到 Agent 名下，锁定押金 ${fmt(a.collateral)}`)
    else if (name === 'Repaid') out.push(`还款 ${fmt(a.amount)}，剩余欠款 ${fmt(a.outstanding)}`)
    else if (name === 'CollateralReturned') out.push(`押金 ${fmt(a.collateral)} 退回 Agent`)
    else if (name === 'PeriodRecorded') out.push(`行为账本记下第 ${a.period} 期：应还 ${fmt(a.owed)}，实还 ${fmt(a.paid)}${a.delay ? '，逾期' : ''}`)
    else if (name === 'Liquidated') out.push(`押金 ${fmt(a.collateral)} 被没收，归资金池`)
    else if (name === 'DefaultNoted') out.push(`违约写入账本：累计 ${a.defaults} 次`)
    else if (name === 'AuditPassed') out.push(`抽检通过：随机抽 ${a.k} 个样本重算，最大偏差 ${a.maxDev}`)
    else if (name === 'AuditFailed') out.push(`抽检失败：${Number(a.index) + 1} 号样本登记的是 ${a.expected} 分，合约算出 ${a.actual} 分，差 ${a.dev} 分。模型永久冻结`)
    else if (name === 'Armed') out.push(`被篡改的模型重新登记，编号 ${a.id}`)
    else if (name === 'CardIssued') out.push(`发卡：${a.name}（${short(a.agent)}），押金 ${fmt(a.deposit)}`)
    else if (name === 'Settled') out.push(`${a.dense ? '页式' : '普通'}布局更新 ${num(a.n)} 户，合约自测执行 gas ${num(a.gasUsed)}`)
  }
  return out
}

export function Receipt({ item }) {
  const ref = useRef(null)
  useEffect(() => {
    if (item && ref.current && ref.current.getBoundingClientRect().bottom < 0) {
      ref.current.scrollIntoView({ block: 'start' })
    }
  }, [item])
  if (!item) return null
  return (
    <div ref={ref} role="status" className={`receipt ${item.error ? 'is-error' : ''}`}>
      <div className="receipt-head">
        <b>{item.title}</b>
        {item.ms ? <span className="muted">从点击到上链 {(item.ms / 1000).toFixed(item.ms < 100 ? 3 : 1)} 秒</span> : null}
      </div>
      {item.error ? <p className="receipt-error">{item.error}</p> : null}
      {item.change ? <p className="receipt-change">{item.change}</p> : null}
      {item.lines?.length ? <ul>{item.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
      {item.hash ? <p className="muted">交易 <Tx hash={item.hash} />{item.gas ? ` · gas 上限 ${num(item.gas)}` : ''}</p> : null}
    </div>
  )
}
