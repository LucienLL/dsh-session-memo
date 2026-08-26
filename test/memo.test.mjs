/**
 * dsh-session-memo 纯逻辑单测（node:test 主模块方式，勿用 node --test）。
 * 覆盖：git porcelain 解析（正常/无远程/落后/冲突/游离）、lastCommit、remote、
 * package.json、semver 对比、npm 发布推断。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseGitStatus,
  parseBranchLine,
  parseLastCommit,
  parseRemote,
  parsePackageJson,
  compareSemver,
  compareVersion,
} from '../lib/memo.js'

test('parseGitStatus: 正常分支 + ahead/behind + dirty/untracked', () => {
  const out = [
    '## main...origin/main [ahead 1, behind 2]',
    ' M lib/index.js',
    'M  lib/memo.js',
    '?? test/new.test.mjs',
    'R  old.js -> new.js',
  ].join('\n')
  const r = parseGitStatus(out)
  assert.equal(r.branch, 'main')
  assert.equal(r.detached, false)
  assert.equal(r.upstream, 'origin/main')
  assert.equal(r.ahead, 1)
  assert.equal(r.behind, 2)
  assert.equal(r.dirty, 4) // 4 条变更行
  assert.equal(r.conflicts, 0)
  assert.equal(r.untracked, 1)
})

test('parseGitStatus: 无上游（本地分支）', () => {
  const r = parseGitStatus('## feature-xyz\n?? a.txt')
  assert.equal(r.branch, 'feature-xyz')
  assert.equal(r.upstream, null)
  assert.equal(r.ahead, 0)
  assert.equal(r.behind, 0)
  assert.equal(r.untracked, 1)
})

test('parseGitStatus: 冲突行计数', () => {
  const out = ['## main...origin/main', 'UU lib/a.js', 'AA lib/b.js', ' M lib/c.js'].join('\n')
  const r = parseGitStatus(out)
  assert.equal(r.conflicts, 2)
  assert.equal(r.dirty, 3)
})

test('parseGitStatus: 游离 HEAD', () => {
  const r = parseGitStatus('## HEAD (no branch)')
  assert.equal(r.branch, null)
  assert.equal(r.detached, true)
})

test('parseGitStatus: 空输出/垃圾输入容错', () => {
  const r1 = parseGitStatus('')
  assert.equal(r1.branch, null)
  assert.equal(r1.dirty, 0)
  const r2 = parseGitStatus(null)
  assert.equal(r2.dirty, 0)
  const r3 = parseGitStatus('not a porcelain line')
  assert.equal(r3.branch, null) // 不以 ## 开头 → 无法解析，不抛
  assert.equal(r3.dirty, 0)
})

test('parseBranchLine: 分支名含点', () => {
  const r = parseBranchLine('## v1.2.x...origin/v1.2.x [behind 3]')
  assert.equal(r.branch, 'v1.2.x')
  assert.equal(r.upstream, 'origin/v1.2.x')
  assert.equal(r.behind, 3)
})

test('parseLastCommit: 常规/空/三列时间戳', () => {
  assert.deepEqual(parseLastCommit('a1b2c3d 2026-02-14\n'), { hash: 'a1b2c3d', date: '2026-02-14', ts: 0 })
  assert.deepEqual(parseLastCommit('a1b2c3d\n'), { hash: 'a1b2c3d', date: null, ts: 0 })
  assert.deepEqual(parseLastCommit('a1b2c3d 2026-02-14 1787681438\n'), { hash: 'a1b2c3d', date: '2026-02-14', ts: 1787681438 })
  assert.equal(parseLastCommit(''), null)
})

test('parseRemote: 常规/空', () => {
  const out = 'origin\thttps://github.com/LucienLL/dsh-session-memo.git (fetch)\norigin\thttps://github.com/LucienLL/dsh-session-memo.git (push)'
  assert.deepEqual(parseRemote(out), { name: 'origin', url: 'https://github.com/LucienLL/dsh-session-memo.git' })
  assert.equal(parseRemote(''), null)
})

test('parsePackageJson: 正常/坏 JSON/缺字段', () => {
  assert.deepEqual(parsePackageJson('{"name":"dsh-session-memo","version":"0.1.0"}'), {
    ok: true, name: 'dsh-session-memo', version: '0.1.0',
  })
  const bad = parsePackageJson('{oops')
  assert.equal(bad.ok, false)
  assert.equal(bad.reason, 'parse-error')
  const missing = parsePackageJson('{"description":"x"}')
  assert.equal(missing.ok, true)
  assert.equal(missing.name, null)
  assert.equal(missing.version, null)
})

test('compareSemver: 基本比较', () => {
  assert.equal(compareSemver('0.1.0', '0.1.3'), -1)
  assert.equal(compareSemver('0.1.3', '0.1.0'), 1)
  assert.equal(compareSemver('1.0.0', '0.9.9'), 1)
  assert.equal(compareSemver('1.2.3', '1.2.3'), 0)
  assert.equal(compareSemver('1.2', '1.2.0'), 0)
  assert.equal(compareSemver('1.2.3', '1.2.3-beta.1'), 1) // prerelease 低于正式版
  assert.equal(compareSemver('1.2.3-alpha', '1.2.3-beta'), 0) // 同数字同 pre 存在 → 宽松处理为相等
})

test('compareVersion: behind/published 推断', () => {
  assert.deepEqual(compareVersion('0.1.0', '0.1.3'), { behind: true, published: true })
  assert.deepEqual(compareVersion('0.1.3', '0.1.3'), { behind: false, published: true })
  assert.deepEqual(compareVersion('0.2.0', '0.1.3'), { behind: false, published: false }) // 超前 → 未发布
  assert.deepEqual(compareVersion(null, '0.1.3'), { behind: false, published: false })
  assert.deepEqual(compareVersion('0.1.0', null), { behind: false, published: false })
})

test('parseGitStatus: \r\n 行尾（Windows）', () => {
  const out = '## main...origin/main [ahead 0, behind 2]\r\n M lib/a.js\r\n'
  const r = parseGitStatus(out)
  assert.equal(r.behind, 2)
  assert.equal(r.dirty, 1)
})
