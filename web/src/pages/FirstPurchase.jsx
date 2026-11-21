import React, { useState } from 'react'

const receipts = [
  { state:'准备下单', score:288, limit:'28,800', price:'10,000', debt:'0',
    summary:'这张新卡有 28,800 额度，足够支付本次推理服务。', button:'模拟刷卡 · 10,000 tUSD' },
  { state:'商户已收款', score:288, limit:'28,800', price:'10,000', debt:'10,000',
    summary:'商户已收到 9,900 tUSD，另有 100 tUSD 手续费留在池内。', button:'模拟还清这笔账单' },
  { state:'账单已还清', score:806, limit:'80,600', price:'8,000', debt:'0',
    summary:'押金已退回。下一单同样的服务少付 2,000 tUSD。', button:'重新体验这笔订单' },
]

export default function FirstPurchase() {
  const [step,setStep] = useState(0)
  const receipt = receipts[step]
  return <section className="order-demo" aria-label="互动订单示例">
    <div className="order-cover">
      <div className="engraving" aria-hidden="true">{Array.from({length:20},(_,i)=><i key={i} style={{ transform:`rotate(${i*5}deg)` }}/>)}</div>
      <div className="sample-head"><b>OpenScore</b><span>模拟订单 · {step+1}/3</span></div>
      <div className="order-title"><span>害羞的松鼠</span><strong>购买一次推理服务</strong></div>
    </div>
    <div className="order-paper">
      <div aria-live="polite" aria-atomic="true">
        <div className="order-state"><b>{receipt.state}</b><span>{receipt.score} 信用分</span></div>
        <div className="order-price"><span>{step===2 ? '下一单报价' : '本单报价'}</span><strong>{receipt.price} <small>tUSD</small></strong></div>
        <dl className="ticket-lines"><dt>授信额度</dt><dd>{receipt.limit}</dd><dt>当前待还</dt><dd>{receipt.debt}</dd></dl>
        <p>{receipt.summary}</p>
      </div>
      <button className={'btn '+(step===2 ? 'ghost' : 'primary')} onClick={()=>setStep((step+1)%receipts.length)}>{receipt.button}</button>
    </div>
  </section>
}
