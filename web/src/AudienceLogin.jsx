import React from 'react'
import { avatarForProfile, avatarForUser, avatarWall } from './avatars.js'

export function Brand() {
  return <a className="brand" href="./"><span className="brand-symbol" aria-hidden="true"/><b>明码分</b><span>OpenScore</span></a>
}

export function Portrait({ profile, user, size = 48, className = '' }) {
  const src = profile ? avatarForProfile(profile) : avatarForUser(user)
  const label = profile ? `${profile.alias} 的模拟头像` : user ? `${user.login} 的头像` : '体验访客头像'
  return <img className={`portrait ${className}`} src={src} width={size} height={size} alt={label} decoding="async" />
}

export function AccountPortrait({user}) {
  const label = user ? '@'+user.login : '体验访客'
  return <div className="account-portrait">
    <Portrait user={user} size={48}/>
    <div><b>{label}</b><small>{user ? '已通过 GitHub 验证' : '本次访客身份'}</small></div>
  </div>
}

// Everything the visitor gets before spending a single tap: one identity, one card, one order.
const facts = [
  ['不用充值', '模拟押金由体验系统配发'],
  ['不用连钱包', '刷卡与还款都在页面上完成'],
  ['不留痕迹', '档案和账单只存在当前页面'],
]

export default function AudienceLogin({session, error, enter, retry}) {
  const wall = avatarWall(8)
  return <div className="signin-shell">
    <header className="signin-header"><Brand/><a href="./">返回产品首页</a></header>
    <main className="signin-layout">
      <section className="signin-cover">
        <div className="engraving" aria-hidden="true">{Array.from({length:20},(_,i)=><i key={i} style={{transform:`rotate(${i*5}deg)`}}/>)}</div>
        <div className="cover-chip" aria-hidden="true"/>
        <p className="cover-eyebrow">Agent 信用副卡 · 现场演示</p>
        <h2>先抽一张自己的脸</h2>
        <p>每个模拟身份都有自己的头像和还款记录。领到卡后，替 Agent 买一次推理服务，再按时还清，看额度和报价怎么变。</p>
        <div className="portrait-wall" aria-hidden="true">
          {wall.map((src, i) => <img key={src} src={src} width="34" height="34" alt="" loading="lazy" decoding="async" style={{animationDelay:`${i*70}ms`}}/>)}
        </div>
        <p className="portrait-wall-note">48 张面孔，随便抽一张</p>
        <div className="cover-signature">OpenScore</div>
      </section>
      <section className="signin-form">
        <h1>领一张模拟副卡</h1>
        <p>一分钟走完：认领身份 → 核对授信 → 刷一单 → 还清。</p>
        {error && <p role="alert" className="banner">{error}</p>}
        {!session ? <p role="status">正在检查登录状态…</p> : <>
          <button className="btn primary signin-submit" onClick={enter}>直接开始体验 <span aria-hidden="true">→</span></button>
          {session.enabled
            ? <a href="/api/audience/login" className="btn ghost signin-secondary">用 GitHub 登录，换设备也能找回</a>
            : <p role="status" className="login-status">{session.offline ? '登录服务暂时连不上。' : 'GitHub 登录待开通，不影响体验。'} <button className="linkish" onClick={retry}>重试</button></p>}
        </>}
        <ul className="signin-facts">{facts.map(([title, text]) =>
          <li key={title}><b>{title}</b><span>{text}</span></li>)}</ul>
        <p className="signin-note">刷卡、还款和押金都是模拟的，不涉及真实资金。刷新、关闭或退出后，本次档案与账单清除。</p>
      </section>
    </main>
  </div>
}
