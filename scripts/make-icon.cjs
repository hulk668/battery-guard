// 生成安装包 / 应用图标：build/icon.ico
//
// 项目里所有图标都是代码画出来的，不依赖任何图片素材或原生模块——
// 这里复用 electron/icon.cjs 的手写 PNG 编码器，画一张 256×256 电池图标，
// 再按 ICO 容器格式（直接内嵌 PNG，Windows Vista 起支持）打包成 .ico。
// 改配色或造型后跑 `npm run icon` 即可重新生成。
const fs = require('node:fs')
const path = require('node:path')
const { encodePng } = require('../electron/icon.cjs')

const S = 256
const FILL = [93, 202, 165]   // 高电量绿
const SHELL = [235, 237, 240] // 电池外壳

function drawBattery(size) {
  const px = Buffer.alloc(size * size * 4)
  const k = size / S // 按 256 基准等比缩放
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = a
  }
  const rect = (x0, y0, x1, y1, c, a = 255) => {
    for (let y = Math.round(y0 * k); y <= Math.round(y1 * k); y++) {
      for (let x = Math.round(x0 * k); x <= Math.round(x1 * k); x++) put(x, y, c, a)
    }
  }

  // 外壳：圆角近似（四角各切 18px），纵向留 40px 边距
  const L = 32, R = 224, T = 40, B = 216, r = 18, w = 11
  const solid = (x, y) => {
    // 圆角矩形内部判定：把四角的圆角部分排除
    const inCorner = (cx, cy) => (x - cx) ** 2 + (y - cy) ** 2 > (r + w) ** 2
    if (x < L + r && y < T + r && inCorner(L + r, T + r)) return false
    if (x > R - r && y < T + r && inCorner(R - r, T + r)) return false
    if (x < L + r && y > B - r && inCorner(L + r, B - r)) return false
    if (x > R - r && y > B - r && inCorner(R - r, B - r)) return false
    return true
  }
  for (let y = T - w; y <= B + w; y++) {
    for (let x = L - w; x <= R + w; x++) {
      if (!solid(x, y)) continue
      const inner = x >= L && x <= R && y >= T && y <= B
      put(x, y, SHELL, inner ? 0 : 255) // 内部透明，只画描边
    }
  }

  // 正极头
  rect(R + 2, T + 46, R + 13, B - 46, SHELL)

  // 电量填充：约 78%，内部再留 14px 内边距
  const pad = 14
  const iL = L + pad, iR = R - pad, iT = T + pad, iB = B - pad
  const fillR = iL + Math.round((iR - iL) * 0.78)
  rect(iL, iT, fillR, iB, FILL)
  // 填充右端加一小段高光，纯色块不至于太死板
  rect(fillR - 6, iT, fillR, iB, [140, 222, 190])

  return encodePng(size, size, px)
}

// ICO 容器：6 字节头 + 16 字节目录项 + 图片数据（PNG 直接内嵌）
function buildIco(pngList) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngList.length, 4)

  let offset = 6 + 16 * pngList.length
  const entries = []
  const images = []
  for (const { size, png } of pngList) {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size  // 宽：256 记为 0
    e[1] = size >= 256 ? 0 : size  // 高
    e[2] = 0                       // 调色板数
    e[3] = 0                       // 保留
    e.writeUInt16LE(1, 4)          // 色彩平面
    e.writeUInt16LE(32, 6)         // 位深
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    images.push(png)
    offset += png.length
  }
  return Buffer.concat([header, ...entries, ...images])
}

const out = path.join(__dirname, '..', 'build', 'icon.ico')
fs.mkdirSync(path.dirname(out), { recursive: true })

// 一个 ICO 里塞多尺寸，Windows 在不同场景（任务栏 / 资源管理器 / 缩略图）各取所需
const ico = buildIco([256, 128, 64, 48, 32, 16].map((size) => ({ size, png: drawBattery(size) })))
fs.writeFileSync(out, ico)
console.log('[icon] 已生成', out, ico.length, 'bytes')
