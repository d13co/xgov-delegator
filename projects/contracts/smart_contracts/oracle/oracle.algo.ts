import { Account, Box, BoxMap, Bytes, clone, GlobalState, log, uint64 } from '@algorandfoundation/algorand-typescript'
import { abimethod, decodeArc4, encodeArc4, StaticBytes, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { sbAppend, sbCreate, sbDeleteIndex, sbDeleteSuperbox, sbGetData } from '@d13co/superbox'
import { SuperboxMeta } from '@d13co/superbox/smart_contracts/superbox/lib/types.algo'
import { sbMetaBox } from '@d13co/superbox/smart_contracts/superbox/lib/utils.algo'
import { AccountIdContract } from '../base/base.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'
import {
  errAccountHintMismatch,
  errAccountIdMismatch,
  errAccountNotExists,
  errCommitteeExists,
  errCommitteeNotExists,
  errIngestedVotesNotZero,
  errNumXGovsExceeded,
  errOutOfOrder,
  errPeriodEndLessThanStart,
  errTotalXGovsExceeded,
  errTotalVotesExceeded,
  errTotalVotesMismatch,
} from './errors.algo'
import {
  CommitteeMetadata,
  getEmptyCommitteeMetadata,
  XGOV_STORED_SIZE,
  XGovInput,
  XGovStored,
} from './types.algo'

/**
 * Count total xGovs stored in committee superbox
 */
function getCommitteeSBXGovs(sbMeta: Box<SuperboxMeta>): uint64 {
  return sbMeta.value.totalByteLength.asUint64() / XGOV_STORED_SIZE
}

export class CommitteeOracle extends AccountIdContract {
  committees = BoxMap<StaticBytes<32>, CommitteeMetadata>({ keyPrefix: 'c' })
  lastSuperboxPrefix = GlobalState<uint64>({ initialValue: 0 })

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
    ensure(!committeeBox.exists, errCommitteeExists)
    ensure(periodEnd.asUint64() > periodStart.asUint64(), errPeriodEndLessThanStart)
    committeeBox.value = {
      periodStart,
      periodEnd,
      totalMembers,
      totalVotes,
      ingestedVotes: u32(0),
      superboxPrefix: 'S' + this.lastSuperboxPrefix.value.toString(),
    }
    sbCreate(this.getCommitteeSBName(committeeId), 4096, XGOV_STORED_SIZE, '[uint32,uint32]')
    this.lastSuperboxPrefix.value = this.lastSuperboxPrefix.value + 1
  }

  /**
   * Delete committee. Must not have any xGovs
   * @param committeeId committee ID
   */
  public unregisterCommittee(committeeId: StaticBytes<32>): void {
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, errCommitteeNotExists)
    ensure(committeeBox.value.ingestedVotes === u32(0), errIngestedVotesNotZero)
    committeeBox.delete()
    sbDeleteSuperbox(this.getCommitteeSBName(committeeId))
  }

  /**
   * Ingest xGovs into a committee
   * @param committeeId committee ID
   * @param xGovs xGovs to ingest
   */
  public ingestXGovs(committeeId: StaticBytes<32>, xGovs: XGovInput[]): void {
    const committee = this.mustGetCommittee(committeeId)

    const superboxName = this.getCommitteeSBName(committeeId)
    const sbMeta = sbMetaBox(superboxName)
    // figure out ingested accounts from superbox size
    const ingestedAccounts: uint64 = getCommitteeSBXGovs(sbMeta)
    // not exceeding total xGovs
    ensure(ingestedAccounts + xGovs.length <= committee.totalMembers.asUint64(), errTotalXGovsExceeded)

    let lastAccountId = u32(0)
    if (ingestedAccounts > 0) {
      const lastXGov = this.getStoredXGovAt(superboxName, ingestedAccounts - 1)
      lastAccountId = lastXGov.accountId
    }

    let ingestedVotes = committee.ingestedVotes.asUint64()
    let writeBuffer = Bytes``
    for (const xGov of clone(xGovs)) {
      // get or create account id
      xGov.accountId = this.getOrCreateAccountId(xGov)
      // ensure xGovs are added in ascending order
      ensure(xGov.accountId.asUint64() > lastAccountId.asUint64(), errOutOfOrder)
      // store variant removes account
      const xGovStored: XGovStored = {
        accountId: xGov.accountId,
        votes: xGov.votes,
      }
      // append to write buffer, write to superbox once
      writeBuffer = writeBuffer.concat(encodeArc4(xGovStored))
      lastAccountId = xGov.accountId
      ingestedVotes += xGov.votes.asUint64()
    }

    // ensure we did not exceed total votes
    ensure(ingestedVotes <= committee.totalVotes.asUint64(), errTotalVotesExceeded)

    log(sbAppend(superboxName, writeBuffer))

    committee.ingestedVotes = u32(ingestedVotes)
    // if we are finished, ensure total votes match
    if (ingestedAccounts + xGovs.length === committee.totalMembers.asUint64()) {
      ensure(committee.ingestedVotes === committee.totalVotes, errTotalVotesMismatch)
    }
    this.committees(committeeId).value = clone(committee)
  }

  /**
   * Uningest last N xGovs from committee
   * @param committeeId committee ID
   * @param numXGovs number of xGovs to uningest
   */
  public uningestXGovs(committeeId: StaticBytes<32>, numXGovs: uint64): void {
    const committee = this.mustGetCommittee(committeeId)
    const superboxName = this.getCommitteeSBName(committeeId)
    const sbMeta = sbMetaBox(superboxName)
    const totalXGovs = getCommitteeSBXGovs(sbMeta)
    ensure(numXGovs <= totalXGovs, errNumXGovsExceeded)
    let ingestedVotes = committee.ingestedVotes.asUint64()
    for (let i: uint64 = totalXGovs - 1; i >= totalXGovs - numXGovs; i--) {
      const xGovStored = this.getStoredXGovAt(superboxName, i)
      ingestedVotes -= xGovStored.votes.asUint64()
      sbDeleteIndex(superboxName, i)
    }
    committee.ingestedVotes = u32(ingestedVotes)
    this.committees(committeeId).value = clone(committee)
  }

  @abimethod({ readonly: true })
  public getAccountId(account: Account): Uint32 {
    return this.getAccountIdIfExists(account)
  }

  /**
   * Log multiple accounts' IDs (or zero if not found)
   * Used to fetch account>ID quickly off-chain
   * @param accounts accounts to log
   */
  @abimethod({ readonly: true })
  public logAccountIds(accounts: Account[]): void {
    for (const account of accounts) {
      log(this.getAccountIdIfExists(account).bytes)
    }
  }

  @abimethod({ readonly: true })
  public getCommitteeMetadata(committeeId: StaticBytes<32>): CommitteeMetadata {
    const committeeBox = this.committees(committeeId)
    if (committeeBox.exists) {
      return committeeBox.value
    }
    return getEmptyCommitteeMetadata()
  }

  @abimethod({ readonly: true })
  public logCommitteeMetadata(committeeIds: StaticBytes<32>[]): void {
    for (const committeeId of committeeIds) {
      const metadata = this.committees(committeeId)
      if (metadata.exists) {
        log(encodeArc4(metadata.value))
      } else {
        log(encodeArc4(getEmptyCommitteeMetadata()))
      }
    }
  }

  @abimethod({ readonly: true })
  public getCommitteeSuperboxMeta(committeeId: StaticBytes<32>): SuperboxMeta {
    const superboxName = this.getCommitteeSBName(committeeId)
    return sbMetaBox(superboxName).value
  }

  /**
   * Get xGov voting power, with required account offset hint (for opcode savings)
   * @param committeeId Committee ID
   * @param account xGov account
   * @param accountOffsetHint Offset of account in committee superbox
   * @returns xGov voting power
   */
  @abimethod({ readonly: true })
  public getXGovVotingPower(committeeId: StaticBytes<32>, account: Account, accountOffsetHint: Uint32): Uint32 {
    this.mustGetCommittee(committeeId)

    const accountId = this.getAccountIdIfExists(account)
    ensure(accountId.asUint64() !== 0, errAccountNotExists)

    const xGov = this.getStoredXGovAt(this.getCommitteeSBName(committeeId), accountOffsetHint.asUint64())
    ensureExtra(xGov.accountId === accountId, errAccountHintMismatch, accountId.bytes)

    return xGov.votes
  }

  /**
   * Get validated account ID or create account ID
   * @param xGov
   * @returns account ID
   */
  private getOrCreateAccountId(xGov: XGovInput): Uint32 {
    let accountId = this.getAccountIdIfExists(xGov.account)
    if (accountId.asUint64() === 0) {
      return this.createAccountId(xGov.account)
    } else {
      ensureExtra(accountId === xGov.accountId, errAccountIdMismatch, xGov.accountId.bytes)
      return accountId
    }
  }

  /**
   * Get committee metadata box value or fail
   * @param committeeId
   * @returns Committee
   */
  private mustGetCommittee(committeeId: StaticBytes<32>): CommitteeMetadata {
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, errCommitteeNotExists)
    return committeeBox.value
  }

  private getCommitteeSBName(committeeId: StaticBytes<32>): string {
    return this.mustGetCommittee(committeeId).superboxPrefix
  }

  private getStoredXGovAt(superboxName: string, index: uint64): XGovStored {
    const xGovData = sbGetData(superboxName, index)
    return decodeArc4<XGovStored>(xGovData)
  }
}
