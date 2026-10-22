/**
 * 契约回归测试：客户端 bundle 的 exports.inject 必须是 Cordis 服务名数组，
 * 不能是 NPM 包名（写错会导致 web boot 永久 pending）。
 */
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let captured = null
const sandbox = {
  window: {
    __ModuleLoader__: {
      load({ factory }) {
        captured = factory((name) => ({ name }))
      },
    },
  },
}
vm.createContext(sandbox)
vm.runInContext(code, sandbox)

if (captured === null) throw new Error('bundle factory did not run')

const { inject, apply } = captured
if (!Array.isArray(inject)) throw new Error('inject must be an array')
for (const s of inject) {
  if (s.startsWith('@')) {
    throw new Error(`inject "${s}" looks like a package name; must be a service name`)
  }
}
const expected = ['slots', 'configForms']
for (const s of expected) {
  if (!inject.includes(s)) throw new Error(`inject must include "${s}"`)
}
if (typeof apply !== 'function') throw new Error('apply must be a function')

console.log('client-shape OK: inject =', JSON.stringify(inject))
