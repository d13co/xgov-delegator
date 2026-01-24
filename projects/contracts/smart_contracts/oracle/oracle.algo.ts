import { Account, Box, BoxMap, Bytes, clone, log, uint64 } from '@algorandfoundation/algorand-typescript'
import { decodeArc4, encodeArc4, StaticBytes, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { sbAppend, sbCreate, sbDeleteIndex, sbDeleteSuperbox, sbGetData } from '@d13co/superbox'
import { SuperboxMeta } from '@d13co/superbox/smart_contracts/superbox/lib/types.algo'
import { sbMetaBox } from '@d13co/superbox/smart_contracts/superbox/lib/utils.algo'
import { AccountIdContract } from '../base/base.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'

/**
 * Committee Metadata
 */
export interface Committee {
  periodStart: Uint32
  periodEnd: Uint32 // exclusive
  totalMembers: Uint32
  totalVotes: Uint32
  ingestedVotes: Uint32
}

/**
 * Input representation of a committee member
 */
export type MemberInput = {
  accountId: Uint32
  account: Account
  votes: Uint32
}

/**
 * Stored representation of a committee member
 */
export type MemberStored = {
  accountId: Uint32
  votes: Uint32
}

const MEMBER_STORED_SIZE: uint64 = 4 + 4 // AccountID + Votes

/**
 * Get superbox name for committee
 */
function getCommitteeSBName(committeeId: StaticBytes<32>): string {
  return committeeId.bytes.toString()
}

/**
 * Count total members stored in committee superbox
 */
function getCommitteeSBMembers(sbMeta: Box<SuperboxMeta>): uint64 {
  return sbMeta.value.totalByteLength.asUint64() / MEMBER_STORED_SIZE
}

export class CommitteeOracle extends AccountIdContract {
  committees = BoxMap<StaticBytes<32>, Committee>({ keyPrefix: 'c' })

  /**
   * Register a committee
   * @param committeeId Committee ID
   * @param periodStart Period start
   * @param periodEnd Period end
   * @param totalMembers Total xGovs
   * @param totalVotes Total votes in committee
   */
  public registerCommittee(
    committeeId: StaticBytes<32>,
    periodStart: Uint32,
    periodEnd: Uint32,
    totalMembers: Uint32,
    totalVotes: Uint32,
  ): void {
    const committeeBox = this.committees(committeeId)
    ensure(!committeeBox.exists, 'C_EX')
    committeeBox.value = {
      periodStart,
      periodEnd,
      totalMembers,
      totalVotes,
      ingestedVotes: u32(0),
    }
    sbCreate(getCommitteeSBName(committeeId), 4096, MEMBER_STORED_SIZE, '[uint32,uint32]')
  }

  /**
   * Delete committee. Must not have any members
   * @param committeeId committee ID
   */
  public unregisterCommittee(committeeId: StaticBytes<32>): void {
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, 'C_NEX')
    ensure(committeeBox.value.ingestedVotes === u32(0), 'IV_NC')
    committeeBox.delete()
    sbDeleteSuperbox(getCommitteeSBName(committeeId))
  }

  /**
   * Ingest members into a committee
   * @param committeeId committee ID
   * @param members members to ingest
   */
  public ingestMembers(committeeId: StaticBytes<32>, members: MemberInput[]): void {
    const committee = this.mustGetCommittee(committeeId)

    const superboxName = getCommitteeSBName(committeeId)
    const sbMeta = sbMetaBox(superboxName)
    // figure out ingested accounts from superbox size
    const ingestedAccounts: uint64 = getCommitteeSBMembers(sbMeta)
    // not exceeding total members
    ensure(ingestedAccounts + members.length <= committee.totalMembers.asUint64(), 'TM_EX')

    const lastMember = decodeArc4<MemberStored>(sbGetData(superboxName, ingestedAccounts - 1))
    let lastAccountId = lastMember.accountId

    let ingestedVotes = committee.ingestedVotes.asUint64()
    let writeBuffer = Bytes``
    for (const member of clone(members)) {
      // get or create account id
      member.accountId = this.getOrCreateAccountId(member)
      // ensure members are added in ascending order
      ensure(member.accountId.asUint64() > lastAccountId.asUint64(), 'OOO')
      // store variant removes account
      const memberStored: MemberStored = {
        accountId: member.accountId,
        votes: member.votes,
      }
      // append to write buffer, write to superbox once
      writeBuffer = writeBuffer.concat(encodeArc4(memberStored))
      lastAccountId = member.accountId
      ingestedVotes += member.votes.asUint64()
    }

    // ensure we did not exceed total votes
    ensure(ingestedVotes <= committee.totalVotes.asUint64(), 'TV_EX')

    sbAppend(superboxName, writeBuffer)

    committee.ingestedVotes = u32(ingestedVotes)
    // if we are finished, ensure total votes match
    if (ingestedAccounts + members.length === committee.totalMembers.asUint64()) {
      ensure(committee.ingestedVotes === committee.totalVotes, 'TV_MM')
    }
    this.committees(committeeId).value = clone(committee)
  }

  /**
   * Uningest last N members from committee
   * @param committeeId committee ID
   * @param numMembers number of members to uningest
   */
  public uningestMembers(committeeId: StaticBytes<32>, numMembers: uint64): void {
    const committee = this.mustGetCommittee(committeeId)
    const superboxName = getCommitteeSBName(committeeId)
    const sbMeta = sbMetaBox(superboxName)
    const totalMembers = getCommitteeSBMembers(sbMeta)
    ensure(numMembers <= totalMembers, 'NM_EX')
    let ingestedVotes = committee.ingestedVotes.asUint64()
    for (let i: uint64 = totalMembers - 1; i >= totalMembers - numMembers; i--) {
      const memberStored = this.getStoredMemberAt(superboxName, i)
      ingestedVotes -= memberStored.votes.asUint64()
      sbDeleteIndex(superboxName, i)
    }
    committee.ingestedVotes = u32(ingestedVotes)
    this.committees(committeeId).value = clone(committee)
  }

  public getAccountId(account: Account): Uint32 {
    return this.getAccountIdIfExists(account)
  }

  /**
   * Log multiple accounts' IDs (or zero if not found)
   * Used to fetch account>ID quickly off-chain
   * @param accounts accounts to log
   */
  public logAccountIds(accounts: Account[]): void {
    for (const account of accounts) {
      log(this.getAccountIdIfExists(account).bytes)
    }
  }

  /**
   * Get member voting power, with required account offset hint (for opcode savings)
   * @param committeeId Committee ID
   * @param account Member account
   * @param accountOffsetHint Offset of account in committee superbox
   * @returns Member voting power
   */
  public getMemberVotingPower(committeeId: StaticBytes<32>, account: Account, accountOffsetHint: Uint32): Uint32 {
    this.mustGetCommittee(committeeId)

    const accountId = this.getAccountIdIfExists(account)
    ensure(accountId.asUint64() !== 0, 'A_NEX')

    const member = this.getStoredMemberAt(getCommitteeSBName(committeeId), accountOffsetHint.asUint64())
    ensureExtra(member.accountId === accountId, 'AH', accountId.bytes)

    return member.votes
  }

  /**
   * Get validated account ID or create account ID
   * @param member
   * @returns account ID
   */
  private getOrCreateAccountId(member: MemberInput): Uint32 {
    let accountId = this.getAccountIdIfExists(member.account)
    if (accountId.asUint64() === 0) {
      return this.createAccountId(member.account)
    } else {
      ensureExtra(accountId === member.accountId, 'ID', member.accountId.bytes)
      return accountId
    }
  }

  /**
   * Get committee metadata box value or fail
   * @param committeeId
   * @returns Committee
   */
  private mustGetCommittee(committeeId: StaticBytes<32>): Committee {
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, 'C_NEX')
    return committeeBox.value
  }

  private getStoredMemberAt(superboxName: string, index: uint64): MemberStored {
    const memberData = sbGetData(superboxName, index)
    return decodeArc4<MemberStored>(memberData)
  }
}
