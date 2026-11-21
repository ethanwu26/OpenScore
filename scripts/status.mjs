// Read-only: prints the board, the pool and the decoy. Costs nothing.
import { connect, read, loadState, usd, mon, COLLATERAL } from './lib.mjs'

const ctx = await connect()
const st = loadState(ctx)
if (!st.lens) { console.error('还没有部署'); process.exit(1) }
const [list, pv] = await read(ctx, 'OpenScoreLens', st.lens, 'board', [50n])
console.log(`链 ${ctx.chainId}  区块 ${pv.blockNumber}`)
for (const v of list) {
  console.log(
    `${v.name.padEnd(8)} ${v.agent}  ${String(v.score).padStart(4)} 分（神经网络 ${v.neuralScore}）  额度 ${usd(v.limit)}  ` +
    `服务价 ${usd(v.price)}  五项 ${v.parts.join('/')}  欠款 ${usd(v.debt)}  违约 ${v.defaults}  gas ${mon(v.gasBalance)} MON`,
  )
}
console.log(`资金池：可用 ${usd(pv.liquidity)}，在贷 ${usd(pv.outstanding)}，手续费收入 ${usd(pv.earned)}，放款 ${pv.loanCount} 笔；商户已收 ${usd(pv.merchantBalance)}`)
const d = await read(ctx, 'DecoyPool', st.decoyPool, 'status', [st.deployer, COLLATERAL])
console.log(`诱饵：第 ${d[0]} 轮，模型编号 ${d[1]}，${d[2] ? '尚未被抽检' : '已冻结'}，诱饵池${d[3] ? '可以放款' : '拒绝放款'}`)
const bd = await read(ctx, 'Bench', st.bench, 'lastDense')
const bs = await read(ctx, 'Bench', st.bench, 'lastScattered')
if (bd[0] > 0n) console.log(`账本：页式 ${bd[0]} 户 ${bd[1]} gas；普通 ${bs[0]} 户 ${bs[1]} gas`)
