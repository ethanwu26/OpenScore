// The ledger comparison: update N accounts laid out on storage pages vs M accounts laid out the
// usual way. Prints the estimated cost first and sends nothing without --yes.
//   node scripts/bench.mjs                 # estimate only, default size "mid"
//   node scripts/bench.mjs --size mini --yes
//   node scripts/bench.mjs --dense 10000 --scattered 300 --yes
// sizes: mini 2000/100 · half 5000/300 · mid 10000/300 · full 10000/1000
import { connect, deployerFrom, send, callTx, read, loadState, saveState, mon, spentWei } from './lib.mjs'

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : dflt
}
const SIZES = { mini: [2000, 100], half: [5000, 300], mid: [10000, 300], full: [10000, 1000] }
const size = arg('size', 'mid')
const N = Number(arg('dense', SIZES[size]?.[0] ?? 10000))
const M = Number(arg('scattered', SIZES[size]?.[1] ?? 300))
const go = process.argv.includes('--yes')

const ctx = await connect()
const me = deployerFrom(ctx)
const st = loadState(ctx)
if (!st.bench) { console.error('还没有部署：先运行 node scripts/deploy.mjs'); process.exit(1) }
const B = st.bench
const TX_CAP = 29_000_000n // Monad allows 30M per transaction
const DENSE_STEP = 5000 // first write of 5,000 dense accounts is about 22M gas
const SCAT_STEP = 400 // first write of 400 scattered accounts is about 11M gas

const est = (fn, args) => ctx.pub.estimateGas({ account: me.address, ...callTx('Bench', B, fn, args) })
const price = await ctx.pub.getGasPrice()
const balance = await ctx.pub.getBalance({ address: me.address })

// what is already funded
let denseDone = 0
for (let n = DENSE_STEP; n <= N; n += DENSE_STEP) if ((await read(ctx, 'Bench', B, 'denseAt', [BigInt(n - 1)])) > 0n) denseDone = n
if (N % DENSE_STEP && (await read(ctx, 'Bench', B, 'denseAt', [BigInt(N - 1)])) > 0n) denseDone = N
let scatDone = 0
for (let m = SCAT_STEP; m <= M; m += SCAT_STEP) if ((await read(ctx, 'Bench', B, 'scatteredAt', [BigInt(m)])) > 0n) scatDone = m
if (M % SCAT_STEP && (await read(ctx, 'Bench', B, 'scatteredAt', [BigInt(M)])) > 0n) scatDone = M

const steps = []
for (let n = denseDone; n < N; ) { n = Math.min(n + DENSE_STEP, N); steps.push({ fn: 'payDense', n, label: `铺页式账本到 ${n} 户（首次写入）` }) }
for (let m = scatDone; m < M; ) { m = Math.min(m + SCAT_STEP, M); steps.push({ fn: 'payScattered', n: m, label: `铺普通账本到 ${m} 户（首次写入）` }) }

console.log(`链 ${ctx.chainId}  余额 ${mon(balance)} MON  gas 价格 ${Number(price) / 1e9} gwei`)
console.log(`对照：页式布局 ${N} 户 对 普通布局 ${M} 户。已铺好：页式 ${denseDone} 户，普通 ${scatDone} 户\n`)

if (!go) {
  // Funding steps depend on each other, so only the first of each kind can be estimated exactly.
  let total = 0n
  const firstDense = steps.find((s) => s.fn === 'payDense')
  const firstScat = steps.find((s) => s.fn === 'payScattered')
  for (const [first, kind] of [[firstDense, 'payDense'], [firstScat, 'payScattered']]) {
    if (!first) continue
    const g = await est(first.fn, [BigInt(first.n), 1n])
    const count = steps.filter((s) => s.fn === kind).length
    total += g * BigInt(count)
    console.log(`  ${kind === 'payDense' ? '铺页式账本' : '铺普通账本'}：${count} 笔，每笔约 ${g} gas`)
  }
  if (!steps.length) {
    const a = await est('payDense', [BigInt(N), 1n])
    const b = await est('payScattered', [BigInt(M), 1n])
    total += a + b
    console.log(`  对照两笔：页式 ${N} 户约 ${a} gas；普通 ${M} 户约 ${b} gas`)
  } else {
    total += 1_000_000n + BigInt(M) * 11_500n
    console.log('  对照两笔：铺好之后才能精确估算，按经验值计入')
  }
  const cost = total * price
  console.log(`\n预计共需约 ${mon(cost)} MON${cost > balance ? '  ← 余额不够，换小一档：--size mini' : ''}`)
  console.log('确认后加 --yes 重新运行。中途断了可以直接重跑，会从断点继续。')
  process.exit(0)
}

for (const s of steps) {
  const g = await est(s.fn, [BigInt(s.n), 1n])
  if (g > TX_CAP) { console.error(`${s.label} 估算 ${g} gas，超过单笔上限，请把步长调小`); process.exit(1) }
  await send(ctx, me, { ...callTx('Bench', B, s.fn, [BigInt(s.n), 1n]), gas: (g * 103n) / 100n + 20_000n }, s.label)
}

// the two transactions the talk is about: every slot already exists, so both are pure updates
const gd = await est('payDense', [BigInt(N), 1n])
const rd = await send(ctx, me, { ...callTx('Bench', B, 'payDense', [BigInt(N), 1n]), gas: (gd * 103n) / 100n + 20_000n }, `月结：页式 ${N} 户`)
const gs = await est('payScattered', [BigInt(M), 1n])
const rs = await send(ctx, me, { ...callTx('Bench', B, 'payScattered', [BigInt(M), 1n]), gas: (gs * 103n) / 100n + 20_000n }, `月结：普通 ${M} 户`)

const d = await read(ctx, 'Bench', B, 'lastDense')
const s = await read(ctx, 'Bench', B, 'lastScattered')
const perD = Number(d[1]) / Number(d[0])
const perS = Number(s[1]) / Number(s[0])
st.benchRun = {
  dense: { n: Number(d[0]), gas: Number(d[1]), tx: rd.transactionHash, estimate: Number(gd) },
  scattered: { n: Number(s[0]), gas: Number(s[1]), tx: rs.transactionHash, estimate: Number(gs) },
}
saveState(ctx, st)
console.log(`\n合约自己量到的执行 gas（不含每笔 21,000 的基础费）`)
console.log(`  页式 ${d[0]} 户：${d[1]} gas，每户 ${perD.toFixed(1)}`)
console.log(`  普通 ${s[0]} 户：${s[1]} gas，每户 ${perS.toFixed(1)}`)
console.log(`  每户成本相差 ${(perS / perD).toFixed(0)} 倍`)
console.log(`本次花费 ${mon(spentWei)} MON。讲稿里的数字请换成上面这组实测值。`)
