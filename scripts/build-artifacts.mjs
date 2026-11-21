// Collects abi + bytecode from the Foundry build into one file the scripts and the web app share.
// Run after `forge build` in contracts/.  The result is committed, so deploying needs only Node.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NAMES = [
  'MockUSD', 'ModelRegistry', 'ScoreCard', 'ScoreCardAlt', 'RiskModel', 'BehaviorBook',
  'CreditPool', 'AgentCard', 'CreditShop', 'OpenScoreLens', 'DecoyPool', 'Bench',
]
const out = {}
const abis = {}
for (const n of NAMES) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'contracts/out', `${n}.sol`, `${n}.json`), 'utf8'))
  out[n] = { abi: j.abi, bytecode: j.bytecode.object }
  abis[n] = j.abi
}
fs.mkdirSync(path.join(ROOT, 'artifacts'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'artifacts/openscore.json'), JSON.stringify(out))
fs.mkdirSync(path.join(ROOT, 'web/src'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'web/src/abis.json'), JSON.stringify(abis))
console.log('artifacts:', NAMES.length, 'contracts')
