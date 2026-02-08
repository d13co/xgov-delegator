import {
  Account,
  Application,
  Box,
  BoxMap,
  bytes,
  Bytes,
  clone,
  GlobalState,
  log,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { abimethod, decodeArc4, encodeArc4, Uint32 } from '@algorandfoundation/algorand-typescript/arc4'
import { sbAppend, sbCreate, sbDeleteIndex, sbDeleteSuperbox, sbGetData } from '@d13co/superbox'
import { SuperboxMeta } from '@d13co/superbox/smart_contracts/superbox/lib/types.algo'
import { itoa, sbMetaBox } from '@d13co/superbox/smart_contracts/superbox/lib/utils.algo'
import { AccountIdContract } from '../base/base.algo'
import {
  errAccountHintMismatch,
  errAccountNotExists,
  errCommitteeExists,
  errCommitteeIncomplete,
  errCommitteeNotExists,
  errIngestedVotesNotZero,
  errNumXGovsExceeded,
  errOutOfOrder,
  errPeriodEndLessThanStart,
  errTotalVotesExceeded,
  errTotalVotesMismatch,
  errTotalXGovsExceeded,
} from '../base/errors.algo'
import {
  ACCOUNT_ID_WITH_VOTES_STORED_SIZE,
  AccountIdWithVotes,
  AccountWithVotes,
  CommitteeId,
  CommitteeMetadata,
  getEmptyCommitteeMetadata,
} from '../base/types.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'

/**
 * Count total xGovs stored in committee superbox
 */
function getCommitteeSBXGovs(sbMeta: Box<SuperboxMeta>): uint64 {
  return sbMeta.value.totalByteLength.asUint64() / ACCOUNT_ID_WITH_VOTES_STORED_SIZE
}

export class CommitteeOracle extends AccountIdContract {
  /** xGov registry application ID */
  xGovRegistryApp = GlobalState<Application>()
  /** Committee metadata box map */
  committees = BoxMap<CommitteeId, CommitteeMetadata>({ keyPrefix: 'c' })
  /** Incrementing superbox prefix for committees */
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
    committeeId: CommitteeId,
    periodStart: Uint32,
    periodEnd: Uint32,
    totalMembers: Uint32,
    totalVotes: Uint32,
    xGovRegistryId: uint64,
  ): void {
    this.ensureCallerIsAdmin()

    const committeeBox = this.committees(committeeId)
    ensure(!committeeBox.exists, errCommitteeExists)
    ensure(periodEnd.asUint64() > periodStart.asUint64(), errPeriodEndLessThanStart)
    committeeBox.value = {
      periodStart,
      periodEnd,
      totalMembers,
      totalVotes,
      xGovRegistryId,
      ingestedVotes: u32(0),
      superboxPrefix: 'S' + this.lastSuperboxPrefix.value.toString(),
    }
    sbCreate(this.getCommitteeSBPrefix(committeeId), 2048, ACCOUNT_ID_WITH_VOTES_STORED_SIZE, '[uint32,uint32]')
    this.lastSuperboxPrefix.value = this.lastSuperboxPrefix.value + 1
  }

  /**
   * Delete committee. Must not have any xGovs
   * @param committeeId committee ID
   */
  public unregisterCommittee(committeeId: CommitteeId): void {
    this.ensureCallerIsAdmin()

    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, errCommitteeNotExists)
    ensure(committeeBox.value.ingestedVotes === u32(0), errIngestedVotesNotZero)
    committeeBox.delete()
    sbDeleteSuperbox(this.getCommitteeSBPrefix(committeeId))
  }

  /**
   * Ingest xGovs into a committee
   * @param committeeId committee ID
   * @param xGovs xGovs to ingest
   */
  public ingestXGovs(committeeId: CommitteeId, xGovs: AccountWithVotes[]): void {
    this.ensureCallerIsAdmin()

    const committee = this.mustGetCommitteeMetadata(committeeId)
    const superboxName = this.getCommitteeSBPrefix(committeeId)
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
      const accountId = this.getOrCreateAccountId(xGov.account)
      // ensure xGovs are added in ascending order
      ensure(accountId.asUint64() > lastAccountId.asUint64(), errOutOfOrder)
      // store variant removes account
      const xGovStored: AccountIdWithVotes = {
        accountId: accountId,
        votes: xGov.votes,
      }
      // append to write buffer, write to superbox once
      writeBuffer = writeBuffer.concat(encodeArc4(xGovStored))
      lastAccountId = accountId
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
  public uningestXGovs(committeeId: CommitteeId, numXGovs: uint64): void {
    this.ensureCallerIsAdmin()

    const committee = this.mustGetCommitteeMetadata(committeeId)
    const superboxName = this.getCommitteeSBPrefix(committeeId)
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

  /**
   * Set the xGov Registry Application ID
   * @param appId xGov Registry Application ID
   */
  public setXGovRegistryApp(appId: Application): void {
    this.ensureCallerIsAdmin()
    this.xGovRegistryApp.value = appId
  }

  /*
   * Read methods
   */

  /**
   * Get account ID if exists, else return 0
   * @param account account to look up
   * @returns account ID or 0 if not found
   */
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

  /**
   * Get committee metadata
   * @param committeeId Committee ID
   * @param mustBeComplete Whether committee must be complete (all votes ingested)
   * @returns CommitteeMetadata
   */
  @abimethod({ readonly: true })
  public getCommitteeMetadata(committeeId: CommitteeId, mustBeComplete: boolean): CommitteeMetadata {
    const committeeBox = this.committees(committeeId)
    if (committeeBox.exists) {
      if (mustBeComplete) {
        ensure(committeeBox.value.ingestedVotes === committeeBox.value.totalVotes, errCommitteeIncomplete)
      }
      return committeeBox.value
    }
    return getEmptyCommitteeMetadata()
  }

  /**
   * Log committee metadata for multiple committees
   * @param committeeIds
   */
  @abimethod({ readonly: true })
  public logCommitteeMetadata(committeeIds: CommitteeId[]): void {
    for (const committeeId of committeeIds) {
      const metadata = this.committees(committeeId)
      if (metadata.exists) {
        log(encodeArc4(metadata.value))
      } else {
        log(encodeArc4(getEmptyCommitteeMetadata()))
      }
    }
  }

  /**
   * Facilitates fetching committee in "one shot" / parallel queries
   * if logMetadata is true, log committee metadata and superbox metadata (which includes total xGovs)
   * then log $dataPageLength number of xGov data boxes, starting from $startDataPage
   * @param committeeId
   * @param logMetadata
   * @param startDataPage
   * @param dataPageLength
   */
  public logCommitteePages(
    committeeId: CommitteeId,
    logMetadata: boolean,
    startDataPage: uint64,
    dataPageLength: uint64,
  ): void {
    // log metadata and superbox meta on first page
    const superboxPrefix = this.getCommitteeSBPrefix(committeeId)
    const sbMetaBoxRef = sbMetaBox(superboxPrefix)
    ensure(sbMetaBoxRef.exists, errCommitteeNotExists)
    const sbMeta = clone(sbMetaBoxRef.value)
    if (logMetadata) {
      const committeeMetadata = this.mustGetCommitteeMetadata(committeeId) // ensure committee exists
      log(encodeArc4(committeeMetadata))
      log(encodeArc4(sbMeta))
    }

    // log data pages. allow calling more pages than exist, log empty if page exceeds data
    const maxDataPages = sbMeta.boxByteLengths.length
    for (let i: uint64 = 0; i < dataPageLength; i++) {
      const page: uint64 = startDataPage + i
      if (page >= maxDataPages) {
        log(Bytes``) // no page at index; logging empty
      } else {
        const dataBoxName = superboxPrefix + itoa(page) // TODO export dataBoxRef from superbox lib and use that instead of reconstructing name
        log(Box<bytes>({ key: dataBoxName }).value)
      }
    }
  }

  /**
   * Get committee superbox metadata
   * @param committeeId
   * @returns SuperboxMeta
   */
  @abimethod({ readonly: true })
  public getCommitteeSuperboxMeta(committeeId: CommitteeId): SuperboxMeta {
    const superboxName = this.getCommitteeSBPrefix(committeeId)
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
  public getXGovVotingPower(committeeId: CommitteeId, account: Account, accountOffsetHint: Uint32): Uint32 {
    this.mustGetCommitteeMetadata(committeeId)

    const accountId = this.getAccountIdIfExists(account)
    ensure(accountId.asUint64() !== 0, errAccountNotExists)

    const xGov = this.getStoredXGovAt(this.getCommitteeSBPrefix(committeeId), accountOffsetHint.asUint64())
    ensureExtra(xGov.accountId === accountId, errAccountHintMismatch, accountId.bytes)

    return xGov.votes
  }

  /**
   * Get committee metadata box value or fail
   * @param committeeId
   * @returns Committee
   */
  private mustGetCommitteeMetadata(committeeId: CommitteeId): CommitteeMetadata {
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, errCommitteeNotExists)
    return committeeBox.value
  }

  /**
   * Get committee superbox prefix
   * @param committeeId
   * @returns committee superbox prefix
   */
  private getCommitteeSBPrefix(committeeId: CommitteeId): string {
    return this.mustGetCommitteeMetadata(committeeId).superboxPrefix
  }

  /**
   * Get xgov stored at index in committee superbox
   * @param superboxName committee superbox name
   * @param index offset
   * @returns xGov account ID and votes stored at index
   */
  private getStoredXGovAt(superboxName: string, index: uint64): AccountIdWithVotes {
    const xGovData = sbGetData(superboxName, index)
    return decodeArc4<AccountIdWithVotes>(xGovData)
  }
}
