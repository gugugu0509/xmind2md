#!/usr/bin/env node
// make-sample.mjs — 生成一个 XMind 2020+ 格式的样例 .xmind(纯 Node,零依赖)
// 用法: node make-sample.mjs [输出路径]
import fs from 'node:fs'
import zlib from 'node:zlib'

function zipBuild(entries) {
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
    lh.writeUInt16LE(0x800, 6)
    lh.writeUInt16LE(method, 8)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(raw.length, 22)
    lh.writeUInt16LE(nameBuf.length, 26)
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
    locals.push({ header: lh, name: nameBuf, data: comp, ch })
    offset += 30 + nameBuf.length + comp.length
  }
  const body = []
  let start = 0
  for (const l of locals) {
    const full = Buffer.concat([l.header, l.name, l.data])
    body.push(full)
    l.ch.writeUInt32LE(start, 42)
    start += full.length
  }
  const cdBody = Buffer.concat(Array.from(locals, (l) => Buffer.concat([l.ch, l.name])))
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(cdBody.length, 12)
  eocd.writeUInt32LE(start, 16)
  return Buffer.concat([...body, cdBody, eocd])
}

const content = JSON.stringify({
  sheets: [{
    id: 'demo-sheet-1',
    title: '样例画布',
    rootTopic: {
      id: 'root-1',
      title: '新项目启动',
      notes: { plain: { content: '中心主题的备注' } },
      children: {
        attached: [
          { id: 'n1', title: '目标', children: { attached: [
            { id: 'n11', title: '两个月内上线' },
            { id: 'n12', title: '用户量破 1 万', notes: { plain: { content: '按周拆指标' } } },
          ] } },
          { id: 'n2', title: '分工', children: { attached: [
            { id: 'n21', title: '产品 / 设计' },
            { id: 'n22', title: '研发 / 测试' },
          ] } },
          { id: 'n3', title: '风险' },
        ],
      },
    },
  }],
})

const manifest = JSON.stringify({ 'file-entries': { 'content.json': {}, 'metadata.json': {} }, 'manifest-version': '2.0' })

const out = process.argv[2] || '样例导图.xmind'
fs.writeFileSync(out, zipBuild([
  { name: 'content.json', data: content, method: 8 },
  { name: 'manifest.json', data: manifest, method: 0 },
]))
console.log('已生成样例导图: ' + out)
