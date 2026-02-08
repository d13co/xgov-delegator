import { Uint64 } from '@algorandfoundation/algorand-typescript'
import { TestExecutionContext } from '@algorandfoundation/algorand-typescript-testing'
import { StaticBytes } from '@algorandfoundation/algorand-typescript/arc4'
import { beforeEach, describe, expect, it } from 'vitest'
import { AccountWithVotes } from '../base/types.algo'
import { u32 } from '../base/utils.algo'
import { CommitteeOracle } from '../oracle/oracle.algo'

describe('Oracle contract', () => {
  const ctx = new TestExecutionContext()

  beforeEach(() => ctx.reset())

  describe('with committee', () => {
    let contract: CommitteeOracle | undefined
    let xGovs: AccountWithVotes[] = []

    const committeeId = new StaticBytes<32>(`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)
    const periodStart = u32(11)
    const periodEnd = u32(22)
    const totalMembers = u32(2)
    const totalVotes = u32(20)
    const xgovRegistryId = Uint64(13)

    beforeEach(() => {
      console.log('beforeEach start')
      contract = ctx.contract.create(CommitteeOracle)
      console.log('registerCommittee')
      contract.registerCommittee(committeeId, periodStart, periodEnd, totalMembers, totalVotes, xgovRegistryId)
      const account = ctx.any.account()
      const votes = u32(10)
      xGovs.push({ account, votes })
      console.log('ingestXGovs')
      contract.ingestXGovs(committeeId, xGovs)
      console.log('beforeEach end')
    })

    it('getCommitteeMetadata should get correct information', () => {
      const metadata = contract!.getCommitteeMetadata(committeeId, true)
      expect(metadata.periodStart.asUint64()).toBe(periodStart.asUint64())
    })
  })
})
