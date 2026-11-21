// Deploys everything and writes the addresses to deployments/<chainId>.json and web/src/deployments.json.
// Safe to re-run: each finished step is saved, a second run continues where the first one stopped.
//   node scripts/deploy.mjs            # uses PRIVATE_KEY and RPC_URL from .env
import {
  connect, deployerFrom, send, deployTx, callTx, read, eventsOf, loadState, saveState, mon, usd, spentGas, spentWei,
  REF_INPUTS, REF_SCORECARD, REF_NEURAL, COLLATERAL, BASE_PRICE, MODEL_FEE, E18, privateKeyToAccount, generatePrivateKey,
} from './lib.mjs'

const ctx = await connect()
const me = deployerFrom(ctx)
const state = loadState(ctx)
const bal = await ctx.pub.getBalance({ address: me.address })
console.log(`链 ${ctx.chainId}  部署者 ${me.address}  余额 ${mon(bal)} MON`)
if (!ctx.local && bal < 2n * E18) console.log('提示：全部部署约需 2.5 MON，余额可能不够。脚本可以中断后重跑。')

async function deploy(key, name, args = []) {
  if (state[key]) return state[key]
  const rc = await send(ctx, me, deployTx(name, args), `部署 ${name}`)
  state[key] = rc.contractAddress
  saveState(ctx, state)
  return state[key]
}

async function once(key, fn) {
  if (state[key] !== undefined) return state[key]
  const v = await fn()
  state[key] = v === undefined ? true : v
  saveState(ctx, state)
  return state[key]
}

const token = await deploy('usd', 'MockUSD')
const registry = await deploy('registry', 'ModelRegistry')
const scoreCard = await deploy('scoreCard', 'ScoreCard')
const scoreCardAlt = await deploy('scoreCardAlt', 'ScoreCardAlt')
const neural = await deploy('neural', 'RiskModel')

const register = async (model, scores, label) => {
  const rc = await send(ctx, me, callTx('ModelRegistry', registry, 'register', [model, MODEL_FEE, REF_INPUTS, scores]), label)
  return Number(eventsOf(rc, 'ModelRegistry', 'Registered')[0].id)
}
const scoreCardId = await once('scoreCardId', () => register(scoreCard, REF_SCORECARD, '登记评分卡'))
const neuralId = await once('neuralId', () => register(neural, REF_NEURAL, '登记神经网络'))

const book = await deploy('book', 'BehaviorBook')
const pool = await deploy('pool', 'CreditPool', [token, book, registry, scoreCardId])
await once('bookBound', () => send(ctx, me, callTx('BehaviorBook', book, 'setPool', [pool]), '账本绑定资金池').then(() => true))

const card = await deploy('card', 'AgentCard', [token])
const merchant = await once('merchant', () => process.env.MERCHANT || privateKeyToAccount(generatePrivateKey()).address)
// Optional: let receipts land in MerchantTreasury so the merchant withdraws on their own
// schedule. Set MERCHANT_TREASURY=1 (and MERCHANT=your address, or you cannot withdraw).
const payee = await once('payee', async () => {
  if (process.env.MERCHANT_TREASURY !== '1') return merchant
  return deploy('treasury', 'MerchantTreasury', [token, merchant])
})
const shop = await deploy('shop', 'CreditShop', [token, pool, payee, COLLATERAL, BASE_PRICE])
const lens = await deploy('lens', 'OpenScoreLens', [token, card, pool, book, shop, scoreCard, neural, COLLATERAL])
const decoyBook = await deploy('decoyBook', 'BehaviorBook')
const decoyPool = await deploy('decoyPool', 'DecoyPool', [token, decoyBook, registry, scoreCardAlt])
await once('decoyBound', () => send(ctx, me, callTx('BehaviorBook', decoyBook, 'setPool', [decoyPool]), '诱饵账本绑定诱饵池').then(() => true))
await once('decoyArmed', () => send(ctx, me, callTx('DecoyPool', decoyPool, 'arm'), '登记被篡改的模型').then(() => true))
const bench = await deploy('bench', 'Bench')

await once('liquidity', async () => {
  const amount = 5_000_000n * E18
  await send(ctx, me, callTx('MockUSD', token, 'mint', [me.address, amount]), '铸造流动性')
  await send(ctx, me, callTx('MockUSD', token, 'approve', [pool, 2n ** 256n - 1n]), '授权资金池')
  await send(ctx, me, callTx('CreditPool', pool, 'deposit', [amount]), '注入流动性')
  return true
})

state.deployer = me.address
state.collateral = COLLATERAL.toString()
saveState(ctx, state)

// ---------- checks: stop here if any of these is off ----------
let ok = true
const expect = (what, got, want) => {
  const pass = String(got) === String(want)
  if (!pass) ok = false
  console.log(`${pass ? '✓' : '✗'} ${what}: ${got}${pass ? '' : `（应为 ${want}）`}`)
}
console.log('\n核对')
const got = []
for (const f of REF_INPUTS) got.push(await read(ctx, 'ScoreCard', scoreCard, 'score', [f]))
expect('评分卡 8 组参考输入', got.join(','), REF_SCORECARD.join(','))
const [d1] = await read(ctx, 'ModelRegistry', registry, 'fullDeviation', [scoreCardId])
expect('评分卡与登记值的最大偏差', d1, 0)
const [d2] = await read(ctx, 'ModelRegistry', registry, 'fullDeviation', [neuralId])
expect('神经网络与登记值的最大偏差', d2, 0)
const fresh = privateKeyToAccount(generatePrivateKey()).address
const [s0, l0] = await read(ctx, 'CreditPool', pool, 'quote', [fresh, COLLATERAL])
expect('全新地址的分数', s0, 288)
expect('全新地址的额度', usd(l0), '28,800')
const st = await read(ctx, 'DecoyPool', decoyPool, 'status', [fresh, COLLATERAL])
if (st[2]) {
  expect('诱饵池当前可借（抽检前）', st[3], true)
  expect('诱饵模型对全新地址的分数', st[4], 298)
} else console.log('· 诱饵模型已被抽检冻结（前端点"重新布置"可再来一轮）')
const pv = await read(ctx, 'OpenScoreLens', lens, 'poolView')
expect('资金池已有流动性', pv.liquidity + pv.outstanding >= 5_000_000n * E18, true)

console.log(`\n本次花费 ${mon(spentWei)} MON（gas 上限合计 ${spentGas}）`)
console.log(`地址已写入 deployments/${ctx.chainId}.json 和 web/src/deployments.json`)
if (!ok) { console.log('有核对项不符，先不要往下做。'); process.exit(1) }
console.log('下一步：node scripts/seed.mjs')
