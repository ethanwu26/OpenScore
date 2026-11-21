// Puts three real agents on chain so the demo opens with history instead of an empty page.
//   守信的刺猬  swipes once and repays            → 806 分，服务打八折
//   赖账的狐狸  repays once, then swipes and walks → 被清算，额度砍半，折扣取消
//   害羞的松鼠  has a card and nothing else       → 288 分，留给台上现场刷卡
// Agent keys are generated here and saved to deployments/demo-keys.<chainId>.json (git-ignored).
// Safe to re-run: every step first looks at what is already on chain.
import {
  connect, deployerFrom, signerFrom, send, callTx, read, loadState, loadKeys, saveKeys, mon, tusd, sleep,
  COLLATERAL, E18, generatePrivateKey, privateKeyToAccount, spentWei,
} from './lib.mjs'

const ctx = await connect()
const me = deployerFrom(ctx)
const st = loadState(ctx)
if (!st.pool) { console.error('还没有部署：先运行 node scripts/deploy.mjs'); process.exit(1) }

const DEPOSIT = 300_000n * E18
// MON handed to each agent for gas. The fresh one is the card used live on stage, so it gets more.
const GAS_BY_ROLE = { good: '0.3', bad: '0.4', fresh: '0.6' }
const gasFor = (role) => BigInt(Math.round(Number(process.env.AGENT_GAS || GAS_BY_ROLE[role]) * 1000)) * 10n ** 15n
const MAX = 2n ** 256n - 1n
const PLAN = [
  { name: '守信的刺猬', role: 'good' },
  { name: '赖账的狐狸', role: 'bad' },
  { name: '害羞的松鼠', role: 'fresh' },
]

let keys = loadKeys(ctx)
for (const p of PLAN) {
  if (!keys.find((k) => k.name === p.name)) {
    const pk = generatePrivateKey()
    keys.push({ name: p.name, role: p.role, address: privateKeyToAccount(pk).address, privateKey: pk })
  }
}
saveKeys(ctx, keys)

const view = (a) => read(ctx, 'OpenScoreLens', st.lens, 'agentView', [a])
const line = (v) => `${String(v.score).padStart(4)} 分  额度 ${tusd(v.limit).padStart(7)}  服务价 ${tusd(v.price).padStart(6)}  违约 ${v.defaults}  记录 ${v.periods} 期`

console.log(`链 ${ctx.chainId}  主人 ${me.address}  余额 ${mon(await ctx.pub.getBalance({ address: me.address }))} MON`)
if ((await read(ctx, 'MockTUSD', st.tusd, 'allowance', [me.address, st.card])) < DEPOSIT * 10n) {
  await send(ctx, me, callTx('MockTUSD', st.tusd, 'approve', [st.card, MAX]), '主人授权发卡合约')
}

for (const p of PLAN) {
  const k = keys.find((x) => x.name === p.name)
  const agent = signerFrom(ctx, k.privateKey, k.name)
  console.log(`\n— ${k.name}  ${k.address}`)

  // 1. card + deposit
  const owner = await read(ctx, 'AgentCard', st.card, 'ownerOf', [k.address])
  if (owner === '0x0000000000000000000000000000000000000000') {
    await send(ctx, me, callTx('MockTUSD', st.tusd, 'mint', [me.address, DEPOSIT]), '铸造押金')
    await send(ctx, me, callTx('AgentCard', st.card, 'issue', [k.address, k.name, DEPOSIT]), '发卡并划拨押金')
  }
  // 2. gas for the agent. A MON transfer must not follow another transaction too closely.
  const GAS_MON = gasFor(p.role)
  if ((await ctx.pub.getBalance({ address: k.address })) < GAS_MON / 2n) {
    if (ctx.gap) await sleep(2500)
    await send(ctx, me, { to: k.address, value: GAS_MON, gas: 21_000n }, `给 Agent 转 ${mon(GAS_MON)} MON 作 gas`)
    if (ctx.gap) await sleep(2500)
  }
  // 3. the agent lets the pool pull collateral and repayments
  let v = await view(k.address)
  if (v.poolAllowance < DEPOSIT) {
    await send(ctx, agent, callTx('MockTUSD', st.tusd, 'approve', [st.pool, MAX]), 'Agent 授权资金池')
  }
  console.log('  发卡后  ', line(v))
  if (p.role === 'fresh') continue

  // 4. one clean cycle: swipe, then repay in full
  v = await view(k.address)
  if (v.periods === 0 && v.defaults === 0) {
    if (!v.hasOpenLoan) {
      await send(ctx, agent, callTx('CreditPool', st.pool, 'swipe', [st.shop, COLLATERAL, 1]), '刷卡买服务')
      v = await view(k.address)
    }
    await send(ctx, agent, callTx('CreditPool', st.pool, 'repay', [v.openLoanId, v.debt]), '全额还款')
    v = await view(k.address)
  }
  console.log('  还款后  ', line(v))
  if (p.role === 'good') continue

  // 5. the bad one swipes again with a zero-day term and never repays
  if (v.defaults === 0) {
    if (!v.hasOpenLoan) {
      await send(ctx, agent, callTx('CreditPool', st.pool, 'swipe', [st.shop, COLLATERAL, 0]), '再次刷卡，不还')
      v = await view(k.address)
    }
    await sleep(ctx.local ? 1100 : 2500) // liquidation needs a later block timestamp
    if (ctx.local) await ctx.pub.request({ method: 'evm_mine', params: [] })
    await send(ctx, me, callTx('CreditPool', st.pool, 'liquidate', [v.openLoanId]), '到期未还，清算')
    v = await view(k.address)
  }
  console.log('  清算后  ', line(v))
}

console.log('\n现在的榜单')
const [list, pv] = await read(ctx, 'OpenScoreLens', st.lens, 'board', [50n])
for (const v of list) console.log(`  ${v.name.padEnd(8)} ${line(v)}  余额 ${tusd(v.balance)}  gas ${mon(v.gasBalance)} MON`)
console.log(`  资金池：可用 ${tusd(pv.liquidity)}，在贷 ${tusd(pv.outstanding)}，手续费收入 ${tusd(pv.earned)}；商户已收 ${tusd(pv.merchantBalance)}`)
console.log(`\n本次花费 ${mon(spentWei)} MON。Agent 私钥在 deployments/demo-keys.${ctx.chainId}.json，前端"导入演示密钥"时粘贴该文件内容。`)
