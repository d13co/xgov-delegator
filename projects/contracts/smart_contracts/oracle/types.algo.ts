import { Account, uint64 } from '@algorandfoundation/algorand-typescript'
import { Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { u32 } from '../base/utils.algo'

/**
 * Committee Metadata
 */
export type CommitteeMetadata = {
  periodStart: Uint32
  periodEnd: Uint32 // exclusive
  totalMembers: Uint32
  totalVotes: Uint32
  xGovRegistryId: uint64
  ingestedVotes: Uint32
  superboxPrefix: string
}

/**
 * Input representation of a committee xGov
 */
export type XGovInput = {
  accountId: Uint32
  account: Account
  votes: Uint32
}

/**
 * Stored representation of a committee xGov
 */
export type XGovStored = {
  accountId: Uint32
  votes: Uint32
}

export const XGOV_STORED_SIZE: uint64 = 4 + 4 // AccountID + Votes

export function getEmptyCommitteeMetadata(): CommitteeMetadata {
  return {
    periodStart: u32(0),
    periodEnd: u32(0),
    totalMembers: u32(0),
    totalVotes: u32(0),
    xGovRegistryId: 0,
    ingestedVotes: u32(0),
    superboxPrefix: '',
  }
}
