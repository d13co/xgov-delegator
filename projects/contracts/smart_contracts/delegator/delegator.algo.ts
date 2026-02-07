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
  CommitteeId,
  DelegatorCommittee,
} from '../base/types.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'
import { CommitteeOracle } from '../oracle/oracle.algo'

const periodLength: uint64 = 1_000_000

export class Delegator extends AccountIdContract {
  committeeOracleAppId = GlobalState<Application>()

  committees = BoxMap<CommitteeId, DelegatorCommittee>({ keyPrefix: 'C' })

  algohourTotals = BoxMap<uint64, uint64>({ keyPrefix: 'H' }) // TODO make into struct and add "finalized" value?
  algohourAccounts = BoxMap<AlgohourAccountKey, uint64>({ keyPrefix: 'h' })

  /**
   * Set the Committee Oracle Application ID
   * @param appId Application ID of Committee Oracle
   */
  public setCommitteeOracleAppId(appId: Application): void {
    this.ensureCallerIsAdmin()
    this.committeeOracleAppId.value = appId
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
      appId: this.committeeOracleAppId.value,
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
      const localAccountId = this.mustGetAccountId(account)
      const remoteVotes = oracleApp.call.getXGovVotingPower({
        appId: this.committeeOracleAppId.value,
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

      const totalBox = this.algohourTotals(periodStart)
      if (totalBox.exists) {
        totalBox.value += hours
      } else {
        totalBox.value = hours
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
      const accountId = this.getOrCreateAccountId(account)
      const key: AlgohourAccountKey = [periodStart, accountId]
      const box = this.algohourAccounts(key)
      ensureExtra(box.exists, errAlgoHoursNotExist, account.bytes)
      box.delete()

      const totalBox = this.algohourTotals(periodStart)
      ensure(totalBox.exists, errAlgoHoursNotExist)
      totalBox.value -= hours
    }
  }

  /**
   * Sum account algohours over multiple 1M periods
   * @param periodStart period start, inclusive. Aligned to 1M
   * @param periodEnd period end, exclusive. Aligned to 1M
   * @param account account
   * @returns total algohours
   */
  private getAccountAlgoHours(periodStart: uint64, periodEnd: uint64, account: Account): uint64 {
    ensure(periodEnd > periodStart, errPeriodEndLessThanStart)
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    ensure(periodEnd % periodLength === 0, errPeriodEndInvalid)
    const accountId = this.mustGetAccountId(account)
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
  public getAlgohourTotals(periodStart: uint64): uint64 {
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    const box = this.algohourTotals(periodStart)
    return box.exists ? box.value : 0
  }

  /**
   * Get account algohours for period
   * @param periodStart period start
   * @param account
   * @returns
   */
  @abimethod({ readonly: true })
  public getAccountAlgohours(periodStart: uint64, account: Account): uint64 {
    ensure(periodStart % periodLength === 0, errPeriodStartInvalid)
    const key: AlgohourAccountKey = [periodStart, this.mustGetAccountId(account)]
    const box = this.algohourAccounts(key)
    return box.exists ? box.value : 0
  }
}
