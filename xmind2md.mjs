#!/usr/bin/env node
// xmind2md.mjs — 零依赖 .xmind → Markdown 大纲转换器 (Node >= 18)
// 用法:
//   node xmind2md.mjs 我的导图.xmind            # 大纲打印到 stdout
//   node xmind2md.mjs 我的导图.xmind 输出.md     # 同时写入文件
//   node xmind2md.mjs --self-test               # 内置自测(合成 zip 样例验证解析)
//
// 支持:
//   - XMind 2020+ : zip 内 content.json(多画布/备注/无标题节点)
//   - XMind 8     : zip 内 content.xml(尽力解析 主题+标题 结构)
//   - zip 存储(store)与 deflate 压缩两种条目
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

/* ---------------- 极简 zip 读取器 ---------------- */

function findEOCD(buf) {
  const sig = 0x06054b50
  const min = Math.max(0, buf.length - 65557)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === sig) {
      return {
        count: buf.readUInt16LE(i + 10),
        cdOffset: buf.readUInt32LE(i + 16),
      }
    }
  }
  throw new Error('不是有效的 zip/xmind 文件(找不到中央目录记录)')
}

function readCentralDir(buf, eocd) {
  const entries = []
  let off = eocd.cdOffset
  const sig = 0x02014b50
  for (let i = 0; i < eocd.count; i++) {
    if (buf.readUInt32LE(off) !== sig) throw new Error('zip 中央目录解析失败')
    const flags = buf.readUInt16LE(off + 8)
    const method = buf.readUInt16LE(off + 10)
    const compSize = buf.readUInt32LE(off + 20)
    const nameLen = buf.readUInt16LE(off + 28)
    const extraLen = buf.readUInt16LE(off + 30)
    const commentLen = buf.readUInt16LE(off + 32)
    const localOff = buf.readUInt32LE(off + 42)
    let name = buf.toString('utf8', off + 46, off + 46 + nameLen)
    if (!(flags & 0x800)) {
      // 无 UTF-8 标志:按 GBK 解码文件名再回退
      try { name = decodeGbk(buf, off + 46, nameLen) || name } catch (err) {}
    }
    entries.push({ name, method, compSize, localOff })
    off += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

// 极简 GBK 解码(仅当文件名未标 UTF-8 时使用;内容条目名几乎都是 ASCII)
function decodeGbk(buf, start, len) {
  const textDecoder = globalThis.TextDecoder
  if (!textDecoder) return null
  try { return new textDecoder('gbk').decode(buf.subarray(start, start + len)) } catch (err) { return null }
}

function readEntryData(buf, entry) {
  const sig = 0x04034b50
  const lo = entry.localOff
  if (buf.readUInt32LE(lo) !== sig) throw new Error('zip 本地文件头缺失: ' + entry.name)
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data
  if (entry.method === 8) return zlib.inflateRawSync(data)
  throw new Error('不支持的压缩方式: ' + entry.method + ' (' + entry.name + ')')
}

function listZip(buf) {
  return readCentralDir(buf, findEOCD(buf))
}

function readZipText(buf, name) {
  for (const en of listZip(buf)) {
    if (en.name === name || en.name.endsWith('/' + name)) {
      return readEntryData(buf, en).toString('utf8')
    }
  }
  return null
}

/* ---------------- XMind 内容 → Markdown ---------------- */

function notesText(topic) {
  try {
    const n = topic && topic.notes
    if (!n) return ''
    const p = n.plain
    if (p && typeof p.content === 'string') return p.content.trim()
    if (typeof n.content === 'string') return n.content.trim()
    if (typeof n === 'string') return n.trim()
  } catch (err) {}
  return ''
}

function childTopics(topic) {
  const c = topic && topic.children
  if (c && Array.isArray(c.attached)) return c.attached
  if (Array.isArray(c)) return c
  return []
}

function cleanTitle(t) {
  return String(t || '').replace(/\s+/g, ' ').trim()
}

// JSON 版(content.json):sheets[] → rootTopic 树
function jsonSheetsToMd(content) {
  const sheets = Array.isArray(content) ? content : (content && Array.isArray(content.sheets) ? content.sheets : null)
  if (!sheets) return null
  const out = []
  const multi = sheets.length > 1
  sheets.forEach((sheet, si) => {
    if (!sheet || !sheet.rootTopic) return
    if (si > 0) out.push('')
    const root = sheet.rootTopic
    const rootTitle = cleanTitle(root.title) || '未命名主题'
    const sheetTitle = cleanTitle(sheet.title)
    const kids = childTopics(root)
    if (multi) {
      out.push('# ' + (sheetTitle || rootTitle))
      for (const k of kids) pushTopic(out, k, 1)
    } else {
      out.push('# ' + rootTitle)
      const note = notesText(root)
      if (note) out.push('> ' + note.replace(/\n/g, '\n> '))
      for (const k of kids) pushTopic(out, k, 1)
    }
  })
  return out.length ? out.join('\n') : null
}

function pushTopic(out, topic, depth) {
  if (!topic || typeof topic !== 'object') return
  const title = cleanTitle(topic.title)
  const note = notesText(topic)
  const kids = childTopics(topic)
  const indent = '  '.repeat(depth)
  if (title || kids.length || note) {
    out.push(indent + '- ' + (title || '(空节点)'))
    if (note) out.push(indent + '    ' + note.replace(/\n/g, '\n' + indent + '    '))
  }
  for (const k of kids) pushTopic(out, k, depth + 1)
}

/* ---------------- XMind 8 (content.xml) 尽力支持 ---------------- */

function parseXmlTree(xml) {
  const root = []
  const stack = []
  let i = 0
  const len = xml.length
  while (i < len) {
    const lt = xml.indexOf('<', i)
    if (lt === -1) break
    if (lt > i) {
      const text = xml.slice(i, lt)
      const parent = stack[stack.length - 1]
      if (parent && text.trim()) parent.text = (parent.text || '') + text
      i = lt
      continue
    }
    const gt = xml.indexOf('>', i)
    if (gt === -1) break
    let inner = xml.slice(i + 1, gt)
    i = gt + 1
    if (inner.startsWith('!--')) continue
    if (inner.startsWith('?')) continue
    if (inner.startsWith('/')) {
      stack.pop()
      continue
    }
    const selfClose = inner.endsWith('/')
    if (selfClose) inner = inner.slice(0, -1)
    const sp = inner.search(/[\s/>]/)
    const tag = sp === -1 ? inner : inner.slice(0, sp)
    if (!tag) continue
    const node = { tag, text: '', children: [] }
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else root.push(node)
    if (!selfClose) stack.push(node)
  }
  return root
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

// 把 content.xml 的元素树转成 topic 树:取 tag=topic 的节点,标题来自其
// <title> 子元素(缺省回退到自身直接文本);<children>/<topics> 等包装节点
// 向下穿透递归,遇到嵌套 topic 则作为子节点并各自递归。
function xmlTopicTree(node) {
  let title = ''
  const kids = []
  const scan = (n) => {
    for (const c of n.children || []) {
      if (c.tag === 'title') title += c.text || ''
      else if (c.tag === 'topic') kids.push(xmlTopicTree(c))
      else scan(c)
    }
  }
  scan(node)
  if (!title) title = node.text || ''
  return { title: decodeEntities(cleanTitle(title)), kids }
}

function xmlSheetsToMd(xml) {
  const nodes = parseXmlTree(xml)
  const sheets = []
  function walk(ns) {
    for (const n of ns) {
      if (n.tag === 'sheet') sheets.push(n)
      if (!sheets.length && n.tag === 'topic') sheets.push({ root: n })
      walk(n.children)
    }
  }
  walk(nodes)
  const out = []
  sheets.forEach((sheet, si) => {
    const topicNode = sheet.tag === 'sheet' ? (sheet.children.find((c) => c.tag === 'topic') || null) : sheet.root
    if (!topicNode) return
    if (si > 0) out.push('')
    const tree = xmlTopicTree(topicNode)
    out.push('# ' + (tree.title || '未命名主题'))
    for (const k of tree.kids) pushXmlTopic(out, k, 1)
  })
  return out.length ? out.join('\n') : null
}

function pushXmlTopic(out, topic, depth) {
  const indent = '  '.repeat(depth)
  const title = topic.title || '(空节点)'
  out.push(indent + '- ' + title)
  for (const k of topic.kids) pushXmlTopic(out, k, depth + 1)
}

/* ---------------- 入口 ---------------- */

export function convertXmind(buf) {
  let content = readZipText(buf, 'content.json')
  if (content != null) {
    try {
      const parsed = JSON.parse(content)
      const md = jsonSheetsToMd(parsed)
      if (md != null) return { format: 'json', markdown: md }
    } catch (err) {
      throw new Error('content.json 解析失败: ' + err.message)
    }
  }
  content = readZipText(buf, 'content.xml')
  if (content != null) {
    const md = xmlSheetsToMd(content)
    if (md != null) return { format: 'xml', markdown: md }
  }
  throw new Error('xmind 内未找到 content.json / content.xml,可能不是标准 XMind 文件')
}

export function main(argv) {
  const args = argv.slice(2)
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log([
      'xmind2md — 把 .xmind 转成 Markdown 大纲(零依赖)',
      '',
      '用法:',
      '  node xmind2md.mjs 文件.xmind                # 打印到 stdout',
      '  node xmind2md.mjs 文件.xmind 输出.md         # 同时写入文件',
      '  node xmind2md.mjs --self-test                # 内置自测',
    ].join('\n'))
    return 0
  }
  if (args[0] === '--self-test') return selfTest()
  const input = args[0]
  let buf
  try {
    buf = fs.readFileSync(input)
  } catch (err) {
    console.error('无法读取文件: ' + input + ' (' + err.message + ')')
    return 1
  }
  let result
  try {
    result = convertXmind(buf)
  } catch (err) {
    console.error('转换失败: ' + err.message)
    return 2
  }
  const out = result.markdown
  const output = args[1]
  if (output) {
    try {
      fs.writeFileSync(output, out, 'utf8')
      console.log('已写入: ' + path.resolve(output) + '  (格式: ' + result.format + ')')
    } catch (err) {
      console.error('写入失败: ' + err.message)
      return 3
    }
  } else {
    console.log(out)
  }
  return 0
}

/* ---------------- 自测(合成 zip 样例,无需真实 XMind) ---------------- */

function zipBuild(entries) {
  // entries: [{name, data(Buffer), method:0|8}]
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8')
    const method = e.method === 0 ? 0 : 8
    const comp = method === 0 ? raw : zlib.deflateRawSync(raw)
    const nameBuf = Buffer.from(e.name, 'utf8')
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(0x14, 4)
    lh.writeUInt16LE(0x800, 6) // UTF-8 标志
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
    locals.push({ header: lh, name: nameBuf, data: comp })
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(0x14, 4)
    ch.writeUInt16LE(0x14, 6)
    ch.writeUInt16LE(0x800, 8)
    ch.writeUInt16LE(method, 10)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(raw.length, 24)
    ch.writeUInt16LE(nameBuf.length, 28)
    ch.writeUInt32LE(offset, 42)
    centrals.push({ header: ch, name: nameBuf, data: comp })
    offset += 30 + nameBuf.length + comp.length
  }
  const body = []
  let localStart = 0
  for (let i = 0; i < locals.length; i++) {
    const l = locals[i]
    const full = Buffer.concat([l.header, l.name, l.data])
    body.push(full)
    if (centrals[i].header.readUInt32LE(42) !== localStart) {
      centrals[i].header.writeUInt32LE(localStart, 42)
    }
    localStart += full.length
  }
  const cdBody = Buffer.concat(centrals.map((c) => Buffer.concat([c.header, c.name])))
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBody.length, 12)
  eocd.writeUInt32LE(localStart, 16)
  return Buffer.concat([...body, cdBody, eocd])
}

function sampleContentJson() {
  return JSON.stringify({
    sheets: [{
      id: 's1',
      title: '画布一',
      rootTopic: {
        id: 'r1', title: '项目规划',
        notes: { plain: { content: '这是一条根节点备注' } },
        children: { attached: [
          { id: 'a1', title: '目标', children: { attached: [
            { id: 'b1', title: '三个月上线' },
            { id: 'b2', title: '', notes: { plain: { content: '空标题节点带备注' } } },
          ] } },
          { id: 'a2', title: '风险', children: { attached: [{ id: 'c1', title: '依赖第三方' }] } },
        ] },
      },
    }],
  })
}

function sampleContentXml() {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0">',
    '<sheet id="s1"><title>画布</title>',
    '<topic id="r1"><title>旧版主题</title>',
    '<children><topics>',
    '<topic id="a1"><title>分支一</title><children><topics><topic id="b1"><title>子项 &amp; 说明</title></topic></topics></children></topic>',
    '</topics></children></topic>',
    '</sheet></xmap-content>',
  ].join('')
}

function assert(cond, msg) {
  if (!cond) throw new Error('自测失败: ' + msg)
}

export function selfTest() {
  const jsonTxt = sampleContentJson()
  const xmlTxt = sampleContentXml()

  const cases = [
    ['json+store', zipBuild([{ name: 'content.json', data: jsonTxt, method: 0 }]), ['# 项目规划', '三个月上线']],
    ['json+deflate', zipBuild([{ name: 'content.json', data: jsonTxt, method: 8 }]), ['# 项目规划', '三个月上线']],
    ['xml+deflate', zipBuild([{ name: 'content.xml', data: xmlTxt, method: 8 }]), ['# 旧版主题', '分支一', '子项 & 说明']],
  ]
  for (const [label, buf, expects] of cases) {
    const r = convertXmind(buf)
    const md = r.markdown
    assert(r.format === 'json' || r.format === 'xml', label + ' 格式标记')
    for (const e of expects) assert(md.includes(e), label + ' 应包含: ' + e)
  }
  // 备注与空节点
  const md1 = convertXmind(cases[0][1]).markdown
  assert(md1.includes('> 这是一条根节点备注') || md1.includes('这是一条根节点备注'), '根节点备注')
  assert(md1.includes('(空节点)'), '空标题节点仍输出')
  assert(convertXmind(cases[2][1]).markdown.includes('子项 & 说明'), 'XML 实体解码')
  console.log('self-test PASS ✓ (json/store, json/deflate, xml 三种样例全部通过)')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv)
}

import { pathToFileURL } from 'node:url'
