import { bytes, err, log, uint64 } from '@algorandfoundation/algorand-typescript'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'

export function u32(v: uint64) {
  return new Uint32(v)
}

const ARC65_PREFIX = 'ERR:'

export function ensure(cond: boolean, code: string) {
  if (!cond) {
    log(ARC65_PREFIX + code)
    err()
  }
}

export function ensureExtra(cond: boolean, code: string, extra: bytes) {
  if (!cond) {
    log(extra)
    log(ARC65_PREFIX + code)
    err()
  }
}
