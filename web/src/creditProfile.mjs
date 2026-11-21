export const deposit = 100000
const tiers = {
  high: { label: '高', months: [30, 36], paid: [22, 24], late: [0, 0] },
  medium: { label: '中', months: [14, 20], paid: [12, 16], late: [0, 1] },
  low: { label: '低', months: [1, 6], paid: [2, 6], late: [1, 2] },
}
export const tierNames = Object.fromEntries(Object.entries(tiers).map(([key, tier]) => [key, tier.label]))
const roles = [
  ['独立开发者', '构建助手', '为代码审查购买推理服务'],
  ['科研助理', '文献助手', '为论文摘要购买推理服务'],
  ['内容编辑', '校对助手', '为稿件校对购买推理服务'],
  ['产品设计师', '原型助手', '为原型评审购买推理服务'],
]
const aliases = ['阿禾', '小夏', '阿澄', '小岚', '阿林', '小朔']

function draw([min, max]) {
  return min + Math.floor(Math.random() * (max - min + 1))
}
export function generateProfile(tier) {
  const range = tiers[tier]
  const [role, agent, task] = roles[draw([0, roles.length - 1])]
  return { tier, alias: aliases[draw([0, aliases.length - 1])], role, agent, task,
    months: draw(range.months), paid: draw(range.paid), late: draw(range.late) }
}
export const baseScore = p => Math.max(250, 300 + p.months * 6 + p.paid * 12 - p.late * 30)
export const scoreOf = card => card?.profile
  ? Math.min(960, baseScore(card.profile) + card.repayments * 80)
  : card?.repayments ? 806 : 288
export const priceOf = card => scoreOf(card) >= 600 ? 8000 : 10000
export const limitOf = card => deposit * scoreOf(card) / 1000

function checkedProfile(p) {
  if (!p || !Object.hasOwn(tiers, p.tier)) throw new Error('请重新生成模拟档案。')
  const range = tiers[p.tier]
  for (const field of ['months', 'paid', 'late']) {
    if (!Number.isInteger(p[field]) || p[field] < range[field][0] || p[field] > range[field][1]) throw new Error('模拟记录超出档位范围。')
  }
  if (!aliases.includes(p.alias) || !roles.some(([r,a,t]) => r === p.role && a === p.agent && t === p.task)) throw new Error('模拟身份无效。')
  return { tier:p.tier, alias:p.alias, role:p.role, agent:p.agent, task:p.task, months:p.months, paid:p.paid, late:p.late }
}

export function changeCard(card, action, input = {}) {
  const when = Date.now()
  const money = n => n.toLocaleString('en-US')
  if ((action === 'issue' && !card) || (action === 'rebind' && card && !card.debt)) {
    const profile = checkedProfile(input.profile)
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name || name.length > 24) throw new Error('请填写 1 至 24 个字符的 Agent 昵称。')
    const next = { id: card?.id || 'SIM-' + crypto.randomUUID().slice(0, 8).toUpperCase(), name, profile, revision: (card?.revision || 0) + 1, repayments: 0, debt: 0 }
    next.history = [{when, title: card ? '已更换档案并重新授信' : '已绑定模拟档案并授信', detail: `${tierNames[profile.tier]}分档 · ${scoreOf(next)} 分，额度 ${money(limitOf(next))} USD。`}, ...(card?.history || [])].slice(0,8)
    return next
  }
  if (!card) throw new Error('请先确认授信。')
  const next = { ...card, revision: card.revision + 1 }
  let entry
  if (action === 'swipe' && !card.debt) {
    next.debt = priceOf(card)
    entry = { when, title: '已购买一次推理服务', detail: `记账 ${money(next.debt)} USD，商户收到 ${money(next.debt * 0.99)}，手续费 ${money(next.debt / 100)}。` }
  } else if (action === 'repay' && card.debt) {
    next.debt = 0
    next.repayments++
    entry = { when, title: `按时还清 ${money(card.debt)} USD`, detail: `信用分 ${scoreOf(card)} → ${scoreOf(next)}，额度 ${money(limitOf(next))} USD，下次报价 ${money(priceOf(next))} USD。` }
  } else {
    throw new Error('当前账单无法执行此操作，请刷新后重试。')
  }
  next.history = [entry, ...card.history].slice(0, 8)
  return next
}
