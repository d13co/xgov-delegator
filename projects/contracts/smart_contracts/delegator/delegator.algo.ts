import {
  abimethod,
  Account,
  Application,
  BoxMap,
  clone,
  GlobalState,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { compileArc4 } from '@algorandfoundation/algorand-typescript/arc4'
import { AccountIdContract } from '../base/base.algo'
import {
  errAlgoHoursExist,
  errAlgoHoursMismatch,
  errAlgoHoursNotExist,
  errCommitteeExists,
  errNoVotingPower,
  errPeriodEndInvalid,
  errPeriodEndLessThanStart,
  errPeriodStartInvalid,
} from '../base/errors.algo'
import {
  AccountAlgohourInput,
  AccountIdWithVotes,
  AccountWithOffsetHint,
  AlgohourAccountKey,
  AlgohourPeriodTotals,
  CommitteeId,
  DelegatorCommittee,
} from '../base/types.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'
import { CommitteeOracle } from '../oracle/oracle.algo'

const periodLength: uint64 = 1_000_000

export class Delegator extends AccountIdContract {
  /** Committee Oracle Application ID */
  committeeOracleApp = GlobalState<Application>()
  /** Synced committee details w/ own delegated totals */
  committees = BoxMap<CommitteeId, DelegatorCommittee>({ keyPrefix: 'C' })
  /** Total algohours for each period */
  algohourPeriodTotals = BoxMap<uint64, AlgohourPeriodTotals>({ keyPrefix: 'H' })
  /** Algohours for each account for each period */
  algohourAccounts = BoxMap<AlgohourAccountKey, uint64>({ keyPrefix: 'h' })

  /**
   * Set the Committee Oracle Application ID
   * @param appId Application ID of Committee Oracle
   */
  public setCommitteeOracleApp(appId: Application): void {
    this.ensureCallerIsAdmin()
    this.committeeOracleApp.value = appId
  }

  /**
   * Sync committee metadata and delegated accounts from CommitteeOracle
   * @param committeeId Committee ID to sync
   * @param delegatedAccounts Accounts delegated to this contract
   */
  public syncCommitteeMetadata(committeeId: CommitteeId, delegatedAccounts: AccountWithOffsetHint[]) {
    this.ensureCallerIsAdmin()
    const committeeBox = this.committees(committeeId)
    ensure(!committeeBox.exists, errCommitteeExists)

    const oracleApp = compileArc4(CommitteeOracle)
    const remoteCommittee = oracleApp.call.getCommitteeMetadata({
      appId: this.committeeOracleApp.value,
      args: [committeeId, true],
    }).returnValue

    const committee: DelegatorCommittee = {
      periodStart: remoteCommittee.periodStart,
      periodEnd: remoteCommittee.periodEnd,
      extDelegatedVotes: u32(0),
      extDelegatedAccountVotes: [] as AccountIdWithVotes[],
    }

    let extDelegatedVotes: uint64 = 0
    for (const { account, offsetHint } of clone(delegatedAccounts)) {
      const localAccountId = this.getOrCreateAccountId(account)
      const remoteVotes = oracleApp.call.getXGovVotingPower({
        appId: this.committeeOracleApp.value,
        args: [committeeId, account, offsetHint],
      }).returnValue
      ensureExtra(remoteVotes.asUint64() > 0, errNoVotingPower, account.bytes)
      // TODO verify that this account has delegated to our escrow on xGov registry
      extDelegatedVotes += remoteVotes.asUint64()
      committee.extDelegatedAccountVotes.push({ accountId: localAccountId, votes: remoteVotes })
    }
    committee.extDelegatedVotes = u32(extDelegatedVotes)
    committeeBox.value = clone(committee)

    return committee
  }

  public syncProposalMetadata(proposalId: Application) {
    // get committee ID from proposal contract
    // ensure committee metadata is synced
    // ensure all periods are final
    // create or update proposal metadata record
  }

  /**
   * Add account algohours and update total algohours for period
   * @param periodStart period start. Aligned to 1M
   * @param accountAlgohourInputs
   */
  public addAccountAlgoHours(periodStart: uint64, accountAlgohourInputs: AccountAlgohourInput[]): void {
    this.ensureCallerIsAdmin()
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)

    for (let { account, hours } of clone(accountAlgohourInputs)) {
      const accountId = this.getOrCreateAccountId(account)
      const key: AlgohourAccountKey = [periodStart, accountId]
      const box = this.algohourAccounts(key)
      ensureExtra(!box.exists, errAlgoHoursExist, account.bytes)
      box.value = hours

      const totalBox = this.algohourPeriodTotals(periodStart)
      if (totalBox.exists) {
        totalBox.value.totalAlgohours += hours
      } else {
        totalBox.value = { totalAlgohours: hours, final: false }
      }
    }
  }

  /**
   * Remove account algohours and update total algohours for period
   * @param periodStart period start. Aligned to 1M
   * @param accountAlgohourInputs
   */
  public removeAccountAlgoHours(periodStart: uint64, accountAlgohourInputs: AccountAlgohourInput[]): void {
    this.ensureCallerIsAdmin()
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)

    for (let { account, hours } of clone(accountAlgohourInputs)) {
      const accountId = this.mustGetAccountId(account)
      const key: AlgohourAccountKey = [periodStart, accountId]
      const box = this.algohourAccounts(key)
      ensureExtra(box.exists, errAlgoHoursNotExist, account.bytes)
      ensureExtra(box.value === hours, errAlgoHoursMismatch, account.bytes) // ensure hours to remove matches existing hours to prevent accidental double removal
      box.delete()

      const totalBox = this.algohourPeriodTotals(periodStart)
      ensure(totalBox.exists, errAlgoHoursNotExist)
      totalBox.value.totalAlgohours -= hours
    }
  }

  /**
   * Update period algohour finality - indicates account algohour records are complete for this period
   * @param periodStart period start
   * @returns total algohours for period
   */
  @abimethod({ readonly: true })
  public updateAlgoHourPeriodFinality(periodStart: uint64, totalAlgohours: uint64, final: boolean): void {
    this.ensureCallerIsAdmin()
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    const box = this.algohourPeriodTotals(periodStart)
    ensure(box.exists, errAlgoHoursNotExist)
    ensure(box.value.totalAlgohours === totalAlgohours, errAlgoHoursMismatch)
    box.value.final = final
  }

  /*
   * Getters
   */

  /**
   * Sum account algohours over multiple 1M periods
   * @param periodStart period start, inclusive. Aligned to 1M
   * @param periodEnd period end, exclusive. Aligned to 1M
   * @param account account
   * @returns total algohours
   */
  private getAggregatedAccountAlgoHours(periodStart: uint64, periodEnd: uint64, account: Account): uint64 {
    ensure(periodEnd > periodStart, errPeriodEndLessThanStart)
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    ensure(periodEnd % periodLength === 0, errPeriodEndInvalid)
    const accountId = this.getAccountIdIfExists(account)
    if (accountId.asUint64() === 0) {
      return 0
    }
    let algohours: uint64 = 0
    for (let period = periodStart; period < periodEnd; period += periodLength) {
      const key: AlgohourAccountKey = [period, accountId]
      const box = this.algohourAccounts(key)
      algohours += box.exists ? box.value : 0
    }
    return algohours
  }

  /**
   * Get total algohours for period
   * @param periodStart period start
   * @returns total algohours for period
   */
  @abimethod({ readonly: true })
  public getAlgoHourPeriodTotals(periodStart: uint64): AlgohourPeriodTotals {
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    const box = this.algohourPeriodTotals(periodStart)
    return box.exists ? box.value : { totalAlgohours: 0, final: false }
  }

  /**
   * Get account algohours for period
   * @param periodStart period start
   * @param account
   * @returns
   */
  @abimethod({ readonly: true })
  public getAccountAlgoHours(periodStart: uint64, account: Account): uint64 {
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    const accountId = this.getAccountIdIfExists(account)
    if (accountId.asUint64() === 0) {
      return 0
    }
    const key: AlgohourAccountKey = [periodStart, accountId]
    const box = this.algohourAccounts(key)
    return box.exists ? box.value : 0
  }
}
