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

let port = null;
let reader = null;
let buffer = [];

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

  // Verify sync byte (index 0 should have lower nibble 0xA)
  if (ordered[0] !== 0x0A) return;

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
      // No valid packet found, keep last 14 bytes in case partial packet
      if (buffer.length > PACKET_SIZE) {
        buffer = buffer.slice(buffer.length - PACKET_SIZE + 1);
      }
      break;
    }

    // Discard bytes before sync
    if (syncIdx > 0) {
      buffer = buffer.slice(syncIdx);
    }

    // Extract packet
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
