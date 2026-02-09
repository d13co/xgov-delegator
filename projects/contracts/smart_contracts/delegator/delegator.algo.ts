import {
  abimethod,
  Account,
  Application,
  BoxMap,
  clone,
  GlobalState,
  op,
  uint64,
} from '@algorandfoundation/algorand-typescript'
import { compileArc4, StaticBytes } from '@algorandfoundation/algorand-typescript/arc4'
import { AccountIdContract } from '../base/base.algo'
import {
  errAlgoHoursExist,
  errAlgoHoursMismatch,
  errAlgoHoursNotExist,
  errAlgoHoursNotFinal,
  errCommitteeExists,
  errCommitteeNotExists,
  errNoVotingPower,
  errPeriodEndInvalid,
  errPeriodEndLessThanStart,
  errPeriodStartInvalid,
  errProposalExists,
  errXGovProposalCommitteeMissing,
  errXGovProposalInvalidCreator,
  errXGovProposalVoteOpenTsMissing,
  errXGovProposalVotingDurationMissing,
  errXGovRegistryMissing,
} from '../base/errors.algo'
import {
  AccountAlgohourInput,
  AccountIdWithVotes,
  AccountWithOffsetHint,
  AlgohourAccountKey,
  AlgohourPeriodTotals,
  CommitteeId,
  DelegatorCommittee,
  DelegatorProposal,
} from '../base/types.algo'
import { ensure, ensureExtra, u32 } from '../base/utils.algo'
import { CommitteeOracle, oracleXGovRegistryAppKey } from '../oracle/oracle.algo'
import {
  xGovProposalCommitteeIdKey,
  xGovProposalVoteOpenTsKey,
  xGovProposalVotingDurationKey,
} from '../xgov-proposal-mock/xGovProposalMock.algo'

const periodLength: uint64 = 1_000_000

export type AbsenteeMode = 'strict' | 'scaled'

export class Delegator extends AccountIdContract {
  /** Committee Oracle Application ID */
  committeeOracleApp = GlobalState<Application>()
  /** Time in seconds before external vote end to submit votes */
  voteSubmitThreshold = GlobalState<uint64>({ initialValue: 3600 * 3 })
  /** Absentee mode: strict or scaled */
  absenteeMode = GlobalState<string>({ initialValue: 'strict' })
  /** Synced committee details w/ own delegated totals */
  committees = BoxMap<CommitteeId, DelegatorCommittee>({ keyPrefix: 'C' })
  /** Proposal metadata */
  proposals = BoxMap<Application, DelegatorProposal>({ keyPrefix: 'P' })
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
   * Set the vote submit threshold (time in seconds before external vote end)
   * @param threshold Time in seconds
   */
  public setVoteSubmitThreshold(threshold: uint64): void {
    this.ensureCallerIsAdmin()
    this.voteSubmitThreshold.value = threshold
  }

  /**
   * Set the absentee mode
   * @param mode 'strict' or 'scaled'
   */
  public setAbsenteeMode(mode: AbsenteeMode): void {
    this.ensureCallerIsAdmin()
    this.absenteeMode.value = mode
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

  public syncProposalMetadata(proposalId: Application): DelegatorProposal {
    // only sync once (?) TODO: update state as separate method? need to consider how to handle changes in proposal state on xGov after sync
    const proposalBox = this.proposals(proposalId)
    ensure(!proposalBox.exists, errProposalExists)

    // get xgov registry app id from oracle
    // validate proposal was created by xgov registry
    const [registryAppId, registryAppExists] = op.AppGlobal.getExUint64(
      this.committeeOracleApp.value,
      oracleXGovRegistryAppKey,
    )
    ensure(registryAppExists, errXGovRegistryMissing)
    const proposalCreator = proposalId.creator
    const registryEscrow = Application(registryAppId).address
    ensure(proposalCreator === registryEscrow, errXGovProposalInvalidCreator)

    // get committee ID from proposal contract
    // ensure committee metadata is synced
    const [_committeeId, committeeIdExists] = op.AppGlobal.getExBytes(proposalId, xGovProposalCommitteeIdKey)
    ensure(committeeIdExists, errXGovProposalCommitteeMissing)
    const committeeId = new StaticBytes<32>(_committeeId)
    const committeeBox = this.committees(committeeId)
    ensure(committeeBox.exists, errCommitteeNotExists)
    const committeeMetadata = committeeBox.value as Readonly<DelegatorCommittee>

    let totalAlgoHours: uint64 = 0
    // ensure all periods are final
    for (
      let period: uint64 = committeeMetadata.periodStart.asUint64();
      period < committeeMetadata.periodEnd.asUint64();
      period += periodLength
    ) {
      const periodTotalsBox = this.algohourPeriodTotals(period)
      ensureExtra(periodTotalsBox.exists, errAlgoHoursNotExist, op.itob(period))
      ensureExtra(periodTotalsBox.value.final, errAlgoHoursNotFinal, op.itob(period))

      totalAlgoHours += periodTotalsBox.value.totalAlgohours
    }

    // get vote end ts
    const [voteOpenTs, voteOpenTsExists] = op.AppGlobal.getExUint64(proposalId, xGovProposalVoteOpenTsKey)
    const [votingDuration, votingDurationExists] = op.AppGlobal.getExUint64(proposalId, xGovProposalVotingDurationKey)
    ensure(voteOpenTsExists, errXGovProposalVoteOpenTsMissing)
    ensure(votingDurationExists, errXGovProposalVotingDurationMissing)
    const voteEndTs: uint64 = voteOpenTs + votingDuration

    const proposalMetadata: DelegatorProposal = {
      status: 'WAIT',
      committeeId: committeeId,
      extVoteEndTime: u32(voteEndTs),
      extTotalVotingPower: committeeMetadata.extDelegatedVotes,
      extAccountsPendingVotes: clone(committeeMetadata.extDelegatedAccountVotes),
      extAccountsVoted: [] as AccountIdWithVotes[],
      intVoteEndTime: voteEndTs - this.voteSubmitThreshold.value, // set internal vote end time earlier than external to allow for vote submission before xGov proposal voting ends
      intTotalAlgohours: totalAlgoHours,
      intVotedAlgohours: 0,
      intVotesYesAlgohours: 0,
      intVotesNoAlgohours: 0,
      intVotesBoycottAlgohours: 0,
    }
    proposalBox.value = clone(proposalMetadata)
    return proposalMetadata
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
