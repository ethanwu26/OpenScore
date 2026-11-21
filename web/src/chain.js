// Everything that talks to the chain lives here. Pages only call these functions.
import {
  createPublicClient, createWalletClient, http, custom, defineChain, decodeEventLog, encodeFunctionData, formatUnits,
  BaseError, ContractFunctionRevertedError,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import dep from './deployments.json'
import abis from './abis.json'

export const D = dep
export const deployed = Boolean(dep.pool && dep.lens)
export const E18 = 10n ** 18n
export const COL = BigInt(dep.collateral || (100_000n * E18).toString())
export const DEPOSIT = 300_000n * E18
export const AGENT_GAS = 5n * 10n ** 17n // 0.5 MON handed to a new agent for gas
const MAX = 2n ** 256n - 1n

const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } },
}

const rpcUrl = ls.get('os.rpc', '') || dep.rpcUrl || 'https://testnet-rpc.monad.xyz'
export const isLocal = dep.chainId === 31337
export const chain = defineChain({
  id: dep.chainId || 10143,
  name: isLocal ? 'Local' : 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: dep.explorer ? { default: { name: 'Explorer', url: dep.explorer } } : undefined,
})
export const pub = createPublicClient({ chain, transport: http(rpcUrl, { retryCount: 4, retryDelay: 400 }), pollingInterval: 400 })
export const currentRpc = rpcUrl
export const setRpc = (url) => { ls.set('os.rpc', url || ''); location.reload() }

export const txUrl = (hash) => (dep.explorer ? `${dep.explorer}/tx/${hash}` : null)
export const addrUrl = (a) => (dep.explorer ? `${dep.explorer}/address/${a}` : null)
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')
export const fmt = (v) => Number(formatUnits(BigInt(v ?? 0), 18)).toLocaleString('en-US', { maximumFractionDigits: 0 })
export const fmtMon = (v) => Number(formatUnits(BigInt(v ?? 0), 18)).toFixed(3)
export const num = (v) => Number(v ?? 0).toLocaleString('en-US')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
// Monad: an account under 10 MON should not chain transactions back to back.
const gap = () => (isLocal ? Promise.resolve() : sleep(1500))

// ---------- errors ----------
const errorAbi = Object.values(abis).flat().filter((x) => x.type === 'error')
const FRIENDLY = {
  InCooldown: '冷却期内：违约后 7 天不能再用这张卡',
  OverLimit: '超过额度，资金池拒绝放款',
  NoLiquidity: '资金池可用资金不足',
  NotUsableModel: '评分模型已被冻结，资金池拒绝放款',
  ScoreTooLow: '分数太低，商户拒绝服务',
  NotDue: '账单还没到期，不能清算',
  NotBorrower: '这笔欠款不属于当前 Agent',
  BadAmount: '金额不对，或这笔欠款已结清',
  ModelsDisagree: '两个模型分歧过大，资金池拒绝放款',
  AlreadyIssued: '这个地址已经有卡了',
  OnlyPool: '只有资金池能调用',
  BadArgs: '参数不对',
}
export function explain(e) {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError)
    if (r instanceof ContractFunctionRevertedError) {
      const name = r.data?.errorName
      if (name && FRIENDLY[name]) return FRIENDLY[name]
      if (name) return `合约拒绝：${name}`
      if (r.reason) return `合约拒绝：${r.reason}`
    }
    if (/insufficient funds|insufficient balance/i.test(e.message)) return 'gas 不够：这个地址的 MON 余额不足'
    if (/User rejected|denied/i.test(e.message)) return '已在钱包里取消'
    return e.shortMessage || e.message
  }
  return e?.message || String(e)
}

// ---------- signers ----------
export function localSigner(privateKey, name = '') {
  const account = privateKeyToAccount(privateKey)
  return {
    kind: 'local', name, address: account.address, account,
    wallet: createWalletClient({ account, chain, transport: http(rpcUrl) }),
  }
}

export async function injectedSigner() {
  if (!window.ethereum) throw new Error('没有检测到浏览器钱包，可以改用"粘贴测试私钥"')
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum) })
  const [address] = await wallet.requestAddresses()
  try { await wallet.switchChain({ id: chain.id }) } catch { await wallet.addChain({ chain }) }
  ls.set('os.operator', '')
  ls.set('os.injected', true)
  return { kind: 'injected', name: '浏览器钱包', address, account: address, wallet }
}

export async function restoredWallet() {
  if (!ls.get('os.injected', false) || !window.ethereum) return null
  try {
    const wallet = createWalletClient({ chain, transport: custom(window.ethereum) })
    const [address] = await wallet.getAddresses()
    if (!address || await wallet.getChainId() !== chain.id) return null
    return { kind: 'injected', name: '浏览器钱包', address, account: address, wallet }
  } catch { return null }
}

export const keys = {
  agents: () => ls.get('os.agents', []),
  saveAgents: (list) => ls.set('os.agents', list),
  addAgent(a) {
    const list = keys.agents().filter((x) => x.address.toLowerCase() !== a.address.toLowerCase())
    list.push(a)
    keys.saveAgents(list)
  },
  operatorKey: () => ls.get('os.operator', ''),
  setOperatorKey: (pk) => { ls.set('os.operator', pk || ''); ls.set('os.injected', false) },
  /// accepts the contents of deployments/demo-keys.<chainId>.json
  importDemo(text) {
    const arr = JSON.parse(text)
    if (!Array.isArray(arr)) throw new Error('应当是一个数组')
    let n = 0
    for (const k of arr) {
      if (!k.privateKey) continue
      const address = privateKeyToAccount(k.privateKey).address
      keys.addAgent({ name: k.name || short(address), address, privateKey: k.privateKey })
      n += 1
    }
    return n
  },
}

export const normalizeKey = (pk) => {
  let s = (pk || '').trim()
  if (!s) return ''
  if (!s.startsWith('0x')) s = '0x' + s
  if (!/^0x[0-9a-fA-F]{64}$/.test(s)) throw new Error('私钥格式不对，应为 64 位十六进制')
  return s
}

// ---------- transactions ----------
function decodeLogs(receipt) {
  const out = []
  for (const log of receipt.logs) {
    for (const abi of Object.values(abis)) {
      try {
        const d = decodeEventLog({ abi, data: log.data, topics: log.topics })
        out.push({ name: d.eventName, args: d.args, address: log.address })
        break
      } catch { /* not this abi */ }
    }
  }
  return out
}

async function rawSend(signer, { to, data, value = 0n, gas }) {
  const block = await pub.getBlock()
  const base = block.baseFeePerGas ?? 0n
  const tip = isLocal ? 10n ** 9n : 2n * 10n ** 9n
  const t0 = performance.now()
  const hash = await signer.wallet.sendTransaction({
    account: signer.account, chain, to, data, value, gas,
    maxPriorityFeePerGas: tip, maxFeePerGas: (base * 3n) / 2n + tip,
  })
  const receipt = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 })
  const ms = Math.round(performance.now() - t0)
  if (receipt.status !== 'success') throw new Error(`交易回滚：${hash}`)
  return { hash, receipt, gas, ms, events: decodeLogs(receipt) }
}

/// Estimate first (so a refusal shows its reason before anything is sent), then send with a
/// limit just above the estimate — Monad bills the limit, not what was used.
export async function write(signer, name, address, functionName, args = [], { pad = 125n, value = 0n } = {}) {
  const abi = [...abis[name], ...errorAbi]
  const est = await pub.estimateContractGas({ address, abi, functionName, args, account: signer.address, value })
  const data = encodeFunctionData({ abi: abis[name], functionName, args })
  return rawSend(signer, { to: address, data, value, gas: (est * pad) / 100n + 30_000n })
}

export const sendMon = (signer, to, value) => rawSend(signer, { to, value, gas: 21_000n })

// ---------- reads ----------
const lens = () => ({ address: dep.lens, abi: abis.OpenScoreLens })
export async function loadBoard() {
  const [list, pool] = await pub.readContract({ ...lens(), functionName: 'board', args: [60n] })
  return { list, pool }
}
export const loadAgent = (a) => pub.readContract({ ...lens(), functionName: 'agentView', args: [a] })
export const trial = (f) => pub.readContract({ ...lens(), functionName: 'trial', args: [f.map((x) => BigInt(x))] })
export const balanceOf = (a) => pub.getBalance({ address: a })

export async function loadAudit() {
  const reg = { address: dep.registry, abi: abis.ModelRegistry }
  const [honest, nn, decoy] = await Promise.all([
    pub.readContract({ ...reg, functionName: 'info', args: [dep.scoreCardId] }),
    pub.readContract({ ...reg, functionName: 'info', args: [dep.neuralId] }),
    pub.readContract({ address: dep.decoyPool, abi: abis.DecoyPool, functionName: 'status', args: [dep.deployer, COL] }),
  ])
  const pick = (i) => ({ model: i[0], author: i[1], n: Number(i[3]), failed: i[4], passed: Number(i[5]), failedCount: Number(i[6]) })
  const decoyInfo = decoy[2] || decoy[0] > 0n
    ? pick(await pub.readContract({ ...reg, functionName: 'info', args: [decoy[1]] }))
    : null
  return {
    honest: pick(honest), neural: pick(nn),
    decoy: { round: Number(decoy[0]), id: Number(decoy[1]), usable: decoy[2], lends: decoy[3], score: Number(decoy[4]), limit: decoy[5], info: decoyInfo },
  }
}

export async function loadBench() {
  const b = { address: dep.bench, abi: abis.Bench }
  const [d, s] = await Promise.all([
    pub.readContract({ ...b, functionName: 'lastDense' }),
    pub.readContract({ ...b, functionName: 'lastScattered' }),
  ])
  const run = (r) => ({ n: Number(r[0]), gas: Number(r[1]), at: Number(r[2]), count: Number(r[3]) })
  return { dense: run(d), scattered: run(s) }
}

// ---------- actions ----------
export const actions = {
  swipe: (agent, lockDays) => write(agent, 'CreditPool', dep.pool, 'swipe', [dep.shop, COL, lockDays]),
  repay: (agent, loanId, amount) => write(agent, 'CreditPool', dep.pool, 'repay', [loanId, amount]),
  liquidate: (signer, loanId) => write(signer, 'CreditPool', dep.pool, 'liquidate', [loanId]),
  approvePool: (agent) => write(agent, 'MockUSD', dep.usd, 'approve', [dep.pool, MAX]),
  audit: (signer, id, k) => write(signer, 'ModelRegistry', dep.registry, 'audit', [id, k], { pad: 140n }),
  arm: (signer) => write(signer, 'DecoyPool', dep.decoyPool, 'arm', []),
  settle: (signer, dense, n) => write(signer, 'Bench', dep.bench, dense ? 'payDense' : 'payScattered', [BigInt(n), 1n], { pad: 104n }),
  benchFunded: async (dense, n) => {
    if (!n) return false
    const v = await pub.readContract({
      address: dep.bench, abi: abis.Bench, functionName: dense ? 'denseAt' : 'scatteredAt', args: [BigInt(dense ? n - 1 : n)],
    })
    return v > 0n
  },

  /// Owner issues a card: new agent key, deposit moved to the agent, a little MON for gas,
  /// then the agent itself lets the pool pull collateral and repayments.
  async issue(owner, name, onStep) {
    const privateKey = generatePrivateKey()
    const agent = localSigner(privateKey, name)
    keys.addAgent({ name, address: agent.address, privateKey }) // saved before any money moves
    const step = async (label, p) => { onStep?.({ label, state: 'run' }); const r = await p(); onStep?.({ label, state: 'ok', hash: r?.hash }); await gap(); return r }

    await step('铸造 300,000 USD 押金（测试币）', () => write(owner, 'MockUSD', dep.usd, 'mint', [owner.address, DEPOSIT]))
    const allowance = await pub.readContract({ address: dep.usd, abi: abis.MockUSD, functionName: 'allowance', args: [owner.address, dep.card] })
    if (allowance < DEPOSIT) await step('主人授权发卡合约', () => write(owner, 'MockUSD', dep.usd, 'approve', [dep.card, MAX]))
    await step('发卡，押金划给 Agent', () => write(owner, 'AgentCard', dep.card, 'issue', [agent.address, name, DEPOSIT]))
    if (!isLocal) await sleep(1500) // a MON transfer must not follow another transaction too closely
    await step('给 Agent 转 0.5 MON 作 gas', () => sendMon(owner, agent.address, AGENT_GAS))
    if (!isLocal) await sleep(1500)
    await step('Agent 自己签名：授权资金池', () => actions.approvePool(agent))
    return agent
  },
}
