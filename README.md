# 明码分 OpenScore

给 AI Agent 的链上信用副卡。额度不是主人设的，是 Agent 靠按时还款挣来的；分数由合约里的模型算，谁也改不了。

Monad Blitz @ 广州（2026-11-21）参赛项目，队伍 Tanka Line。

## 它做什么

Agent 要替人花钱，现在只有两种办法：把钱全预存给它，或者由平台在后台给它定一个上限。明码分是第三种：先用后付，花多少由它自己的还款记录决定。

```
主人押金 → 发卡 → Agent 拿到额度
        ↓
Agent 刷卡买服务 → 商户当场到账（让出 1% 手续费给出资人），欠款记在资金池
        ↓
按期还款 → 写入行为账本 → 分数上升 → 额度变高、服务变便宜 → 再刷卡
        ↓（不还）
清算押金 → 分数下降、额度砍半、7 天冷却
```

一次刷卡是一笔交易：商户合约读分报价，资金池读行为账本、调评分模型、定额度、付款给商户、记下欠款。这条路径上没有服务器，也没有预言机。

## 为什么需要押金

链上没有身份，也没有追偿，只有地址。Agent 刷完卡跑掉，出资人拿什么兜底？押金就是答案，而且它同时干了四件事。

**1. 额度是押金的函数，亏损有上限。** `额度 = 押金 × 分数 ÷ 1000`，分数最高 1,000，所以今天算出来的额度不会超过押金。超过押金的部分要先证明「满 7 天 + 满 3 期 + 零违约」，测试网上等不到。一笔坏账最多吞掉那一份押金，不会穿透到资金池里别人的存款。

**2. 违约时有东西可以没收。** 逾期未还，任何人都能调 `liquidate`：押金划给资金池，那笔本金从 `outstanding` 里划掉，行为账本记一次违约。没有押金，这一步没有可执行的资产，违约成本就是零。

**3. 押金本身是评分卡的一个因子。** 100 分里的「押金规模」（f1）：押 100,000 USD 得 56 分，押 340,000 USD 得 94 分。它让「多押一点」能把额度上限抬起来，但不是「多押就多得分」——上限只有 100 分。

**4. 押金挡住刷分。** 一次便宜的借还就能拿到大部分还款历史分（288 → 806 分），所以真正的闸门是：额度不超过押金、违约终身减半、满一年才给的 150 分历史长度分。没有押金，这三道闸门都不成立。

押金不是预付款，也不是手续费：它留在 Agent 地址上，由 Agent 签名授权资金池按合约规则支取；刷卡时锁定，按时还清原路退回（`CollateralReturned`），逾期才被清算。出资人的收入来自每笔刷卡 1% 的手续费，不从押金里扣。

## 为什么上链，为什么是 Monad

- **上链**：分数直接动钱（额度、价格），所以算分的规则不能由某一方在后台改。模型是一份公开合约，任何人、任何合约都能免费重算；资金池订阅哪个模型写死在合约里，模型本身要登记并接受任何人发起的随机抽检，对不上就永久冻结。
- **Monad**：信用账本每一期要给每个 Agent 写一条记录。Monad 按存储页计费（MIP-8，一页 128 个槽位，读过第一个，其余近乎免费），把账户按顺序排进页里，一万户一笔交易更新完。测试网节点估算（2026-11-21）：页式一万户约 93 万 gas；普通布局 300 户约 340 万 gas，一万户约 1.12 亿 gas，超过单笔 3,000 万上限。同一份合约在以太坊计价的本地链上，每户只差 4 倍。

## 目录

```
contracts/     Foundry 工程：src 是合约，test 是 33 个测试
artifacts/     编译产物（abi + bytecode），已入库，部署只需要 Node
scripts/       deploy / seed / bench / status
deployments/   部署后生成的地址文件；demo-keys.*.json 是演示 Agent 的私钥，不入库
web/           前端（Vite + React + viem），构建结果是纯静态站点
```

## 合约

| 合约 | 作用 |
|---|---|
| `ScoreCard` | 五因子评分卡，主模型。`score(f)` 给分，`explain(f)` 给出五项各得多少分 |
| `RiskModel` | 385 个参数的神经网络，第二意见 |
| `ModelRegistry` | 模型登记与随机抽检，抽检失败永久冻结 |
| `BehaviorBook` | 行为账本，只有资金池能写，模型的十个特征全部来自这里 |
| `CreditPool` | 资金池：`swipe` 刷卡、`repay` 还款并退押金、`liquidate` 清算 |
| `AgentCard` | 主人给 Agent 发卡并划拨押金 |
| `CreditShop` | 一个按分数定价的付费服务：250 分以下拒绝，600 分及以上八折 |
| `OpenScoreLens` | 只读聚合，前端一次调用取回整页数据 |
| `DecoyPool` + `ScoreCardAlt` | 抽检演示用：一个订阅了被篡改模型的资金池 |
| `Bench` | 一万户账本的两种写法，执行 gas 在合约内部用 `gasleft()` 自测 |
| `MockUSD` | 测试稳定币，任何人可铸造。界面与源码统一写作 USD；已部署的实例（`0xceaa…c14`，2026-11-21）是改名之前部署的，链上 `symbol()` 仍返回当时的旧字符串，下一次部署才会同步，前端不读这个字段 |

## 已部署（Monad 测试网，链 ID 10143）

| 合约 | 地址 |
|---|---|
| 资金池 CreditPool | [0x13da…776e](https://testnet.monadscan.com/address/0x13da2e62b64a67c96f0860b2a2a30e37bdaa776e) |
| 只读聚合 Lens | [0x4f7d…79ee](https://testnet.monadscan.com/address/0x4f7d466a52273ae0449eb5f23fb18c711abf79ee) |
| 发卡 AgentCard | [0xc790…0ae9](https://testnet.monadscan.com/address/0xc7906d8759db3d8ec18c9071988bebac2d7f0ae9) |
| 商户 CreditShop | [0x065c…2abd](https://testnet.monadscan.com/address/0x065c3a3956e97a63aefb31d6449570ed21e2aabd) |
| 模型注册表 ModelRegistry | [0x1216…2d27](https://testnet.monadscan.com/address/0x1216e93c47dd8a11a05519ad6b65bfe2c7382d27) |
| 评分卡 ScoreCard | [0x0bcf…6aff](https://testnet.monadscan.com/address/0x0bcf08544c511527f0b4bad448ca1d23b8666aff) |
| 第二意见 RiskModel | [0x1f32…0e29](https://testnet.monadscan.com/address/0x1f32d70cec3089c60afb18586b266012b9b60e29) |
| 行为账本 BehaviorBook | [0x1c39…5ab6](https://testnet.monadscan.com/address/0x1c39e4985c3797d50561969838357a62f4155ab6) |
| 账本对照 Bench | [0x2be4…24bb](https://testnet.monadscan.com/address/0x2be4e7eb08eb43f122a61f01742c47860ee524bb) |

完整地址、部署者与两次月结交易在 `deployments/10143.json`。公网演示：<https://openscore.angelonelog.com/>（观众入口 `/wallet.html`）。

## 技术栈

Solidity 与 Foundry（合约与 33 个测试）；Vite、React 18、viem（前端直连 RPC，读链不经过后端）；Node 24 与 SQLite（观众账号服务，GitHub OAuth 授权码 + PKCE）；静态站点托管在 nginx，Cloudflare 前置。

## 运行

需要 Node 20.12 以上。

```bash
npm install
cp .env.example .env          # 填 PRIVATE_KEY：一个只放测试币的钱包

node scripts/deploy.mjs       # 部署并自动核对，地址写入 deployments/ 和 web/src/deployments.json
node scripts/seed.mjs         # 铺三个 Agent：守信的刺猬、赖账的狐狸、害羞的松鼠
node scripts/bench.mjs --size mini          # 账本对照：先只看估算
node scripts/bench.mjs --size mini --yes    # 确认后发送
node scripts/status.mjs       # 随时查看链上状态，不花钱
```

三个写链的脚本都可以中断后重跑，会从断点继续。Monad 按 gas 上限扣费，脚本把每笔上限设为估算值加一小段余量。

测试币预算（102 gwei）：

| 步骤 | 约需 MON |
|---|---|
| 部署 | 2.3–3 |
| 铺数据（手续费约 0.5，另给三个 Agent 共 1.3 作 gas） | 1.8 |
| 账本对照 mini（2,000 户对 100 户） | 1.3 |
| 账本对照 half（5,000 对 300）/ mid（10,000 对 300）/ full（10,000 对 1,000） | 3.5 / 5.8 / 8.6 |

### 前端

```bash
cd web
npm install
npm run dev        # 本地开发
npm run build      # 产出 web/dist，纯静态
```

`web/dist` 可以直接托管：拖进 Netlify Drop，或 `npx vercel --prod`，或推到 GitHub Pages。合约地址在构建时写入，所以**先部署合约，再构建前端**；重新部署合约后要重新构建。

从首页点击「开始演示」，依次进入信用试算、刷卡还款、模型抽检和万户月结。首页和最后一页默认展示扫码登录领卡的二维码，也可切换为扫码测分。页脚的「投屏模式」可放大分数与交易回执。

观众可以直接试算和查看链上数据。现场操作前，请在同源的 `/admin.html` 后台准备测试钱包。旧入口 `/?admin` 会跳转到后台。

1. 粘贴操作钱包的测试私钥（或连接浏览器钱包），用来发卡、清算、抽检、月结。
2. 把 `deployments/demo-keys.10143.json` 的全部内容粘进去，导入脚本铺好的三个 Agent。

私钥只存在浏览器本地存储里。

### 观众登录与三档授信

`wallet.html` 是观众入口，以游客为默认路径，GitHub 登录是可选的「换设备找回」。头像不请求第三方图床：48 张 DiceBear Notionists（CC0）放在 `web/public/avatars/`，按档案派生，见该目录 `README.txt`。

登录页只说明体验前需要知道的事（不用充值、不用连钱包、不留痕迹），不再展开 OAuth 授权说明。进入后按运行场景分幕推进：认领身份 → 核对授信 → 刷卡买服务 → 按时还清 → 结果，没有步骤条。刷卡一幕把商户报价、账本算分、额度校验、到账逐条放出来；还款一幕把记账、重算分数、额度与报价变化逐条放出来。结果页可以把二维码递给旁边的人再领一张。

新的模拟身份、卡片、押金状态和账单只在当前页面内存中维护，刷新、关闭页面或退出后清除；有卡时退出需要二次确认。旧版留存的卡或账号上次的卡可显式载入，之后的操作只更新内存副本。三档可换一批重抽，核对额度并签发后才绑定模拟档案。清账后可重新试配，保留卡号和最近八条记录。

账号服务使用 Node 24 和 SQLite，以 GitHub 提供的数字 ID 核验登录身份，并兼容旧版账号卡记录。OAuth App 的 Homepage URL 为 `https://openscore.angelonelog.com/`，Authorization callback URL 为 `https://openscore.angelonelog.com/api/audience/callback`。管理员可在 `/settings.html` 使用独立密钥登录并保存 OAuth 凭据，即时生效。Secret 加密存储且不会回显。管理密钥摘要与加密密钥由服务的受限运行环境提供。尚未通过网页配置时，服务通过运行环境接收 `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET`；生产服务读取受限文件 `/etc/openscore-audience/oauth.env`，变更后重启 `openscore-audience.service`。缺少任一配置时页面如实显示仅可游客体验。授权码通过后端交换；前端不接触 GitHub 访问令牌。运行 `node --test services/audience/server.test.mjs` 可检查回调、绑定和账单隔离。

### 本地跑一遍（可选，需要 Foundry）

```bash
anvil --block-time 1
RPC_URL=http://127.0.0.1:8545 node scripts/deploy.mjs
RPC_URL=http://127.0.0.1:8545 node scripts/seed.mjs
cd contracts && forge test      # 33 个测试，不依赖 forge-std
```

改了合约之后：`forge build`，再回到根目录 `node scripts/build-artifacts.mjs`。

## 预期数字

押金统一按 100,000 USD 报分，服务标价 10,000 USD。

| 状态 | 分数 | 额度 | 服务价 |
|---|---|---|---|
| 新卡，没有任何记录 | 288 | 28,800 | 10,000 |
| 一次刷卡并按期还清 | 806 | 80,600 | 8,000 |
| 之后再刷卡不还，被清算 | 536 | 26,800（已砍半） | 10,000 |

## 评分卡

五个因子，满分取自公开的信用评分类别权重 35/30/15/10/10；因子内每一档的分值用公开的信用卡还款数据（pycaret 仓库的 credit 数据集，24,000 行）拟合，并强制单调：任何一项变差，分数不会变高。区分能力 AUC 0.72。"押金规模"替换了链上没有对应物的"信用组合"。这是结构上的参照，不是任何机构的认证。

## 从人的还款记录，到 Agent 的还款记录

评分卡不是凭空写的。它先在人的信用卡还款数据上学出「哪种还款行为该得多少分」，再把同一套取值公式搬到链上。四步，每一步都能在本仓库里核对。

**1. 只保留链上能看见的字段。** 数据是公开的 UCI 信用卡还款集（30,000 行，其中 24,000 行用于拟合）。原始 23 列只留 10 个代理字段，其余（性别、教育、婚姻、逐月账单明细）全部丢掉，因为没有任何合约能观察到它们。

**2. 同一个公式，从人的账单、从 Agent 的账本各取一次值。**

| 特征 | 链上含义 | 人数据里的取法 | Agent 账本里的取法 |
|---|---|---|---|
| f0 地址年龄 | 天 | `AGE × 30` | `(now - firstSeen) / 1 days` |
| f1 押金 | 百 USD | `LIMIT_BAL / 100` | `collateral / 100e18` |
| f2 最长拖欠 | 期 | `max(PAY_0..PAY_6)` | 滚动窗口内最大 delay |
| f3 逾期次数 | 次 | `count(PAY_x >= 1)` | 窗口内 `delay >= 1` 的期数 |
| f4 累计还款比例 | ‰ | `sum(PAY_AMT) / sum(BILL_AMT)` | `paidTotal / owedTotal` |
| f5 当前使用率 | ‰ | `BILL_AMT1 / LIMIT_BAL` | 最新一期 `owed / 额度` |
| f6 零还款次数 | 次 | `count(PAY_AMT_x == 0)` | 窗口内 `paid == 0 && owed > 0` 的期数 |
| f7 最近一期还款比例 | ‰ | `PAY_AMT1 / BILL_AMT1` | 最新一期 `paid / owed` |
| f8 敞口变化 | ‰ | `(BILL_AMT1 - BILL_AMT6) / LIMIT_BAL` | `(最新 owed - 6 期前 owed) / 额度` |
| f9 最高使用率 | ‰ | `max(BILL_AMT_x / LIMIT_BAL)` | 窗口内最高利用率 |

**3. 分箱、给分、强制单调。** 在换算后的 24,000 行上按箱统计违约率，把每一档换成分数，再强制相邻档不递减，于是每个特征变成合约里一张 `if (x <= edge) return points` 的表（`contracts/src/ScoreCard.sol` 的 `_f2`…`_f9`）。区分能力 AUC 0.7234。

**4. 同一张表，两边都能算。** 人的一行记录和 Agent 的一期结算落进同一个 10 维向量，走过同一张表。

### 过程示例

一行人的记录：6 期，额度 120,000，账单 48,000 / 52,000 / 61,000 / 84,000 / 72,000 / 60,000，还款 48,000 / 30,000 / 40,000 / 20,000 / 15,000 / 10,000，最近一期状态 -1，第 3 期逾期 2 期，年龄 34。

```
f = [1020, 1200, 2, 1, 432, 400, 0, 1000, -100, 700]
还款历史 212 + 欠款与使用率 236 + 历史长度 150 + 新增敞口 100 + 押金 56 = 754 分
```

同一个 Agent 在测试网上结算的一期：押金 100,000 USD，刷 10,000 买服务，按时还清。

```
f = [0, 1000, 0, 0, 1000, 100, 0, 1000, 0, 100]
349 + 301 + 0 + 100 + 56 = 806 分（额度 80,600，服务打八折）
```

还没有任何记录时是 288 分（还款历史 0 + 欠款 132 + 时长 0 + 新增 100 + 押金 56）。

差别只在数据来源：人那边是账单，Agent 这边是资金池结算时自己写进行为账本的四个数（应还、实还、逾期期数、额度）。换数据源只需重训表，不用改流程；今天 Agent 还没有真实的违约样本，表仍是从人的行为学来的。

## 已知的不足

- 资金池不收利息，出资人的收入只有每笔刷卡 1% 的手续费，而且目前只是留在池子里，没有按份额分配。
- 评分卡的表是在人的还款数据上拟合的（上一节把一条人记录和一条 Agent 记录并排算过）；Agent 的违约样本要等链上攒够才能重训，届时表会换、分数会整体平移。
- 一次便宜的借还就能拿到大部分还款历史分。挡住刷分的是额度不超过押金、违约终身减半，以及要满一年才给的 150 分。
- 超过押金的额度规则已写进合约（满 7 天、满 3 期、零违约），测试网上等不到，今天没有演示。
- 违约只记在 Agent 地址上，还没有记到主人名下。
- 行为账本本身还是普通布局，页式布局由 `Bench` 单独演示。
- 人的信用分（征信机构接口、链上钱包评分、网页证明）是待接入的上游接口，本项目没有接。
