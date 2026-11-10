// 阶段 0 回归工具：在**非 Bun 运行时**（Node）下把插件宿主跑起来，并走一遍真实登录。
//
// 为什么需要它：iOS 没有 Bun（plugin_host/script/bun.rs 的 asset() 没有 ios 分支），
// 而宿主 JS 假设自己跑在 Bun 上（local-process.mjs 直接取 Bun[name]）。这个脚本证明
// 该假设可以只用一个「成员一被调用就抛错」的 Bun 空壳绕过 —— 宿主其余部分只用标准能力。
//
// 它同时把宿主侧的**对端契约**钉死成实测清单：
//   宿主 → 对端：script.http.open / script.http.read / script.http.close
//                （open 返回 {id,status,headers,url}；read 返回 {data: base64, done}；
//                  done 为真时宿主只关闭、不入队 ⇒ 最后一块必须 done:false 送完）
//                + store.get / store.list / store.update / store.ledger_* 与 script.proxy.resolve 的空桩
//   对端 → 宿主：init / ping / script.packages / script.settings / shutdown
//                + login.start / login.poll / login.callback / login.cancel / provider.info
//
// 用法：把 host/ 下的 .mjs 与一个插件目录（package.json + 入口）放好后
//   node tools/plugin-host-node/peer.mjs
// 预期：init 返回 provider 描述（id/capabilities/login_methods/默认模型），
//       login.start 返回 {flow, url, instructions, poll_interval_ms} —— 真码来自真提供方。

// 阶段 0 · 本地高保真原型：像 Rust 侧那样，用真实子进程 + stdio NDJSON 驱动宿主，
// 加载 nous-auth 插件并走一遍 device-code 登录。
//
// 目的：证明「宿主 JS + 插件」这条路本身是通的（不需要 Bun 的 iOS 形态只是换传输层），
// 并把我需要在 Worker 侧实现的宿主侧方法收敛成一份实测清单。
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOST = join(HERE, 'host', 'main.mjs')
const PLUGIN = join(HERE, 'packages', 'nous-auth')
const dataDir = mkdtempSync(join(tmpdir(), 'host0-'))

// 宿主假设自己跑在 Bun 上（local-process.mjs 直接取 Bun[name]）。iOS/Worker 上同样没有 Bun，
// 所以这里先注入一个「空壳」：成员一被真正调用就抛错，避免静默假装支持了本机进程能力。
const BUN_STUB = `globalThis.Bun ??= new Proxy({}, {
  get(_target, name) {
    if (name === 'version') return 'stub'
    return (..._args) => { throw new Error('Bun.' + String(name) + ' is unavailable in this runtime') }
  },
});
`
writeFileSync(join(HERE, 'bun-stub.mjs'), BUN_STUB)

const child = spawn(process.execPath, ['--import', pathToFileURL(join(HERE, 'bun-stub.mjs')).href, HOST], {
  stdio: ['pipe', 'pipe', 'pipe'],
  cwd: HERE,
})
let buffer = ''
let next = 1
const pending = new Map()
const open = new Map()

function frame(object) { child.stdin.write(JSON.stringify(object) + '\n') }
function call(method, params) {
  const id = next++
  frame({ id, method, params })
  return new Promise(resolve => pending.set(id, resolve))
}

const seen = new Set()
async function hostRequest(method, params) {
  seen.add(method)
  switch (method) {
    case 'store.get':
      // 登录流程需要一个「有 secret 且启用」的账号上下文；登录本身不需要真实凭证
      return { secret: {}, public: { enabled: true }, proxy: null }
    case 'store.list':
      return []
    case 'store.update':
    case 'store.ledger_put':
    case 'store.ledger_get':
      return null
    case 'script.proxy.resolve':
      return null
    case 'script.http.open': {
      const { id, url, method: verb = 'GET', headers = {}, body } = params
      const response = await fetch(url, {
        method: verb,
        headers,
        body: body ? Buffer.from(body, 'base64') : undefined,
        redirect: 'manual',
      })
      const bytes = Buffer.from(await response.arrayBuffer())
      open.set(id, { at: 0, bytes })
      // 形状对齐 fetch.mjs: head.id / head.status / head.headers / head.url
      return { id, status: response.status, headers: Object.fromEntries(response.headers), url }
    }
    case 'script.http.read': {
      const state = open.get(params.id)
      if (!state) throw new Error('unknown stream')
      // fetch.mjs:91 在 done 时只关闭、不入队 ⇒ 最后一块必须 done:false 送完，
      // 下一次 read 再以 done:true 收尾，否则响应体会少最后一截。
      if (state.at >= state.bytes.length) return { done: true, data: '' }
      const chunk = state.bytes.subarray(state.at, state.at + 65536)
      state.at += chunk.length
      return { done: false, data: chunk.toString('base64') }
    }
    case 'script.http.close':
      open.delete(params.id)
      return {}
    default:
      console.log(`  [未实现的宿主侧方法] ${method} ${JSON.stringify(params).slice(0, 160)}`)
      throw new Error(`unsupported: ${method}`)
  }
}

child.stdout.on('data', chunk => {
  buffer += chunk
  for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    if (!line.trim()) continue
    let parsed
    try { parsed = JSON.parse(line) } catch { console.log('  [非 JSON 行]', line.slice(0, 200)); continue }
    dispatch(parsed)
  }
})
child.stderr.on('data', chunk => process.stderr.write('[host stderr] ' + chunk))

function dispatch(message) {
  // 先判「宿主发来的请求」（带 method），再判「对我们调用的响应」。
  // 反之会撞号：宿主自己的 rpc id 也从 1 开始，与我方计数器重号，
  // 于是响应会被错配成请求、请求会被当响应 resolve 掉。
  if (message.method) {
    const { id, method, params } = message
    hostRequest(method, params)
      .then(result => frame({ id, result }))
      .catch(error => frame({ id, error: { code: 'unsupported', message: String(error?.message || error) } }))
    return
  }
  if (message.id && pending.has(message.id)) {
    const resolve = pending.get(message.id)
    pending.delete(message.id)
    resolve(message)
    return
  }
  // id 0 的推送：日志 / 启动进度 / 登录进度
  if (message.event) {
    const extra = message.params ?? {}
    console.log(`  [${message.event}] ${JSON.stringify(extra).slice(0, 260)}`)
  }
}

const say = (label, value) => console.log(`\n### ${label}\n${JSON.stringify(value, null, 2).slice(0, 1500)}`)

const main = async () => {
  say('init', await call('init', {
    packages: [{ id: 'nous-auth', directory: PLUGIN }],
    env: { data_dir: dataDir },
    dataDir,
  }))
  say('script.packages', await call('script.packages', {}))
  const started = await call('login.start', { provider: 'nous-portal', account: '' })
  say('login.start', started)
  const id = started?.result?.id ?? started?.result?.loginId ?? started?.result?.session
  if (id) {
    for (let attempt = 0; attempt < 3; attempt++) {
      say(`login.poll #${attempt + 1}`, await call('login.poll', { provider: 'nous-portal', account: '', id }))
    }
  }
  console.log('\n### 宿主主动调用的方法（本次实测清单）\n  ' + [...seen].sort().join('\n  '))
  child.kill()
  process.exit(0)
}

main().catch(error => { console.error('harness 失败:', error); child.kill(); process.exit(1) })
