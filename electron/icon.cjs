const zlib = require('node:zlib')

// 手写极简 PNG 编码器：托盘图标需要按电量动态生成，主进程没有 canvas，
// 用 zlib + CRC32 直接拼 PNG，避免引入原生依赖。
let crcTable = null
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[i] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
  return Buffer.concat([len, t, data, crc])
}

function encodePng(width, height, rgba) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const SHELL = [211, 209, 199]
const COLOR = {
  charging: [78, 158, 255],
  low: [226, 75, 74],
  mid: [239, 159, 39],
  high: [93, 202, 165],
  unknown: [136, 135, 128]
}

// 32x32 电池图标：外框 + 正极头 + 按电量比例的填充条
function batteryIconBuffer(percent, charging) {
  const S = 32
  const px = Buffer.alloc(S * S * 4)
  const put = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return
    const i = (y * S + x) * 4
    px[i] = c[0]
    px[i + 1] = c[1]
    px[i + 2] = c[2]
    px[i + 3] = a
  }
  const rect = (x0, y0, x1, y1, c, a = 255) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, c, a)
  }

  const L = 4, R = 26, T = 8, B = 24
  const innerL = L + 2, innerR = R - 2, innerT = T + 2, innerB = B - 2
  const innerW = innerR - innerL + 1

  let fill = COLOR.unknown
  let ratio = 0
  if (percent != null && percent >= 0) {
    ratio = Math.max(0, Math.min(100, percent)) / 100
    if (charging) fill = COLOR.charging
    else if (percent < 20) fill = COLOR.low
    else if (percent < 50) fill = COLOR.mid
    else fill = COLOR.high
  }

  // 正极头
  rect(R + 1, T + 4, R + 2, B - 4, SHELL)
  // 外框（描边）
  rect(L, T, R, T, SHELL)
  rect(L, B, R, B, SHELL)
  rect(L, T, L, B, SHELL)
  rect(R, T, R, B, SHELL)
  // 内部留空（透明）
  rect(innerL, innerT, innerR, innerB, [0, 0, 0], 0)
  // 电量填充
  const fillW = Math.round(innerW * ratio)
  if (fillW > 0) rect(innerL, innerT, innerL + fillW - 1, innerB, fill)

  return encodePng(S, S, px)
}

module.exports = { batteryIconBuffer, encodePng }
