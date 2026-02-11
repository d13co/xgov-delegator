import { Config } from '@algorandfoundation/algokit-utils'
import { registerDebugEventHandlers } from '@algorandfoundation/algokit-utils-debug'
import { algorandFixture } from '@algorandfoundation/algokit-utils/testing'
import { beforeAll, beforeEach, describe, expect, test } from 'vitest'
import {
  calculateCommitteeId,
  increaseBudgetBaseCost,
  increaseBudgetIncrementCost,
} from 'xgov-committees-oracle-sdk'
import { committeesForTests } from './fixtures'
import { deployOracle } from '../common-tests'

describe('Oracle contract', () => {
  const localnet = algorandFixture()
  beforeAll(() => {
    Config.configure({
      debug: true,
      // traceAll: true,
    })
    registerDebugEventHandlers()
  })
  beforeEach(localnet.newScope)

  describe('increaseBudget opcode cost', () => {
    for (let i = 0; i < 3; i++) {
      test(`It should cost ${increaseBudgetBaseCost + i * increaseBudgetIncrementCost} with itxns=${i}`, async () => {
        const { testAccount } = localnet.context
        const sender = testAccount.toString()
        const signer = testAccount.signer

        const { sdk } = await deployOracle(localnet, testAccount)

        const {
          simulateResponse: {
            txnGroups: [{ appBudgetConsumed }],
          },
        } = await sdk
          .writeClient!.newGroup()
          .increaseBudget({ sender, signer, args: { itxns: BigInt(i) }, extraFee: (i * 1000).microAlgo() })
          .simulate()

        expect(appBudgetConsumed).toBe(increaseBudgetBaseCost + i * increaseBudgetIncrementCost) // if this fails then update the new value in SDK/constants
      })
    }
  })

  for (const [name, id, committeeFile] of committeesForTests) {
    test(`Uploads committee ${name}`, async () => {
      const { testAccount } = localnet.context
      const { sdk } = await deployOracle(localnet, testAccount)

      const committeeId = calculateCommitteeId(JSON.stringify(committeeFile))
      expect(committeeId).toEqual(new Uint8Array(Buffer.from(id, 'base64')))

      const result = await sdk.uploadCommitteeFile(committeeFile)
      expect(result).toEqual(committeeId)

      const storedCommittee = await sdk.getCommittee(committeeId)
      expect(storedCommittee).toBeDefined()
      expect(storedCommittee!.periodStart).toEqual(committeeFile.periodStart)
      expect(storedCommittee!.periodEnd).toEqual(committeeFile.periodEnd)
      expect(storedCommittee!.totalMembers).toEqual(committeeFile.totalMembers)
      expect(storedCommittee!.totalVotes).toEqual(committeeFile.totalVotes)
      expect(storedCommittee!.xGovs).toEqual(committeeFile.xGovs)
    })
  }
})
