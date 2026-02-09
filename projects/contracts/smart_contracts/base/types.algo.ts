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

/**
 * Input representation of a committee xGov
 */
export type AccountWithVotes = {
  account: Account
  votes: Uint32
}

/**
 * Stored representation of a committee xGov
 */
export type AccountIdWithVotes = {
  accountId: Uint32
  votes: Uint32
}

export const ACCOUNT_ID_WITH_VOTES_STORED_SIZE: uint64 = 4 + 4 // AccountID + Votes

export type AlgohourAccountKey = [uint64, Uint32]

export type AccountAlgohourInput = {
  account: Account
  hours: uint64
}

export type AccountWithOffsetHint = {
  account: Account
  offsetHint: Uint32
}

export type AlgohourPeriodTotals = {
  totalAlgohours: uint64
  final: boolean
}

export type DelegatorCommittee = {
  periodStart: Uint32
  periodEnd: Uint32
  extDelegatedVotes: Uint32
  extDelegatedAccountVotes: AccountIdWithVotes[]
}

export type DelegatorProposalStatus = 'WAIT' | 'VOTE' | 'VOTD' | 'CANC'

export type DelegatorProposal = {
  status: DelegatorProposalStatus
  committeeId: CommitteeId
  extVoteEndTime: Uint32
  extTotalVotingPower: Uint32
  extAccountsPendingVotes: AccountIdWithVotes[]
  extAccountsVoted: AccountIdWithVotes[]
  intVoteEndTime: uint64
  intTotalAlgohours: uint64
  intVotedAlgohours: uint64
  intVotesYesAlgohours: uint64
  intVotesNoAlgohours: uint64
  intVotesBoycottAlgohours: uint64
}
