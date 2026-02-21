# Brymen 6000-count DMM Communication Protocol

Source: Brymen BM2250 series protocol document.

## Serial Settings

| Parameter | Value |
|-----------|-------|
| Baud rate | 9600 |
| Parity | None |
| Data bits | 8 |
| Stop bit | 1 |

## Activation

Press and hold **HOLD** button, then turn the **Rotary Switch** to power on.

## Program Flow

1. Initiate COM port
2. Wait for 100ms
3. Set serial parameters (9600, N, 8, 1)
4. Locate 15 RXD buffers
5. Clear RXD buffers
6. Check & read RXD buffers
7. Decode 15 RXD buffers (see LCD Map below)
8. Repeat 5-7 for next reading

## Packet Structure

The DMM continuously sends 15-byte packets. Each byte encodes:

- **Upper nibble (bit7:4):** Byte index `0x0` through `0xE` (0-14)
- **Lower nibble (bit3:0):** Data bits mapped to LCD segments/annunciators

The upper nibble identifies the byte position, allowing resynchronization at any point in the stream.

## LCD Map (15 bytes)

| Byte | Index (bit7:4) | bit3 | bit2 | bit1 | bit0 |
|------|----------------|------|------|------|------|
| 1 | 0000 | 1 (fixed) | 0 (fixed) | 1 (fixed) | 0 (fixed) |
| 2 | 0001 | AUTO | DC (===) | ~ (AC) | Triangle (delta) |
| 3 | 0010 | Buzzer (·))) | Battery | LoZ | VFD |
| 4 | 0011 | 1a | 1f | 1e | - (minus sign) |
| 5 | 0100 | 1b | 1g | 1c | 1d |
| 6 | 0101 | 2a | 2f | 2e | 1p (decimal point 1) |
| 7 | 0110 | 2b | 2g | 2c | 2d |
| 8 | 0111 | 3a | 3f | 3e | 2p (decimal point 2) |
| 9 | 1000 | 3b | 3g | 3c | 3d |
| 10 | 1001 | 4a | 4f | 4e | 3p (decimal point 3) |
| 11 | 1010 | 4b | 4g | 4c | 4d |
| 12 | 1011 | Diode | dBm | M (mega) | k (kilo) |
| 13 | 1100 | Continuity | Ohm (Ω) | Hz | n (nano) |
| 14 | 1101 | MAX | F (farad) | μ (micro) | m (milli) |
| 15 | 1110 | MIN | V (volt) | A (amp) | Bolt (⚡) |

## 7-Segment Display Layout

```
 aaa
f   b
f   b
 ggg
e   c
e   c
 ddd
```

Each digit uses 2 consecutive bytes:
- **Odd byte** (byte 4,6,8,10): segments `a`, `f`, `e` + special (minus/decimal point)
- **Even byte** (byte 5,7,9,11): segments `b`, `g`, `c`, `d`

### Digit Mapping

| Digit | Segments byte | Segments byte | Decimal point |
|-------|--------------|--------------|---------------|
| 1 | Byte 4 (a,f,e,-) | Byte 5 (b,g,c,d) | N/A |
| 2 | Byte 6 (a,f,e,1p) | Byte 7 (b,g,c,d) | 1p (between digit 1 & 2) |
| 3 | Byte 8 (a,f,e,2p) | Byte 9 (b,g,c,d) | 2p (between digit 2 & 3) |
| 4 | Byte 10 (a,f,e,3p) | Byte 11 (b,g,c,d) | 3p (between digit 3 & 4) |

### 7-Segment Digit Values

| Digit | a | b | c | d | e | f | g |
|-------|---|---|---|---|---|---|---|
| 0 | 1 | 1 | 1 | 1 | 1 | 1 | 0 |
| 1 | 0 | 1 | 1 | 0 | 0 | 0 | 0 |
| 2 | 1 | 1 | 0 | 1 | 1 | 0 | 1 |
| 3 | 1 | 1 | 1 | 1 | 0 | 0 | 1 |
| 4 | 0 | 1 | 1 | 0 | 0 | 1 | 1 |
| 5 | 1 | 0 | 1 | 1 | 0 | 1 | 1 |
| 6 | 1 | 0 | 1 | 1 | 1 | 1 | 1 |
| 7 | 1 | 1 | 1 | 0 | 0 | 0 | 0 |
| 8 | 1 | 1 | 1 | 1 | 1 | 1 | 1 |
| 9 | 1 | 1 | 1 | 1 | 0 | 1 | 1 |
| L | 0 | 0 | 0 | 1 | 1 | 1 | 0 |

## Byte 1 (Sync)

Byte 1 always has the value `0x0A` (upper nibble `0000`, lower nibble `1010`). This fixed pattern can be used for synchronization.

## Worked Example

LCD reading: **AC 513.6V**

Bytes: `0A 1A 20 3C 47 50 6A 78 8F 9F A7 B0 C0 D0 E4`

| Byte | Hex | Lower nibble | Meaning |
|------|-----|-------------|---------|
| 1 | 0AH | 1010 | Sync (fixed) |
| 2 | 1AH | 1010 | AC (~) on, AUTO off |
| 3 | 20H | 0000 | No buzzer, no battery, no LoZ, no VFD |
| 4 | 3CH | 1100 | Digit 1: a=1, f=1, e=0, minus=0 |
| 5 | 47H | 0111 | Digit 1: b=0, g=1, c=1, d=1 → blank (no digit shown) |
| 6 | 50H | 0000 | Digit 2: a=0, f=0, e=0, dp1=0 |
| 7 | 6AH | 1010 | Digit 2: b=1, g=0, c=1, d=0 → "1" |
| 8 | 78H | 1000 | Digit 3: a=1, f=0, e=0, dp2=0 |
| 9 | 8FH | 1111 | Digit 3: b=1, g=1, c=1, d=1 → ... |
| 10 | 9FH | 1111 | Digit 4: a=1, f=1, e=1, dp3=1 |
| 11 | A7H | 0111 | Digit 4: b=0, g=1, c=1, d=1 |
| 12 | B0H | 0000 | No dBm, no M, no k |
| 13 | C0H | 0000 | No Ω, no Hz, no n |
| 14 | D0H | 0000 | No MAX, no F, no μ, no m |
| 15 | E4H | 0100 | V on, no MIN, no A |
