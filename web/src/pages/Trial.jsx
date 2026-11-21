import React, { useEffect, useRef, useState } from 'react'
import { trial, num } from '../chain.js'
import { Rolling, Bars, tone } from '../ui.jsx'

// Same order and units as BehaviorBook.features()
const FIELDS = [
  { label: '地址年龄', unit: '天', min: 0, max: 730, step: 5 },
  { label: '押金', unit: '百 tUSD', min: 0, max: 10000, step: 100 },
  { label: '最长拖欠', unit: '期', min: 0, max: 8, step: 1 },
  { label: '逾期次数', unit: '次', min: 0, max: 6, step: 1 },
  { label: '累计还款比例', unit: '‰', min: 0, max: 1000, step: 10 },
  { label: '当前使用率', unit: '‰', min: 0, max: 2000, step: 10 },
  { label: '零还款次数', unit: '次', min: 0, max: 6, step: 1 },
  { label: '最近一期还款比例', unit: '‰', min: 0, max: 1000, step: 10 },
  { label: '敞口变化', unit: '‰', min: -500, max: 500, step: 10 },
  { label: '最高使用率', unit: '‰', min: 0, max: 2000, step: 10 },
]
const PRESETS = [
  { label: '全新 Agent', f: [0, 1000, 0, 0, 0, 0, 0, 0, 0, 0] },
  { label: '守信还款', f: [0, 1000, 0, 0, 1000, 500, 0, 1000, 0, 500] },
  { label: '守信满一年', f: [365, 1000, 0, 0, 1000, 500, 0, 1000, 0, 500] },
  { label: '逾期一次', f: [0, 1000, 1, 1, 1000, 500, 0, 1000, 0, 500] },
  { label: '一期没还', f: [0, 1000, 1, 1, 500, 1000, 1, 0, 300, 1000] },
]

export default function Trial() {
  const [f, setF] = useState(PRESETS[0].f)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [ms, setMs] = useState(0)
  const seq = useRef(0)
  const previous = useRef(null)

  useEffect(() => {
    const id = ++seq.current
    const t = setTimeout(async () => {
      try {
        const t0 = performance.now()
        const [score, parts, neural] = await trial(f)
        if (id !== seq.current) return
        const last = previous.current
        previous.current = { score: Number(score), limit: Math.floor(f[1] * 100 * Number(score) / 1000) }
        setRes({ last, inputs: f, score: Number(score), parts: parts.map(Number), neural: Number(neural) })
        setMs(Math.round(performance.now() - t0))
        setErr('')
      } catch (e) { if (id === seq.current) setErr('暂时无法读取评分，请重试。') }
    }, 300)
    return () => { clearTimeout(t); seq.current++ }
  }, [f, attempt])

  const set = (i, v) => setF(f.map((x, j) => (j === i ? Number(v) : x)))
  const deposit = f[1] * 100
  const fresh = res?.inputs === f
  const limit = fresh ? Math.floor((deposit * res.score) / 1000) : 0

  return (
    <>
      <div className="trial">
        <section className="panel">
          <div className="trial-heading"><h2>选择还款记录</h2><a href="./wallet.html">领取我的模拟副卡 →</a></div><div className="presets">
            {PRESETS.map((p) => <button key={p.label} className="btn ghost" aria-pressed={f === p.f} onClick={() => {setErr(''); setF(p.f)}}>{p.label}</button>)}
          </div>
          <details className="inputs"><summary>自定义 10 项行为数据</summary>{FIELDS.map((d, i) => (
            <label className="slider" key={d.label}>
              <span>{d.label}</span>
              <input type="range" min={d.min} max={d.max} step={d.step} value={f[i]} onChange={(e) => set(i, e.target.value)} />
              <b>{num(f[i])}<i> {d.unit}</i></b>
            </label>
          ))}</details>
        </section>
        <section className={`panel result ${res ? tone(res.score) : ''}`}>
          <h2>{PRESETS.find(p => p.f === f)?.label || '自定义记录'}的试算结果</h2><div className="result-score">{fresh ? <Rolling value={res.score} ms={400} /> : '—'}<small>分</small></div>
          <p className="result-limit">押金 {num(deposit)} → 额度 <b>{fresh ? <Rolling value={limit} ms={400} /> : '—'}</b> tUSD</p>
          {fresh && <>
            {res.last && res.last.limit !== limit && <p className="comparison" role="status">
              比上次试算{limit > res.last.limit ? '多' : '少'} {num(Math.abs(limit-res.last.limit))} tUSD 额度
              <span className="muted small">（{res.last.score} → {res.score} 分）</span>
            </p>}
            <Bars parts={res.parts} />
          </>}
          <p className="second">第二意见（神经网络，385 个参数，同样在合约里）：{fresh ? res.neural : '—'} 分</p>
          <p className="muted small">{err && <button className="btn" onClick={() => {setErr(''); setAttempt(n => n+1)}}>重试</button>} {err || (fresh ? `合约只读试算 · 往返 ${ms} 毫秒` : '正在从合约读取分数…')}</p>
          <p className="muted small">五项的满分取自公开的信用评分类别权重 35/30/15/10/10；其中"押金规模"替换了链上没有对应物的"信用组合"。这是结构上的参照，不是任何机构的认证。</p>
        </section>
      </div>
    </>
  )
}
