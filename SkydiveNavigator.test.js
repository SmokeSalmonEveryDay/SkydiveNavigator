const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

// ─── Bangle.js environment mocks ─────────────────────────────────────────────

const mockFlysightWrite = jest.fn();
const mockDebugWrite    = jest.fn();

const mockG = {
  reset:        jest.fn().mockReturnThis(),
  clearRect:    jest.fn().mockReturnThis(),
  setFont:      jest.fn().mockReturnThis(),
  setFontAlign: jest.fn().mockReturnThis(),
  clear:        jest.fn().mockReturnThis(),
  setColor:     jest.fn().mockReturnThis(),
  drawString:   jest.fn().mockReturnThis(),
  drawImage:    jest.fn().mockReturnThis(),
};

const mockBangle = {
  appRect:           { x: 0, y: 0, w: 176, h: 176 },
  setBarometerPower: jest.fn(),
  setGPSPower:       jest.fn(),
  getPressure:       jest.fn().mockResolvedValue({ pressure: 1013.25 }),
  on:                jest.fn(),
  buzz:              jest.fn(),
};

const mockRequire = jest.fn().mockImplementation((module) => {
  if (module === 'Storage') {
    return {
      open: jest.fn().mockImplementation((name) => ({
        write: name.startsWith('FS_') ? mockFlysightWrite : mockDebugWrite,
      })),
      read: jest.fn().mockReturnValue(null),
    };
  }
  return {};
});

// ─── Load app into a VM context ───────────────────────────────────────────────
// The app was written for Bangle.js (no module system) — all declarations are
// intended to be global. vm.createContext puts them on the context object so
// tests can read/write them directly.

const ctx = {
  g:                     mockG,
  Bangle:                mockBangle,
  BTN:                   1,
  setInterval:           jest.fn().mockReturnValue(42),
  clearInterval:         jest.fn(),
  setTimeout:            jest.fn(),
  setWatch:              jest.fn(),
  require:               mockRequire,
  // On Espruino/Bangle.js, Date(ms) called without `new` returns a Date object.
  // In Node.js it returns a string. Proxy it to match Espruino behaviour.
  Date:                  new Proxy(Date, { apply: (_t, _this, args) => Reflect.construct(Date, args) }),
  Math:                  Math,
  console:               console,
};

vm.createContext(ctx);
const code = fs.readFileSync(path.join(__dirname, 'SkydiveNavigator.app.js'), 'utf8');
// Append var aliases for the const arrays so the test suite can reset them between runs.
// (const/let are block-scoped and don't become properties of the vm context object.)
vm.runInContext(code + '\nvar _sinkRatesList = sinkRatesList;\nvar _speedsList = speedsList;', ctx);

// Convenience: destructure frequently-used functions from the context
const {
  navigate, getBearing, getDistance, getReturnAltitude,
  degreesToRadians, radiansToDegrees, metresToFeet,
  addToList, listAverage, calculateSinkRate, calculateSpeed,
} = ctx;

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeGps({ lat = 51.2300, lon = -1.7621, alt = 2000, speed = 40,
                   course = 0, hdop = 1.2, satellites = 8, fix = 1,
                   time = new Date() } = {}) {
  return { lat, lon, alt, speed, course, hdop, satellites, fix, time };
}

// Reset all mutable globals in the VM context before each navigate() call.
function resetNavigateState(gps) {
  ctx.dropzoneSelected  = false;
  ctx._sinkRatesList.splice(0);
  ctx._speedsList.splice(0);
  ctx.lastAltitude = { alt: gps.alt + 10, time: new Date(gps.time.getTime() - 2000) };
  ctx.loggingStartTime = gps.time.getTime() - 5000;
  ctx.dropzoneAlt  = 0;   // `dropzoneAlt` is undefined in the original code (bug: should be dropzone.alt)
  ctx.flysightLogFile = { write: mockFlysightWrite };
  ctx.debugLogFile    = { write: mockDebugWrite };
  mockFlysightWrite.mockClear();
  mockDebugWrite.mockClear();
  mockG.drawString.mockClear();
  mockG.drawImage.mockClear();
  mockG.setColor.mockClear();
}

// ─── Pure function tests ───────────────────────────────────────────────────────

describe('degreesToRadians / radiansToDegrees', () => {
  test('180 degrees converts to π', () => {
    expect(degreesToRadians(180)).toBeCloseTo(Math.PI, 5);
  });

  test('round-trips without loss', () => {
    expect(radiansToDegrees(degreesToRadians(123.456))).toBeCloseTo(123.456, 5);
  });
});

describe('metresToFeet', () => {
  test('1 metre ≈ 3.2808 feet', () => {
    expect(metresToFeet(1)).toBeCloseTo(3.2808, 4);
  });

  test('304.8 m ≈ 1000 ft', () => {
    expect(metresToFeet(304.8)).toBeCloseTo(1000, 0);
  });
});

describe('getReturnAltitude', () => {
  // altitude = gps.alt - dropzoneAlt
  // timeToTarget = distance / (speed / 3.6)
  // returnAltitude = altitude - (timeToTarget * sinkRate)

  test('positive when enough height to glide to dropzone', () => {
    // 1900 m AGL, 1000 m away, 50 km/h, 5 m/s sink → loses 360 m → 1540 m remaining
    expect(getReturnAltitude({ alt: 2000 }, 1000, 100, 5, 50)).toBeCloseTo(1540, 1);
  });

  test('negative when too low to reach dropzone', () => {
    // 300 m AGL, 10 km away, 50 km/h, 5 m/s sink → loses 3600 m
    expect(getReturnAltitude({ alt: 400 }, 10000, 100, 5, 50)).toBeLessThan(0);
  });

  test('zero sinkRate means full AGL altitude is returned', () => {
    expect(getReturnAltitude({ alt: 1500 }, 500, 500, 0, 60)).toBeCloseTo(1000, 1);
  });

  test('scales linearly with distance', () => {
    const short = getReturnAltitude({ alt: 3000 }, 1000, 0, 5, 60);
    const far   = getReturnAltitude({ alt: 3000 }, 2000, 0, 5, 60);
    expect(far).toBeLessThan(short);
  });
});

describe('getBearing', () => {
  test('due north ≈ 0°', () => {
    const from = { lat: degreesToRadians(51), lon: degreesToRadians(0) };
    const to   = { lat: degreesToRadians(52), lon: degreesToRadians(0) };
    expect(getBearing(from, to)).toBeCloseTo(0, 0);
  });

  test('due east ≈ 90°', () => {
    const from = { lat: degreesToRadians(51), lon: degreesToRadians(0) };
    const to   = { lat: degreesToRadians(51), lon: degreesToRadians(1) };
    expect(getBearing(from, to)).toBeCloseTo(90, 0);
  });

  test('due south ≈ 180°', () => {
    const from = { lat: degreesToRadians(52), lon: degreesToRadians(0) };
    const to   = { lat: degreesToRadians(51), lon: degreesToRadians(0) };
    expect(getBearing(from, to)).toBeCloseTo(180, 0);
  });

  test('result is always in range 0–360', () => {
    const from = { lat: degreesToRadians(51), lon: degreesToRadians(1) };
    const to   = { lat: degreesToRadians(51), lon: degreesToRadians(0) };
    const b = getBearing(from, to);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(360);
  });
});

// ─── deltaBearing tests ────────────────────────────────────────────────────────

describe('navigate() — deltaBearing', () => {
  // deltaBearing = bearing - gps.course
  // Wraparound: if (deltaBearing < -180) deltaBearing += 180
  //
  // NOTE: the wraparound adds 180 instead of 360. This means that when the
  // dropzone crossing the 0°/360° boundary produces a raw deltaBearing between
  // -360 and -180, the result maps to (-180..0) rather than the correct (0..+180).
  // e.g. bearing=10, course=350 → raw=-340 → after +180 → -160 (wrong; should be +20).
  // The tests below document actual behaviour; those marked ⚠ expose the bug.

  beforeEach(() => {
    ctx.dropzoneSelected = true;
    ctx.dropzone         = ctx.netheravon;
    ctx._sinkRatesList.splice(0);
    ctx._speedsList.splice(0);
    ctx.loggingStartTime = Date.now();
    ctx.dropzoneAlt      = 0;
    ctx.flysightLogFile  = { write: mockFlysightWrite };
    ctx.debugLogFile     = { write: mockDebugWrite };
    mockFlysightWrite.mockClear();
    mockDebugWrite.mockClear();
    mockG.drawString.mockClear();
    mockG.drawImage.mockClear();
    mockG.setColor.mockClear();
  });

  test('deltaBearing is positive when dropzone is to the right of course', () => {
    // GPS at (51.0, -2.0), bearing to Netheravon ≈ 44° NE, course = 30°
    // → deltaBearing = 44 - 30 ≈ +14 (DZ is slightly to the right, no wraparound needed)
    const gps = makeGps({ lat: 51.0, lon: -2.0, course: 30, alt: 1000, speed: 40 });
    ctx.lastAltitude = { alt: 1010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(ctx.deltaBearing).toBeGreaterThan(0);
    expect(ctx.deltaBearing).toBeLessThan(90);
  });

  test('deltaBearing is negative when dropzone is to the left of course', () => {
    // Heading east — DZ is roughly north → DZ is to the left
    const gps = makeGps({ lat: 51.230, lon: -1.770, course: 90, alt: 1000, speed: 40 });
    ctx.lastAltitude = { alt: 1010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(ctx.deltaBearing).toBeLessThan(0);
  });

  test('result stays in range [-180, 360] after the wraparound rule is applied', () => {
    const gps = makeGps({ lat: 51.230, lon: -1.770, course: 350, alt: 1000, speed: 40 });
    ctx.lastAltitude = { alt: 1010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(ctx.deltaBearing).toBeGreaterThanOrEqual(-180);
    expect(ctx.deltaBearing).toBeLessThanOrEqual(360);
  });

  test('arrow is drawn (not altitude) when |deltaBearing| > 20', () => {
    // Heading due south, DZ is north → large negative delta
    const gps = makeGps({ lat: 51.230, lon: -1.762, course: 180, alt: 1000, speed: 40 });
    ctx.lastAltitude = { alt: 1010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(Math.abs(ctx.deltaBearing)).toBeGreaterThan(20);
    expect(mockG.drawImage).toHaveBeenCalled();
    expect(mockG.drawString).not.toHaveBeenCalled();
  });

  test('altitude display (not arrow) when deltaBearing is within ±20°', () => {
    // Almost directly south of DZ, heading due north → deltaBearing ≈ 0
    const gps = makeGps({ lat: 51.230, lon: -1.7621, course: 0, alt: 3000, speed: 40 });
    ctx.lastAltitude = { alt: 3010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(Math.abs(ctx.deltaBearing)).toBeLessThanOrEqual(20);
    expect(mockG.drawImage).not.toHaveBeenCalled();
  });
});

// ─── returnAltitude in navigate() ─────────────────────────────────────────────

describe('navigate() — returnAltitude', () => {
  beforeEach(() => {
    ctx.dropzoneSelected = true;
    ctx.dropzone         = ctx.netheravon;
    ctx._sinkRatesList.splice(0);
    ctx._speedsList.splice(0);
    ctx.loggingStartTime = Date.now();
    ctx.dropzoneAlt      = 0;
    ctx.flysightLogFile  = { write: mockFlysightWrite };
    ctx.debugLogFile     = { write: mockDebugWrite };
    mockFlysightWrite.mockClear();
    mockDebugWrite.mockClear();
    mockG.drawString.mockClear();
    mockG.drawImage.mockClear();
    mockG.setColor.mockClear();
  });

  test('returnAltitude is positive when on course with plenty of height', () => {
    // Almost directly south of DZ, heading north → on course, lots of altitude
    const gps = makeGps({ lat: 51.230, lon: -1.7621, course: 0, alt: 3000, speed: 40 });
    ctx.lastAltitude = { alt: 3010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(ctx.returnAltitude).toBeGreaterThan(0);
  });

  test('returnAltitude is 0 when not heading toward DZ', () => {
    // Heading south (180°) → large deltaBearing → navigate() resets returnAltitude to 0
    const gps = makeGps({ lat: 51.230, lon: -1.762, course: 180, alt: 3000, speed: 40 });
    ctx.lastAltitude = { alt: 3010, time: new Date(gps.time.getTime() - 2000) };
    navigate(gps);
    expect(ctx.returnAltitude).toBe(0);
  });

  test('returnAltitude decreases as GPS altitude decreases (same position)', () => {
    const base = { lat: 51.230, lon: -1.7621, course: 0, speed: 40 };

    ctx._sinkRatesList.splice(0);
    ctx._speedsList.splice(0);
    const highGps = makeGps({ ...base, alt: 3000 });
    ctx.lastAltitude = { alt: 3010, time: new Date(highGps.time.getTime() - 2000) };
    navigate(highGps);
    const highResult = ctx.returnAltitude;

    ctx._sinkRatesList.splice(0);
    ctx._speedsList.splice(0);
    const lowGps = makeGps({ ...base, alt: 1500 });
    ctx.lastAltitude = { alt: 1510, time: new Date(lowGps.time.getTime() - 2000) };
    navigate(lowGps);
    const lowResult = ctx.returnAltitude;

    expect(lowResult).toBeLessThan(highResult);
  });

  test('shows green altitude string when returnAltitude > 0', () => {
    const gps = makeGps({ lat: 51.230, lon: -1.7621, course: 0, alt: 3000, speed: 40 });
    ctx.lastAltitude = { alt: 3010, time: new Date(gps.time.getTime() - 2000) };
    mockG.setColor.mockClear();
    mockG.drawString.mockClear();
    navigate(gps);
    if (ctx.returnAltitude > 0) {
      expect(mockG.setColor).toHaveBeenCalledWith('#00ff00');
      expect(mockG.drawString).toHaveBeenCalled();
    }
  });

  test('shows blue LAND OFF string when returnAltitude <= 0', () => {
    // Barely above DZ elevation, close enough that sinkRate exceeds available altitude
    const gps = makeGps({ lat: 51.230, lon: -1.7621, course: 0, alt: 136, speed: 40 });
    ctx.lastAltitude = { alt: 200, time: new Date(gps.time.getTime() - 1000) };
    // Pump a high sinkRate into the list so getReturnAltitude goes negative
    ctx._sinkRatesList.push(20, 20, 20, 20, 20);
    mockG.setColor.mockClear();
    navigate(gps);
    if (ctx.returnAltitude !== undefined && ctx.returnAltitude <= 0) {
      expect(mockG.setColor).toHaveBeenCalledWith('#0000ff');
    }
  });
});

// ─── Log generation ────────────────────────────────────────────────────────────

describe('Log generation from GPS stream', () => {
  const CANOPY_SPEED = 40; // km/h — within the 18–120 range

  function runNavigate(overrides = {}) {
    const now = new Date();
    const gps = makeGps({ lat: 51.230, lon: -1.7621, course: 0, alt: 2000,
                          speed: CANOPY_SPEED, hdop: 1.5, satellites: 10, time: now,
                          ...overrides });
    resetNavigateState(gps);
    ctx.dropzoneSelected = true;
    ctx.dropzone         = ctx.netheravon;
    navigate(gps);
    return gps;
  }

  // ── Flysight log ──

  test('flysight log is written for canopy-speed GPS fixes (18–120 km/h)', () => {
    runNavigate({ speed: CANOPY_SPEED });
    expect(mockFlysightWrite).toHaveBeenCalledTimes(1);
  });

  test('flysight log is NOT written below 18 km/h', () => {
    runNavigate({ speed: 10 });
    expect(mockFlysightWrite).not.toHaveBeenCalled();
  });

  test('flysight log is NOT written above 120 km/h', () => {
    runNavigate({ speed: 130 });
    expect(mockFlysightWrite).not.toHaveBeenCalled();
  });

  test('flysight CSV has 12 comma-separated fields', () => {
    runNavigate();
    const line = mockFlysightWrite.mock.calls[0][0];
    expect(line.trim().split(',')).toHaveLength(12);
  });

  test('flysight CSV line ends with a newline', () => {
    runNavigate();
    expect(mockFlysightWrite.mock.calls[0][0]).toMatch(/\n$/);
  });

  test('flysight CSV fields: lat and lon match GPS input', () => {
    const gps = runNavigate({ lat: 51.9876, lon: -2.3456 });
    const fields = mockFlysightWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[1])).toBeCloseTo(gps.lat, 4);
    expect(parseFloat(fields[2])).toBeCloseTo(gps.lon, 4);
  });

  test('flysight CSV fields: altitude matches GPS alt', () => {
    runNavigate({ alt: 1234 });
    const fields = mockFlysightWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[3])).toBeCloseTo(1234, 1);
  });

  test('flysight CSV fields: hAcc = hdop * 5', () => {
    runNavigate({ hdop: 2.0 });
    const fields = mockFlysightWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[7])).toBeCloseTo(10.0, 4);
  });

  test('flysight CSV fields: gpsFix = 1 for a fix', () => {
    runNavigate({ fix: 1 });
    const fields = mockFlysightWrite.mock.calls[0][0].trim().split(',');
    expect(parseInt(fields[10], 10)).toBe(1);
  });

  test('flysight CSV fields: numSV matches satellites', () => {
    runNavigate({ satellites: 12 });
    const fields = mockFlysightWrite.mock.calls[0][0].trim().split(',');
    expect(parseInt(fields[11], 10)).toBe(12);
  });

  // ── Debug log ──

  test('debug log is written for every GPS fix regardless of speed', () => {
    runNavigate({ speed: 10 });
    expect(mockDebugWrite).toHaveBeenCalledTimes(1);
    mockDebugWrite.mockClear();
    runNavigate({ speed: 130 });
    expect(mockDebugWrite).toHaveBeenCalledTimes(1);
  });

  test('debug CSV has 12 comma-separated fields', () => {
    runNavigate();
    const line = mockDebugWrite.mock.calls[0][0];
    expect(line.trim().split(',')).toHaveLength(12);
  });

  test('debug CSV line ends with a newline', () => {
    runNavigate();
    expect(mockDebugWrite.mock.calls[0][0]).toMatch(/\n$/);
  });

  test('debug CSV fields: speed = gps.speed * 0.36', () => {
    runNavigate({ speed: 100 });
    const fields = mockDebugWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[4])).toBeCloseTo(36.0, 3);
  });

  test('debug CSV fields: deltaBearing matches ctx.deltaBearing', () => {
    runNavigate();
    const fields = mockDebugWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[10])).toBeCloseTo(ctx.deltaBearing, 3);
  });

  test('debug CSV fields: returnAltitude matches ctx.returnAltitude', () => {
    runNavigate();
    const fields = mockDebugWrite.mock.calls[0][0].trim().split(',');
    expect(parseFloat(fields[11])).toBeCloseTo(ctx.returnAltitude, 1);
  });

  test('no logs written when GPS has no fix', () => {
    // fix=0 hits the else branch in navigate — no log frames are created
    const gps = makeGps({ fix: 0 });
    resetNavigateState(gps);
    ctx.dropzoneSelected = true;
    ctx.dropzone         = ctx.netheravon;
    navigate(gps);
    expect(mockFlysightWrite).not.toHaveBeenCalled();
    expect(mockDebugWrite).not.toHaveBeenCalled();
  });
});
