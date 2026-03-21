/**
 * Best-effort display name from a smart card (PIV: X.509 on-card certificate).
 *
 * Requires the Web Smart Card API (`navigator.smartCard`), which is not exposed
 * in all browsers or on all origins. For local testing without hardware, set
 * `VITE_TEST_SMARTCARD_NAME` in the environment.
 *
 * @see https://wicg.github.io/web-smart-card/
 */

import { USERNAME_MAX_LEN, validateUsername } from './playerIdentity.js';

/** NIST SP 800-73-4 PIV application AID */
const PIV_AID = new Uint8Array([
  0xa0, 0x00, 0x00, 0x03, 0x08, 0x00, 0x00, 0x10, 0x00, 0x01,
]);

/** PIV data objects that carry an X.509 used for login / identity (try in order) */
const CERT_OBJECT_TAGS = [0x5fc105, 0x5fc101];

const SW_SUCCESS = 0x9000;

/**
 * @param {Uint8Array} u8
 * @param {number} pos
 */
function readBerLength(u8, pos) {
  const first = u8[pos];
  if (first === undefined) return { length: 0, offset: pos + 1 };
  if (first < 0x80) return { length: first, offset: pos + 1 };
  const n = first & 0x7f;
  let v = 0;
  let i = pos + 1;
  for (let j = 0; j < n; j += 1) {
    v = (v << 8) | u8[i];
    i += 1;
  }
  return { length: v, offset: i };
}

/**
 * @param {ArrayBuffer | Uint8Array} buf
 */
function parseResponse(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < 2) return { data: new Uint8Array(0), sw: 0 };
  const sw = (u8[u8.length - 2] << 8) | u8[u8.length - 1];
  const data = u8.slice(0, u8.length - 2);
  return { data, sw };
}

function buildSelectPiv() {
  const lc = PIV_AID.length;
  const apdu = new Uint8Array(5 + lc);
  apdu[0] = 0x00;
  apdu[1] = 0xa4;
  apdu[2] = 0x04;
  apdu[3] = 0x00;
  apdu[4] = lc;
  apdu.set(PIV_AID, 5);
  return apdu;
}

/**
 * Tag list for GET DATA: tag 0x5C + length + big-endian tag bytes
 * @param {number} objectTag e.g. 0x5FC105 → bytes 5F C1 05
 */
function buildGetDataForObject(objectTag) {
  const b0 = (objectTag >> 16) & 0xff;
  const b1 = (objectTag >> 8) & 0xff;
  const b2 = objectTag & 0xff;
  const tagBytes =
    b0 !== 0 ? new Uint8Array([b0, b1, b2]) : b1 !== 0 ? new Uint8Array([b1, b2]) : new Uint8Array([b2]);

  const data = new Uint8Array(2 + tagBytes.length);
  data[0] = 0x5c;
  data[1] = tagBytes.length;
  data.set(tagBytes, 2);

  const apdu = new Uint8Array(5 + data.length);
  apdu[0] = 0x00;
  apdu[1] = 0xcb;
  apdu[2] = 0x3f;
  apdu[3] = 0xff;
  apdu[4] = data.length;
  apdu.set(data, 5);
  return apdu;
}

function buildGetResponse(le) {
  const ne = le === 0 ? 0 : le & 0xff;
  return new Uint8Array([0x00, 0xc0, 0x00, 0x00, ne]);
}

/**
 * @param {Uint8Array} buf
 */
function parsePivGetDataValue(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let i = 0;
  if (u[i] !== 0x53) {
    return u;
  }
  i += 1;
  const l1 = readBerLength(u, i);
  const inner = u.slice(l1.offset, l1.offset + l1.length);
  let j = 0;
  if (inner[j] === 0x70) {
    j += 1;
    const l2 = readBerLength(inner, j);
    return inner.slice(l2.offset, l2.offset + l2.length);
  }
  return inner;
}

/**
 * @param {Uint8Array} der
 * @returns {string | null}
 */
export function extractCommonNameFromX509Der(der) {
  const s = new TextDecoder('latin1').decode(der);
  const m = s.match(/CN=([^,\r\n\t]+)/);
  if (!m) return null;
  return m[1].trim() || null;
}

/**
 * @typedef {{ transmit: (buf: ArrayBuffer) => Promise<ArrayBuffer>, disconnect?: (reason?: string) => Promise<void> }} SmartCardConnection
 */

/**
 * @param {SmartCardConnection} conn
 * @param {number} objectTag
 */
async function fetchPivObject(conn, objectTag) {
  const select = buildSelectPiv();
  let r = parseResponse(await conn.transmit(select.buffer));
  if (r.sw !== SW_SUCCESS) {
    throw new Error(`SELECT PIV failed sw=0x${r.sw.toString(16)}`);
  }

  let cmd = buildGetDataForObject(objectTag);
  const chunks = [];

  while (true) {
    r = parseResponse(await conn.transmit(cmd.buffer));
    const swHi = (r.sw >> 8) & 0xff;
    if (r.sw !== SW_SUCCESS && swHi !== 0x61) {
      throw new Error(`GET DATA failed sw=0x${r.sw.toString(16)}`);
    }
    if (r.data.length) chunks.push(r.data);

    if (r.sw === SW_SUCCESS) break;

    const le = r.sw & 0xff;
    cmd = buildGetResponse(le);
  }

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }

  return parsePivGetDataValue(out);
}

/**
 * @param {SmartCardConnection} connection
 * @returns {Promise<string | null>}
 */
async function commonNameFromPivConnection(connection) {
  for (const tag of CERT_OBJECT_TAGS) {
    try {
      const der = await fetchPivObject(connection, tag);
      if (!der.length) continue;
      const cn = extractCommonNameFromX509Der(der);
      if (!cn) continue;
      const t = cn.slice(0, USERNAME_MAX_LEN);
      if (validateUsername(t)) return t;
    } catch {
      /* try next tag */
    }
  }
  return null;
}

/**
 * @returns {Promise<string | null>}
 */
export async function tryGetSmartCardDisplayName() {
  const test = import.meta.env?.VITE_TEST_SMARTCARD_NAME;
  if (typeof test === 'string' && test.trim()) {
    const t = test.trim().slice(0, USERNAME_MAX_LEN);
    return validateUsername(t) ? t : null;
  }

  const nav = typeof navigator !== 'undefined' ? navigator : null;
  const mgr = nav && /** @type {{ smartCard?: { establishContext?: () => Promise<unknown> } }} */ (nav).smartCard;
  if (!mgr || typeof mgr.establishContext !== 'function') {
    return null;
  }

  try {
    const ctx = /** @type {any} */ (await mgr.establishContext());
    const readers = await ctx.listReaders();
    if (!readers?.length) return null;

    const initialIn = readers.map((readerName) => ({
      readerName,
      currentState: { unaware: true },
    }));
    const status = await ctx.getStatusChange(initialIn, {});

    let readerName = null;
    for (const st of status) {
      const ev = st.eventState || {};
      if (ev.present && !ev.empty) {
        readerName = st.readerName;
        break;
      }
    }
    if (!readerName) readerName = readers[0];

    const { connection } = await ctx.connect(readerName, 'shared', {});
    try {
      return await commonNameFromPivConnection(connection);
    } finally {
      if (connection && typeof connection.disconnect === 'function') {
        await connection.disconnect('leave').catch(() => {});
      }
    }
  } catch (e) {
    console.debug('[smartCardIdentity]', e);
    return null;
  }
}
