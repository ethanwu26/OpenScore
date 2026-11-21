// Shared helpers for the deploy / seed / bench scripts.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient, createWalletClient, http, defineChain, formatEther, formatUnits, parseGwei,
  encodeDeployData, encodeFunctionData, decodeEventLog,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
try { process.loadEnvFile(path.join(ROOT, '.env')) } catch { /* no .env: use the environment */ }

export const RPC_URL = process.env.RPC_URL || 'https://testnet-rpc.monad.xyz'
export const artifacts = JSON.parse(fs.readFileSync(path.join(ROOT, 'artifacts/openscore.json'), 'utf8'))

export const E18 = 10n ** 18n
export const COLLATERAL = 100_000n * E18 // every score in the demo is quoted against this deposit
export const BASE_PRICE = 10_000n * E18 // list price of the paid service
export const MODEL_FEE = 10n ** 15n // 0.001 USD per score, paid to the model author

// The 8 reference inputs registered with each model, and what each model answers for them.
export const REF_INPUTS = [
  [1420, 6000, 0, 0, 980, 180, 0, 950, -40, 260],
  [12, 300, 4, 3, 120, 900, 4, 0, 420, 1150],
  [0, 1000, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 1000, 0, 0, 1000, 500, 0, 1000, 0, 500],
  [365, 1000, 0, 0, 1000, 500, 0, 1000, 0, 500],
  [0, 1000, 1, 1, 1000, 500, 0, 1000, 0, 500],
  [0, 1000, 1, 1, 500, 1000, 1, 0, 300, 1000],
  [870, 2500, 0, 0, 48, 284, 0, 42, 62, 284],
].map((r) => r.map(BigInt))
export const REF_SCORECARD = [1000, 186, 288, 755, 905, 618, 440, 947]
export const REF_NEURAL = [683, 218, 506, 716, 657, 630, 466, 780]

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const usd = (v) => Number(formatUnits(v, 18)).toLocaleString('en-US', { maximumFractionDigits: 2 })
export const mon = (v) => Number(formatEther(v)).toFixed(4)

export async function connect() {
  const transport = http(RPC_URL, { retryCount: 5, retryDelay: 500, timeout: 30_000 })
  const chainId = await createPublicClient({ transport }).getChainId()
  const local = chainId === 31337
  const chain = defineChain({
    id: chainId,
    name: chainId === 10143 ? 'Monad Testnet' : local ? 'Local' : `chain ${chainId}`,
    nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [RPC_URL] } },
  })
  const pub = createPublicClient({ chain, transport })
  return {
    chain, chainId, local, pub, transport,
    explorer: chainId === 10143 ? 'https://testnet.monadscan.com' : '',
    // Monad: an account under 10 MON should not chain transactions back to back, and a MON
    // transfer from such an account reverts if it sent anything in the previous 3 blocks.
    gap: local ? 0 : 1600,
  }
}

export function signerFrom(ctx, privateKey, label = '') {
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: ctx.chain, transport: ctx.transport })
  return { account, wallet, address: account.address, nonce: null, label }
}

export function deployerFrom(ctx) {
  let pk = process.env.PRIVATE_KEY
  if (!pk && ctx.local) pk = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // anvil account 0
  if (!pk) {
    console.error('缺少 PRIVATE_KEY。把 .env.example 复制为 .env，填入一个只放测试币的私钥。')
    process.exit(1)
  }
  if (!pk.startsWith('0x')) pk = '0x' + pk
  return signerFrom(ctx, pk, 'deployer')
}

async function fees(ctx) {
  const block = await ctx.pub.getBlock({ blockTag: 'latest' })
  const base = block.baseFeePerGas ?? 0n
  const tip = ctx.local ? parseGwei('1') : parseGwei('2')
  // Monad charges gasLimit * (base + tip); maxFee is only a ceiling.
  return { maxPriorityFeePerGas: tip, maxFeePerGas: (base * 3n) / 2n + tip }
}

export let spentGas = 0n
export let spentWei = 0n

/// Send one transaction, wait for it, fail loudly if it reverted.
/// Monad bills the gas limit, so the limit is the estimate plus a small margin.
export async function send(ctx, s, { to, data, value = 0n, gas, pad = 120n }, label) {
  if (!gas) {
    const est = await ctx.pub.estimateGas({ account: s.address, to, data, value })
    gas = (est * pad) / 100n + 20_000n
  }
  if (s.nonce == null) s.nonce = await ctx.pub.getTransactionCount({ address: s.address, blockTag: 'pending' })
  const f = await fees(ctx)
  let hash
  try {
    hash = await s.wallet.sendTransaction({ to, data, value, gas, nonce: s.nonce, ...f })
  } catch (e) {
    if (/nonce/i.test(e.message || '')) {
      await sleep(1500)
      s.nonce = await ctx.pub.getTransactionCount({ address: s.address, blockTag: 'pending' })
      hash = await s.wallet.sendTransaction({ to, data, value, gas, nonce: s.nonce, ...f })
    } else throw e
  }
  s.nonce += 1
  const rc = await ctx.pub.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: ctx.local ? 100 : 500 })
  const cost = gas * (rc.effectiveGasPrice ?? f.maxFeePerGas)
  spentGas += gas
  spentWei += cost
  const tag = `${label}`.padEnd(34)
  if (rc.status !== 'success') {
    console.log(`✗ ${tag} 交易回滚 ${hash}`)
    throw new Error(`${label}: transaction reverted (${hash})`)
  }
  console.log(`✓ ${tag} gas上限 ${String(gas).padStart(9)}  ${mon(cost)} MON  ${hash}`)
  if (ctx.gap) await sleep(ctx.gap)
  return rc
}

export function deployTx(name, args = []) {
  const a = artifacts[name]
  return { data: encodeDeployData({ abi: a.abi, bytecode: a.bytecode, args }) }
}

export function callTx(name, address, functionName, args = [], value = 0n) {
  return { to: address, data: encodeFunctionData({ abi: artifacts[name].abi, functionName, args }), value }
}

export function read(ctx, name, address, functionName, args = []) {
  return ctx.pub.readContract({ address, abi: artifacts[name].abi, functionName, args })
}

export function eventsOf(rc, name, eventName) {
  const out = []
  for (const log of rc.logs) {
    try {
      const d = decodeEventLog({ abi: artifacts[name].abi, data: log.data, topics: log.topics })
      if (d.eventName === eventName) out.push({ ...d.args, address: log.address })
    } catch { /* another contract's event */ }
  }
  return out
}

// ---------- state files ----------
export const statePath = (ctx) => path.join(ROOT, 'deployments', `${ctx.chainId}.json`)
export const keysPath = (ctx) => path.join(ROOT, 'deployments', `demo-keys.${ctx.chainId}.json`)

export function loadState(ctx) {
  try { return JSON.parse(fs.readFileSync(statePath(ctx), 'utf8')) } catch { return {} }
}

export function saveState(ctx, state) {
  fs.mkdirSync(path.dirname(statePath(ctx)), { recursive: true })
  const full = { ...state, chainId: ctx.chainId, rpcUrl: RPC_URL, explorer: ctx.explorer }
  fs.writeFileSync(statePath(ctx), JSON.stringify(full, null, 2))
  // the web app reads the same file at build time
  fs.mkdirSync(path.join(ROOT, 'web/src'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'web/src/deployments.json'), JSON.stringify(full, null, 2))
}

export function loadKeys(ctx) {
  try { return JSON.parse(fs.readFileSync(keysPath(ctx), 'utf8')) } catch { return [] }
}

export function saveKeys(ctx, keys) {
  fs.mkdirSync(path.dirname(keysPath(ctx)), { recursive: true })
  fs.writeFileSync(keysPath(ctx), JSON.stringify(keys, null, 2))
}

export { generatePrivateKey, privateKeyToAccount, formatEther, formatUnits }
