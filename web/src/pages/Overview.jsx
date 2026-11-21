import React, { useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'

export const chapters = [
  { id: 'trial', label: '信用试算', title: '一次逾期，会少多少额度？', description: '固定同一笔押金，改变还款记录，看五因子评分卡如何重算额度。' },
  { id: 'cards', label: '刷卡还款', title: '按时还款，下一单能省多少？', description: '一笔交易完成报价、授信、付款和记债；回执列出商户到账与手续费。' },
  { id: 'audit', label: '模型抽检', title: '谁能发现模型偷偷加分？', description: '注册表随机重算登记样本。超出容差，冻结该模型，订阅池拒绝放款。' },
  { id: 'ledger', label: '万户月结', title: '一笔交易能更新多少户？', description: '比较连续写入和分散写入的每户执行 gas，查看测试网月结记录。' },
]

/// A still picture of the card after one repaid order. The home page explains, it does not simulate.
function CardPreview() {
  return <figure className="sample">
    <div className="sample-face preview-face">
      <div className="engraving" aria-hidden="true">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 5}deg)` }} />)}</div>
      <div className="sample-head"><b>OpenScore</b><span>Agent 模拟副卡</span></div>
      <div className="sample-person">刺猬 · 代码审查助手</div>
      <div className="sample-score">806<small>分</small></div>
      <div className="sample-limit"><span>可用额度</span><b>80,600 <small>tUSD</small></b></div>
      <div className="preview-price"><span>同类服务报价</span><b>8,000 <small>tUSD</small></b><em>八折</em></div>
    </div>
    <figcaption>按时还清一单之后：分数、额度、报价一起变。</figcaption>
  </figure>
}

export function ShareTrial() {
  const url = new URL('./wallet.html', location.href)
  url.search = ''
  url.hash = ''
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    url.href = 'https://openscore.angelonelog.com/wallet.html'
  }
  const [image] = useState(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url.href)
    qr.make()
    return qr.createDataURL(4, 16)
  })
  return <section className="share"><div>
    <h2>手机上自己走一遍</h2>
    <p>扫码打开观众入口，抽个身份领一张卡。不用钱包，也不用充值。</p>
    <a href="./wallet.html">打开模拟副卡 →</a>
  </div><img src={image} width="156" height="156" alt="领取模拟副卡的二维码" /></section>
}

export default function Overview() {
  return <>
    <section className="opening intro-hero">
      <div className="opening-copy">
        <p className="hero-kicker">Monad Blitz @ 广州 · Tanka Line</p>
        <h1>给 AI Agent 的<br/><strong>链上信用副卡</strong></h1>
        <p>主人押一笔押金，Agent 刷卡买服务，商户当场收款。额度和报价由它自己的还款记录决定——算分的模型写在合约里，谁都能重算。</p>
        <div className="hero-actions">
          <a className="btn primary" href="./wallet.html">先领一张模拟卡 →</a>
          <a href="#trial">看链上演示</a>
        </div>
        <p className="hero-hint">观众入口不需要钱包和充值，一分钟走完领卡到还款。</p>
      </div>
      <CardPreview />
    </section>
    <section className="route guide">
      <h2>四段演示，从试算走到月结</h2>
      <p className="route-intro">每页只讲一件事，数字都来自 Monad 测试网。没有密钥也能看完；想动手就用上面那张模拟卡。</p>
      <div className="route-list">{chapters.map((c, i) =>
        <a href={'#' + c.id} key={c.id}><span className="route-no">0{i + 1}</span>
          <div><h3>{c.label}</h3><p>{c.description}</p></div><span aria-hidden="true">↗</span></a>)}
      </div>
    </section>
    <ShareTrial />
  </>
}
