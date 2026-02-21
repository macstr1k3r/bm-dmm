// Brymen 6000-count DMM WebSerial Interface

const BAUD_RATE = 9600;
const PACKET_SIZE = 15;

// LCD element IDs
const SEGMENTS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const DIGITS = [1, 2, 3, 4];

// Annunciator mappings: [byteIndex, bitPosition, elementId]
// byteIndex is 0-based (byte 2 = index 1, etc.)
const ANNUNCIATORS = [
  // Byte 2 (index 1): AUTO, DC, AC, triangle
  [1, 3, 'ann-auto'],
  [1, 2, 'ann-dc'],
  [1, 1, 'ann-ac'],
  [1, 0, 'ann-delta'],
  // Byte 3 (index 2): buzzer, battery, LoZ, VFD
  [2, 3, 'ann-buzzer'],
  [2, 2, 'ann-bat'],
  [2, 1, 'ann-loz'],
  [2, 0, 'ann-vfd'],
  // Byte 4 (index 3): minus sign is bit0
  [3, 0, 'ann-minus'],
  // Byte 12 (index 11): diode, dBm, M, k
  [11, 3, 'ann-diode'],
  [11, 2, 'ann-dbm'],
  [11, 1, 'ann-mega'],
  [11, 0, 'ann-kilo'],
  // Byte 13 (index 12): continuity, ohm, Hz, n
  [12, 3, 'ann-cont'],
  [12, 2, 'ann-ohm'],
  [12, 1, 'ann-hz'],
  [12, 0, 'ann-nano'],
  // Byte 14 (index 13): MAX, F, micro, m
  [13, 3, 'ann-max'],
  [13, 2, 'ann-farad'],
  [13, 1, 'ann-micro'],
  [13, 0, 'ann-milli'],
  // Byte 15 (index 14): MIN, V, A, bolt
  [14, 3, 'ann-min'],
  [14, 2, 'ann-volt'],
  [14, 1, 'ann-amp'],
  [14, 0, 'ann-bolt'],
];

// Decimal points: [byteIndex, bitPosition, elementId]
// dp1 is bit0 of byte 6 (index 5), dp2 bit0 of byte 8 (index 7), dp3 bit0 of byte 10 (index 9)
const DECIMAL_POINTS = [
  [5, 0, 'dp1'],
  [7, 0, 'dp2'],
  [9, 0, 'dp3'],
];

// Digit segment mapping
// Each digit has 2 bytes:
//   Odd byte (index 3,5,7,9): bit3=a, bit2=f, bit1=e
//   Even byte (index 4,6,8,10): bit3=b, bit2=g, bit1=c, bit0=d
const DIGIT_BYTES = [
  { odd: 3, even: 4, id: 1 },   // Digit 1
  { odd: 5, even: 6, id: 2 },   // Digit 2
  { odd: 7, even: 8, id: 3 },   // Digit 3
  { odd: 9, even: 10, id: 4 },  // Digit 4
];

// 7-segment pattern → digit lookup (bits: a=6, b=5, c=4, d=3, e=2, f=1, g=0)
const SEG_TO_DIGIT = {
  0b1111110: '0', 0b0110000: '1', 0b1101101: '2', 0b1111001: '3',
  0b0110011: '4', 0b1011011: '5', 0b1011111: '6', 0b1110000: '7',
  0b1111111: '8', 0b1111011: '9', 0b0001110: 'L', 0b0000000: ' ',
};

let port = null;
let reader = null;
let buffer = [];
let lastLogTime = 0;
const MAX_LOG_ENTRIES = 500;
let csvData = [];

// Chart state
const ZOOM_STEPS = [10, 30, 60, 120, 300, 600, 1800, 3600];
let chartWindow = 60; // visible X span in seconds
let chartFollow = true; // auto-follow latest data

// Extract bit from lower nibble
function getBit(byte, pos) {
  return (byte >> pos) & 1;
}

// Decode a 15-byte packet and update the LCD
function decodePacket(packet) {
  // Reorder by upper nibble (byte index)
  const ordered = new Array(15);
  for (const byte of packet) {
    const idx = (byte >> 4) & 0x0F;
    if (idx < 15) {
      ordered[idx] = byte & 0x0F;
    }
  }

  // Verify we got a value for byte 0 (sync already validated by processBytes)
  if (ordered[0] === undefined) return;

  // Update digit segments
  for (const { odd, even, id } of DIGIT_BYTES) {
    const oddNibble = ordered[odd];
    const evenNibble = ordered[even];

    const segs = {
      a: getBit(oddNibble, 3),
      f: getBit(oddNibble, 2),
      e: getBit(oddNibble, 1),
      b: getBit(evenNibble, 3),
      g: getBit(evenNibble, 2),
      c: getBit(evenNibble, 1),
      d: getBit(evenNibble, 0),
    };

    for (const s of SEGMENTS) {
      const el = document.getElementById(`d${id}${s}`);
      if (el) {
        el.setAttribute('class', segs[s] ? 'seg-on' : 'seg-off');
      }
    }
  }

  // Update decimal points
  for (const [byteIdx, bitPos, elId] of DECIMAL_POINTS) {
    const el = document.getElementById(elId);
    if (el) {
      const on = getBit(ordered[byteIdx], bitPos);
      el.setAttribute('class', on ? 'dp-on' : 'dp-off');
    }
  }

  // Update annunciators
  for (const [byteIdx, bitPos, elId] of ANNUNCIATORS) {
    const el = document.getElementById(elId);
    if (el) {
      const on = getBit(ordered[byteIdx], bitPos);
      const tag = el.tagName.toLowerCase();
      if (tag === 'rect') {
        el.setAttribute('class', on ? 'seg-on' : 'seg-off');
      } else if (tag === 'g') {
        el.setAttribute('class', on ? 'ann-on' : 'ann-off');
      } else {
        el.setAttribute('class', `annunciator ${on ? 'ann-on' : 'ann-off'}`);
      }
    }
  }

  // Extract and log reading
  const reading = extractReading(ordered);
  console.log(`[PKT] ${packet.map(b => b.toString(16).padStart(2, '0')).join(' ')} → ${reading.value} ${reading.unit} ${reading.mode}`);
  logReading(reading);
}

// Extract numeric reading from ordered nibble array
function extractReading(ordered) {
  // Decode each digit
  let digits = '';
  for (const { odd, even } of DIGIT_BYTES) {
    const oddN = ordered[odd];
    const evenN = ordered[even];
    const pattern = (getBit(oddN, 3) << 6) | (getBit(evenN, 3) << 5) |
                    (getBit(evenN, 1) << 4) | (getBit(evenN, 0) << 3) |
                    (getBit(oddN, 1) << 2) | (getBit(oddN, 2) << 1) |
                    getBit(evenN, 2);
    digits += SEG_TO_DIGIT[pattern] ?? '?';
  }

  // Decimal points
  const dp1 = getBit(ordered[5], 0);
  const dp2 = getBit(ordered[7], 0);
  const dp3 = getBit(ordered[9], 0);

  // Build value string with decimal point
  let value = '';
  for (let i = 0; i < 4; i++) {
    value += digits[i];
    if (i === 0 && dp1) value += '.';
    if (i === 1 && dp2) value += '.';
    if (i === 2 && dp3) value += '.';
  }
  value = value.trimStart();

  // Minus sign
  const minus = getBit(ordered[3], 0);
  if (minus) value = '-' + value;

  // Unit prefix
  let prefix = '';
  if (getBit(ordered[11], 1)) prefix = 'M';  // mega
  else if (getBit(ordered[11], 0)) prefix = 'k';  // kilo
  else if (getBit(ordered[13], 0)) prefix = 'm';  // milli
  else if (getBit(ordered[13], 1)) prefix = 'μ';  // micro
  else if (getBit(ordered[12], 0)) prefix = 'n';  // nano

  // Unit
  let unit = '';
  if (getBit(ordered[14], 2)) unit = 'V';
  else if (getBit(ordered[14], 1)) unit = 'A';
  else if (getBit(ordered[12], 2)) unit = 'Ω';
  else if (getBit(ordered[12], 1)) unit = 'Hz';
  else if (getBit(ordered[13], 2)) unit = 'F';

  // Mode
  let mode = '';
  if (getBit(ordered[1], 1)) mode = 'AC';
  else if (getBit(ordered[1], 2)) mode = 'DC';

  return { value, unit: prefix + unit, mode };
}

// Add entry to data log
function logReading(reading) {
  const now = Date.now();
  const intervalSec = parseInt(document.getElementById('log-interval').value, 10) || 1;
  if (now - lastLogTime < intervalSec * 1000) return;
  lastLogTime = now;

  const container = document.getElementById('log-container');
  if (!container) return;

  const now_date = new Date();
  const unix = Math.floor(now_date.getTime() / 1000);
  const ts = now_date.getFullYear() + '-' +
    String(now_date.getMonth() + 1).padStart(2, '0') + '-' +
    String(now_date.getDate()).padStart(2, '0') + ' ' +
    String(now_date.getHours()).padStart(2, '0') + ':' +
    String(now_date.getMinutes()).padStart(2, '0') + ':' +
    String(now_date.getSeconds()).padStart(2, '0');

  csvData.push({ unix, ts, value: reading.value, unit: reading.unit, mode: reading.mode });
  drawChart();

  const time = now_date.toLocaleTimeString('en-GB');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `<span class="log-time">${time}</span> <span class="log-value">${reading.value} ${reading.unit}</span>${reading.mode ? ` <span class="log-mode">${reading.mode}</span>` : ''}`;

  container.prepend(entry);

  // Cap entries
  while (container.children.length > MAX_LOG_ENTRIES) {
    container.removeChild(container.lastChild);
  }
}

// Process incoming serial bytes - find and extract 15-byte packets
function processBytes(bytes) {
  buffer.push(...bytes);

  while (buffer.length >= PACKET_SIZE) {
    // Find sync: look for a byte whose upper nibble is 0x0
    let syncIdx = -1;
    for (let i = 0; i <= buffer.length - PACKET_SIZE; i++) {
      if (((buffer[i] >> 4) & 0x0F) === 0) {
        // Verify it's a valid packet: next 14 bytes should have upper nibbles 1-14
        let valid = true;
        for (let j = 1; j < PACKET_SIZE; j++) {
          if (((buffer[i + j] >> 4) & 0x0F) !== j) {
            valid = false;
            break;
          }
        }
        if (valid) {
          syncIdx = i;
          break;
        }
      }
    }

    if (syncIdx === -1) {
      if (buffer.length > PACKET_SIZE) {
        buffer = buffer.slice(buffer.length - PACKET_SIZE + 1);
      }
      break;
    }

    if (syncIdx > 0) {
      buffer = buffer.slice(syncIdx);
    }

    const packet = buffer.slice(0, PACKET_SIZE);
    buffer = buffer.slice(PACKET_SIZE);
    decodePacket(packet);
  }
}

// Connect to serial port
async function connect() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: BAUD_RATE, dataBits: 8, stopBits: 1, parity: 'none' });
    await port.setSignals({ dataTerminalReady: true });

    document.getElementById('status').textContent = 'Connected';
    document.getElementById('connect-btn').textContent = 'Disconnect';
    document.getElementById('connect-btn').classList.add('connected');

    reader = port.readable.getReader();
    readLoop();
  } catch (err) {
    console.error('Connection failed:', err);
    document.getElementById('status').textContent = 'Connection failed';
  }
}

// Disconnect from serial port
async function disconnect() {
  if (reader) {
    await reader.cancel();
    reader = null;
  }
  if (port) {
    await port.close();
    port = null;
  }
  buffer = [];
  document.getElementById('status').textContent = 'Disconnected';
  document.getElementById('connect-btn').textContent = 'Connect';
  document.getElementById('connect-btn').classList.remove('connected');
}

// Continuous read loop
async function readLoop() {
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      processBytes(Array.from(value));
    }
  } catch (err) {
    console.error('Read error:', err);
  }
  disconnect();
}

// Test with example from protocol doc: "AC 513.6V"
function testExample() {
  const exampleBytes = [0x0A, 0x1A, 0x20, 0x3C, 0x47, 0x50, 0x6A, 0x78, 0x8F, 0x9F, 0xA7, 0xB0, 0xC0, 0xD0, 0xE4];
  decodePacket(exampleBytes);
  document.getElementById('status').textContent = 'Test: AC 513.6V';
}

// Wire up buttons
document.getElementById('connect-btn').addEventListener('click', () => {
  if (port) {
    disconnect();
  } else {
    connect();
  }
});

document.getElementById('test-btn').addEventListener('click', testExample);

// ====== Chart ======

function drawChart() {
  const canvas = document.getElementById('chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // HiDPI
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width;
  const H = rect.height;

  // Parse numeric points from csvData
  const points = [];
  for (const d of csvData) {
    const v = parseFloat(d.value);
    if (!isNaN(v)) points.push({ t: d.unix, v });
  }

  // Background
  ctx.fillStyle = '#0d1b2a';
  ctx.fillRect(0, 0, W, H);

  if (points.length < 2) {
    ctx.fillStyle = '#444';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Waiting for data...', W / 2, H / 2);
    return;
  }

  const pad = { top: 10, right: 12, bottom: 24, left: 52 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // X range from scroll + zoom
  const dataStart = points[0].t;
  const dataEnd = points[points.length - 1].t;
  const dataSpan = dataEnd - dataStart;

  let xEnd, xStart;
  if (chartFollow || dataSpan <= chartWindow) {
    xEnd = dataEnd;
    xStart = xEnd - chartWindow;
  } else {
    const scroll = document.getElementById('chart-scroll');
    const pct = parseInt(scroll.value) / 1000;
    // pct=0 → see start, pct=1 → see end
    xStart = dataStart + pct * Math.max(0, dataSpan - chartWindow);
    xEnd = xStart + chartWindow;
  }

  // Filter visible points
  const visible = points.filter(p => p.t >= xStart && p.t <= xEnd);
  if (visible.length === 0) {
    ctx.fillStyle = '#444';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data in range', W / 2, H / 2);
    return;
  }

  // Y range
  let yMin = Infinity, yMax = -Infinity;
  for (const p of visible) {
    if (p.v < yMin) yMin = p.v;
    if (p.v > yMax) yMax = p.v;
  }
  let yRange = yMax - yMin;
  if (yRange === 0) yRange = Math.abs(yMax) * 0.1 || 1;
  const autoYMin = yMin - yRange * 0.1;
  const autoYMax = yMax + yRange * 0.1;

  const yAutoCheck = document.getElementById('chart-y-auto');
  const yMinInput = document.getElementById('chart-y-min');
  const yMaxInput = document.getElementById('chart-y-max');

  if (yAutoCheck.checked) {
    yMin = autoYMin;
    yMax = autoYMax;
    yMinInput.placeholder = autoYMin.toFixed(2);
    yMaxInput.placeholder = autoYMax.toFixed(2);
  } else {
    const manMin = parseFloat(yMinInput.value);
    const manMax = parseFloat(yMaxInput.value);
    yMin = isNaN(manMin) ? autoYMin : manMin;
    yMax = isNaN(manMax) ? autoYMax : manMax;
    if (yMin >= yMax) yMax = yMin + 1;
  }

  // Coordinate transforms
  const toX = t => pad.left + ((t - xStart) / chartWindow) * plotW;
  const toY = v => pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Y gridlines
  ctx.strokeStyle = '#1a2d45';
  ctx.lineWidth = 1;
  ctx.fillStyle = '#667';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  const ySteps = 5;
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + (i / ySteps) * (yMax - yMin);
    const y = toY(v);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(v.toFixed(2), pad.left - 4, y + 3);
  }

  // X gridlines + labels
  ctx.textAlign = 'center';
  const xLabelCount = Math.min(6, Math.floor(plotW / 70));
  for (let i = 0; i <= xLabelCount; i++) {
    const t = xStart + (i / xLabelCount) * chartWindow;
    const x = toX(t);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + plotH);
    ctx.stroke();
    const d = new Date(t * 1000);
    ctx.fillText(d.toLocaleTimeString('en-GB'), x, H - 4);
  }

  // Data line
  ctx.strokeStyle = '#4cc9f0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let started = false;
  for (const p of points) {
    if (p.t < xStart || p.t > xEnd) continue;
    const x = toX(p.t);
    const y = toY(p.v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Latest point marker
  if (visible.length > 0) {
    const last = visible[visible.length - 1];
    const lx = toX(last.t);
    const ly = toY(last.v);
    ctx.fillStyle = '#4cc9f0';
    ctx.beginPath();
    ctx.arc(lx, ly, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Chart controls
const scrollSlider = document.getElementById('chart-scroll');
scrollSlider.addEventListener('input', () => {
  chartFollow = parseInt(scrollSlider.value) >= 1000;
  drawChart();
});

document.getElementById('chart-zin').addEventListener('click', () => {
  const idx = ZOOM_STEPS.indexOf(chartWindow);
  if (idx > 0) chartWindow = ZOOM_STEPS[idx - 1];
  drawChart();
});

document.getElementById('chart-zout').addEventListener('click', () => {
  const idx = ZOOM_STEPS.indexOf(chartWindow);
  if (idx < ZOOM_STEPS.length - 1) chartWindow = ZOOM_STEPS[idx + 1];
  drawChart();
});

// Y-axis controls
document.getElementById('chart-y-auto').addEventListener('change', (e) => {
  document.getElementById('chart-y-min').disabled = e.target.checked;
  document.getElementById('chart-y-max').disabled = e.target.checked;
  drawChart();
});
document.getElementById('chart-y-min').addEventListener('input', drawChart);
document.getElementById('chart-y-max').addEventListener('input', drawChart);

// Redraw on resize
new ResizeObserver(() => drawChart()).observe(document.getElementById('chart'));

document.getElementById('csv-btn').addEventListener('click', () => {
  if (csvData.length === 0) return;
  let csv = 'unix_timestamp,timestamp,value,unit,mode\n';
  for (const r of csvData) {
    csv += `${r.unix},${r.ts},${r.value},${r.unit},${r.mode}\n`;
  }
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `brymen_${csvData[0].unix}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});
