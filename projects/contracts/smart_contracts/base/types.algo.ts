import { Account, uint64 } from '@algorandfoundation/algorand-typescript'
import { StaticBytes, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { u32 } from './utils.algo'

export type CommitteeId = StaticBytes<32>

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

export type AccountWithId = {
  accountId: Uint32
  account: Account
}

/**
 * Input representation of a committee xGov
 */
export type XGovInput = {
  accountId: Uint32
  account: Account
  votes: Uint32
  // } & AccountWithId
  // results in "Non builtin type must have a name"
}

/**
 * Stored representation of a committee xGov
 */
export type AccountIdWithVotes = {
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

export type AlgohourAccountKey = [uint64, Uint32]

export type AccountAlgohourInput = {
  accountId: Uint32
  account: Account
  hours: uint64
}

export type DelegatorCommittee = {
  periodStart: Uint32
  periodEnd: Uint32
  extDelegatedVotes: Uint32
  extDelegatedAccountVotes: AccountIdWithVotes[]
}

export type AccountWithOffsetHint = {
  account: Account
  offsetHint: Uint32
}
