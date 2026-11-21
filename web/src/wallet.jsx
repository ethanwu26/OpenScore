import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import qrcode from 'qrcode-generator'
import { readLegacyCard } from './simulation.js'
import AudienceLogin, { AccountPortrait, Brand, Portrait } from './AudienceLogin.jsx'
import { changeCard, baseScore, deposit, generateProfile, limitOf, priceOf, scoreOf, tierNames } from './creditProfile.mjs'
import './styles.css'

const money = n => n.toLocaleString('en-US')
const tierOrder = ['high','medium','low']

// One task each; the identity page picks the person, this page picks who does the work.
const AGENTS = [
  { name: '构建助手', logo: 'avatars/agent-build.svg', brief: '帮我审一下这次的提交，找出可能的空指针和边界问题。',
    task: '为一次代码审查购买推理服务',
    result: '审完了：3 处空指针风险，其中 2 处给了改法，1 处需要你确认业务语义。' },
  { name: '文献助手', logo: 'avatars/agent-paper.svg', brief: '把这三篇论文压成一页要点，标明各自的实验条件。',
    task: '为论文摘要购买推理服务',
    result: '整理好了：三篇的方法差异在采样策略，实验条件已按数据集分开标注。' },
  { name: '校对助手', logo: 'avatars/agent-proof.svg', brief: '校对这版稿件，标出错别字和语气前后不一致的地方。',
    task: '为稿件校对购买推理服务',
    result: '校对完了：7 处错别字、3 处语气不一致，修改建议附在文末。' },
  { name: '原型助手', logo: 'avatars/agent-proto.svg', brief: '评审这版原型，按影响大小列出可用性问题。',
    task: '为原型评审购买推理服务',
    result: '评完了：2 个阻断级问题（找不到撤销入口、空状态没有下一步），5 条建议。' },
]
const agentOf = name => AGENTS.find(a => a.name === name) || AGENTS[0]

async function api(path, data) {
  const res = await fetch('/api/audience/' + path, {
    cache:'no-store', method:data ? 'POST' : 'GET',
    headers:data ? {'Content-Type':'application/json'} : {}, body:data ? JSON.stringify(data) : undefined,
    signal:AbortSignal.timeout(14000),
  })
  const result = await res.json()
  if (!res.ok) throw new Error(result.error || '请求失败，请重试。')
  return result
}

function makeBatch(tier, count = 3) {
  const out = []
  const seen = new Set()
  for (let guard = 0; out.length < count && guard < 80; guard++) {
    const drawn = generateProfile(tier || tierOrder[Math.floor(Math.random() * tierOrder.length)])
    const key = drawn.alias + drawn.role + drawn.agent
    if (seen.has(key)) continue
    seen.add(key)
    out.push(drawn)
  }
  return out
}

/// Counts a number up so a score change is watched, not just replaced.
function Ticker({ value, ms = 800 }) {
  const target = Number(value)
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  useEffect(() => {
    const a = from.current
    if (a === target) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { from.current = target; setShown(target); return }
    const t0 = performance.now()
    let raf
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms)
      const eased = 1 - Math.pow(1 - k, 3)
      setShown(Math.round(a + (target - a) * eased))
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = target
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); from.current = target }
  }, [target, ms])
  return <span className="ticker">{money(shown)}</span>
}

function useSequence(started, total, step = 700) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!started) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setN(total); return }
    let i = 0
    setN(0)
    const timer = setInterval(() => {
      i += 1
      setN(i)
      if (i >= total) clearInterval(timer)
    }, step)
    return () => clearInterval(timer)
  }, [started, total, step])
  return n
}

function Scene({ act, title, intro, children }) {
  const heading = useRef(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [])
  return <section className="scene" aria-labelledby="scene-heading">
    <p className="scene-act">{act}</p>
    <h1 className="scene-title" id="scene-heading" ref={heading} tabIndex={-1}>{title}</h1>
    {intro && <p className="scene-intro">{intro}</p>}
    {children}
  </section>
}

function CardFace({ profile, name, score, limit, id }) {
  return <section className="sample-face card-face">
    <div className="sample-head"><b>OpenScore</b><span>Agent 模拟副卡</span></div>
    <div className="card-face-person">
      <Portrait profile={profile} size={58}/>
      <div><b>{name}</b><small>{profile.alias} · {profile.role} · {tierNames[profile.tier]}信用</small></div>
    </div>
    <div className="sample-score"><Ticker value={score} /><small>分</small></div>
    <div className="sample-limit"><span>可用额度</span><b>{money(limit)} <small>USD</small></b></div>
    {id ? <div className="guest-id">{id}</div> : <div className="guest-id">按还款记录升降额度</div>}
  </section>
}

function ProfileFacts({ profile, showHolder = true }) {
  return <dl className="profile-facts">
    {showHolder && <><dt>模拟持有人</dt><dd>{profile.alias} · {profile.role}</dd></>}
    <dt>模拟信用历史</dt><dd>{profile.months} 个月</dd>
    <dt>按时还款</dt><dd>{profile.paid} 期</dd>
    <dt>逾期记录</dt><dd>{profile.late} 次</dd>
  </dl>
}

function IdentityScene({ batch, tier, onTier, onDraw, onPick, legacy, legacyKind, onLoadLegacy, busy }) {
  return <Scene act="第一幕 · 认领身份" title="先认领一个人，这张卡记在他名下"
    intro="身份只决定一件事：这叠模拟还款记录和这张脸。选完再挑替这个人干活的 Agent。">
    {legacy && <p className="scene-note">{legacyKind === 'account' ? '这个账号上次用过的卡还在。' : '检测到一张旧版副卡。'}
      <button className="linkish" onClick={onLoadLegacy} disabled={busy}>{legacyKind === 'account' ? '载入这张卡继续' : '载入副本继续体验'}</button></p>}
    <div className="tier-row" role="group" aria-label="模拟记录档位">
      {tierOrder.map(key =>
        <button key={key} className="chip-btn" aria-pressed={key === tier} onClick={() => onTier(key)}>{tierNames[key]}信用</button>)}
      <button className="chip-btn ghost" onClick={onDraw} disabled={busy}>换一批 ↻</button>
    </div>
    <p className="tier-hint">档位只影响随机生成的模拟记录：高信用按时还款更多、逾期更少。</p>
    <div className="identity-grid">
      {batch.map(drawn => <article className="identity" key={drawn.alias + drawn.role + drawn.agent + drawn.months}>
        <div className="identity-avatar"><Portrait profile={drawn} size={92}/></div>
        <h2>{drawn.alias}<small>{drawn.role}</small></h2>
        <dl className="identity-facts">
          <div><dt>信用历史</dt><dd>{drawn.months} 个月</dd></div>
          <div><dt>按时还款</dt><dd>{drawn.paid} 期</dd></div>
          <div><dt>逾期</dt><dd className={drawn.late ? 'warn' : ''}>{drawn.late} 次</dd></div>
        </dl>
        <p className="identity-score">{baseScore(drawn)} 分 <small>预估额度 {money(baseScore(drawn) * deposit / 1000)} USD</small></p>
        <button className="btn primary" onClick={() => onPick(drawn)} disabled={busy}>认领这个身份</button>
      </article>)}
    </div>
  </Scene>
}

function AgentScene({ profile, agent, onPick, onBack }) {
  return <Scene act="第二幕 · 选择 Agent" title={`${profile.alias} 要派谁去花钱？`}
    intro="同一个人，不同的 Agent 干不同的活。选一个，接下来会去看它拿到的卡和额度。">
    <div className="agent-grid">
      {AGENTS.map(option => <button key={option.name} className="agent-option" aria-pressed={agent.name === option.name}
        onClick={() => onPick(option)}>
        <span className="agent-option-name">{option.name}</span>
        <span className="agent-option-task">{option.task}</span>
        <span className="agent-option-line">“{option.brief}”</span>
        <span className="agent-option-go" aria-hidden="true">选择它 →</span>
      </button>)}
    </div>
    <button className="linkish scene-back" onClick={onBack}>返回换一个身份</button>
  </Scene>
}

function GrantScene({ profile, agent, name, setName, rebinding, busy, onIssue, onBack }) {
  const score = baseScore(profile)
  const limit = score * deposit / 1000
  return <Scene act="第三幕 · 签发副卡" title="这张卡，能替它花多少？"
    intro="额度不是主人随手设的上限，而是押金乘以分数。签发之后，它带着这份记录去刷卡。">
    <div className="grant-stage">
      <CardFace profile={profile} name={name.trim() || agent.name} score={score} limit={limit}/>
      <div className="grant-copy">
        <p className="grant-agent">{agent.name} · {agent.task}</p>
        <dl className="ticket-lines">
          <dt>模拟押金</dt><dd>{money(deposit)} USD</dd>
          <dt>信用分</dt><dd>{score} 分</dd>
          <dt>额度 = 押金 × 分数 ÷ 1,000</dt><dd>{money(limit)} USD</dd>
          <dt>绑定时锁定</dt><dd>0 USD</dd>
        </dl>
        <label className="agent-input">Agent 昵称
          <input value={name} onChange={e => setName(e.target.value)} maxLength={24} required />
        </label>
        <button className="btn primary scene-cta" disabled={!name.trim() || busy} onClick={onIssue}>
          {rebinding ? '确认换绑并重新授信' : '签发这张卡'}
        </button>
        <button className="linkish" onClick={onBack} disabled={busy}>换一个 Agent</button>
        <details className="scene-details"><summary>押金和额度是怎么算的？</summary>
          <p><b>为什么要有押金：</b>链上没有身份也没有追偿，押金是这笔账唯一的担保。额度最多等于押金，逾期不还时押金被清算给资金池，出资人才不至于裸奔；按时还清则原路退回。</p>
          <p>观众体验由系统配发模拟押金，无需充值。真实测试网上，主人先把测试 USD 抵押给发卡合约，Agent 再签名预授权，允许资金池按合约规则支取；按时还清就全额退回，逾期未还才会被清算。</p>
          <p>起点 300 分，每月信用历史加 6 分，每期按时还款加 12 分，每次逾期扣 30 分，最低 250 分。</p>
        </details>
      </div>
    </div>
  </Scene>
}

/// The Agent's session view: a threaded transcript, so the order is read top to bottom.
function ToolMark() {
  return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M14.5 7H18a3.5 3.5 0 0 1 0 7h-3.5"/><path d="M9.5 17H6a3.5 3.5 0 0 1 0-7h3.5"/><path d="M9 12h6"/>
  </svg>
}

function TurnMark({ item, profile, agent }) {
  if (item.kind === 'tool') return <span className="turn-mark tool"><ToolMark/></span>
  if (item.kind === 'user') return <span className="turn-mark person"><Portrait profile={profile} size={32}/></span>
  return <span className="turn-mark bot"><img src={agent.logo} width="32" height="32" alt="" loading="lazy" decoding="async"/></span>
}

function Transcript({ items, started, profile, agent, step = 850 }) {
  const n = useSequence(started, items.length, step)
  const shown = started ? n : 1
  const done = started && n >= items.length
  return <div className="session">
    <div className="session-head">
      <span className="session-bot"><img src={agent.logo} width="20" height="20" alt=""/></span>
      <b>{agent.name}</b><span className="session-state">{started ? (done ? '已完成' : '运行中') : '等待开始'}</span>
      <i className={started && !done ? 'live' : ''} aria-hidden="true"/>
    </div>
    <ol className="transcript" aria-live="polite">
      {items.slice(0, shown).map((item, i) => <li className={`turn ${item.kind}`} key={i}>
        <TurnMark item={item} profile={profile} agent={agent}/>
        <div className="turn-body">
          <p className="turn-who">{item.who}{item.kind === 'tool' && <span className="turn-tag">链上调用</span>}</p>
          <p className="turn-text">{item.text}</p>
        </div>
      </li>)}
      {started && !done && <li className="turn agent" aria-label={`${agent.name} 正在处理`}>
        <span className="turn-mark bot"><img src={agent.logo} width="32" height="32" alt=""/></span>
        <div className="turn-body"><p className="turn-who">{agent.name}</p>
          <span className="typing"><i/><i/><i/></span></div>
      </li>}
    </ol>
  </div>
}

function RunScene({ card, agent, onSwipe, onNext }) {
  // Freeze the numbers at scene entry: the swipe below is applied immediately, and the
  // transcript must keep describing the moment the trade was quoted.
  const snapshot = useRef(card).current
  const [started, setStarted] = useState(false)
  const score = scoreOf(snapshot)
  const price = priceOf(snapshot)
  const fee = price / 100
  const items = [
    { kind: 'user', who: '主人', text: agent.brief },
    { kind: 'agent', who: agent.name, text: '这需要读完整个上下文。我先用副卡买一次推理调用。' },
    { kind: 'tool', who: 'CreditShop.checkout', text: `商户按 ${score} 分报价${price < 10000 ? '，已过八折线' : '，还没到八折线'}。` },
    { kind: 'tool', who: 'CreditPool.swipe', text: '额度够用，资金池放行并先行垫付。' },
    { kind: 'tool', who: 'CreditPool', text: '商户当场收到款，手续费留给出资人。' },
    { kind: 'agent', who: agent.name, text: agent.result },
  ]
  const n = useSequence(started, items.length)
  const done = started && n >= items.length
  useEffect(() => { if (started) onSwipe() }, [started])
  return <Scene act="第四幕 · Agent 刷卡" title={`${agent.name} 开工了`}
    intro="这就是它工作时的样子：一边对话，一边为这次推理调用付钱。每一行工具调用都是链上真实发生的动作。">
    <div className="session-stage">
      <Transcript items={items} started={started} profile={card.profile} agent={agent}/>
      <div className="order-card">
        <p className="order-eyebrow">本次调用</p>
        <h2>{agent.task}</h2>
        <div className="order-price"><strong>{money(price)}</strong><small> USD</small>{price < 10000 && <em>八折</em>}</div>
        <dl className="ticket-lines">
          <dt>商户将收</dt><dd>{money(price - fee)} USD</dd>
          <dt>资金池手续费 · 1%</dt><dd>{money(fee)} USD</dd>
          <dt>当前待还</dt><dd>{money(card.debt)} USD</dd>
          <dt>模拟押金{card.debt ? '已锁定' : '可用'}</dt><dd>{money(deposit)} USD</dd>
        </dl>
        {!started && <button className="btn primary scene-cta" onClick={() => setStarted(true)}>让 Agent 开始运行</button>}
        {started && !done && <p className="run-live" role="status"><i aria-hidden="true"/>交易进行中…</p>}
        {done && <button className="btn primary scene-cta" onClick={onNext}>下一步：按时还清 →</button>}
      </div>
    </div>
    {done && <div className="scene-next">
      <p><b>商户已经收到钱。</b>这笔 {money(price)} USD 的账单挂在 {agent.name} 名下，押金 {money(deposit)} USD 被锁定。</p>
    </div>}
  </Scene>
}

function RepayScene({ card, agent, onRepay, onNext }) {
  const before = useRef(card).current
  const after = useRef(card.debt ? changeCard(card, 'repay') : card).current
  const [started, setStarted] = useState(false)
  const items = [
    { kind: 'agent', who: agent.name, text: '任务完成了，这一单的账记在我名下。' },
    { kind: 'user', who: '主人', text: '按时还清。' },
    { kind: 'tool', who: 'CreditPool.repay', text: '还清欠款，押金解除锁定。' },
    { kind: 'tool', who: 'BehaviorBook.record', text: '这一期记为按时还款。' },
    { kind: 'tool', who: 'ScoreCard', text: '分数和额度重新算过一遍。' },
    { kind: 'agent', who: agent.name, text: priceOf(after) < priceOf(before) ? '还清了。下次同样的服务打八折。' : '还清了。记录又攒了一期。' },
  ]
  const n = useSequence(started, items.length)
  const done = started && n >= items.length
  useEffect(() => { if (started) onRepay() }, [started])
  return <Scene act="第五幕 · 按时还清" title="账单还掉，分数自己会涨"
    intro="还款不由任何人打分：这一期记录写进行为账本，评分卡立刻重算，下一单的价格随之改变。">
    <div className="session-stage">
      <Transcript items={items} started={started} profile={card.profile} agent={agent}/>
      <div className="order-card statement">
        <p className="order-eyebrow">本期账单</p>
        <h2>{agent.name} · 待还</h2>
        <div className="order-price"><strong>{money(before.debt)}</strong><small> USD</small></div>
        <dl className="ticket-lines">
          <dt>锁定押金</dt><dd>{money(deposit)} USD</dd>
          <dt>还款后信用分</dt><dd>{scoreOf(after)} 分</dd>
          <dt>还款后额度</dt><dd>{money(limitOf(after))} USD</dd>
          <dt>下次报价</dt><dd>{money(priceOf(after))} USD</dd>
        </dl>
        {!started && <button className="btn primary scene-cta" onClick={() => setStarted(true)}>按时还清 {money(before.debt)} USD</button>}
        {started && !done && <p className="run-live" role="status"><i aria-hidden="true"/>写入行为账本…</p>}
        {done && <button className="btn primary scene-cta" onClick={onNext}>看看这一单的结果 →</button>}
      </div>
    </div>
    {done && <div className="scene-next">
      <p><b>账单清了，押金回来了。</b>{priceOf(after) < priceOf(before) ? '这次还款跨过了 600 分门槛，同一项服务从下一单起打八折。' : '记录继续累积，下一单会更便宜。'}</p>
    </div>}
  </Scene>
}

function ShareCard() {
  const url = new URL('./wallet.html', location.href)
  if (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) url.href = 'https://openscore.angelonelog.com/wallet.html'
  const [image] = useState(() => {
    const qr = qrcode(0, 'M')
    qr.addData(url.href)
    qr.make()
    return qr.createDataURL(4, 16)
  })
  return <section className="share-card">
    <div>
      <h2>让旁边的人也领一张</h2>
      <p>扫码打开同一个入口，对方会抽到自己的身份和一张新卡。</p>
      <a href={url.href}>打开体验入口 →</a>
    </div>
    <img src={image} width="124" height="124" alt="领取模拟副卡的二维码"/>
  </section>
}

function DoneScene({ card, agent, onAgain, onRebind }) {
  const previous = card.repayments > 0 && !card.debt ? { ...card, repayments: card.repayments - 1 } : null
  const saved = previous ? priceOf(previous) - priceOf(card) : 0
  return <Scene act="收尾 · 这一单留下了什么" title={saved > 0 ? `同一项服务，现在便宜 ${money(saved)} USD` : '这一单已经记进账本'}
    intro="分数、额度、报价都是同一份还款记录算出来的结果。再来一单，价格会按新的额度重新报。">
    <div className="done-stage">
      <CardFace profile={card.profile} name={card.name} score={scoreOf(card)} limit={limitOf(card) - card.debt} id={card.id}/>
      <div className="done-copy">
        <p className="grant-agent">{agent.name} · {agent.task}</p>
        {previous ? <dl className="ticket-lines">
          <dt>信用分</dt><dd>{scoreOf(previous)} → {scoreOf(card)}</dd>
          <dt>授信额度</dt><dd>{money(limitOf(previous))} → {money(limitOf(card))} USD</dd>
          <dt>服务报价</dt><dd>{money(priceOf(previous))} → {money(priceOf(card))} USD</dd>
          <dt>累计按时还款</dt><dd>{card.repayments} 期</dd>
        </dl> : <p>这张卡还没有还款记录。</p>}
        <div className="done-actions">
          <button className="btn primary" onClick={onAgain}>让 {agent.name} 再买一单</button>
          <button className="btn ghost" onClick={onRebind}>换一份档案重新授信</button>
        </div>
        {card.profile && <details className="scene-details"><summary>已绑定的模拟档案 · {card.profile.alias} · {tierNames[card.profile.tier]}信用</summary>
          <ProfileFacts profile={card.profile}/></details>}
      </div>
    </div>
    <ShareCard/>
    <section className="guest-history"><h2>这一页的用卡记录</h2><ol aria-live="polite">{card.history.map((entry, i) =>
      <li key={i}><div><strong>{entry.title}</strong><p>{entry.detail}</p></div>
        <time dateTime={new Date(entry.when).toISOString()}>{new Date(entry.when).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</time></li>)}</ol></section>
  </Scene>
}

function Experience({ user, legacyCard, leave, busy, authError }) {
  const first = useState(() => makeBatch(null))[0]
  const [card, setCard] = useState(null)
  const [legacy, setLegacy] = useState(null)
  const [scene, setScene] = useState('identity')
  const [rebinding, setRebinding] = useState(false)
  const [tier, setTier] = useState(null)
  const [batch, setBatch] = useState(first)
  const [profile, setProfile] = useState(first[0])
  const [agent, setAgent] = useState(() => agentOf(first[0].agent))
  const [name, setName] = useState(() => agentOf(first[0].agent).name)
  const [error, setError] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  useEffect(() => {
    if (user) return
    let active = true
    readLegacyCard().then(saved => { if (active) setLegacy(saved) }).catch(() => {})
    return () => { active = false }
  }, [user])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    const names = { identity: '认领身份', agent: '选择 Agent', grant: '签发副卡', run: 'Agent 刷卡', repay: '按时还清', done: '这一单的结果' }
    document.title = `${names[scene] || '体验'} · 明码分 OpenScore`
  }, [scene])
  function pick(drawn) {
    const next = agentOf(drawn.agent)
    setProfile(drawn)
    setAgent(next)
    setName(current => (current === profile.agent || !current.trim() ? next.name : current))
    setScene('agent')
  }
  function draw(nextTier) {
    const next = makeBatch(nextTier ?? tier)
    setTier(nextTier ?? tier)
    setBatch(next)
  }
  function issue() {
    try {
      const action = rebinding && card ? 'rebind' : 'issue'
      setCard(changeCard(action === 'rebind' ? card : null, action, { name, profile }))
      setRebinding(false)
      setError('')
      setScene('run')
    } catch (e) { setError(e.message) }
  }
  const loadLegacy = saved => {
    setCard(saved)
    setAgent(agentOf(saved.name))
    setScene('done')
    setTier(null)
  }
  const act = action => {
    try {
      setError('')
      setCard(current => {
        if (!current) return current
        if (action === 'swipe') return current.debt ? current : changeCard(current, 'swipe')
        if (action === 'repay') return current.debt ? changeCard(current, 'repay') : current
        return current
      })
    } catch (e) { setError(e.message) }
  }
  const old = user ? legacyCard : legacy
  return <div className="app guest identity-workspace stage-app">
    <header className="top stage-top">
      <Brand/>
      <div className="stage-account"><AccountPortrait user={user}/></div>
      <button className="linkish" disabled={busy} onClick={() => card ? setConfirmLeave(true) : leave()}>退出{user ? '登录' : '体验'}</button>
    </header>
    {confirmLeave && <div className="leave-guard" role="alertdialog" aria-label="确认退出">
      <p>退出会清除本次的模拟档案、额度和账单。确定现在结束吗？</p>
      <button className="btn primary" onClick={leave} disabled={busy}>确定退出</button>
      <button className="btn ghost" onClick={() => setConfirmLeave(false)} disabled={busy}>继续体验</button>
    </div>}
    <main className="stage-main">
      {(error || authError) && <p role="alert" className="banner">{error || authError}</p>}
      {scene === 'identity' && <IdentityScene batch={batch} tier={tier} onTier={k => draw(k)} onDraw={() => draw()}
        onPick={pick} legacy={card ? null : old} legacyKind={user ? 'account' : 'legacy'}
        onLoadLegacy={() => loadLegacy(old)} busy={busy}/>}
      {scene === 'agent' && <AgentScene profile={profile} agent={agent}
        onPick={option => { setAgent(option); setName(current => (current === agent.name || !current.trim() ? option.name : current)); setScene('grant') }}
        onBack={() => setScene(rebinding && card ? 'done' : 'identity')}/>}
      {scene === 'grant' && <GrantScene profile={profile} agent={agent} name={name} setName={setName}
        rebinding={rebinding && Boolean(card)} busy={busy} onIssue={issue}
        onBack={() => setScene('agent')}/>}
      {scene === 'run' && card && <RunScene card={card} agent={agent} onSwipe={() => act('swipe')} onNext={() => setScene('repay')}/>}
      {scene === 'repay' && card && <RepayScene card={card} agent={agent} onRepay={() => act('repay')} onNext={() => setScene('done')}/>}
      {scene === 'done' && card && <DoneScene card={card} agent={agent} onAgain={() => setScene('run')}
        onRebind={() => { setRebinding(true); setScene('identity'); draw('high') }}/>}
    </main>
  </div>
}

function Wallet() {
  const [session, setSession] = useState(null)
  const [guest, setGuest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(location.search.includes('auth=') ? 'GitHub 登录未完成，请重试或直接体验。' : '')
  const guard = useRef(0)
  async function refresh() {
    const version = ++guard.current
    try {
      const next = await api('session')
      if (guard.current !== version) return
      setSession(next)
      if (next.user) setGuest(false)
    } catch {
      if (guard.current === version) setSession(current => current || { enabled: false, user: null, offline: true })
    }
  }
  useEffect(() => {
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    return () => { guard.current++; window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh) }
  }, [])
  async function leave() {
    setBusy(true)
    try {
      if (session?.user) await api('logout', {})
      guard.current++
      setSession(current => ({ ...current, user: null, card: null }))
      setGuest(false)
      setError('')
      window.scrollTo(0, 0)
    } catch { setError('退出未完成，请重试。') }
    finally { setBusy(false) }
  }
  const signed = session?.user || guest
  return signed ?
    <Experience key={session?.user?.id || 'guest'} user={session?.user} legacyCard={session?.card} busy={busy} authError={error} leave={leave}/> :
    <AudienceLogin session={session} error={error} retry={refresh} enter={() => { setGuest(true); setError(''); window.scrollTo(0, 0) }}/>
}
createRoot(document.getElementById('root')).render(<Wallet/>)
