import React, { useEffect, useState } from 'react'
import { deployed, D, chain, isLocal, addrUrl } from './chain.js'
import useSession from './useSession.js'
import Overview, { chapters, ShareTrial } from './pages/Overview.jsx'
import Cards from './pages/Cards.jsx'
import Trial from './pages/Trial.jsx'
import Audit from './pages/Audit.jsx'
import Ledger from './pages/Ledger.jsx'

const routes = [{ id: 'home', label: '产品介绍' }, ...chapters]
const current = () => routes.find(r => r.id === location.hash.slice(1))?.id || 'home'

export default function App() {
  const [tab, setTab] = useState(current)
  const presenting = new URLSearchParams(location.search).has('present')
  const viewUrl = new URL(location.href)
  if (presenting) viewUrl.searchParams.delete('present')
  else viewUrl.searchParams.set('present', '1')
  const session = useSession()
  const { board, err } = session
  const index = chapters.findIndex(c => c.id === tab)
  const next = chapters[index + 1]
  useEffect(() => {
    const update = () => { setTab(current()); window.scrollTo(0, 0) }
    window.addEventListener('hashchange', update)
    return () => window.removeEventListener('hashchange', update)
  }, [])
  return <div className={'app'+(presenting ? ' presenting' : '')}>
    <header className="top">
      <a className="brand" href="#home"><span className="brand-symbol" aria-hidden="true" /><b>明码分</b><span>OpenScore</span></a>
      <nav className="tabs" aria-label="演示章节">{routes.map(r => <a className={'tab'+(tab === r.id ? ' on' : '')} key={r.id} href={'#'+r.id} aria-current={tab === r.id ? 'page' : undefined}>{r.label}</a>)}</nav>
      <div className="net"><span className={'dot '+(err ? 'off' : board ? 'on' : 'pending')} />{isLocal ? '本地链' : chain.name}</div>
    </header>
    <main className="page">
      {tab === 'home' && <Overview />}
      {!deployed && <div className="empty"><h2>还没有部署</h2><p>部署合约并重新构建后，即可开始链上演示。</p></div>}
      {deployed && index >= 0 && <>
        <div className="chapter-line">演示 {index+1} / 4 <span>{chapters[index].label}</span></div>
        <section className="lead"><h1>{chapters[index].title}</h1><p>{[
          '先选「守信还款」，再选「逾期一次」。同样押入 100,000 USD，比较两次的信用分和额度。',
          '先看松鼠的新卡，再看刺猬和狐狸。演示者刷卡后，商户立即收款；还清账单后，再比较额度和同一项服务的价格。',
          '左侧是资金池使用的模型，右侧的演示模型给每档押金多算 10 分。抽检时合约随机取样重算，结果不符就永久冻结该模型。',
          '每期都要为每个 Agent 更新账本。这里用同一份合约比较两种写法：各写了多少户，每户花了多少 gas。'
        ][index]}</p></section>
        {err && tab === 'cards' && <p className="banner" role="status">{err}</p>}
        {tab === 'trial' && <Trial />}
        {tab === 'cards' && <Cards {...session} />}
        {tab === 'audit' && <Audit {...session} />}
        {tab === 'ledger' && <Ledger {...session} />}
        {next ? <div className="next"><span>下一步</span><a href={'#'+next.id}>{next.label} →</a></div> : <ShareTrial />}
      </>}
    </main>
    <footer className="foot"><b>明码分 OpenScore</b><a href={viewUrl.href}>{presenting ? '退出投屏' : '投屏模式'}</a><span>{board ? '区块 '+board.pool.blockNumber : 'Agent 信用支付'}</span>{addrUrl(D.pool) && <><a href={addrUrl(D.pool)} target="_blank" rel="noreferrer">资金池合约 ↗</a><a href={addrUrl(D.scoreCard)} target="_blank" rel="noreferrer">评分卡合约 ↗</a></>}</footer>
  </div>
}
