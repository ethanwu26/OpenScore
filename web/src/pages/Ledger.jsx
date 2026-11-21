import React, { useCallback, useEffect, useRef, useState } from 'react'
import { actions, loadBench, explain, num, pub, D, txUrl } from '../chain.js'
import { Receipt, describe } from '../ui.jsx'

const SIDE = 100 // 100 x 100 = 10,000 accounts
const CELL = 5

function Grid({ lit, flash, color }) {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const g = c.getContext('2d')
    let raf
    const t0 = performance.now()
    const draw = (t) => {
      const k = flash ? Math.min(1, (t - t0) / 900) : 1
      g.clearRect(0, 0, c.width, c.height)
      for (let i = 0; i < SIDE * SIDE; i++) {
        const x = (i % SIDE) * CELL
        const y = Math.floor(i / SIDE) * CELL
        const on = i < lit
        const reached = on && i / Math.max(1, lit) <= k
        g.fillStyle = reached ? color : on ? '#cfd6cf' : '#e9e7e1'
        g.fillRect(x, y, CELL - 1, CELL - 1)
      }
      if (k < 1) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [lit, flash, color])
  return <canvas aria-label={`本次月结更新 ${num(lit)} 户，每格一户`} role="img" ref={ref} width={SIDE * CELL} height={SIDE * CELL} className="gridc" />
}

export default function Ledger({ operator, busy, setBusy }) {
  const [price, setPrice] = useState(0n)
  const [b, setB] = useState(null)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState(null)
  const [flash, setFlash] = useState({ dense: 0, scattered: 0 })

  const load = useCallback(async () => { try { setB(await loadBench()); setError('') } catch { setError('账本读取失败，正在重试。') } }, [])
  useEffect(() => { load(); pub.getGasPrice().then(setPrice).catch(() => {}); const t = setInterval(() => { if (!document.hidden) load() }, 3000); return () => clearInterval(t) }, [load])

  async function settle(dense) {
    if (busy || !b) return
    const run = dense ? b.dense : b.scattered
    const title = dense ? `月结 · 页式布局 ${num(run.n)} 户` : `月结 · 普通布局 ${num(run.n)} 户`
    setBusy(true)
    setReceipt({ title: title + ' · 等待上链' })
    try {
      if (!(await actions.benchFunded(dense, run.n))) throw new Error('账本还没铺好，先运行 node scripts/bench.mjs')
      const r = await actions.settle(operator, dense, run.n)
      setReceipt({ title, hash: r.hash, gas: r.gas, ms: r.ms, lines: describe(r.events) })
      setFlash((f) => ({ ...f, [dense ? 'dense' : 'scattered']: f[dense ? 'dense' : 'scattered'] + 1 }))
    } catch (e) { setReceipt({ title, error: explain(e) }) }
    await load()
    setBusy(false)
  }

  if (!b) return <div className="empty"><p>{error || '正在读取账本…'}</p></div>
  const ready = b.dense.n > 0 && b.scattered.n > 0
  const perD = ready ? b.dense.gas / b.dense.n : 0
  const perS = ready ? b.scattered.gas / b.scattered.n : 0
  const ratio = ready ? perS / perD : 0
  const tenK = Math.round(perS * 10000)
  const cost = (gas) => (price ? `每点一次约 ${(Number(BigInt(Math.round(gas * 1.06 + 45000)) * price) / 1e18).toFixed(2)} MON` : '')

  return (
    <>
      {error && <p className="banner">{error}</p>}
      <Receipt item={receipt} />

      {!ready ? (
        <div className="empty"><p>账本对照还没跑过。在项目根目录运行 <code>node scripts/bench.mjs --size mini --yes</code>（或 mid / full），再回到这里。</p></div>
      ) : (
        <>
          <div className="ledger">
            <section className="panel">
              <h3>页式布局 · 连续写入</h3>
              <Grid key={`d${flash.dense}`} lit={b.dense.n} flash={flash.dense > 0} color="#0b7a53" />
              <div className="big">{num(b.dense.gas)}<small> gas</small></div>
              <p><b>{num(b.dense.n)}</b> 户 · 每户 <b>{perD >= 100 ? num(Math.round(perD)) : perD.toFixed(1)}</b> gas · 一笔交易</p>
              {operator ? <>
                <button className="btn primary" disabled={busy} onClick={() => settle(true)}>月结：一笔更新 {num(b.dense.n)} 户</button>
                <span className="muted small"> {cost(b.dense.gas)}</span>
              </> : null}
            </section>
            <section className="panel">
              <h3>普通布局 · 分散写入</h3>
              <Grid key={`s${flash.scattered}`} lit={b.scattered.n} flash={flash.scattered > 0} color="#c2372d" />
              <div className="big">{num(b.scattered.gas)}<small> gas</small></div>
              <p><b>{num(b.scattered.n)}</b> 户 · 每户 <b>{num(Math.round(perS))}</b> gas</p>
              {operator ? <>
                <button className="btn" disabled={busy} onClick={() => settle(false)}>月结：一笔更新 {num(b.scattered.n)} 户</button>
                <span className="muted small"> {cost(b.scattered.gas)}</span>
              </> : null}
            </section>
          </div>
          <section className="panel verdict-line">
            <div className="ratio">{ratio.toFixed(0)}<small> 倍</small></div>
            <div>
              <p>每户成本相差 <b>{ratio.toFixed(0)} 倍</b>。按普通布局更新一万户要约 <b>{num(tenK)}</b> gas，是单笔上限 3,000 万的 {(tenK / 30_000_000).toFixed(1)} 倍，仅按执行成本估算，至少需要 {Math.ceil(tenK / 30_000_000)} 笔。</p>
              <p className="muted small">两个数字都是合约在交易内部用 gasleft() 自己量的执行 gas，不含每笔 21,000 的基础费；Monad 的回执只显示 gas 上限，所以不读回执。两种写法都是更新已存在的余额。同一份合约在以太坊计价的本地链上实测，每户 1,266 对 5,068，只差 4 倍：多出来的差距来自 Monad 的按页计费。</p>
              {D.benchRun?.dense?.tx && D.benchRun?.scattered?.tx && txUrl(D.benchRun.dense.tx) && <div className="bench-links"><span>部署时的基准交易</span>
                <a href={txUrl(D.benchRun.dense.tx)} target="_blank" rel="noreferrer">页式 {num(D.benchRun.dense.n)} 户 ↗</a>
                <a href={txUrl(D.benchRun.scattered.tx)} target="_blank" rel="noreferrer">普通 {num(D.benchRun.scattered.n)} 户 ↗</a></div>}
            </div>
          </section>
        </>
      )}
    </>
  )
}
