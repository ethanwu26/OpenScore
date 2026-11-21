import React, { useMemo, useState } from 'react'
import FirstPurchase from './FirstPurchase.jsx'
import qrcode from 'qrcode-generator'

export const chapters = [
  { id: 'trial', label: '信用试算', title: '一次逾期，会少多少额度？', description: '固定同一笔押金，改变还款记录，看五因子评分卡如何重算额度。' },
  { id: 'cards', label: '刷卡还款', title: '按时还款，下一单能省多少？', description: '一笔交易完成报价、授信、付款和记债；回执列出商户到账与手续费。' },
  { id: 'audit', label: '模型抽检', title: '谁能发现模型偷偷加分？', description: '注册表随机重算登记样本。超出容差，冻结该模型，订阅池拒绝放款。' },
  { id: 'ledger', label: '万户月结', title: '一笔交易能更新多少户？', description: '比较连续写入和分散写入的每户执行 gas，查看测试网月结记录。' },
]

export function ShareTrial() {
  const [issue, setIssue] = useState(true)
  const url = new URL(issue ? './wallet.html' : './#trial', location.href)
  url.search = ''
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.href = new URL(url.pathname + url.hash, 'https://openscore.angelonelog.com').href
  }
  const href = url.href
  const image = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(href)
    qr.make()
    return qr.createDataURL(4, 16)
  }, [href])
  return <section className="share"><div>
    <h2>{issue ? '给你的 Agent 领张卡' : '给你的 Agent 测个分'}</h2>
    <div className="share-options" aria-label="二维码用途">
      <button className="btn ghost" aria-pressed={!issue} onClick={() => setIssue(false)}>扫码测分</button>
      <button className="btn ghost" aria-pressed={issue} onClick={() => setIssue(true)}>扫码登录领卡</button>
    </div>
    <p>{issue ? '扫码进入登录页，生成模拟档案、领取额度，再刷第一单。' : '手机扫码，选择还款记录，查看信用分和额度。'}</p>
    <a href={issue ? './wallet.html' : '#trial'}>{issue ? '打开模拟副卡' : '打开信用试算'} →</a>
  </div><img src={image} width="156" height="156" alt={issue ? '领取模拟副卡的二维码' : '手机打开信用试算的二维码'} /></section>
}

export default function Overview() {
  return <>
    <section className="opening">
      <div className="opening-copy">
        <h1>让 Agent 刷卡买服务，<br/><strong>按时还，下单更便宜。</strong></h1>
        <p>明码分是一张给 AI Agent 用的信用副卡。主人提供押金，Agent 按额度付费调用服务，商户当场收款。还款记录决定下次的额度和报价。</p>
        <div className="hero-actions"><a className="btn primary" href="./wallet.html">领取我的模拟卡 →</a><a href="#cards">查看测试网副卡</a></div>
      </div>
      <FirstPurchase />
    </section>
    <section className="route"><h2>到测试网核对这笔生意</h2>
      <div className="route-list">{chapters.map((c,i) => <a href={'#'+c.id} key={c.id}><span className="route-no">0{i+1}</span><div><h3>{c.label}</h3><p>{c.description}</p></div><span aria-hidden="true">↗</span></a>)}</div>
    </section>
    <section className="pilot"><div><h2>下一步，把卡接进按次收费的 API</h2>
      <p>设想一个代码审查 Agent：每次审查要购买推理调用。开发者为它发卡，API 服务商查询报价、收款后放行，月底按 Agent 对账。</p></div>
      <details><summary>从演示到试点，还差什么？</summary>
        <p>今天的商户由测试网合约模拟。首个试点需要接入一个真实推理接口，让服务商核验支付回执，并把每笔账单关联到一次成功交付。重点看重复扣费、失败退款和每次结算成本。</p>
        <p>同一流程也可试用于付费数据检索。团队多 Agent 采购还需要团队总预算、单卡上限和撤卡能力。</p>
      </details>
    </section>
    <ShareTrial />
  </>
}
